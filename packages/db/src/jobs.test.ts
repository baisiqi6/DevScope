import { describe, expect, it, vi } from "vitest";
import {
  claimNextJob,
  enqueueJob,
  enqueueRestartableJob,
  enqueueRepositoryIdentityBackfillJob,
  enqueueTechnologyStackEntitiesBackfillJob,
  failJob,
  recoverExpiredJobs,
  renewJobLease,
} from "./jobs";

describe("持久任务队列", () => {
  it("首次入队返回新任务", async () => {
    const created = createJob({ id: 11 });
    const returning = vi.fn().mockResolvedValue([created]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) };

    await expect(enqueueJob(db as any, {
      userId: 7,
      type: "radar.discover.github",
      idempotencyKey: "radar:2026-07-16",
      payload: { period: "7d" },
    })).resolves.toBe(created);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      type: "radar.discover.github",
      idempotencyKey: "radar:2026-07-16",
      maxAttempts: 3,
    }));
  });

  it("幂等键冲突时返回已有任务", async () => {
    const existing = createJob({ id: 12 });
    const returning = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockResolvedValue([existing]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({ returning })),
        })),
      })),
      select: vi.fn(() => ({ from })),
    };

    await expect(enqueueJob(db as any, {
      userId: 7,
      type: "radar.discover.github",
      idempotencyKey: "radar:2026-07-16",
    })).resolves.toBe(existing);
  });

  it("可重启任务在终态时原子重排队", async () => {
    const restarted = createJob({
      type: "graph.rebuild",
      idempotencyKey: "graph:rebuild",
      status: "queued",
      payload: { requestedAt: "2026-07-29T00:00:00.000Z" },
    });
    const insertReturning = vi.fn().mockResolvedValue([]);
    const updateReturning = vi.fn().mockResolvedValue([restarted]);
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({ returning: insertReturning })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: updateReturning })),
        })),
      })),
    };

    await expect(enqueueRestartableJob(db as any, {
      userId: 7,
      type: "graph.rebuild",
      idempotencyKey: "graph:rebuild",
      payload: { requestedAt: "2026-07-29T00:00:00.000Z" },
    })).resolves.toEqual({ job: restarted, enqueued: true });
  });

  it("可重启任务活跃时返回现有任务", async () => {
    const existing = createJob({
      type: "analysis.health",
      idempotencyKey: "analysis:health:owner/repo",
      status: "running",
      payload: { executionId: "execution-existing" },
    });
    const insertReturning = vi.fn().mockResolvedValue([]);
    const updateReturning = vi.fn().mockResolvedValue([]);
    const selectLimit = vi.fn().mockResolvedValue([existing]);
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({ returning: insertReturning })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: updateReturning })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: selectLimit })),
        })),
      })),
    };

    await expect(enqueueRestartableJob(db as any, {
      userId: 7,
      type: "analysis.health",
      idempotencyKey: "analysis:health:owner/repo",
      payload: { executionId: "execution-new" },
    })).resolves.toEqual({ job: existing, enqueued: false });
  });

  it("repository identity 使用全局 active singleton 并返回现有任务", async () => {
    const existing = createJob({
      id: 42,
      type: "repository.identity.backfill",
      idempotencyKey: "repository:identity:backfill:v1",
      status: "running",
    });
    const insertReturning = vi.fn().mockResolvedValue([]);
    const activeLimit = vi.fn().mockResolvedValue([existing]);
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({ returning: insertReturning })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: activeLimit })),
          })),
        })),
      })),
    };

    await expect(enqueueRepositoryIdentityBackfillJob(db as any, {
      userId: 7,
      version: "v2",
      requestedAt: new Date("2026-08-18T00:00:00Z"),
    })).resolves.toEqual({ job: existing, enqueued: false });
  });

  it("repository identity 拒绝复用已经终态的 one-shot version", async () => {
    const terminal = createJob({
      id: 43,
      type: "repository.identity.backfill",
      idempotencyKey: "repository:identity:backfill:v1",
      status: "succeeded",
      result: { outcome: "applied", updated: [], unresolved: [], conflicts: [] },
    });
    const insertReturning = vi.fn().mockResolvedValue([]);
    const activeLimit = vi.fn().mockResolvedValue([]);
    const terminalLimit = vi.fn().mockResolvedValue([terminal]);
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: activeLimit })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: terminalLimit })),
        })),
      });
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({ returning: insertReturning })),
        })),
      })),
      select,
    };

    await expect(enqueueRepositoryIdentityBackfillJob(db as any, {
      userId: 7,
      version: "v1",
    })).rejects.toThrow(/new version/i);
  });

  it("使用租约领取可执行任务并增加 attempt", async () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const candidate = createJob({ attempt: 1, startedAt: null });
    const claimed = createJob({
      status: "running",
      attempt: 2,
      leaseOwner: "worker-1",
    });
    const forUpdate = vi.fn().mockResolvedValue([candidate]);
    const limit = vi.fn(() => ({ for: forUpdate }));
    const orderBy = vi.fn(() => ({ limit }));
    const selectWhere = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const updateReturning = vi.fn().mockResolvedValue([claimed]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const tx = {
      select: vi.fn(() => ({ from })),
      update: vi.fn(() => ({ set: updateSet })),
    };
    const db = {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await expect(claimNextJob(db as any, {
      workerId: "worker-1",
      leaseDurationMs: 60_000,
      now,
    })).resolves.toBe(claimed);

    expect(forUpdate).toHaveBeenCalledWith("update", { skipLocked: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "running",
      attempt: 2,
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date("2026-07-16T00:01:00.000Z"),
      startedAt: now,
    }));
  });

  it("失败任务在剩余尝试次数内进入 retry_wait", async () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const current = createJob({ status: "running", attempt: 1, maxAttempts: 3 });
    const failed = createJob({ status: "retry_wait", attempt: 1, maxAttempts: 3 });
    const forUpdate = vi.fn().mockResolvedValue([current]);
    const selectLimit = vi.fn(() => ({ for: forUpdate }));
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const updateReturning = vi.fn().mockResolvedValue([failed]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const tx = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhere })) })),
      update: vi.fn(() => ({ set: updateSet })),
    };
    const db = {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await expect(failJob(db as any, 1, "worker-1", new Error("network"), {
      retryDelayMs: 30_000,
      now,
    })).resolves.toBe(failed);

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "retry_wait",
      availableAt: new Date("2026-07-16T00:00:30.000Z"),
      lastError: "network",
      completedAt: null,
    }));
  });

  it("回收过期租约并区分可重试与已耗尽任务", async () => {
    const retryReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
    const deadReturning = vi.fn().mockResolvedValue([{ id: 2 }, { id: 3 }]);
    const firstSet = vi.fn(() => ({
      where: vi.fn(() => ({ returning: retryReturning })),
    }));
    const secondSet = vi.fn(() => ({
      where: vi.fn(() => ({ returning: deadReturning })),
    }));
    const update = vi.fn()
      .mockReturnValueOnce({ set: firstSet })
      .mockReturnValueOnce({ set: secondSet });

    await expect(recoverExpiredJobs({ update } as any)).resolves.toBe(3);
    expect(firstSet).toHaveBeenCalledWith(expect.objectContaining({ status: "retry_wait" }));
    expect(secondSet).toHaveBeenCalledWith(expect.objectContaining({ status: "dead" }));
  });

  it("仅由当前租约持有者续租", async () => {
    const renewed = createJob({ status: "running", leaseOwner: "worker-1" });
    const returning = vi.fn().mockResolvedValue([renewed]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) };
    const now = new Date("2026-07-16T00:00:00.000Z");

    await expect(renewJobLease(db as any, 1, "worker-1", 60_000, now)).resolves.toBe(renewed);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      leaseExpiresAt: new Date("2026-07-16T00:01:00.000Z"),
      updatedAt: now,
    }));
  });
});

function createJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-16T00:00:00.000Z");
  return {
    id: 1,
    userId: 7,
    type: "radar.discover.github",
    idempotencyKey: "radar:2026-07-16",
    payload: { period: "7d" },
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
  };
}
