/**
 * @package @devscope/db
 * @description 数据库操作 - 仓库采集
 *
 * 提供仓库、分块、HackerNews 数据的数据库操作接口。
 *
 * @module collection
 */

import { and, eq, desc, sql, like, or, inArray, isNotNull } from "drizzle-orm";
import { normalizeGitHubRepositoryId } from "@devscope/shared";
import type { Db } from "./index";
import {
  repositories,
  repoChunks,
  hackernewsItems,
  releases,
  userWatchedRepositories,
  type Repository,
  type NewRepository,
  type RepoChunk,
  type NewRepoChunk,
  type HackernewsItem,
  type NewHackernewsItem,
  type NewRelease,
  type Release,
} from "./schema";

type CollectionTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const COLLECTION_ADVISORY_LOCK_NAMESPACE = 0x4453_5643;

export type SourceSnapshot<T> =
  | { status: "success"; items: T[] }
  | { status: "failure"; error: string }
  | { status: "skipped" };

export type SbomSnapshot =
  | { status: "success"; packages: Array<{ name: string; version: string; system?: string }> }
  | { status: "failure"; error: string }
  | { status: "skipped" };

export interface RepositoryCollectionSnapshot {
  repository: Omit<NewRepository, "id" | "createdAt" | "updatedAt" | "sbomPackages">;
  chunks: Omit<NewRepoChunk, "id" | "createdAt" | "repoId">[];
  hackernews: SourceSnapshot<Omit<NewHackernewsItem, "id" | "createdAt" | "repoId">>;
  releases: SourceSnapshot<Omit<NewRelease, "repoId" | "fetchedAt">>;
  sbom: SbomSnapshot;
  allowNewStableIdentity?: boolean;
}

export interface CommittedRepositoryCollection {
  repository: Repository;
  version: Date;
}

export type EmbeddingSnapshotChunk = Pick<
  RepoChunk,
  "content" | "chunkType" | "sourceId" | "chunkIndex" | "tokenCount"
>;

export type EmbeddingClaimResult =
  | { status: "claimed"; chunks: EmbeddingSnapshotChunk[] }
  | { status: "stale" }
  | { status: "not_claimed" };

export type EmbeddingApplyResult =
  | { status: "applied"; completedChunks: number; totalChunks: number }
  | { status: "failed"; completedChunks: number; totalChunks: number; error: string }
  | { status: "stale" }
  | { status: "not_claimed" };

function collectionVersionNow() {
  return sql<Date>`date_trunc('milliseconds', clock_timestamp()::timestamp)`;
}

function nextCollectionVersion() {
  return sql<Date>`GREATEST(
    date_trunc('milliseconds', clock_timestamp()::timestamp),
    date_trunc('milliseconds', ${repositories.updatedAt}) + interval '1 millisecond'
  )`;
}

