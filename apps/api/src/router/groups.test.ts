import { describe, expect, it, vi } from "vitest";
import { repositoryGroups, users } from "@devscope/db";
import { groupMembersRouter } from "./groups";

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
