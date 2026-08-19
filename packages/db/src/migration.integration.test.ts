import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  deriveTestDatabaseName,
  resolveIntegrationGate,
} from "./test-integration/guard";
import {
  applyMigrationRange,
  dropIntegrationDatabase,
  listMigrationFiles,
  verifyMigrationJournal,
} from "./test-integration/runner";

// ============================================================================
// Migration matrix：真实迁移、0004 era baseline 升级、journal drift 检测
// ============================================================================

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-02-01T00:00:00.000Z");

describeIntegration("migration matrix on PostgreSQL", () => {
  // 共享库（globalSetup 已从 0000 迁移到最新）
  const pool = new pg.Pool({ connectionString, max: 4 });

  // 矩阵自管的独立库（baseline 场景需要控制迁移范围）
  let matrixUrl: string | null = null;
  let matrixName = "";

  beforeAll(async () => {
    // 用 admin 入口（globalSetup 注入）派生矩阵专用库；guard 只接受 postgres admin
    const gate = resolveIntegrationGate({
      TEST_DATABASE_URL: process.env.TEST_DATABASE_ADMIN_URL,
      TEST_DATABASE_DESTRUCTIVE: process.env.TEST_DATABASE_DESTRUCTIVE,
      NODE_ENV: process.env.NODE_ENV,
    });
    if (gate.status !== "ok") throw new Error(`migration matrix 需要 ok 的隔离门禁（${gate.status}）`);
    matrixName = deriveTestDatabaseName();
    const admin = new pg.Client({ connectionString: gate.adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${matrixName}"`);
    await admin.end();
    matrixUrl = gate.testDatabaseUrl.replace(/\/[^/]+$/, `/${matrixName}`);
  });

  afterAll(async () => {
    await pool.end();
    if (matrixUrl) {
      const gate = resolveIntegrationGate({
        TEST_DATABASE_URL: process.env.TEST_DATABASE_ADMIN_URL,
        TEST_DATABASE_DESTRUCTIVE: process.env.TEST_DATABASE_DESTRUCTIVE,
        NODE_ENV: process.env.NODE_ENV,
      });
      if (gate.status === "ok") {
        await dropIntegrationDatabase(gate, matrixName);
      }
    }
  });

  it("空库从 0000 迁移到最新：pgvector extension、journal 与关键表就位", async () => {
    const extensions = await pool.query<{ extname: string }>(
      "select extname from pg_extension",
    );
    expect(extensions.rows.map((r) => r.extname)).toContain("vector");

    const tables = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    const names = tables.rows.map((r) => r.tablename);
    for (const expected of [
      "jobs",
      "repositories",
      "package_repo_mappings",
      "github_repo_name_canonicalizations",
      "repository_technology_stacks",
      "technology_stacks",
      "repo_relationships",
      "releases",
      "radar_candidates",
    ]) {
      expect(names).toContain(expected);
    }

    // journal 与本地迁移文件逐条一致（checksum/order drift 为零）
    const drift = await verifyMigrationJournal(connectionString!);
    expect(drift).toEqual([]);
    const journalRows = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(journalRows.rows[0].n).toBe(listMigrationFiles().length);
  });

  it("drift 校验：篡改库内 hash 或多余 journal 行都能检出", async () => {
    const client = await pool.connect();
    const [first] = listMigrationFiles();
    try {
      await client.query("update drizzle.__drizzle_migrations set hash = 'tampered' where id = 1");
      const drift = await verifyMigrationJournal(connectionString!);
      expect(drift.some((d) => d.kind === "hash")).toBe(true);
    } finally {
      // 无论断言成败都还原，避免把篡改状态留给本 run 剩余用例
      await client.query("update drizzle.__drizzle_migrations set hash = $1 where id = 1", [first.hash]);
      client.release();
    }
    expect(await verifyMigrationJournal(connectionString!)).toEqual([]);

    // 多余行 → count drift（同样在 finally 中清理）
    try {
      await client.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ('extra', 999)");
      const drift = await verifyMigrationJournal(connectionString!);
      expect(drift.some((d) => d.kind === "count")).toBe(true);
    } finally {
      await client.query("delete from drizzle.__drizzle_migrations where hash = 'extra'");
    }
    expect(await verifyMigrationJournal(connectionString!)).toEqual([]);
  });

  it("0004 era baseline 升级到最新：dedupe、userId 回填、bigint、radar 合并、deps 回填", async () => {
    const client = new pg.Client({ connectionString: matrixUrl! });
    await client.connect();
    try {
      // 1) 应用到 0003（0004 之前的形态：允许重复 watch、边无 user_id、release id 仍为 int4）
      await applyMigrationRange(matrixUrl!, 0, 3);

      await client.query(`
        insert into users (email, name) values ('era@devscope.local', 'era user');
      `);
      const { rows: userRows } = await client.query<{ id: number }>("select id from users limit 1");
      const userId = userRows[0].id;

      await client.query(`
        insert into repositories (full_name, name, owner, url, created_at, updated_at)
        values
          ('old/a', 'a', 'old', 'https://github.test/old/a', $1, $1),
          ('old/b', 'b', 'old', 'https://github.test/old/b', $1, $1)
      `, [T0]);
      const { rows: repoRows } = await client.query<{ id: number; full_name: string }>(
        "select id, full_name from repositories order by id",
      );
      const repoA = repoRows.find((r) => r.full_name === "old/a")!;
      const repoB = repoRows.find((r) => r.full_name === "old/b")!;

      // 重复 (user, repo) 的历史 watch 行：updated_at 较新者保留其 notes
      await client.query(`
        insert into user_watched_repositories (user_id, repo_id, repo_full_name, notes, created_at, updated_at)
        values
          ($1, $2, 'old/a', 'stale-note', $3, $3),
          ($1, $2, 'old/a', 'kept-note', $4, $4),
          ($1, $5, 'old/b', null, $3, $3)
      `, [userId, repoA.id, T0, T1, repoB.id]);

      // 全局时代的边（无 user_id）
      await client.query(`
        insert into repo_relationships (source_repo_id, target_repo_id, edge_type, score, created_at, updated_at)
        values ($1, $2, 'dependency', null, $3, $3)
      `, [repoA.id, repoB.id, T0]);

      // 0006 之前 releases.id 是 int4：放一个接近上限的行
      await client.query(`
        insert into releases (id, repo_id, tag_name, name, author, created_at, url, html_url, assets)
        values (2147483000, $1, 'v1', 'era release', 'era', $2, 'https://github.test/r', 'https://github.test/r', '[]'::jsonb)
      `, [repoA.id, T0]);

      // 0007 之前 radar_candidates 允许同 github_repo_id 重复：
      // shortlisted 行 last_seen 最新（成为 keeper），discovered 行被合并
      await client.query(`
        insert into radar_candidates
          (user_id, github_repo_id, full_name, name, owner, url, stars, forks, open_issues, status, source, deterministic_score, evidence, first_seen_at, last_seen_at, created_at, updated_at)
        values
          ($1, '555001', 'old/rename-a', 'rename-a', 'old', 'https://github.test/a', 1, 0, 0, 'discovered', 'github_search', 1.0, '{}'::jsonb, $2, $2, $2, $2),
          ($1, '555001', 'new/rename-b', 'rename-b', 'new', 'https://github.test/b', 2, 0, 0, 'shortlisted', 'github_search', 2.0, '{}'::jsonb, $2, $3, $2, $3)
      `, [userId, T0, T1]);

      // 0009 之前 package_repo_mappings 无状态列：null 与非空并存
      await client.query(`
        insert into package_repo_mappings (system, package_name, package_version, source_repo, fetched_at)
        values
          ('npm', 'era-known', '1.0.0', 'some/repo', $1),
          ('npm', 'era-null', '1.0.0', null, $1)
      `, [T0]);

      // 2) 从 0004（dedupe/回填）续迁到最新
      await applyMigrationRange(matrixUrl!, 4, Number.MAX_SAFE_INTEGER);

      // 3) 断言：watch 去重保留最新 notes；userId 边回填
      const watches = await client.query(
        "select repo_id, notes from user_watched_repositories where user_id = $1 order by repo_id",
        [userId],
      );
      expect(watches.rows).toHaveLength(2);
      const watchA = watches.rows.find((r: { repo_id: number }) => r.repo_id === repoA.id);
      expect(watchA?.notes).toBe("kept-note");

      const edges = await client.query(
        "select user_id from repo_relationships where source_repo_id = $1",
        [repoA.id],
      );
      expect(edges.rows[0].user_id).toBe(userId);

      // 4) 0006：老 id 保留，且可以插入超过 int4 上限的新 release
      const oldRelease = await client.query("select id from releases where id = 2147483000");
      expect(oldRelease.rows).toHaveLength(1);
      await client.query(`
        insert into releases (id, repo_id, tag_name, name, author, created_at, url, html_url, assets)
        values (2147483648, $1, 'v-big', 'big', 'era', $2, 'https://github.test/b', 'https://github.test/b', '[]'::jsonb)
      `, [repoA.id, T0]);
      const bigRelease = await client.query("select id::text from releases where id = 2147483648");
      expect(bigRelease.rows[0].id).toBe("2147483648");

      // 5) 0007：radar 同 ID 合并为 keeper（accepted 状态 + merge 证据 + 唯一索引）
      const merged = await client.query<{ full_name: string; status: string; evidence: { repositoryIdentityMerge?: { mergedFullNames?: string[] } } }>(
        "select full_name, status, evidence from radar_candidates where github_repo_id = '555001'",
      );
      expect(merged.rows).toHaveLength(1);
      expect(merged.rows[0].status).toBe("shortlisted");
      expect(merged.rows[0].evidence.repositoryIdentityMerge?.mergedFullNames).toContain("old/rename-a");
      await expect(client.query(`
        insert into radar_candidates
          (user_id, github_repo_id, full_name, name, owner, url, stars, forks, open_issues, status, source, deterministic_score, evidence, first_seen_at, last_seen_at, created_at, updated_at)
        values ($1, '555001', 'another/name', 'name', 'another', 'https://github.test/c', 1, 0, 0, 'discovered', 'github_search', 1.0, '{}'::jsonb, $2, $2, $2, $2)
      `, [userId, T0])).rejects.toThrow();

      // 6) 0009：null → error + 短退避；非空 → resolved + 30 天复查点
      const mappings = await client.query<{ package_name: string; resolution_status: string; retry_after: Date }>(
        "select package_name, resolution_status, retry_after from package_repo_mappings",
      );
      const known = mappings.rows.find((r) => r.package_name === "era-known")!;
      expect(known.resolution_status).toBe("resolved");
      expect(new Date(known.retry_after).getTime()).toBeGreaterThan(Date.now());
      const unknown = mappings.rows.find((r) => r.package_name === "era-null")!;
      expect(unknown.resolution_status).toBe("error");
      expect(new Date(unknown.retry_after).getTime()).toBeGreaterThan(Date.now());

      // 7) journal 与本地文件一致
      expect(await verifyMigrationJournal(matrixUrl!)).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
