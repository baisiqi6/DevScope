import { eq, and, isNotNull, inArray } from "drizzle-orm";
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
}

const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;

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

    if (!EXACT_SEMVER_RE.test(versionInfo)) continue;

    const externalRefs = pkg.externalRefs as Array<Record<string, unknown>> | undefined;
    const isNpm = Array.isArray(externalRefs) && externalRefs.some(
      (ref) => ref.referenceType === "purl" &&
        typeof ref.referenceLocator === "string" &&
        (ref.referenceLocator as string).startsWith("pkg:npm/")
    );
    if (!isNpm) continue;

    const key = `${name}@${versionInfo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, version: versionInfo });
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
    .from(repositories);

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
    .where(isNotNull(repositories.embedding));

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
  delayMs?: number;
}

export async function recomputeDependencyEdges(
  db: Db,
  opts: DependencyEdgeOptions = {}
): Promise<number> {
  const resolveMapping = opts.resolveMapping ?? resolveViaDepsDev;
  const delayMs = opts.delayMs ?? 50;

  const allRepos = await db
    .select({ id: repositories.id, fullName: repositories.fullName, sbomPackages: repositories.sbomPackages })
    .from(repositories);

  const repoByFullName = new Map(allRepos.map((r) => [r.fullName.toLowerCase(), r.id]));
  const workspaceRepoIds = new Set(allRepos.map((r) => r.id));

  // SBOM 包列表在采集时持久化到 repositories.sbomPackages，重启后仍可重建
  const sbomPackagesByRepo = new Map<number, SbomPackage[]>();
  for (const repo of allRepos) {
    if (repo.sbomPackages && repo.sbomPackages.length > 0) {
      sbomPackagesByRepo.set(repo.id, repo.sbomPackages);
    }
  }

  const edges: Array<{
    sourceRepoId: number;
    targetRepoId: number;
    packageName: string;
    packageVersion: string;
  }> = [];

  for (const [repoId, packages] of sbomPackagesByRepo) {
    for (const pkg of packages) {
      let sourceRepo: string | null = null;

      const cached = await db
        .select({ sourceRepo: packageRepoMappings.sourceRepo })
        .from(packageRepoMappings)
        .where(
          and(
            eq(packageRepoMappings.system, "npm"),
            eq(packageRepoMappings.packageName, pkg.name),
            eq(packageRepoMappings.packageVersion, pkg.version)
          )
        )
        .limit(1);

      if (cached.length > 0) {
        sourceRepo = cached[0].sourceRepo;
      } else {
        try {
          sourceRepo = await resolveMapping("npm", pkg.name, pkg.version);
        } catch (err) {
          console.warn(
            `[RepoGraph] deps.dev resolve failed for ${pkg.name}@${pkg.version}:`,
            err instanceof Error ? err.message : err
          );
          sourceRepo = null;
        }

        await db
          .insert(packageRepoMappings)
          .values({
            system: "npm",
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

      const targetRepoId = repoByFullName.get(sourceRepo.toLowerCase());
      if (targetRepoId === undefined) continue;
      if (targetRepoId === repoId) continue;
      if (!workspaceRepoIds.has(targetRepoId)) continue;

      edges.push({
        sourceRepoId: repoId,
        targetRepoId,
        packageName: pkg.name,
        packageVersion: pkg.version,
      });
    }
  }

  const deduped = deduplicateDependencyEdges(edges);

  await db.transaction(async (tx) => {
    await tx
      .delete(repoRelationships)
      .where(eq(repoRelationships.edgeType, "dependency"));

    if (deduped.length > 0) {
      await tx.insert(repoRelationships).values(
        deduped.map((e) => ({
          sourceRepoId: e.sourceRepoId,
          targetRepoId: e.targetRepoId,
          edgeType: "dependency" as const,
          score: null,
          evidence: {
            kind: "dependency",
            system: "npm",
            packageName: e.packageName,
            packageVersion: e.packageVersion,
            resolvedBy: "deps.dev",
          },
        }))
      );
    }
  });

  return deduped.length;
}

function deduplicateDependencyEdges(
  edges: Array<{
    sourceRepoId: number;
    targetRepoId: number;
    packageName: string;
    packageVersion: string;
  }>
) {
  const seen = new Set<string>();
  const result: typeof edges = [];
  for (const e of edges) {
    const key = `${e.sourceRepoId}->${e.targetRepoId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(e);
  }
  return result;
}

// ============================================================================
// 图查询
// ============================================================================

export async function getRepoGraphData(db: Db): Promise<{
  nodes: Array<{
    id: number;
    fullName: string;
    name: string;
    language: string | null;
    stars: number | null;
    description: string | null;
  }>;
  edges: Array<{
    source: number;
    target: number;
    type: "similarity" | "dependency";
    score: number | null;
  }>;
}> {
  const nodes = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      name: repositories.name,
      language: repositories.language,
      stars: repositories.stars,
      description: repositories.description,
    })
    .from(repositories);

  const edges = await db
    .select({
      source: repoRelationships.sourceRepoId,
      target: repoRelationships.targetRepoId,
      type: repoRelationships.edgeType,
      score: repoRelationships.score,
    })
    .from(repoRelationships);

  return {
    nodes,
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type as "similarity" | "dependency",
      score: e.score,
    })),
  };
}

// ============================================================================
// 全量重建
// ============================================================================

export async function rebuildRepoGraph(
  db: Db,
  opts: { resolveMapping?: ResolveMappingFn } = {}
): Promise<{ similarityEdges: number; dependencyEdges: number; pooledRepos: number }> {
  const pooledRepos = await backfillRepoEmbeddings(db);
  const similarityEdges = await recomputeSimilarityEdges(db);
  const dependencyEdges = await recomputeDependencyEdges(db, {
    resolveMapping: opts.resolveMapping,
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
