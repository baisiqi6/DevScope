import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './index';
import {
  groupMembers,
  repositories,
  repositoryGroups,
  userWatchedRepositories,
  type Repository,
  type RepositoryGroup,
} from './schema';

const GROUP_HIERARCHY_LOCK_NAMESPACE = 'devscope.repository_group_hierarchy';

export function normalizeRepositoryGroupCount(value: unknown): number {
  const count = typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('Repository group count must be a non-negative safe integer');
  }
  return count;
}

export interface RepositoryGroupTreeNode extends RepositoryGroup {
  repoCount: number;
  directRepoCount: number;
  aggregateRepoCount: number;
  children: RepositoryGroupTreeNode[];
}

export interface RepositoryGroupMembershipSource {
  membershipId: number;
  groupId: number;
  groupName: string;
  depth: number;
  orderIndex: number;
  isDirect: boolean;
}

export interface AggregateRepositoryGroupMember {
  repoId: number;
  repository: Repository;
  memberships: RepositoryGroupMembershipSource[];
}

export interface AggregateRepositoryGroupView {
  group: Omit<RepositoryGroupTreeNode, 'children'>;
  members: AggregateRepositoryGroupMember[];
}

interface DescendantRow {
  id: number;
  parentId: number | null;
  name: string;
  depth: number;
  groupOrderIndex: number;
}

async function listDescendants(
  executor: Pick<Db, 'execute'>,
  userId: number,
  groupId: number
): Promise<DescendantRow[]> {
  const result = await executor.execute(sql<DescendantRow>`
    WITH RECURSIVE descendants AS (
      SELECT
        ${repositoryGroups.id} AS id,
        ${repositoryGroups.parentId} AS "parentId",
        ${repositoryGroups.name} AS name,
        0::integer AS depth,
        ${repositoryGroups.orderIndex} AS "groupOrderIndex"
      FROM ${repositoryGroups}
      WHERE ${repositoryGroups.id} = ${groupId}
        AND ${repositoryGroups.userId} = ${userId}

      UNION ALL

      SELECT
        child.id,
        child.parent_id AS "parentId",
        child.name,
        descendants.depth + 1,
        child.order_index AS "groupOrderIndex"
      FROM repository_groups child
      INNER JOIN descendants ON child.parent_id = descendants.id
      WHERE child.user_id = ${userId}
    )
    SELECT id, "parentId", name, depth, "groupOrderIndex"
    FROM descendants
    ORDER BY depth, "groupOrderIndex", id
  `);
  return result.rows as unknown as DescendantRow[];
}

export async function listRepositoryGroupTree(
  db: Db,
  userId: number
): Promise<RepositoryGroupTreeNode[]> {
  const directRows = await db
    .select({
      id: repositoryGroups.id,
      userId: repositoryGroups.userId,
      parentId: repositoryGroups.parentId,
      name: repositoryGroups.name,
      color: repositoryGroups.color,
      icon: repositoryGroups.icon,
      description: repositoryGroups.description,
      orderIndex: repositoryGroups.orderIndex,
      createdAt: repositoryGroups.createdAt,
      updatedAt: repositoryGroups.updatedAt,
      directRepoCount: sql<unknown>`count(distinct ${groupMembers.repoId})`,
    })
    .from(repositoryGroups)
    .leftJoin(groupMembers, eq(groupMembers.groupId, repositoryGroups.id))
    .where(eq(repositoryGroups.userId, userId))
    .groupBy(repositoryGroups.id)
    .orderBy(asc(repositoryGroups.orderIndex), asc(repositoryGroups.id));

  const aggregateResult = await db.execute(sql<{
    groupId: number;
    aggregateRepoCount: number | string;
  }>`
    WITH RECURSIVE descendants AS (
      SELECT id AS ancestor_id, id AS descendant_id
      FROM repository_groups
      WHERE user_id = ${userId}

      UNION ALL

      SELECT descendants.ancestor_id, child.id
      FROM descendants
      INNER JOIN repository_groups child
        ON child.parent_id = descendants.descendant_id
       AND child.user_id = ${userId}
    )
    SELECT
      descendants.ancestor_id AS "groupId",
      count(DISTINCT group_members.repo_id)::integer AS "aggregateRepoCount"
    FROM descendants
    LEFT JOIN group_members ON group_members.group_id = descendants.descendant_id
    INNER JOIN user_watched_repositories
      ON user_watched_repositories.repo_id = group_members.repo_id
     AND user_watched_repositories.user_id = ${userId}
    GROUP BY descendants.ancestor_id
  `);

  const aggregateByGroup = new Map(
    aggregateResult.rows.map((row) => [
      row.groupId,
      normalizeRepositoryGroupCount(row.aggregateRepoCount),
    ])
  );
  const nodes = new Map<number, RepositoryGroupTreeNode>();

  for (const row of directRows) {
    const directRepoCount = normalizeRepositoryGroupCount(row.directRepoCount);
    nodes.set(row.id, {
      id: row.id,
      userId: row.userId,
      parentId: row.parentId,
      name: row.name,
      color: row.color,
      icon: row.icon,
      description: row.description,
      orderIndex: row.orderIndex,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      repoCount: directRepoCount,
      directRepoCount,
      aggregateRepoCount: aggregateByGroup.get(row.id) ?? 0,
      children: [],
    });
  }

  const roots: RepositoryGroupTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortSiblings = (siblings: RepositoryGroupTreeNode[]) => {
    siblings.sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
    for (const sibling of siblings) sortSiblings(sibling.children);
  };
  sortSiblings(roots);
  return roots;
}

