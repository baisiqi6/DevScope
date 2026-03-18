/**
 * @package @devscope/db
 * @description 数据库模型定义
 *
 * 使用 Drizzle ORM 定义 PostgreSQL 数据库结构。
 * 支持向量嵌入（通过 pgvector 扩展）实现语义搜索。
 *
 * @module schema
 */

import { pgTable, serial, text, timestamp, vector, integer, jsonb, index, boolean, pgEnum } from "drizzle-orm/pg-core";

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
 * GitHub 仓库表
 * @description 存储 GitHub 仓库基础信息
 */
export const repositories = pgTable("repositories", {
  /** 仓库唯一标识 */
  id: serial("id").primaryKey(),
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
}, (table) => ({
  ownerIdx: index("repositories_owner_idx").on(table.owner),
  starsIdx: index("repositories_stars_idx").on(table.stars),
}));

/**
 * 仓库文本分块表
 * @description 存储分块后的仓库文档和对应的 embedding
 */
export const repoChunks = pgTable("repo_chunks", {
  /** 分块唯一标识 */
  id: serial("id").primaryKey(),
  /** 所属仓库 ID */
  repoId: serial("repo_id")
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
  repoId: serial("repo_id").references(() => repositories.id),
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
  userId: serial("user_id")
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
  /** Langtum 平台的执行 ID（用于查询状态） */
  executionId: text("execution_id").notNull().unique(),
  /** 用户 ID（外键关联 users 表） */
  userId: serial("user_id")
    .references(() => users.id)
    .notNull(),
  /** 工作流 ID（对应 Langtum 的工作流名称） */
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
  userId: serial("user_id")
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
  userId: serial("user_id")
    .references(() => users.id)
    .notNull(),
  /** 关联的仓库 ID（外键关联 repositories 表） */
  repoId: serial("repo_id")
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
  /** 创建时间 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 最后更新时间 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_watched_repos_user_id_idx").on(table.userId),
  repoIdIdx: index("user_watched_repos_repo_id_idx").on(table.repoId),
  uniqueUserRepo: index("user_watched_repos_user_repo_unique_idx").on(table.userId, table.repoId),
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
