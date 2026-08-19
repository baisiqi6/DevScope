import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./index";
import { lockRepositoryIdentity, type CollectionTransaction } from "./collection";
import {
  TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB,
  technologyStackEntitiesBackfillJobPayloadSchema,
} from "./jobs";
import { detectTechStack, getTechStackBySlug } from "./tech-stack-catalog";
import {
  jobs,
  repositories,
  repoRelationships,
  repositoryTechnologyStacks,
  technologyStacks,
  userWatchedRepositories,
  type Job,
} from "./schema";

export const technologyStackStorageModeSchema = z.enum([
  "legacy_shadow_dual_write",
  "new_read_dual_write",
  "new_only",
  "legacy_cleaned",
]);
export type TechnologyStackStorageMode = z.infer<typeof technologyStackStorageModeSchema>;

export function parseTechnologyStackStorageMode(
  value: string | undefined,
): TechnologyStackStorageMode {
  return technologyStackStorageModeSchema.parse(value ?? "legacy_shadow_dual_write");
}

export function assertTechnologyStackStorageModeSupported(
  mode: TechnologyStackStorageMode,
  supported: readonly TechnologyStackStorageMode[],
): void {
  if (!supported.includes(mode)) {
    throw new Error(`当前 revision 不支持 TECHNOLOGY_STACK_STORAGE_MODE=${mode}`);
  }
}

const technologyStackPackageSchema = z.object({
  system: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
}).strict();

const legacyTechnologyStackEvidenceSchema = z.object({
  kind: z.literal("dependency"),
  resolvedBy: z.literal("tech-stack-catalog"),
  packages: z.array(technologyStackPackageSchema),
}).strict();

export type TechnologyStackPackage = z.infer<typeof technologyStackPackageSchema>;

function packageKey(pkg: TechnologyStackPackage): string {
  return `${pkg.system}\u0000${pkg.name}\u0000${pkg.version}`;
}

export function canonicalizeTechnologyStackPackages(
  packages: TechnologyStackPackage[],
): TechnologyStackPackage[] {
  const byKey = new Map<string, TechnologyStackPackage>();
  for (const pkg of packages) {
    const parsed = technologyStackPackageSchema.parse(pkg);
    byKey.set(packageKey(parsed), parsed);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, pkg]) => pkg);
}

export function parseLegacyTechnologyStackEvidence(evidence: unknown): {
  rawCount: number;
  packages: TechnologyStackPackage[];
} {
  const parsed = legacyTechnologyStackEvidenceSchema.parse(evidence);
  return {
    rawCount: parsed.packages.length,
    packages: canonicalizeTechnologyStackPackages(parsed.packages),
  };
}

export function sameTechnologyStackPackages(
  left: TechnologyStackPackage[],
  right: TechnologyStackPackage[],
): boolean {
  const canonicalLeft = canonicalizeTechnologyStackPackages(left);
  const canonicalRight = canonicalizeTechnologyStackPackages(right);
  return canonicalLeft.length === canonicalRight.length
    && canonicalLeft.every((pkg, index) => packageKey(pkg) === packageKey(canonicalRight[index]));
}

export interface RepositoryTechnologyStackInput {
  slug: string;
  name: string;
  url: string;
  description: string | null;
  packages: TechnologyStackPackage[];
}

export interface RepositoryTechnologyStackSnapshotInput {
  repositoryId: number;
  githubRepositoryId: string;
  expectedVersion: Date;
  expectedSbomPackages: unknown;
  relations: RepositoryTechnologyStackInput[];
}

export type RepositoryTechnologyStackApplyResult = "applied" | "stale";

function sbomBaselineMatches(expectedSbomPackages: unknown) {
  return expectedSbomPackages === null
    ? isNull(repositories.sbomPackages)
    : sql`${repositories.sbomPackages} IS NOT DISTINCT FROM ${JSON.stringify(expectedSbomPackages)}::jsonb`;
}

function collectionVersionMatches(expectedVersion: Date) {
  // PostgreSQL legacy/default timestamps may retain microseconds, while JavaScript Date and
  // the canonical collection token both use milliseconds. Compare at the token's precision.
  const expectedTimestamp = expectedVersion.toISOString().replace("T", " ").replace("Z", "");
  return sql`date_trunc('milliseconds', ${repositories.updatedAt}) = ${expectedTimestamp}::timestamp`;
}

