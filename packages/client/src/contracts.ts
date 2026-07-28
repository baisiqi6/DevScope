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
