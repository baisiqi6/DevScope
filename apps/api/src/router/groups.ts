/**
 * @package @devscope/api/router/groups
 * @description 仓库分组相关路由
 *
 * 处理仓库的分组管理、分组成员管理等功能。
 *
 * @module groups-router
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import {
  createDb,
  repositoryGroups,
  groupMembers,
  repositories,
  users,
} from "@devscope/db";
import {
  createGroupSchema,
  updateGroupSchema,
  addGroupMemberSchema,
  batchAddGroupMembersSchema,
  moveGroupMemberSchema,
  reorderGroupMembersSchema,
  reorderGroupsSchema,
  repositoryGroupSchema,
  repositorySchema,
} from "@devscope/shared";
import { eq, and, desc, count, inArray, or, ilike, sql } from "drizzle-orm";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取默认用户 ID
 * TODO: 从会话中获取实际用户 ID
 */
async function getDefaultUserId(): Promise<number> {
  const db = createDb();
  const [user] = await db.select().from(users).limit(1);
  return user?.id ?? 1;
}

// ============================================================================
// 分组路由
// ============================================================================

export const groupsRouter = router({
  /**
   * 获取所有分组
   */
  getAll: publicProcedure
    .query(async () => {
      const db = createDb();
      const userId = await getDefaultUserId();

      const groups = await db
        .select({
          id: repositoryGroups.id,
          userId: repositoryGroups.userId,
          name: repositoryGroups.name,
          color: repositoryGroups.color,
          icon: repositoryGroups.icon,
          description: repositoryGroups.description,
          orderIndex: repositoryGroups.orderIndex,
          createdAt: repositoryGroups.createdAt,
          updatedAt: repositoryGroups.updatedAt,
        })
        .from(repositoryGroups)
        .where(eq(repositoryGroups.userId, userId))
        .orderBy(repositoryGroups.orderIndex);

      // 为每个分组计算仓库数量
      const groupsWithCount = await Promise.all(
        groups.map(async (group) => {
          const [result] = await db
            .select({ count: count() })
            .from(groupMembers)
            .where(eq(groupMembers.groupId, group.id));

          return {
            ...group,
            repoCount: result?.count ?? 0,
          };
        })
      );

      return groupsWithCount;
    }),

  /**
   * 获取分组及其成员
   */
  getWithMembers: publicProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      const db = createDb();
      const userId = await getDefaultUserId();

      // 获取分组信息
      const [group] = await db
        .select()
        .from(repositoryGroups)
        .where(
          and(
            eq(repositoryGroups.id, input.groupId),
            eq(repositoryGroups.userId, userId)
          )
        );

      if (!group) {
        throw new Error("分组不存在");
      }

      // 获取分组成员
      const members = await db
        .select({
          id: groupMembers.id,
          groupId: groupMembers.groupId,
          repoId: groupMembers.repoId,
          orderIndex: groupMembers.orderIndex,
          createdAt: groupMembers.createdAt,
        })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, input.groupId))
        .orderBy(groupMembers.orderIndex);

      // 获取仓库信息
      const repoIds = members.map((m) => m.repoId);
      const repos =
        repoIds.length > 0
          ? await db
              .select()
              .from(repositories)
              .where(inArray(repositories.id, repoIds))
          : [];

      // 组合数据
      const membersWithRepos = members.map((member) => ({
        ...member,
        repository: repos.find((r) => r.id === member.repoId),
      }));

      return {
        ...group,
        members: membersWithRepos,
        repoCount: members.length,
      };
    }),

  /**
   * 创建分组
   */
  create: publicProcedure
    .input(createGroupSchema)
    .mutation(async ({ input }) => {
      const db = createDb();
      const userId = await getDefaultUserId();

      // 获取当前最大 orderIndex
      const [maxOrder] = await db
        .select({ max: sql<number>`MAX(${repositoryGroups.orderIndex})` })
        .from(repositoryGroups)
        .where(eq(repositoryGroups.userId, userId));

      const nextOrder = (maxOrder?.max ?? -1) + 1;

      const [group] = await db
        .insert(repositoryGroups)
        .values({
          userId,
          name: input.name,
          color: input.color || "blue",
          icon: input.icon || "folder",
          description: input.description,
          orderIndex: nextOrder,
        })
        .returning();

      return {
        ...group,
        repoCount: 0,
      };
    }),

  /**
   * 更新分组
   */
  update: publicProcedure
    .input(updateGroupSchema)
    .mutation(async ({ input }) => {
      const db = createDb();
      const userId = await getDefaultUserId();

      // 验证分组属于当前用户
      const [existing] = await db
        .select()
        .from(repositoryGroups)
        .where(
          and(
            eq(repositoryGroups.id, input.groupId),
            eq(repositoryGroups.userId, userId)
          )
        );

      if (!existing) {
        throw new Error("分组不存在");
      }

      // 构建更新数据
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;
      if (input.icon !== undefined) updateData.icon = input.icon;
      if (input.description !== undefined) updateData.description = input.description;

      const [group] = await db
        .update(repositoryGroups)
        .set(updateData)
        .where(eq(repositoryGroups.id, input.groupId))
        .returning();

      return group;
    }),

  /**
   * 删除分组（级联删除成员）
   */
  delete: publicProcedure
    .input(z.object({ groupId: z.number() }))
    .mutation(async ({ input }) => {
      const db = createDb();
      const userId = await getDefaultUserId();

      // 验证分组属于当前用户
      const [existing] = await db
        .select()
        .from(repositoryGroups)
        .where(
          and(
            eq(repositoryGroups.id, input.groupId),
            eq(repositoryGroups.userId, userId)
          )
        );

      if (!existing) {
        throw new Error("分组不存在");
      }

      await db
        .delete(repositoryGroups)
        .where(eq(repositoryGroups.id, input.groupId));

      return { success: true };
    }),

  /**
   * 重新排序分组
   */
  reorder: publicProcedure
    .input(reorderGroupsSchema)
    .mutation(async ({ input }) => {
      const db = createDb();
      const userId = await getDefaultUserId();

      // 验证所有分组都属于当前用户
      const existing = await db
        .select()
        .from(repositoryGroups)
        .where(
          and(
            inArray(repositoryGroups.id, input.groupIds),
            eq(repositoryGroups.userId, userId)
          )
        );

      if (existing.length !== input.groupIds.length) {
        throw new Error("部分分组不存在或无权访问");
      }

      // 批量更新顺序
      await Promise.all(
        input.groupIds.map((id, index) =>
          db
            .update(repositoryGroups)
            .set({ orderIndex: index })
            .where(eq(repositoryGroups.id, id))
        )
      );

      return { success: true };
    }),
});

