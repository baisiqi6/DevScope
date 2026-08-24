import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';
import {
  createRepositoryGroup,
  getAggregateRepositoryGroupView,
  listRepositoryGroupTree,
  moveRepositoryGroup,
  reorderRepositoryGroupSiblings,
} from './repository-groups';
import {
  applyMigrationRange,
  dropIntegrationDatabase,
  splitMigrationStatements,
} from './test-integration/runner';
import { deriveTestDatabaseName, resolveIntegrationGate } from './test-integration/guard';

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const HERE =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

describeIntegration('repository group hierarchy on PostgreSQL', () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  const poolB = new pg.Pool({ connectionString, max: 2 });
  let userId: number;
  let otherUserId: number;

  beforeAll(async () => {
    const users = await db
      .insert(schema.users)
      .values([
        { email: 'group-hierarchy-a@test.invalid', name: 'group hierarchy A' },
        { email: 'group-hierarchy-b@test.invalid', name: 'group hierarchy B' },
      ])
      .returning({ id: schema.users.id });
    userId = users[0].id;
    otherUserId = users[1].id;
  });

  beforeEach(async () => {
    await db.delete(schema.groupMembers);
    await db.execute(
      sql`UPDATE repository_groups SET parent_id = NULL WHERE user_id IN (${userId}, ${otherUserId})`
    );
    await db
      .delete(schema.repositoryGroups)
      .where(sql`${schema.repositoryGroups.userId} IN (${userId}, ${otherUserId})`);
    await db
      .delete(schema.userWatchedRepositories)
      .where(sql`${schema.userWatchedRepositories.userId} IN (${userId}, ${otherUserId})`);
    await db
      .delete(schema.repositories)
      .where(sql`${schema.repositories.fullName} LIKE 'group-hierarchy/%'`);
  });

  afterAll(async () => {
    await pool.end();
    await poolB.end();
  });

  async function seedThreeLevels() {
    const root = await createRepositoryGroup(db, { userId, name: 'Root' });
    const child = await createRepositoryGroup(db, { userId, parentId: root.id, name: 'Child' });
    const grandchild = await createRepositoryGroup(db, {
      userId,
      parentId: child.id,
      name: 'Grandchild',
    });
    return { root, child, grandchild };
  }

  it('构建三层树，并对后代仓库去重且保留全部直接 membership 来源', async () => {
    const { root, child, grandchild } = await seedThreeLevels();
    const [repoA, repoB] = await db
      .insert(schema.repositories)
      .values([
        {
          githubRepositoryId: 'group-hierarchy-1',
          fullName: 'group-hierarchy/repo-a',
          name: 'repo-a',
          owner: 'group-hierarchy',
          url: 'https://github.test/group-hierarchy/repo-a',
        },
        {
          githubRepositoryId: 'group-hierarchy-2',
          fullName: 'group-hierarchy/repo-b',
          name: 'repo-b',
          owner: 'group-hierarchy',
          url: 'https://github.test/group-hierarchy/repo-b',
        },
      ])
      .returning();
    await db.insert(schema.userWatchedRepositories).values([
      { userId, repoId: repoA.id, repoFullName: repoA.fullName },
      { userId, repoId: repoB.id, repoFullName: repoB.fullName },
    ]);
    await db.insert(schema.groupMembers).values([
      { groupId: child.id, repoId: repoA.id, orderIndex: 0 },
      { groupId: grandchild.id, repoId: repoA.id, orderIndex: 0 },
      { groupId: grandchild.id, repoId: repoB.id, orderIndex: 1 },
    ]);

    const tree = await listRepositoryGroupTree(db, userId);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      id: root.id,
      parentId: null,
      repoCount: 0,
      directRepoCount: 0,
      aggregateRepoCount: 2,
    });
    expect(tree[0].children[0]).toMatchObject({
      id: child.id,
      parentId: root.id,
      directRepoCount: 1,
      aggregateRepoCount: 2,
    });
    expect(tree[0].children[0].children[0].id).toBe(grandchild.id);

    const aggregate = await getAggregateRepositoryGroupView(db, userId, root.id);
    expect(aggregate?.group).toMatchObject({
      id: root.id,
      directRepoCount: 0,
      aggregateRepoCount: 2,
    });
    expect(aggregate?.members.map((member) => member.repository.fullName)).toEqual([
      'group-hierarchy/repo-a',
      'group-hierarchy/repo-b',
    ]);
    const repoAMember = aggregate?.members.find((member) => member.repoId === repoA.id);
    expect(repoAMember?.memberships.map((membership) => membership.groupId)).toEqual([
      child.id,
      grandchild.id,
    ]);
    expect(repoAMember?.memberships.every((membership) => !membership.isDirect)).toBe(true);

    await db
      .delete(schema.userWatchedRepositories)
      .where(
        and(
          eq(schema.userWatchedRepositories.userId, userId),
          eq(schema.userWatchedRepositories.repoId, repoB.id)
        )
      );
    const treeAfterUnwatch = await listRepositoryGroupTree(db, userId);
    expect(treeAfterUnwatch[0].aggregateRepoCount).toBe(1);
    const aggregateAfterUnwatch = await getAggregateRepositoryGroupView(db, userId, root.id);
    expect(aggregateAfterUnwatch?.group.aggregateRepoCount).toBe(1);
    expect(aggregateAfterUnwatch?.members.map((member) => member.repository.fullName)).toEqual([
      'group-hierarchy/repo-a',
    ]);

    await db
      .delete(schema.userWatchedRepositories)
      .where(
        and(
          eq(schema.userWatchedRepositories.userId, userId),
          eq(schema.userWatchedRepositories.repoId, repoA.id)
        )
      );
    const treeWithoutVisibleMembers = await listRepositoryGroupTree(db, userId);
    expect(treeWithoutVisibleMembers[0].aggregateRepoCount).toBe(0);
    expect(treeWithoutVisibleMembers[0].children[0]).toMatchObject({
      directRepoCount: 1,
      aggregateRepoCount: 0,
    });
    const aggregateWithoutVisibleMembers = await getAggregateRepositoryGroupView(
      db,
      userId,
      root.id
    );
    expect(aggregateWithoutVisibleMembers?.group.aggregateRepoCount).toBe(0);
    expect(aggregateWithoutVisibleMembers?.members).toEqual([]);
  });

  it('组合外键拒绝跨用户 parent，trigger 拒绝自循环与后代循环', async () => {
    const { root, child, grandchild } = await seedThreeLevels();
    const otherRoot = await createRepositoryGroup(db, { userId: otherUserId, name: 'Other' });

    await expect(
      db
        .update(schema.repositoryGroups)
        .set({ parentId: otherRoot.id })
        .where(eq(schema.repositoryGroups.id, root.id))
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'repository_groups_parent_user_fk' },
    });

    await expect(
      db
        .update(schema.repositoryGroups)
        .set({ parentId: child.id })
        .where(eq(schema.repositoryGroups.id, child.id))
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'repository_groups_no_cycle' },
    });

    await expect(
      db
        .update(schema.repositoryGroups)
        .set({ parentId: grandchild.id })
        .where(eq(schema.repositoryGroups.id, root.id))
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'repository_groups_no_cycle' },
    });
  });

  it('移动和同级重排在同一用户锁下执行，并拒绝不完整或重复集合', async () => {
    const rootA = await createRepositoryGroup(db, { userId, name: 'Root A' });
    const rootB = await createRepositoryGroup(db, { userId, name: 'Root B' });
    const childA = await createRepositoryGroup(db, { userId, parentId: rootA.id, name: 'A' });
    const childB = await createRepositoryGroup(db, { userId, parentId: rootA.id, name: 'B' });

    await expect(reorderRepositoryGroupSiblings(db, userId, rootA.id, [childA.id])).rejects.toThrow(
      /完整/
    );
    await expect(
      reorderRepositoryGroupSiblings(db, userId, rootA.id, [childA.id, childA.id])
    ).rejects.toThrow(/重复/);

    await reorderRepositoryGroupSiblings(db, userId, rootA.id, [childB.id, childA.id]);
    const ordered = await db
      .select({ id: schema.repositoryGroups.id })
      .from(schema.repositoryGroups)
      .where(
        and(
          eq(schema.repositoryGroups.userId, userId),
          eq(schema.repositoryGroups.parentId, rootA.id)
        )
      )
      .orderBy(schema.repositoryGroups.orderIndex);
    expect(ordered.map((group) => group.id)).toEqual([childB.id, childA.id]);

    const moved = await moveRepositoryGroup(db, userId, childA.id, rootB.id);
    expect(moved.parentId).toBe(rootB.id);
    await expect(moveRepositoryGroup(db, userId, rootA.id, childB.id)).rejects.toThrow(
      /自身或后代/
    );
  });

  it('含子组的父分组删除受外键保护，叶子分组仍可删除', async () => {
    const { root, grandchild } = await seedThreeLevels();
    await expect(
      db.delete(schema.repositoryGroups).where(eq(schema.repositoryGroups.id, root.id))
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'repository_groups_parent_user_fk' },
    });
    await expect(
      db.delete(schema.repositoryGroups).where(eq(schema.repositoryGroups.id, grandchild.id))
    ).resolves.toBeDefined();
  });

  it('两个连接并发执行相反移动时按 userId 串行，最终不能形成循环', async () => {
    const groupA = await createRepositoryGroup(db, { userId, name: 'A' });
    const groupB = await createRepositoryGroup(db, { userId, name: 'B' });
    const clientA = await pool.connect();
    const clientB = await poolB.connect();
    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');
      await clientA.query("SET LOCAL statement_timeout = '5s'");
      await clientB.query("SET LOCAL statement_timeout = '5s'");

      await clientA.query('UPDATE repository_groups SET parent_id = $1 WHERE id = $2', [
        groupB.id,
        groupA.id,
      ]);
      const opposingMove = clientB.query(
        'UPDATE repository_groups SET parent_id = $1 WHERE id = $2',
        [groupA.id, groupB.id]
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      const waiting = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
      );
      expect(waiting.rows[0].n).toBeGreaterThan(0);

      await clientA.query('COMMIT');
      await expect(opposingMove).rejects.toMatchObject({
        code: '23514',
        constraint: 'repository_groups_no_cycle',
      });
      await clientB.query('ROLLBACK');

      const rows = await db
        .select({ id: schema.repositoryGroups.id, parentId: schema.repositoryGroups.parentId })
        .from(schema.repositoryGroups)
        .where(sql`${schema.repositoryGroups.id} IN (${groupA.id}, ${groupB.id})`);
      expect(rows.find((group) => group.id === groupA.id)?.parentId).toBe(groupB.id);
      expect(rows.find((group) => group.id === groupB.id)?.parentId).toBeNull();
    } finally {
      await clientA.query('ROLLBACK').catch(() => undefined);
      await clientB.query('ROLLBACK').catch(() => undefined);
      clientA.release();
      clientB.release();
    }
  });
});

