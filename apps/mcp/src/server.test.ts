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
  it("注册首批七个工具", async () => {
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
});
