import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { DevScopeClient } from "@devscope/client";
import { z } from "zod";

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

  return server;
}
