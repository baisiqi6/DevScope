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
// 外部资源类型 (External Resource Types)
// ============================================================================

export const externalResourceTypeSchema = z.enum(["article", "paper", "website"]);
export type ExternalResourceType = z.infer<typeof externalResourceTypeSchema>;

export const externalResourceIngestionModeSchema = z.enum(["preview_only", "content"]);
export type ExternalResourceIngestionMode = z.infer<typeof externalResourceIngestionModeSchema>;

export const externalResourceContentStatusSchema = z.enum([
  "not_requested",
  "pending",
  "processing",
  "completed",
  "failed",
]);
export type ExternalResourceContentStatus = z.infer<typeof externalResourceContentStatusSchema>;

export const requestExternalResourceContentInputSchema = z.object({ resourceId: z.number().int().positive() });
/** 显式开启正文采集；该动作只允许 preview_only -> content。 */
export const enableExternalResourceContentInputSchema = z.object({ resourceId: z.number().int().positive() });
export const externalResourceContentStatusOutputSchema = z.object({
  resourceId: z.number().int().positive(),
  status: externalResourceContentStatusSchema,
  error: z.string().max(500).nullable(),
  fetchedAt: z.string().datetime().nullable(),
});
export const enableExternalResourceContentOutputSchema = z.object({
  resourceId: z.number().int().positive(),
  ingestionMode: z.literal("content"),
  status: externalResourceContentStatusSchema,
  error: z.string().max(500).nullable(),
  fetchedAt: z.string().datetime().nullable(),
});
export const externalResourceContentOutputSchema = externalResourceContentStatusOutputSchema.extend({
  contentType: z.enum(["html", "pdf"]),
  text: z.string().max(1_000_000),
  finalUrl: z.string().url().optional(),
});

export const externalResourceUrlSchema = z.string().trim().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "只支持 http 或 https URL" });
  }
  if (url.username || url.password) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "URL 不得包含用户名或密码" });
  }
});

export const externalResourceTagsSchema = z.array(z.string().trim().min(1).max(50)).max(30).default([]);
export const externalResourceMetadataSchema = z.record(z.unknown()).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 20_000,
  "metadata 不能超过 20KB",
);

export const saveExternalResourceInputSchema = z.object({
  url: externalResourceUrlSchema,
  resourceType: externalResourceTypeSchema,
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  siteName: z.string().trim().max(200).optional(),
  author: z.string().trim().max(200).optional(),
  publishedAt: z.string().datetime().optional(),
  faviconUrl: externalResourceUrlSchema.optional(),
  previewImageUrl: externalResourceUrlSchema.optional(),
  metadata: externalResourceMetadataSchema.optional(),
  tags: externalResourceTagsSchema,
  notes: z.string().max(5000).optional(),
});
export type SaveExternalResourceInput = z.infer<typeof saveExternalResourceInputSchema>;

