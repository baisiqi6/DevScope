import {
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const githubTrendingPeriodEnum = pgEnum("github_trending_period", [
  "daily",
  "weekly",
  "monthly",
]);

/** GitHub 官方 Trending 的成功采集快照；不承载用户偏好或候选状态。 */
export const githubTrendingSnapshots = pgTable("github_trending_snapshots", {
  id: serial("id").primaryKey(),
  period: githubTrendingPeriodEnum("period").notNull(),
  /** GitHub Trending URL 的语言 slug；第一版只调度 all。 */
  language: text("language").default("all").notNull(),
  /** 调度日期 YYYY-MM-DD，用于同日重试幂等。 */
  snapshotDate: text("snapshot_date").notNull(),
  sourceUrl: text("source_url").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  entryCount: integer("entry_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  periodLanguageDateUnique: uniqueIndex("github_trending_snapshots_period_language_date_unique").on(
    table.period,
    table.language,
    table.snapshotDate,
  ),
  latestIdx: index("github_trending_snapshots_latest_idx").on(
    table.period,
    table.language,
    table.fetchedAt,
  ),
}));

/** 单份 Trending 快照中的有序仓库条目。 */
export const githubTrendingEntries = pgTable("github_trending_entries", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id")
    .references(() => githubTrendingSnapshots.id, { onDelete: "cascade" })
    .notNull(),
  rank: integer("rank").notNull(),
  fullName: text("full_name").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  language: text("language"),
  stars: integer("stars").notNull(),
  forks: integer("forks").notNull(),
  starsInPeriod: integer("stars_in_period").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  snapshotRankUnique: uniqueIndex("github_trending_entries_snapshot_rank_unique").on(
    table.snapshotId,
    table.rank,
  ),
  snapshotRepoUnique: uniqueIndex("github_trending_entries_snapshot_repo_unique").on(
    table.snapshotId,
    table.fullName,
  ),
  fullNameIdx: index("github_trending_entries_full_name_idx").on(table.fullName),
}));

export type GitHubTrendingSnapshot = typeof githubTrendingSnapshots.$inferSelect;
export type NewGitHubTrendingSnapshot = typeof githubTrendingSnapshots.$inferInsert;
export type GitHubTrendingEntry = typeof githubTrendingEntries.$inferSelect;
export type NewGitHubTrendingEntry = typeof githubTrendingEntries.$inferInsert;