async function replaceRepositoryTechnologyStacks(
  tx: CollectionTransaction,
  repositoryId: number,
  inputRelations: RepositoryTechnologyStackInput[],
  now: Date,
): Promise<void> {
  const stackIds = new Map<string, number>();
  const relations = [...inputRelations]
    .sort((left, right) => left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0);
  for (const relation of relations) {
    const [stack] = await tx
      .insert(technologyStacks)
      .values({
        slug: relation.slug,
        name: relation.name,
        url: relation.url,
        description: relation.description,
      })
      .onConflictDoUpdate({
        target: technologyStacks.slug,
        set: {
          name: relation.name,
          url: relation.url,
          description: relation.description,
          updatedAt: now,
        },
      })
      .returning({ id: technologyStacks.id });
    stackIds.set(relation.slug, stack.id);
  }

  await tx
    .delete(repositoryTechnologyStacks)
    .where(eq(repositoryTechnologyStacks.repositoryId, repositoryId));
  if (relations.length > 0) {
    await tx.insert(repositoryTechnologyStacks).values(relations.map((relation) => ({
      repositoryId,
      technologyStackId: stackIds.get(relation.slug)!,
      packages: canonicalizeTechnologyStackPackages(relation.packages),
      updatedAt: now,
    })));
  }
}

/**
 * 单个 source repository 是全局技术栈事实的唯一替换范围。
 * 网络与 catalog detection 必须在事务外完成；事务内只验证快照并整体替换。
 */
export async function applyRepositoryTechnologyStacksIfCurrent(
  db: Db,
  input: RepositoryTechnologyStackSnapshotInput,
): Promise<RepositoryTechnologyStackApplyResult> {
  return db.transaction(async (tx) => {
    return replaceRepositoryTechnologyStacksForCurrentSnapshots(tx, [input], new Date());
  });
}

/**
 * 在调用方事务内全序锁定并复核全部 source snapshot，再逐 source 替换新表事实。
 * 调用方可在同一事务继续写 legacy projection，从而保证 dual-write 只有一个 commit point。
 */
export async function replaceRepositoryTechnologyStacksForCurrentSnapshots(
  tx: CollectionTransaction,
  inputs: RepositoryTechnologyStackSnapshotInput[],
  now: Date,
): Promise<RepositoryTechnologyStackApplyResult> {
  const ordered = [...inputs].sort((left, right) =>
    left.githubRepositoryId.localeCompare(right.githubRepositoryId),
  );
  for (const input of ordered) {
    await lockRepositoryIdentity(tx, input.githubRepositoryId);
  }
  for (const input of ordered) {
    const [repository] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(
        eq(repositories.id, input.repositoryId),
        eq(repositories.githubRepositoryId, input.githubRepositoryId),
        collectionVersionMatches(input.expectedVersion),
        sbomBaselineMatches(input.expectedSbomPackages),
      ))
      .for("update");
    if (!repository) return "stale";
  }
  for (const input of ordered) {
    await replaceRepositoryTechnologyStacks(tx, input.repositoryId, input.relations, now);
  }
  return "applied";
}

export interface TechnologyStackBackfillSource {
  repositoryId: number;
  githubRepositoryId: string;
  fullName: string;
  expectedVersion: Date;
  expectedSbomPackages: unknown;
  relations: RepositoryTechnologyStackInput[];
  evidenceAudit: Array<{
    slug: string;
    legacyCopies: number;
    rawPackages: number;
    canonicalPackages: number;
    resolvedBy: "sbom_catalog" | "identical_legacy";
    orderedDigest: string;
  }>;
  legacyEvidenceDigest: string;
  digest: string;
}

export interface TechnologyStackBackfillPlan {
  digest: string;
  sources: TechnologyStackBackfillSource[];
}

