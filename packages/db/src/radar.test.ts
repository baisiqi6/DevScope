import { describe, expect, it, vi } from "vitest";
import {
  getRadarInterestProfile,
  listRadarCandidates,
  upsertRadarCandidate,
} from "./radar";

describe("技术雷达候选池", () => {
  it("标准化仓库全名并按用户与仓库执行 upsert", async () => {
    const observedAt = new Date("2026-07-16T01:00:00.000Z");
    const candidate = { id: 1, fullName: "owner/repo" };
    const returning = vi.fn().mockResolvedValue([candidate]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const db = { insert: vi.fn(() => ({ values })) };

    await expect(upsertRadarCandidate(db as any, {
      userId: 7,
      fullName: " Owner/Repo ",
      owner: "Owner",
      name: "Repo",
      stars: 100,
      source: "github_search",
      evidence: { period: "7d" },
      observedAt,
    })).resolves.toBe(candidate);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      fullName: "owner/repo",
      owner: "Owner",
      name: "Repo",
      url: "https://github.com/owner/repo",
      source: "github_search",
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.not.objectContaining({ status: expect.anything() }),
    }));
  });

  it("拒绝无效的 GitHub 仓库全名", async () => {
    await expect(upsertRadarCandidate({} as any, {
      userId: 7,
      fullName: "invalid",
      owner: "invalid",
      name: "invalid",
      source: "github_search",
      evidence: {},
    })).rejects.toThrow("无效 GitHub 仓库全名");
  });

  it("无 ID 的同名信号不会清空既有稳定 ID、状态或 firstSeenAt", async () => {
    const observedAt = new Date("2026-08-18T02:00:00Z");
    const candidate = {
      id: 1,
      githubRepoId: "123",
      fullName: "owner/repo",
      status: "watching",
      firstSeenAt: new Date("2026-08-01T00:00:00Z"),
    };
    const returning = vi.fn().mockResolvedValue([candidate]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const db = { insert: vi.fn(() => ({ values })) };

    await expect(upsertRadarCandidate(db as any, {
      userId: 7,
      fullName: "owner/repo",
      owner: "owner",
      name: "repo",
      source: "fallback_source",
      evidence: {},
      observedAt,
    })).resolves.toBe(candidate);

    const conflictSet = onConflictDoUpdate.mock.calls[0][0].set;
    expect(conflictSet).not.toHaveProperty("githubRepoId");
    expect(conflictSet).not.toHaveProperty("status");
    expect(conflictSet).not.toHaveProperty("firstSeenAt");
  });

  it("同一 GitHub ID 改名时更新原候选且不覆盖状态和首次发现时间", async () => {
    const observedAt = new Date("2026-08-18T01:00:00Z");
    const existing = {
      id: 3,
      userId: 7,
      githubRepoId: "123",
      fullName: "old-owner/repo",
      status: "watching",
      firstSeenAt: new Date("2026-08-01T00:00:00Z"),
    };
    const updated = { ...existing, fullName: "new-owner/repo", lastSeenAt: observedAt };
    const set = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([updated]),
      })),
    }));
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ for: vi.fn().mockResolvedValue([existing]) })),
        })),
      })),
      update: vi.fn(() => ({ set })),
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) };

    await expect(upsertRadarCandidate(db as any, {
      userId: 7,
      githubRepoId: "123",
      fullName: "new-owner/repo",
      owner: "new-owner",
      name: "repo",
      source: "github_search",
      evidence: { renamed: true },
      observedAt,
    })).resolves.toEqual(updated);

    expect(set).toHaveBeenCalledWith(expect.not.objectContaining({
      status: expect.anything(),
      firstSeenAt: expect.anything(),
    }));
  });

  it("按用户读取未 dismiss 的可解释候选", async () => {
    const candidates = [{ id: 1, deterministicScore: 80 }];
    const limit = vi.fn().mockResolvedValue(candidates);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where })),
      })),
    };

    await expect(listRadarCandidates(db as any, 7, 20)).resolves.toBe(candidates);
    expect(where).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(20);
  });

  it("从已关注仓库汇总语言兴趣画像", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { language: "TypeScript", count: 3 },
      { language: "Rust", count: 1 },
      { language: null, count: 1 },
    ]);
    const where = vi.fn(() => ({ groupBy }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const db = { select: vi.fn(() => ({ from })) };

    await expect(getRadarInterestProfile(db as any, 7)).resolves.toEqual({
      totalRepositories: 5,
      languages: { typescript: 3, rust: 1 },
    });
    expect(where).toHaveBeenCalled();
  });
});
