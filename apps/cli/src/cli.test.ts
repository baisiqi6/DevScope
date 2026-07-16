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
});
