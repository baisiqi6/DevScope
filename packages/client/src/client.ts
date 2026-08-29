import { TRPCUntypedClient, httpBatchLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { z } from "zod";
import {
  analysisStatusSchema,
  collectRepositoryInputSchema,
  collectionResultSchema,
  createGroupInputSchema,
  createGroupResultSchema,
  externalResourceGroupMemberSchema,
  externalResourceGroupSchema,
  externalResourceListInputSchema,
  externalResourceSchema,
  embeddingStatusSchema,
  groupMemberResultSchema,
  groupWithMembersSchema,
  healthReportSchema,
  healthResultSchema,
  removeRepoFromGroupResultSchema,
  repositoryDetailSchema,
  repositoryGroupListSchema,
  repositoryListInputSchema,
  repositorySummarySchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
  saveExternalResourceResultSchema,
  startHealthAnalysisResultSchema,
  updateRepoNoteResultSchema,
  type AnalysisStatus,
  type CollectRepositoryInput,
  type CollectionResult,
  type CreateGroupInput,
  type CreateGroupResult,
  type ExternalResource,
  type ExternalResourceGroup,
  type ExternalResourceGroupMember,
  type ExternalResourceListInput,
  type EmbeddingStatus,
  type GroupMemberResult,
  type GroupWithMembers,
  type HealthReport,
  type HealthResult,
  type RemoveRepoFromGroupResult,
  type RepositoryDetail,
  type RepositoryGroup,
  type RepositoryListInput,
  type RepositorySummary,
  type SemanticSearchRequest,
  type SemanticSearchResponse,
  type StartHealthAnalysisResult,
  type SaveExternalResourceResult,
  type UpdateRepoNoteResult,
} from "./contracts";
import {
  saveExternalResourceInputSchema,
  updateExternalResourceInputSchema,
  type SaveExternalResourceInput,
  type UpdateExternalResourceInput,
} from "@devscope/shared";
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
  updateRepoNote(repoId: number, note: string): Promise<UpdateRepoNoteResult>;
  getGroupWithMembers(groupId: number): Promise<GroupWithMembers>;
  createGroup(input: CreateGroupInput): Promise<CreateGroupResult>;
  addRepoToGroup(groupId: number, repoId: number): Promise<GroupMemberResult>;
  removeRepoFromGroup(groupId: number, repoId: number): Promise<RemoveRepoFromGroupResult>;
  startHealthAnalysis(repoFullName: string): Promise<StartHealthAnalysisResult>;
  getAnalysisStatus(executionId: string): Promise<AnalysisStatus>;
  getHealthReport(executionId: string): Promise<HealthReport>;
  listExternalResources(input?: ExternalResourceListInput): Promise<ExternalResource[]>;
  getExternalResource(resourceId: number): Promise<ExternalResource>;
  saveExternalResource(input: SaveExternalResourceInput): Promise<SaveExternalResourceResult>;
  updateExternalResource(input: UpdateExternalResourceInput): Promise<ExternalResource>;
  removeExternalResource(resourceId: number): Promise<{ success: boolean }>;
  listExternalResourceGroups(): Promise<ExternalResourceGroup[]>;
  createExternalResourceGroup(input: { name: string; description?: string }): Promise<ExternalResourceGroup>;
  getExternalResourceGroupMembers(groupId: number): Promise<ExternalResourceGroupMember[]>;
  addExternalResourceToGroup(groupId: number, resourceId: number): Promise<ExternalResourceGroupMember>;
  removeExternalResourceFromGroup(groupId: number, resourceId: number): Promise<{ success: boolean }>;
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
    createGroup: (input) => {
      const parsedInput = createGroupInputSchema.parse(input);
      return parseResult(
        client.mutation("groups.create", parsedInput),
        createGroupResultSchema,
      );
    },
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
    listExternalResources: (input = {}) => {
      const parsedInput = externalResourceListInputSchema.parse(input);
      return parseResult(
        client.query("externalResources.list", parsedInput),
        externalResourceSchema.array(),
      );
    },
    getExternalResource: (resourceId) =>
      parseResult(
        client.query("externalResources.get", { resourceId }),
        externalResourceSchema,
      ),
    saveExternalResource: (input) => {
      const parsedInput = saveExternalResourceInputSchema.parse(input);
      return parseResult(
        client.mutation("externalResources.save", parsedInput),
        saveExternalResourceResultSchema,
      );
    },
    updateExternalResource: (input) => {
      const parsedInput = updateExternalResourceInputSchema.parse(input);
      return parseResult(
        client.mutation("externalResources.update", parsedInput),
        externalResourceSchema,
      );
    },
    removeExternalResource: (resourceId) =>
      parseResult(
        client.mutation("externalResources.remove", { resourceId }),
        z.object({ success: z.boolean() }),
      ),
    listExternalResourceGroups: () =>
      parseResult(
        client.query("externalResourceGroups.list"),
        externalResourceGroupSchema.array(),
      ),
    createExternalResourceGroup: (input) =>
      parseResult(
        client.mutation("externalResourceGroups.create", input),
        externalResourceGroupSchema,
      ),
    getExternalResourceGroupMembers: (groupId) =>
      parseResult(
        client.query("externalResourceGroups.members", { groupId }),
        externalResourceGroupMemberSchema.array(),
      ),
    addExternalResourceToGroup: (groupId, resourceId) =>
      parseResult(
        client.mutation("externalResourceGroups.add", { groupId, resourceId }),
        externalResourceGroupMemberSchema,
      ),
    removeExternalResourceFromGroup: (groupId, resourceId) =>
      parseResult(
        client.mutation("externalResourceGroups.remove", { groupId, resourceId }),
        z.object({ success: z.boolean() }),
      ),
  };
}

export function createDevScopeClientFromEnv(
  env: DevScopeEnvironment = process.env,
): DevScopeClient {
  return createDevScopeClient(resolveDevScopeConnection(env));
}
