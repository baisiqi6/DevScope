import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@devscope/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devscope/db")>();
  return {
    ...actual,
    getLatestGitHubTrendingSnapshot: vi.fn(),
    listRadarCandidates: vi.fn(),
    enqueueRestartableJob: vi.fn(),
    enqueueRepositoryIdentityBackfillJob: vi.fn(),
    getJobByIdempotencyKey: vi.fn(),
    getLatestRepositoryIdentityBackfillJob: vi.fn(),
  };
});

import {
  enqueueRestartableJob,
  enqueueRepositoryIdentityBackfillJob,
  getJobByIdempotencyKey,
  getLatestGitHubTrendingSnapshot,
  getLatestRepositoryIdentityBackfillJob,
  GITHUB_DISCOVERY_JOB_KEY,
  RepositoryIdentityBackfillVersionUsedError,
  users,
} from "@devscope/db";
import { discoveryRouter } from "./discovery";

const getLatest = vi.mocked(getLatestGitHubTrendingSnapshot);
const enqueue = vi.mocked(enqueueRestartableJob);
const getJob = vi.mocked(getJobByIdempotencyKey);
const enqueueIdentity = vi.mocked(enqueueRepositoryIdentityBackfillJob);
const getLatestIdentity = vi.mocked(getLatestRepositoryIdentityBackfillJob);

