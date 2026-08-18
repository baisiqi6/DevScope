import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@devscope/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devscope/db")>();
  return {
    ...actual,
    createDb: vi.fn(),
    createPipeline: vi.fn(),
  };
});

import { createDb, createPipeline } from "@devscope/db";
import { processPendingEmbeddings, refreshStaleRepositories } from "./scheduler";

function selectResult(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      })),
    })),
  };
}

describe("scheduler collection outcome guards", () => {
  const database = {
    select: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDb).mockReturnValue(database as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("刷新采集 failed 时不执行仓库状态副作用", async () => {
    database.select.mockReturnValueOnce(selectResult([{ id: 1, fullName: "owner/repo" }]) as never);
    const runQuick = vi.fn().mockResolvedValue({ status: "failed", error: "commit failed" });
    vi.mocked(createPipeline).mockReturnValueOnce({ runQuick } as never);
    vi.useFakeTimers();

    const operation = refreshStaleRepositories();
    await vi.advanceTimersByTimeAsync(2_000);
    await operation;

    expect(runQuick).toHaveBeenCalledWith({ repo: "owner/repo" });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("embedding 只有 applied 才算成功，stale 后不执行额外写入", async () => {
    const version = new Date("2026-08-18T00:00:00.123Z");
    database.select.mockReturnValueOnce(selectResult([{
      id: 1,
      fullName: "owner/repo",
      updatedAt: version,
    }]) as never);
    const runEmbeddingsInBackground = vi.fn().mockResolvedValue({ status: "stale" });
    vi.mocked(createPipeline).mockReturnValueOnce({ runEmbeddingsInBackground } as never);
    vi.useFakeTimers();

    const operation = processPendingEmbeddings();
    await vi.advanceTimersByTimeAsync(1_000);
    await operation;

    expect(runEmbeddingsInBackground).toHaveBeenCalledWith(1, version);
    expect(database.update).not.toHaveBeenCalled();
  });
});