export const updateExternalResourceInputSchema = z.object({
  resourceId: z.number().int().positive(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  siteName: z.string().trim().max(200).nullable().optional(),
  author: z.string().trim().max(200).nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  faviconUrl: externalResourceUrlSchema.nullable().optional(),
  previewImageUrl: externalResourceUrlSchema.nullable().optional(),
  metadata: externalResourceMetadataSchema.nullable().optional(),
  tags: externalResourceTagsSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
  isRead: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});
export type UpdateExternalResourceInput = z.infer<typeof updateExternalResourceInputSchema>;

/** 仓库许可证语义分类；unknown 表示信息不足，禁止当作标准开源。 */
export const repositoryLicenseStatusSchema = z.enum([
  "standard_open_source",
  "source_available",
  "no_license",
  "unknown",
]);
export type RepositoryLicenseStatus = z.infer<typeof repositoryLicenseStatusSchema>;

// SPDX 标识不是任意字符串都能视为开源许可。这里只允许常见的 SPDX
// License List/OSI 标准标识；LicenseRef-*、FOO、OTHER 等保守归为 unknown。
const STANDARD_OPEN_SOURCE_SPDX_IDS = new Set([
  "0BSD", "AFL-2.1", "AFL-3.0", "AGPL-3.0", "AGPL-3.0-ONLY", "AGPL-3.0-OR-LATER",
  "APACHE-1.1", "APACHE-2.0", "ARTISTIC-2.0", "BSD-1-CLAUSE", "BSD-2-CLAUSE", "BSD-2-CLAUSE-PATENT",
  "BSD-3-CLAUSE", "BSD-3-CLAUSE-CLEAR", "BSD-4-CLAUSE",
  "CC0-1.0", "CDDL-1.0", "CERN-OHL-P-2.0", "CERN-OHL-S-2.0", "CPL-1.0", "ECL-2.0", "EFL-2.0",
  "EPL-1.0", "EPL-2.0", "EUPL-1.2", "GPL-2.0", "GPL-2.0-ONLY", "GPL-2.0-OR-LATER", "GPL-3.0",
  "GPL-3.0-ONLY", "GPL-3.0-OR-LATER", "ISC", "LGPL-2.0", "LGPL-2.0-ONLY", "LGPL-2.0-OR-LATER",
  "LGPL-2.1", "LGPL-2.1-ONLY", "LGPL-2.1-OR-LATER", "LGPL-3.0", "LGPL-3.0-ONLY", "LGPL-3.0-OR-LATER",
  "MIT", "MPL-1.1", "MPL-2.0", "MS-PL", "NCSA", "OFL-1.1", "OSL-3.0", "POSTGRESQL", "PYTHON-2.0",
  "QPL-1.0", "RPL-1.5", "WTFPL", "X11", "XNET", "ZLIB", "UNLICENSE",
]);

export function classifyRepositoryLicense(
  spdxId: string | null | undefined,
  licenseText?: string | null,
): RepositoryLicenseStatus {
  const normalizedSpdx = spdxId?.trim().toUpperCase();
  if (normalizedSpdx && STANDARD_OPEN_SOURCE_SPDX_IDS.has(normalizedSpdx)) {
    return "standard_open_source";
  }
  if (licenseText === null || licenseText === undefined || licenseText.trim() === "") {
    return normalizedSpdx ? "unknown" : "no_license";
  }
  const text = licenseText.toLowerCase();
  if (
    /business source license|\bbsl\b|commons clause|non-production|not for production|hosted service|commercial use/.test(text)
  ) {
    return "source_available";
  }
  return "unknown";
}

export const externalResourceOutputSchema = z.object({
  id: z.number(),
  resourceType: externalResourceTypeSchema,
  url: externalResourceUrlSchema,
  canonicalUrl: externalResourceUrlSchema,
  title: z.string(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
  author: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  faviconUrl: externalResourceUrlSchema.nullable(),
  previewImageUrl: externalResourceUrlSchema.nullable(),
  metadata: externalResourceMetadataSchema.nullable(),
  ingestionMode: externalResourceIngestionModeSchema,
  contentStatus: externalResourceContentStatusSchema,
  contentFetchedAt: z.string().datetime().nullable(),
  contentError: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  isRead: z.boolean(),
  isPinned: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExternalResource = z.infer<typeof externalResourceOutputSchema>;

export const externalResourceGroupOutputSchema = z.object({
  id: z.number(),
  userId: z.number(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number(),
  resourceCount: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExternalResourceGroup = z.infer<typeof externalResourceGroupOutputSchema>;

export const externalResourceGroupMemberOutputSchema = z.object({
  id: z.number(),
  groupId: z.number(),
  resourceId: z.number(),
  orderIndex: z.number(),
  createdAt: z.string().datetime(),
  resource: externalResourceOutputSchema,
});
export type ExternalResourceGroupMember = z.infer<typeof externalResourceGroupMemberOutputSchema>;

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
 * 风险类别枚举
 */
export const riskCategorySchema = z.enum(["technical", "community", "business", "compliance"]);

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
  category: riskCategorySchema,
  /** 风险描述 */
  description: z.string(),
  /** 严重程度（0-100，0 表示无风险） */
  severity: z.number().min(0).max(100),
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
  /** 潜在影响（0-100，0 表示无机会） */
  potential: z.number().min(0).max(100),
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
  /** 向量化是否在后台进行 */
  embeddingInBackground: z.boolean().optional(),
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
  description: z.string().nullable().optional(),
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
  /** 关注时间（用户 star 该仓库的时间） */
  starredAt: z.string().optional(),
  /** 用户自定义备注 */
  note: z.string().optional(),
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
  /** 用户自定义备注 */
  note: z.string().nullable().optional(),
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
  /** 许可证语义分类 */
  licenseStatus: repositoryLicenseStatusSchema,
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
// Agent Workflow 类型 (Agent Workflow Types)
// ============================================================================

/**
 * SSE 事件类型枚举
 */
export const sseEventTypeSchema = z.enum([
  "init",
  "thinking",
  "tool_use",
  "tool_result",
  "text",
  "report",
  "complete",
  "terminal",
]);

/** SSE 事件类型 */
export type SSEEventType = z.infer<typeof sseEventTypeSchema>;

/**
 * SSE 思考事件数据
 */
export const thinkingEventDataSchema = z.object({
  text: z.string(),
  timestamp: z.string(),
});

/**
 * SSE 工具使用事件数据
 */
export const toolUseEventDataSchema = z.object({
  name: z.string(),
  input: z.record(z.unknown()),
  timestamp: z.string(),
});

/**
 * SSE 工具结果事件数据
 */
export const toolResultEventDataSchema = z.object({
  name: z.string(),
  result: z.unknown(),
  timestamp: z.string(),
});

/**
 * SSE 文本事件数据
 */
export const textEventDataSchema = z.object({
  text: z.string(),
  timestamp: z.string(),
});

/**
 * SSE 报告事件数据
 */
export const reportEventDataSchema = z.object({
  reportId: z.string(),
  reportPath: z.string(),
  summary: z.string(),
  timestamp: z.string(),
});

/**
 * SSE 完成事件数据
 */
export const completeEventDataSchema = z.object({
  executionId: z.string(),
  status: z.enum(["completed", "failed", "cancelled"]),
  error: z.string().optional(),
  timestamp: z.string(),
});

/**
 * SSE 终端输出事件数据
 */
export const terminalEventDataSchema = z.object({
  /** 输出级别 */
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  /** 输出内容 */
  message: z.string(),
  /** 时间戳 */
  timestamp: z.string(),
  /** 源标签（可选，用于标识输出来源） */
  source: z.string().optional(),
});

/**
 * SSE 初始化事件数据
 */
export const initEventDataSchema = z.object({
  executionId: z.string(),
  timestamp: z.string(),
});

/**
 * SSE 事件 Schema (联合类型)
 */
export const agentWorkflowEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("init"),
    data: initEventDataSchema,
  }),
  z.object({
    type: z.literal("thinking"),
    data: thinkingEventDataSchema,
  }),
  z.object({
    type: z.literal("tool_use"),
    data: toolUseEventDataSchema,
  }),
  z.object({
    type: z.literal("tool_result"),
    data: toolResultEventDataSchema,
  }),
  z.object({
    type: z.literal("text"),
    data: textEventDataSchema,
  }),
  z.object({
    type: z.literal("report"),
    data: reportEventDataSchema,
  }),
  z.object({
    type: z.literal("complete"),
    data: completeEventDataSchema,
  }),
  z.object({
    type: z.literal("terminal"),
    data: terminalEventDataSchema,
  }),
]);

/** SSE 事件类型 */
export type AgentWorkflowEvent = z.infer<typeof agentWorkflowEventSchema>;

/**
 * Agent 工作流请求 Schema
 */
export const agentWorkflowRequestSchema = z.object({
  /** 要分析的仓库列表 (owner/repo) */
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "格式应为 owner/repo")).min(1).max(20),
  /** 分析类型 */
  analysisType: z.enum(["competitive_landscape", "health_report", "single_repo"]),
  /** 额外上下文 */
  context: z.string().max(20_000).optional(),
});

/** Agent 工作流请求类型 */
export type AgentWorkflowRequest = z.infer<typeof agentWorkflowRequestSchema>;

// ============================================================================
// 竞争分析报告类型 (Competitive Analysis Report Types)
// ============================================================================

/**
 * 分析类型枚举
 */
export const analysisTypeEnumSchema = z.enum([
  "competitive_landscape",
  "health_report",
  "single_repo",
]);

/**
 * 投资建议枚举
 */
export const investmentRecommendationSchema = z.enum(["invest", "watch", "avoid", "mixed"]);

/**
 * 置信度枚举
 */
export const confidenceLevelSchema = z.enum(["high", "medium", "low"]);

/**
 * 风险等级枚举
 */
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

/**
 * 数据来源类型枚举
 */
export const dataSourceTypeSchema = z.enum(["github_api", "ossinsight", "ai_analysis"]);

/**
 * 执行摘要 Schema
 */
export const executiveSummarySchema = z.object({
  /** 概述 */
  overview: z.string(),
  /** 关键发现 */
  keyFindings: z.array(z.string()),
  /** 投资建议 */
  recommendation: investmentRecommendationSchema,
  /** 置信度 */
  confidenceLevel: confidenceLevelSchema,
});

/**
 * 市场定位 Schema
 */
export const marketPositionSchema = z.object({
  /** 领导者 */
  leaders: z.array(z.string()),
  /** 挑战者 */
  challengers: z.array(z.string()),
  /** 细分市场 */
  niche: z.array(z.string()),
  /** 新兴项目 */
  emerging: z.array(z.string()),
});

/**
 * 技术对比项 Schema
 */
export const technologyComparisonItemSchema = z.object({
  /** 仓库 */
  repo: z.string(),
  /** 编程语言 */
  language: z.string().nullable(),
  /** 许可证 */
  license: z.string().nullable(),
  /** Stars 数 */
  stars: z.number(),
  /** Forks 数 */
  forks: z.number(),
  /** 活跃度 */
  activityLevel: z.enum(["high", "medium", "low", "dead"]),
});

/**
 * 社区指标项 Schema
 */
export const communityMetricItemSchema = z.object({
  /** 仓库 */
  repo: z.string(),
  /** 近期提交样本中的不同作者数量 */
  contributorCount: z.number(),
  /** AI 估算的 Issue 解决率（百分比 0-100） */
  issueResolutionRate: z.number(),
  /** 提交频率 */
  commitFrequency: z.enum(["daily", "weekly", "monthly", "sporadic"]),
});

/**
 * 详细分析 Schema
 */
export const detailedAnalysisSchema = z.object({
  /** 市场定位 */
  marketPosition: marketPositionSchema,
  /** 技术对比 */
  technologyComparison: z.array(technologyComparisonItemSchema),
  /** 社区指标 */
  communityMetrics: z.array(communityMetricItemSchema),
});

/**
 * 风险项 Schema
 */
export const riskItemSchema = z.object({
  /** 仓库 */
  repo: z.string(),
  /** 风险类别 */
  category: riskCategorySchema,
  /** 描述 */
  description: z.string(),
  /** 严重程度 (0-100) */
  severity: z.number().min(0).max(100),
  /** 缓解措施 */
  mitigation: z.string().optional(),
});

/**
 * 风险矩阵 Schema
 */
export const riskMatrixSchema = z.object({
  /** 总体风险等级 */
  overallRisk: riskLevelSchema,
  /** 风险列表 */
  risks: z.array(riskItemSchema),
});

/**
 * 投资建议详情 Schema
 */
export const investmentRecommendationsDetailSchema = z.object({
  /** 首选项目 */
  topPick: z.string().optional(),
  /** 关注列表 */
  watchList: z.array(z.string()),
  /** 规避列表 */
  avoidList: z.array(z.string()),
  /** 理由 */
  rationale: z.string(),
});

/**
 * 数据来源项 Schema
 */
export const dataSourceItemSchema = z.object({
  /** 来源类型 */
  type: dataSourceTypeSchema,
  /** 仓库 */
  repo: z.string(),
  /** 时间戳 */
  timestamp: z.string(),
  /** 详情 */
  details: z.string(),
});

/**
 * 工具输出记录 Schema
 */
export const toolOutputRecordSchema = z.object({
  /** 工具名称 */
  tool: z.string(),
  /** 输入 */
  input: z.record(z.unknown()),
  /** 输出 */
  output: z.unknown(),
  /** 时间戳 */
  timestamp: z.string(),
});

/**
 * 竞争分析报告 Schema
 */
export const competitiveAnalysisReportSchema = z.object({
  // 元数据
  /** 报告 ID */
  reportId: z.string(),
  /** 执行 ID */
  executionId: z.string(),
  /** 生成时间 */
  generatedAt: z.string(),
  /** 分析类型 */
  analysisType: analysisTypeEnumSchema,

  // AI 详细分析 (Agent 生成的完整文本报告)
  /** AI 详细分析内容 */
  aiAnalysis: z.string().optional(),

  // 执行摘要
  /** 执行摘要 */
  executiveSummary: executiveSummarySchema,

  // 详细分析
  /** 详细分析 */
  detailedAnalysis: detailedAnalysisSchema,

  // 风险矩阵
  /** 风险矩阵 */
  riskMatrix: riskMatrixSchema,

  // 投资建议
  /** 投资建议 */
  investmentRecommendations: investmentRecommendationsDetailSchema,

  // 数据来源 (可追溯性)
  /** 数据来源列表 */
  dataSources: z.array(dataSourceItemSchema),

  // 工具输出记录
  /** 工具输出记录 */
  toolOutputs: z.array(toolOutputRecordSchema),
});

/** 竞争分析报告类型 */
export type CompetitiveAnalysisReport = z.infer<typeof competitiveAnalysisReportSchema>;

/** 执行摘要类型 */
export type ExecutiveSummary = z.infer<typeof executiveSummarySchema>;

/** 详细分析类型 */
export type DetailedAnalysis = z.infer<typeof detailedAnalysisSchema>;

/** 风险矩阵类型 */
export type RiskMatrix = z.infer<typeof riskMatrixSchema>;

/** 投资建议详情类型 */
export type InvestmentRecommendationsDetail = z.infer<typeof investmentRecommendationsDetailSchema>;

// ============================================================================
// 仓库分组类型 (Repository Groups)
// ============================================================================

/**
 * 仓库分组 Schema
 */
export const repositoryGroupSchema = z.object({
  /** 分组 ID */
  id: z.number(),
  /** 用户 ID */
  userId: z.number(),
  /** 父分组 ID；null 表示根分组 */
  parentId: z.number().nullable().optional(),
  /** 分组名称 */
  name: z.string().min(1).max(50),
  /** 分组颜色 */
  color: z.string().default("blue"),
  /** 分组图标 */
  icon: z.string().default("folder"),
  /** 分组描述 */
  description: z.string().nullable().optional(),
  /** 显示顺序 */
  orderIndex: z.number(),
  /** 创建时间 */
  createdAt: z.string(),
  /** 更新时间 */
  updatedAt: z.string(),
  /** 分组内的仓库数量（扩展字段，查询时计算） */
  repoCount: z.number().optional(),
  /** 直接加入当前分组的仓库数量 */
  directRepoCount: z.number().optional(),
  /** 当前分组及全部后代中的仓库去重数量 */
  aggregateRepoCount: z.number().optional(),
});

/** 仓库分组类型 */
export type RepositoryGroup = z.infer<typeof repositoryGroupSchema>;

/** 树接口使用的严格分组节点；兼容扁平接口仍使用 repositoryGroupSchema。 */
export type RepositoryGroupTreeNode = RepositoryGroup & {
  parentId: number | null;
  repoCount: number;
  directRepoCount: number;
  aggregateRepoCount: number;
  children: RepositoryGroupTreeNode[];
};

export const repositoryGroupTreeNodeSchema: z.ZodType<RepositoryGroupTreeNode> = z.lazy(() =>
  repositoryGroupSchema.extend({
    parentId: z.number().nullable(),
    color: z.string(),
    icon: z.string(),
    repoCount: z.number(),
    directRepoCount: z.number(),
    aggregateRepoCount: z.number(),
    children: z.array(repositoryGroupTreeNodeSchema),
  }),
);

export const repositoryGroupTreeSchema = z.array(repositoryGroupTreeNodeSchema);

/**
 * 分组成员 Schema
 */
export const groupMemberSchema = z.object({
  /** 成员记录 ID */
  id: z.number(),
  /** 分组 ID */
  groupId: z.number(),
  /** 仓库 ID */
  repoId: z.number(),
  /** 在分组内的顺序 */
  orderIndex: z.number(),
  /** 添加时间 */
  createdAt: z.string(),
});

/** 分组成员类型 */
export type GroupMember = z.infer<typeof groupMemberSchema>;

/**
 * 分组颜色枚举
 */
export const groupColorEnum = z.enum(["blue", "green", "purple", "orange", "red", "pink"]);

/** 分组颜色类型 */
export type GroupColor = z.infer<typeof groupColorEnum>;

/**
 * 创建分组请求 Schema
 */
export const createGroupSchema = z.object({
  /** 分组名称 */
  name: z.string().min(1).max(50),
  /** 分组颜色 */
  color: groupColorEnum.optional(),
  /** 分组图标 */
  icon: z.string().optional(),
  /** 分组描述 */
  description: z.string().optional(),
  /** 父分组 ID；省略或 null 时创建根分组 */
  parentId: z.number().int().positive().nullable().optional(),
});

/** 创建分组请求类型 */
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

/**
 * 更新分组请求 Schema
 */
export const updateGroupSchema = z.object({
  /** 分组 ID */
  groupId: z.number().int().positive(),
  /** 分组名称 */
  name: z.string().min(1).max(50).optional(),
  /** 分组颜色 */
  color: groupColorEnum.optional(),
  /** 分组图标 */
  icon: z.string().optional(),
  /** 分组描述 */
  description: z.string().optional(),
});

/** 更新分组请求类型 */
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

/** 移动分组请求 Schema */
export const moveGroupSchema = z.object({
  groupId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable(),
});

export type MoveGroupInput = z.infer<typeof moveGroupSchema>;

/** 同级分组完整重排请求 Schema */
export const reorderGroupSiblingsSchema = z.object({
  parentId: z.number().int().positive().nullable(),
  groupIds: z.array(z.number().int().positive()),
});

export type ReorderGroupSiblingsInput = z.infer<typeof reorderGroupSiblingsSchema>;

/** 父分组聚合成员查询输入 */
export const aggregateGroupMembersInputSchema = z.object({
  groupId: z.number().int().positive(),
});

/**
 * 添加仓库到分组请求 Schema
 */
export const addGroupMemberSchema = z.object({
  /** 分组 ID */
  groupId: z.number(),
  /** 仓库 ID */
  repoId: z.number(),
});

/** 添加仓库到分组请求类型 */
export type AddGroupMemberInput = z.infer<typeof addGroupMemberSchema>;

/**
 * 批量添加仓库到分组请求 Schema
 */
export const batchAddGroupMembersSchema = z.object({
  /** 分组 ID */
  groupId: z.number(),
  /** 仓库 ID 列表 */
  repoIds: z.array(z.number()),
});

/** 批量添加仓库到分组请求类型 */
export type BatchAddGroupMembersInput = z.infer<typeof batchAddGroupMembersSchema>;

/**
 * 移动仓库到另一个分组请求 Schema
 */
export const moveGroupMemberSchema = z.object({
  /** 仓库 ID */
  repoId: z.number(),
  /** 源分组 ID */
  fromGroupId: z.number(),
  /** 目标分组 ID */
  toGroupId: z.number(),
});

/** 移动仓库到另一个分组请求类型 */
export type MoveGroupMemberInput = z.infer<typeof moveGroupMemberSchema>;

/**
 * 分组内仓库排序请求 Schema
 */
export const reorderGroupMembersSchema = z.object({
  /** 分组 ID */
  groupId: z.number(),
  /** 仓库 ID 列表（按新顺序排列） */
  repoIds: z.array(z.number()),
});

/** 分组内仓库排序请求类型 */
export type ReorderGroupMembersInput = z.infer<typeof reorderGroupMembersSchema>;

/**
 * 分组排序请求 Schema
 */
export const reorderGroupsSchema = z.object({
  /** 分组 ID 列表（按新顺序排列） */
  groupIds: z.array(z.number()),
});

/** 分组排序请求类型 */
export type ReorderGroupsInput = z.infer<typeof reorderGroupsSchema>;

// ============================================================================
// 仓库关系图谱类型 (Repo Graph Types)
// ============================================================================

export const similarityEvidenceSchema = z.object({
  kind: z.literal("similarity"),
  score: z.number(),
  pooledChunks: z.number(),
  chunkTypes: z.array(z.string()),
});

export const dependencyEvidenceSchema = z.object({
  kind: z.literal("dependency"),
  packages: z.array(
    z.object({
      system: z.string(),
      name: z.string(),
      version: z.string(),
    })
  ),
  resolvedBy: z.enum(["deps.dev", "tech-stack-catalog"]),
});

export const repoRelationshipEvidenceSchema = z.discriminatedUnion("kind", [
  similarityEvidenceSchema,
  dependencyEvidenceSchema,
]);

export type RepoRelationshipEvidence = z.infer<typeof repoRelationshipEvidenceSchema>;

export const repoGraphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["repo", "technology_stack", "language"]),
  fullName: z.string(),
  name: z.string(),
  language: z.string().nullable(),
  stars: z.number().nullable(),
  description: z.string().nullable(),
});