describe("discovery router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("返回可序列化的最新 GitHub Trending 快照", async () => {
    getLatest.mockResolvedValue({
      snapshot: {
        id: 1,
        period: "daily",
        language: "all",
        snapshotDate: "2026-08-17",
        sourceUrl: "https://github.com/trending?since=daily",
        fetchedAt: new Date("2026-08-17T01:00:00.000Z"),
        entryCount: 1,
        createdAt: new Date("2026-08-17T01:00:00.000Z"),
        updatedAt: new Date("2026-08-17T01:00:00.000Z"),
      },
      entries: [{
        id: 1,
        snapshotId: 1,
        rank: 1,
        fullName: "openai/codex",
        url: "https://github.com/openai/codex",
        description: "Agent",
        language: "TypeScript",
        stars: 10,
        forks: 2,
        starsInPeriod: 5,
        createdAt: new Date("2026-08-17T01:00:00.000Z"),
      }],
    });

    const caller = discoveryRouter.createCaller({ db: {} } as never);
    await expect(caller.getTrending({ period: "daily", language: "all" }))
      .resolves.toMatchObject({
        snapshotDate: "2026-08-17",
        fetchedAt: "2026-08-17T01:00:00.000Z",
        entries: [{ fullName: "openai/codex", starsInPeriod: 5 }],
      });
  });

  it("手动同步复用固定幂等任务", async () => {
    const now = new Date("2026-08-17T01:00:00.000Z");
    enqueue.mockResolvedValue({
      enqueued: true,
      job: {
        id: 1,
        userId: 7,
        type: "trending.sync.github",
        idempotencyKey: "trending:github:all",
        payload: {
          requestedAt: now.toISOString(),
          snapshotDate: "2026-08-17",
          language: "all",
          periods: ["daily", "weekly", "monthly"],
        },
        result: null,
        status: "queued",
        priority: 0,
        attempt: 0,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    const caller = discoveryRouter.createCaller({ db: createUserDb() } as never);

    const result = await caller.startTrendingSync();
    expect(result.status).toBe("running");
    expect(result.alreadyRunning).toBe(false);
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: "trending.sync.github",
      idempotencyKey: "trending:github:all",
    }));
  });

  it("手动发现复用固定幂等任务并报告已有活跃任务", async () => {
    const now = new Date("2026-08-17T02:00:00.000Z");
    enqueue.mockResolvedValue({
      enqueued: false,
      job: createRadarJob({
        status: "running",
        startedAt: now,
        updatedAt: now,
      }),
    });
    const caller = discoveryRouter.createCaller({ db: createUserDb() } as never);

    await expect(caller.startRadarSync()).resolves.toMatchObject({
      status: "running",
      startedAt: now.toISOString(),
      alreadyRunning: true,
    });
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: "radar.discover.github",
      idempotencyKey: GITHUB_DISCOVERY_JOB_KEY,
      payload: expect.objectContaining({
        requestedAt: expect.any(String),
        query: expect.stringContaining("stars:>=10"),
      }),
    }));
  });

  it("返回已完成的发现榜同步状态和可解释结果", async () => {
    const completedAt = new Date("2026-08-17T02:01:00.000Z");
    getJob.mockResolvedValue(createRadarJob({
      status: "succeeded",
      result: {
        source: "github_search",
        query: "created:>=2026-08-10 stars:>=10 archived:false fork:false",
        discovered: 20,
        upserted: 18,
      },
      completedAt,
      updatedAt: completedAt,
    }));
    const caller = discoveryRouter.createCaller({ db: createUserDb() } as never);

    await expect(caller.getRadarSyncStatus()).resolves.toMatchObject({
      status: "completed",
      finishedAt: completedAt.toISOString(),
      result: { discovered: 20, upserted: 18 },
      error: null,
    });
    expect(getJob).toHaveBeenCalledWith(
      expect.anything(),
      7,
      GITHUB_DISCOVERY_JOB_KEY,
    );
  });

  it("启动版本化 identity backfill 并明确报告 active singleton", async () => {
    const now = new Date("2026-08-18T02:00:00.000Z");
    enqueueIdentity.mockResolvedValue({
      enqueued: false,
      job: createIdentityJob({ status: "running", startedAt: now }),
    });
    const caller = discoveryRouter.createCaller({ db: createUserDb() } as never);

    await expect(caller.startRepositoryIdentityBackfill({ version: "v2" }))
      .resolves.toEqual({
        jobId: 9,
        version: "v1",
        status: "running",
        alreadyRunning: true,
      });
    expect(enqueueIdentity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: 7,
      version: "v2",
    }));
  });

  it("复用终态 one-shot version 时拒绝伪报 running", async () => {
    enqueueIdentity.mockRejectedValue(
      new RepositoryIdentityBackfillVersionUsedError("v1", "succeeded"),
    );
    const caller = discoveryRouter.createCaller({ db: createUserDb() } as never);

    await expect(caller.startRepositoryIdentityBackfill({ version: "v1" }))
      .rejects.toThrow(/new version/i);
  });

  it("将 succeeded identity job 区分为 blocked 而不是普通成功", async () => {
    const completedAt = new Date("2026-08-18T02:05:00.000Z");
    getLatestIdentity.mockResolvedValue(createIdentityJob({
      status: "succeeded",
      completedAt,
      updatedAt: completedAt,
      result: {
        outcome: "blocked",
        updated: [],
        unresolved: [],
        conflicts: [{ code: "DUPLICATE_GITHUB_REPOSITORY_ID" }],
      },
    }));
    const caller = discoveryRouter.createCaller({ db: {} } as never);

    await expect(caller.getRepositoryIdentityBackfillStatus()).resolves.toMatchObject({
      status: "blocked",
      version: "v1",
      finishedAt: completedAt.toISOString(),
      result: { outcome: "blocked" },
      error: null,
    });
  });
});

function createUserDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table) => {
        if (table !== users) throw new Error("unexpected table");
        return { limit: vi.fn().mockResolvedValue([{ id: 7 }]) };
      }),
    })),
  };
}

function createRadarJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-08-17T02:00:00.000Z");
  return {
    id: 2,
    userId: 7,
    type: "radar.discover.github",
    idempotencyKey: GITHUB_DISCOVERY_JOB_KEY,
    payload: {
      requestedAt: now.toISOString(),
      query: "created:>=2026-08-10 stars:>=10 archived:false fork:false",
      limit: 20,
      sort: "stars",
      order: "desc",
    },
    result: null,
    status: "queued",
    priority: 0,
    attempt: 0,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}

function createIdentityJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-08-18T02:00:00.000Z");
  return {
    id: 9,
    userId: 7,
    type: "repository.identity.backfill",
    idempotencyKey: "repository:identity:backfill:v1",
    payload: { requestedAt: now.toISOString(), version: "v1" },
    result: null,
    status: "queued",
    priority: 0,
    attempt: 0,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}
