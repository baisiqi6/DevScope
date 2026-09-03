import { describe, expect, it, vi } from "vitest";
import type { DevScopeClient } from "@devscope/client";
import { runCli, type CliOutput } from "./cli";

function captureOutput(): { output: CliOutput; read: () => string } {
  const chunks: string[] = [];
  return {
    output: { write: (value) => { chunks.push(value); } },
    read: () => chunks.join(""),
  };
}

function createStubClient(): DevScopeClient {
  return {
    health: vi.fn().mockResolvedValue({ status: "ok", timestamp: "2026-07-16T00:00:00.000Z" }),
    listRepositories: vi.fn().mockResolvedValue([]),
    getRepository: vi.fn(),
    getRepositoryDeleteImpact: vi.fn(),
    archiveRepository: vi.fn().mockResolvedValue({ success: true, repoId: 1, isArchived: true, repositoryDeleted: false }),
    unarchiveRepository: vi.fn().mockResolvedValue({ success: true, repoId: 1, isArchived: false, repositoryDeleted: false }),
    deleteRepository: vi.fn().mockResolvedValue({ success: true, repoId: 1, isArchived: false, repositoryDeleted: true }),
    collectRepository: vi.fn(),
    getEmbeddingStatus: vi.fn(),
    semanticSearch: vi.fn(),
    listGroups: vi.fn().mockResolvedValue([]),
    getGroupTree: vi.fn().mockResolvedValue([]),
    updateRepoNote: vi.fn().mockResolvedValue({ success: true }),
    getGroupWithMembers: vi.fn(),
    getAggregateGroupWithMembers: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn().mockResolvedValue({ success: true }),
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
    requestExternalResourceContent: vi.fn(),
    enableExternalResourceContent: vi.fn(),
    getExternalResourceContentStatus: vi.fn(),
    readExternalResourceContent: vi.fn(),
    listExternalResourceGroups: vi.fn().mockResolvedValue([]),
    createExternalResourceGroup: vi.fn(),
    getExternalResourceGroupMembers: vi.fn().mockResolvedValue([]),
    addExternalResourceToGroup: vi.fn(),
    removeExternalResourceFromGroup: vi.fn().mockResolvedValue({ success: true }),
  };
}

