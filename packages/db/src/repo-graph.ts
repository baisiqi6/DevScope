import { eq, and, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
  repositories,
  repoRelationships,
  packageRepoMappings,
  githubRepoNameCanonicalizations,
  repositoryTechnologyStacks,
  technologyStacks,
  userWatchedRepositories,
} from "./schema";
import { detectTechStack, type TechStackNode } from "./tech-stack-catalog";
import {
  parseTechnologyStackStorageMode,
  replaceRepositoryTechnologyStacksForCurrentSnapshots,
  selectTopTechnologyStackSlugs,
  type TechnologyStackProjectionRow,
} from "./technology-stack-entities";
import { compareBaselineToCurrent } from "./baseline-compare";
import {
  applySbomBackfillIfCurrent,
  poolRepositoryEmbeddingForCurrentVersion,
} from "./collection";
import {
  DEFAULT_EXTERNAL_RESOLUTION_SETTINGS,
  ExternalRequestBudget,
  GraphRateLimitedError,
  canonicalizationRetryAt,
  fetchDepsDevOutcome,
  interpretCanonicalizationRow,
  interpretMappingRow,
  mappingRetryAt,
  packageKeyId,
  rewriteMappingsForRename,
  runBoundedPool,
  upsertCanonicalizationOutcome,
  upsertMappingOutcome,
  type CanonicalizationOutcome,
  type DepsDevOutcome,
  type ExternalResolutionSettings,
  type PackageKey,
} from "./deps-cache";
import type { GraphRebuildProgress, GraphRebuildStage, GraphStageDuration } from "@devscope/shared";

export { detectTechStack } from "./tech-stack-catalog";

export type GraphProgressSink = (snapshot: GraphRebuildProgress) => Promise<void>;

/** 单次 attempt 的跨 stage 共享计数器、预算与 stage 时长上下文 */
export class GraphRunContext {
  readonly counters = {
    cacheHits: 0,
    cacheMisses: 0,
    externalRequests: 0,
    timeouts: 0,
    retryableErrors: 0,
  };
  readonly stageDurations: GraphStageDuration[] = [];

  constructor(
    readonly settings: ExternalResolutionSettings,
    readonly budget: ExternalRequestBudget,
    private readonly sink?: GraphProgressSink,
  ) {}

  async timeStage<T>(stage: GraphRebuildStage, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      this.stageDurations.push({ stage, durationMs: Date.now() - startedAt });
    }
  }

  async emit(stage: GraphRebuildStage, completed: number, total: number): Promise<void> {
    if (!this.sink) return;
    await this.sink({ stage, completed, total, ...this.counters });
  }
}

function resolveRunContext(
  opts: { settings?: Partial<ExternalResolutionSettings>; budget?: ExternalRequestBudget; progress?: GraphProgressSink },
): GraphRunContext {
  const settings = { ...DEFAULT_EXTERNAL_RESOLUTION_SETTINGS, ...opts.settings };
  const budget = opts.budget ?? new ExternalRequestBudget(settings);
  return new GraphRunContext(settings, budget, opts.progress);
}

function userRepositoryScope(userId: number) {
  return sql`EXISTS (
    SELECT 1 FROM user_watched_repositories user_repo
    WHERE user_repo.repo_id = ${repositories.id}
      AND user_repo.user_id = ${userId}
  )`;
}

// ============================================================================
// SBOM 解析
// ============================================================================

export interface SbomPackage {
  name: string;
  version: string;
  /** deps.dev 包生态系统标识（来自 purl 类型），如 npm/pypi/maven/cargo/go/nuget */
  system: string;
}

const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
// pypi/maven 允许 X.Y 无 patch 段（deps.dev 版本端点接受）；仍拒绝范围 spec（^、~、catalog:、>= 等）
const RELAXED_VERSION_RE = /^\d+(\.\d+){1,2}(-[\w.]+)?(\+[\w.]+)?$/;

// purl 类型 → deps.dev system 映射；不在此表中的生态（githubactions、github 等）一律忽略
const PURL_SYSTEM_MAP: Record<string, string> = {
  npm: "npm",
  pypi: "pypi",
  maven: "maven",
  cargo: "cargo",
  golang: "go",
  nuget: "nuget",
};

function detectPurlSystem(externalRefs: unknown): string | null {
  if (!Array.isArray(externalRefs)) return null;
  for (const ref of externalRefs) {
    if (typeof ref !== "object" || ref === null) continue;
    if ((ref as Record<string, unknown>).referenceType !== "purl") continue;
    const locator = (ref as Record<string, unknown>).referenceLocator;
    if (typeof locator !== "string" || !locator.startsWith("pkg:")) continue;
    const purlType = locator.slice("pkg:".length).split("/")[0];
    const system = PURL_SYSTEM_MAP[purlType];
    if (system) return system;
  }
  return null;
}

