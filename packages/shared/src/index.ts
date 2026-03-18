/**
 * @package @devscope/shared
 * @description 共享类型定义包
 *
 * 本包包含整个项目中使用的共享类型定义，使用 Zod 进行运行时验证。
 * 所有类型都通过 Zod schema 定义，自动推断出 TypeScript 类型。
 *
 * @module index
 */

import { z } from "zod";

// ============================================================================
// 用户类型 (User Types)
// ============================================================================

/**
 * 用户数据 Schema
 * @description 定义用户数据的结构和验证规则
 */
export const userSchema = z.object({
  /** 用户唯一标识 */
  id: z.number().optional(),
  /** 用户邮箱地址（必须符合邮箱格式） */
  email: z.string().email(),
  /** 用户显示名称 */
  name: z.string().optional(),
  /** 账号创建时间 */
  createdAt: z.date().optional(),
  /** 最后更新时间 */
  updatedAt: z.date().optional(),
});

/** 从 Schema 推断的用户类型 */
export type User = z.infer<typeof userSchema>;

/** 创建新用户时的类型（不含自动生成的字段） */
export type NewUser = Omit<User, "id" | "createdAt" | "updatedAt">;

// ============================================================================
// 文档类型 (Document Types)
// ============================================================================

/**
 * 文档数据 Schema
 * @description 定义文档数据的结构和验证规则，包含向量嵌入支持
 */
export const documentSchema = z.object({
  /** 文档唯一标识 */
  id: z.number().optional(),
  /** 所属用户 ID */
  userId: z.number(),
  /** 文档标题（不能为空） */
  title: z.string().min(1),
  /** 文档内容（不能为空） */
  content: z.string().min(1),
  /** 向量嵌入（用于语义搜索） */
  embedding: z.array(z.number()).optional(),
  /** 创建时间 */
  createdAt: z.date().optional(),
  /** 最后更新时间 */
  updatedAt: z.date().optional(),
});

/** 从 Schema 推断的文档类型 */
export type Document = z.infer<typeof documentSchema>;

/** 创建新文档时的类型（不含自动生成的字段） */
export type NewDocument = Omit<Document, "id" | "createdAt" | "updatedAt">;

// ============================================================================
// AI 类型 (AI Types)
// ============================================================================

/**
 * 消息角色枚举
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * 聊天消息 Schema
 * @description 定义单条聊天消息的结构
 */
export const messageSchema = z.object({
  /** 消息发送者角色 */
  role: z.enum(["user", "assistant", "system"]),
  /** 消息内容 */
  content: z.string(),
});

/** 从 Schema 推断的消息类型 */
export type Message = z.infer<typeof messageSchema>;

/**
 * AI 补全请求 Schema
 * @description 发送给 AI 的请求参数
 */
export const completionRequestSchema = z.object({
  /** 聊天消息列表 */
  messages: z.array(messageSchema),
  /** 使用的模型名称（可选） */
  model: z.string().optional(),
  /** 最大生成 token 数（可选） */
  maxTokens: z.number().optional(),
  /** 温度参数 0-1（可选） */
  temperature: z.number().min(0).max(1).optional(),
  /** 系统提示词（可选） */
  system: z.string().optional(),
});

/** 从 Schema 推断的请求类型 */
export type CompletionRequest = z.infer<typeof completionRequestSchema>;

/**
 * AI 补全响应 Schema
 * @description AI 返回的响应结构
 */
export const completionResponseSchema = z.object({
  /** 生成的内容 */
  content: z.string(),
  /** 使用的模型 */
  model: z.string(),
  /** Token 使用统计 */
  usage: z.object({
    /** 输入 token 数 */
    inputTokens: z.number(),
    /** 输出 token 数 */
    outputTokens: z.number(),
  }),
});

/** 从 Schema 推断的响应类型 */
export type CompletionResponse = z.infer<typeof completionResponseSchema>;

// ============================================================================
// API 类型 (API Types)
// ============================================================================

/**
 * 通用 API 响应 Schema
 * @description 标准化的 API 响应格式
 */
