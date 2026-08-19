import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import {
  COLLECTION_ADVISORY_LOCK_NAMESPACE,
  claimNextJob,
  enqueueJob,
  renewJobLease,
  recoverExpiredJobs,
  commitRepositoryCollectionSnapshot,
  type RepositoryCollectionSnapshot,
} from "./index";

// ============================================================================
// 并发与租约矩阵：双连接 SKIP LOCKED、续租/回收、receipt 唯一索引、
// 大 ID 往返、rename 复用行、advisory lock 真实重叠证明
// ============================================================================

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "concurrency-test/";

function snapshot(githubRepositoryId: string, fullName: string, releaseIds: string[]): RepositoryCollectionSnapshot {
  return {
    repository: {
      githubRepositoryId,
      fullName,
      name: fullName.split("/")[1],
      owner: fullName.split("/")[0],
      description: "concurrency fixture",
      url: `https://github.test/${fullName}`,
      stars: 1,
      forks: 0,
      openIssues: 0,
      language: "TypeScript",
      license: "MIT",
      readme: "fixture",
      readmeUrl: null,
      lastFetchedAt: new Date(),
          },
    chunks: [],
    hackernews: { status: "success", items: [] },
    releases: {
      status: "success",
      items: releaseIds.map((id, i) => ({
        id,
        tagName: `v${i}`,
        name: `release ${id}`,
        body: null,
        author: "fixture",
        createdAt: new Date(),
        publishedAt: null,
        url: `https://github.test/${fullName}/releases/${id}`,
        htmlUrl: `https://github.test/${fullName}/releases/${id}`,
        isPrerelease: false,
        assets: [],
      })),
    },
    sbom: { status: "success", packages: [] },
    allowNewStableIdentity: true,
  };
}

