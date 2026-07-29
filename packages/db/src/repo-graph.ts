import { eq, and, isNotNull, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
  repositories,
  repoChunks,
  repoRelationships,
  packageRepoMappings,
} from "./schema";

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
  const chunks = await db
    .select({ embedding: repoChunks.embedding })
    .from(repoChunks)
    .where(
      and(
        eq(repoChunks.repoId, repoId),
        inArray(repoChunks.chunkType, POOL_CHUNK_TYPES),
        isNotNull(repoChunks.embedding)
      )
    );

  const validEmbeddings = chunks.filter(
    (c) => c.embedding && c.embedding.length > 0
  );

  if (validEmbeddings.length === 0) {
    await db
      .update(repositories)
      .set({ embedding: null })
      .where(eq(repositories.id, repoId));
    return false;
  }

  const dim = validEmbeddings[0].embedding!.length;
  const sum = new Array(dim).fill(0);
  for (const chunk of validEmbeddings) {
    const emb = chunk.embedding!;
    for (let i = 0; i < dim; i++) {
      sum[i] += emb[i];
    }
  }
  const mean = sum.map((v) => v / validEmbeddings.length);

  await db
    .update(repositories)
    .set({ embedding: mean })
    .where(eq(repositories.id, repoId));

  return true;
}