export const groupMembersRouter = router({
  /**
   * 添加仓库到分组
   */
  add: publicProcedure
    .input(addGroupMemberSchema)
    .mutation(async ({ input }) => {
      const db = createDb();

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, input.groupId),
            eq(groupMembers.repoId, input.repoId)
          )
        );

      if (existing) {
        throw new Error("仓库已在该分组中");
      }

      // 获取最大 orderIndex
      const [maxOrder] = await db
        .select({ max: sql<number>`MAX(${groupMembers.orderIndex})` })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, input.groupId));

      const [member] = await db
        .insert(groupMembers)
        .values({
          groupId: input.groupId,
          repoId: input.repoId,
          orderIndex: (maxOrder?.max ?? -1) + 1,
        })
        .returning();

      return member;
    }),

  /**
   * 从分组中移除仓库
   */
  remove: publicProcedure
    .input(
      z.object({
        groupId: z.number(),
        repoId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = createDb();

      await db
        .delete(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, input.groupId),
            eq(groupMembers.repoId, input.repoId)
          )
        );

      return { success: true };
    }),

  /**
   * 移动仓库到另一个分组
   */
  move: publicProcedure
    .input(moveGroupMemberSchema)
    .mutation(async ({ input }) => {
      const db = createDb();

      // 获取原成员记录
      const [member] = await db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, input.fromGroupId),
            eq(groupMembers.repoId, input.repoId)
          )
        );

      if (!member) {
        throw new Error("仓库不在原分组中");
      }

      // 删除原记录
      await db.delete(groupMembers).where(eq(groupMembers.id, member.id));

      // 获取目标分组的最大 orderIndex
      const [maxOrder] = await db
        .select({ max: sql<number>`MAX(${groupMembers.orderIndex})` })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, input.toGroupId));

      // 在新分组中创建记录
      const [newMember] = await db
        .insert(groupMembers)
        .values({
          groupId: input.toGroupId,
          repoId: input.repoId,
          orderIndex: (maxOrder?.max ?? -1) + 1,
        })
        .returning();

      return newMember;
    }),

  /**
   * 设置分组内仓库顺序
   */
  reorder: publicProcedure
    .input(reorderGroupMembersSchema)
    .mutation(async ({ input }) => {
      const db = createDb();

      await Promise.all(
        input.repoIds.map((repoId, index) =>
          db
            .update(groupMembers)
            .set({ orderIndex: index })
            .where(
              and(
                eq(groupMembers.groupId, input.groupId),
                eq(groupMembers.repoId, repoId)
              )
            )
        )
      );

      return { success: true };
    }),

  /**
   * 批量添加仓库到分组
   */
  batchAdd: publicProcedure
    .input(batchAddGroupMembersSchema)
    .mutation(async ({ input }) => {
      const db = createDb();

      // 获取最大 orderIndex
      const [maxOrder] = await db
        .select({ max: sql<number>`MAX(${groupMembers.orderIndex})` })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, input.groupId));

      let orderIndex = (maxOrder?.max ?? -1) + 1;

      // 批量插入（忽略已存在的）
      for (const repoId of input.repoIds) {
        await db
          .insert(groupMembers)
          .values({
            groupId: input.groupId,
            repoId,
            orderIndex: orderIndex++,
          })
          .onConflictDoNothing();
      }

      return { success: true };
    }),
});

