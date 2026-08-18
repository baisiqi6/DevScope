import { describe, expect, it, vi } from "vitest";
import {
  getLatestGitHubTrendingSnapshot,
  saveGitHubTrendingSnapshot,
} from "./github-trending";

const input = {
  period: "daily" as const,
  language: "all",
  snapshotDate: "2026-08-17",
  sourceUrl: "https://github.com/trending?since=daily",
  fetchedAt: new Date("2026-08-17T12:00:00.000Z"),
  entries: [{
    rank: 1,
    fullName: "openai/codex",
    url: "https://github.com/openai/codex",
    description: "Agent",
    language: "TypeScript",
    stars: 10,
    forks: 2,
    starsInPeriod: 5,
  }],
};

describe("GitHub Trending persistence", () => {
  it("在进入事务前拒绝空榜、重复仓库和不连续排名", async () => {
    const db = { transaction: vi.fn() } as any;
    await expect(saveGitHubTrendingSnapshot(db, { ...input, entries: [] }))
      .rejects.toThrow("不能保存空的");
    await expect(saveGitHubTrendingSnapshot(db, {
      ...input,
      entries: [{ ...input.entries[0], rank: 2 }],
    })).rejects.toThrow("排名必须从 1 连续递增");
    await expect(saveGitHubTrendingSnapshot(db, {
      ...input,
      entries: [input.entries[0], { ...input.entries[0], rank: 2 }],
    })).rejects.toThrow("包含重复仓库");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("在单个事务内替换同日快照条目", async () => {
    const snapshot = {
      id: 7,
      ...input,
      entryCount: 1,
      createdAt: input.fetchedAt,
      updatedAt: input.fetchedAt,
    };
    const returningSnapshot = vi.fn().mockResolvedValue([snapshot]);
    const onConflictDoUpdate = vi.fn(() => ({ returning: returningSnapshot }));
    const insertSnapshotValues = vi.fn(() => ({ onConflictDoUpdate }));
    const returningEntries = vi.fn().mockResolvedValue([{ id: 9, snapshotId: 7, ...input.entries[0] }]);
    const insertEntryValues = vi.fn(() => ({ returning: returningEntries }));
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const tx = {
      insert: vi.fn()
        .mockReturnValueOnce({ values: insertSnapshotValues })
        .mockReturnValueOnce({ values: insertEntryValues }),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) } as any;

    const result = await saveGitHubTrendingSnapshot(db, input);

    expect(result.snapshot.id).toBe(7);
    expect(result.entries).toHaveLength(1);
    expect(onConflictDoUpdate).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it("读取最新快照后按排名读取条目", async () => {
    const snapshot = { id: 7, period: "daily", language: "all" };
    const entries = [{ id: 9, snapshotId: 7, rank: 1, fullName: "openai/codex" }];
    const firstLimit = vi.fn().mockResolvedValue([snapshot]);
    const firstOrderBy = vi.fn(() => ({ limit: firstLimit }));
    const firstWhere = vi.fn(() => ({ orderBy: firstOrderBy }));
    const secondOrderBy = vi.fn().mockResolvedValue(entries);
    const secondWhere = vi.fn(() => ({ orderBy: secondOrderBy }));
    const db = {
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: firstWhere })) })
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: secondWhere })) }),
    } as any;

    await expect(getLatestGitHubTrendingSnapshot(db, "daily"))
      .resolves.toEqual({ snapshot, entries });
  });
});
