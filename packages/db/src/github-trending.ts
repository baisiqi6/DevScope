import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "./index";
import {
  githubTrendingEntries,
  githubTrendingSnapshots,
  type GitHubTrendingEntry,
  type GitHubTrendingSnapshot,
} from "./schema";

export type GitHubTrendingPeriod = "daily" | "weekly" | "monthly";

export interface SaveGitHubTrendingSnapshotInput {
  period: GitHubTrendingPeriod;
  language: string;
  snapshotDate: string;
  sourceUrl: string;
  fetchedAt: Date;
  entries: Array<{
    rank: number;
    fullName: string;
    url: string;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
    starsInPeriod: number;
  }>;
}

export interface GitHubTrendingSnapshotWithEntries {
  snapshot: GitHubTrendingSnapshot;
  entries: GitHubTrendingEntry[];
}

/**
 * 同日、同周期、同语言的重试复用一条 snapshot，并在事务中整体替换 entries。
 * 解析为空时在事务开始前失败，确保上一份成功快照不受影响。
 */
export async function saveGitHubTrendingSnapshot(
  db: Db,
  input: SaveGitHubTrendingSnapshotInput,
): Promise<GitHubTrendingSnapshotWithEntries> {
  validateSnapshotInput(input);
  const language = input.language.trim().toLowerCase() || "all";
  const now = new Date();

  return db.transaction(async (tx) => {
    const [snapshot] = await tx
      .insert(githubTrendingSnapshots)
      .values({
        period: input.period,
        language,
        snapshotDate: input.snapshotDate,
        sourceUrl: input.sourceUrl,
        fetchedAt: input.fetchedAt,
        entryCount: input.entries.length,
      })
      .onConflictDoUpdate({
        target: [
          githubTrendingSnapshots.period,
          githubTrendingSnapshots.language,
          githubTrendingSnapshots.snapshotDate,
        ],
        set: {
          sourceUrl: input.sourceUrl,
          fetchedAt: input.fetchedAt,
          entryCount: input.entries.length,
          updatedAt: now,
        },
      })
      .returning();

    if (!snapshot) {
      throw new Error("GitHub Trending 快照写入失败");
    }

    await tx
      .delete(githubTrendingEntries)
      .where(eq(githubTrendingEntries.snapshotId, snapshot.id));

    const entries = await tx
      .insert(githubTrendingEntries)
      .values(input.entries.map((entry) => ({
        snapshotId: snapshot.id,
        ...entry,
      })))
      .returning();

    return { snapshot, entries };
  });
}

export async function getLatestGitHubTrendingSnapshot(
  db: Db,
  period: GitHubTrendingPeriod,
  language = "all",
): Promise<GitHubTrendingSnapshotWithEntries | null> {
  const normalizedLanguage = language.trim().toLowerCase() || "all";
  const [snapshot] = await db
    .select()
    .from(githubTrendingSnapshots)
    .where(and(
      eq(githubTrendingSnapshots.period, period),
      eq(githubTrendingSnapshots.language, normalizedLanguage),
    ))
    .orderBy(desc(githubTrendingSnapshots.fetchedAt))
    .limit(1);

  if (!snapshot) return null;

  const entries = await db
    .select()
    .from(githubTrendingEntries)
    .where(eq(githubTrendingEntries.snapshotId, snapshot.id))
    .orderBy(asc(githubTrendingEntries.rank));

  return { snapshot, entries };
}

function validateSnapshotInput(input: SaveGitHubTrendingSnapshotInput): void {
  if (input.entries.length === 0) {
    throw new Error("不能保存空的 GitHub Trending 快照");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.snapshotDate)) {
    throw new Error(`无效 Trending 快照日期: ${input.snapshotDate}`);
  }

  const names = new Set<string>();
  input.entries.forEach((entry, index) => {
    if (entry.rank !== index + 1) {
      throw new Error("GitHub Trending 排名必须从 1 连续递增");
    }
    const key = entry.fullName.toLowerCase();
    if (names.has(key)) {
      throw new Error(`GitHub Trending 快照包含重复仓库: ${entry.fullName}`);
    }
    names.add(key);
  });
}