export function parseSbomPackages(sbom: Record<string, unknown>): SbomPackage[] {
  const sbomObj = sbom.sbom as Record<string, unknown> | undefined;
  if (!sbomObj) return [];

  const packages = sbomObj.packages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(packages)) return [];

  const result: SbomPackage[] = [];
  const seen = new Set<string>();

  for (const pkg of packages) {
    const name = pkg.name as string | undefined;
    const versionInfo = pkg.versionInfo as string | undefined;
    if (!name || !versionInfo) continue;

    const system = detectPurlSystem(pkg.externalRefs);
    if (!system) continue;

    const versionRe =
      system === "pypi" || system === "maven" ? RELAXED_VERSION_RE : EXACT_SEMVER_RE;
    if (!versionRe.test(versionInfo)) continue;

    const key = `${system}:${name}@${versionInfo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, version: versionInfo, system });
  }

  return result;
}

// ============================================================================
// 仓库级向量：过滤 mean pooling
// ============================================================================

const POOL_CHUNK_TYPES = ["readme", "description"];

export async function poolRepoEmbedding(db: Db, repoId: number): Promise<boolean> {
  return await poolRepositoryEmbeddingForCurrentVersion(db, repoId) === "applied";
}

export async function backfillRepoEmbeddings(
  db: Db,
  userId: number,
  opts: { onProgress?: (completed: number, total: number) => Promise<void> } = {},
): Promise<number> {
  const repos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.isReference, false), userRepositoryScope(userId)));

  let pooled = 0;
  let completed = 0;
  await opts.onProgress?.(completed, repos.length);
  for (const repo of repos) {
    const ok = await poolRepoEmbedding(db, repo.id);
    if (ok) pooled++;
    completed++;
    await opts.onProgress?.(completed, repos.length);
  }
  return pooled;
}

// ============================================================================
// 相似边：全量重算
// ============================================================================

export interface SimilarityOptions {
  topK?: number;
  minScore?: number;
}

export async function recomputeSimilarityEdges(
  db: Db,
  userId: number,
  opts: SimilarityOptions = {},
): Promise<number> {
  const topK = opts.topK ?? 8;
  const minScore = opts.minScore ?? 0.75;

  const reposWithEmbedding = await db
    .select({
      id: repositories.id,
      embedding: repositories.embedding,
    })
    .from(repositories)
    .where(and(
      eq(repositories.isReference, false),
      isNotNull(repositories.embedding),
      userRepositoryScope(userId),
    ));

  if (reposWithEmbedding.length === 0) return 0;

  const edges: Array<{
    sourceRepoId: number;
    targetRepoId: number;
    score: number;
    pooledChunks: number;
    chunkTypes: string[];
  }> = [];

  for (const source of reposWithEmbedding) {
    const candidates: Array<{ targetId: number; score: number }> = [];

    for (const target of reposWithEmbedding) {
      if (target.id === source.id) continue;
      const score = cosineSimilarity(source.embedding!, target.embedding!);
      if (score >= minScore) {
        candidates.push({ targetId: target.id, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, topK);

    for (const c of topCandidates) {
      edges.push({
        sourceRepoId: source.id,
        targetRepoId: c.targetId,
        score: c.score,
        pooledChunks: 0,
        chunkTypes: POOL_CHUNK_TYPES,
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(repoRelationships)
      .where(and(
        eq(repoRelationships.userId, userId),
        eq(repoRelationships.edgeType, "similarity"),
      ));

    if (edges.length > 0) {
      await tx.insert(repoRelationships).values(
        edges.map((e) => ({
          userId,
          sourceRepoId: e.sourceRepoId,
          targetRepoId: e.targetRepoId,
          edgeType: "similarity" as const,
          score: e.score,
          evidence: {
            kind: "similarity",
            score: e.score,
            pooledChunks: e.pooledChunks,
            chunkTypes: e.chunkTypes,
          },
        }))
      );
    }
  });

  return edges.length;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ============================================================================
// 依赖边：SBOM → deps.dev → 工作区内过滤
// ============================================================================

export type ResolveDepsMappingFn = (
  system: string,
  packageName: string,
  packageVersion: string
) => Promise<DepsDevOutcome>;

export type CanonicalizeFn = (fullName: string) => Promise<CanonicalizationOutcome>;

export interface DependencyEdgeOptions {
  resolveMapping?: ResolveDepsMappingFn;
  /** 解析 GitHub 重命名后的规范 fullName（缺省不归一，测试可不传） */
  canonicalize?: CanonicalizeFn;
  settings?: Partial<ExternalResolutionSettings>;
  budget?: ExternalRequestBudget;
  now?: () => Date;
  progress?: GraphProgressSink;
  /** 原子提交前的租约复核；lost lease 时拒绝提交。无参调用复核连接池，
   * 传入事务执行器时在事务首句带行锁复核（对齐 technology-stack-entities 先例）。 */
  assertLease?: (executor?: Db) => Promise<void>;
  /** 仅用于确定性并发测试：DB-only 原子提交开始前暂停。 */
  beforeAtomicCommit?: () => Promise<void>;
  /** 由 rebuildRepoGraph 传入的共享上下文（跨 stage 计数与预算） */
  ctx?: GraphRunContext;
}

/** 对公共外部目标做 GitHub 重命名归一时的调用门槛，避免无界 API 请求。 */
const CANONICALIZATION_MIN_INDEGREE = 2;
/** 技术栈节点按使用仓库数降序封顶，避免图谱被细粒度框架节点淹没。 */
const TECH_STACK_TOP_N = 30;

interface BridgingPackage {
  system: string;
  name: string;
  version: string;
}

export async function recomputeDependencyEdges(
  db: Db,
  userId: number,
  opts: DependencyEdgeOptions = {},
): Promise<number> {
  const ctx = opts.ctx ?? resolveRunContext(opts);
  const storageMode = parseTechnologyStackStorageMode(process.env.TECHNOLOGY_STACK_STORAGE_MODE);
  // Phase C：new_only 起 legacy writer 停写（reference upsert/伪 watch/legacy 栈边/
  // GC 全部跳过），冻结基线由独立 receipt 与单向包含比较守护
  const legacyWriterActive = storageMode === "legacy_shadow_dual_write"
    || storageMode === "new_read_dual_write";
  const { settings } = ctx;
  const now = opts.now ?? (() => new Date());
  const resolveMapping = opts.resolveMapping
    ?? ((system: string, packageName: string, packageVersion: string) =>
      fetchDepsDevOutcome(system, packageName, packageVersion, settings));

  const allRepos = await db
    .select({
      id: repositories.id,
      githubRepositoryId: repositories.githubRepositoryId,
      fullName: repositories.fullName,
      updatedAt: repositories.updatedAt,
      sbomPackages: repositories.sbomPackages,
      isReference: repositories.isReference,
    })
    .from(repositories)
    .where(userRepositoryScope(userId));

  // 只有采集仓库（is_reference=false）的 SBOM 作为依赖解析起点
  const collectedRepos = allRepos.filter((r) => !r.isReference);

  // fullName(小写) -> { id, isReference }，用于判断依赖目标是否已采集
  const repoByFullName = new Map(
    allRepos.map((r) => [r.fullName.toLowerCase(), { id: r.id, isReference: r.isReference }]),
  );

  // ---- 第一步：收集唯一 package key；技术栈 detection 不受缓存影响 ----
  interface RawDep {
    sourceRepoId: number;
    targetFullName: string;
    pkg: BridgingPackage;
  }
  const rawStackDeps: Array<{ sourceRepoId: number; stack: TechStackNode; pkg: BridgingPackage }> =
    [];
  const uniqueKeys = new Map<string, PackageKey>();
  for (const repo of collectedRepos) {
    const packages = repo.sbomPackages ?? [];
    for (const pkg of packages) {
      // 历史持久化数据无 system 字段，默认按 npm 处理
      const system = pkg.system ?? "npm";
      const bridgingPackage = { system, name: pkg.name, version: pkg.version };
      const stack = detectTechStack(bridgingPackage);
      if (stack) {
        rawStackDeps.push({ sourceRepoId: repo.id, stack, pkg: bridgingPackage });
      }
      const key: PackageKey = { system, packageName: pkg.name, packageVersion: pkg.version };
      uniqueKeys.set(packageKeyId(key), key);
    }
  }
  const keys = [...uniqueKeys.values()];

  // ---- 第二步：读缓存并分类；未到期行零外呼 ----
  const mappingRows = await db
    .select({
      system: packageRepoMappings.system,
      packageName: packageRepoMappings.packageName,
      packageVersion: packageRepoMappings.packageVersion,
      sourceRepo: packageRepoMappings.sourceRepo,
      resolutionStatus: packageRepoMappings.resolutionStatus,
      retryAfter: packageRepoMappings.retryAfter,
      lastResolvedRepo: packageRepoMappings.lastResolvedRepo,
    })
    .from(packageRepoMappings);
  const mappingRowByKey = new Map(
    mappingRows.map((row) => [packageKeyId(row), row]),
  );
  const resolvedSourceByKey = new Map<string, string | null>();
  const dueKeys: Array<{ key: PackageKey; previousResolvedRepo: string | null }> = [];
  for (const key of keys) {
    const id = packageKeyId(key);
    const row = mappingRowByKey.get(id);
    const lookup = interpretMappingRow(row, now());
    if (lookup.kind === "hit") {
      resolvedSourceByKey.set(id, lookup.sourceRepo ?? null);
      ctx.counters.cacheHits++;
    } else if (lookup.kind === "due") {
      dueKeys.push({
        key,
        previousResolvedRepo: row?.sourceRepo ?? row?.lastResolvedRepo ?? null,
      });
      ctx.counters.cacheMisses++;
    } else {
      // not_found（长 TTL 内）与 error（retry_after 前）：不外呼，按无映射参与本轮
      resolvedSourceByKey.set(id, null);
      ctx.counters.cacheHits++;
    }
  }

  // ---- 第三步：deps_resolution stage：去重后 bounded pool + 预算 + pacing；
  // 每个结果立即独立写 cache receipt（业务事务之外），预算/限流 fail closed ----
  let depsProcessed = keys.length - dueKeys.length;
  await ctx.emit("deps_resolution", depsProcessed, keys.length);
  await ctx.timeStage("deps_resolution", () => runBoundedPool(
    dueKeys,
    { concurrency: settings.depsConcurrency, pacingMs: settings.pacingMs },
    async ({ key, previousResolvedRepo }) => {
      ctx.budget.tryAcquire("deps.dev");
      ctx.counters.externalRequests++;
      const outcome = await resolveMapping(key.system, key.packageName, key.packageVersion);
      if (outcome.errorSummary === "timeout") ctx.counters.timeouts++;
      if (outcome.status === "error") ctx.counters.retryableErrors++;
      const retryAt = outcome.retryAfterSeconds != null
        ? new Date(now().getTime() + outcome.retryAfterSeconds * 1000)
        : mappingRetryAt(outcome.status, now(), settings);
      await upsertMappingOutcome(db, key, outcome, previousResolvedRepo, retryAt);
      if (outcome.retryAfterSeconds != null) {
        // 429：保留 retry evidence 后立即 fail closed，不再消耗预算
        throw new GraphRateLimitedError("deps.dev", outcome.retryAfterSeconds);
      }
      resolvedSourceByKey.set(
        packageKeyId(key),
        outcome.status === "resolved" ? outcome.sourceRepo : null,
      );
      depsProcessed++;
      await ctx.emit("deps_resolution", depsProcessed, keys.length);
    },
  ));

  const rawDeps: RawDep[] = [];
  for (const repo of collectedRepos) {
    for (const pkg of repo.sbomPackages ?? []) {
      const system = pkg.system ?? "npm";
      const id = packageKeyId({ system, packageName: pkg.name, packageVersion: pkg.version });
      const sourceRepo = resolvedSourceByKey.get(id);
      if (!sourceRepo) continue;
      if (sourceRepo.toLowerCase() === repo.fullName.toLowerCase()) continue;
      rawDeps.push({
        sourceRepoId: repo.id,
        targetFullName: sourceRepo,
        pkg: { system, name: pkg.name, version: pkg.version },
      });
    }
  }

  // ---- 第四步：按 (源仓库, 目标) 聚合，保留全部桥接包 ----
  interface GroupedDep {
    sourceRepoId: number;
    targetFullNameLower: string;
    packages: BridgingPackage[];
  }
  const grouped = new Map<string, GroupedDep>();
  for (const dep of rawDeps) {
    const targetLower = dep.targetFullName.toLowerCase();
    const key = `${dep.sourceRepoId}->${targetLower}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { sourceRepoId: dep.sourceRepoId, targetFullNameLower: targetLower, packages: [] };
      grouped.set(key, entry);
    }
    const pkgKey = `${dep.pkg.system}:${dep.pkg.name}@${dep.pkg.version}`;
    if (!entry.packages.some((p) => `${p.system}:${p.name}@${p.version}` === pkgKey)) {
      entry.packages.push(dep.pkg);
    }
  }

  // ---- 第五步：外部 target 的重命名归一（freshness 持久化，warm rebuild 零外呼）----
  const computeExternalIndegree = (): Map<string, Set<number>> => {
    const indegree = new Map<string, Set<number>>();
    for (const dep of grouped.values()) {
      const inWorkspace = repoByFullName.get(dep.targetFullNameLower);
      // 已采集目标直接连边，不参与基石候选统计
      if (inWorkspace && !inWorkspace.isReference) continue;
      let sources = indegree.get(dep.targetFullNameLower);
      if (!sources) {
        sources = new Set();
        indegree.set(dep.targetFullNameLower, sources);
      }
      sources.add(dep.sourceRepoId);
    }
    return indegree;
  };

  const externalIndegreeByTarget = computeExternalIndegree();
  const eligibleTargets = [...externalIndegreeByTarget.entries()]
    .filter(([, sources]) => sources.size >= CANONICALIZATION_MIN_INDEGREE)
    .map(([target]) => target);

  // deps.dev 可能返回过期 fullName（如 facebook/react），归一后可能与工作区采集行
  // 合并（react/react）；外部 SOURCE_REPO 本身不再生成“基石依赖”节点。
  const renameMap = new Map<string, string>();
  if (opts.canonicalize && eligibleTargets.length > 0) {
    const canonRows = await db
      .select({
        fullName: githubRepoNameCanonicalizations.fullName,
        canonicalFullName: githubRepoNameCanonicalizations.canonicalFullName,
        resolutionStatus: githubRepoNameCanonicalizations.resolutionStatus,
        retryAfter: githubRepoNameCanonicalizations.retryAfter,
      })
      .from(githubRepoNameCanonicalizations);
    const canonRowByFullName = new Map(canonRows.map((row) => [row.fullName, row]));
    const dueTargets: string[] = [];
    for (const target of eligibleTargets) {
      const lookup = interpretCanonicalizationRow(canonRowByFullName.get(target), now());
      if (lookup.kind === "hit") {
        const canonical = (lookup.canonicalFullName ?? "").toLowerCase();
        if (canonical && canonical !== target) renameMap.set(target, canonical);
        ctx.counters.cacheHits++;
      } else if (lookup.kind === "due") {
        dueTargets.push(target);
        ctx.counters.cacheMisses++;
      } else {
        // not_found/error 未到期：保持原名，不外呼
        ctx.counters.cacheHits++;
      }
    }

    let canonProcessed = eligibleTargets.length - dueTargets.length;
    await ctx.emit("github_canonicalization", canonProcessed, eligibleTargets.length);
    const freshOutcomes = new Map<string, CanonicalizationOutcome>();
    await ctx.timeStage("github_canonicalization", () => runBoundedPool(
      dueTargets,
      { concurrency: settings.githubConcurrency, pacingMs: settings.pacingMs },
      async (target) => {
        ctx.budget.tryAcquire("github");
        ctx.counters.externalRequests++;
        const outcome = await opts.canonicalize!(target);
        if (outcome.errorSummary === "timeout") ctx.counters.timeouts++;
        if (outcome.status === "error") ctx.counters.retryableErrors++;
        const retryAt = outcome.retryAfterSeconds != null
          ? new Date(now().getTime() + outcome.retryAfterSeconds * 1000)
          : canonicalizationRetryAt(outcome.status, now(), settings);
        const previousRow = canonRowByFullName.get(target);
        await upsertCanonicalizationOutcome(
          db,
          target,
          outcome,
          retryAt,
          previousRow?.canonicalFullName ?? null,
        );
        if (outcome.retryAfterSeconds != null) {
          throw new GraphRateLimitedError("github", outcome.retryAfterSeconds);
        }
        freshOutcomes.set(target, outcome);
        canonProcessed++;
        await ctx.emit("github_canonicalization", canonProcessed, eligibleTargets.length);
      },
    ));

    // 统一应用缓存命中与新鲜结果；rename 批量、确定性回写映射（只改命名，不改 resolution 状态）
    const appliedRenames: Array<{ from: string; to: string }> = [];
    for (const target of eligibleTargets) {
      const fresh = freshOutcomes.get(target);
      let canonicalOriginal: string | null = null;
      if (fresh?.status === "resolved" && fresh.canonicalFullName) {
        canonicalOriginal = fresh.canonicalFullName;
      } else {
        const lookup = interpretCanonicalizationRow(canonRowByFullName.get(target), now());
        if (lookup.kind === "hit") canonicalOriginal = lookup.canonicalFullName ?? null;
      }
      const canonicalLower = canonicalOriginal?.toLowerCase() ?? null;
      if (canonicalLower && canonicalLower !== target) {
        renameMap.set(target, canonicalLower);
        appliedRenames.push({ from: target, to: canonicalOriginal! });
      }
    }
    appliedRenames.sort((a, b) => a.from.localeCompare(b.from));
    for (const rename of appliedRenames) {
      await rewriteMappingsForRename(db, rename.from, rename.to);
    }
  }
  if (renameMap.size > 0) {
    for (const dep of grouped.values()) {
      const renamed = renameMap.get(dep.targetFullNameLower);
      if (renamed) {
        dep.targetFullNameLower = renamed;
      }
    }
  }

  // ---- 第六步：按 (源仓库, 技术栈) 聚合，生成稳定的技术栈轻量行 ----
  interface GroupedStackDep {
    sourceRepoId: number;
    stack: TechStackNode;
    packages: BridgingPackage[];
  }
  const groupedStacks = new Map<string, GroupedStackDep>();
  for (const dep of rawStackDeps) {
    const key = `${dep.sourceRepoId}->${dep.stack.slug}`;
    let entry = groupedStacks.get(key);
    if (!entry) {
      entry = { sourceRepoId: dep.sourceRepoId, stack: dep.stack, packages: [] };
      groupedStacks.set(key, entry);
    }
    const pkgKey = `${dep.pkg.system}:${dep.pkg.name}@${dep.pkg.version}`;
    if (!entry.packages.some((p) => `${p.system}:${p.name}@${p.version}` === pkgKey)) {
      entry.packages.push(dep.pkg);
    }
  }

  const stackUsage = new Map<string, { stack: TechStackNode; sources: Set<number> }>();
  for (const dep of groupedStacks.values()) {
    let usage = stackUsage.get(dep.stack.slug);
    if (!usage) {
      usage = { stack: dep.stack, sources: new Set() };
      stackUsage.set(dep.stack.slug, usage);
    }
    usage.sources.add(dep.sourceRepoId);
  }
  const selectedStacks = [...stackUsage.values()]
    .sort((a, b) => b.sources.size - a.sources.size || a.stack.name.localeCompare(b.stack.name))
    .slice(0, TECH_STACK_TOP_N);

  // 新表持久化全部 catalog detection；top-N 只影响 legacy/UI projection。
  const stackRelationsByRepository = new Map<number, GroupedStackDep[]>();
  for (const repo of collectedRepos) stackRelationsByRepository.set(repo.id, []);
  for (const dep of groupedStacks.values()) {
    stackRelationsByRepository.get(dep.sourceRepoId)?.push(dep);
  }
  const repositoriesByStableId = [...collectedRepos].sort((left, right) => {
    const leftId = left.githubRepositoryId ?? "";
    const rightId = right.githubRepositoryId ?? "";
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const technologyStackSnapshots = repositoriesByStableId.map((repo) => {
    if (!repo.githubRepositoryId) {
      throw new Error(`Repository ${repo.fullName} 缺少 GitHub stable ID，拒绝写入全局技术栈事实`);
    }
    return {
      repositoryId: repo.id,
      githubRepositoryId: repo.githubRepositoryId,
      expectedVersion: repo.updatedAt,
      expectedSbomPackages: repo.sbomPackages,
      relations: (stackRelationsByRepository.get(repo.id) ?? []).map((relation) => ({
        slug: relation.stack.slug,
        name: relation.stack.name,
        url: relation.stack.url,
        description: `${relation.stack.name} 技术栈`,
        packages: relation.packages,
      })),
    };
  });

  // ---- 第七步：写边——已采集仓库保持直连；技术栈使用目录解析 ----
  // 重命名归一可能把原本不同的目标合并为同一 fullName，
  // 必须按 (source, target) 二次合并，否则违反唯一约束 (source,target,edgeType)
  const edgeByPair = new Map<
    string,
    {
      sourceRepoId: number;
      targetRepoId: number;
      packages: BridgingPackage[];
      resolvedBy: "deps.dev" | "tech-stack-catalog";
    }
  >();

  for (const dep of grouped.values()) {
    const workspace = repoByFullName.get(dep.targetFullNameLower);
    if (!workspace || workspace.isReference) continue;
    const targetRepoId = workspace.id;
    if (targetRepoId === dep.sourceRepoId) continue;

    const pairKey = `${dep.sourceRepoId}:${targetRepoId}`;
    const existing = edgeByPair.get(pairKey);
    if (existing) {
      for (const pkg of dep.packages) {
        const pkgKey = `${pkg.system}:${pkg.name}@${pkg.version}`;
        if (!existing.packages.some((p) => `${p.system}:${p.name}@${p.version}` === pkgKey)) {
          existing.packages.push(pkg);
        }
      }
    } else {
      edgeByPair.set(pairKey, {
        sourceRepoId: dep.sourceRepoId,
        targetRepoId,
        packages: [...dep.packages],
        resolvedBy: "deps.dev",
      });
    }
  }

  // ---- 第八步：lease 复核后事务内全量替换 dependency 边 ----
  await opts.assertLease?.();
  await ctx.emit("atomic_commit", 0, 1);
  await opts.beforeAtomicCommit?.();
  let persistedEdgeCount = 0;
  await ctx.timeStage("atomic_commit", () => db.transaction(async (tx) => {
    // 事务首句带行锁复核租约：窗口内被回收的 lease 在此拒绝提交
    await opts.assertLease?.(tx as unknown as Db);
    const outcome = await replaceRepositoryTechnologyStacksForCurrentSnapshots(
      tx,
      technologyStackSnapshots,
      new Date(),
    );
    if (outcome === "stale") {
      throw new Error("Repository 在图重建期间已更新，拒绝提交旧技术栈事实");
    }

    const referenceIdBySlug = new Map<string, number>();
    for (const { stack } of legacyWriterActive ? selectedStacks : []) {
      const fullName = `tech-stack/${stack.slug}`;
      const [row] = await tx
        .insert(repositories)
        .values({
          fullName,
          name: stack.name,
          owner: "tech-stack",
          url: stack.url,
          description: `${stack.name} 技术栈`,
          isReference: true,
          // 技术栈行不参与向量化；completed 是现有枚举中的“不再处理”哨兵值。
          embeddingStatus: "completed",
        })
        .onConflictDoUpdate({
          target: repositories.fullName,
          set: {
            name: stack.name,
            owner: "tech-stack",
            url: stack.url,
            description: `${stack.name} 技术栈`,
            isReference: true,
            updatedAt: new Date(),
          },
        })
        .returning({ id: repositories.id });
      referenceIdBySlug.set(stack.slug, row.id);
      await tx
        .insert(userWatchedRepositories)
        .values({
          userId,
          repoId: row.id,
          repoFullName: fullName,
          enableDailyReport: false,
        })
        .onConflictDoUpdate({
          target: [userWatchedRepositories.userId, userWatchedRepositories.repoId],
          set: { repoFullName: fullName, updatedAt: new Date() },
        });
    }

    const selectedStackSlugs = new Set(
      (legacyWriterActive ? selectedStacks : []).map(({ stack }) => stack.slug));
    for (const dep of groupedStacks.values()) {
      if (!legacyWriterActive) break;
      if (!selectedStackSlugs.has(dep.stack.slug)) continue;
      const targetRepoId = referenceIdBySlug.get(dep.stack.slug);
      if (targetRepoId === undefined) continue;
      const pairKey = `${dep.sourceRepoId}:${targetRepoId}`;
      const existing = edgeByPair.get(pairKey);
      if (existing) {
        for (const pkg of dep.packages) {
          const pkgKey = `${pkg.system}:${pkg.name}@${pkg.version}`;
          if (!existing.packages.some((p) => `${p.system}:${p.name}@${p.version}` === pkgKey)) {
            existing.packages.push(pkg);
          }
        }
      } else {
        edgeByPair.set(pairKey, {
          sourceRepoId: dep.sourceRepoId,
          targetRepoId,
          packages: [...dep.packages],
          resolvedBy: "tech-stack-catalog",
        });
      }
    }
    const edges = [...edgeByPair.values()];
    persistedEdgeCount = edges.length;
    await tx
      .delete(repoRelationships)
      .where(
        and(
          eq(repoRelationships.userId, userId),
          eq(repoRelationships.edgeType, "dependency"),
          // Phase C P0：new_only 起全量替换收窄到非 legacy 栈边，
          // 冻结的 legacy 栈边（resolvedBy=tech-stack-catalog）不被摧毁
          legacyWriterActive
            ? sql`true`
            : sql`coalesce(${repoRelationships.evidence}->>'resolvedBy', '') <> 'tech-stack-catalog'`,
        ),
      );

    if (edges.length > 0) {
      await tx.insert(repoRelationships).values(
        edges.map((e) => ({
          userId,
          sourceRepoId: e.sourceRepoId,
          targetRepoId: e.targetRepoId,
          edgeType: "dependency" as const,
          score: null,
          evidence: {
            kind: "dependency",
            packages: e.packages,
            resolvedBy: e.resolvedBy,
          },
        })),
      );
    }

    // 先清理当前用户不再使用的 reference 关联，再清理全局无人引用的轻量实体。
    // Phase C：new_only 起 GC 不执行——冻结基线（伪 watch/reference 行）保持到 cleanup。
    if (legacyWriterActive) {
    await tx.execute(sql`
      DELETE FROM user_watched_repositories user_repo
      USING repositories repo
      WHERE user_repo.repo_id = repo.id
        AND user_repo.user_id = ${userId}
        AND repo.is_reference = true
        AND NOT EXISTS (
          SELECT 1 FROM repo_relationships edge
          WHERE edge.user_id = ${userId}
            AND (edge.source_repo_id = repo.id OR edge.target_repo_id = repo.id)
        )
    `);
    await tx.execute(sql`
      DELETE FROM repositories
      WHERE is_reference = true
        AND id NOT IN (SELECT repo_id FROM user_watched_repositories)
        AND id NOT IN (SELECT source_repo_id FROM repo_relationships)
        AND id NOT IN (SELECT target_repo_id FROM repo_relationships)
    `);
    }
  }));
  await ctx.emit("atomic_commit", 1, 1);

  // Phase C：new_only 起观察窗口比较 = 冻结基线单向包含（missing 才 fail）
  if (!legacyWriterActive) {
    const baseline = await compareBaselineToCurrent(db, userId);
    if (!baseline.equal) {
      throw new Error(
        `技术栈冻结基线单向包含失败：missingInNew=${JSON.stringify(baseline.missingInNew)} digestDriftTouched=${baseline.digestDriftTouched}`,
      );
    }
  }

  return persistedEdgeCount;
}

// ============================================================================
// 图查询
// ============================================================================

export interface RepoGraphDataNode {
  id: string;
  kind: "repo" | "reference" | "language" | "technology_stack";
  fullName: string;
  name: string;
  language: string | null;
  stars: number | null;
  description: string | null;
  isReference: boolean;
}

export interface RepoGraphDataEdge {
  source: string;
  target: string;
  type: "similarity" | "dependency" | "written_in";
  score: number | null;
}

export interface RepoGraphData {
  nodes: RepoGraphDataNode[];
  edges: RepoGraphDataEdge[];
}

/**
 * 图谱读取入口：按 TECH_STACK_STORAGE_MODE 分流。
 * - legacy_shadow_dual_write：读 legacy reference 投影（现状）；
 * - new_read_dual_write：读新表投影（真实仓库 + stack:<slug> 节点 + 合成 repo→stack 边）。
 */
export async function getRepoGraphData(db: Db, userId: number): Promise<RepoGraphData> {
  const mode = parseTechnologyStackStorageMode(process.env.TECHNOLOGY_STACK_STORAGE_MODE);
  if (mode === "new_read_dual_write" || mode === "new_only" || mode === "legacy_cleaned") {
    // Phase C：new_only 起读语义统一为新表投影（legacy 读仅兼容期保留）
    return getRepoGraphDataFromNewTables(db, userId);
  }
  return getRepoGraphDataLegacy(db, userId);
}

/**
 * Phase B 新读投影：
 * - 真实仓库 = watched join + 正向条件（githubRepositoryId IS NOT NULL，plan 拍板谓词）；
 * - stack 节点 id=stack:<slug>、kind=technology_stack，top-N 复用 shadow 的
 *   selectTopTechnologyStackSlugs（usage 降序 + name 升序）；
 * - repo→stack 边只从 repository_technology_stacks 合成；
 * - repo→repo 真实边来自 repo_relationships，legacy 技术栈边（resolvedBy=
 *   tech-stack-catalog）投影层排除，避免悬空边与双重计数。
 */
export async function getRepoGraphDataFromNewTables(db: Db, userId: number): Promise<RepoGraphData> {
  const repos = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      name: repositories.name,
      language: repositories.language,
      stars: repositories.stars,
      description: repositories.description,
    })
    .from(repositories)
    .innerJoin(userWatchedRepositories, eq(userWatchedRepositories.repoId, repositories.id))
    .where(and(
      eq(userWatchedRepositories.userId, userId),
      isNotNull(repositories.githubRepositoryId),
    ));

  const nodes: RepoGraphDataNode[] = repos.map((r) => ({
    id: String(r.id),
    kind: "repo",
    fullName: r.fullName,
    name: r.name,
    language: r.language,
    stars: r.stars,
    description: r.description,
    isReference: false,
  }));

  // 语言节点即时合成（与 legacy 一致）
  const languages = new Set<string>();
  for (const r of repos) {
    if (r.language) languages.add(r.language);
  }
  for (const lang of languages) {
    nodes.push({
      id: `lang:${lang}`,
      kind: "language",
      fullName: lang,
      name: lang,
      language: null,
      stars: null,
      description: null,
      isReference: false,
    });
  }

  // stack 事实：经 watched 真实 source 限定（租户边界），聚合 usage 后按 shadow 同款语义选 top-N
  const repoIds = repos.map((r) => r.id);
  const stackRows = repoIds.length > 0
    ? await db
      .select({
        repoId: repositoryTechnologyStacks.repositoryId,
        slug: technologyStacks.slug,
        stackName: technologyStacks.name,
        githubRepositoryId: repositories.githubRepositoryId,
      })
      .from(repositoryTechnologyStacks)
      .innerJoin(technologyStacks, eq(technologyStacks.id, repositoryTechnologyStacks.technologyStackId))
      .innerJoin(repositories, eq(repositories.id, repositoryTechnologyStacks.repositoryId))
      .where(inArray(repositoryTechnologyStacks.repositoryId, repoIds))
    : [];

  const projectionRows: TechnologyStackProjectionRow[] = stackRows.map((row) => ({
    githubRepositoryId: row.githubRepositoryId ?? "",
    slug: row.slug,
    stackName: row.stackName,
    packages: [],
  }));
  const selectedSlugs = selectTopTechnologyStackSlugs(projectionRows, TECH_STACK_TOP_N);

  const emittedStackSlugs = new Set<string>();
  for (const row of stackRows) {
    if (!selectedSlugs.has(row.slug)) continue;
    if (emittedStackSlugs.has(row.slug)) continue;
    emittedStackSlugs.add(row.slug);
    nodes.push({
      id: `stack:${row.slug}`,
      kind: "technology_stack",
      fullName: `tech-stack/${row.slug}`,
      name: row.stackName,
      language: null,
      stars: null,
      description: `${row.stackName} 技术栈`,
      isReference: false,
    });
  }

  const edges: RepoGraphDataEdge[] = [];
  // repo→stack 边只从新表合成（每个 (repo, selected stack) 一条）
  const seenRepoStack = new Set<string>();
  for (const row of stackRows) {
    if (!selectedSlugs.has(row.slug)) continue;
    const key = `${row.repoId}:${row.slug}`;
    if (seenRepoStack.has(key)) continue;
    seenRepoStack.add(key);
    edges.push({
      source: String(row.repoId),
      target: `stack:${row.slug}`,
      type: "dependency",
      score: null,
    });
  }

  // repo→repo 真实边：排除 legacy 技术栈边（悬空边防护）
  const storedEdges = await db
    .select({
      source: repoRelationships.sourceRepoId,
      target: repoRelationships.targetRepoId,
      type: repoRelationships.edgeType,
      score: repoRelationships.score,
      evidence: repoRelationships.evidence,
    })
    .from(repoRelationships)
    .where(eq(repoRelationships.userId, userId));

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  for (const e of storedEdges) {
    const resolvedBy = (e.evidence as { resolvedBy?: string } | null)?.resolvedBy;
    if (resolvedBy === "tech-stack-catalog") continue;
    const edge: RepoGraphDataEdge = {
      source: String(e.source),
      target: String(e.target),
      type: e.type as "similarity" | "dependency",
      score: e.score,
    };
    // 悬空边防护：两端都必须存在于当前投影（legacy 栈边即使未标记也被排除）
    if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
      edges.push(edge);
    }
  }

  // written_in 即时合成
  for (const r of repos) {
    if (r.language) {
      edges.push({
        source: String(r.id),
        target: `lang:${r.language}`,
        type: "written_in",
        score: null,
      });
    }
  }

  return { nodes, edges };
}

