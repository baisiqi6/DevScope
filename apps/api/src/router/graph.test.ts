import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnqueue,
  mockEnqueueTechnologyStackBackfill,
  mockGetJob,
  mockGetLatestTechnologyStackBackfill,
  mockGetGraph,
  mockGetCurrentUserId,
} = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockEnqueueTechnologyStackBackfill: vi.fn(),
  mockGetJob: vi.fn(),
  mockGetLatestTechnologyStackBackfill: vi.fn(),
  mockGetGraph: vi.fn(),
  mockGetCurrentUserId: vi.fn(),
}));

vi.mock("@devscope/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devscope/db")>();
  return {
    ...actual,
    getRepoGraphData: mockGetGraph,
    enqueueRestartableJob: mockEnqueue,
    enqueueTechnologyStackEntitiesBackfillJob: mockEnqueueTechnologyStackBackfill,
    getJobByIdempotencyKey: mockGetJob,
    getLatestTechnologyStackEntitiesBackfillJob: mockGetLatestTechnologyStackBackfill,
  };
});

vi.mock("../current-user", () => ({
  getOrCreateCurrentUserId: mockGetCurrentUserId,
}));

import { graphRouter } from "./graph";

const caller = graphRouter.createCaller({ db: {} } as never);

describe("graph router 持久重建任务", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(7);
  });

  it("按当前 userId 读取图谱", async () => {
    mockGetGraph.mockResolvedValue({ nodes: [], edges: [] });

    await expect(caller.getRepoGraph()).resolves.toEqual({ nodes: [], edges: [] });
    expect(mockGetGraph).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("启动时入队，已有活跃任务时返回 alreadyRunning", async () => {
    mockEnqueue
      .mockResolvedValueOnce({ job: createJob({ status: "queued" }), enqueued: true })
      .mockResolvedValueOnce({ job: createJob({ status: "running" }), enqueued: false });

    await expect(caller.startRebuildGraph()).resolves.toEqual({
      status: "running",
      startedAt: expect.any(String),
      alreadyRunning: false,
    });
    await expect(caller.startRebuildGraph()).resolves.toEqual({
      status: "running",
      startedAt: expect.any(String),
      alreadyRunning: true,
    });
  });

  it("重启终态任务后沿用本轮 payload 的请求时间", async () => {
    const requestedAt = "2026-07-29T08:30:00.000Z";
    mockEnqueue.mockResolvedValue({
      job: createJob({
        payload: { requestedAt },
        startedAt: null,
        createdAt: new Date("2026-07-28T00:00:00.000Z"),
      }),
      enqueued: false,
    });

    await expect(caller.startRebuildGraph()).resolves.toEqual({
      status: "running",
      startedAt: requestedAt,
      alreadyRunning: true,
    });
  });

  it.each([
    ["queued", "running"],
    ["retry_wait", "running"],
    ["running", "running"],
    ["succeeded", "completed"],
    ["dead", "failed"],
    ["cancelled", "failed"],
  ] as const)("将 job 状态 %s 映射为图谱状态 %s", async (jobStatus, graphStatus) => {
    mockGetJob.mockResolvedValue(createJob({ status: jobStatus }));

    const status = await caller.getRebuildGraphStatus();

    expect(status.status).toBe(graphStatus);
    if (graphStatus === "completed") {
      expect(status.result).toEqual({
        similarityEdges: 3,
        dependencyEdges: 4,
        pooledRepos: 5,
        sbomBackfilled: 2,
      });
    }
    if (graphStatus === "failed") {
      expect(status.error).toBe("graph failed");
    }
  });

  it("没有历史任务时返回 idle", async () => {
    mockGetJob.mockResolvedValue(null);
    await expect(caller.getRebuildGraphStatus()).resolves.toEqual({
      status: "idle",
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    });
  });

  it("技术栈实体 backfill 使用版本化 singleton 并暴露终态 receipt", async () => {
    const job = createTechnologyStackBackfillJob();
    mockEnqueueTechnologyStackBackfill.mockResolvedValue({ job, enqueued: true });
    await expect(caller.startTechnologyStackEntitiesBackfill({ version: "v1" }))
      .resolves.toMatchObject({
        jobId: 21,
        version: "v1",
        status: "running",
        alreadyRunning: false,
      });

    mockGetLatestTechnologyStackBackfill.mockResolvedValue({
      ...job,
      status: "succeeded",
    });
    await expect(caller.getTechnologyStackEntitiesBackfillStatus())
      .resolves.toMatchObject({
        status: "completed",
        version: "v1",
        result: { outcome: "succeeded", processedSources: 1 },
      });
  });
});

function createJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-29T00:00:00.000Z");
  return {
    id: 1,
    userId: 7,
    type: "graph.rebuild",
    idempotencyKey: "graph:rebuild",
    payload: { requestedAt: now.toISOString() },
    result: {
      similarityEdges: 3,
      dependencyEdges: 4,
      pooledRepos: 5,
      sbomBackfilled: 2,
    },
    status: "queued",
    priority: 0,
    attempt: 0,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: "graph failed",
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTechnologyStackBackfillJob() {
  const now = new Date("2026-08-18T00:00:00.000Z");
  return {
    ...createJob(),
    id: 21,
    type: "technology_stack.entities.backfill",
    idempotencyKey: "technology-stack:entities:backfill:v1",
    payload: { requestedAt: now.toISOString(), version: "v1" },
    result: {
      outcome: "succeeded",
      version: "v1",
      planDigest: "a".repeat(64),
      totalSources: 1,
      processedSources: 1,
      lastGithubRepositoryId: "100",
      receipts: [{
        githubRepositoryId: "100",
        sourceDigest: "b".repeat(64),
        relations: 1,
        evidenceAudit: [],
      }],
    },
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
