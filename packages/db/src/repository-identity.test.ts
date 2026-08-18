import { describe, expect, it, vi } from "vitest";
import { normalizeGitHubRepositoryId } from "@devscope/shared";
import {
  applyRepositoryIdentityBackfill,
  buildRepositoryIdentityBackfillPlan,
  RepositoryIdentityLeaseLostError,
} from "./repository-identity";

describe("GitHub repository 稳定身份", () => {
  it.each([
    [1, "1"],
    [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
    [1n, "1"],
    ["98765432101234567890", "98765432101234567890"],
  ])("将 %s 规范化为无损十进制字符串", (input, expected) => {
    expect(normalizeGitHubRepositoryId(input)).toBe(expected);
  });

  it.each([
    0,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
    0n,
    "0",
    "-1",
    "+1",
    "01",
    "1.0",
    "repo-1",
  ])("拒绝不安全或非正十进制 ID：%s", (input) => {
    expect(() => normalizeGitHubRepositoryId(input)).toThrow();
  });
});

describe("repository identity backfill plan", () => {
  it("在完整解析后生成 rename/update，并保留 unresolved", () => {
    const rows = [
      { id: 1, fullName: "old/repo", githubRepositoryId: null },
      { id: 2, fullName: "private/repo", githubRepositoryId: null },
    ];

    expect(buildRepositoryIdentityBackfillPlan(rows, [
      { repositoryId: 1, githubRepositoryId: "123", fullName: "new/repo" },
      { repositoryId: 2, unresolved: true },
    ])).toEqual({
      baseline: rows,
      updates: [{
        repositoryId: 1,
        previousFullName: "old/repo",
        fullName: "new/repo",
        githubRepositoryId: "123",
      }],
      unresolved: [{ repositoryId: 2, fullName: "private/repo" }],
      conflicts: [],
    });
  });

  it("两个正式行解析为同一 GitHub ID 时生成 conflict 且不生成 update", () => {
    const rows = [
      { id: 1, fullName: "old/repo", githubRepositoryId: null },
      { id: 2, fullName: "new/repo", githubRepositoryId: null },
    ];
    const plan = buildRepositoryIdentityBackfillPlan(rows, [
      { repositoryId: 1, githubRepositoryId: "123", fullName: "new/repo" },
      { repositoryId: 2, githubRepositoryId: "123", fullName: "new/repo" },
    ]);

    expect(plan.updates).toEqual([]);
    expect(plan.conflicts).toEqual([expect.objectContaining({
      code: "DUPLICATE_GITHUB_REPOSITORY_ID",
      githubRepositoryId: "123",
      repositoryIds: [1, 2],
    })]);
  });

  it("规范名称被其他身份占用时 fail closed", () => {
    const rows = [
      { id: 1, fullName: "old/repo", githubRepositoryId: null },
      { id: 2, fullName: "new/repo", githubRepositoryId: "456" },
    ];
    const plan = buildRepositoryIdentityBackfillPlan(rows, [
      { repositoryId: 1, githubRepositoryId: "123", fullName: "new/repo" },
      { repositoryId: 2, githubRepositoryId: "456", fullName: "new/repo" },
    ]);

    expect(plan.updates).toEqual([]);
    expect(plan.conflicts).toEqual([expect.objectContaining({
      code: "CANONICAL_NAME_OCCUPIED",
      fullName: "new/repo",
      repositoryIds: [1, 2],
    })]);
  });

  it("拒绝 GitHub 响应中的非法 fullName", () => {
    expect(() => buildRepositoryIdentityBackfillPlan(
      [{ id: 1, fullName: "old/repo", githubRepositoryId: null }],
      [{ repositoryId: 1, githubRepositoryId: "123", fullName: "invalid" }],
    )).toThrow(/fullName/);
  });
});

describe("repository identity backfill atomic apply", () => {
  it("apply 前失去租约时零写入", async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({ for: vi.fn().mockResolvedValue([]) })),
          })),
        })),
      })),
      update: vi.fn(),
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) };

    await expect(applyRepositoryIdentityBackfill(
      db as any,
      9,
      "worker-1",
      { baseline: [], updates: [], unresolved: [], conflicts: [] },
      new Date("2026-08-18T00:00:00Z"),
    )).rejects.toBeInstanceOf(RepositoryIdentityLeaseLostError);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("冲突计划只原子写 blocked result，不写 repositories", async () => {
    const runningJob = { id: 9, status: "running", leaseOwner: "worker-1" };
    const terminalJob = { ...runningJob, status: "succeeded" };
    const jobReturning = vi.fn().mockResolvedValue([terminalJob]);
    const update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: jobReturning })),
      })),
    }));
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({ for: vi.fn().mockResolvedValue([runningJob]) })),
          })),
        })),
      })),
      update,
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) };
    const conflict = {
      code: "DUPLICATE_GITHUB_REPOSITORY_ID" as const,
      repositoryIds: [1, 2],
      githubRepositoryId: "123",
    };

    await expect(applyRepositoryIdentityBackfill(
      db as any,
      9,
      "worker-1",
      { baseline: [], updates: [], unresolved: [], conflicts: [conflict] },
      new Date("2026-08-18T00:00:00Z"),
    )).resolves.toEqual({
      outcome: "blocked",
      updated: [],
      unresolved: [],
      conflicts: [conflict],
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
