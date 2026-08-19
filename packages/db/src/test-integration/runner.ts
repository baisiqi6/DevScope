import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { IntegrationGate } from "./guard";

// ============================================================================
// 集成测试 runner：唯一测试库生命周期 + 迁移应用与 drift 校验
//
// - 测试库总是由 runner 创建（唯一派生库名），cleanup 只删除本 run 记录的库名；
// - 迁移不经过 drizzle migrator（其在 vitest vite-node 环境下不可靠），
//   而是按 journal 顺序逐条执行 SQL 并手写 `drizzle.__drizzle_migrations` 行
//   （hash = 文件内容 SHA-256，created_at = journal.when，与生产一致）；
//   这同时是 migration matrix 中「历史 baseline + 续迁」用例的构造机制；
// - verifyMigrationJournal 提供工具链本身不做的 checksum/order drift 校验。
// ============================================================================

// vite-node（vitest globalSetup）以 ESM 加载本模块时没有 __dirname
const HERE = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "..", "..", "drizzle");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface MigrationFile {
  index: number;
  file: string;
  path: string;
  hash: string;
  entry: JournalEntry;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
  return journal.entries as JournalEntry[];
}

export function listMigrationFiles(): MigrationFile[] {
  const entries = readJournal();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .map((file) => {
      const index = Number(file.slice(0, 4));
      const entry = entries.find((e) => e.idx === index);
      if (!entry) {
        throw new Error(`迁移文件 ${file} 在 meta/_journal.json 中没有对应 entry`);
      }
      const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      return {
        index,
        file,
        path: path.join(MIGRATIONS_DIR, file),
        hash: createHash("sha256").update(sqlText).digest("hex"),
        entry,
      };
    })
    .sort((a, b) => a.index - b.index);
  if (files.length !== entries.length) {
    throw new Error(`journal entry 数（${entries.length}）与迁移文件数（${files.length}）不一致`);
  }
  return files;
}

export function splitMigrationStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function withAdminClient<T>(adminUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const JOURNAL_DDL = `
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  "id" SERIAL PRIMARY KEY,
  "hash" text NOT NULL,
  "created_at" bigint
);
`;

/**
 * 按编号范围 [from, to] 应用迁移并写入 journal 行（与 drizzle 行为一致）。
 * 每条语句独立执行，失败即抛出；不跳过任何已存在行（调用方负责从正确起点续跑）。
 */
export async function applyMigrationRange(databaseUrl: string, from: number, to: number): Promise<string[]> {
  const applied: string[] = [];
  const files = listMigrationFiles().filter((m) => m.index >= from && m.index <= to);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(JOURNAL_DDL);
    for (const migration of files) {
      const sqlText = fs.readFileSync(migration.path, "utf8");
      // 每个迁移文件一个事务（与 drizzle migrator 行为一致；
      // 0007 等迁移含 LOCK TABLE，必须位于事务块内）
      await client.query("BEGIN");
      try {
        for (const statement of splitMigrationStatements(sqlText)) {
          await client.query(statement);
        }
        await client.query(
          `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
          [migration.hash, migration.entry.when],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied.push(migration.file);
    }
  } finally {
    await client.end();
  }
  return applied;
}

export interface JournalDrift {
  kind: "count" | "hash" | "order" | "extra";
  detail: string;
}

/**
 * checksum/order drift 校验（工具链本身只按 created_at 跳过、不比对 hash）：
 * 库内 journal 行必须与本地迁移文件按 journal 顺序逐条 hash 一致，不允许多余行。
 */
export async function verifyMigrationJournal(databaseUrl: string): Promise<JournalDrift[]> {
  const files = listMigrationFiles();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ hash: string; created_at: string }>(
      `SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY id`,
    );
    const drifts: JournalDrift[] = [];
    if (rows.length !== files.length) {
      drifts.push({ kind: "count", detail: `库内 ${rows.length} 行 vs 本地 ${files.length} 个迁移文件` });
    }
    const limit = Math.min(rows.length, files.length);
    for (let i = 0; i < limit; i++) {
      if (rows[i].hash !== files[i].hash) {
        drifts.push({
          kind: "hash",
          detail: `第 ${i + 1} 条（${files[i].file}）hash 不一致：库内 ${rows[i].hash} vs 文件 ${files[i].hash}`,
        });
      }
      if (String(files[i].entry.when) !== String(rows[i].created_at)) {
        drifts.push({
          kind: "order",
          detail: `第 ${i + 1} 条（${files[i].file}）created_at 不一致：库内 ${rows[i].created_at} vs journal ${files[i].entry.when}`,
        });
      }
    }
    return drifts;
  } finally {
    await client.end();
  }
}

export interface PreparedDatabase {
  name: string;
  url: string;
}

/**
 * 创建唯一测试库并应用全部迁移（0000 → 最新，含 journal 行）。
 * cleanup 通过 dropIntegrationDatabase 完成（只接受本 run 派生的明确库名）。
 */
export async function prepareIntegrationDatabase(gate: Extract<IntegrationGate, { status: "ok" }>): Promise<PreparedDatabase> {
  const { testDatabaseName } = gate;
  await withAdminClient(gate.adminUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${testDatabaseName}"`);
  });
  await applyMigrationRange(gate.testDatabaseUrl, 0, Number.MAX_SAFE_INTEGER);
  return { name: testDatabaseName, url: gate.testDatabaseUrl };
}

/** 清理只针对 runner 记录的明确库名；不允许通配符、业务名或空值。 */
export async function dropIntegrationDatabase(
  gate: Extract<IntegrationGate, { status: "ok" }>,
  name: string,
): Promise<void> {
  if (!name || !/^devscope_test_[a-z0-9]+$/.test(name) || name === "devscope") {
    throw new Error(`拒绝删除不安全的测试库名: ${name || "(空)"}`);
  }
  await withAdminClient(gate.adminUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

export { MIGRATIONS_DIR };