async function getRepoGraphDataLegacy(db: Db, userId: number): Promise<RepoGraphData> {
  const repos = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      name: repositories.name,
      language: repositories.language,
      stars: repositories.stars,
      description: repositories.description,
      isReference: repositories.isReference,
    })
    .from(repositories)
    .where(userRepositoryScope(userId));

  const nodes: RepoGraphDataNode[] = repos.map((r) => ({
    id: String(r.id),
    kind: r.isReference ? "reference" : "repo",
    fullName: r.fullName,
    name: r.name,
    language: r.language,
    stars: r.stars,
    description: r.description,
    isReference: r.isReference,
  }));

  // 语言节点即时合成：取采集仓库（非 reference）的去重非空语言
  const languages = new Set<string>();
  for (const r of repos) {
    if (!r.isReference && r.language) languages.add(r.language);
  }
  for (const lang of languages) {
    nodes.push({
      id: `lang:${lang}`,
      kind: "language",
      fullName: lang,
      name: lang,
      language: null,
      stars: null,
      description: null,
      isReference: false,
    });
  }

  const storedEdges = await db
    .select({
      source: repoRelationships.sourceRepoId,
      target: repoRelationships.targetRepoId,
      type: repoRelationships.edgeType,
      score: repoRelationships.score,
    })
    .from(repoRelationships)
    .where(eq(repoRelationships.userId, userId));

  const edges: RepoGraphDataEdge[] = storedEdges.map((e) => ({
    source: String(e.source),
    target: String(e.target),
    type: e.type as "similarity" | "dependency",
    score: e.score,
  }));

  // written_in 边不入库，查询时由采集仓库指向其语言节点
  for (const r of repos) {
    if (!r.isReference && r.language) {
      edges.push({
        source: String(r.id),
        target: `lang:${r.language}`,
        type: "written_in",
        score: null,
      });
    }
  }

  return { nodes, edges };
}