export const apiResponseSchema = z.object({
  /** 请求是否成功 */
  success: z.boolean(),
  /** 响应数据（成功时存在） */
  data: z.any().optional(),
  /** 错误信息（失败时存在） */
  error: z.string().optional(),
});

/** 通用 API 响应类型 */
export type ApiResponse<T = unknown> = {
  /** 请求是否成功 */
  success: boolean;
  /** 响应数据（成功时存在） */
  data?: T;
  /** 错误信息（失败时存在） */
  error?: string;
};

// ============================================================================
// 通用类型 (Common Types)
// ============================================================================

/**
 * 分页参数 Schema
 * @description 分页查询参数
 */
export const paginationSchema = z.object({
  /** 当前页码（从 1 开始） */
  page: z.number().min(1).default(1),
  /** 每页数量（1-100） */
  limit: z.number().min(1).max(100).default(20),
});

/** 从 Schema 推断的分页参数类型 */
export type Pagination = z.infer<typeof paginationSchema>;

/**
 * 分页响应 Schema
 * @description 分页数据响应格式
 */
export const paginatedResponseSchema = z.object({
  /** 数据列表 */
  items: z.array(z.any()),
  /** 总记录数 */
  total: z.number(),
  /** 当前页码 */
  page: z.number(),
  /** 每页数量 */
  limit: z.number(),
  /** 总页数 */
  totalPages: z.number(),
});

/** 从 Schema 推断的分页响应类型 */
export type PaginatedResponse<T = unknown> = {
  /** 数据列表 */
  items: T[];
  /** 总记录数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  limit: number;
  /** 总页数 */
  totalPages: number;
};

// ============================================================================
// 仓库分析类型 (Repository Analysis Types)
// ============================================================================

/**
 * 活动级别枚举
 */
export const activityLevelSchema = z.enum(["high", "medium", "low", "dead"]);

/** 活动级别类型 */
export type ActivityLevel = z.infer<typeof activityLevelSchema>;

/**
 * 推荐级别枚举
 */
export const recommendationLevelSchema = z.enum(["invest", "watch", "avoid"]);

/** 推荐级别类型 */
export type RecommendationLevel = z.infer<typeof recommendationLevelSchema>;

/**
 * 关键指标 Schema
 * @description 项目的关键量化指标
 */
export const keyMetricsSchema = z.object({
  /** Stars 增长率（百分比） */
  starsGrowthRate: z.number(),
  /** Issue 解决率（百分比 0-100） */
  issueResolutionRate: z.number().min(0).max(100),
  /** 贡献者多样性评分（0-100） */
  contributorDiversityScore: z.number().min(0).max(100),
});

/** 关键指标类型 */
export type KeyMetrics = z.infer<typeof keyMetricsSchema>;

/**
 * 风险因素 Schema
 * @description 项目存在的潜在风险
 */
export const riskFactorSchema = z.object({
  /** 风险类别 */
  category: z.string(),
  /** 风险描述 */
  description: z.string(),
  /** 严重程度（1-10） */
  severity: z.number().min(1).max(10),
});

/** 风险因素类型 */
export type RiskFactor = z.infer<typeof riskFactorSchema>;

/**
 * 机会因素 Schema
 * @description 项目存在的潜在机会
 */
export const opportunitySchema = z.object({
  /** 机会类别 */
  category: z.string(),
  /** 机会描述 */
  description: z.string(),
  /** 潜在影响（1-10） */
  potential: z.number().min(1).max(10),
});

/** 机会因素类型 */
export type Opportunity = z.infer<typeof opportunitySchema>;

/**
 * 仓库健康度分析结果 Schema
 * @description 对 GitHub 仓库进行全面分析后的结构化输出
 */
export const repositoryAnalysisSchema = z.object({
  /** 健康度评分（0-100） */
  healthScore: z.number().min(0).max(100),
  /** 活动级别 */
  activityLevel: activityLevelSchema,
  /** 关键指标 */
  keyMetrics: keyMetricsSchema,
  /** 风险因素列表 */
  riskFactors: z.array(riskFactorSchema),
  /** 机会列表 */
  opportunities: z.array(opportunitySchema),
  /** 推荐级别 */
  recommendation: recommendationLevelSchema,
  /** 分析摘要 */
  summary: z.string(),
});

