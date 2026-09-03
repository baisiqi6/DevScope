import { describe, expect, it, vi, beforeEach } from "vitest";
import { externalResourceUrlSchema, saveExternalResourceInputSchema } from "@devscope/shared";
import { externalResources, externalResourceSaves, users } from "@devscope/db";

vi.mock("@devscope/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@devscope/db")>()),
  enqueueExternalResourceContentJob: vi.fn().mockResolvedValue({ enqueued: true }),
}));

import { enqueueExternalResourceContentJob } from "@devscope/db";
import { canonicalizeExternalResourceUrl } from "./external-resources";
import { externalResourcesRouter } from "./external-resources";

describe("external resource URL contract", () => {
  it("只允许没有凭据的 http/https URL", () => {
    expect(externalResourceUrlSchema.safeParse("https://example.com/article").success).toBe(true);
    expect(externalResourceUrlSchema.safeParse("ftp://example.com/file").success).toBe(false);
    expect(externalResourceUrlSchema.safeParse("https://user:pass@example.com").success).toBe(false);
  });

  it("规范化 host、默认端口、fragment 和尾部斜杠", () => {
    expect(canonicalizeExternalResourceUrl("HTTPS://Example.COM:443/design///#preview"))
      .toBe("https://example.com/design");
    expect(canonicalizeExternalResourceUrl("http://Example.COM:80/"))
      .toBe("http://example.com/");
  });

  it("保存输入默认使用 preview_only 所需的最小元数据", () => {
    const parsed = saveExternalResourceInputSchema.parse({
      url: "https://example.com",
      resourceType: "website",
    });
    expect(parsed.tags).toEqual([]);
  });

  it("接受受限的预览元数据并拒绝过大的 JSON", () => {
    expect(saveExternalResourceInputSchema.safeParse({
      url: "https://example.com",
      resourceType: "website",
      metadata: { source: "manual", version: 1 },
    }).success).toBe(true);
    expect(saveExternalResourceInputSchema.safeParse({
      url: "https://example.com",
      resourceType: "website",
      metadata: { body: "x".repeat(20_001) },
    }).success).toBe(false);
  });
});

describe("external resource content routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("正文请求只入队，不在 API 请求线程抓取", async () => {
    const resource = { id: 9, userId: 7, ingestionMode: "content", contentStatus: "not_requested" };
    const db = createContentRouteDb(resource);
    const caller = externalResourcesRouter.createCaller({ db } as never);

    await expect(caller.requestContent({ resourceId: 9 })).resolves.toEqual({
      resourceId: 9, status: "pending", error: null, fetchedAt: null,
    });
    expect(enqueueExternalResourceContentJob).toHaveBeenCalledWith(db, { userId: 7, resourceId: 9 });
  });

  it("preview_only 资源被 fail-closed 拒绝", async () => {
    const db = createContentRouteDb({ id: 9, userId: 7, ingestionMode: "preview_only", contentStatus: "not_requested" });
    const caller = externalResourcesRouter.createCaller({ db } as never);
    await expect(caller.requestContent({ resourceId: 9 })).rejects.toThrow("未启用正文采集");
    expect(enqueueExternalResourceContentJob).not.toHaveBeenCalled();
  });
});

function createContentRouteDb(resource: Record<string, unknown>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === users) return { limit: vi.fn().mockResolvedValue([{ id: 7 }]) };
        if (table === externalResources) return {
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{
              resource: {
                ...resource,
                url: "https://example.com/article",
                canonicalUrl: "https://example.com/article",
                title: "Article",
                resourceType: "article",
                contentError: null,
                contentFetchedAt: null,
                createdAt: new Date("2026-09-01T00:00:00Z"),
                updatedAt: new Date("2026-09-01T00:00:00Z"),
              },
              save: { resourceId: resource.id, userId: 7, tags: [], notes: null, isRead: false, isPinned: false },
            }]) })),
          })),
        };
        throw new Error("unexpected table in content route test");
      }),
    })),
  };
}
