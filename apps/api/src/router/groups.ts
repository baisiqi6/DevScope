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
  repositoryGroups,
  groupMembers,
  repositories,
  userWatchedRepositories,
  type Db,
  isRealGitHubRepository,
  createRepositoryGroup,
  getAggregateRepositoryGroupView,
  listRepositoryGroupTree,
  moveRepositoryGroup,
  normalizeRepositoryGroupCount,
  reorderRepositoryGroupSiblings,
} from "@devscope/db";
import { getOrCreateCurrentUserId } from "../current-user";
import {
  createGroupSchema,
  updateGroupSchema,
  addGroupMemberSchema,
  batchAddGroupMembersSchema,
  moveGroupMemberSchema,
  reorderGroupMembersSchema,
  reorderGroupsSchema,
  aggregateGroupMembersInputSchema,
  moveGroupSchema,
  reorderGroupSiblingsSchema,
} from "@devscope/shared";
import { eq, and, desc, inArray, or, ilike, sql } from "drizzle-orm";

export { normalizeRepositoryGroupCount } from "@devscope/db";

async function requireOwnedGroup(db: Db, userId: number, groupId: number): Promise<void> {
  const [group] = await db
    .select({ id: repositoryGroups.id })
    .from(repositoryGroups)
    .where(and(eq(repositoryGroups.id, groupId), eq(repositoryGroups.userId, userId)))
    .limit(1);

  if (!group) {
    throw new Error("分组不存在或无权访问");
  }
}

async function requireOwnedRepositories(
  db: Db,
  userId: number,
  repoIds: number[],
): Promise<void> {
  const uniqueRepoIds = [...new Set(repoIds)];
  const rows = await db
    .select({ repoId: userWatchedRepositories.repoId })
    .from(userWatchedRepositories)
    .where(and(
      eq(userWatchedRepositories.userId, userId),
      inArray(userWatchedRepositories.repoId, uniqueRepoIds),
      eq(userWatchedRepositories.isArchived, false),
    ));

  if (rows.length !== uniqueRepoIds.length) {
    throw new Error("部分仓库不存在或无权访问");
  }
}

// ============================================================================
// 分组路由
// ============================================================================

