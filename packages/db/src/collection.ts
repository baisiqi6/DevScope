/**
 * @package @devscope/db
 * @description 数据库操作 - 仓库采集
 *
 * 提供仓库、分块、HackerNews 数据的数据库操作接口。
 *
 * @module collection
 */

import { eq, desc, sql, like } from "drizzle-orm";
import type { Db } from "./index";
import {
  repositories,
  repoChunks,
  hackernewsItems,
  releases,
  type Repository,
  type NewRepository,
  type RepoChunk,
  type NewRepoChunk,
  type HackernewsItem,
  type NewHackernewsItem,
  type Release,
} from "./schema";

// ============================================================================
// 仓库操作
// ============================================================================

/**
 * 创建或更新仓库
 *
 * @param db - 数据库实例
 * @param data - 仓库数据
 * @returns 创建/更新的仓库
 */
export async function upsertRepository(
  db: Db,
  data: Omit<NewRepository, "id" | "createdAt" | "updatedAt">
): Promise<Repository> {
  const existing = await db
    .select()
    .from(repositories)
    .where(eq(repositories.fullName, data.fullName))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(repositories)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(repositories).values(data).returning();
  return created;
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

/**
 * 插入 Releases
 */
export async function insertReleases(
  db: Db,
  repoId: number,
  releaseData: Array<{
    id: number | string;
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
    id: typeof r.id === 'string' ? parseInt(r.id.slice(0, 8), 16) || Math.abs(r.id.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)) : r.id,
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
