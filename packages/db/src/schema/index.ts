/**
 * @package @devscope/db
 * @description 数据库模型定义
 *
 * 使用 Drizzle ORM 定义 PostgreSQL 数据库结构。
 * 支持向量嵌入（通过 pgvector 扩展）实现语义搜索。
 *
 * @module schema
 */

import { pgTable, serial, text, timestamp, vector, integer, bigint, real, jsonb, index, uniqueIndex, boolean, pgEnum, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// 枚举定义
// ============================================================================

/**
 * 向量化状态枚举
 */
export const embeddingStatusEnum = pgEnum("embedding_status", [
  "pending",     // 待处理（快速采集完成后）
  "processing",  // 处理中
  "completed",   // 已完成
  "failed",      // 失败
]);

/**
 * 持久任务状态枚举
 */
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "retry_wait",
  "dead",
  "cancelled",
]);

/**
 * 技术雷达候选状态枚举
 */
export const radarCandidateStatusEnum = pgEnum("radar_candidate_status", [
  "discovered",
  "shortlisted",
  "researching",
  "recommended",
  "dismissed",
  "watching",
]);

/**
 * 仓库关系边类型枚举
 */
export const repoRelationshipTypeEnum = pgEnum("repo_relationship_type", [
  "similarity",
  "dependency",
]);

// ============================================================================
// 数据表定义
// ============================================================================

/**
 * 用户表
 * @description 存储用户账号信息
 */