export const groupsRouter = router({
  /**
   * 获取所有分组
   */
  getAll: publicProcedure
    .query(async ({ ctx }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      const tree = await listRepositoryGroupTree(db, userId);
      const flat: Array<Omit<(typeof tree)[number], "children">> = [];
      const visit = (nodes: typeof tree) => {
        for (const node of nodes) {
          const { children, ...group } = node;
          flat.push(group);
          visit(children);
        }
      };
      visit(tree);
      return flat;
    }),

  /** 获取当前用户的完整分组树。 */
  getTree: publicProcedure.query(async ({ ctx }) => {
    const userId = await getOrCreateCurrentUserId(ctx.db);
    return listRepositoryGroupTree(ctx.db, userId);
  }),

  /** 获取当前分组及全部后代仓库的去重聚合视图。 */
  getAggregateWithMembers: publicProcedure
    .input(aggregateGroupMembersInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const view = await getAggregateRepositoryGroupView(ctx.db, userId, input.groupId);
      if (!view) throw new Error("分组不存在或无权访问");
      return view;
    }),

  /**
   * 获取分组及其成员
   */
  getWithMembers: publicProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

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
              .select({
                id: repositories.id,
                fullName: repositories.fullName,
                name: repositories.name,
                owner: repositories.owner,
                description: repositories.description,
                url: repositories.url,
                stars: repositories.stars,
                forks: repositories.forks,
                openIssues: repositories.openIssues,
                language: repositories.language,
                license: repositories.license,
                licenseStatus: repositories.licenseStatus,
                lastFetchedAt: repositories.lastFetchedAt,
                starredAt: userWatchedRepositories.starredAt,
                note: userWatchedRepositories.notes,
              })
              .from(repositories)
              .innerJoin(
                userWatchedRepositories,
                and(
                  eq(userWatchedRepositories.repoId, repositories.id),
                  eq(userWatchedRepositories.userId, userId),
                  eq(userWatchedRepositories.isArchived, false),
                ),
              )
              .where(inArray(repositories.id, repoIds))
          : [];

      const reposById = new Map(repos.map((repo) => [repo.id, repo]));

      // 组合数据
      const activeMembers = members.filter((member) => reposById.has(member.repoId));
      const membersWithRepos = activeMembers.map((member) => ({
        ...member,
        repository: reposById.has(member.repoId)
          ? (() => {
              const repo = reposById.get(member.repoId)!;
              return {
                ...repo,
                lastFetchedAt: repo.lastFetchedAt?.toISOString() ?? null,
                starredAt: repo.starredAt?.toISOString() ?? null,
              };
            })()
          : null,
      }));

      return {
        ...group,
        members: membersWithRepos,
        repoCount: new Set(activeMembers.map((member) => member.repoId)).size,
      };
    }),

  /**
   * 创建分组
   */
  create: publicProcedure
    .input(createGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

      const group = await createRepositoryGroup(db, { userId, ...input });

      return {
        ...group,
        repoCount: 0,
        directRepoCount: 0,
        aggregateRepoCount: 0,
      };
    }),

  /** 移动分组到另一个父级；null 表示移动到根级。 */
  move: publicProcedure
    .input(moveGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      return moveRepositoryGroup(ctx.db, userId, input.groupId, input.parentId);
    }),

  /**
   * 更新分组
   */
  update: publicProcedure
    .input(updateGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

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
    .input(z.object({ groupId: z.number().int().positive(), confirm: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

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

      const [child] = await db
        .select({ id: repositoryGroups.id })
        .from(repositoryGroups)
        .where(and(
          eq(repositoryGroups.parentId, input.groupId),
          eq(repositoryGroups.userId, userId),
        ))
        .limit(1);
      if (child) {
        throw new Error("分组包含子分组，不能删除");
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
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

      await reorderRepositoryGroupSiblings(db, userId, null, input.groupIds);
      return { success: true };
    }),

  /** 按完整兄弟集合重新排序。 */
  reorderSiblings: publicProcedure
    .input(reorderGroupSiblingsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      await reorderRepositoryGroupSiblings(
        ctx.db,
        userId,
        input.parentId,
        input.groupIds,
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
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireOwnedGroup(db, userId, input.groupId);
      await requireOwnedRepositories(db, userId, [input.repoId]);

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
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireOwnedGroup(db, userId, input.groupId);

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
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireOwnedGroup(db, userId, input.fromGroupId);
      await requireOwnedGroup(db, userId, input.toGroupId);
      await requireOwnedRepositories(db, userId, [input.repoId]);

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
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireOwnedGroup(db, userId, input.groupId);
      await requireOwnedRepositories(db, userId, input.repoIds);

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
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireOwnedGroup(db, userId, input.groupId);
      await requireOwnedRepositories(db, userId, input.repoIds);

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
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

      // 获取仓库所属的分组成员记录
      const members = await db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .innerJoin(
          userWatchedRepositories,
          and(
            eq(userWatchedRepositories.repoId, groupMembers.repoId),
            eq(userWatchedRepositories.userId, userId),
            eq(userWatchedRepositories.isArchived, false),
          ),
        )
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
  getUngroupedRepos: publicProcedure.query(async ({ ctx }) => {
    const db = ctx.db;
    const userId = await getOrCreateCurrentUserId(db);

    // 用户仓库关联是可见性边界；只排除当前用户已经分组的仓库。
    return db
      .select({
        id: repositories.id,
        fullName: repositories.fullName,
        name: repositories.name,
        owner: repositories.owner,
        description: repositories.description,
        url: repositories.url,
        stars: repositories.stars,
        forks: repositories.forks,
        openIssues: repositories.openIssues,
        language: repositories.language,
        license: repositories.license,
        licenseStatus: repositories.licenseStatus,
        lastFetchedAt: repositories.lastFetchedAt,
        starredAt: userWatchedRepositories.starredAt,
        note: userWatchedRepositories.notes,
      })
      .from(repositories)
      .innerJoin(
        userWatchedRepositories,
        and(
          eq(userWatchedRepositories.repoId, repositories.id),
          eq(userWatchedRepositories.userId, userId),
          eq(userWatchedRepositories.isArchived, false),
        ),
      )
      .where(and(
        isRealGitHubRepository,
        sql`NOT EXISTS (
          SELECT 1
          FROM group_members member
          INNER JOIN repository_groups owned_group ON owned_group.id = member.group_id
          WHERE member.repo_id = ${repositories.id}
            AND owned_group.user_id = ${userId}
        )`,
      ))
      .orderBy(desc(repositories.stars));
  }),

  /**
   * 搜索分组
   */
  searchGroups: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

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
