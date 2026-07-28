import {
  collectionResultSchema,
  repositoryDetailSchema,
  repositoryGroupSchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
} from "@devscope/shared";
import { z } from "zod";

export const healthResultSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type HealthResult = z.infer<typeof healthResultSchema>;

export const repositorySummarySchema = z.object({
  id: z.number(),
  fullName: z.string(),
  name: z.string(),
  owner: z.string(),
  description: z.string().nullable().optional(),
  url: z.string(),
  stars: z.number().nullable(),
  forks: z.number().nullable(),
  openIssues: z.number().nullable(),
  language: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  lastFetchedAt: z.string().nullable().optional(),
  starredAt: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export type RepositorySummary = z.infer<typeof repositorySummarySchema>;

export const repositoryListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type RepositoryListInput = z.input<typeof repositoryListInputSchema>;

export const collectRepositoryInputSchema = z.object({
  repo: z.string().trim().min(1),
  skipEmbeddings: z.boolean().optional(),
});

export type CollectRepositoryInput = z.infer<typeof collectRepositoryInputSchema>;

export const embeddingStatusSchema = z.object({
  repoId: z.number(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  progress: z.number(),
  totalChunks: z.number(),
  completedChunks: z.number(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export type EmbeddingStatus = z.infer<typeof embeddingStatusSchema>;

export const repositoryGroupListSchema = z.array(repositoryGroupSchema);

export const updateRepoNoteResultSchema = z.object({
  success: z.boolean(),
});

export type UpdateRepoNoteResult = z.infer<typeof updateRepoNoteResultSchema>;

export const groupWithMembersSchema = z.object({
  id: z.number(),
  userId: z.number(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  repoCount: z.number(),
  members: z.array(z.object({
    id: z.number(),
    groupId: z.number(),
    repoId: z.number(),
    orderIndex: z.number(),
    createdAt: z.string(),
    repository: z.unknown().nullable(),
  })),
});

export type GroupWithMembers = z.infer<typeof groupWithMembersSchema>;

export const createGroupInputSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().optional(),
});

export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;

export const createGroupResultSchema = z.object({
  id: z.number(),
  userId: z.number(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  repoCount: z.number(),
});

export type CreateGroupResult = z.infer<typeof createGroupResultSchema>;

export const groupMemberResultSchema = z.object({
  id: z.number(),
  groupId: z.number(),
  repoId: z.number(),
  orderIndex: z.number(),
  createdAt: z.string(),
});

export type GroupMemberResult = z.infer<typeof groupMemberResultSchema>;

export const removeRepoFromGroupResultSchema = z.object({
  success: z.boolean(),
});

export type RemoveRepoFromGroupResult = z.infer<typeof removeRepoFromGroupResultSchema>;

export const startHealthAnalysisResultSchema = z.object({
  executionId: z.string(),
  deduplicated: z.boolean(),
});

export type StartHealthAnalysisResult = z.infer<typeof startHealthAnalysisResultSchema>;

export const analysisStatusSchema = z.object({
  executionId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  progressPercent: z.number().nullable(),
  currentNode: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

export const healthReportSchema = z.object({
  reportId: z.string(),
  reportType: z.string(),
  reportData: z.unknown(),
  summary: z.string().nullable(),
  createdAt: z.string(),
}).nullable();

export type HealthReport = z.infer<typeof healthReportSchema>;

export {
  collectionResultSchema,
  repositoryDetailSchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
};

export type {
  CollectionResult,
  RepositoryDetail,
  RepositoryGroup,
  SemanticSearchRequest,
  SemanticSearchResponse,
} from "@devscope/shared";
