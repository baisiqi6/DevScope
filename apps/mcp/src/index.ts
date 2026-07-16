import { createDevScopeClientFromEnv } from "@devscope/client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDevScopeMcpServer } from "./server";

async function main(): Promise<void> {
  const client = createDevScopeClientFromEnv();
  const server = createDevScopeMcpServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`DevScope MCP 启动失败: ${message}\n`);
  process.exitCode = 1;
});
