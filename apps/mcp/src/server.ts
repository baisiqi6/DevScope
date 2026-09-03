import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { DevScopeClient } from "@devscope/client";
import { z } from "zod";
import {
  externalResourceMetadataSchema,
  externalResourceUrlSchema,
  saveExternalResourceInputSchema,
  updateExternalResourceInputSchema,
} from "@devscope/shared";

export const MCP_SERVER_NAME = "devscope";
export const MCP_SERVER_VERSION = "0.0.1";

const readOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runTool(action: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await action());
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: errorMessage(error) }],
    };
  }
}

export function createDevScopeMcpServer(client: DevScopeClient): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    "devscope_health",
    {
      title: "检查 DevScope 服务状态",
      description: "检查 DevScope API 是否可访问。",
      annotations: readOnlyAnnotations,
    },
    () => runTool(() => client.health()),
  );

  server.registerTool(
    "devscope_list_repositories",
    {
      title: "列出已采集仓库",
      description: "按 stars 降序列出 DevScope 中已经采集的仓库。",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ limit, offset }) => runTool(() => client.listRepositories({ limit, offset })),
  );

  server.registerTool(
    "devscope_get_repository",
    {
      title: "读取仓库详情",
      description: "按 DevScope 内部数字 ID 读取仓库详情与内容分块统计。",
      inputSchema: z.object({
        repoId: z.number().int().positive(),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ repoId }) => runTool(() => client.getRepository(repoId)),
  );

  server.registerTool(
    "devscope_get_repository_delete_impact",
    {
      title: "预览仓库删除影响",
      description: "只读：统计仓库的分组、分块、Release、HN、关系、技术栈关系和其他关注者数量。",
      inputSchema: z.object({ repoId: z.number().int().positive() }),
      annotations: readOnlyAnnotations,
    },
    ({ repoId }) => runTool(() => client.getRepositoryDeleteImpact(repoId)),
  );

  server.registerTool(
    "devscope_archive_repository",
    {
      title: "归档仓库",
      description: "写入：从当前仓库列表隐藏该仓库，但保留数据以便恢复。",
      inputSchema: z.object({ repoId: z.number().int().positive() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ repoId }) => runTool(() => client.archiveRepository(repoId)),
  );

  server.registerTool(
    "devscope_unarchive_repository",
    {
      title: "恢复归档仓库",
      description: "写入：恢复仓库在当前用户列表中的可见性。",
      inputSchema: z.object({ repoId: z.number().int().positive() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ repoId }) => runTool(() => client.unarchiveRepository(repoId)),
  );

  server.registerTool(
    "devscope_delete_repository",
    {
      title: "删除仓库",
      description: "破坏性写入：删除当前用户的仓库收藏；仅无其他关注者时删除共享仓库数据。",
      inputSchema: z.object({ repoId: z.number().int().positive(), confirm: z.literal(true) }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ repoId, confirm }) => runTool(() => client.deleteRepository(repoId, confirm)),
  );

  server.registerTool(
    "devscope_collect_repository",
    {
      title: "采集 GitHub 仓库",
      description: "采集 owner/repo；默认在快速采集完成后由 API 后台生成向量。",
      inputSchema: z.object({
        repo: z.string().trim().min(1).describe("GitHub 仓库，格式为 owner/repo"),
        skipEmbeddings: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ repo, skipEmbeddings }) =>
      runTool(() => client.collectRepository({ repo, skipEmbeddings })),
  );

  server.registerTool(
    "devscope_get_embedding_status",
    {
      title: "读取向量化状态",
      description: "读取仓库向量化进度、完成状态或错误。",
      inputSchema: z.object({
        repoId: z.number().int().positive(),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ repoId }) => runTool(() => client.getEmbeddingStatus(repoId)),
  );

  server.registerTool(
    "devscope_semantic_search",
    {
      title: "搜索仓库内容",
      description: "在已向量化的仓库内容中做语义搜索，可选生成 AI 综合回答。",
      inputSchema: z.object({
        repo: z.string().trim().min(1).describe("GitHub 仓库，格式为 owner/repo"),
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(20).default(5),
        generateAnswer: z.boolean().default(true),
      }),
      annotations: {
        ...readOnlyAnnotations,
        openWorldHint: true,
      },
    },
    ({ repo, query, limit, generateAnswer }) =>
      runTool(() => client.semanticSearch({ repo, query, limit, generateAnswer })),
  );

  server.registerTool(
    "devscope_list_groups",
    {
      title: "列出仓库分组",
      description: "列出当前用户的全部仓库分组及仓库数量。",
      annotations: readOnlyAnnotations,
    },
    () => runTool(() => client.listGroups()),
  );

  server.registerTool(
    "devscope_get_group_tree",
    {
      title: "读取仓库分组树",
      description: "只读：按同级顺序返回当前用户的完整分组树、直接计数和后代去重计数。",
      annotations: readOnlyAnnotations,
    },
    () => runTool(() => client.getGroupTree()),
  );

  server.registerTool(
    "devscope_update_repo_note",
    {
      title: "更新仓库备注",
      description: "写入：为指定仓库设置自定义备注文本。",
      inputSchema: z.object({
        repoId: z.number().int().positive(),
        note: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ repoId, note }) => runTool(() => client.updateRepoNote(repoId, note)),
  );

  server.registerTool(
    "devscope_get_group_members",
    {
      title: "读取分组成员",
      description: "只读：获取指定分组的成员列表及关联仓库信息。",
      inputSchema: z.object({
        groupId: z.number().int().positive(),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ groupId }) => runTool(() => client.getGroupWithMembers(groupId)),
  );

  server.registerTool(
    "devscope_get_aggregate_group_members",
    {
      title: "读取分组及后代仓库",
      description: "只读：获取指定分组自身及全部后代中的去重仓库，并返回真实直接 membership 来源。",
      inputSchema: z.object({
        groupId: z.number().int().positive(),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ groupId }) => runTool(() => client.getAggregateGroupWithMembers(groupId)),
  );

  server.registerTool(
    "devscope_create_group",
    {
      title: "创建仓库分组",
      description: "写入：创建一个新的仓库分组。",
      inputSchema: z.object({
        name: z.string().min(1).max(50),
        description: z.string().optional(),
        parentId: z.number().int().positive().nullable().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ name, description, parentId }) =>
      runTool(() => client.createGroup({ name, description, parentId })),
  );

  server.registerTool(
    "devscope_move_group",
    {
      title: "移动仓库分组",
      description: "写入：将分组移动到另一个父分组；parentId=null 表示根级。",
      inputSchema: z.object({
        groupId: z.number().int().positive(),
        parentId: z.number().int().positive().nullable(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ groupId, parentId }) => runTool(() => client.moveGroup(groupId, parentId)),
  );

  server.registerTool(
    "devscope_update_group",
    {
      title: "更新仓库分组",
      description: "写入：更新分组名称、颜色、图标或说明。",
      inputSchema: z.object({
        groupId: z.number().int().positive(),
        name: z.string().trim().min(1).max(50).optional(),
        color: z.enum(["blue", "green", "purple", "orange", "red", "pink"]).optional(),
        icon: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(2000).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runTool(() => client.updateGroup(input)),
  );

  server.registerTool(
    "devscope_delete_group",
    {
      title: "删除仓库分组",
      description: "破坏性写入：删除空的仓库分组；含子分组的目标会被拒绝。",
      inputSchema: z.object({
        groupId: z.number().int().positive(),
        confirm: z.literal(true),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ groupId, confirm }) => runTool(() => client.deleteGroup(groupId, confirm)),
  );

  server.registerTool(
    "devscope_reorder_group_siblings",
    {
      title: "重排同级仓库分组",
      description: "写入：提交目标父级下完整、无重复的兄弟分组 ID 顺序。",
      inputSchema: z.object({
        parentId: z.number().int().positive().nullable(),
        groupIds: z.array(z.number().int().positive()),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ parentId, groupIds }) =>
      runTool(() => client.reorderGroupSiblings(parentId, groupIds)),
  );

  server.registerTool(
    "devscope_add_repo_to_group",
    {
      title: "添加仓库到分组",
      description: "写入：将仓库添加到指定分组。",
      inputSchema: z.object({
        groupId: z.number().int().positive(),
        repoId: z.number().int().positive(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ groupId, repoId }) => runTool(() => client.addRepoToGroup(groupId, repoId)),
  );

  server.registerTool(
    "devscope_remove_repo_from_group",
    {
      title: "从分组移除仓库",
      description: "写入：将仓库从指定分组中移除。",
      inputSchema: z.object({
        groupId: z.number().int().positive(),
        repoId: z.number().int().positive(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ groupId, repoId }) => runTool(() => client.removeRepoFromGroup(groupId, repoId)),
  );

  server.registerTool(
    "devscope_list_external_resources",
    {
      title: "列出外部资源",
      description: "只读：列出当前用户保存的文章、论文和网站预览卡片。不会触发正文抓取。",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        resourceType: z.enum(["article", "paper", "website"]).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ limit, offset, resourceType }) => runTool(() => client.listExternalResources({ limit, offset, resourceType })),
  );

  server.registerTool(
    "devscope_save_external_resource",
    {
      title: "保存外部资源预览卡片",
      description: "写入：保存文章、论文或网站 URL 及手工元数据；当前固定为 preview_only，不抓取正文。",
      inputSchema: z.object({
        url: externalResourceUrlSchema,
        resourceType: z.enum(["article", "paper", "website"]),
        title: z.string().trim().min(1).max(300).optional(),
        description: z.string().trim().max(2000).optional(),
        siteName: z.string().trim().max(200).optional(),
        author: z.string().trim().max(200).optional(),
        publishedAt: z.string().datetime().optional(),
        faviconUrl: externalResourceUrlSchema.optional(),
        previewImageUrl: externalResourceUrlSchema.optional(),
        metadata: externalResourceMetadataSchema.optional(),
        notes: z.string().max(5000).optional(),
        tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runTool(() => client.saveExternalResource(saveExternalResourceInputSchema.parse(input))),
  );

  server.registerTool(
    "devscope_get_external_resource",
    {
      title: "读取外部资源",
      description: "只读：读取一张外部资源预览卡片。",
      inputSchema: z.object({ resourceId: z.number().int().positive() }),
      annotations: readOnlyAnnotations,
    },
    ({ resourceId }) => runTool(() => client.getExternalResource(resourceId)),
  );

  server.registerTool("devscope_request_external_resource_content", {
    title: "请求采集外部资源正文",
    description: "显式触发异步正文采集；不会在 MCP 请求中直接联网。",
    inputSchema: z.object({ resourceId: z.number().int().positive() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, ({ resourceId }) => runTool(() => client.requestExternalResourceContent(resourceId)));

  server.registerTool("devscope_enable_external_resource_content", {
    title: "启用外部资源正文采集",
    description: "写入：将当前用户已收藏资源从 preview_only 单向切换为 content；不会联网或自动入队。",
    inputSchema: z.object({ resourceId: z.number().int().positive() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ resourceId }) => runTool(() => client.enableExternalResourceContent(resourceId)));

  server.registerTool("devscope_get_external_resource_content_status", {
    title: "查询正文采集状态",
    description: "只读：返回脱敏的正文采集状态与错误。",
    inputSchema: z.object({ resourceId: z.number().int().positive() }),
    annotations: readOnlyAnnotations,
  }, ({ resourceId }) => runTool(() => client.getExternalResourceContentStatus(resourceId)));

  server.registerTool("devscope_read_external_resource_content", {
    title: "读取外部资源正文",
    description: "只读：读取已完成正文，服务端有长度上限。",
    inputSchema: z.object({ resourceId: z.number().int().positive() }),
    annotations: readOnlyAnnotations,
  }, ({ resourceId }) => runTool(() => client.readExternalResourceContent(resourceId)));

  server.registerTool(
    "devscope_update_external_resource",
    {
      title: "更新外部资源收藏",
      description: "写入：更新外部资源的标题、备注、标签、已读或置顶状态。",
      inputSchema: z.object({
        resourceId: z.number().int().positive(),
        title: z.string().trim().min(1).max(300).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        siteName: z.string().trim().max(200).nullable().optional(),
        author: z.string().trim().max(200).nullable().optional(),
        publishedAt: z.string().datetime().nullable().optional(),
        faviconUrl: externalResourceUrlSchema.nullable().optional(),
        previewImageUrl: externalResourceUrlSchema.nullable().optional(),
        metadata: externalResourceMetadataSchema.nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
        isRead: z.boolean().optional(),
        isPinned: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => runTool(() => client.updateExternalResource(updateExternalResourceInputSchema.parse(input))),
  );

  server.registerTool(
    "devscope_remove_external_resource",
    {
      title: "删除外部资源",
      description: "写入：删除当前用户保存的外部资源及其资源分组成员关系。",
      inputSchema: z.object({ resourceId: z.number().int().positive() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ resourceId }) => runTool(() => client.removeExternalResource(resourceId)),
  );

  server.registerTool(
    "devscope_list_external_resource_groups",
    {
      title: "列出外部资源分组",
      description: "只读：列出文章、论文和网站专用分组。",
      annotations: readOnlyAnnotations,
    },
    () => runTool(() => client.listExternalResourceGroups()),
  );

  server.registerTool(
    "devscope_create_external_resource_group",
    {
      title: "创建外部资源分组",
      description: "写入：创建一个只管理外部资源的分组。",
      inputSchema: z.object({ name: z.string().trim().min(1).max(50), description: z.string().trim().max(500).optional() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ name, description }) => runTool(() => client.createExternalResourceGroup({ name, description })),
  );

  server.registerTool(
    "devscope_get_external_resource_group_members",
    {
      title: "读取外部资源分组",
      description: "只读：读取外部资源分组中的预览卡片。",
      inputSchema: z.object({ groupId: z.number().int().positive() }),
      annotations: readOnlyAnnotations,
    },
    ({ groupId }) => runTool(() => client.getExternalResourceGroupMembers(groupId)),
  );

  server.registerTool(
    "devscope_add_external_resource_to_group",
    {
      title: "添加外部资源到分组",
      description: "写入：将外部资源加入外部资源专用分组。",
      inputSchema: z.object({ groupId: z.number().int().positive(), resourceId: z.number().int().positive() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ groupId, resourceId }) => runTool(() => client.addExternalResourceToGroup(groupId, resourceId)),
  );

  server.registerTool(
    "devscope_remove_external_resource_from_group",
    {
      title: "从外部资源分组移除",
      description: "写入：从外部资源专用分组移除资源。",
      inputSchema: z.object({ groupId: z.number().int().positive(), resourceId: z.number().int().positive() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ groupId, resourceId }) => runTool(() => client.removeExternalResourceFromGroup(groupId, resourceId)),
  );

  server.registerTool(
    "devscope_start_health_analysis",
    {
      title: "启动健康度分析",
      description: "写入：为指定仓库启动后台 Agent 健康度分析，立即返回 executionId。",
      inputSchema: z.object({
        repoFullName: z.string().trim().min(1).describe("GitHub 仓库，格式为 owner/repo"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ repoFullName }) => runTool(() => client.startHealthAnalysis(repoFullName)),
  );

  server.registerTool(
    "devscope_get_analysis_status",
    {
      title: "查询分析状态",
      description: "只读：查询指定执行记录的当前状态和进度。",
      inputSchema: z.object({
        executionId: z.string().min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ executionId }) => runTool(() => client.getAnalysisStatus(executionId)),
  );

  server.registerTool(
    "devscope_get_health_report",
    {
      title: "获取健康度报告",
      description: "只读：获取指定执行记录对应的健康度报告。",
      inputSchema: z.object({
        executionId: z.string().min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ executionId }) => runTool(() => client.getHealthReport(executionId)),
  );

  return server;
}