/** 仓库健康度分析结果类型 */
export type RepositoryAnalysis = z.infer<typeof repositoryAnalysisSchema>;

/**
 * 仓库分析请求 Schema
 * @description 发起仓库分析的请求参数
 */
export const repositoryAnalysisRequestSchema = z.object({
  /** GitHub 仓库所有者（非空字符串） */
  owner: z.string().min(1),
  /** GitHub 仓库名称（非空字符串） */
  repo: z.string().min(1),
  /** 可选：额外的分析上下文信息 */
  context: z.string().optional(),
});

/** 仓库分析请求类型 */
export type RepositoryAnalysisRequest = z.infer<typeof repositoryAnalysisRequestSchema>;

// ============================================================================
// 数据采集类型 (Data Collection Types)
// ============================================================================

/**
 * 仓库采集输入 Schema
 */
export const repoCollectionInputSchema = z.object({
  /** 仓库标识符 (owner/repo) */
  repo: z.string().regex(/^[\w-]+\/[\w-]+$/, "格式应为 owner/repo"),
  /** 是否采集 Issues */
  includeIssues: z.boolean().default(true),
  /** 是否采集 Commits */
  includeCommits: z.boolean().default(false),
  /** Issues 数量限制 */
  issuesLimit: z.number().min(1).max(100).default(20),
  /** Commits 数量限制 */
  commitsLimit: z.number().min(1).max(100).default(10),
});

/** 仓库采集输入类型 */
export type RepoCollectionInput = z.infer<typeof repoCollectionInputSchema>;

/**
 * 采集状态枚举
 */
export const collectionStatusSchema = z.enum(["pending", "processing", "completed", "failed", "success"]);

/** 采集状态类型 */
export type CollectionStatus = z.infer<typeof collectionStatusSchema>;

/**
 * 文本分块 Schema
 */
export const textChunkSchema = z.object({
  /** 分块内容 */
  content: z.string(),
  /** 分块类型 */
  chunkType: z.enum(["readme", "issues", "commits", "description", "hackernews"]),
  /** 来源标识 */
  sourceId: z.string().optional(),
  /** 分块序号 */
  chunkIndex: z.number(),
  /** token 数量 */
  tokenCount: z.number().optional(),
});

/** 文本分块类型 */
export type TextChunk = z.infer<typeof textChunkSchema>;

/**
 * Embedding 请求 Schema
 */
export const embeddingRequestSchema = z.object({
  /** 输入文本 */
  input: z.union([z.string(), z.array(z.string())]),
  /** 模型名称 */
  model: z.string().default("text-embedding-3-small"),
});

/** Embedding 请求类型 */
export type EmbeddingRequest = z.infer<typeof embeddingRequestSchema>;

/**
 * Embedding 响应 Schema
 */
export const embeddingResponseSchema = z.object({
  /** embedding 向量数组 */
  embedding: z.array(z.number()),
  /** token 使用量 */
  tokens: z.number().optional(),
});

/** Embedding 响应类型 */
export type EmbeddingResponse = z.infer<typeof embeddingResponseSchema>;

/**
 * Hacker News 采集输入 Schema
 */
export const hnCollectionInputSchema = z.object({
  /** 关键词（通常为仓库名） */
  query: z.string().min(1),
  /** 采集数量限制 */
  limit: z.number().min(1).max(100).default(20),
});

/** Hacker News 采集输入类型 */
export type HnCollectionInput = z.infer<typeof hnCollectionInputSchema>;

/**
 * 完整采集 Pipeline 结果 Schema
 */
export const collectionResultSchema = z.object({
  /** 仓库信息（采集失败时可能不存在） */
  repository: z.object({
    id: z.number().optional(),
    fullName: z.string(),
    name: z.string(),
    owner: z.string(),
    description: z.string().optional(),
    stars: z.number().nullable(),
    forks: z.number().nullable(),
    openIssues: z.number().nullable().optional(),
    language: z.string().nullable().optional(),
    url: z.string().optional(),
  }).optional(),
  /** 采集的分块数量 */
  chunksCollected: z.number(),
  /** embedding 生成数量 */
  embeddingsGenerated: z.number(),
  /** Hacker News 项目数量 */
  hnItemsCollected: z.number(),
  /** 采集状态 */
  status: collectionStatusSchema,
  /** 错误信息（如果有） */
  error: z.string().optional(),
  /** 警告信息（如果有） */
  warning: z.string().optional(),
  /** 采集耗时（毫秒） */
  duration: z.number(),
});