export const users = pgTable("users", {
  /** 用户唯一标识（自增主键） */
  id: serial("id").primaryKey(),
  /** 用户邮箱地址（唯一索引） */
  email: text("email").notNull().unique(),
  /** 用户显示名称 */
  name: text("name"),
  /** 账号创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 持久任务表
 * @description 为独立 Worker 提供幂等入队、租约、重试和失败归档能力
 */
export const jobs = pgTable("jobs", {
  /** 任务唯一标识 */
  id: serial("id").primaryKey(),
  /** 所属用户 ID；所有用户级任务必须显式隔离 */
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  /** 任务类型，例如 radar.discover.github */
  type: text("type").notNull(),
  /** 同一用户内的幂等键 */
  idempotencyKey: text("idempotency_key").notNull(),
  /** 任务载荷 */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  /** 任务结果摘要 */
  result: jsonb("result").$type<Record<string, unknown>>(),
  /** 运行中任务的阶段进度（lease-authoritative 写入，不是业务事实来源） */
  progress: jsonb("progress").$type<Record<string, unknown>>(),
  /** 当前状态 */
  status: jobStatusEnum("status").default("queued").notNull(),
  /** 优先级，数值越大越先执行 */
  priority: integer("priority").default(0).notNull(),
  /** 已领取次数 */
  attempt: integer("attempt").default(0).notNull(),
  /** 最大领取次数 */
  maxAttempts: integer("max_attempts").default(3).notNull(),
  /** 最早可领取时间 */
  availableAt: timestamp("available_at").defaultNow().notNull(),
  /** 当前 Worker 标识 */
  leaseOwner: text("lease_owner"),
  /** 租约过期时间 */
  leaseExpiresAt: timestamp("lease_expires_at"),
  /** 最后一次错误 */
  lastError: text("last_error"),
  /** 首次开始时间 */
  startedAt: timestamp("started_at"),
  /** 最终完成时间 */
  completedAt: timestamp("completed_at"),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueUserIdempotencyKey: uniqueIndex("jobs_user_idempotency_key_unique").on(
    table.userId,
    table.idempotencyKey
  ),
  claimIdx: index("jobs_claim_idx").on(table.status, table.availableAt, table.priority),
  leaseExpiresAtIdx: index("jobs_lease_expires_at_idx").on(table.leaseExpiresAt),
  userTypeIdx: index("jobs_user_type_idx").on(table.userId, table.type),
  activeRepositoryIdentityBackfillUnique: uniqueIndex(
    "jobs_repository_identity_backfill_active_unique"
  )
    .on(table.type)
    .where(sql`${table.type} = 'repository.identity.backfill' AND ${table.status} IN ('queued', 'running', 'retry_wait')`),
  activeTechnologyStackEntitiesBackfillUnique: uniqueIndex(
    "jobs_technology_stack_entities_backfill_active_unique"
  )
    .on(table.type)
    .where(sql`${table.type} = 'technology_stack.entities.backfill' AND ${table.status} IN ('queued', 'running', 'retry_wait')`),
  technologyStackEntitiesBackfillVersionUnique: uniqueIndex(
    "jobs_technology_stack_entities_backfill_version_unique"
  )
    .on(table.type, table.idempotencyKey)
    .where(sql`${table.type} = 'technology_stack.entities.backfill'`),
}));

/**
 * 技术雷达候选表
 * @description 保存发现信号，只有用户明确关注后才进入正式 repositories
 */
export const radarCandidates = pgTable("radar_candidates", {
  /** 候选唯一标识 */
  id: serial("id").primaryKey(),
  /** 所属用户 ID */
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  /** GitHub repository ID；数据源未提供时允许为空 */
  githubRepoId: text("github_repo_id"),
  /** 标准化仓库全名 owner/repo */
  fullName: text("full_name").notNull(),
  /** 仓库名 */
  name: text("name").notNull(),
  /** 仓库所有者 */
  owner: text("owner").notNull(),
  /** GitHub URL */
  url: text("url").notNull(),
  /** 仓库描述 */
  description: text("description"),
  /** 主要语言 */
  language: text("language"),
  /** Stars 数量 */
  stars: integer("stars").default(0).notNull(),
  /** Forks 数量 */
  forks: integer("forks").default(0).notNull(),
  /** 开放 Issues 数量 */
  openIssues: integer("open_issues").default(0).notNull(),
  /** 当前生命周期状态 */
  status: radarCandidateStatusEnum("status").default("discovered").notNull(),
  /** 最近发现来源 */
  source: text("source").notNull(),
  /** 最近一次来源证据 */
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  /** 确定性评分，由发现 Worker 根据公开信号与用户语言偏好写入 */
  deterministicScore: integer("deterministic_score"),
  /** 评分拆分，保留热度、活跃度、语言偏好和社区规模贡献 */
  scoreBreakdown: jsonb("score_breakdown").$type<Record<string, number>>(),
  /** 首次发现时间 */
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  /** 最近发现时间 */
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueUserRepo: uniqueIndex("radar_candidates_user_repo_unique").on(
    table.userId,
    table.fullName
  ),
  userStatusScoreIdx: index("radar_candidates_user_status_score_idx").on(
    table.userId,
    table.status,
    table.deterministicScore
  ),
  lastSeenAtIdx: index("radar_candidates_last_seen_at_idx").on(table.lastSeenAt),
  githubRepoIdIdx: index("radar_candidates_github_repo_id_idx").on(table.githubRepoId),
  uniqueUserGitHubRepoId: uniqueIndex("radar_candidates_user_github_repo_id_unique")
    .on(table.userId, table.githubRepoId)
    .where(sql`${table.githubRepoId} IS NOT NULL`),
}));

/**
 * GitHub 仓库表
 * @description 存储 GitHub 仓库基础信息
 */
