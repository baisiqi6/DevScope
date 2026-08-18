import { eq, and, isNotNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
  repositories,
  repoRelationships,
  packageRepoMappings,
  userWatchedRepositories,
} from "./schema";
import { detectTechStack, type TechStackNode } from "./tech-stack-catalog";
import {
  applySbomBackfillIfCurrent,
  poolRepositoryEmbeddingForCurrentVersion,
} from "./collection";

export { detectTechStack } from "./tech-stack-catalog";

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

export async function backfillRepoEmbeddings(db: Db, userId: number): Promise<number> {
  const repos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.isReference, false), userRepositoryScope(userId)));

  let pooled = 0;
  for (const repo of repos) {
    const ok = await poolRepoEmbedding(db, repo.id);
    if (ok) pooled++;
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

export type ResolveMappingFn = (
  system: string,
  packageName: string,
  packageVersion: string
) => Promise<string | null>;

export async function resolveViaDepsDev(
  system: string,
  packageName: string,
  packageVersion: string
): Promise<string | null> {
  const encodedName = encodeURIComponent(packageName).replace(/%40/g, "@");
  const url = `https://api.deps.dev/v3/systems/${system}/packages/${encodedName}/versions/${encodeURIComponent(packageVersion)}`;

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    relatedProjects?: Array<{
      relationType: string;
      projectKey: { id: string };
    }>;
  };

  if (!data.relatedProjects) return null;

  const sourceProject = data.relatedProjects.find(
    (p) => p.relationType === "SOURCE_REPO"
  );
  if (!sourceProject) return null;

  const id = sourceProject.projectKey.id;
  const prefix = "github.com/";
  if (!id.startsWith(prefix)) return null;

  return id.slice(prefix.length);
}

export interface DependencyEdgeOptions {
  resolveMapping?: ResolveMappingFn;
  /** 解析 GitHub 重命名后的规范 fullName（缺省为恒等，测试可不传） */
  canonicalize?: (fullName: string) => Promise<string>;
  delayMs?: number;
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
  const resolveMapping = opts.resolveMapping ?? resolveViaDepsDev;
  const delayMs = opts.delayMs ?? 50;

  const allRepos = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
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

  // ---- 第一步：SBOM 包 → 技术栈 + 仓库依赖目标（后者缓存优先走 deps.dev）----
  interface RawDep {
    sourceRepoId: number;
    targetFullName: string;
    pkg: BridgingPackage;
  }
  const rawDeps: RawDep[] = [];
  const rawStackDeps: Array<{ sourceRepoId: number; stack: TechStackNode; pkg: BridgingPackage }> =
    [];

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
      let sourceRepo: string | null = null;

      const cached = await db
        .select({ sourceRepo: packageRepoMappings.sourceRepo })
        .from(packageRepoMappings)
        .where(
          and(
            eq(packageRepoMappings.system, system),
            eq(packageRepoMappings.packageName, pkg.name),
            eq(packageRepoMappings.packageVersion, pkg.version),
          ),
        )
        .limit(1);

      if (cached.length > 0) {
        sourceRepo = cached[0].sourceRepo;
      } else {
        try {
          sourceRepo = await resolveMapping(system, pkg.name, pkg.version);
        } catch (err) {
          console.warn(
            `[RepoGraph] deps.dev resolve failed for ${system}:${pkg.name}@${pkg.version}:`,
            err instanceof Error ? err.message : err,
          );
          sourceRepo = null;
        }

        // 未映射（无 SOURCE_REPO）也写缓存（sourceRepo=null），避免重复打 API
        await db
          .insert(packageRepoMappings)
          .values({
            system,
            packageName: pkg.name,
            packageVersion: pkg.version,
            sourceRepo,
          })
          .onConflictDoUpdate({
            target: [
              packageRepoMappings.system,
              packageRepoMappings.packageName,
              packageRepoMappings.packageVersion,
            ],
            set: { sourceRepo, fetchedAt: new Date() },
          });

        await sleep(delayMs);
      }

      if (!sourceRepo) continue;
      if (sourceRepo.toLowerCase() === repo.fullName.toLowerCase()) continue;

