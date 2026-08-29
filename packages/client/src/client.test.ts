import { describe, expect, it, vi } from "vitest";
import { createDevScopeClient, type DevScopeClient } from "./client";

function createMockFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = typeof url === "string" ? url : url.toString();

    for (const [key, value] of Object.entries(responses)) {
      if (path.includes(key)) {
        return new Response(
          JSON.stringify({ result: { data: value } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(
      JSON.stringify({ result: { data: null } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof globalThis.fetch;
}

function createClientWithMockFetch(responses: Record<string, unknown>): DevScopeClient {
  return createDevScopeClient({
    baseUrl: "http://localhost:3100",
    fetch: createMockFetch(responses),
  });
}

describe("DevScope Client 新增方法", () => {
  it("保存并读取外部资源预览卡片", async () => {
    const resource = {
      id: 9,
      resourceType: "website",
      url: "https://example.com/design",
      canonicalUrl: "https://example.com/design",
      title: "Design",
      description: null,
      siteName: "Example",
      author: null,
      publishedAt: null,
      faviconUrl: null,
      previewImageUrl: null,
      metadata: { source: "manual" },
      ingestionMode: "preview_only",
      contentStatus: "not_requested",
      contentFetchedAt: null,
      contentError: null,
      notes: "保存",
      tags: ["ui"],
      isRead: false,
      isPinned: true,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    const client = createClientWithMockFetch({
      "externalResources.save": { created: true, resource },
      "externalResources.list": [resource],
    });

    await expect(client.saveExternalResource({
      url: resource.url,
      resourceType: "website",
      metadata: resource.metadata,
      tags: resource.tags,
      notes: resource.notes,
    })).resolves.toMatchObject({ created: true, resource: { id: 9 } });
    await expect(client.listExternalResources()).resolves.toEqual([resource]);
  });

  it("updateRepoNote 调用 mutation 并校验输出", async () => {
    const client = createClientWithMockFetch({
      updateRepoNote: { success: true },
    });

    const result = await client.updateRepoNote(1, "测试备注");
    expect(result).toEqual({ success: true });
  });

  it("getGroupWithMembers 调用 query 并校验输出", async () => {
    const groupData = {
      id: 1,
      userId: 1,
      name: "测试分组",
      color: "blue",
      icon: "folder",
      description: null,
      orderIndex: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      repoCount: 1,
      members: [{
        id: 1,
        groupId: 1,
        repoId: 5,
        orderIndex: 0,
        createdAt: "2026-07-01T00:00:00.000Z",
        repository: null,
      }],
    };
    const client = createClientWithMockFetch({
      "groups.getWithMembers": groupData,
    });

    const result = await client.getGroupWithMembers(1);
    expect(result.id).toBe(1);
    expect(result.name).toBe("测试分组");
    expect(result.members).toHaveLength(1);
  });

  it("createGroup 校验输入并调用 mutation", async () => {
    const groupResult = {
      id: 2,
      userId: 1,
      parentId: null,
      name: "新分组",
      color: "blue",
      icon: "folder",
      description: "描述",
      orderIndex: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      repoCount: 0,
      directRepoCount: 0,
      aggregateRepoCount: 0,
    };
    const client = createClientWithMockFetch({
      "groups.create": groupResult,
    });

    const result = await client.createGroup({ name: "新分组", description: "描述" });
    expect(result.id).toBe(2);
    expect(result.name).toBe("新分组");
  });

  it("读取树与聚合成员时校验层级、计数和真实 membership 来源", async () => {
    const tree = [{
      id: 1,
      userId: 1,
      parentId: null,
      name: "根分组",
      color: "blue",
      icon: "folder",
      description: null,
      orderIndex: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      repoCount: 0,
      directRepoCount: 0,
      aggregateRepoCount: 1,
      children: [],
    }];
    const aggregate = {
      group: { ...tree[0], children: undefined },
      members: [{
        repoId: 5,
        repository: {
          id: 5,
          fullName: "owner/repo",
          name: "repo",
          owner: "owner",
          description: null,
          url: "https://github.com/owner/repo",
          stars: 1,
          forks: 0,
          openIssues: 0,
          language: "TypeScript",
          license: "MIT",
          lastFetchedAt: null,
          starredAt: null,
          note: null,
        },
        memberships: [{
          membershipId: 9,
          groupId: 2,
          groupName: "子分组",
          depth: 1,
          orderIndex: 0,
          isDirect: false,
        }],
      }],
    };
    const client = createClientWithMockFetch({
      "groups.getTree": tree,
      "groups.getAggregateWithMembers": aggregate,
    });

    await expect(client.getGroupTree()).resolves.toEqual(tree);
    const result = await client.getAggregateGroupWithMembers(1);
    expect(result.group.aggregateRepoCount).toBe(1);
    expect(result.members[0].memberships[0]).toMatchObject({ groupId: 2, isDirect: false });
  });

  it("移动分组和同级重排使用明确的新 mutation", async () => {
    const moved = {
      id: 2,
      userId: 1,
      parentId: 1,
      name: "子分组",
      color: "blue",
      icon: "folder",
      description: null,
      orderIndex: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const client = createClientWithMockFetch({
      "groups.move": moved,
      "groups.reorderSiblings": { success: true },
    });

    await expect(client.moveGroup(2, 1)).resolves.toMatchObject({ id: 2, parentId: 1 });
    await expect(client.reorderGroupSiblings(1, [3, 2]))
      .resolves.toEqual({ success: true });
  });

  it("createGroup 拒绝空名称", () => {
    const client = createClientWithMockFetch({});
    expect(() => client.createGroup({ name: "" })).toThrow();
  });

  it("addRepoToGroup 调用 mutation 并校验输出", async () => {
    const memberResult = {
      id: 10,
      groupId: 1,
      repoId: 5,
      orderIndex: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    const client = createClientWithMockFetch({
      "groupMembers.add": memberResult,
    });

    const result = await client.addRepoToGroup(1, 5);
    expect(result.id).toBe(10);
    expect(result.groupId).toBe(1);
    expect(result.repoId).toBe(5);
  });

  it("removeRepoFromGroup 调用 mutation 并校验输出", async () => {
    const client = createClientWithMockFetch({
      "groupMembers.remove": { success: true },
    });

    const result = await client.removeRepoFromGroup(1, 5);
    expect(result).toEqual({ success: true });
  });

  it("startHealthAnalysis 调用 mutation 并校验输出", async () => {
    const client = createClientWithMockFetch({
      startHealthAnalysis: { executionId: "exec-123", deduplicated: false },
    });

    const result = await client.startHealthAnalysis("owner/repo");
    expect(result).toEqual({ executionId: "exec-123", deduplicated: false });
  });

  it("getAnalysisStatus 调用 query 并校验输出", async () => {
    const statusData = {
      executionId: "exec-123",
      status: "running",
      progressPercent: 50,
      currentNode: "analyzing",
      error: null,
      startedAt: "2026-07-28T00:00:00.000Z",
      completedAt: null,
    };
    const client = createClientWithMockFetch({
      getAnalysisStatus: statusData,
    });

    const result = await client.getAnalysisStatus("exec-123");
    expect(result.executionId).toBe("exec-123");
    expect(result.status).toBe("running");
    expect(result.progressPercent).toBe(50);
  });

  it("getHealthReport 调用 query 并校验输出", async () => {
    const reportData = {
      reportId: "report-1",
      reportType: "quick_assessment",
      reportData: { foo: "bar" },
      summary: "测试摘要",
      createdAt: "2026-07-28T00:00:00.000Z",
    };
    const client = createClientWithMockFetch({
      getHealthReport: reportData,
    });

    const result = await client.getHealthReport("exec-123");
    expect(result).not.toBeNull();
    expect(result!.reportId).toBe("report-1");
    expect(result!.summary).toBe("测试摘要");
  });

  it("getHealthReport 返回 null 当报告不存在", async () => {
    const client = createClientWithMockFetch({
      getHealthReport: null,
    });

    const result = await client.getHealthReport("nonexistent");
    expect(result).toBeNull();
  });
});