describe("DevScope CLI", () => {
  it("resource content commands call typed client", async () => {
    const client = createStubClient();
    vi.mocked(client.requestExternalResourceContent).mockResolvedValue({ resourceId: 7, status: "pending", error: null, fetchedAt: null });
    vi.mocked(client.getExternalResourceContentStatus).mockResolvedValue({ resourceId: 7, status: "completed", error: null, fetchedAt: null });
    vi.mocked(client.readExternalResourceContent).mockResolvedValue({ resourceId: 7, status: "completed", error: null, fetchedAt: null, contentType: "html", text: "ok", finalUrl: "https://example.com" });
    vi.mocked(client.enableExternalResourceContent).mockResolvedValue({ resourceId: 7, ingestionMode: "content", status: "not_requested", error: null, fetchedAt: null });
    expect(await runCli(["resource", "content-enable", "7"], { createClient: () => client })).toBe(0);
    expect(await runCli(["resource", "content-request", "7"], { createClient: () => client })).toBe(0);
    expect(await runCli(["resource", "content-status", "7"], { createClient: () => client })).toBe(0);
    expect(await runCli(["resource", "content-read", "7"], { createClient: () => client })).toBe(0);
    expect(client.requestExternalResourceContent).toHaveBeenCalledWith(7);
    expect(client.enableExternalResourceContent).toHaveBeenCalledWith(7);
  });
  it("help 不初始化客户端", async () => {
    const stdout = captureOutput();
    const createClient = vi.fn();

    const exitCode = await runCli(["--help"], {
      createClient,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
    expect(stdout.read()).toContain("devscope repo collect");
  });

  it("health 将 JSON 写入 stdout", async () => {
    const stdout = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(["health"], {
      createClient: () => client,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.read())).toEqual({
      status: "ok",
      timestamp: "2026-07-16T00:00:00.000Z",
    });
  });

  it("解析仓库列表分页参数", async () => {
    const stdout = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(
      ["repo", "list", "--limit", "10", "--offset", "20"],
      { createClient: () => client, stdout: stdout.output },
    );

    expect(exitCode).toBe(0);
    expect(client.listRepositories).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });

  it("仓库归档/恢复与删除要求显式确认", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    const client = createStubClient();
    vi.mocked(client.getRepositoryDeleteImpact).mockResolvedValue({
      repoId: 5, groupMemberships: 2, chunks: 10, releases: 1,
      hackernewsItems: 0, relationships: 3, technologyStacks: 1, otherWatchers: 0,
    });

    await expect(runCli(["repo", "delete-impact", "5"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    expect(client.getRepositoryDeleteImpact).toHaveBeenCalledWith(5);

    await expect(runCli(["repo", "archive", "5"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    expect(client.archiveRepository).toHaveBeenCalledWith(5);

    await expect(runCli(["repo", "delete", "5"], {
      createClient: () => client, stderr: stderr.output,
    })).resolves.toBe(2);
    expect(client.deleteRepository).not.toHaveBeenCalled();

    await expect(runCli(["repo", "delete", "5", "--confirm"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    expect(client.deleteRepository).toHaveBeenCalledWith(5, true);
  });

  it("解析外部资源列表类型", async () => {
    const stdout = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(
      ["resource", "list", "--type", "website", "--limit", "8"],
      { createClient: () => client, stdout: stdout.output },
    );

    expect(exitCode).toBe(0);
    expect(client.listExternalResources).toHaveBeenCalledWith({
      limit: 8,
      offset: 0,
      resourceType: "website",
    });
  });

  it("外部资源保存必须指定类型", async () => {
    const stderr = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(
      ["resource", "save", "https://example.com"],
      { createClient: () => client, stderr: stderr.output },
    );

    expect(exitCode).toBe(2);
    expect(client.saveExternalResource).not.toHaveBeenCalled();
  });

  it("解析外部资源预览元数据", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    const exitCode = await runCli([
      "resource", "save", "https://example.com/article", "--type", "article",
      "--site-name", "Example", "--author", "Ada", "--metadata-json", '{"source":"manual"}',
    ], { createClient: () => client, stdout: stdout.output });

    expect(exitCode).toBe(0);
    expect(client.saveExternalResource).toHaveBeenCalledWith(expect.objectContaining({
      siteName: "Example",
      author: "Ada",
      metadata: { source: "manual" },
    }));
  });

  it("无效参数写入 stderr 并返回退出码 2", async () => {
    const stderr = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(["repo", "list", "--unknown"], {
      createClient: () => client,
      stderr: stderr.output,
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stderr.read()).error.code).toBe("INVALID_ARGUMENT");
  });

  it("拒绝超出 API 契约的分页参数", async () => {
    const stderr = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(["repo", "list", "--limit", "0"], {
      createClient: () => client,
      stderr: stderr.output,
    });

    expect(exitCode).toBe(2);
    expect(client.listRepositories).not.toHaveBeenCalled();
  });

  it("采集等待会轮询到向量化完成", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.collectRepository).mockResolvedValue({
      repository: {
        id: 7,
        fullName: "owner/repo",
        name: "repo",
        owner: "owner",
        stars: 1,
        forks: 0,
      },
      chunksCollected: 3,
      embeddingsGenerated: 0,
      hnItemsCollected: 0,
      status: "success",
      duration: 10,
      embeddingInBackground: true,
    });
    vi.mocked(client.getEmbeddingStatus)
      .mockResolvedValueOnce({
        repoId: 7,
        status: "processing",
        progress: 50,
        totalChunks: 2,
        completedChunks: 1,
        startedAt: null,
        completedAt: null,
        error: null,
      })
      .mockResolvedValueOnce({
        repoId: 7,
        status: "completed",
        progress: 100,
        totalChunks: 2,
        completedChunks: 2,
        startedAt: null,
        completedAt: "2026-07-16T00:00:00.000Z",
        error: null,
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(
      ["repo", "collect", "owner/repo", "--wait", "--poll-interval-ms", "1"],
      { createClient: () => client, stdout: stdout.output, sleep },
    );

    expect(exitCode).toBe(0);
    expect(client.getEmbeddingStatus).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1);
    expect(JSON.parse(stdout.read()).embeddingStatus.status).toBe("completed");
  });

  it("API 错误写入 stderr 并返回退出码 1", async () => {
    const stderr = captureOutput();
    const client = createStubClient();
    vi.mocked(client.health).mockRejectedValue(new Error("连接失败"));

    const exitCode = await runCli(["health"], {
      createClient: () => client,
      stderr: stderr.output,
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr.read())).toEqual({
      error: { code: "COMMAND_FAILED", message: "连接失败" },
    });
  });

  it("repo note 更新仓库备注", async () => {
    const stdout = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(["repo", "note", "5", "重要项目"], {
      createClient: () => client,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(client.updateRepoNote).toHaveBeenCalledWith(5, "重要项目");
    expect(JSON.parse(stdout.read())).toEqual({ success: true });
  });

  it("group create 创建分组", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.createGroup).mockResolvedValue({
      id: 3,
      userId: 1,
      parentId: 9,
      name: "前端框架",
      color: "blue",
      icon: "folder",
      description: "前端相关",
      orderIndex: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      repoCount: 0,
      directRepoCount: 0,
      aggregateRepoCount: 0,
    });

    const exitCode = await runCli(
      ["group", "create", "前端框架", "--description", "前端相关", "--parent-id", "9"],
      { createClient: () => client, stdout: stdout.output },
    );

    expect(exitCode).toBe(0);
    expect(client.createGroup).toHaveBeenCalledWith({
      name: "前端框架",
      description: "前端相关",
      parentId: 9,
    });
  });

  it("group tree、aggregate-members、move 与 reorder 映射统一 Client", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.getAggregateGroupWithMembers).mockResolvedValue({
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
    vi.mocked(client.moveGroup).mockResolvedValue({
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

    await expect(runCli(["group", "tree"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    await expect(runCli(["group", "aggregate-members", "1"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    await expect(runCli(["group", "move", "2", "1"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    await expect(runCli(["group", "reorder", "1", "3", "2"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);

    expect(client.getGroupTree).toHaveBeenCalledOnce();
    expect(client.getAggregateGroupWithMembers).toHaveBeenCalledWith(1);
    expect(client.moveGroup).toHaveBeenCalledWith(2, 1);
    expect(client.reorderGroupSiblings).toHaveBeenCalledWith(1, [3, 2]);
  });

  it("group update 与 delete 需要显式参数/确认", async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    const client = createStubClient();
    vi.mocked(client.updateGroup).mockResolvedValue({
      id: 2,
      userId: 1,
      parentId: null,
      name: "新名称",
      color: "green",
      icon: "folder",
      description: "说明",
      orderIndex: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    });

    await expect(runCli(["group", "update", "2", "--name", "新名称", "--color", "green"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    expect(client.updateGroup).toHaveBeenCalledWith({
      groupId: 2,
      name: "新名称",
      description: undefined,
      color: "green",
      icon: undefined,
    });

    await expect(runCli(["group", "delete", "2"], {
      createClient: () => client, stderr: stderr.output,
    })).resolves.toBe(2);
    expect(client.deleteGroup).not.toHaveBeenCalled();

    await expect(runCli(["group", "delete", "2", "--confirm"], {
      createClient: () => client, stdout: stdout.output,
    })).resolves.toBe(0);
    expect(client.deleteGroup).toHaveBeenCalledWith(2, true);
  });

  it("group members 获取分组成员", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.getGroupWithMembers).mockResolvedValue({
      id: 1,
      userId: 1,
      name: "测试",
      color: "blue",
      icon: "folder",
      description: null,
      orderIndex: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      repoCount: 0,
      members: [],
    });

    const exitCode = await runCli(["group", "members", "1"], {
      createClient: () => client,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(client.getGroupWithMembers).toHaveBeenCalledWith(1);
  });

  it("group add 添加仓库到分组", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.addRepoToGroup).mockResolvedValue({
      id: 1,
      groupId: 2,
      repoId: 5,
      orderIndex: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
    });

    const exitCode = await runCli(["group", "add", "2", "5"], {
      createClient: () => client,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(client.addRepoToGroup).toHaveBeenCalledWith(2, 5);
  });

  it("group remove 从分组移除仓库", async () => {
    const stdout = captureOutput();
    const client = createStubClient();

    const exitCode = await runCli(["group", "remove", "2", "5"], {
      createClient: () => client,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(client.removeRepoFromGroup).toHaveBeenCalledWith(2, 5);
  });

  it("analyze start 启动分析", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.startHealthAnalysis).mockResolvedValue({
      executionId: "exec-1",
      deduplicated: false,
    });

    const exitCode = await runCli(["analyze", "start", "owner/repo"], {
      createClient: () => client,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(client.startHealthAnalysis).toHaveBeenCalledWith("owner/repo");
    expect(JSON.parse(stdout.read())).toEqual({ executionId: "exec-1", deduplicated: false });
  });

  it("analyze status 查询状态", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.getAnalysisStatus).mockResolvedValue({
      executionId: "exec-1",
      status: "running",
      progressPercent: 50,
      currentNode: "analyzing",
      error: null,
      startedAt: "2026-07-28T00:00:00.000Z",
      completedAt: null,
    });

    const exitCode = await runCli(["analyze", "status", "exec-1"], {
      createClient: () => client,
      stdout: stdout.output,
    });

    expect(exitCode).toBe(0);
    expect(client.getAnalysisStatus).toHaveBeenCalledWith("exec-1");
  });

  it("analyze report --wait 轮询到完成后获取报告", async () => {
    const stdout = captureOutput();
    const client = createStubClient();
    vi.mocked(client.getAnalysisStatus)
      .mockResolvedValueOnce({
        executionId: "exec-1",
        status: "running",
        progressPercent: 50,
        currentNode: "analyzing",
        error: null,
        startedAt: "2026-07-28T00:00:00.000Z",
        completedAt: null,
      })
      .mockResolvedValueOnce({
        executionId: "exec-1",
        status: "completed",
        progressPercent: 100,
        currentNode: "completed",
        error: null,
        startedAt: "2026-07-28T00:00:00.000Z",
        completedAt: "2026-07-28T00:01:00.000Z",
      });
    vi.mocked(client.getHealthReport).mockResolvedValue({
      reportId: "report-1",
      reportType: "quick_assessment",
      reportData: {},
      summary: "测试",
      createdAt: "2026-07-28T00:01:00.000Z",
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(
      ["analyze", "report", "exec-1", "--wait", "--poll-interval-ms", "1"],
      { createClient: () => client, stdout: stdout.output, sleep },
    );

    expect(exitCode).toBe(0);
    expect(client.getAnalysisStatus).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1);
    expect(client.getHealthReport).toHaveBeenCalledWith("exec-1");
  });

  it("analyze report --wait 超时返回退出码 1", async () => {
    const stderr = captureOutput();
    const client = createStubClient();
    vi.mocked(client.getAnalysisStatus).mockResolvedValue({
      executionId: "exec-1",
      status: "running",
      progressPercent: 10,
      currentNode: "analyzing",
      error: null,
      startedAt: "2026-07-28T00:00:00.000Z",
      completedAt: null,
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(
      ["analyze", "report", "exec-1", "--wait", "--timeout-ms", "1", "--poll-interval-ms", "1"],
      { createClient: () => client, stderr: stderr.output, sleep },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr.read()).error.message).toContain("超时");
  });
});
