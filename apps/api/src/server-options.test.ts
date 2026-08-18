import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { fastifyOptions } from "./server-options";

describe("Fastify 路由配置", () => {
  it("允许超过默认 100 字符的 tRPC batch 路径", async () => {
    const app = Fastify({ ...fastifyOptions, logger: false });
    app.get("/trpc/:path", async (request) => request.params);

    const procedurePath = [
      "discovery.getTrending",
      "discovery.getRadar",
      "discovery.getTrendingSyncStatus",
      "discovery.getRadarSyncStatus",
    ].join(",");
    expect(procedurePath.length).toBeGreaterThan(100);

    const response = await app.inject({ method: "GET", url: `/trpc/${procedurePath}` });
    expect(response.statusCode).toBe(200);

    await app.close();
  });
});