export const repositories = pgTable("repositories", {
  /** 仓库唯一标识 */
  id: serial("id").primaryKey(),
  /** GitHub 稳定 repository ID；reference 行及尚未回填的旧行允许为空 */
  githubRepositoryId: text("github_repository_id"),
  /** GitHub 仓库全名 (owner/repo) */
  fullName: text("full_name").notNull().unique(),
  /** 仓库名 */
  name: text("name").notNull(),
  /** 仓库所有者 */
  owner: text("owner").notNull(),
  /** 仓库描述 */
  description: text("description"),
  /** GitHub URL */
  url: text("url").notNull(),
  /** Stars 数量 */
  stars: integer("stars").default(0),
  /** Forks 数量 */
  forks: integer("forks").default(0),
  /** 开放 Issues 数量 */
  openIssues: integer("open_issues").default(0),
  /** 主要语言 */
  language: text("language"),
  /** 许可证 */
  license: text("license"),
  /** README 内容（原始 markdown） */
  readme: text("readme"),
  /** README 的 raw URL */
  readmeUrl: text("readme_url"),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  /** 最后采集时间 */
  lastFetchedAt: timestamp("last_fetched_at"),
  /**
   * SBOM 依赖包列表（采集时缓存）
   * @description GitHub dependency graph SBOM 解析出的 { name, version } 列表，
   * 供依赖边重建使用；versionInfo 为精确版本。
   */
  sbomPackages: jsonb("sbom_packages").$type<Array<{ name: string; version: string; system?: string }>>(),
  /** 向量化状态 */
  embeddingStatus: embeddingStatusEnum("embedding_status").default("pending"),
  /** 向量化进度百分比 (0-100) */
  embeddingProgress: integer("embedding_progress").default(0),
  /** 向量化总块数 */
  embeddingTotalChunks: integer("embedding_total_chunks").default(0),
  /** 向量化已完成块数 */
  embeddingCompletedChunks: integer("embedding_completed_chunks").default(0),
  /** 向量化开始时间 */
  embeddingStartedAt: timestamp("embedding_started_at"),
  /** 向量化完成时间 */
  embeddingCompletedAt: timestamp("embedding_completed_at"),
  /** 向量化错误信息 */
  embeddingError: text("embedding_error"),
  /** 仓库级聚合向量（readme+description mean pooling） */
  embedding: vector("embedding", { dimensions: 1024 }),
}, (table) => ({
  ownerIdx: index("repositories_owner_idx").on(table.owner),
  starsIdx: index("repositories_stars_idx").on(table.stars),
  lastFetchedAtIdx: index("repositories_last_fetched_at_idx").on(table.lastFetchedAt),
  embeddingStatusIdx: index("repositories_embedding_status_idx").on(table.embeddingStatus),
  githubRepositoryIdUnique: uniqueIndex("repositories_github_repository_id_unique")
    .on(table.githubRepositoryId)
    .where(sql`${table.githubRepositoryId} IS NOT NULL`),
}));

/**
 * 仓库文本分块表
 * @description 存储分块后的仓库文档和对应的 embedding
 */
export const repoChunks = pgTable("repo_chunks", {
  /** 分块唯一标识 */
  id: serial("id").primaryKey(),
  /** 所属仓库 ID */
  repoId: integer("repo_id")
    .references(() => repositories.id)
    .notNull(),
  /** 分块内容 */
  content: text("content").notNull(),
  /** 分块类型 (readme, issues, commits, etc) */
  chunkType: text("chunk_type").notNull(),
  /** 来源标识 (issue number, commit sha, etc) */
  sourceId: text("source_id"),
  /** 分块序号 */
  chunkIndex: integer("chunk_index").notNull(),
  /** 向量嵌入 (1024 维 - BGE-M3) */
  embedding: vector("embedding", { dimensions: 1024 }),
  /** token 数量 */
  tokenCount: integer("token_count"),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index("repo_chunks_repo_id_idx").on(table.repoId),
  chunkTypeIdx: index("repo_chunks_type_idx").on(table.chunkType),
}));

/**
 * Hacker News 项目表
 * @description 存储 Hacker News 上与项目相关的讨论
 */
export const hackernewsItems = pgTable("hackernews_items", {
  /** HN item ID */
  id: serial("id").primaryKey(),
  /** 关联的仓库 ID */
  repoId: integer("repo_id").references(() => repositories.id).notNull(),
  /** HN item 类型 (story, comment) */
  type: text("type").notNull(),
  /** 标题 (story) */
  title: text("title"),
  /** 内容/评论 */
  content: text("content"),
  /** 作者 */
  author: text("author"),
  /** Score (story) */
  score: integer("score"),
  /** 评论数 */
  descendants: integer("descendants"),
  /** HN URL */
  url: text("url"),
  /** 原始 HN JSON */
  rawJson: jsonb("raw_json"),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index("hn_items_repo_id_idx").on(table.repoId),
  typeIdx: index("hn_items_type_idx").on(table.type),
  scoreIdx: index("hn_items_score_idx").on(table.score),
}));

