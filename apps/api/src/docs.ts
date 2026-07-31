/**
 * API 发现页。
 *
 * tRPC procedure 列表直接来自 appRouter，避免维护第二份容易过时的手工契约。
 * 精确输入输出仍以 Zod schema、AppRouter 类型和 packages/client 为准。
 */

import type { FastifyInstance } from "fastify";
import { appRouter } from "./router";

export interface ApiEndpointEntry {
  path: string;
  kind: "trpc" | "http";
  method: string;
  source: string;
}

const HTTP_ENDPOINTS: ApiEndpointEntry[] = [
  {
    path: "/api/agent/workflow/stream",
    kind: "http",
    method: "POST (SSE)",
    source: "apps/api/src/routes/sse/agent-workflow.ts",
  },
  {
    path: "/api/workflow/status/:executionId",
    kind: "http",
    method: "GET",
    source: "apps/api/src/routes/workflow-status.ts",
  },
  {
    path: "/api/reports/:executionId",
    kind: "http",
    method: "GET",
    source: "apps/api/src/routes/reports.ts",
  },
];

export function getApiEndpointCatalog(): ApiEndpointEntry[] {
  const procedures = appRouter._def.procedures as unknown as Record<
    string,
    { _def: { type: string } }
  >;
  const trpcEndpoints = Object.entries(procedures)
    .map(([path, procedure]): ApiEndpointEntry => ({
      path: `/trpc/${path}`,
      kind: "trpc",
      method: procedure._def.type,
      source: "apps/api/src/router.ts 或 apps/api/src/router/*",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return [...trpcEndpoints, ...HTTP_ENDPOINTS];
}

export async function registerDocsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get("/docs", async (_request, reply) => {
    reply.type("text/html");
    return generateDocsPage(getApiEndpointCatalog());
  });

  fastify.get("/api/endpoints", async () => {
    const endpoints = getApiEndpointCatalog();
    return {
      generatedFrom: "appRouter._def.procedures + registered HTTP routes",
      contractSource: "AppRouter types, Zod schemas and packages/client",
      endpoints,
      count: endpoints.length,
    };
  });

  console.log(`[Docs] API discovery available at http://localhost:${process.env.PORT || 3100}/docs`);
}

function generateDocsPage(endpoints: ApiEndpointEntry[]): string {
  const rows = endpoints.map((endpoint) => `
    <tr>
      <td><code>${escapeHtml(endpoint.method)}</code></td>
      <td><code>${escapeHtml(endpoint.path)}</code></td>
      <td>${escapeHtml(endpoint.kind)}</td>
      <td><code>${escapeHtml(endpoint.source)}</code></td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DevScope API 发现页</title>
  <style>
    body { max-width: 1100px; margin: 40px auto; padding: 0 20px; color: #172033; font: 16px/1.6 system-ui, sans-serif; }
    h1 { margin-bottom: 8px; }
    .notice { padding: 14px 18px; border-left: 4px solid #b45309; background: #fffbeb; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #d8dee9; text-align: left; vertical-align: top; }
    code { font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>DevScope API 发现页</h1>
  <p>当前列出 ${endpoints.length} 个运行时入口。tRPC procedure 名称直接从 <code>appRouter</code> 生成，不再维护第二份静态接口清单。</p>
  <p class="notice">本页不是 OpenAPI，也不代表公共访问授权。精确输入输出以 Zod schema、<code>AppRouter</code> 类型和 <code>packages/client</code> 为准；当前服务仍是受反向代理保护的单用户私有版。</p>
  <table>
    <thead><tr><th>方法/类型</th><th>路径</th><th>入口</th><th>源码事实来源</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}