// ============================================================================
// SBOM 回填
// ============================================================================

export interface SbomBackfillOptions {
  /** SBOM 抓取函数（缺省时回填跳过，便于测试与无 token 环境） */
  fetchSbom?: (fullName: string) => Promise<Record<string, unknown> | null>;
  delayMs?: number;
  /** SBOM 阶段的 GitHub 请求计入 attempt 预算与进度 */
  ctx?: GraphRunContext;
  now?: () => Date;
}

/**
 * 为缺失 SBOM 的采集仓库补抓并持久化。
 * 覆盖两类历史数据：sbom_packages 为 null（SBOM 持久化前采集），
 * 以及包元素无 system 字段（多生态解析前的 npm-only 遗留，pypi 等被丢弃）。
 */
export async function backfillSbomPackages(
  db: Db,
  userId: number,
  opts: SbomBackfillOptions = {},
): Promise<number> {
  if (!opts.fetchSbom) return 0;
  const delayMs = opts.delayMs ?? 100;
  const ctx = opts.ctx;

  const rows = await db
    .select({
      id: repositories.id,
      githubRepositoryId: repositories.githubRepositoryId,
      fullName: repositories.fullName,
      updatedAt: repositories.updatedAt,
      sbomPackages: repositories.sbomPackages,
    })
    .from(repositories)
    .where(and(eq(repositories.isReference, false), userRepositoryScope(userId)));

  const missing = rows.filter(
    (r) => r.sbomPackages == null || r.sbomPackages.some((p) => !p.system)
  );

  let filled = 0;
  let completed = 0;
  await ctx?.emit("sbom", completed, missing.length);
  for (const repo of missing) {
    if (!repo.githubRepositoryId) {
      console.warn(`[RepoGraph] SBOM backfill skipped without stable ID: ${repo.fullName}`);
      completed++;
      await ctx?.emit("sbom", completed, missing.length);
      continue;
    }
    // SBOM 请求同样消耗 GitHub 预算：耗尽在图写入前 fail closed
    if (ctx) {
      ctx.budget.tryAcquire("github");
      ctx.counters.externalRequests++;
    }
    try {
      const raw = await opts.fetchSbom(repo.fullName);
      let packages: SbomPackage[];
      if (raw === null) {
        packages = [];
      } else {
        const sbom = raw.sbom;
        if (
          typeof sbom !== "object"
          || sbom === null
          || !Array.isArray((sbom as Record<string, unknown>).packages)
        ) {
          throw new Error("Malformed GitHub SBOM envelope");
        }
        packages = parseSbomPackages(raw);
      }
      const outcome = await applySbomBackfillIfCurrent(db, {
        repoId: repo.id,
        githubRepositoryId: repo.githubRepositoryId,
        expectedVersion: repo.updatedAt,
        baseline: repo.sbomPackages,
        packages,
      });
      if (outcome === "applied") filled++;
    } catch (err) {
      if (ctx) ctx.counters.retryableErrors++;
      console.warn(`[RepoGraph] SBOM backfill failed for ${repo.fullName}:`,
        err instanceof Error ? err.message : err);
    }
    completed++;
    await ctx?.emit("sbom", completed, missing.length);
    await sleep(delayMs);
  }
  if (filled > 0) {
    console.log(`[RepoGraph] SBOM backfill: ${filled}/${missing.length} repos filled`);
  }
  return filled;
}