/**
 * 文档表
 * @description 存储用户文档，支持向量嵌入搜索
 */
export const documents = pgTable("documents", {
  /** 文档唯一标识（自增主键） */
  id: serial("id").primaryKey(),
  /** 所属用户 ID（外键关联 users 表） */
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  /** 文档标题 */
  title: text("title").notNull(),
  /** 文档内容 */
  content: text("content").notNull(),
  /**
   * 向量嵌入
   * @description 使用 pgvector 存储的 1024 维向量 (BGE-M3)
   * 用于语义搜索和相似度计算
   */
  embedding: vector("embedding", { dimensions: 1024 }),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================================
// 类型推断
// ============================================================================

/**
 * 用户数据类型（从数据库查询返回）
 */
export type User = typeof users.$inferSelect;

/**
 * 新用户类型（用于插入数据库）
 */
export type NewUser = typeof users.$inferInsert;

/**
 * 仓库数据类型（从数据库查询返回）
 */
export type Repository = typeof repositories.$inferSelect;

/**
 * 新仓库类型（用于插入数据库）
 */
export type NewRepository = typeof repositories.$inferInsert;

/**
 * 仓库分块数据类型（从数据库查询返回）
 */
export type RepoChunk = typeof repoChunks.$inferSelect;

/**
 * 新仓库分块类型（用于插入数据库）
 */
export type NewRepoChunk = typeof repoChunks.$inferInsert;

/**
 * Hacker News 项目类型（从数据库查询返回）
 */
export type HackernewsItem = typeof hackernewsItems.$inferSelect;

/**
 * 新 Hacker News 项目类型（用于插入数据库）
 */
export type NewHackernewsItem = typeof hackernewsItems.$inferInsert;

/**
 * 文档数据类型（从数据库查询返回）
 */
export type Document = typeof documents.$inferSelect;

/**
 * 新文档类型（用于插入数据库）
 */
export type NewDocument = typeof documents.$inferInsert;

/**
 * 持久任务数据类型
 */
export type Job = typeof jobs.$inferSelect;

/**
 * 新持久任务类型
 */
export type NewJob = typeof jobs.$inferInsert;

/**
 * 技术雷达候选数据类型
 */
export type RadarCandidate = typeof radarCandidates.$inferSelect;

/**
 * 新技术雷达候选类型
 */
export type NewRadarCandidate = typeof radarCandidates.$inferInsert;

// ============================================================================
// 工作流相关表定义
// ============================================================================

/**
 * 工作流执行状态枚举
 */
export const workflowExecutionStatusEnum = pgEnum("workflow_execution_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * 工作流报告类型枚举
 */
export const workflowReportTypeEnum = pgEnum("workflow_report_type", [
  "daily_health_report",
  "quick_assessment",
]);

/**
 * 工作流执行记录表
 * @description 记录每次工作流的执行状态和元数据
 */
export const workflowExecutions = pgTable("workflow_executions", {
  /** 执行记录唯一标识 */
  id: serial("id").primaryKey(),
  /** DevScope 执行 ID（用于查询状态和关联报告） */
  executionId: text("execution_id").notNull().unique(),
  /** 用户 ID（外键关联 users 表） */
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  /** 执行器或分析流程标识 */
  workflowId: text("workflow_id").notNull(),
  /** 工作流类型（daily_health_report, quick_assessment） */
  workflowType: text("workflow_type").notNull(),
  /** 执行状态 */
  status: workflowExecutionStatusEnum("status").notNull().default("pending"),
  /** 输入参数（JSON 格式） */
  input: jsonb("input"),
  /** 执行结果（JSON 格式，完成后存储） */
  result: jsonb("result"),
  /** 错误信息（失败时存储） */
  error: text("error"),
  /** 当前进度百分比（0-100） */
  progressPercent: integer("progress_percent").default(0),
  /** 当前执行的节点名称 */
  currentNode: text("current_node"),
  /** 开始时间 */
  startedAt: timestamp("started_at").defaultNow().notNull(),
  /** 完成时间 */
  completedAt: timestamp("completed_at"),
  /** 预计完成时间 */
  estimatedCompletionAt: timestamp("estimated_completion_at"),
  /** 执行时长（毫秒） */
  durationMs: integer("duration_ms"),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  executionIdIdx: index("workflow_executions_execution_id_idx").on(table.executionId),
  userIdIdx: index("workflow_executions_user_id_idx").on(table.userId),
  workflowIdIdx: index("workflow_executions_workflow_id_idx").on(table.workflowId),
  statusIdx: index("workflow_executions_status_idx").on(table.status),
  createdAtIdx: index("workflow_executions_created_at_idx").on(table.createdAt),
}));

/**
 * 工作流报告表
 * @description 存储工作流生成的结构化报告
 */
export const workflowReports = pgTable("workflow_reports", {
  /** 报告唯一标识 */
  id: serial("id").primaryKey(),
  /** 报告 ID（UUID，对外暴露） */
  reportId: text("report_id").notNull().unique(),
  /** 关联的执行记录 ID */
  executionId: text("execution_id")
    .references(() => workflowExecutions.executionId)
    .notNull(),
  /** 用户 ID */
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  /** 报告类型 */
  reportType: workflowReportTypeEnum("report_type").notNull(),
  /** 报告数据（JSON 格式，存储完整的报告内容） */
  reportData: jsonb("report_data").notNull(),
  /** 报告摘要（用于快速展示） */
  summary: text("summary"),
  /** 报告日期（用于每日报告） */
  reportDate: text("report_date"),
  /** 关联的仓库（用于快速评估） */
  repoFullName: text("repo_full_name"),
  /** 是否已读 */
  isRead: boolean("is_read").default(false).notNull(),
  /** 是否已归档 */
  isArchived: boolean("is_archived").default(false).notNull(),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  reportIdIdx: index("workflow_reports_report_id_idx").on(table.reportId),
  executionIdIdx: index("workflow_reports_execution_id_idx").on(table.executionId),
  userIdIdx: index("workflow_reports_user_id_idx").on(table.userId),
  reportTypeIdx: index("workflow_reports_report_type_idx").on(table.reportType),
  repoFullNameIdx: index("workflow_reports_repo_full_name_idx").on(table.repoFullName),
  createdAtIdx: index("workflow_reports_created_at_idx").on(table.createdAt),
}));

/**
 * 用户关注仓库表
 * @description 存储用户关注的 GitHub 仓库列表
 */
export const userWatchedRepositories = pgTable("user_watched_repositories", {
  /** 记录唯一标识 */
  id: serial("id").primaryKey(),
  /** 用户 ID（外键关联 users 表） */
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  /** 关联的仓库 ID（外键关联 repositories 表） */
  repoId: integer("repo_id")
    .references(() => repositories.id)
    .notNull(),
  /** 仓库全名（冗余字段，方便查询） */
  repoFullName: text("repo_full_name").notNull(),
  /** 是否启用每日报告 */
  enableDailyReport: boolean("enable_daily_report").default(true).notNull(),
  /** 优先级（用于排序） */
  priority: integer("priority").default(0),
  /** 备注 */
  notes: text("notes"),
  /** 当前用户在 GitHub 关注该仓库的时间 */
  starredAt: timestamp("starred_at"),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_watched_repos_user_id_idx").on(table.userId),
  repoIdIdx: index("user_watched_repos_repo_id_idx").on(table.repoId),
  uniqueUserRepo: uniqueIndex("user_watched_repos_user_repo_unique_idx").on(table.userId, table.repoId),
}));

