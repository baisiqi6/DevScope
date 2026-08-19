import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { commitRepositoryCollectionSnapshot, type RepositoryCollectionSnapshot } from "./collection";
import { compareTechnologyStackProjection } from "./technology-stack-entities";
import {
  createJobProgressSink,
  assertJobLease,
  updateJobProgress,
  GRAPH_REBUILD_JOB,
} from "./jobs";
import {
  recomputeDependencyEdges,
  rebuildRepoGraph,
} from "./repo-graph";
import {
  DEFAULT_EXTERNAL_RESOLUTION_SETTINGS,
  ExternalRequestBudget,
  GraphBudgetExceededError,
  GraphLeaseLostError,
  type CanonicalizationOutcome,
  type DepsDevOutcome,
} from "./deps-cache";

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "deps-cache-test/";

// 迁移 0009 中固定下来的历史行回填语义（重放不得漂移）
const MIGRATION_BACKFILL_SQL = [
  `UPDATE "package_repo_mappings" SET "resolution_status" = 'resolved', "retry_after" = now() + interval '30 days' WHERE "source_repo" IS NOT NULL AND "resolution_status" <> 'resolved'`,
  `UPDATE "package_repo_mappings" SET "retry_after" = now() + interval '15 minutes' WHERE "source_repo" IS NULL AND "retry_after" IS NULL`,
];

function snapshot(githubRepositoryId: string, packages: Array<{ name: string; version: string; system: string }>): RepositoryCollectionSnapshot {
  return {
    repository: {
      githubRepositoryId,
      fullName: `${PREFIX}${githubRepositoryId}`,
      name: githubRepositoryId,
      owner: "deps-cache-test",
      description: "deps cache integration",
      url: `https://github.test/${githubRepositoryId}`,
      stars: 1,
      forks: 0,
      openIssues: 0,
      language: "TypeScript",
      license: "MIT",
      readme: "deps cache integration",
      readmeUrl: null,
      lastFetchedAt: new Date(),
      isReference: false,
    },
    chunks: [],
    hackernews: { status: "success", items: [] },
    releases: { status: "success", items: [] },
    sbom: { status: "success", packages },
    allowNewStableIdentity: true,
  };
}

