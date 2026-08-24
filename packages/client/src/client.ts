import { TRPCUntypedClient, httpBatchLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import type { z } from "zod";
import {
  analysisStatusSchema,
  aggregateGroupViewSchema,
  collectRepositoryInputSchema,
  collectionResultSchema,
  createGroupInputSchema,
  createGroupResultSchema,
  embeddingStatusSchema,
  groupMemberResultSchema,
  groupMutationSuccessSchema,
  groupWithMembersSchema,
  healthReportSchema,
  healthResultSchema,
  removeRepoFromGroupResultSchema,
  repositoryDetailSchema,
  repositoryGroupListSchema,
  repositoryGroupTreeSchema,
  repositoryListInputSchema,
  repositorySummarySchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
  startHealthAnalysisResultSchema,
  updateRepoNoteResultSchema,
  moveGroupResultSchema,
  type AnalysisStatus,
  type AggregateGroupView,
  type CollectRepositoryInput,
  type CollectionResult,
  type CreateGroupInput,
  type CreateGroupResult,
  type EmbeddingStatus,
  type GroupMemberResult,
  type GroupMutationSuccess,
  type GroupWithMembers,
  type HealthReport,
  type HealthResult,
  type RemoveRepoFromGroupResult,
  type RepositoryDetail,
  type RepositoryGroup,
  type RepositoryGroupTree,
  type RepositoryListInput,
  type RepositorySummary,
  type SemanticSearchRequest,
  type SemanticSearchResponse,
  type StartHealthAnalysisResult,
  type UpdateRepoNoteResult,
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
  getGroupTree(): Promise<RepositoryGroupTree>;
  updateRepoNote(repoId: number, note: string): Promise<UpdateRepoNoteResult>;
  getGroupWithMembers(groupId: number): Promise<GroupWithMembers>;
  getAggregateGroupWithMembers(groupId: number): Promise<AggregateGroupView>;
  createGroup(input: CreateGroupInput): Promise<CreateGroupResult>;
  moveGroup(groupId: number, parentId: number | null): Promise<RepositoryGroup>;
  reorderGroupSiblings(parentId: number | null, groupIds: number[]): Promise<GroupMutationSuccess>;
  addRepoToGroup(groupId: number, repoId: number): Promise<GroupMemberResult>;
  removeRepoFromGroup(groupId: number, repoId: number): Promise<RemoveRepoFromGroupResult>;
  startHealthAnalysis(repoFullName: string): Promise<StartHealthAnalysisResult>;
  getAnalysisStatus(executionId: string): Promise<AnalysisStatus>;
  getHealthReport(executionId: string): Promise<HealthReport>;
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
    getGroupTree: () =>
      parseResult(client.query("groups.getTree"), repositoryGroupTreeSchema),
    updateRepoNote: (repoId, note) =>
      parseResult(
        client.mutation("updateRepoNote", { repoId, note }),
        updateRepoNoteResultSchema,
      ),
    getGroupWithMembers: (groupId) =>
      parseResult(
        client.query("groups.getWithMembers", { groupId }),
        groupWithMembersSchema,
      ),
    getAggregateGroupWithMembers: (groupId) =>
      parseResult(
        client.query("groups.getAggregateWithMembers", { groupId }),
        aggregateGroupViewSchema,
      ),
    createGroup: (input) => {
      const parsedInput = createGroupInputSchema.parse(input);
      return parseResult(
        client.mutation("groups.create", parsedInput),
        createGroupResultSchema,
      );
    },
    moveGroup: (groupId, parentId) =>
      parseResult(
        client.mutation("groups.move", { groupId, parentId }),
        moveGroupResultSchema,
      ),
    reorderGroupSiblings: (parentId, groupIds) =>
      parseResult(
        client.mutation("groups.reorderSiblings", { parentId, groupIds }),
        groupMutationSuccessSchema,
      ),
    addRepoToGroup: (groupId, repoId) =>
      parseResult(
        client.mutation("groupMembers.add", { groupId, repoId }),
        groupMemberResultSchema,
      ),
    removeRepoFromGroup: (groupId, repoId) =>
      parseResult(
        client.mutation("groupMembers.remove", { groupId, repoId }),
        removeRepoFromGroupResultSchema,
      ),
    startHealthAnalysis: (repoFullName) =>
      parseResult(
        client.mutation("startHealthAnalysis", { repoFullName }),
        startHealthAnalysisResultSchema,
      ),
    getAnalysisStatus: (executionId) =>
      parseResult(
        client.query("getAnalysisStatus", { executionId }),
        analysisStatusSchema,
      ),
    getHealthReport: (executionId) =>
      parseResult(
        client.query("getHealthReport", { executionId }),
        healthReportSchema,
      ),
  };
}

export function createDevScopeClientFromEnv(
  env: DevScopeEnvironment = process.env,
): DevScopeClient {
  return createDevScopeClient(resolveDevScopeConnection(env));
}