// ============================================================================
// 类型推断
// ============================================================================

/**
 * 工作流执行记录数据类型
 */
export type WorkflowExecution = typeof workflowExecutions.$inferSelect;

/**
 * 新工作流执行记录类型
 */
export type NewWorkflowExecution = typeof workflowExecutions.$inferInsert;

/**
 * 工作流报告数据类型
 */
export type WorkflowReport = typeof workflowReports.$inferSelect;

/**
 * 新工作流报告类型
 */
export type NewWorkflowReport = typeof workflowReports.$inferInsert;

/**
 * 用户关注仓库数据类型
 */
export type UserWatchedRepository = typeof userWatchedRepositories.$inferSelect;

/**
 * 新用户关注仓库类型
 */
export type NewUserWatchedRepository = typeof userWatchedRepositories.$inferInsert;

/**
 * GitHub Releases 表
 * @description 存储 GitHub 仓库的 Release 版本信息
 */
export const releases = pgTable("releases", {
  /** Release ID（GitHub） */
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  /** 关联的仓库 ID */
  repoId: integer("repo_id").references(() => repositories.id).notNull(),
  /** Tag 名称 (如 v1.0.0) */
  tagName: text("tag_name").notNull(),
  /** Release 名称 */
  name: text("name").notNull(),
  /** Release 描述 */
  body: text("body"),
  /** 作者 */
  author: text("author").notNull(),
  /** 创建时间 */
  createdAt: timestamp("created_at").notNull(),
  /** 发布时间 */
  publishedAt: timestamp("published_at"),
  /** API URL */
  url: text("url").notNull(),
  /** HTML URL */
  htmlUrl: text("html_url").notNull(),
  /** ZIP 下载 URL */
  zipUrl: text("zip_url"),
  /** TAR 下载 URL */
  tarUrl: text("tar_url"),
  /** 附件列表 (JSON) */
  assets: jsonb("assets").$type<Array<{
    name: string;
    size: number;
    downloadCount: number;
    url: string;
    browserDownloadUrl: string;
  }>>().notNull(),
  /** 是否为预发布版本 */
  isPrerelease: boolean("is_prerelease").default(false).notNull(),
  /** 本地采集时间 */
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index("releases_repo_id_idx").on(table.repoId),
  tagNameIdx: index("releases_tag_name_idx").on(table.tagName),
  createdAtIdx: index("releases_created_at_idx").on(table.createdAt),
}));