export async function backfillRepoEmbeddings(db: Db): Promise<number> {
  const repos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.isReference, false));

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
  opts: SimilarityOptions = {}
): Promise<number> {
  const topK = opts.topK ?? 8;
  const minScore = opts.minScore ?? 0.75;

  const reposWithEmbedding = await db
    .select({
      id: repositories.id,
      embedding: repositories.embedding,
    })
    .from(repositories)
    .where(and(eq(repositories.isReference, false), isNotNull(repositories.embedding)));

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
      .where(eq(repoRelationships.edgeType, "similarity"));

    if (edges.length > 0) {
      await tx.insert(repoRelationships).values(
        edges.map((e) => ({
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

/** 基石依赖候选：外部目标被 ≥2 个采集仓库依赖才进入候选 */
const REFERENCE_MIN_INDEGREE = 2;
/** 基石依赖候选按 in-degree 降序封顶 Top N */
const REFERENCE_TOP_N = 30;

interface BridgingPackage {
  system: string;
  name: string;
  version: string;
}

export async function recomputeDependencyEdges(
  db: Db,
  opts: DependencyEdgeOptions = {}
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
    .from(repositories);

  // 只有采集仓库（is_reference=false）的 SBOM 作为依赖解析起点
  const collectedRepos = allRepos.filter((r) => !r.isReference);

  // fullName(小写) -> { id, isReference }，用于判断依赖目标是否已采集
  const repoByFullName = new Map(
    allRepos.map((r) => [r.fullName.toLowerCase(), { id: r.id, isReference: r.isReference }])
  );

  // ---- 第一步：SBOM 包 → 依赖目标（缓存优先的 deps.dev 映射）----
  interface RawDep {
    sourceRepoId: number;
    targetFullName: string;
    pkg: BridgingPackage;
  }
  const rawDeps: RawDep[] = [];

  for (const repo of collectedRepos) {
    const packages = repo.sbomPackages ?? [];
    for (const pkg of packages) {
      // 历史持久化数据无 system 字段，默认按 npm 处理
      const system = pkg.system ?? "npm";
      let sourceRepo: string | null = null;

      const cached = await db
        .select({ sourceRepo: packageRepoMappings.sourceRepo })
        .from(packageRepoMappings)
        .where(
          and(
            eq(packageRepoMappings.system, system),
            eq(packageRepoMappings.packageName, pkg.name),
            eq(packageRepoMappings.packageVersion, pkg.version)
          )
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
            err instanceof Error ? err.message : err
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
        pkg: { system, name: pkg.name, version: pkg.version },
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

  // ---- 第三步：统计外部目标的 in-degree（依赖它的不同采集仓库数）----
  const computeIndegree = (): Map<string, Set<number>> => {
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

  let indegreeByTarget = computeIndegree();

  // ---- 第三点半：对 ≥门槛 的候选做重命名归一（有界，最多几十次 API 调用）----
  // deps.dev 可能返回过期 fullName（如 facebook/react），归一后可能与工作区采集行
  // 合并（react/react）或与其他外部候选合并，需重写目标后重算 in-degree
  if (opts.canonicalize) {
    const renameMap = new Map<string, string>();
    for (const [targetLower] of [...indegreeByTarget.entries()].filter(
      ([, sources]) => sources.size >= REFERENCE_MIN_INDEGREE
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
      indegreeByTarget = computeIndegree();
    }
  }

  // ---- 第四步：in-degree ≥2 的外部目标按 in-degree 降序取 Top N，upsert 基石轻量行 ----
  const candidates = [...indegreeByTarget.entries()]
    .filter(([, sources]) => sources.size >= REFERENCE_MIN_INDEGREE)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, REFERENCE_TOP_N);

  const referenceIdByLower = new Map<string, number>();
  for (const [targetLower] of candidates) {
    // 统一小写写入，避免 deps.dev 返回大小写差异导致重复行
    const fullName = targetLower;
    const slash = fullName.indexOf("/");
    const owner = slash >= 0 ? fullName.slice(0, slash) : fullName;
    const name = slash >= 0 ? fullName.slice(slash + 1) : fullName;
    const [row] = await db
      .insert(repositories)
      .values({
        fullName,
        name,
        owner,
        url: `https://github.com/${fullName}`,
        isReference: true,
        // 基石行不参与向量化。现有枚举没有“不适用”，这里选用终态 "completed"
        // 作为“不再处理”的哨兵值——调度器仅拾取 embeddingStatus='pending'，
        // 因此该状态不会触发任何 embedding 处理。
        embeddingStatus: "completed",
      })
      .onConflictDoUpdate({
        target: repositories.fullName,
        set: { isReference: true, updatedAt: new Date() },
      })
      .returning({ id: repositories.id });
    referenceIdByLower.set(targetLower, row.id);
  }

  // ---- 第五步：写边——目标为采集仓库或入选基石行；in-degree <2 的外部依赖丢弃 ----
  const edges: Array<{
    sourceRepoId: number;
    targetRepoId: number;
    packages: BridgingPackage[];
  }> = [];

  for (const dep of grouped.values()) {
    const workspace = repoByFullName.get(dep.targetFullNameLower);
    let targetRepoId: number | undefined;
    if (workspace && !workspace.isReference) {
      targetRepoId = workspace.id;
    } else {
      targetRepoId = referenceIdByLower.get(dep.targetFullNameLower);
    }
    if (targetRepoId === undefined) continue;
    if (targetRepoId === dep.sourceRepoId) continue;
    edges.push({ sourceRepoId: dep.sourceRepoId, targetRepoId, packages: dep.packages });
  }

  // ---- 第六步：事务内全量替换 dependency 边 ----
  await db.transaction(async (tx) => {
    await tx
      .delete(repoRelationships)
      .where(eq(repoRelationships.edgeType, "dependency"));

    if (edges.length > 0) {
      await tx.insert(repoRelationships).values(
        edges.map((e) => ({
          sourceRepoId: e.sourceRepoId,
          targetRepoId: e.targetRepoId,
          edgeType: "dependency" as const,
          score: null,
          evidence: {
            kind: "dependency",
            packages: e.packages,
            resolvedBy: "deps.dev",
          },
        }))
      );
    }

    // 清理不再被任何边引用的失效基石行（如重命名归一后失去存在意义的旧名行）
    await tx.execute(sql`
      DELETE FROM repositories
      WHERE is_reference = true
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

export async function getRepoGraphData(db: Db): Promise<{
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
    .from(repositories);

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
    .from(repoRelationships);

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
// 全量重建
// ============================================================================

export async function rebuildRepoGraph(
  db: Db,
  opts: { resolveMapping?: ResolveMappingFn; canonicalize?: (fullName: string) => Promise<string> } = {}
): Promise<{ similarityEdges: number; dependencyEdges: number; pooledRepos: number }> {
  const pooledRepos = await backfillRepoEmbeddings(db);
  const similarityEdges = await recomputeSimilarityEdges(db);
  const dependencyEdges = await recomputeDependencyEdges(db, {
    resolveMapping: opts.resolveMapping,
    canonicalize: opts.canonicalize,
  });

  return { similarityEdges, dependencyEdges, pooledRepos };
}

// ============================================================================
// 防抖触发器
// ============================================================================

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 5 * 60 * 1000;

export function scheduleSimilarityRecompute(db: Db): void {
  if (recomputeTimer) {
    clearTimeout(recomputeTimer);
  }
  recomputeTimer = setTimeout(async () => {
    recomputeTimer = null;
    try {
      const count = await recomputeSimilarityEdges(db);
      console.log(`[RepoGraph] Debounced similarity recompute done: ${count} edges`);
    } catch (err) {
      console.error("[RepoGraph] Debounced similarity recompute failed:", err);
    }
  }, DEBOUNCE_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