/**
 * 查询路由
 */
export const groupsQueryRouter = router({
  /**
   * 获取仓库所属的所有分组
   */
  getRepoGroups: publicProcedure
    .input(z.object({ repoId: z.number() }))
    .query(async ({ input }) => {
      const db = createDb();
      const userId = await getDefaultUserId();

      // 获取仓库所属的分组成员记录
      const members = await db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(eq(groupMembers.repoId, input.repoId));

      if (members.length === 0) {
        return [];
      }

      // 获取分组信息
      const groupIds = members.map((m) => m.groupId);
      const groups = await db
        .select()
        .from(repositoryGroups)
        .where(
          and(
            inArray(repositoryGroups.id, groupIds),
            eq(repositoryGroups.userId, userId)
          )
        )
        .orderBy(repositoryGroups.orderIndex);

      return groups;
    }),

  /**
   * 获取未分组的仓库
   */
  getUngroupedRepos: publicProcedure.query(async () => {
    const db = createDb();

    // 获取所有已分组的 repoId
    const grouped = await db
      .select({ repoId: groupMembers.repoId })
      .from(groupMembers);

    const groupedRepoIds = new Set(grouped.map((g) => g.repoId));

    // 获取所有仓库，过滤出未分组的
    const allRepos = await db
      .select()
      .from(repositories)
      .orderBy(desc(repositories.stars));

    return allRepos.filter((repo) => !groupedRepoIds.has(repo.id));
  }),

  /**
   * 搜索分组
   */
  searchGroups: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = createDb();
      const userId = await getDefaultUserId();

      return db
        .select()
        .from(repositoryGroups)
        .where(
          and(
            eq(repositoryGroups.userId, userId),
            or(
              ilike(repositoryGroups.name, `%${input.query}%`),
              ilike(repositoryGroups.description, `%${input.query}%`)
            )
          )
        )
        .orderBy(repositoryGroups.orderIndex);
    }),
});
