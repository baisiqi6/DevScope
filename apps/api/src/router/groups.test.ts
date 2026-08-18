import { describe, expect, it, vi } from "vitest";
import { repositoryGroups, users } from "@devscope/db";
import {
  groupMembersRouter,
  groupsRouter,
  normalizeRepositoryGroupCount,
} from "./groups";

describe("repository group count contract", () => {
  it.each([
    [0, 0],
    [16, 16],
    ["0", 0],
    ["16", 16],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])("将 PostgreSQL count %p 规范化为安全 number", (value, expected) => {
    expect(normalizeRepositoryGroupCount(value)).toBe(expected);
  });

  it.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    " ",
    "+1",
    "-1",
    "01",
    "1e3",
    "1.0",
    "9007199254740992",
    null,
    undefined,
    true,
    {},
  ])("拒绝非法 repository group count %p", (value) => {
    expect(() => normalizeRepositoryGroupCount(value))
      .toThrow("Repository group count must be a non-negative safe integer");
  });

  it("groups.getAll 将 PostgreSQL string count 转为 number", async () => {
    const caller = groupsRouter.createCaller({
      db: createGroupsDb([{ id: 10, name: "AI", repoCount: "2" }]),
    } as never);

    await expect(caller.getAll()).resolves.toEqual([
      { id: 10, name: "AI", repoCount: 2 },
    ]);
  });
});

describe("groupMembers tenant boundary", () => {
  it("拒绝修改不属于当前用户的分组", async () => {
    const deleteMember = vi.fn();
    const db = createDb(false, deleteMember);
    const caller = groupMembersRouter.createCaller({ db } as never);

    await expect(caller.remove({ groupId: 99, repoId: 1 }))
      .rejects.toThrow("分组不存在或无权访问");
    expect(deleteMember).not.toHaveBeenCalled();
  });

  it("验证分组归属后才执行成员修改", async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteMember = vi.fn(() => ({ where: deleteWhere }));
    const db = createDb(true, deleteMember);
    const caller = groupMembersRouter.createCaller({ db } as never);

    await expect(caller.remove({ groupId: 10, repoId: 1 }))
      .resolves.toEqual({ success: true });
    expect(deleteMember).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
  });
});

function createDb(groupOwned: boolean, deleteMember: ReturnType<typeof vi.fn>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === users) {
          return { limit: vi.fn().mockResolvedValue([{ id: 7 }]) };
        }
        if (table === repositoryGroups) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue(groupOwned ? [{ id: 10 }] : []),
            })),
          };
        }
        throw new Error("unexpected table");
      }),
    })),
    delete: deleteMember,
  };
}

function createGroupsDb(rows: Array<Record<string, unknown>>) {
  let selectCall = 0;
  return {
    select: vi.fn(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return {
          from: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ id: 7 }]),
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                orderBy: vi.fn().mockResolvedValue(rows),
              })),
            })),
          })),
        })),
      };
    }),
  };
}