      rawDeps.push({
        sourceRepoId: repo.id,
        targetFullName: sourceRepo,
        pkg: bridgingPackage,
      });
    }
  }

  // ---- 第二步：按 (源仓库, 目标) 聚合，保留全部桥接包 ----
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

  // ---- 第三步：只为“连接到已采集仓库”保留 SOURCE_REPO 解析结果 ----
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

  // 对公共外部目标做重命名归一（有界），用于识别其是否其实是已采集仓库。
  // deps.dev 可能返回过期 fullName（如 facebook/react），归一后可能与工作区采集行
  // 合并（react/react）；外部 SOURCE_REPO 本身不再生成“基石依赖”节点。
  if (opts.canonicalize) {
    const renameMap = new Map<string, string>();
    for (const [targetLower] of [...externalIndegreeByTarget.entries()].filter(
      ([, sources]) => sources.size >= CANONICALIZATION_MIN_INDEGREE,
    )) {
      try {
        const canonical = (await opts.canonicalize(targetLower)).toLowerCase();
        if (canonical && canonical !== targetLower) {
          renameMap.set(targetLower, canonical);
        }
      } catch {
        // 归一失败保持原名，不阻断重算
      }
      await sleep(delayMs);
    }
    if (renameMap.size > 0) {
      for (const dep of grouped.values()) {
        const renamed = renameMap.get(dep.targetFullNameLower);
        if (renamed) {
          dep.targetFullNameLower = renamed;
        }
      }
    }
  }

  // ---- 第四步：按 (源仓库, 技术栈) 聚合，生成稳定的技术栈轻量行 ----
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

  const referenceIdByLower = new Map<string, number>();
  for (const { stack } of selectedStacks) {
    const fullName = `tech-stack/${stack.slug}`;
    const [row] = await db
      .insert(repositories)
      .values({
        fullName,
        name: stack.name,
        owner: "tech-stack",
        url: stack.url,
        description: `${stack.name} 技术栈`,
        isReference: true,
        // 技术栈行不参与向量化。现有枚举没有“不适用”，这里选用终态 "completed"
        // 作为“不再处理”的哨兵值——调度器仅拾取 embeddingStatus='pending'，
        // 因此该状态不会触发任何 embedding 处理。
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
    referenceIdByLower.set(stack.slug, row.id);
    await db
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

  // ---- 第五步：写边——已采集仓库保持直连；技术栈使用目录解析 ----
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

  const selectedStackSlugs = new Set(selectedStacks.map(({ stack }) => stack.slug));
  for (const dep of groupedStacks.values()) {
    if (!selectedStackSlugs.has(dep.stack.slug)) continue;
    const targetRepoId = referenceIdByLower.get(dep.stack.slug);
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

  // ---- 第六步：事务内全量替换 dependency 边 ----
  await db.transaction(async (tx) => {
    await tx
      .delete(repoRelationships)
      .where(
        and(eq(repoRelationships.userId, userId), eq(repoRelationships.edgeType, "dependency")),
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
  });

  return edges.length;
}

// ============================================================================
// 图查询
// ============================================================================

export interface RepoGraphDataNode {
  id: string;
  kind: "repo" | "reference" | "language";
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

export async function getRepoGraphData(db: Db, userId: number): Promise<{
  nodes: RepoGraphDataNode[];
  edges: RepoGraphDataEdge[];
}> {
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
  for (const repo of missing) {
    if (!repo.githubRepositoryId) {
      console.warn(`[RepoGraph] SBOM backfill skipped without stable ID: ${repo.fullName}`);
      continue;
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
      console.warn(`[RepoGraph] SBOM backfill failed for ${repo.fullName}:`,
        err instanceof Error ? err.message : err);
    }
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

export async function rebuildRepoGraph(
  db: Db,
  userId: number,
  opts: {
    resolveMapping?: ResolveMappingFn;
    canonicalize?: (fullName: string) => Promise<string>;
    fetchSbom?: (fullName: string) => Promise<Record<string, unknown> | null>;
  } = {}
): Promise<{ similarityEdges: number; dependencyEdges: number; pooledRepos: number; sbomBackfilled: number }> {
  const pooledRepos = await backfillRepoEmbeddings(db, userId);
  const similarityEdges = await recomputeSimilarityEdges(db, userId);
  const sbomBackfilled = await backfillSbomPackages(db, userId, { fetchSbom: opts.fetchSbom });
  const dependencyEdges = await recomputeDependencyEdges(db, userId, {
    resolveMapping: opts.resolveMapping,
    canonicalize: opts.canonicalize,
  });

  return { similarityEdges, dependencyEdges, pooledRepos, sbomBackfilled };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