/** 采集结果类型 */
export type CollectionResult = z.infer<typeof collectionResultSchema>;

/**
 * 仓库信息 Schema
 * @description 仓库的基本信息
 */
export const repositorySchema = z.object({
  /** 仓库唯一标识 */
  id: z.number(),
  /** GitHub 仓库全名 (owner/repo) */
  fullName: z.string(),
  /** 仓库名 */
  name: z.string(),
  /** 仓库所有者 */
  owner: z.string(),
  /** 仓库描述 */
  description: z.string().optional(),
  /** GitHub URL */
  url: z.string(),
  /** Stars 数量 */
  stars: z.number(),
  /** Forks 数量 */
  forks: z.number(),
  /** 开放 Issues 数量 */
  openIssues: z.number(),
  /** 主要语言 */
  language: z.string().optional(),
  /** 许可证 */
  license: z.string().optional(),
  /** 最后采集时间 */
  lastFetchedAt: z.string().optional(),
});

/** 仓库信息类型 */
export type Repository = z.infer<typeof repositorySchema>;

/**
 * 仓库分块统计 Schema
 */
export const chunkStatsSchema = z.object({
  /** 总分块数 */
  total: z.number(),
  /** README 分块数 */
  readme: z.number(),
  /** Issues 分块数 */
  issues: z.number(),
  /** Commits 分块数 */
  commits: z.number(),
});

/** 仓库分块统计类型 */
export type ChunkStats = z.infer<typeof chunkStatsSchema>;

/**
 * 仓库详情 Schema
 * @description 包含完整信息的仓库详情，包括分块统计和 README
 */
export const repositoryDetailSchema = z.object({
  /** 仓库唯一标识 */
  id: z.number(),
  /** GitHub 仓库全名 (owner/repo) */
  fullName: z.string(),
  /** 仓库名 */
  name: z.string(),
  /** 仓库所有者 */
  owner: z.string(),
  /** 仓库描述 */
  description: z.string().nullable().optional(),
  /** GitHub URL */
  url: z.string(),
  /** Stars 数量（可为 null） */
  stars: z.number().nullable(),
  /** Forks 数量（可为 null） */
  forks: z.number().nullable(),
  /** 开放 Issues 数量（可为 null） */
  openIssues: z.number().nullable(),
  /** 主要语言 */
  language: z.string().nullable().optional(),
  /** 许可证 */
  license: z.string().nullable().optional(),
  /** README 内容（原始 markdown） */
  readme: z.string().nullable().optional(),
  /** README 的 raw URL */
  readmeUrl: z.string().nullable().optional(),
  /** 最后采集时间 */
  lastFetchedAt: z.string().nullable().optional(),
  /** 创建时间 */
  createdAt: z.string(),
  /** 分块统计 */
  chunkStats: chunkStatsSchema,
});

/** 仓库详情类型 */
export type RepositoryDetail = z.infer<typeof repositoryDetailSchema>;

// ============================================================================
// 语义搜索类型 (Semantic Search Types)
// ============================================================================

/**
 * 语义搜索请求 Schema
 * @description 发起语义搜索的请求参数
 */
export const semanticSearchRequestSchema = z.object({
  /** 仓库名称 (格式: owner/repo) */
  repo: z.string().min(1, "仓库名称不能为空"),
  /** 用户搜索查询 */
  query: z.string().min(1, "查询内容不能为空"),
  /** 返回结果数量 (1-20，默认 5) */
  limit: z.number().min(1).max(20).default(5),
  /** 是否生成 AI 综合回答 (默认 true) */
  generateAnswer: z.boolean().default(true),
});

/** 语义搜索请求类型 */
export type SemanticSearchRequest = z.infer<typeof semanticSearchRequestSchema>;