export async function getAggregateRepositoryGroupView(
  db: Db,
  userId: number,
  groupId: number
): Promise<AggregateRepositoryGroupView | null> {
  const descendants = await listDescendants(db, userId, groupId);
  if (descendants.length === 0) return null;

  const descendantIds = descendants.map((group) => group.id);
  const directMemberships = await db
    .select({
      membershipId: groupMembers.id,
      groupId: groupMembers.groupId,
      repoId: groupMembers.repoId,
      orderIndex: groupMembers.orderIndex,
    })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, descendantIds));

  const repoIds = [...new Set(directMemberships.map((membership) => membership.repoId))];
  const visibleRepositories =
    repoIds.length === 0
      ? []
      : await db
          .select({ repository: repositories })
          .from(repositories)
          .innerJoin(
            userWatchedRepositories,
            and(
              eq(userWatchedRepositories.repoId, repositories.id),
              eq(userWatchedRepositories.userId, userId)
            )
          )
          .where(inArray(repositories.id, repoIds));

  const descendantById = new Map(descendants.map((group) => [group.id, group]));
  const membershipsByRepo = new Map<number, RepositoryGroupMembershipSource[]>();
  for (const membership of directMemberships) {
    const sourceGroup = descendantById.get(membership.groupId);
    if (!sourceGroup) continue;
    const sources = membershipsByRepo.get(membership.repoId) ?? [];
    sources.push({
      membershipId: membership.membershipId,
      groupId: membership.groupId,
      groupName: sourceGroup.name,
      depth: sourceGroup.depth,
      orderIndex: membership.orderIndex,
      isDirect: membership.groupId === groupId,
    });
    membershipsByRepo.set(membership.repoId, sources);
  }

  for (const sources of membershipsByRepo.values()) {
    sources.sort(
      (a, b) => a.depth - b.depth || a.orderIndex - b.orderIndex || a.groupId - b.groupId
    );
  }

  const members = visibleRepositories
    .map(({ repository }) => ({
      repoId: repository.id,
      repository,
      memberships: membershipsByRepo.get(repository.id) ?? [],
    }))
    .filter((member) => member.memberships.length > 0)
    .sort((a, b) => {
      const sourceA = a.memberships[0];
      const sourceB = b.memberships[0];
      return (
        sourceA.depth - sourceB.depth ||
        sourceA.orderIndex - sourceB.orderIndex ||
        a.repository.fullName.localeCompare(b.repository.fullName)
      );
    });

  const tree = await listRepositoryGroupTree(db, userId);
  const findNode = (nodes: RepositoryGroupTreeNode[]): RepositoryGroupTreeNode | null => {
    for (const node of nodes) {
      if (node.id === groupId) return node;
      const nested = findNode(node.children);
      if (nested) return nested;
    }
    return null;
  };
  const node = findNode(tree);
  if (!node) return null;
  const { children: _children, ...group } = node;
  return { group, members };
}

export interface CreateRepositoryGroupInput {
  userId: number;
  parentId?: number | null;
  name: string;
  color?: string;
  icon?: string;
  description?: string;
}