describeIntegration("concurrency and lease matrix on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString, max: 2 });
  const db = drizzle(pool, { schema });
  let userId: number;

  // 第二个独立连接池：证明真实双连接交错，不用单连接顺序伪装
  const poolB = new pg.Pool({ connectionString, max: 2 });
  const dbB = drizzle(poolB, { schema });

  beforeAll(async () => {
    const [user] = await db.insert(schema.users).values({
      email: "concurrency@test.invalid",
      name: "concurrency",
    }).returning({ id: schema.users.id });
    userId = user.id;
  });
  afterAll(async () => {
    await pool.end();
    await poolB.end();
  });

  beforeEach(async () => {
    await db.delete(schema.jobs);
    await db.delete(schema.releases);
    await db.delete(schema.repoRelationships);
    await db.delete(schema.userWatchedRepositories);
    await db.delete(schema.repositories).where(
      sql`${schema.repositories.fullName} like ${PREFIX + "%"}`,
    );
  });

  it("FOR UPDATE SKIP LOCKED：两个连接并发领取拿到不同 job，绝不重复（结果断言；真实重叠证明见最后一个用例的 pg_locks 观测）", async () => {
    await enqueueJob(db, {
      userId, type: "demo.job.a", idempotencyKey: "a", payload: {},
    });
    await enqueueJob(db, {
      userId, type: "demo.job.b", idempotencyKey: "b", payload: {},
    });

    const [claimedA, claimedB] = await Promise.all([
      claimNextJob(db, { workerId: "worker-a", leaseDurationMs: 60_000 }),
      claimNextJob(dbB, { workerId: "worker-b", leaseDurationMs: 60_000 }),
    ]);

    expect(claimedA).not.toBeNull();
    expect(claimedB).not.toBeNull();
    expect(claimedA!.id).not.toBe(claimedB!.id);
    const owners = new Set([claimedA!.leaseOwner, claimedB!.leaseOwner]);
    expect(owners).toEqual(new Set(["worker-a", "worker-b"]));
    // 队列耗尽后第三次领取返回 null
    expect(await claimNextJob(db, { workerId: "worker-a", leaseDurationMs: 60_000 })).toBeNull();
  });

  it("renewJobLease 只允许当前 owner 续租，过期后 recoverExpiredJobs 重新排队", async () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const job = await enqueueJob(db, {
      userId, type: "demo.renew", idempotencyKey: "r", payload: {},
    });
    // 固定时钟早于 enqueue 的真实 available_at，先把任务放行到过去
    await db.update(schema.jobs)
      .set({ availableAt: new Date(now.getTime() - 60_000) })
      .where(eq(schema.jobs.id, job.id));
    const claimed = await claimNextJob(db, {
      workerId: "w1", leaseDurationMs: 60_000, now,
    });
    expect(claimed!.id).toBe(job.id);

    const renewed = await renewJobLease(db, job.id, "w1", 120_000, now);
    expect(renewed.leaseExpiresAt!.getTime()).toBe(now.getTime() + 120_000);
    await expect(renewJobLease(db, job.id, "intruder", 120_000, now))
      .rejects.toThrow(/不能续租/);

    // 租约过期 → recoverExpiredJobs 回收后其他 worker 可领取
    const later = new Date(now.getTime() + 300_000);
    const recovered = await recoverExpiredJobs(db, later);
    expect(recovered).toBe(1);
    const reclaimed = await claimNextJob(db, {
      workerId: "w2", leaseDurationMs: 60_000, now: later,
    });
    expect(reclaimed!.id).toBe(job.id);
    expect(reclaimed!.attempt).toBe(2);
    expect(reclaimed!.leaseOwner).toBe("w2");
  });

  it("terminal receipt 部分唯一索引阻止第二个 active backfill job（历史 job 类型）", async () => {
    // Phase A backfill 机制已随 new_only revision 退役，但 jobs 表上的部分唯一
    // 索引继续约束历史行与误入队行为，这里用字面量验证约束本身。
    const legacyType = "technology_stack.entities.backfill";
    await enqueueJob(db, {
      userId,
      type: legacyType,
      idempotencyKey: "technology_stack:entities:backfill:v1",
      payload: {},
    });
    await expect(enqueueJob(db, {
      userId,
      type: legacyType,
      idempotencyKey: "technology_stack:entities:backfill:v2",
      payload: {},
    })).rejects.toThrow();
  });

  it("Release ID 超过 int4 上限经采集边界无损往返为十进制字符串", async () => {
    const bigId = "2147483649";
    const committed = await commitRepositoryCollectionSnapshot(
      db, snapshot("940001", `${PREFIX}big/releases`, [bigId]),
    );
    await db.insert(schema.userWatchedRepositories).values({
      userId, repoId: committed.repository.id,
      repoFullName: committed.repository.fullName, enableDailyReport: false,
    });
    const rows = await db
      .select({ id: schema.releases.id })
      .from(schema.releases)
      .where(eq(schema.releases.repoId, committed.repository.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].id.toString()).toBe("2147483649");
    expect(committed.repository.fullName).toBe(`${PREFIX}big/releases`);
  });

  it("repository rename：同 stable ID 的第二次采集复用同一行并更新冗余名称", async () => {
    const first = await commitRepositoryCollectionSnapshot(
      db, snapshot("940002", `${PREFIX}old/name`, []),
    );
    await db.insert(schema.userWatchedRepositories).values({
      userId, repoId: first.repository.id,
      repoFullName: first.repository.fullName, enableDailyReport: false,
    });
    const second = await commitRepositoryCollectionSnapshot(
      db, snapshot("940002", `${PREFIX}new/name`, []),
    );

    expect(second.repository.id).toBe(first.repository.id);
    expect(second.repository.fullName).toBe(`${PREFIX}new/name`);
    const repoRows = await db.select().from(schema.repositories).where(
      eq(schema.repositories.githubRepositoryId, "940002"),
    );
    expect(repoRows).toHaveLength(1);

    const watch = await db.select().from(schema.userWatchedRepositories).where(
      and(
        eq(schema.userWatchedRepositories.userId, userId),
        eq(schema.userWatchedRepositories.repoId, first.repository.id),
      ),
    );
    expect(watch).toHaveLength(1);
    expect(watch[0].repoFullName).toBe(`${PREFIX}new/name`);
  });

  it("advisory lock 真实重叠：采集事务持锁期间第二个采集在锁上等待（pg_locks 证明）", async () => {
    const stableId = "940003";
    const seed = await commitRepositoryCollectionSnapshot(
      db, snapshot(stableId, `${PREFIX}lock/seed`, []),
    );
    await db.insert(schema.userWatchedRepositories).values({
      userId, repoId: seed.repository.id,
      repoFullName: seed.repository.fullName, enableDailyReport: false,
    });

    // 连接 A：开启事务并按 collection.ts 相同方式持有 stable-ID advisory lock
    const clientA = await pool.connect();
    try {
      await clientA.query("begin");
      await clientA.query(
        "select pg_advisory_xact_lock($1::integer, hashtext($2))",
        [COLLECTION_ADVISORY_LOCK_NAMESPACE, stableId],
      );

      // 连接 B（独立池）：发起第二次采集（同 stable ID），应阻塞在锁上
      const secondSnapshot = snapshot(stableId, `${PREFIX}lock/second`, []);
      const pending = commitRepositoryCollectionSnapshot(dbB, secondSnapshot)
        .then((r) => ({ done: true as const, fullName: r.repository.fullName }))
        .catch((error) => ({ done: false as const, error }));

      // 在 pg_locks 中观测到未授予的 advisory 锁（证明两条事务真实重叠）
      let observedWaiting = false;
      let completedWithoutWaiting = false;
      pending.then(() => { completedWithoutWaiting = true; });
      const probe = new pg.Client({ connectionString });
      await probe.connect();
      try {
        for (let i = 0; i < 75; i++) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          if (completedWithoutWaiting) break;
          const locks = await probe.query<{ n: number }>(
            "select count(*)::int as n from pg_locks where not granted and locktype = 'advisory'",
          );
          if (locks.rows[0].n > 0) {
            observedWaiting = true;
            break;
          }
        }
      } finally {
        await probe.end();
      }
      // 若 B 未阻塞即完成，说明重叠证明失败
      expect(completedWithoutWaiting).toBe(false);
      expect(observedWaiting).toBe(true);

      // A 提交释放锁后 B 完成
      await clientA.query("commit");
      const outcome = await pending;
      expect(outcome.done).toBe(true);
      if (outcome.done) {
        expect(outcome.fullName).toBe(`${PREFIX}lock/second`);
      }
    } finally {
      await clientA.query("rollback").catch(() => undefined);
      clientA.release();
    }
  });
});