/**
 * Release 数据类型
 */
export type Release = typeof releases.$inferSelect;

/**
 * 新 Release 类型
 */
export type NewRelease = typeof releases.$inferInsert;

// ============================================================================
// 仓库分组相关表定义
// ============================================================================

/**
 * 仓库分组表
 * @description 存储用户创建的仓库分组
 */
export const repositoryGroups = pgTable("repository_groups", {
  /** 分组唯一标识 */
  id: serial("id").primaryKey(),
  /** 所属用户 ID */
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  /** 父分组 ID；null 表示根分组 */
  parentId: integer("parent_id"),
  /** 分组名称 */
  name: text("name").notNull(),
  /** 分组颜色 (blue, green, purple, orange, red, pink) */
  color: text("color").default("blue").notNull(),
  /** 分组图标 (lucide-react icon name) */
  icon: text("icon").default("folder").notNull(),
  /** 分组描述 */
  description: text("description"),
  /** 显示顺序 */
  orderIndex: integer("order_index").default(0).notNull(),
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("repository_groups_user_id_idx").on(table.userId),
  idUserUnique: uniqueIndex("repository_groups_id_user_unique").on(table.id, table.userId),
  parentUserForeignKey: foreignKey({
    columns: [table.parentId, table.userId],
    foreignColumns: [table.id, table.userId],
    name: "repository_groups_parent_user_fk",
  }).onDelete("restrict"),
  siblingOrderIdx: index("repository_groups_sibling_order_idx").on(
    table.userId,
    table.parentId,
    table.orderIndex,
  ),
}));

/**
 * 分组成员表
 * @description 存储分组与仓库的多对多关系
 */