export async function createRepositoryGroup(
  db: Db,
  input: CreateRepositoryGroupInput
): Promise<RepositoryGroup> {
  const parentId = input.parentId ?? null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtext(${GROUP_HIERARCHY_LOCK_NAMESPACE}),
      ${input.userId}::integer
    )`);

    if (parentId !== null) {
      const [parent] = await tx
        .select({ id: repositoryGroups.id })
        .from(repositoryGroups)
        .where(and(eq(repositoryGroups.id, parentId), eq(repositoryGroups.userId, input.userId)))
        .limit(1);
      if (!parent) throw new Error('父分组不存在或无权访问');
    }

    const siblingCondition =
      parentId === null
        ? isNull(repositoryGroups.parentId)
        : eq(repositoryGroups.parentId, parentId);
    const [maxOrder] = await tx
      .select({ max: sql<number | null>`max(${repositoryGroups.orderIndex})` })
      .from(repositoryGroups)
      .where(and(eq(repositoryGroups.userId, input.userId), siblingCondition));

    const [group] = await tx
      .insert(repositoryGroups)
      .values({
        userId: input.userId,
        parentId,
        name: input.name,
        color: input.color ?? 'blue',
        icon: input.icon ?? 'folder',
        description: input.description,
        orderIndex: (maxOrder?.max ?? -1) + 1,
      })
      .returning();
    return group;
  });
}

export async function moveRepositoryGroup(
  db: Db,
  userId: number,
  groupId: number,
  parentId: number | null
): Promise<RepositoryGroup> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtext(${GROUP_HIERARCHY_LOCK_NAMESPACE}),
      ${userId}::integer
    )`);

    const [group] = await tx
      .select()
      .from(repositoryGroups)
      .where(and(eq(repositoryGroups.id, groupId), eq(repositoryGroups.userId, userId)))
      .limit(1);
    if (!group) throw new Error('分组不存在或无权访问');

    if (parentId !== null) {
      const [parent] = await tx
        .select({ id: repositoryGroups.id })
        .from(repositoryGroups)
        .where(and(eq(repositoryGroups.id, parentId), eq(repositoryGroups.userId, userId)))
        .limit(1);
      if (!parent) throw new Error('父分组不存在或无权访问');

      const descendants = await listDescendants(tx as Pick<Db, 'execute'>, userId, groupId);
      if (descendants.some((descendant) => descendant.id === parentId)) {
        throw new Error('不能把分组移动到自身或后代下');
      }
    }

    if (group.parentId === parentId) return group;

    const siblingCondition =
      parentId === null
        ? isNull(repositoryGroups.parentId)
        : eq(repositoryGroups.parentId, parentId);
    const [maxOrder] = await tx
      .select({ max: sql<number | null>`max(${repositoryGroups.orderIndex})` })
      .from(repositoryGroups)
      .where(and(eq(repositoryGroups.userId, userId), siblingCondition));

    const [updated] = await tx
      .update(repositoryGroups)
      .set({
        parentId,
        orderIndex: (maxOrder?.max ?? -1) + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(repositoryGroups.id, groupId), eq(repositoryGroups.userId, userId)))
      .returning();
    return updated;
  });
}

export async function reorderRepositoryGroupSiblings(
  db: Db,
  userId: number,
  parentId: number | null,
  groupIds: number[]
): Promise<void> {
  if (new Set(groupIds).size !== groupIds.length) {
    throw new Error('同级排序不能包含重复分组');
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtext(${GROUP_HIERARCHY_LOCK_NAMESPACE}),
      ${userId}::integer
    )`);

    if (parentId !== null) {
      const [parent] = await tx
        .select({ id: repositoryGroups.id })
        .from(repositoryGroups)
        .where(and(eq(repositoryGroups.id, parentId), eq(repositoryGroups.userId, userId)))
        .limit(1);
      if (!parent) throw new Error('父分组不存在或无权访问');
    }

    const siblingCondition =
      parentId === null
        ? isNull(repositoryGroups.parentId)
        : eq(repositoryGroups.parentId, parentId);
    const siblings = await tx
      .select({ id: repositoryGroups.id })
      .from(repositoryGroups)
      .where(and(eq(repositoryGroups.userId, userId), siblingCondition));

    const actualIds = siblings.map((group) => group.id).sort((a, b) => a - b);
    const requestedIds = [...groupIds].sort((a, b) => a - b);
    if (
      actualIds.length !== requestedIds.length ||
      actualIds.some((id, index) => id !== requestedIds[index])
    ) {
      throw new Error('必须提交目标父级下完整的同级分组集合');
    }

    for (const [orderIndex, id] of groupIds.entries()) {
      await tx
        .update(repositoryGroups)
        .set({ orderIndex, updatedAt: new Date() })
        .where(and(eq(repositoryGroups.id, id), eq(repositoryGroups.userId, userId)));
    }
  });
}
