/**
 * @package @devscope/api/router/graph
 * @description 异步图谱重建状态机测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@devscope/db", () => ({
  getRepoGraphData: vi.fn(),
  rebuildRepoGraph: vi.fn(),
}));

import { rebuildRepoGraph } from "@devscope/db";

const mockRebuild = vi.mocked(rebuildRepoGraph);

async function freshCaller() {
  // 重建状态是模块级单例，每个用例需要全新模块实例
  vi.resetModules();
  const mod = await import("./graph");
  return mod.graphRouter.createCaller({ db: {} } as never);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("graph router 异步重建状态机", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("start 立即返回 running，并发 start 返回 alreadyRunning", async () => {
    const d = deferred<never>();
    mockRebuild.mockReturnValue(d.promise);
    const caller = await freshCaller();

    const first = await caller.startRebuildGraph();
    expect(first.status).toBe("running");
    expect(first.alreadyRunning).toBe(false);
    expect(first.startedAt).toBeTruthy();

    const second = await caller.startRebuildGraph();
    expect(second.status).toBe("running");
    expect(second.alreadyRunning).toBe(true);

    const status = await caller.getRebuildGraphStatus();
    expect(status.status).toBe("running");
    expect(status.result).toBeNull();
  });

  it("重建完成后状态为 completed 并携带统计", async () => {
    const d = deferred<{
      similarityEdges: number;
      dependencyEdges: number;
      pooledRepos: number;
      sbomBackfilled: number;
    }>();
    mockRebuild.mockReturnValue(d.promise);
    const caller = await freshCaller();

    await caller.startRebuildGraph();
    d.resolve({ similarityEdges: 3, dependencyEdges: 128, pooledRepos: 4, sbomBackfilled: 2 });
    await flushMicrotasks();

    const status = await caller.getRebuildGraphStatus();
    expect(status.status).toBe("completed");
    expect(status.finishedAt).toBeTruthy();
    expect(status.result).toEqual({
      similarityEdges: 3,
      dependencyEdges: 128,
      pooledRepos: 4,
      sbomBackfilled: 2,
    });
    expect(status.error).toBeNull();
  });

  it("重建失败后状态为 failed 并记录错误，可重新启动", async () => {
    const d = deferred<never>();
    mockRebuild.mockReturnValueOnce(d.promise);
    const caller = await freshCaller();

    await caller.startRebuildGraph();
    d.reject(new Error("deps.dev unavailable"));
    await flushMicrotasks();

    const failed = await caller.getRebuildGraphStatus();
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("deps.dev unavailable");

    // 失败后可再次启动
    const d2 = deferred<never>();
    mockRebuild.mockReturnValue(d2.promise);
    const restarted = await caller.startRebuildGraph();
    expect(restarted.status).toBe("running");
    expect(restarted.alreadyRunning).toBe(false);
  });
});