const technologyStackBackfillReceiptSchema = z.object({
  githubRepositoryId: z.string().regex(/^[1-9]\d*$/),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  relations: z.number().int().nonnegative(),
  evidenceAudit: z.array(z.object({
    slug: z.string(),
    legacyCopies: z.number().int().nonnegative(),
    rawPackages: z.number().int().nonnegative(),
    canonicalPackages: z.number().int().nonnegative(),
    resolvedBy: z.enum(["sbom_catalog", "identical_legacy"]),
    orderedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })),
});

export const technologyStackEntitiesBackfillJobResultSchema = z.object({
  outcome: z.enum(["running", "succeeded"]),
  version: z.string(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  totalSources: z.number().int().nonnegative(),
  processedSources: z.number().int().nonnegative(),
  lastGithubRepositoryId: z.string().regex(/^[1-9]\d*$/).nullable(),
  receipts: z.array(technologyStackBackfillReceiptSchema),
});

export class TechnologyStackBackfillLeaseLostError extends Error {
  constructor(jobId: number) {
    super(`Technology stack backfill job ${jobId} 已失去有效租约`);
    this.name = "TechnologyStackBackfillLeaseLostError";
  }
}

export class TechnologyStackBackfillStaleError extends Error {
  constructor(fullName: string) {
    super(`Repository ${fullName} 在技术栈回填期间已更新`);
    this.name = "TechnologyStackBackfillStaleError";
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function legacyStackSlug(fullName: string): string {
  const match = /^tech-stack\/([a-z0-9-]+)$/.exec(fullName);
  if (!match || !getTechStackBySlug(match[1])) {
    throw new Error(`非法 legacy 技术栈目标: ${fullName}`);
  }
  return match[1];
}

interface LegacyEvidenceBaselineRow {
  userId: number;
  sourceRepositoryId: number;
  targetFullName: string;
  evidence: unknown;
}

function legacyEvidenceBaselineDigest(rows: LegacyEvidenceBaselineRow[]): string {
  return digest(rows.map((row) => ({
    userId: row.userId,
    slug: legacyStackSlug(row.targetFullName),
    ...parseLegacyTechnologyStackEvidence(row.evidence),
  })).sort((left, right) =>
    left.userId - right.userId || left.slug.localeCompare(right.slug),
  ));
}

async function readLegacyEvidenceBaseline(
  tx: CollectionTransaction,
  sourceRepositoryId: number,
): Promise<LegacyEvidenceBaselineRow[]> {
  const target = alias(repositories, "backfill_stack_repository");
  return tx.select({
    userId: repoRelationships.userId,
    sourceRepositoryId: repoRelationships.sourceRepoId,
    targetFullName: target.fullName,
    evidence: repoRelationships.evidence,
  })
    .from(repoRelationships)
    .innerJoin(target, eq(repoRelationships.targetRepoId, target.id))
    .where(and(
      eq(repoRelationships.sourceRepoId, sourceRepositoryId),
      eq(repoRelationships.edgeType, "dependency"),
      eq(target.isReference, true),
      like(target.fullName, "tech-stack/%"),
    ));
}

function detectRelationsFromSbom(
  sbomPackages: Array<{ name: string; version: string; system?: string }>,
): RepositoryTechnologyStackInput[] {
  const grouped = new Map<string, RepositoryTechnologyStackInput>();
  for (const stored of sbomPackages) {
    const pkg = technologyStackPackageSchema.parse({
      system: stored.system ?? "npm",
      name: stored.name,
      version: stored.version,
    });
    const stack = detectTechStack(pkg);
    if (!stack) continue;
    const relation = grouped.get(stack.slug) ?? {
      ...stack,
      description: `${stack.name} 技术栈`,
      packages: [],
    };
    relation.packages.push(pkg);
    grouped.set(stack.slug, relation);
  }
  return [...grouped.values()]
    .map((relation) => ({
      ...relation,
      packages: canonicalizeTechnologyStackPackages(relation.packages),
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

/** 只读 prepare：严格验证全部 legacy evidence，不产生业务写入。 */
export async function prepareTechnologyStackEntitiesBackfill(
  db: Db,
): Promise<TechnologyStackBackfillPlan> {
  const stackRepository = alias(repositories, "stack_repository");
  const [repositoryRows, legacyRows] = await Promise.all([
    db.select({
      id: repositories.id,
      githubRepositoryId: repositories.githubRepositoryId,
      fullName: repositories.fullName,
      updatedAt: repositories.updatedAt,
      sbomPackages: repositories.sbomPackages,
    })
      .from(repositories)
      .where(eq(repositories.isReference, false)),
    db.select({
      userId: repoRelationships.userId,
      sourceRepositoryId: repositories.id,
      sourceIsReference: repositories.isReference,
      targetFullName: stackRepository.fullName,
      evidence: repoRelationships.evidence,
    })
      .from(repoRelationships)
      .innerJoin(repositories, eq(repoRelationships.sourceRepoId, repositories.id))
      .innerJoin(stackRepository, eq(repoRelationships.targetRepoId, stackRepository.id))
      .where(and(
        eq(repoRelationships.edgeType, "dependency"),
        eq(stackRepository.isReference, true),
        like(stackRepository.fullName, "tech-stack/%"),
      )),
  ]);

  const legacyBySourceAndSlug = new Map<string, Array<{
    rawCount: number;
    packages: TechnologyStackPackage[];
  }>>();
  for (const row of legacyRows) {
    if (row.sourceIsReference) {
      throw new Error(`Legacy 技术栈边的 source ${row.sourceRepositoryId} 不是实际仓库`);
    }
    const slug = legacyStackSlug(row.targetFullName);
    const parsed = parseLegacyTechnologyStackEvidence(row.evidence);
    const key = `${row.sourceRepositoryId}:${slug}`;
    const copies = legacyBySourceAndSlug.get(key) ?? [];
    copies.push(parsed);
    legacyBySourceAndSlug.set(key, copies);
  }

  const sources = repositoryRows.map((repository) => {
    if (!repository.githubRepositoryId) {
      throw new Error(`Repository ${repository.fullName} 缺少 GitHub stable ID`);
    }
    let relations: RepositoryTechnologyStackInput[];
    if (repository.sbomPackages !== null) {
      relations = detectRelationsFromSbom(repository.sbomPackages);
    } else {
      relations = [];
      for (const [key, copies] of legacyBySourceAndSlug) {
        if (!key.startsWith(`${repository.id}:`)) continue;
        const slug = key.slice(String(repository.id).length + 1);
        if (!copies.every((copy) => sameTechnologyStackPackages(copy.packages, copies[0].packages))) {
          throw new Error(`Repository ${repository.fullName} 的 legacy ${slug} evidence 不一致且无 SBOM 可裁决`);
        }
        const stack = getTechStackBySlug(slug)!;
        relations.push({
          ...stack,
          description: `${stack.name} 技术栈`,
          packages: copies[0].packages,
        });
      }
      relations.sort((left, right) => left.slug.localeCompare(right.slug));
    }
    const relationBySlug = new Map(relations.map((relation) => [relation.slug, relation]));
    const legacyForSource = [...legacyBySourceAndSlug.entries()]
      .filter(([key]) => key.startsWith(`${repository.id}:`));
    const auditSlugs = new Set([
      ...relations.map((relation) => relation.slug),
      ...legacyForSource.map(([key]) => key.slice(String(repository.id).length + 1)),
    ]);
    const evidenceAudit = [...auditSlugs].sort().map((slug) => {
      const copies = legacyBySourceAndSlug.get(`${repository.id}:${slug}`) ?? [];
      const relationPackages = relationBySlug.get(slug)?.packages ?? [];
      return {
        slug,
        legacyCopies: copies.length,
        rawPackages: copies.reduce((total, copy) => total + copy.rawCount, 0),
        canonicalPackages: canonicalizeTechnologyStackPackages(
          copies.flatMap((copy) => copy.packages),
        ).length,
        resolvedBy: repository.sbomPackages !== null
          ? "sbom_catalog" as const
          : "identical_legacy" as const,
        orderedDigest: digest({
          copies: copies.map((copy) => copy.packages),
          selected: canonicalizeTechnologyStackPackages(relationPackages),
        }),
      };
    });
    const legacyEvidenceDigest = legacyEvidenceBaselineDigest(
      legacyRows.filter((row) => row.sourceRepositoryId === repository.id),
    );
    const digestInput = {
      githubRepositoryId: repository.githubRepositoryId,
      expectedVersion: repository.updatedAt.toISOString(),
      expectedSbomPackages: repository.sbomPackages,
      relations,
      evidenceAudit,
      legacyEvidenceDigest,
    };
    return {
      repositoryId: repository.id,
      githubRepositoryId: repository.githubRepositoryId,
      fullName: repository.fullName,
      expectedVersion: repository.updatedAt,
      expectedSbomPackages: repository.sbomPackages,
      relations,
      evidenceAudit,
      legacyEvidenceDigest,
      digest: digest(digestInput),
    };
  }).sort((left, right) => left.githubRepositoryId.localeCompare(right.githubRepositoryId));

  return {
    digest: digest(sources.map((source) => ({
      githubRepositoryId: source.githubRepositoryId,
      digest: source.digest,
    }))),
    sources,
  };
}

export async function applyTechnologyStackBackfillSource(
  db: Db,
  jobId: number,
  workerId: string,
  version: string,
  plan: TechnologyStackBackfillPlan,
  source: TechnologyStackBackfillSource,
  now: () => Date = () => new Date(),
): Promise<"applied" | "already_applied" | "stale"> {
  return db.transaction(async (tx) => {
    // 先等待 repository writer lock，不在等待期间阻塞 heartbeat 的 job row update。
    await lockRepositoryIdentity(tx, source.githubRepositoryId);
    const authorizedAt = now();
    const [job] = await tx.select().from(jobs).where(and(
      eq(jobs.id, jobId),
      eq(jobs.type, TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB),
      eq(jobs.status, "running"),
      eq(jobs.leaseOwner, workerId),
      gt(jobs.leaseExpiresAt, authorizedAt),
    )).limit(1).for("update");
    if (!job) throw new TechnologyStackBackfillLeaseLostError(jobId);
    const payload = technologyStackEntitiesBackfillJobPayloadSchema.parse(job.payload);
    if (payload.version !== version) throw new Error("Technology stack backfill version mismatch");

    const existing = job.result
      ? technologyStackEntitiesBackfillJobResultSchema.parse(job.result)
      : null;
    if (existing && existing.planDigest !== plan.digest) {
      throw new Error("Technology stack backfill plan changed after checkpoint");
    }
    if (existing && existing.receipts.some(
      (receipt) => receipt.githubRepositoryId === source.githubRepositoryId
        && receipt.sourceDigest === source.digest,
    )) return "already_applied";

    const processedSources = existing?.processedSources ?? 0;
    if (plan.sources[processedSources]?.githubRepositoryId !== source.githubRepositoryId) {
      throw new Error("Technology stack backfill source is out of checkpoint order");
    }

    const [repository] = await tx.select({ id: repositories.id }).from(repositories).where(and(
      eq(repositories.id, source.repositoryId),
      eq(repositories.githubRepositoryId, source.githubRepositoryId),
      collectionVersionMatches(source.expectedVersion),
      sbomBaselineMatches(source.expectedSbomPackages),
    )).for("update");
    if (!repository) return "stale";
    if (source.expectedSbomPackages === null) {
      const currentLegacyEvidenceDigest = legacyEvidenceBaselineDigest(
        await readLegacyEvidenceBaseline(tx, source.repositoryId),
      );
      if (currentLegacyEvidenceDigest !== source.legacyEvidenceDigest) return "stale";
    }

    await replaceRepositoryTechnologyStacks(tx, source.repositoryId, source.relations, authorizedAt);
    const receipts = [
      ...(existing?.receipts ?? []),
      {
        githubRepositoryId: source.githubRepositoryId,
        sourceDigest: source.digest,
        relations: source.relations.length,
        evidenceAudit: source.evidenceAudit,
      },
    ];
    const completed = receipts.length === plan.sources.length;
    const finalizedAt = now();
    const result = technologyStackEntitiesBackfillJobResultSchema.parse({
      outcome: completed ? "succeeded" : "running",
      version,
      planDigest: plan.digest,
      totalSources: plan.sources.length,
      processedSources: receipts.length,
      lastGithubRepositoryId: source.githubRepositoryId,
      receipts,
    });
    const [updated] = await tx.update(jobs).set({
      status: completed ? "succeeded" : "running",
      result,
      leaseOwner: completed ? null : workerId,
      leaseExpiresAt: completed ? null : job.leaseExpiresAt,
      lastError: null,
      completedAt: completed ? finalizedAt : null,
      updatedAt: finalizedAt,
    }).where(and(
      eq(jobs.id, jobId),
      eq(jobs.status, "running"),
      eq(jobs.leaseOwner, workerId),
      gt(jobs.leaseExpiresAt, finalizedAt),
    )).returning({ id: jobs.id });
    if (!updated) throw new TechnologyStackBackfillLeaseLostError(jobId);
    return "applied";
  });
}

export async function executeTechnologyStackEntitiesBackfill(
  db: Db,
  job: Job,
  workerId: string,
  now: () => Date = () => new Date(),
): Promise<Record<string, unknown>> {
  const payload = technologyStackEntitiesBackfillJobPayloadSchema.parse(job.payload);
  const plan = await prepareTechnologyStackEntitiesBackfill(db);
  if (plan.sources.length === 0) {
    return db.transaction(async (tx) => {
      const authorizedAt = now();
      const [current] = await tx.select().from(jobs).where(and(
        eq(jobs.id, job.id),
        eq(jobs.type, TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB),
        eq(jobs.status, "running"),
        eq(jobs.leaseOwner, workerId),
        gt(jobs.leaseExpiresAt, authorizedAt),
      )).limit(1).for("update");
      if (!current) throw new TechnologyStackBackfillLeaseLostError(job.id);
      const result = technologyStackEntitiesBackfillJobResultSchema.parse({
        outcome: "succeeded",
        version: payload.version,
        planDigest: plan.digest,
        totalSources: 0,
        processedSources: 0,
        lastGithubRepositoryId: null,
        receipts: [],
      });
      const finalizedAt = now();
      const [completed] = await tx.update(jobs).set({
        status: "succeeded",
        result,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        completedAt: finalizedAt,
        updatedAt: finalizedAt,
      }).where(and(
        eq(jobs.id, job.id),
        eq(jobs.status, "running"),
        eq(jobs.leaseOwner, workerId),
        gt(jobs.leaseExpiresAt, finalizedAt),
      )).returning();
      if (!completed) throw new TechnologyStackBackfillLeaseLostError(job.id);
      return result;
    });
  }
  for (const source of plan.sources) {
    const outcome = await applyTechnologyStackBackfillSource(
      db, job.id, workerId, payload.version, plan, source, now,
    );
    if (outcome === "stale") throw new TechnologyStackBackfillStaleError(source.fullName);
  }
  return technologyStackEntitiesBackfillJobResultSchema.parse({
    outcome: "succeeded",
    version: payload.version,
    planDigest: plan.digest,
    totalSources: plan.sources.length,
    processedSources: plan.sources.length,
    lastGithubRepositoryId: plan.sources.at(-1)!.githubRepositoryId,
    receipts: plan.sources.map((source) => ({
      githubRepositoryId: source.githubRepositoryId,
      sourceDigest: source.digest,
      relations: source.relations.length,
      evidenceAudit: source.evidenceAudit,
    })),
  });
}

export interface TechnologyStackProjectionRow {
  githubRepositoryId: string;
  slug: string;
  stackName: string;
  packages: TechnologyStackPackage[];
}

export interface TechnologyStackShadowComparison {
  equal: boolean;
  legacyCount: number;
  newCount: number;
  missingInNew: string[];
  missingInLegacy: string[];
}

/**
 * top-N 技术栈选择语义的唯一实现：按使用仓库数降序、stack name 升序 tie-break。
 * shadow compare 与 new 读投影必须复用本函数，保证零差异时 UI 输出一致。
 */
export function selectTopTechnologyStackSlugs(
  rows: TechnologyStackProjectionRow[],
  topN: number,
): Set<string> {
  const usage = new Map<string, { name: string; sources: Set<string> }>();
  for (const row of rows) {
    const entry = usage.get(row.slug) ?? { name: row.stackName, sources: new Set<string>() };
    entry.sources.add(row.githubRepositoryId);
    usage.set(row.slug, entry);
  }
  return new Set([...usage.entries()]
    .sort(([, left], [, right]) =>
      right.sources.size - left.sources.size || left.name.localeCompare(right.name),
    )
    .slice(0, topN)
    .map(([slug]) => slug));
}

function projectionKeys(rows: TechnologyStackProjectionRow[], topN: number): string[] {
  const selected = selectTopTechnologyStackSlugs(rows, topN);
  return rows
    .filter((row) => selected.has(row.slug))
    .map((row) => `${row.githubRepositoryId}|${row.slug}|${digest(
      canonicalizeTechnologyStackPackages(row.packages),
    )}`)
    .sort();
}

export function compareTechnologyStackProjectionRows(
  legacyRows: TechnologyStackProjectionRow[],
  newRows: TechnologyStackProjectionRow[],
  topN = 30,
): TechnologyStackShadowComparison {
  const legacy = projectionKeys(legacyRows, topN);
  const current = projectionKeys(newRows, topN);
  const legacySet = new Set(legacy);
  const currentSet = new Set(current);
  const missingInNew = legacy.filter((key) => !currentSet.has(key));
  const missingInLegacy = current.filter((key) => !legacySet.has(key));
  return {
    equal: missingInNew.length === 0 && missingInLegacy.length === 0,
    legacyCount: legacy.length,
    newCount: current.length,
    missingInNew,
    missingInLegacy,
  };
}

/** 按当前用户 watched real repositories 对 legacy/new top-N 投影做有序语义比较。 */
export async function compareTechnologyStackProjection(
  db: Db,
  userId: number,
): Promise<TechnologyStackShadowComparison> {
  const stackRepository = alias(repositories, "shadow_stack_repository");
  const [legacyRaw, currentRaw] = await Promise.all([
    db.select({
      githubRepositoryId: repositories.githubRepositoryId,
      targetFullName: stackRepository.fullName,
      stackName: stackRepository.name,
      evidence: repoRelationships.evidence,
    })
      .from(repoRelationships)
      .innerJoin(repositories, eq(repoRelationships.sourceRepoId, repositories.id))
      .innerJoin(stackRepository, eq(repoRelationships.targetRepoId, stackRepository.id))
      .where(and(
        eq(repoRelationships.userId, userId),
        eq(repoRelationships.edgeType, "dependency"),
        eq(repositories.isReference, false),
        eq(stackRepository.isReference, true),
        like(stackRepository.fullName, "tech-stack/%"),
      )),
    db.select({
      githubRepositoryId: repositories.githubRepositoryId,
      slug: technologyStacks.slug,
      stackName: technologyStacks.name,
      packages: repositoryTechnologyStacks.packages,
    })
      .from(repositoryTechnologyStacks)
      .innerJoin(repositories, eq(repositoryTechnologyStacks.repositoryId, repositories.id))
      .innerJoin(technologyStacks, eq(
        repositoryTechnologyStacks.technologyStackId,
        technologyStacks.id,
      ))
      .innerJoin(userWatchedRepositories, and(
        eq(userWatchedRepositories.repoId, repositories.id),
        eq(userWatchedRepositories.userId, userId),
      ))
      .where(eq(repositories.isReference, false)),
  ]);

  const legacyRows = legacyRaw.map((row) => {
    if (!row.githubRepositoryId) throw new Error("Legacy shadow source 缺少 GitHub stable ID");
    return {
      githubRepositoryId: row.githubRepositoryId,
      slug: legacyStackSlug(row.targetFullName),
      stackName: row.stackName,
      packages: parseLegacyTechnologyStackEvidence(row.evidence).packages,
    };
  });
  const currentRows = currentRaw.map((row) => {
    if (!row.githubRepositoryId) throw new Error("New shadow source 缺少 GitHub stable ID");
    return {
      githubRepositoryId: row.githubRepositoryId,
      slug: row.slug,
      stackName: row.stackName,
      packages: z.array(technologyStackPackageSchema).parse(row.packages),
    };
  });
  return compareTechnologyStackProjectionRows(legacyRows, currentRows);
}
