import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { DevScopeClient } from "@devscope/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevScopeMcpServer } from "./server";

function createStubClient(): DevScopeClient {
  return {
    health: vi.fn().mockResolvedValue({ status: "ok", timestamp: "2026-07-16T00:00:00.000Z" }),
    listRepositories: vi.fn().mockResolvedValue([]),
    getRepository: vi.fn(),
    collectRepository: vi.fn(),
    getEmbeddingStatus: vi.fn(),
    semanticSearch: vi.fn(),
    listGroups: vi.fn().mockResolvedValue([]),
    getGroupTree: vi.fn().mockResolvedValue([]),
    updateRepoNote: vi.fn().mockResolvedValue({ success: true }),
    getGroupWithMembers: vi.fn(),
    getAggregateGroupWithMembers: vi.fn(),
    createGroup: vi.fn(),
    moveGroup: vi.fn(),
    reorderGroupSiblings: vi.fn().mockResolvedValue({ success: true }),
    addRepoToGroup: vi.fn(),
    removeRepoFromGroup: vi.fn().mockResolvedValue({ success: true }),
    startHealthAnalysis: vi.fn(),
    getAnalysisStatus: vi.fn(),
    getHealthReport: vi.fn(),
    listExternalResources: vi.fn().mockResolvedValue([]),
    getExternalResource: vi.fn(),
    saveExternalResource: vi.fn(),
    updateExternalResource: vi.fn(),
    removeExternalResource: vi.fn().mockResolvedValue({ success: true }),
    listExternalResourceGroups: vi.fn().mockResolvedValue([]),
    createExternalResourceGroup: vi.fn(),
    getExternalResourceGroupMembers: vi.fn().mockResolvedValue([]),
    addExternalResourceToGroup: vi.fn(),
    removeExternalResourceFromGroup: vi.fn().mockResolvedValue({ success: true }),
  };
}

const openServers: Array<{ close(): Promise<void> }> = [];
const openClients: Array<{ close(): Promise<void> }> = [];

