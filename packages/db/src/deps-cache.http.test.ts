import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchDepsDevOutcome, parseRetryAfterSeconds } from "./deps-cache";

// ============================================================================
// 真实 HTTP 层：fake deps.dev server 驱动 fetchDepsDevOutcome 的
// 状态码/Retry-After/挂起超时/非法 JSON 路径（不触网）
// ============================================================================

describe("fetchDepsDevOutcome（真实 HTTP）", () => {
  let server: http.Server;
  let baseUrl: string;
  // 按包名路由响应，便于单个 server 覆盖所有分支
  const routes = new Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const match = [...routes.entries()].find(([prefix]) => req.url?.includes(prefix));
      if (!match) {
        res.statusCode = 500;
        res.end("no route");
        return;
      }
      match[1](req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("200 + SOURCE_REPO → resolved", async () => {
    routes.set("ok-pkg", (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        relatedProjects: [
          { relationType: "SOURCE_REPO", projectKey: { id: "github.com/facebook/react" } },
        ],
      }));
    });
    const outcome = await fetchDepsDevOutcome("npm", "ok-pkg", "1.0.0", { depsTimeoutMs: 1000 }, baseUrl);
    expect(outcome).toMatchObject({ status: "resolved", sourceRepo: "facebook/react" });
  });

  it("200 空数组 → not_found（权威明确无映射）", async () => {
    routes.set("empty-pkg", (_req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ relatedProjects: [] }));
    });
    const outcome = await fetchDepsDevOutcome("npm", "empty-pkg", "1.0.0", { depsTimeoutMs: 1000 }, baseUrl);
    expect(outcome).toMatchObject({ status: "not_found", sourceRepo: null });
  });

  it("404 → not_found", async () => {
    routes.set("gone-pkg", (_req, res) => {
      res.statusCode = 404;
      res.end("{}");
    });
    const outcome = await fetchDepsDevOutcome("npm", "gone-pkg", "1.0.0", { depsTimeoutMs: 1000 }, baseUrl);
    expect(outcome.status).toBe("not_found");
  });

  it("429 + Retry-After 头 → error 并携带秒数", async () => {
    routes.set("limited-pkg", (_req, res) => {
      res.statusCode = 429;
      res.setHeader("retry-after", "37");
      res.end("{}");
    });
    const outcome = await fetchDepsDevOutcome("npm", "limited-pkg", "1.0.0", { depsTimeoutMs: 1000 }, baseUrl);
    expect(outcome).toMatchObject({ status: "error", retryAfterSeconds: 37 });
  });

  it("5xx → error", async () => {
    routes.set("broken-pkg", (_req, res) => {
      res.statusCode = 503;
      res.end("unavailable");
    });
    const outcome = await fetchDepsDevOutcome("npm", "broken-pkg", "1.0.0", { depsTimeoutMs: 1000 }, baseUrl);
    expect(outcome).toMatchObject({ status: "error", errorSummary: "http_503" });
  });

  it("200 非法 JSON → error(malformed_response)", async () => {
    routes.set("garbage-pkg", (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end("{not json");
    });
    const outcome = await fetchDepsDevOutcome("npm", "garbage-pkg", "1.0.0", { depsTimeoutMs: 1000 }, baseUrl);
    expect(outcome).toMatchObject({ status: "error", errorSummary: "malformed_response" });
  });

  it("服务端挂起 → timeout 分类，而不是 network_error", async () => {
    routes.set("slow-pkg", () => {
      // 永不响应，由客户端 AbortSignal.timeout 中止
    });
    const outcome = await fetchDepsDevOutcome("npm", "slow-pkg", "1.0.0", { depsTimeoutMs: 80 }, baseUrl);
    expect(outcome).toMatchObject({ status: "error", errorSummary: "timeout" });
  }, 5_000);

  it("连接被拒绝 → network_error", async () => {
    // 54321 端口无监听（本仓库服务不占用该端口）
    const outcome = await fetchDepsDevOutcome("npm", "any", "1.0.0", { depsTimeoutMs: 1000 }, "http://127.0.0.1:54321");
    expect(outcome).toMatchObject({ status: "error", errorSummary: "network_error" });
  });
});

describe("parseRetryAfterSeconds", () => {
  it("null/空/非数值/负数 → null；正常值向下取整；超大值钳制到 24h", () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds("")).toBeNull();
    expect(parseRetryAfterSeconds("soon")).toBeNull();
    expect(parseRetryAfterSeconds("-5")).toBeNull();
    expect(parseRetryAfterSeconds("37.9")).toBe(37);
    expect(parseRetryAfterSeconds("999999")).toBe(86_400);
  });
});
