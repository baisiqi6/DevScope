import { describe, expect, it } from "vitest";
import { getApiEndpointCatalog } from "./docs";

describe("API endpoint catalog", () => {
  it("从 appRouter 自动包含嵌套路由和独立 HTTP 路由", () => {
    const endpoints = getApiEndpointCatalog();
    const paths = endpoints.map((endpoint) => endpoint.path);

    expect(paths).toContain("/trpc/getRepositories");
    expect(paths).toContain("/trpc/groups.getAll");
    expect(paths).toContain("/trpc/graph.startRebuildGraph");
    expect(paths).toContain("/api/agent/workflow/stream");
    expect(endpoints.length).toBeGreaterThan(20);
  });
});