/**
 * 搜索结果分块 Schema
 * @description 单个搜索结果分块的信息
 */
export const searchResultChunkSchema = z.object({
  /** 分块唯一标识 */
  id: z.number(),
  /** 分块内容 */
  content: z.string(),
  /** 分块类型 */
  chunkType: z.enum(["readme", "issues", "commits", "description", "hackernews"]),
  /** 来源标识 (issue number, commit sha, etc) */
  sourceId: z.string().optional(),
  /** 分块序号 */
  chunkIndex: z.number(),
  /** token 数量 */
  tokenCount: z.number().optional(),
  /** 相似度分数 (可选) */
  similarity: z.number().optional(),
});

/** 搜索结果分块类型 */
export type SearchResultChunk = z.infer<typeof searchResultChunkSchema>;

/**
 * 搜索结果中的仓库信息 Schema
 */
export const searchResultRepositorySchema = z.object({
  /** 仓库唯一标识 */
  id: z.number(),
  /** 仓库全名 */
  fullName: z.string(),
  /** 仓库名称 */
  name: z.string(),
  /** 仓库所有者 */
  owner: z.string(),
  /** 仓库描述 */
  description: z.string().optional(),
});

/** 搜索结果中的仓库信息类型 */
export type SearchResultRepository = z.infer<typeof searchResultRepositorySchema>;

/**
 * 语义搜索响应 Schema
 * @description 语义搜索 API 的完整响应结构
 */
export const semanticSearchResponseSchema = z.object({
  /** 查询的仓库信息 */
  repository: searchResultRepositorySchema,
  /** 匹配的分块列表 */
  chunks: z.array(searchResultChunkSchema),
  /** AI 生成的综合回答 */
  answer: z.string().optional(),
  /** 搜索耗时 (毫秒) */
  duration: z.number(),
});

/** 语义搜索响应类型 */
export type SemanticSearchResponse = z.infer<typeof semanticSearchResponseSchema>;

// ============================================================================
// OSSInsight 类型 (OSSInsight Types)
// ============================================================================

/**
 * 事件类型枚举
 */
export const eventTypeSchema = z.enum([
  "fork",
  "star",
  "issues",
  "pull_request",
  "commit",
  "watch",
]);

/** 事件类型 */
export type EventType = z.infer<typeof eventTypeSchema>;

/**
 * 趋势仓库 Schema
 */
export const trendingRepoSchema = z.object({
  /** 仓库全名 */
  fullName: z.string(),
  /** 仓库名 */
  name: z.string(),
  /** 所有者 */
  owner: z.string(),
  /** 描述 */
  description: z.string().nullable(),
  /** Stars 数量 */
  stars: z.number(),
  /** Forks 数量 */
  forks: z.number(),
  /** 开放 Issues 数量 */
  openIssues: z.number(),
  /** 主要语言 */
  language: z.string().nullable(),
  /** 新增 Stars 数量 */
  starsSince: z.number(),
  /** 贡献者数量 */
  contributors: z.number(),
  /** Pull Requests 数量 */
  pullRequests: z.number(),
});

/** 趋势仓库类型 */
export type TrendingRepo = z.infer<typeof trendingRepoSchema>;

/**
 * 仓库事件统计 Schema
 */
export const repoEventSchema = z.object({
  /** 事件 ID */
  id: z.number(),
  /** 事件类型 */
  eventType: eventTypeSchema,
  /** 事件数量 */
  count: z.number(),
  /** 日期 (ISO 8601) */
  date: z.string(),
});

/** 仓库事件类型 */
export type RepoEvent = z.infer<typeof repoEventSchema>;

/**
 * 贡献者统计 Schema
 */
export const contributorStatsSchema = z.object({
  /** 用户登录名 */
  login: z.string(),
  /** 用户名称 */
  name: z.string().nullable(),
  /** 头像 URL */
  avatar: z.string(),
  /** 提交次数 */
  commits: z.number(),
  /** 代码增加行数 */
  additions: z.number(),
  /** 代码删除行数 */
  deletions: z.number(),
  /** 创建的 PR 数量 */
  prsCreated: z.number(),
  /** 合并的 PR 数量 */
  prsMerged: z.number(),
  /** 创建的 Issue 数量 */
  issuesCreated: z.number(),
  /** 评论的 Issue 数量 */
  issuesCommented: z.number(),
});