export const groupMembers = pgTable("group_members", {
  /** 成员记录唯一标识 */
  id: serial("id").primaryKey(),
  /** 分组 ID */
  groupId: integer("group_id")
    .references(() => repositoryGroups.id, { onDelete: "cascade" })
    .notNull(),
  /** 仓库 ID */
  repoId: integer("repo_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  /** 在分组内的顺序 */
  orderIndex: integer("order_index").default(0).notNull(),
  /** 添加时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  groupIdIdx: index("group_members_group_id_idx").on(table.groupId),
  repoIdIdx: index("group_members_repo_id_idx").on(table.repoId),
  groupOrderIdx: index("group_members_group_order_idx").on(table.groupId, table.orderIndex),
  groupRepoUnique: uniqueIndex("group_members_group_repo_unique").on(table.groupId, table.repoId),
}));

/**
 * 仓库分组数据类型
 */
export type RepositoryGroup = typeof repositoryGroups.$inferSelect;

/**
 * 新仓库分组类型
 */
export type NewRepositoryGroup = typeof repositoryGroups.$inferInsert;

/**
 * 分组成员数据类型
 */
export type GroupMember = typeof groupMembers.$inferSelect;

/**
 * 新分组成员类型
 */
export type NewGroupMember = typeof groupMembers.$inferInsert;

// ============================================================================
// 仓库关系图谱相关表定义
// ============================================================================

/**
 * 技术栈实体表
 * @description React、Vue、Spring Boot 等产品语义技术栈；不复用 repository 行。
 */
export const technologyStacks = pgTable("technology_stacks", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  slugUnique: uniqueIndex("technology_stacks_slug_unique").on(table.slug),
}));

/**
 * 仓库—技术栈事实表
 * @description 全局 repository fact；用户范围在查询时通过 watched source repository 限定。
 */
export const repositoryTechnologyStacks = pgTable("repository_technology_stacks", {
  id: serial("id").primaryKey(),
  repositoryId: integer("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  technologyStackId: integer("technology_stack_id")
    .references(() => technologyStacks.id, { onDelete: "cascade" })
    .notNull(),
  packages: jsonb("packages").$type<Array<{
    system: string;
    name: string;
    version: string;
  }>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueRepositoryStack: uniqueIndex("repository_technology_stacks_repository_stack_unique")
    .on(table.repositoryId, table.technologyStackId),
  repositoryIdIdx: index("repository_technology_stacks_repository_id_idx")
    .on(table.repositoryId),
  technologyStackIdIdx: index("repository_technology_stacks_technology_stack_id_idx")
    .on(table.technologyStackId),
}));

/**
 * Phase C 冻结基线 receipt 表
 * @description 进入 new_only 前固化的 legacy (githubRepositoryId, slug) 存在性
 * key 与 packages digest；观察窗口单向包含比较的数据来源。列形态与
 * baseline-compare.ts 运行期 DDL 完全一致（journal 为权威来源，运行期
 * create if not exists 仅覆盖迁移未应用窗口）。
 */
export const technologyStackBaselineReceipts = pgTable(
  "technology_stack_baseline_receipts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    githubRepositoryId: text("github_repository_id").notNull(),
    slug: text("slug").notNull(),
    packagesDigest: text("packages_digest").notNull(),
    frozenAt: timestamp("frozen_at").notNull(),
  },
  (table) => ({
    userRepoStackUnique: uniqueIndex("technology_stack_baseline_receipts_user_repo_stack_unique")
      .on(table.userId, table.githubRepositoryId, table.slug),
  }),
);

/**
 * Phase C cleanup receipt 表
 * @description cleanup 维护窗口执行后写入的不可变 receipt；journal 中的
 * DROP COLUMN is_reference 以“此表存在且含行”为执行守卫。
 */
export const technologyStackCleanupReceipts = pgTable(
  "technology_stack_cleanup_receipts",
  {
    id: serial("id").primaryKey(),
    executedAt: timestamp("executed_at").notNull(),
    legacyStackEdges: integer("legacy_stack_edges").notNull(),
    pseudoWatched: integer("pseudo_watched").notNull(),
    pseudoRepositories: integer("pseudo_repositories").notNull(),
  },
);

/**
 * 仓库关系边表
 * @description 存储仓库间的相似度和依赖关系
 */