// ============================================================================
// 全量重建
// ============================================================================

export interface RebuildRepoGraphOptions {
  resolveMapping?: ResolveDepsMappingFn;
  canonicalize?: CanonicalizeFn;
  fetchSbom?: (fullName: string) => Promise<Record<string, unknown> | null>;
  settings?: Partial<ExternalResolutionSettings>;
  budget?: ExternalRequestBudget;
  now?: () => Date;
  progress?: GraphProgressSink;
  assertLease?: () => Promise<void>;
}

export interface RebuildRepoGraphResult {
  similarityEdges: number;
  dependencyEdges: number;
  pooledRepos: number;
  sbomBackfilled: number;
  stages?: GraphStageDuration[];
  budget?: { depsDev: { used: number; limit: number }; github: { used: number; limit: number } };
  /** 供 Worker 在 shadow_compare 等追加 stage 复用累计计数；不进入 API result schema */
  counters?: typeof GraphRunContext.prototype.counters;
}

export async function rebuildRepoGraph(
  db: Db,
  userId: number,
  opts: RebuildRepoGraphOptions = {}
): Promise<RebuildRepoGraphResult> {
  const ctx = resolveRunContext(opts);

  const pooledRepos = await ctx.timeStage("embedding", () =>
    backfillRepoEmbeddings(db, userId, {
      onProgress: (completed, total) => ctx.emit("embedding", completed, total),
    }));
  // SBOM 回填（含外呼）先于任何图写入，预算耗尽时 similarity/dependency 均零写入
  const sbomBackfilled = await ctx.timeStage("sbom", () =>
    backfillSbomPackages(db, userId, {
      fetchSbom: opts.fetchSbom,
      delayMs: ctx.settings.pacingMs,
      ctx,
      now: opts.now,
    }));
  const similarityEdges = await ctx.timeStage("similarity", async () => {
    await ctx.emit("similarity", 0, 1);
    const edges = await recomputeSimilarityEdges(db, userId);
    await ctx.emit("similarity", 1, 1);
    return edges;
  });
  const dependencyEdges = await recomputeDependencyEdges(db, userId, {
      resolveMapping: opts.resolveMapping,
      canonicalize: opts.canonicalize,
      settings: opts.settings,
      budget: ctx.budget,
      now: opts.now,
      progress: opts.progress,
      assertLease: opts.assertLease,
      ctx,
    });

  return {
    similarityEdges,
    dependencyEdges,
    pooledRepos,
    sbomBackfilled,
    stages: [...ctx.stageDurations],
    budget: ctx.budget.snapshot(),
    counters: { ...ctx.counters },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
