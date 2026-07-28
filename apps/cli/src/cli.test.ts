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
    collectRepository: vi.fn(),
    getEmbeddingStatus: vi.fn(),
    semanticSearch: vi.fn(),
    listGroups: vi.fn().mockResolvedValue([]),
    updateRepoNote: vi.fn().mockResolvedValue({ success: true }),
    getGroupWithMembers: vi.fn(),
    createGroup: vi.fn(),
    addRepoToGroup: vi.fn(),
    removeRepoFromGroup: vi.fn().mockResolvedValue({ success: true }),
    startHealthAnalysis: vi.fn(),
    getAnalysisStatus: vi.fn(),
    getHealthReport: vi.fn(),
  };
}

describe("DevScope CLI", () => {
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
      name: "前端框架",
      color: "blue",
      icon: "folder",
      description: "前端相关",
      orderIndex: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      repoCount: 0,
    });

    const exitCode = await runCli(
      ["group", "create", "前端框架", "--description", "前端相关"],
      { createClient: () => client, stdout: stdout.output },
    );

    expect(exitCode).toBe(0);
    expect(client.createGroup).toHaveBeenCalledWith({ name: "前端框架", description: "前端相关" });
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