export const repoRelationships = pgTable("repo_relationships", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  sourceRepoId: integer("source_repo_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  targetRepoId: integer("target_repo_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  edgeType: repoRelationshipTypeEnum("edge_type").notNull(),
  score: real("score"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueEdge: uniqueIndex("repo_relationships_user_source_target_type_unique").on(
    table.userId,
    table.sourceRepoId,
    table.targetRepoId,
    table.edgeType
  ),
  userIdIdx: index("repo_relationships_user_id_idx").on(table.userId),
  targetRepoIdIdx: index("repo_relationships_target_repo_id_idx").on(table.targetRepoId),
}));

export const packageResolutionStatusEnum = pgEnum("package_resolution_status", [
  "resolved",
  "not_found",
  "error",
]);

/**
 * 包-仓库映射缓存表
 * @description 缓存 deps.dev 的包到源码仓库映射结果。
 * `source_repo` 只表达当前权威映射（resolved 时非空）；
 * 降级时的旧值证据保存在 `last_resolved_repo`，不得当作权威映射使用。
 */
export const packageRepoMappings = pgTable("package_repo_mappings", {
  id: serial("id").primaryKey(),
  system: text("system").notNull(),
  packageName: text("package_name").notNull(),
  packageVersion: text("package_version").notNull(),
  sourceRepo: text("source_repo"),
  /** 默认 error：回滚窗口内旧镜像写入的 null 行不会被误读为权威结论 */
  resolutionStatus: packageResolutionStatusEnum("resolution_status")
    .default("error")
    .notNull(),
  /** 下一次允许外呼的时间：resolved/not_found 为复查 TTL，error 为短退避 */
  retryAfter: timestamp("retry_after"),
  /** 脱敏短错误摘要，仅 error 行非空 */
  lastError: text("last_error"),
  /** resolved 复查失败降级时保留的旧映射证据 */
  lastResolvedRepo: text("last_resolved_repo"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (table) => ({
  uniquePackageVersion: uniqueIndex("package_repo_mappings_system_name_version_unique").on(
    table.system,
    table.packageName,
    table.packageVersion
  ),
  // resolved 当且仅当 source_repo 非空：三值状态下等价于
  // (not_found OR error) ⟺ source_repo IS NULL，降级必须“移动”旧值而非复制。
  resolvedImpliesSourceRepo: check(
    "package_repo_mappings_resolved_source_check",
    sql`(resolution_status = 'resolved') = (source_repo IS NOT NULL)`,
  ),
}));

/**
 * GitHub fullName canonicalization freshness 表
 * @description 持久化 deps.dev 外部 target 的重命名归一结果，warm rebuild 零外呼。
 * 注意：本表不设 status⟺canonical 的 CHECK——error/not_found 降级时上一次
 * canonical 值保留在 canonical_full_name 本身作为证据。
 */
export const githubRepoNameCanonicalizations = pgTable("github_repo_name_canonicalizations", {
  id: serial("id").primaryKey(),
  /** 查找键：小写 fullName */
  fullName: text("full_name").notNull(),
  canonicalFullName: text("canonical_full_name"),
  resolutionStatus: packageResolutionStatusEnum("resolution_status")
    .default("error")
    .notNull(),
  retryAfter: timestamp("retry_after"),
  lastError: text("last_error"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
}, (table) => ({
  uniqueFullName: uniqueIndex("github_repo_name_canonicalizations_full_name_unique").on(
    table.fullName
  ),
}));

export type GithubRepoNameCanonicalization = typeof githubRepoNameCanonicalizations.$inferSelect;
export type NewGithubRepoNameCanonicalization = typeof githubRepoNameCanonicalizations.$inferInsert;

export type RepoRelationship = typeof repoRelationships.$inferSelect;
export type NewRepoRelationship = typeof repoRelationships.$inferInsert;

export type TechnologyStack = typeof technologyStacks.$inferSelect;
export type NewTechnologyStack = typeof technologyStacks.$inferInsert;
export type RepositoryTechnologyStack = typeof repositoryTechnologyStacks.$inferSelect;
export type NewRepositoryTechnologyStack = typeof repositoryTechnologyStacks.$inferInsert;
export type PackageRepoMapping = typeof packageRepoMappings.$inferSelect;
export type NewPackageRepoMapping = typeof packageRepoMappings.$inferInsert;

export * from "./trending";
