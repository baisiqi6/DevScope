import { describe, expect, it, vi } from "vitest";
import { upsertRadarCandidate } from "./radar";

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
      source: "ossinsight",
      evidence: { period: "7d" },
      observedAt,
    })).resolves.toBe(candidate);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      fullName: "owner/repo",
      owner: "Owner",
      name: "Repo",
      url: "https://github.com/owner/repo",
      source: "ossinsight",
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
      source: "ossinsight",
      evidence: {},
    })).rejects.toThrow("无效 GitHub 仓库全名");
  });
});