async function lockRepositoryIdentity(
  tx: CollectionTransaction,
  githubRepositoryId: string,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(
    ${COLLECTION_ADVISORY_LOCK_NAMESPACE}::integer,
    hashtext(${githubRepositoryId})
  )`);
}

async function lockRepositoryRow(
  tx: CollectionTransaction,
  repoId: number,
): Promise<Pick<
  Repository,
  | "id"
  | "githubRepositoryId"
  | "updatedAt"
  | "embeddingStatus"
  | "embeddingProgress"
  | "embeddingTotalChunks"
  | "embeddingCompletedChunks"
> | null> {
  const [repository] = await tx
    .select({
      id: repositories.id,
      githubRepositoryId: repositories.githubRepositoryId,
      updatedAt: repositories.updatedAt,
      embeddingStatus: repositories.embeddingStatus,
      embeddingProgress: repositories.embeddingProgress,
      embeddingTotalChunks: repositories.embeddingTotalChunks,
      embeddingCompletedChunks: repositories.embeddingCompletedChunks,
    })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .for("update");
  return repository ?? null;
}

function sameVersion(actual: Date, expected: Date): boolean {
  return actual.getTime() === expected.getTime();
}

// ============================================================================
// 仓库操作
// ============================================================================

export class RepositoryIdentityConflictError extends Error {
  readonly code = "REPOSITORY_IDENTITY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryIdentityConflictError";
  }
}

export class RepositoryIdentityBackfillRequiredError extends Error {
  readonly code = "REPOSITORY_IDENTITY_BACKFILL_REQUIRED";

  constructor(fullName: string) {
    super(`Repository identity backfill is required before inserting ${fullName}`);
    this.name = "RepositoryIdentityBackfillRequiredError";
  }
}

/**
 * 提交一份完整、已验证的仓库采集快照。
 *
 * 网络读取、schema validation 和文本分块必须在调用前完成；本函数只在一个
 * stable-ID advisory lock 保护的短事务中写 repository 与子快照。
 */
export async function commitRepositoryCollectionSnapshot(
  db: Db,
  input: RepositoryCollectionSnapshot,
): Promise<CommittedRepositoryCollection> {
  if (!input.repository.githubRepositoryId) {
    throw new RepositoryIdentityConflictError("正式仓库采集缺少 GitHub repository ID");
  }
  const githubRepositoryId = normalizeGitHubRepositoryId(input.repository.githubRepositoryId);
  const stableData = { ...input.repository, githubRepositoryId };

  return db.transaction(async (tx) => {
    await lockRepositoryIdentity(tx, githubRepositoryId);

    const matches = await tx
      .select()
      .from(repositories)
      .where(or(
        eq(repositories.githubRepositoryId, githubRepositoryId),
        eq(repositories.fullName, input.repository.fullName),
      ))
      .for("update");
    const idMatch = matches.find((row) => row.githubRepositoryId === githubRepositoryId);
    const nameMatch = matches.find((row) => row.fullName === input.repository.fullName);

    if (idMatch && nameMatch && idMatch.id !== nameMatch.id) {
      throw new RepositoryIdentityConflictError(
        `GitHub repository ID ${githubRepositoryId} 与 fullName ${input.repository.fullName} 分属不同仓库行`,
      );
    }
    if (nameMatch?.githubRepositoryId && nameMatch.githubRepositoryId !== githubRepositoryId) {
      throw new RepositoryIdentityConflictError(
        `fullName ${input.repository.fullName} 已属于 GitHub repository ID ${nameMatch.githubRepositoryId}`,
      );
    }

    const existing = idMatch ?? nameMatch;
    const sbomData = input.sbom.status === "success"
      ? { sbomPackages: input.sbom.packages }
      : {};
    let repository: Repository;

    if (existing) {
      const [updated] = await tx
        .update(repositories)
        .set({
          ...stableData,
          ...sbomData,
          updatedAt: nextCollectionVersion(),
        })
        .where(eq(repositories.id, existing.id))
        .returning();
      if (!updated) {
        throw new Error(`仓库快照 metadata 更新失败: ${input.repository.fullName}`);
      }
      repository = updated;

      if (updated.fullName !== existing.fullName) {
        await tx
          .update(userWatchedRepositories)
          .set({ repoFullName: updated.fullName, updatedAt: new Date() })
          .where(and(
            eq(userWatchedRepositories.repoId, updated.id),
            eq(userWatchedRepositories.repoFullName, existing.fullName),
          ));
      }
    } else {
      if (!input.allowNewStableIdentity) {
        throw new RepositoryIdentityBackfillRequiredError(input.repository.fullName);
      }
      const [inserted] = await tx
        .insert(repositories)
        .values({
          ...stableData,
          ...sbomData,
          updatedAt: collectionVersionNow(),
        })
        .returning();
      if (!inserted) {
        throw new Error(`仓库快照 metadata 写入失败: ${input.repository.fullName}`);
      }
      repository = inserted;
    }

    await tx.delete(repoChunks).where(eq(repoChunks.repoId, repository.id));
    if (input.chunks.length > 0) {
      await tx.insert(repoChunks).values(
        input.chunks.map((chunk) => ({ ...chunk, repoId: repository.id })),
      );
    }

    if (input.hackernews.status === "success") {
      await tx.delete(hackernewsItems).where(eq(hackernewsItems.repoId, repository.id));
      if (input.hackernews.items.length > 0) {
        await tx.insert(hackernewsItems).values(
          input.hackernews.items.map((item) => ({ ...item, repoId: repository.id })),
        );
      }
    }

    if (input.releases.status === "success") {
      await tx.delete(releases).where(eq(releases.repoId, repository.id));
      if (input.releases.items.length > 0) {
        const fetchedAt = new Date();
        await tx.insert(releases).values(
          input.releases.items.map((release) => ({
            ...release,
            repoId: repository.id,
            fetchedAt,
          })),
        );
      }
    }

    const hasChunks = input.chunks.length > 0;
    const [finalRepository] = await tx
      .update(repositories)
      .set({
        embedding: null,
        embeddingStatus: hasChunks ? "pending" : "completed",
        embeddingProgress: hasChunks ? 0 : 100,
        embeddingTotalChunks: input.chunks.length,
        embeddingCompletedChunks: 0,
        embeddingStartedAt: null,
        embeddingCompletedAt: hasChunks ? null : new Date(),
        embeddingError: null,
      })
      .where(eq(repositories.id, repository.id))
      .returning();
    if (!finalRepository) {
      throw new Error(`仓库快照 embedding 初态更新失败: ${input.repository.fullName}`);
    }

    return {
      repository: finalRepository,
      version: finalRepository.updatedAt,
    };
  });
}

async function getRepositoryStableId(db: Db, repoId: number): Promise<string | null> {
  const [repository] = await db
    .select({ githubRepositoryId: repositories.githubRepositoryId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  return repository?.githubRepositoryId ?? null;
}

export async function claimRepositoryEmbeddingSnapshot(
  db: Db,
  repoId: number,
  expectedVersion: Date,
): Promise<EmbeddingClaimResult> {
  const githubRepositoryId = await getRepositoryStableId(db, repoId);
  if (!githubRepositoryId) return { status: "stale" };

  return db.transaction(async (tx) => {
    await lockRepositoryIdentity(tx, githubRepositoryId);
    const repository = await lockRepositoryRow(tx, repoId);
    if (!repository || repository.githubRepositoryId !== githubRepositoryId) {
      return { status: "stale" as const };
    }
    if (!sameVersion(repository.updatedAt, expectedVersion)) {
      return { status: "stale" as const };
    }
    if (repository.embeddingStatus !== "pending") {
      return { status: "not_claimed" as const };
    }

    const chunks = await tx
      .select({
        content: repoChunks.content,
        chunkType: repoChunks.chunkType,
        sourceId: repoChunks.sourceId,
        chunkIndex: repoChunks.chunkIndex,
        tokenCount: repoChunks.tokenCount,
      })
      .from(repoChunks)
      .where(eq(repoChunks.repoId, repoId))
      .orderBy(repoChunks.chunkIndex);

    if (chunks.length === 0) {
      return { status: "not_claimed" as const };
    }

    await tx
      .update(repositories)
      .set({
        embeddingStatus: "processing",
        embeddingProgress: 0,
        embeddingCompletedChunks: 0,
        embeddingTotalChunks: chunks.length,
        embeddingStartedAt: new Date(),
        embeddingCompletedAt: null,
        embeddingError: null,
      })
      .where(and(
        eq(repositories.id, repoId),
        eq(repositories.updatedAt, expectedVersion),
      ));

    return { status: "claimed" as const, chunks };
  });
}

export async function updateEmbeddingProgressForVersion(
  db: Db,
  repoId: number,
  expectedVersion: Date,
  completed: number,
  total: number,
): Promise<boolean> {
  const updated = await db
    .update(repositories)
    .set({
      embeddingStatus: "processing",
      embeddingProgress: total > 0 ? Math.floor((completed / total) * 100) : 0,
      embeddingCompletedChunks: completed,
      embeddingTotalChunks: total,
    })
    .where(and(
      eq(repositories.id, repoId),
      eq(repositories.updatedAt, expectedVersion),
      eq(repositories.embeddingStatus, "processing"),
    ))
    .returning({ id: repositories.id });
  return updated.length === 1;
}

export async function applyRepositoryEmbeddingSnapshot(
  db: Db,
  input: {
    repoId: number;
    expectedVersion: Date;
    chunks: Array<EmbeddingSnapshotChunk & { embedding: number[] | null }>;
    repositoryEmbedding: number[] | null;
    error?: string;
  },
): Promise<EmbeddingApplyResult> {
  const githubRepositoryId = await getRepositoryStableId(db, input.repoId);
  if (!githubRepositoryId) return { status: "stale" };

  return db.transaction(async (tx) => {
    await lockRepositoryIdentity(tx, githubRepositoryId);
    const repository = await lockRepositoryRow(tx, input.repoId);
    if (!repository || repository.githubRepositoryId !== githubRepositoryId) {
      return { status: "stale" as const };
    }
    if (!sameVersion(repository.updatedAt, input.expectedVersion)) {
      return { status: "stale" as const };
    }
    if (repository.embeddingStatus !== "processing") {
      return { status: "not_claimed" as const };
    }

    await tx.delete(repoChunks).where(eq(repoChunks.repoId, input.repoId));
    if (input.chunks.length > 0) {
      await tx.insert(repoChunks).values(
        input.chunks.map((chunk) => ({ ...chunk, repoId: input.repoId })),
      );
    }

    const completedChunks = input.chunks.filter((chunk) => chunk.embedding !== null).length;
    const failed = completedChunks !== input.chunks.length || Boolean(input.error);
    await tx
      .update(repositories)
      .set({
        embedding: input.repositoryEmbedding,
        embeddingStatus: failed ? "failed" : "completed",
        embeddingProgress: input.chunks.length > 0
          ? Math.floor((completedChunks / input.chunks.length) * 100)
          : 100,
        embeddingCompletedChunks: completedChunks,
        embeddingTotalChunks: input.chunks.length,
        embeddingCompletedAt: new Date(),
        embeddingError: failed ? (input.error ?? "部分 chunks 向量化失败") : null,
      })
      .where(and(
        eq(repositories.id, input.repoId),
        eq(repositories.updatedAt, input.expectedVersion),
      ));

    return failed
      ? {
          status: "failed" as const,
          completedChunks,
          totalChunks: input.chunks.length,
          error: input.error ?? "部分 chunks 向量化失败",
        }
      : {
          status: "applied" as const,
          completedChunks,
          totalChunks: input.chunks.length,
        };
  });
}

export async function markEmbeddingFailedForVersion(
  db: Db,
  repoId: number,
  expectedVersion: Date,
  error: string,
): Promise<boolean> {
  const updated = await db
    .update(repositories)
    .set({ embeddingStatus: "failed", embeddingError: error })
    .where(and(
      eq(repositories.id, repoId),
      eq(repositories.updatedAt, expectedVersion),
      eq(repositories.embeddingStatus, "processing"),
    ))
    .returning({ id: repositories.id });
  return updated.length === 1;
}

export async function poolRepositoryEmbeddingForCurrentVersion(
  db: Db,
  repoId: number,
): Promise<"applied" | "cleared" | "not_ready" | "stale"> {
  const githubRepositoryId = await getRepositoryStableId(db, repoId);
  if (!githubRepositoryId) return "stale";

  return db.transaction(async (tx) => {
    await lockRepositoryIdentity(tx, githubRepositoryId);
    const repository = await lockRepositoryRow(tx, repoId);
    if (!repository || repository.githubRepositoryId !== githubRepositoryId) return "stale";
    if (repository.embeddingStatus !== "completed") return "not_ready";

    const [result] = await tx
      .select({
        embedding: sql<number[] | null>`avg(${repoChunks.embedding})`.mapWith(repoChunks.embedding),
      })
      .from(repoChunks)
      .where(and(
        eq(repoChunks.repoId, repoId),
        inArray(repoChunks.chunkType, ["readme", "description"]),
        isNotNull(repoChunks.embedding),
      ));

    await tx
      .update(repositories)
      .set({ embedding: result?.embedding ?? null })
      .where(and(
        eq(repositories.id, repoId),
        eq(repositories.updatedAt, repository.updatedAt),
        eq(repositories.embeddingStatus, "completed"),
      ));
    return result?.embedding ? "applied" : "cleared";
  });
}

export interface EmbeddingReconcileResult {
  status: "completed" | "processing" | "pending" | "failed" | "no_chunks" | "stale";
  totalChunks: number;
  completedChunks: number;
  changed: boolean;
}

export async function reconcileRepositoryEmbeddingStatus(
  db: Db,
  repoId: number,
): Promise<EmbeddingReconcileResult> {
  const githubRepositoryId = await getRepositoryStableId(db, repoId);
  if (!githubRepositoryId) {
    return { status: "stale", totalChunks: 0, completedChunks: 0, changed: false };
  }

  return db.transaction(async (tx) => {
    await lockRepositoryIdentity(tx, githubRepositoryId);
    const repository = await lockRepositoryRow(tx, repoId);
    if (!repository || repository.githubRepositoryId !== githubRepositoryId) {
      return { status: "stale" as const, totalChunks: 0, completedChunks: 0, changed: false };
    }

    // processing 表示已有 worker 持有当前 token 的 claim；failed 是需要显式重试的
    // 终态。chunks 在 final transaction 前仍保留快速采集时的 null embedding，
    // 因此不能用持久化 chunk 计数撤销 claim，或凭空制造无人持有的 processing。
    if (repository.embeddingStatus === "processing" || repository.embeddingStatus === "failed") {
      return {
        status: repository.embeddingStatus,
        totalChunks: repository.embeddingTotalChunks ?? 0,
        completedChunks: repository.embeddingCompletedChunks ?? 0,
        changed: false,
      };
    }

    const [stats] = await tx
      .select({
        totalChunks: sql<number>`count(*)::integer`,
        completedChunks: sql<number>`count(*) FILTER (WHERE ${repoChunks.embedding} IS NOT NULL)::integer`,
      })
      .from(repoChunks)
      .where(eq(repoChunks.repoId, repoId));
    const totalChunks = stats?.totalChunks ?? 0;
    const completedChunks = stats?.completedChunks ?? 0;

    if (totalChunks === 0) {
      const changed = repository.embeddingStatus !== "completed"
        || repository.embeddingProgress !== 100
        || repository.embeddingTotalChunks !== 0
        || repository.embeddingCompletedChunks !== 0;
      if (changed) {
        await tx.update(repositories).set({
          embedding: null,
          embeddingStatus: "completed",
          embeddingProgress: 100,
          embeddingTotalChunks: 0,
          embeddingCompletedChunks: 0,
          embeddingStartedAt: null,
          embeddingCompletedAt: new Date(),
          embeddingError: null,
        }).where(and(
          eq(repositories.id, repoId),
          eq(repositories.updatedAt, repository.updatedAt),
        ));
      }
      return { status: "no_chunks" as const, totalChunks, completedChunks, changed };
    }

    // 没有 claim owner 时，部分历史向量仍保持 pending，由 Scheduler 重新 claim
    // 并整体计算；reconcile 不创建无人持有的 processing 状态。
    const nextStatus = completedChunks === totalChunks ? "completed" as const : "pending" as const;
    const nextProgress = Math.floor((completedChunks / totalChunks) * 100);
    const changed = nextStatus !== repository.embeddingStatus
      || repository.embeddingProgress !== nextProgress
      || repository.embeddingTotalChunks !== totalChunks
      || repository.embeddingCompletedChunks !== completedChunks;
    if (changed) {
      await tx.update(repositories).set({
        embeddingStatus: nextStatus,
        embeddingProgress: nextProgress,
        embeddingTotalChunks: totalChunks,
        embeddingCompletedChunks: completedChunks,
        embeddingCompletedAt: nextStatus === "completed" ? new Date() : null,
        embeddingError: null,
      }).where(and(
        eq(repositories.id, repoId),
        eq(repositories.updatedAt, repository.updatedAt),
      ));
    }
    return { status: nextStatus, totalChunks, completedChunks, changed };
  });
}

function needsSbomBackfill(
  packages: Array<{ name: string; version: string; system?: string }> | null,
): boolean {
  return packages === null || packages.some((pkg) => !pkg.system);
}

export async function applySbomBackfillIfCurrent(
  db: Db,
  input: {
    repoId: number;
    githubRepositoryId: string;
    expectedVersion: Date;
    baseline: Array<{ name: string; version: string; system?: string }> | null;
    packages: Array<{ name: string; version: string; system?: string }>;
  },
): Promise<"applied" | "stale" | "no_op"> {
  return db.transaction(async (tx) => {
    await lockRepositoryIdentity(tx, input.githubRepositoryId);
    const [repository] = await tx
      .select({
        githubRepositoryId: repositories.githubRepositoryId,
        updatedAt: repositories.updatedAt,
        sbomPackages: repositories.sbomPackages,
      })
      .from(repositories)
      .where(eq(repositories.id, input.repoId))
      .for("update");
    if (
      !repository
      || repository.githubRepositoryId !== input.githubRepositoryId
      || !sameVersion(repository.updatedAt, input.expectedVersion)
    ) {
      return "stale";
    }
    if (!needsSbomBackfill(repository.sbomPackages)) return "no_op";

    const updated = await tx
      .update(repositories)
      .set({ sbomPackages: input.packages })
      .where(and(
        eq(repositories.id, input.repoId),
        eq(repositories.updatedAt, input.expectedVersion),
        sql`${repositories.sbomPackages} IS NOT DISTINCT FROM ${JSON.stringify(input.baseline)}::jsonb`,
      ))
      .returning({ id: repositories.id });
    return updated.length === 1 ? "applied" : "no_op";
  });
}

/**
 * 根据 fullName 获取仓库
 */
export async function getRepositoryByFullName(
  db: Db,
  fullName: string
): Promise<Repository | null> {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.fullName, fullName))
    .limit(1);
  return repo || null;
}

/**
 * 获取所有仓库
 */
export async function getAllRepositories(db: Db): Promise<Repository[]> {
  return db.select().from(repositories).orderBy(desc(repositories.stars));
}

/**
 * 删除仓库及其所有关联数据
 */
export async function deleteRepository(db: Db, id: number): Promise<void> {
  await db.delete(repoChunks).where(eq(repoChunks.repoId, id));
  await db.delete(hackernewsItems).where(eq(hackernewsItems.repoId, id));
  await db.delete(repositories).where(eq(repositories.id, id));
}

// ============================================================================
// 仓库分块操作
// ============================================================================

/**
 * 插入仓库分块
 */
export async function insertRepoChunks(
  db: Db,
  chunks: Omit<NewRepoChunk, "id" | "createdAt">[]
): Promise<RepoChunk[]> {
  if (chunks.length === 0) return [];
  return db.insert(repoChunks).values(chunks).returning();
}

/**
 * 根据仓库 ID 获取所有分块
 */
export async function getRepoChunksByRepoId(
  db: Db,
  repoId: number
): Promise<RepoChunk[]> {
  return db
    .select()
    .from(repoChunks)
    .where(eq(repoChunks.repoId, repoId))
    .orderBy(repoChunks.chunkIndex);
}

/**
 * 删除仓库的所有分块
 */
export async function deleteRepoChunksByRepoId(
  db: Db,
  repoId: number
): Promise<void> {
  await db.delete(repoChunks).where(eq(repoChunks.repoId, repoId));
}

/**
 * 语义搜索仓库内容
 *
 * @param db - 数据库实例
 * @param repoId - 仓库 ID
 * @param embedding - 查询向量
 * @param limit - 返回结果数量
 * @returns 相似度排序的分块
 */
export async function semanticSearchRepoChunks(
  db: Db,
  repoId: number,
  embedding: number[],
  limit: number = 5
): Promise<RepoChunk[]> {
  // 使用 pgvector 的 cosine distance 进行相似度搜索
  // 将 embedding 数组转换为向量字面量格式: '[x1,x2,x3,...]'
  const vectorLiteral = `'[${embedding.join(",")}]'`;

  const results = await db
    .select()
    .from(repoChunks)
    .where(eq(repoChunks.repoId, repoId))
    .orderBy(sql`${repoChunks.embedding} <=> ${sql.raw(vectorLiteral)}::vector`)
    .limit(limit);

  return results;
}

// ============================================================================
// Hacker News 操作
// ============================================================================

/**
 * 插入 Hacker News 项目
 */
export async function insertHackernewsItems(
  db: Db,
  items: Omit<NewHackernewsItem, "id" | "createdAt">[]
): Promise<HackernewsItem[]> {
  if (items.length === 0) return [];
  return db.insert(hackernewsItems).values(items).returning();
}

/**
 * 根据仓库 ID 获取 Hacker News 项目
 */
export async function getHackernewsItemsByRepoId(
  db: Db,
  repoId: number
): Promise<HackernewsItem[]> {
  return db
    .select()
    .from(hackernewsItems)
    .where(eq(hackernewsItems.repoId, repoId))
    .orderBy(desc(hackernewsItems.score));
}

/**
 * 搜索 Hacker News 项目
 */
export async function searchHackernewsItems(
  db: Db,
  query: string,
  limit: number = 20
): Promise<HackernewsItem[]> {
  return db
    .select()
    .from(hackernewsItems)
    .where(like(hackernewsItems.title, `%${query}%`))
    .orderBy(desc(hackernewsItems.score))
    .limit(limit);
}

/**
 * 删除仓库的 Hacker News 项目
 */
export async function deleteHackernewsItemsByRepoId(
  db: Db,
  repoId: number
): Promise<void> {
  await db.delete(hackernewsItems).where(eq(hackernewsItems.repoId, repoId));
}

// ============================================================================
// Release 操作
// ============================================================================

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function normalizeGitHubReleaseId(id: number | string | bigint): bigint {
  if (typeof id === "bigint") {
    if (id <= 0n) {
      throw new RangeError("GitHub Release ID must be positive");
    }
    if (id > POSTGRES_BIGINT_MAX) {
      throw new RangeError("GitHub Release ID exceeds PostgreSQL bigint range");
    }
    return id;
  }

  if (typeof id === "number") {
    if (!Number.isSafeInteger(id)) {
      throw new RangeError("GitHub Release ID number must be a safe integer");
    }
    if (id <= 0) {
      throw new RangeError("GitHub Release ID must be positive");
    }
    return BigInt(id);
  }

  if (!/^[1-9]\d*$/.test(id)) {
    throw new TypeError("GitHub Release ID string must be a positive decimal integer");
  }

  const value = BigInt(id);
  if (value > POSTGRES_BIGINT_MAX) {
    throw new RangeError("GitHub Release ID exceeds PostgreSQL bigint range");
  }
  return value;
}

/**
 * 插入 Releases
 */
export async function insertReleases(
  db: Db,
  repoId: number,
  releaseData: Array<{
    id: number | string | bigint;
    tagName: string;
    name: string;
    body: string | null;
    author: string;
    createdAt: Date;
    publishedAt: Date | null;
    url: string;
    htmlUrl: string;
    zipUrl: string | null;
    tarUrl: string | null;
    assets: Array<{
      name: string;
      size: number;
      downloadCount: number;
      url: string;
      browserDownloadUrl: string;
    }>;
    isPrerelease: boolean;
  }>
): Promise<Release[]> {
  if (releaseData.length === 0) return [];

  const values = releaseData.map(r => ({
    id: normalizeGitHubReleaseId(r.id),
    tagName: r.tagName,
    name: r.name,
    body: r.body,
    author: r.author,
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
    url: r.url,
    htmlUrl: r.htmlUrl,
    zipUrl: r.zipUrl,
    tarUrl: r.tarUrl,
    assets: r.assets,
    isPrerelease: r.isPrerelease,
    repoId,
    fetchedAt: new Date(),
  }));

  return db.insert(releases).values(values).returning();
}

/**
 * 获取仓库的 Release 列表
 */
export async function getReleasesByRepoId(
  db: Db,
  repoId: number,
  limit: number = 10
): Promise<Release[]> {
  return db
    .select()
    .from(releases)
    .where(eq(releases.repoId, repoId))
    .orderBy(desc(releases.createdAt))
    .limit(limit);
}

/**
 * 删除仓库的所有 Release
 */
export async function deleteReleasesByRepoId(
  db: Db,
  repoId: number
): Promise<void> {
  await db.delete(releases).where(eq(releases.repoId, repoId));
}

// ============================================================================
// 统计操作
// ============================================================================

/**
 * 获取仓库统计信息
 */
export async function getRepositoryStats(
  db: Db,
  repoId: number
): Promise<{
  chunksCount: number;
  hnItemsCount: number;
}> {
  const [chunksResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(repoChunks)
    .where(eq(repoChunks.repoId, repoId));

  const [hnResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(hackernewsItems)
    .where(eq(hackernewsItems.repoId, repoId));

  return {
    chunksCount: chunksResult?.count || 0,
    hnItemsCount: hnResult?.count || 0,
  };
}
