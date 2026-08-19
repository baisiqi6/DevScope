import { describe, expect, it, vi } from "vitest";
import { executeJob, runWorker } from "./worker";
import {
  GITHUB_DISCOVERY_JOB,
  GITHUB_TRENDING_SYNC_JOB,
  GRAPH_REBUILD_JOB,
  HEALTH_ANALYSIS_JOB,
  REPOSITORY_IDENTITY_BACKFILL_JOB,
  TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB,
} from "@devscope/db";

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
    const getInterestProfile = vi.fn().mockResolvedValue({
      totalRepositories: 2,
      languages: { typescript: 2 },
    });

    await expect(executeJob({} as any, createJob(), {
      searchRepositories,
      upsertCandidate,
      getInterestProfile,
      now: () => new Date("2026-07-16T00:00:00.000Z"),
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
      deterministicScore: expect.any(Number),
      scoreBreakdown: expect.objectContaining({
        languageAffinity: 25,
        freshness: 25,
      }),
      evidence: expect.objectContaining({
        query: "created:>=2026-07-09 stars:>=10 archived:false fork:false",
        topics: ["agents"],
        interestProfile: expect.objectContaining({ totalRepositories: 2 }),
      }),
    }));
  });

  it("拒绝未知任务类型和无效 payload", async () => {
    await expect(executeJob({} as any, createJob({ type: "unknown" })))
      .rejects.toThrow("不支持的任务类型");

    await expect(executeJob({} as any, createJob({ payload: { limit: 0 } })))
      .rejects.toThrow();
  });

  it("执行持久健康分析并复用既有 execution", async () => {
    const runHealthAnalysis = vi.fn().mockResolvedValue({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      report: { reportId: "report-1" },
      reportPath: "",
    });
    const job = createJob({
      type: HEALTH_ANALYSIS_JOB,
      idempotencyKey: "analysis:health:owner/repo",
      payload: {
        executionId: "550e8400-e29b-41d4-a716-446655440000",
        repoFullName: "owner/repo",
      },
    });

    await expect(executeJob({} as any, job, { runHealthAnalysis })).resolves.toEqual({
      executionId: "550e8400-e29b-41d4-a716-446655440000",
      reportId: "report-1",
    });
    expect(runHealthAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      7,
      { repos: ["owner/repo"], analysisType: "health_report" },
      {},
      {
        executionId: "550e8400-e29b-41d4-a716-446655440000",
        resumeExecution: true,
      },
    );
  });

  it("执行持久图谱重建", async () => {
    const rebuildGraph = vi.fn().mockResolvedValue({
      similarityEdges: 3,
      dependencyEdges: 4,
      pooledRepos: 5,
      sbomBackfilled: 2,
    });
    const job = createJob({
      type: GRAPH_REBUILD_JOB,
      idempotencyKey: "graph:rebuild",
      payload: { requestedAt: "2026-07-29T00:00:00.000Z" },
    });

    await expect(executeJob({} as any, job, { rebuildGraph })).resolves.toEqual({
      similarityEdges: 3,
      dependencyEdges: 4,
      pooledRepos: 5,
      sbomBackfilled: 2,
    });
  });

  it("图谱重建任务把 jobId/workerId 传给 rebuild 依赖（lease 进度与提交复核）", async () => {
    const rebuildGraph = vi.fn().mockResolvedValue({
      similarityEdges: 0,
      dependencyEdges: 0,
      pooledRepos: 0,
      sbomBackfilled: 0,
    });
    const job = createJob({
      type: GRAPH_REBUILD_JOB,
      id: 42,
      idempotencyKey: "graph:rebuild",
      payload: { requestedAt: "2026-07-29T00:00:00.000Z" },
    });

    await executeJob({} as any, job, { rebuildGraph, workerId: "worker-a" });

    expect(rebuildGraph).toHaveBeenCalledTimes(1);
    const [dbArg, userIdArg, jobContext] = rebuildGraph.mock.calls[0];
    expect(dbArg).toBeDefined();
    expect(typeof userIdArg).toBe("number");
    expect(jobContext).toEqual({ jobId: 42, workerId: "worker-a" });
  });

  it("runWorker 在非法外呼配置上启动即失败（fail closed，不进入轮询）", async () => {
    const previous = process.env.GRAPH_DEPS_CONCURRENCY;
    process.env.GRAPH_DEPS_CONCURRENCY = "64";
    try {
      await expect(
        runWorker({} as any, { workerId: "w", pollIntervalMs: 1 }, () => true)
      ).rejects.toThrow(/GRAPH_DEPS_CONCURRENCY/);
    } finally {
      if (previous === undefined) {
        delete process.env.GRAPH_DEPS_CONCURRENCY;
      } else {
        process.env.GRAPH_DEPS_CONCURRENCY = previous;
      }
    }
  });

  it("将三个 GitHub Trending 周期保存为独立快照", async () => {
    const fetchTrending = vi.fn(async (period: "daily" | "weekly" | "monthly") => ({
      period,
      language: "all",
      sourceUrl: `https://github.com/trending?since=${period}`,
      entries: [{
        rank: 1,
        fullName: `owner/${period}`,
        url: `https://github.com/owner/${period}`,
        description: null,
        language: "TypeScript",
        stars: 10,
        forks: 1,
        starsInPeriod: 3,
      }],
    }));
    const saveTrendingSnapshot = vi.fn().mockResolvedValue({});
    const job = createJob({
      type: GITHUB_TRENDING_SYNC_JOB,
      idempotencyKey: "trending:github:all",
      payload: {
        requestedAt: "2026-08-17T00:00:00.000Z",
        snapshotDate: "2026-08-17",
        language: "all",
        periods: ["daily", "weekly", "monthly"],
      },
    });

    await expect(executeJob({} as any, job, {
      fetchTrending,
      saveTrendingSnapshot,
      now: () => new Date("2026-08-17T01:00:00.000Z"),
    })).resolves.toEqual({
      source: "github_trending",
      snapshots: 3,
      entries: 3,
    });

    expect(fetchTrending).toHaveBeenCalledTimes(3);
    expect(saveTrendingSnapshot).toHaveBeenCalledTimes(3);
    expect(saveTrendingSnapshot).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      period: "daily",
      snapshotDate: "2026-08-17",
    }));
  });

  it("repository identity backfill 将 worker lease authority 传给原子执行器", async () => {
    const runRepositoryIdentityBackfill = vi.fn().mockResolvedValue({
      outcome: "applied",
      updated: [],
      unresolved: [],
      conflicts: [],
    });
    const resolveRepositoryIdentity = vi.fn();
    const job = createJob({
      type: REPOSITORY_IDENTITY_BACKFILL_JOB,
      idempotencyKey: "repository:identity:backfill:v1",
      payload: {
        requestedAt: "2026-08-18T00:00:00.000Z",
        version: "v1",
      },
    });

    await expect(executeJob({} as any, job, {
      workerId: "worker-1",
      runRepositoryIdentityBackfill,
      resolveRepositoryIdentity,
      now: () => new Date("2026-08-18T00:01:00.000Z"),
    })).resolves.toEqual({
      outcome: "applied",
      updated: [],
      unresolved: [],
      conflicts: [],
    });
    expect(runRepositoryIdentityBackfill).toHaveBeenCalledWith(
      expect.anything(),
      job,
      "worker-1",
      resolveRepositoryIdentity,
      new Date("2026-08-18T00:01:00.000Z"),
    );
  });

  it("technology stack backfill 将 worker lease authority 传给专用执行器", async () => {
    const runTechnologyStackEntitiesBackfill = vi.fn().mockResolvedValue({
      outcome: "succeeded",
      processedSources: 1,
    });
    const job = createJob({
      type: TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB,
      idempotencyKey: "technology-stack:entities:backfill:v1",
      payload: {
        requestedAt: "2026-08-18T00:00:00.000Z",
        version: "v1",
      },
    });

    await expect(executeJob({} as any, job, {
      workerId: "worker-1",
      runTechnologyStackEntitiesBackfill,
      now: () => new Date("2026-08-18T00:01:00.000Z"),
    })).resolves.toEqual({ outcome: "succeeded", processedSources: 1 });
    expect(runTechnologyStackEntitiesBackfill).toHaveBeenCalledWith(
      expect.anything(),
      job,
      "worker-1",
      expect.any(Function),
    );
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
      requestedAt: now.toISOString(),
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