export const repoGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(["similarity", "dependency", "written_in"]),
  score: z.number().nullable(),
});

export const repoGraphSchema = z.object({
  nodes: z.array(repoGraphNodeSchema),
  edges: z.array(repoGraphEdgeSchema),
});

export type RepoGraphNode = z.infer<typeof repoGraphNodeSchema>;
export type RepoGraphEdge = z.infer<typeof repoGraphEdgeSchema>;
export type RepoGraph = z.infer<typeof repoGraphSchema>;

export const graphRebuildStageSchema = z.enum([
  "embedding",
  "similarity",
  "sbom",
  "deps_resolution",
  "github_canonicalization",
  "atomic_commit",
  "shadow_compare",
]);

export const graphRebuildProgressSchema = z.object({
  stage: graphRebuildStageSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  externalRequests: z.number().int().nonnegative(),
  timeouts: z.number().int().nonnegative(),
  retryableErrors: z.number().int().nonnegative(),
});

export const graphStageDurationSchema = z.object({
  stage: graphRebuildStageSchema,
  durationMs: z.number().int().nonnegative(),
});

export const graphBudgetUsageSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
});

export const rebuildRepoGraphResultSchema = z.object({
  similarityEdges: z.number(),
  dependencyEdges: z.number(),
  pooledRepos: z.number(),
  sbomBackfilled: z.number(),
  stages: z.array(graphStageDurationSchema).optional(),
  budget: z.object({
    depsDev: graphBudgetUsageSchema,
    github: graphBudgetUsageSchema,
  }).optional(),
});

export type GraphRebuildStage = z.infer<typeof graphRebuildStageSchema>;
export type GraphRebuildProgress = z.infer<typeof graphRebuildProgressSchema>;
export type GraphStageDuration = z.infer<typeof graphStageDurationSchema>;

/** 异步重建状态查询的响应；progress 向后兼容（旧 consumer 可忽略） */
export const rebuildGraphStatusSchema = z.object({
  status: z.enum(["idle", "running", "completed", "failed"]),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  result: rebuildRepoGraphResultSchema.nullable(),
  error: z.string().nullable(),
  progress: graphRebuildProgressSchema.nullable(),
});

export type RebuildGraphStatus = z.infer<typeof rebuildGraphStatusSchema>;

export type RebuildRepoGraphResult = z.infer<typeof rebuildRepoGraphResultSchema>;

export * from "./github-identity";

// ============================================================================
// GitHub Client (GitHub API 客户端)
// ============================================================================

export * from "./github-client";
