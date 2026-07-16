import { describe, expect, it, vi } from "vitest";
import { executeJob, GITHUB_DISCOVERY_JOB } from "./worker";

describe("Worker 任务执行", () => {
  it("将 GitHub Search 结果写入用户候选池", async () => {
    const searchRepositories = vi.fn().mockResolvedValue([{
      githubRepoId: "123",
      fullName: "owner/repo",
      owner: "owner",
      name: "repo",
      description: "Repository",
      language: "TypeScript",
      stars: 100,
      forks: 10,
      openIssues: 2,
      topics: ["agents"],
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      pushedAt: new Date("2026-07-16T00:00:00.000Z"),
    }]);
    const upsertCandidate = vi.fn().mockResolvedValue({ id: 1 });

    await expect(executeJob({} as any, createJob(), {
      searchRepositories,
      upsertCandidate,
    })).resolves.toEqual({
      source: "github_search",
      query: "created:>=2026-07-09 stars:>=10 archived:false fork:false",
      discovered: 1,
      upserted: 1,
    });

    expect(searchRepositories).toHaveBeenCalledWith(
      "created:>=2026-07-09 stars:>=10 archived:false fork:false",
      { limit: 20, sort: "stars", order: "desc" }
    );
    expect(upsertCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: 7,
      fullName: "owner/repo",
      source: "github_search",
      evidence: expect.objectContaining({
        query: "created:>=2026-07-09 stars:>=10 archived:false fork:false",
        topics: ["agents"],
      }),
    }));
  });

  it("拒绝未知任务类型和无效 payload", async () => {
    await expect(executeJob({} as any, createJob({ type: "unknown" })))
      .rejects.toThrow("不支持的任务类型");

    await expect(executeJob({} as any, createJob({ payload: { limit: 0 } })))
      .rejects.toThrow();
  });
});

function createJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-16T00:00:00.000Z");
  return {
    id: 1,
    userId: 7,
    type: GITHUB_DISCOVERY_JOB,
    idempotencyKey: "radar:2026-07-16",
    payload: {
      query: "created:>=2026-07-09 stars:>=10 archived:false fork:false",
      limit: 20,
      sort: "stars",
      order: "desc",
    },
    result: null,
    status: "running",
    priority: 0,
    attempt: 1,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date("2026-07-16T00:05:00.000Z"),
    lastError: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}