const NOW = new Date("2026-08-19T00:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 3_600_000);
const PAST = new Date(NOW.getTime() - 3_600_000);

const settings = { ...DEFAULT_EXTERNAL_RESOLUTION_SETTINGS, pacingMs: 0 };

function depsResolved(sourceRepo: string): DepsDevOutcome {
  return { status: "resolved", sourceRepo, retryAfterSeconds: null, errorSummary: null };
}
function depsNotFound(): DepsDevOutcome {
  return { status: "not_found", sourceRepo: null, retryAfterSeconds: null, errorSummary: null };
}
function canonResolved(canonicalFullName: string): CanonicalizationOutcome {
  return { status: "resolved", canonicalFullName, retryAfterSeconds: null, errorSummary: null };
}

describeIntegration("deps cache recovery on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  let userId: number;

  async function clean() {
    await db.delete(schema.jobs);
    await db.delete(schema.repoRelationships);
    await db.delete(schema.packageRepoMappings);
    await db.delete(schema.githubRepoNameCanonicalizations);
    await db.delete(schema.userWatchedRepositories);
    await db.delete(schema.repositoryTechnologyStacks);
    await db.delete(schema.technologyStacks);
    await db.delete(schema.repositories);
  }

  beforeAll(async () => {
    await pool.query("select 1");
    const [user] = await db.insert(schema.users).values({
      email: "deps-cache-recovery@test.invalid",
      name: "deps cache integration",
    }).returning({ id: schema.users.id });
    userId = user.id;
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await pool.end();
  });

  async function commitAndWatch(id: string, packages: Array<{ name: string; version: string; system: string }>) {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot(id, packages));
    await db.insert(schema.userWatchedRepositories).values({
      userId,
      repoId: committed.repository.id,
      repoFullName: committed.repository.fullName,
      enableDailyReport: false,
    });
    return committed;
  }

  async function mappingRow(system: string, name: string, version: string) {
    const [row] = await db
      .select()
      .from(schema.packageRepoMappings)
      .where(and(
        eq(schema.packageRepoMappings.system, system),
        eq(schema.packageRepoMappings.packageName, name),
        eq(schema.packageRepoMappings.packageVersion, version),
      ));
    return row;
  }

  it("CHECK 约束强制 resolved⟺source_repo 非空，DEFAULT 为 error", async () => {
    await expect(db.insert(schema.packageRepoMappings).values({
      system: "npm",
      packageName: "bad-resolved",
      packageVersion: "1.0.0",
      sourceRepo: null,
      resolutionStatus: "resolved",
      retryAfter: FUTURE,
    })).rejects.toThrow();

    await expect(db.insert(schema.packageRepoMappings).values({
      system: "npm",
      packageName: "bad-error",
      packageVersion: "1.0.0",
      sourceRepo: "some/repo",
      resolutionStatus: "error",
      retryAfter: FUTURE,
    })).rejects.toThrow();

    // DEFAULT 'error'：不写状态时按可重试 error 落库（回滚窗口自愈语义）
    await db.insert(schema.packageRepoMappings).values({
      system: "npm",
      packageName: "defaulted",
      packageVersion: "1.0.0",
      sourceRepo: null,
    });
    expect((await mappingRow("npm", "defaulted", "1.0.0"))?.resolutionStatus).toBe("error");
  });

  it("历史行回填语义可重放且不漂移", async () => {
    // CHECK 存在后只能以合法形态播种：
    // known 是迁移完成态（resolved + 复查点），重放 UPDATE1 不得推进它的复查点；
    // rollback-window 行（source_repo=null、无 retry_after）由 UPDATE2 自愈为短退避。
    await db.insert(schema.packageRepoMappings).values([
      { system: "npm", packageName: "known", packageVersion: "1.0.0", sourceRepo: "org/known", resolutionStatus: "resolved", retryAfter: FUTURE },
      { system: "npm", packageName: "unknown", packageVersion: "1.0.0", sourceRepo: null, resolutionStatus: "error", retryAfter: null },
    ]);

    for (const statement of MIGRATION_BACKFILL_SQL) {
      await pool.query(statement);
    }
    const known = await mappingRow("npm", "known", "1.0.0");
    expect(known?.resolutionStatus).toBe("resolved");
    expect(known?.retryAfter?.getTime()).toBe(FUTURE.getTime());
    const unknown = await mappingRow("npm", "unknown", "1.0.0");
    expect(unknown?.resolutionStatus).toBe("error");
    const firstRetryAfter = unknown?.retryAfter;
    expect(firstRetryAfter).not.toBeNull();

    // 重放迁移语句：已回填行不再变化
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const statement of MIGRATION_BACKFILL_SQL) {
      await pool.query(statement);
    }
    const replayedKnown = await mappingRow("npm", "known", "1.0.0");
    expect(replayedKnown?.retryAfter?.getTime()).toBe(FUTURE.getTime());
    const replayedUnknown = await mappingRow("npm", "unknown", "1.0.0");
    expect(replayedUnknown?.retryAfter?.getTime()).toBe(firstRetryAfter?.getTime());
  });

  it("迁移文件固定了回填语义（非空→resolved+30 天，null→error+15 分钟）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(__dirname, "..", "drizzle");
    const file = fs.readdirSync(dir).find((name) => name.startsWith("0009_"));
    expect(file).toBeDefined();
    const sql = fs.readFileSync(path.join(dir, file!), "utf8");
    expect(sql).toContain(
      `"resolution_status" = 'resolved', "retry_after" = now() + interval '30 days' WHERE "source_repo" IS NOT NULL`);
    expect(sql).toContain(`DEFAULT 'error'`);
    expect(sql).toContain(
      `"retry_after" = now() + interval '15 minutes' WHERE "source_repo" IS NULL`);
    expect(sql).toContain(`(resolution_status = 'resolved') = (source_repo IS NOT NULL)`);
  });

  it("error 到期后重查转 resolved；未到期不外呼", async () => {
    await commitAndWatch("930001", [
      { name: "fresh-error", version: "1.0.0", system: "npm" },
      { name: "pending-error", version: "1.0.0", system: "npm" },
    ]);
    await db.insert(schema.packageRepoMappings).values([
      {
        system: "npm", packageName: "fresh-error", packageVersion: "1.0.0",
        sourceRepo: null, resolutionStatus: "error", retryAfter: PAST,
      },
      {
        system: "npm", packageName: "pending-error", packageVersion: "1.0.0",
        sourceRepo: null, resolutionStatus: "error", retryAfter: FUTURE,
      },
    ]);

    const resolveMapping = vi.fn(async (_s: string, name: string) =>
      depsResolved(name === "fresh-error" ? `${PREFIX}930002` : `${PREFIX}930003`));
    await commitAndWatch("930002", []);
    await commitAndWatch("930003", []);

    await recomputeDependencyEdges(db, userId, {
      resolveMapping,
      settings,
      now: () => NOW,
    });

    expect(resolveMapping).toHaveBeenCalledTimes(1);
    expect((await mappingRow("npm", "fresh-error", "1.0.0"))?.resolutionStatus).toBe("resolved");
    expect((await mappingRow("npm", "pending-error", "1.0.0"))?.resolutionStatus).toBe("error");
  });

  it("预算耗尽 fail closed：图零写入，receipt 保留，下一 attempt 从缓存续跑", async () => {
    await commitAndWatch("930010", [
      { name: "pkg-a", version: "1.0.0", system: "npm" },
      { name: "pkg-b", version: "1.0.0", system: "npm" },
    ]);

    const resolveMapping = vi.fn(async (_s: string, name: string) => depsNotFound());

    await expect(recomputeDependencyEdges(db, userId, {
      resolveMapping,
      settings: { ...settings, depsRequestBudget: 1 },
      now: () => NOW,
    })).rejects.toThrow(GraphBudgetExceededError);

    expect(resolveMapping).toHaveBeenCalledTimes(1);
    expect((await mappingRow("npm", "pkg-a", "1.0.0"))?.resolutionStatus).toBe("not_found");
    expect(await db.select().from(schema.repoRelationships)
      .where(eq(schema.repoRelationships.userId, userId))).toHaveLength(0);

    // 第二次：预算恢复，只有剩余 miss 触发外呼
    await expect(recomputeDependencyEdges(db, userId, {
      resolveMapping,
      settings,
      now: () => NOW,
    })).resolves.toBeDefined();
    expect(resolveMapping).toHaveBeenCalledTimes(2);
  });

  it("canonicalization freshness：第二次 warm rebuild 零 GitHub 外呼，rename 回写映射且保留 resolution 状态", async () => {
    await commitAndWatch("930020", [
      { name: "pkg-1", version: "1.0.0", system: "npm" },
    ]);
    await commitAndWatch("930021", [
      { name: "pkg-2", version: "1.0.0", system: "npm" },
    ]);
    await commitAndWatch("930022", []);
    // 两个包都映射到旧名 old/target（indegree=2 达到归一门槛）
    await db.insert(schema.packageRepoMappings).values([
      { system: "npm", packageName: "pkg-1", packageVersion: "1.0.0", sourceRepo: "old/target", resolutionStatus: "resolved", retryAfter: FUTURE },
      { system: "npm", packageName: "pkg-2", packageVersion: "1.0.0", sourceRepo: "old/target", resolutionStatus: "resolved", retryAfter: FUTURE },
    ]);

    const resolveMapping = vi.fn();
    const canonicalize = vi.fn(async () => canonResolved(`${PREFIX}930022`));

    await recomputeDependencyEdges(db, userId, {
      resolveMapping, canonicalize, settings, now: () => NOW,
    });
    expect(canonicalize).toHaveBeenCalledTimes(1);
    expect(canonicalize).toHaveBeenCalledWith("old/target");

    // rename 回写：sourceRepo 更新为 canonical，resolution 状态保持 resolved
    const renamed = await mappingRow("npm", "pkg-1", "1.0.0");
    expect(renamed?.sourceRepo).toBe(`${PREFIX}930022`);
    expect(renamed?.resolutionStatus).toBe("resolved");

    const [canonRow] = await db.select().from(schema.githubRepoNameCanonicalizations)
      .where(eq(schema.githubRepoNameCanonicalizations.fullName, "old/target"));
    expect(canonRow?.resolutionStatus).toBe("resolved");
    expect(canonRow?.canonicalFullName).toBe(`${PREFIX}930022`);

    // warm rebuild：freshness 未到期 → 零 canonicalization、零 deps.dev 外呼
    const canonicalize2 = vi.fn();
    await recomputeDependencyEdges(db, userId, {
      resolveMapping, canonicalize: canonicalize2, settings, now: () => NOW,
    });
    expect(canonicalize2).not.toHaveBeenCalled();
    expect(resolveMapping).not.toHaveBeenCalled();

    // 归一后两条边连到已采集仓库 930022
    const edges = await db.select().from(schema.repoRelationships).where(and(
      eq(schema.repoRelationships.userId, userId),
      eq(schema.repoRelationships.edgeType, "dependency"),
    ));
    expect(edges.filter((e) => e.evidence.kind === "dependency" && e.evidence.resolvedBy === "deps.dev")).toHaveLength(2);
  });

  it("jobs.progress 只允许 lease owner 写入，丢失租约抛错拒绝提交", async () => {
    const [job] = await db.insert(schema.jobs).values({
      userId,
      type: GRAPH_REBUILD_JOB,
      idempotencyKey: "graph:rebuild",
      payload: { requestedAt: NOW.toISOString() },
      status: "running",
      attempt: 1,
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(NOW.getTime() + 300_000),
      startedAt: NOW,
    }).returning();

    const progress = { stage: "deps_resolution", completed: 1, total: 2 };
    await expect(updateJobProgress(db, job.id, "worker-1", progress, NOW)).resolves.toBe(true);
    await expect(updateJobProgress(db, job.id, "worker-2", progress, NOW)).resolves.toBe(false);

    // 租约过期后同样拒绝
    const later = new Date(NOW.getTime() + 600_000);
    await expect(updateJobProgress(db, job.id, "worker-1", progress, later)).resolves.toBe(false);

    const sink = createJobProgressSink(db, job.id, "worker-2", { now: () => NOW });
    await expect(sink(progress)).rejects.toThrow(GraphLeaseLostError);

    await expect(assertJobLease(db, job.id, "worker-1", NOW)).resolves.toBeUndefined();
    await expect(assertJobLease(db, job.id, "worker-2", NOW)).rejects.toThrow(GraphLeaseLostError);
  });

  it("resolved 复查失败降级：last_resolved_repo 保留证据且不被当作权威映射", async () => {
    await commitAndWatch("930030", [
      { name: "degraded", version: "1.0.0", system: "npm" },
    ]);
    await commitAndWatch("930031", []);
    await db.insert(schema.packageRepoMappings).values({
      system: "npm", packageName: "degraded", packageVersion: "1.0.0",
      sourceRepo: `${PREFIX}930031`, resolutionStatus: "resolved", retryAfter: PAST,
    });

    const resolveMapping = vi.fn(async () => ({
      status: "error" as const,
      sourceRepo: null,
      retryAfterSeconds: null,
      errorSummary: "network_error",
    }));
    await recomputeDependencyEdges(db, userId, {
      resolveMapping, settings, now: () => NOW,
    });

    const row = await mappingRow("npm", "degraded", "1.0.0");
    expect(row?.resolutionStatus).toBe("error");
    expect(row?.sourceRepo).toBeNull();
    expect(row?.lastResolvedRepo).toBe(`${PREFIX}930031`);
    // 降级期间不连边
    const edges = await db.select().from(schema.repoRelationships).where(and(
      eq(schema.repoRelationships.userId, userId),
      eq(schema.repoRelationships.edgeType, "dependency"),
    ));
    expect(edges.filter((e) => e.evidence.resolvedBy === "deps.dev")).toHaveLength(0);
  });

  it("全量 rebuild 后 legacy 与新表技术栈投影 zero-diff，budget 快照进入结果", async () => {
    await commitAndWatch("930040", [
      { name: "react", version: "19.2.6", system: "npm" },
    ]);
    await commitAndWatch("930041", [
      { name: "vue", version: "3.5.0", system: "npm" },
    ]);

    const budget = new ExternalRequestBudget({ ...settings, depsRequestBudget: 10, githubRequestBudget: 10 });
    const result = await rebuildRepoGraph(db, userId, {
      resolveMapping: vi.fn(async () => depsNotFound()),
      settings,
      budget,
      now: () => NOW,
    });

    expect(result.stages).toBeDefined();
    expect(result.stages?.map((s) => s.stage)).toEqual(
      expect.arrayContaining(["embedding", "sbom", "similarity", "deps_resolution"]),
    );
    expect(result.budget?.depsDev.used).toBe(2);

    const comparison = await compareTechnologyStackProjection(db, userId);
    expect(comparison.equal).toBe(true);
  });
});