/** 贡献者统计类型 */
export type ContributorStats = z.infer<typeof contributorStatsSchema>;

/**
 * 创建者统计 Schema
 */
export const creatorStatsSchema = z.object({
  /** 用户登录名 */
  login: z.string(),
  /** 用户名称 */
  name: z.string().nullable(),
  /** 头像 URL */
  avatar: z.string(),
  /** 创建数量 */
  count: z.number(),
  /** 平均响应时间（小时） */
  averageTime: z.number().nullable(),
});

/** 创建者统计类型 */
export type CreatorStats = z.infer<typeof creatorStatsSchema>;

/**
 * 仓库统计数据 Schema
 */
export const repoStatsSchema = z.object({
  /** Stars 历史数据 */
  starsHistory: z.array(repoEventSchema),
  /** Forks 历史数据 */
  forksHistory: z.array(repoEventSchema),
  /** Issues 历史数据 */
  issuesHistory: z.array(repoEventSchema),
  /** PR 历史数据 */
  prHistory: z.array(repoEventSchema),
  /** Commits 历史数据 */
  commitHistory: z.array(repoEventSchema),
  /** 贡献者列表 */
  contributors: z.array(contributorStatsSchema),
  /** Issue 创建者排名 */
  topIssueCreators: z.array(creatorStatsSchema),
  /** PR 创建者排名 */
  topPRCreators: z.array(creatorStatsSchema),
});

/** 仓库统计数据类型 */
export type RepoStats = z.infer<typeof repoStatsSchema>;

/**
 * Stargazer Schema
 */
export const stargazerSchema = z.object({
  /** 用户登录名 */
  login: z.string(),
  /** 用户名称 */
  name: z.string().nullable(),
  /** 头像 URL */
  avatar: z.string(),
  /** Star 时间 */
  starredAt: z.string(),
});

/** Stargazer 类型 */
export type Stargazer = z.infer<typeof stargazerSchema>;

/**
 * 集合统计 Schema
 */
export const collectionStatsSchema = z.object({
  /** 总仓库数量 */
  totalCount: z.number(),
  /** 仓库列表 */
  repositories: z.array(trendingRepoSchema),
  /** 更新时间 */
  updatedSince: z.string(),
});

/** 集合统计类型 */
export type CollectionStats = z.infer<typeof collectionStatsSchema>;

/**
 * 仓库洞察 Schema
 * @description 仓库的综合分析结果
 */
export const repoInsightsSchema = z.object({
  /** 仓库统计数据 */
  stats: repoStatsSchema,
  /** 顶级贡献者 */
  topContributors: z.array(contributorStatsSchema),
  /** 顶级 Issue 创建者 */
  topIssueCreators: z.array(creatorStatsSchema),
  /** 顶级 PR 创建者 */
  topPRCreators: z.array(creatorStatsSchema),
});

/** 仓库洞察类型 */
export type RepoInsights = z.infer<typeof repoInsightsSchema>;

/**
 * 趋势仓库请求 Schema
 */
export const trendingReposRequestSchema = z.object({
  /** 返回数量限制 (1-50) */
  limit: z.number().min(1).max(50).default(10),
  /** 时间周期 */
  period: z.enum(["24h", "7d", "30d"]).default("7d"),
  /** 编程语言过滤 */
  language: z.string().optional(),
});

/** 趋势仓库请求类型 */
export type TrendingReposRequest = z.infer<typeof trendingReposRequestSchema>;

/**
 * 仓库洞察请求 Schema
 */
export const repoInsightsRequestSchema = z.object({
  /** 仓库所有者 */
  owner: z.string().min(1),
  /** 仓库名称 */
  repo: z.string().min(1),
  /** 历史天数 */
  days: z.number().min(1).max(365).default(30),
  /** 贡献者数量限制 */
  contributorsLimit: z.number().min(1).max(100).default(10),
});

/** 仓库洞察请求类型 */
export type RepoInsightsRequest = z.infer<typeof repoInsightsRequestSchema>;