describeIntegration('repository group hierarchy migration and rollback', () => {
  it('0010 扁平分组无损升级为根级，空层级数据可按受保护脚本回滚', async () => {
    const gate = resolveIntegrationGate({
      TEST_DATABASE_URL: process.env.TEST_DATABASE_ADMIN_URL,
      TEST_DATABASE_DESTRUCTIVE: process.env.TEST_DATABASE_DESTRUCTIVE,
      NODE_ENV: process.env.NODE_ENV,
    });
    if (gate.status !== 'ok') throw new Error(`迁移矩阵需要 ok 的隔离门禁（${gate.status}）`);

    const databaseName = deriveTestDatabaseName();
    const admin = new pg.Client({ connectionString: gate.adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();
    const databaseUrl = gate.testDatabaseUrl.replace(/\/[^/]+$/, `/${databaseName}`);

    try {
      await applyMigrationRange(databaseUrl, 0, 10);
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        const user = await client.query<{ id: number }>(
          "INSERT INTO users (email) VALUES ('group-migration@test.invalid') RETURNING id"
        );
        const groups = await client.query<{ id: number }>(
          "INSERT INTO repository_groups (user_id, name, order_index) VALUES ($1, 'one', 0), ($1, 'two', 1) RETURNING id",
          [user.rows[0].id]
        );
        const repository = await client.query<{ id: number }>(
          "INSERT INTO repositories (full_name, name, owner, url) VALUES ('group-migration/repo', 'repo', 'group-migration', 'https://github.test/group-migration/repo') RETURNING id"
        );
        await client.query(
          'INSERT INTO group_members (group_id, repo_id, order_index) VALUES ($1, $2, 0)',
          [groups.rows[0].id, repository.rows[0].id]
        );

        await applyMigrationRange(databaseUrl, 11, 11);
        const migrated = await client.query(
          'SELECT id, parent_id FROM repository_groups ORDER BY order_index'
        );
        expect(migrated.rows).toEqual([
          { id: groups.rows[0].id, parent_id: null },
          { id: groups.rows[1].id, parent_id: null },
        ]);
        const memberCount = await client.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM group_members'
        );
        expect(memberCount.rows[0].n).toBe(1);

        const rollbackPath = path.resolve(
          HERE,
          '..',
          'drizzle',
          'rollback',
          '0011_repository_group_hierarchy.sql'
        );
        const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');
        await client.query('UPDATE repository_groups SET parent_id = $1 WHERE id = $2', [
          groups.rows[0].id,
          groups.rows[1].id,
        ]);

        let rollbackError: unknown;
        await client.query('BEGIN');
        try {
          for (const statement of splitMigrationStatements(rollbackSql)) {
            await client.query(statement);
          }
          await client.query('COMMIT');
        } catch (error) {
          rollbackError = error;
          await client.query('ROLLBACK');
        }
        expect(rollbackError).toBeInstanceOf(Error);
        expect((rollbackError as Error).message).toContain('parent_id');

        const protectedSchema = await client.query<{
          parent_id: number | null;
          trigger_exists: boolean;
          fk_exists: boolean;
        }>(
          `
          SELECT
            child.parent_id,
            EXISTS (
              SELECT 1 FROM pg_trigger
              WHERE tgname = 'repository_groups_hierarchy_guard'
                AND NOT tgisinternal
            ) AS trigger_exists,
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'repository_groups_parent_user_fk'
            ) AS fk_exists
          FROM repository_groups child
          WHERE child.id = $1
        `,
          [groups.rows[1].id]
        );
        expect(protectedSchema.rows[0]).toEqual({
          parent_id: groups.rows[0].id,
          trigger_exists: true,
          fk_exists: true,
        });

        await client.query('UPDATE repository_groups SET parent_id = NULL WHERE id = $1', [
          groups.rows[1].id,
        ]);
        await client.query('BEGIN');
        try {
          for (const statement of splitMigrationStatements(rollbackSql)) {
            await client.query(statement);
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }

        const column = await client.query(
          "SELECT 1 FROM information_schema.columns WHERE table_name = 'repository_groups' AND column_name = 'parent_id'"
        );
        expect(column.rows).toHaveLength(0);
        const membersAfterRollback = await client.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM group_members'
        );
        expect(membersAfterRollback.rows[0].n).toBe(1);
      } finally {
        await client.end();
      }
    } finally {
      await dropIntegrationDatabase(gate, databaseName);
    }
  });
});