async function createConnectedPair(devScopeClient: DevScopeClient) {
  const server = createDevScopeMcpServer(devScopeClient);
  const client = new Client({ name: "devscope-test", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  openServers.push(server);
  openClients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.allSettled([
    ...openClients.splice(0).map((client) => client.close()),
    ...openServers.splice(0).map((server) => server.close()),
  ]);
});

describe("DevScope MCP Server", () => {
  it("注册全部二十九个工具", async () => {
    const client = await createConnectedPair(createStubClient());
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "devscope_health",
      "devscope_list_repositories",
      "devscope_get_repository",
      "devscope_collect_repository",
      "devscope_get_embedding_status",
      "devscope_semantic_search",
      "devscope_list_groups",
      "devscope_get_group_tree",
      "devscope_update_repo_note",
      "devscope_get_group_members",
      "devscope_get_aggregate_group_members",
      "devscope_create_group",
      "devscope_move_group",
      "devscope_reorder_group_siblings",
      "devscope_add_repo_to_group",
      "devscope_remove_repo_from_group",
      "devscope_list_external_resources",
      "devscope_save_external_resource",
      "devscope_get_external_resource",
      "devscope_update_external_resource",
      "devscope_remove_external_resource",
      "devscope_list_external_resource_groups",
      "devscope_create_external_resource_group",
      "devscope_get_external_resource_group_members",
      "devscope_add_external_resource_to_group",
      "devscope_remove_external_resource_from_group",
      "devscope_start_health_analysis",
      "devscope_get_analysis_status",
      "devscope_get_health_report",
    ]);
  });

  it("通过 MCP 调用统一 Client", async () => {
    const devScopeClient = createStubClient();
    const client = await createConnectedPair(devScopeClient);
    const result = await client.callTool(
      { name: "devscope_health", arguments: {} },
      CallToolResultSchema,
    );

    expect(devScopeClient.health).toHaveBeenCalledOnce();
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(
          { status: "ok", timestamp: "2026-07-16T00:00:00.000Z" },
          null,
          2,
        ),
      },
    ]);
  });

  it("将 Client 错误转换成 MCP 工具错误", async () => {
    const devScopeClient = createStubClient();
    vi.mocked(devScopeClient.getRepository).mockRejectedValue(new Error("仓库不存在"));
    const client = await createConnectedPair(devScopeClient);
    const result = await client.callTool(
      {
        name: "devscope_get_repository",
        arguments: { repoId: 404 },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "仓库不存在" }]);
  });

  it("通过 MCP 调用 startHealthAnalysis", async () => {
    const devScopeClient = createStubClient();
    vi.mocked(devScopeClient.startHealthAnalysis).mockResolvedValue({
      executionId: "exec-mcp-1",
      deduplicated: false,
    });
    const client = await createConnectedPair(devScopeClient);
    const result = await client.callTool(
      { name: "devscope_start_health_analysis", arguments: { repoFullName: "owner/repo" } },
      CallToolResultSchema,
    );

    expect(devScopeClient.startHealthAnalysis).toHaveBeenCalledWith("owner/repo");
    expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual({
      executionId: "exec-mcp-1",
      deduplicated: false,
    });
  });

  it("通过 MCP 调用 updateRepoNote", async () => {
    const devScopeClient = createStubClient();
    const client = await createConnectedPair(devScopeClient);
    const result = await client.callTool(
      { name: "devscope_update_repo_note", arguments: { repoId: 1, note: "测试" } },
      CallToolResultSchema,
    );

    expect(devScopeClient.updateRepoNote).toHaveBeenCalledWith(1, "测试");
    expect(result.isError).not.toBe(true);
  });

  it("转发外部资源保存字段并复用 URL/metadata 校验", async () => {
    const devScopeClient = createStubClient();
    vi.mocked(devScopeClient.saveExternalResource).mockResolvedValue({ ok: true } as never);
    const client = await createConnectedPair(devScopeClient);
    const result = await client.callTool({
      name: "devscope_save_external_resource",
      arguments: {
        url: "https://example.com/article",
        resourceType: "article",
        siteName: "Example",
        author: "Ada",
        publishedAt: "2026-08-28T00:00:00.000Z",
        metadata: { source: "test" },
        tags: ["design"],
      },
    }, CallToolResultSchema);

    expect(devScopeClient.saveExternalResource).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.com/article",
      siteName: "Example",
      author: "Ada",
      metadata: { source: "test" },
      tags: ["design"],
    }));
    expect(result.isError).not.toBe(true);
  });

  it("通过 MCP 调用树读取、聚合成员、移动和同级重排", async () => {
    const devScopeClient = createStubClient();
    vi.mocked(devScopeClient.getAggregateGroupWithMembers).mockResolvedValue({
      group: {
        id: 1,
        userId: 1,
        parentId: null,
        name: "根",
        color: "blue",
        icon: "folder",
        description: null,
        orderIndex: 0,
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z",
        repoCount: 0,
        directRepoCount: 0,
        aggregateRepoCount: 0,
      },
      members: [],
    });
    vi.mocked(devScopeClient.moveGroup).mockResolvedValue({
      id: 2,
      userId: 1,
      parentId: 1,
      name: "子",
      color: "blue",
      icon: "folder",
      description: null,
      orderIndex: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    });
    const client = await createConnectedPair(devScopeClient);

    await client.callTool({ name: "devscope_get_group_tree", arguments: {} }, CallToolResultSchema);
    await client.callTool({
      name: "devscope_get_aggregate_group_members",
      arguments: { groupId: 1 },
    }, CallToolResultSchema);
    await client.callTool({
      name: "devscope_move_group",
      arguments: { groupId: 2, parentId: 1 },
    }, CallToolResultSchema);
    await client.callTool({
      name: "devscope_reorder_group_siblings",
      arguments: { parentId: 1, groupIds: [3, 2] },
    }, CallToolResultSchema);

    expect(devScopeClient.getGroupTree).toHaveBeenCalledOnce();
    expect(devScopeClient.getAggregateGroupWithMembers).toHaveBeenCalledWith(1);
    expect(devScopeClient.moveGroup).toHaveBeenCalledWith(2, 1);
    expect(devScopeClient.reorderGroupSiblings).toHaveBeenCalledWith(1, [3, 2]);
  });
});
