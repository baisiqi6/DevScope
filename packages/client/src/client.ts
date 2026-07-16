import { TRPCUntypedClient, httpBatchLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import type { z } from "zod";
import {
  collectRepositoryInputSchema,
  collectionResultSchema,
  embeddingStatusSchema,
  healthResultSchema,
  repositoryDetailSchema,
  repositoryGroupListSchema,
  repositoryListInputSchema,
  repositorySummarySchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
  type CollectRepositoryInput,
  type CollectionResult,
  type EmbeddingStatus,
  type HealthResult,
  type RepositoryDetail,
  type RepositoryGroup,
  type RepositoryListInput,
  type RepositorySummary,
  type SemanticSearchRequest,
  type SemanticSearchResponse,
} from "./contracts";
import {
  normalizeBaseUrl,
  resolveDevScopeConnection,
  type DevScopeEnvironment,
} from "./config";

export interface DevScopeClientOptions {
  baseUrl: string;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof globalThis.fetch;
}

export interface DevScopeClient {
  health(): Promise<HealthResult>;
  listRepositories(input?: RepositoryListInput): Promise<RepositorySummary[]>;
  getRepository(repoId: number): Promise<RepositoryDetail>;
  collectRepository(input: CollectRepositoryInput): Promise<CollectionResult>;
  getEmbeddingStatus(repoId: number): Promise<EmbeddingStatus>;
  semanticSearch(input: SemanticSearchRequest): Promise<SemanticSearchResponse>;
  listGroups(): Promise<RepositoryGroup[]>;
}

async function parseResult<TSchema extends z.ZodTypeAny>(
  promise: Promise<unknown>,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return schema.parse(await promise);
}

export function createDevScopeClient(options: DevScopeClientOptions): DevScopeClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const client = new TRPCUntypedClient<AnyTRPCRouter>({
    links: [
      httpBatchLink<AnyTRPCRouter>({
        url: `${baseUrl}/trpc`,
        headers: options.headers,
        fetch: options.fetch,
      }),
    ],
  });

  return {
    health: () => parseResult(client.query("health"), healthResultSchema),
    listRepositories: (input = {}) => {
      const parsedInput = repositoryListInputSchema.parse(input);
      return parseResult(
        client.query("getRepositories", parsedInput),
        repositorySummarySchema.array(),
      );
    },
    getRepository: (repoId) =>
      parseResult(client.query("getRepository", { id: repoId }), repositoryDetailSchema),
    collectRepository: (input) => {
      const parsedInput = collectRepositoryInputSchema.parse(input);
      return parseResult(
        client.mutation("collectRepository", parsedInput),
        collectionResultSchema,
      );
    },
    getEmbeddingStatus: (repoId) =>
      parseResult(
        client.query("getEmbeddingStatus", { repoId }),
        embeddingStatusSchema,
      ),
    semanticSearch: (input) => {
      const parsedInput = semanticSearchRequestSchema.parse(input);
      return parseResult(
        client.mutation("semanticSearch", parsedInput),
        semanticSearchResponseSchema,
      );
    },
    listGroups: () =>
      parseResult(client.query("groups.getAll"), repositoryGroupListSchema),
  };
}

export function createDevScopeClientFromEnv(
  env: DevScopeEnvironment = process.env,
): DevScopeClient {
  return createDevScopeClient(resolveDevScopeConnection(env));
}
