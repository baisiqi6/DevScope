import { TRPCUntypedClient, httpBatchLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { z } from "zod";
import {
  analysisStatusSchema,
  aggregateGroupViewSchema,
  collectRepositoryInputSchema,
  collectionResultSchema,
  createGroupInputSchema,
  updateGroupSchema,
  createGroupResultSchema,
  externalResourceGroupMemberSchema,
  externalResourceGroupSchema,
  externalResourceListInputSchema,
  externalResourceSchema,
  embeddingStatusSchema,
  groupMemberResultSchema,
  groupMutationSuccessSchema,
  groupWithMembersSchema,
  healthReportSchema,
  healthResultSchema,
  removeRepoFromGroupResultSchema,
  repositoryDetailSchema,
  repositoryDeleteImpactSchema,
  repositoryLifecycleResultSchema,
  repositoryGroupSchema,
  repositoryGroupListSchema,
  repositoryGroupTreeSchema,
  repositoryListInputSchema,
  repositorySummarySchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
  saveExternalResourceResultSchema,
  startHealthAnalysisResultSchema,
  updateRepoNoteResultSchema,
  moveGroupResultSchema,
  type AnalysisStatus,
  type AggregateGroupView,
  type CollectRepositoryInput,
  type CollectionResult,
  type CreateGroupInput,
  type UpdateGroupInput,
  type CreateGroupResult,
  type ExternalResource,
  type ExternalResourceGroup,
  type ExternalResourceGroupMember,
  type ExternalResourceListInput,
  type EmbeddingStatus,
  type GroupMemberResult,
  type GroupMutationSuccess,
  type GroupWithMembers,
  type HealthReport,
  type HealthResult,
  type RemoveRepoFromGroupResult,
  type RepositoryDetail,
  type RepositoryDeleteImpact,
  type RepositoryLifecycleResult,
  type RepositoryGroup,
  type RepositoryGroupTree,
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
  getRepositoryDeleteImpact(repoId: number): Promise<RepositoryDeleteImpact>;
  archiveRepository(repoId: number): Promise<RepositoryLifecycleResult>;
  unarchiveRepository(repoId: number): Promise<RepositoryLifecycleResult>;
  deleteRepository(repoId: number, confirm: true): Promise<RepositoryLifecycleResult>;
  collectRepository(input: CollectRepositoryInput): Promise<CollectionResult>;
  getEmbeddingStatus(repoId: number): Promise<EmbeddingStatus>;
  semanticSearch(input: SemanticSearchRequest): Promise<SemanticSearchResponse>;
  listGroups(): Promise<RepositoryGroup[]>;
  getGroupTree(): Promise<RepositoryGroupTree>;
  updateRepoNote(repoId: number, note: string): Promise<UpdateRepoNoteResult>;
  getGroupWithMembers(groupId: number): Promise<GroupWithMembers>;
  getAggregateGroupWithMembers(groupId: number): Promise<AggregateGroupView>;
  createGroup(input: CreateGroupInput): Promise<CreateGroupResult>;
  updateGroup(input: UpdateGroupInput): Promise<RepositoryGroup>;
  deleteGroup(groupId: number, confirm: true): Promise<GroupMutationSuccess>;
  moveGroup(groupId: number, parentId: number | null): Promise<RepositoryGroup>;
  reorderGroupSiblings(parentId: number | null, groupIds: number[]): Promise<GroupMutationSuccess>;
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
    getRepositoryDeleteImpact: (repoId) =>
      parseResult(client.query("getRepositoryDeleteImpact", { repoId }), repositoryDeleteImpactSchema),
    archiveRepository: (repoId) =>
      parseResult(client.mutation("archiveRepository", { repoId }), repositoryLifecycleResultSchema),
    unarchiveRepository: (repoId) =>
      parseResult(client.mutation("unarchiveRepository", { repoId }), repositoryLifecycleResultSchema),
    deleteRepository: (repoId, confirm) =>
      parseResult(client.mutation("deleteRepository", { repoId, confirm }), repositoryLifecycleResultSchema),
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
    updateGroup: (input) => {
      const parsedInput = updateGroupSchema.parse(input);
      return parseResult(
        client.mutation("groups.update", parsedInput),
        repositoryGroupSchema,
      );
    },
  deleteGroup: (groupId, confirm) =>
      parseResult(
        client.mutation("groups.delete", { groupId, confirm }),
        groupMutationSuccessSchema,
      ),
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
