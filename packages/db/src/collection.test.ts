import { describe, expect, it, vi } from "vitest";
import { insertReleases } from "./collection";

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
