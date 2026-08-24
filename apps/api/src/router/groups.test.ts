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
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    const updatedAt = new Date("2026-07-02T00:00:00.000Z");
    const caller = groupsRouter.createCaller({
      db: createGroupsDb([{
        id: 10,
        userId: 7,
        parentId: null,
        name: "AI",
        color: "blue",
        icon: "folder",
        description: null,
        orderIndex: 0,
        createdAt,
        updatedAt,
        directRepoCount: "2",
      }], [{ groupId: 10, aggregateRepoCount: "3" }]),
    } as never);

    await expect(caller.getAll()).resolves.toEqual([
      {
        id: 10,
        userId: 7,
        parentId: null,
        name: "AI",
        color: "blue",
        icon: "folder",
        description: null,
        orderIndex: 0,
        createdAt,
        updatedAt,
        repoCount: 2,
        directRepoCount: 2,
        aggregateRepoCount: 3,
      },
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

describe("group hierarchy mutation guards", () => {
  it("父分组存在子组时仍允许更新自身元数据", async () => {
    const updated = { id: 10, name: "新名称" };
    const updateReturning = vi.fn().mockResolvedValue([updated]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const db = createGroupMutationDb({ update: vi.fn(() => ({ set: updateSet })) });
    const caller = groupsRouter.createCaller({ db } as never);

    await expect(caller.update({ groupId: 10, name: "新名称" })).resolves.toEqual(updated);
    expect(updateSet).toHaveBeenCalled();
  });

  it("删除含子组的分组时在执行 delete 前返回稳定错误", async () => {
    const deleteGroup = vi.fn();
    const db = createGroupMutationDb({
      childRows: [{ id: 11 }],
      delete: deleteGroup,
    });
    const caller = groupsRouter.createCaller({ db } as never);

    await expect(caller.delete({ groupId: 10 }))
      .rejects.toThrow("分组包含子分组，不能删除");
    expect(deleteGroup).not.toHaveBeenCalled();
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

function createGroupsDb(
  rows: Array<Record<string, unknown>>,
  aggregateRows: Array<Record<string, unknown>>,
) {
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
    execute: vi.fn().mockResolvedValue({ rows: aggregateRows }),
  };
}

function createGroupMutationDb(options: {
  childRows?: Array<{ id: number }>;
  update?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
}) {
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
      if (selectCall === 2) {
        return {
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ id: 10 }]),
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(options.childRows ?? []),
          })),
        })),
      };
    }),
    update: options.update,
    delete: options.delete,
  };
}
