import { describe, expect, it, vi } from "vitest";
import {
  insertReleases,
  RepositoryIdentityBackfillRequiredError,
  RepositoryIdentityConflictError,
  upsertRepository,
} from "./collection";

function release(id: number | string) {
  return {
    id,
    tagName: "v1.0.0",
    name: "v1.0.0",
    body: null,
    author: "maintainer",
    createdAt: new Date("2026-08-17T00:00:00Z"),
    publishedAt: new Date("2026-08-17T00:00:00Z"),
    url: "https://api.github.com/repos/owner/repo/releases/2147483648",
    htmlUrl: "https://github.com/owner/repo/releases/tag/v1.0.0",
    zipUrl: null,
    tarUrl: null,
    assets: [],
    isPrerelease: false,
  };
}

function insertDb() {
  const returning = vi.fn().mockResolvedValue([]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));

  return { db: { insert }, values };
}

describe("insertReleases", () => {
  it("将超过 int4 上限的十进制 GitHub ID 无损写成 bigint", async () => {
    const { db, values } = insertDb();

    await insertReleases(db as never, 7, [release("2147483648")]);

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ id: 2147483648n, repoId: 7 }),
    ]);
  });

  it("拒绝已经超出 JavaScript 安全整数范围的 number", async () => {
    const { db } = insertDb();

    await expect(
      insertReleases(db as never, 7, [release(Number.MAX_SAFE_INTEGER + 1)]),
    ).rejects.toThrow(/safe integer/i);
  });

  it("拒绝非十进制字符串而不是截断或哈希", async () => {
    const { db } = insertDb();

    await expect(
      insertReleases(db as never, 7, [release("release-v1")]),
    ).rejects.toThrow(/decimal/i);
  });

  it("接受 PostgreSQL bigint 最大值", async () => {
    const { db, values } = insertDb();

    await insertReleases(db as never, 7, [release("9223372036854775807")]);

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ id: 9223372036854775807n, repoId: 7 }),
    ]);
  });

  it("拒绝超过 PostgreSQL bigint 范围的 ID", async () => {
    const { db } = insertDb();

    await expect(
      insertReleases(db as never, 7, [release("9223372036854775808")]),
    ).rejects.toThrow(/PostgreSQL bigint range/i);
  });
});

describe("upsertRepository stable identity", () => {
  const repositoryData = {
    githubRepositoryId: "123",
    fullName: "new-owner/repo",
    name: "repo",
    owner: "new-owner",
    description: null,
    url: "https://github.com/new-owner/repo",
    stars: 1,
    forks: 0,
    openIssues: 0,
    language: "TypeScript",
    license: "MIT",
    readme: null,
    readmeUrl: null,
    lastFetchedAt: new Date("2026-08-18T00:00:00Z"),
    isReference: false,
  };

  it("同一 GitHub ID 改名时更新原实体和关注冗余名称", async () => {
    const existing = {
      ...repositoryData,
      id: 7,
      fullName: "old-owner/repo",
      owner: "old-owner",
    };
    const updated = { ...existing, ...repositoryData };
    const repositoryReturning = vi.fn().mockResolvedValue([updated]);
    const watcherWhere = vi.fn().mockResolvedValue([]);
    const update = vi.fn()
      .mockReturnValueOnce({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: repositoryReturning })),
        })),
      })
      .mockReturnValueOnce({ set: vi.fn(() => ({ where: watcherWhere })) });
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ for: vi.fn().mockResolvedValue([existing]) })),
        })),
      })),
      update,
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) };

    await expect(upsertRepository(db as any, repositoryData)).resolves.toEqual(updated);
    expect(update).toHaveBeenCalledTimes(2);
    expect(watcherWhere).toHaveBeenCalled();
  });

  it("ID 与 fullName 命中不同正式行时 fail closed", async () => {
    const byId = { ...repositoryData, id: 7, fullName: "old-owner/repo" };
    const byName = { ...repositoryData, id: 8, githubRepositoryId: "456" };
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ for: vi.fn().mockResolvedValue([byId, byName]) })),
        })),
      })),
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) };

    await expect(upsertRepository(db as any, repositoryData))
      .rejects.toBeInstanceOf(RepositoryIdentityConflictError);
  });

  it("compatibility 阶段拒绝创建全新 stable-ID 行", async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ for: vi.fn().mockResolvedValue([]) })),
        })),
      })),
    };
    const db = { transaction: vi.fn((callback) => callback(tx)) };

    await expect(upsertRepository(db as any, repositoryData))
      .rejects.toBeInstanceOf(RepositoryIdentityBackfillRequiredError);
  });
});
