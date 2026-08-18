import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { commitRepositoryCollectionSnapshot, type RepositoryCollectionSnapshot } from "./collection";
import {
  applyRepositoryTechnologyStacksIfCurrent,
  applyTechnologyStackBackfillSource,
  compareTechnologyStackProjection,
  executeTechnologyStackEntitiesBackfill,
  prepareTechnologyStackEntitiesBackfill,
  TechnologyStackBackfillLeaseLostError,
} from "./technology-stack-entities";
import { TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB } from "./jobs";
import { recomputeDependencyEdges } from "./repo-graph";

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "stack-entity-test/";

function snapshot(githubRepositoryId: string, label: string): RepositoryCollectionSnapshot {
  return {
    repository: {
      githubRepositoryId,
      fullName: `${PREFIX}${githubRepositoryId}`,
      name: githubRepositoryId,
      owner: "stack-entity-test",
      description: label,
      url: `https://github.test/${githubRepositoryId}`,
      stars: 1,
      forks: 0,
      openIssues: 0,
      language: "TypeScript",
      license: "MIT",
      readme: label,
      readmeUrl: null,
      lastFetchedAt: new Date(),
      isReference: false,
    },
    chunks: [],
    hackernews: { status: "success", items: [] },
    releases: { status: "success", items: [] },
    sbom: {
      status: "success",
      packages: [{ name: "react", version: label, system: "npm" }],
    },
    allowNewStableIdentity: true,
  };
}

describeIntegration("technology stack facts on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  let userId: number;

  async function clean() {
    await db.delete(schema.jobs);
    await db.delete(schema.repoRelationships);
    await db.delete(schema.userWatchedRepositories);
    await db.delete(schema.repositoryTechnologyStacks);
    await db.delete(schema.technologyStacks);
    await db.delete(schema.repositories);
  }

  beforeAll(async () => {
    await pool.query("select 1");
    const [user] = await db.insert(schema.users).values({
      email: "technology-stack-entities@test.invalid",
      name: "technology stack integration",
    }).returning({ id: schema.users.id });
    userId = user.id;
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await pool.end();
  });

  async function runningBackfillJob(version: string, leaseOwner = "worker-1") {
    const [job] = await db.insert(schema.jobs).values({
      userId,
      type: TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB,
      idempotencyKey: `technology-stack:entities:backfill:${version}`,
      payload: { requestedAt: "2026-08-18T00:00:00.000Z", version },
      status: "running",
      attempt: 1,
      leaseOwner,
      leaseExpiresAt: new Date("2026-08-18T01:00:00.000Z"),
    }).returning();
    return job;
  }

  it("按 source repository 整体替换，success empty 清除旧关系", async () => {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot("920001", "19.0.0"));
    const baseline = committed.repository.sbomPackages;

    await expect(applyRepositoryTechnologyStacksIfCurrent(db, {
      repositoryId: committed.repository.id,
      githubRepositoryId: "920001",
      expectedVersion: committed.version,
      expectedSbomPackages: baseline,
      relations: [{
        slug: "react",
        name: "React",
        url: "https://react.dev",
        description: "React 技术栈",
        packages: [{ system: "npm", name: "react", version: "19.0.0" }],
      }],
    })).resolves.toBe("applied");

    expect(await db.select().from(schema.repositoryTechnologyStacks)
      .where(eq(schema.repositoryTechnologyStacks.repositoryId, committed.repository.id)))
      .toHaveLength(1);

    await expect(applyRepositoryTechnologyStacksIfCurrent(db, {
      repositoryId: committed.repository.id,
      githubRepositoryId: "920001",
      expectedVersion: committed.version,
      expectedSbomPackages: baseline,
      relations: [],
    })).resolves.toBe("applied");
    expect(await db.select().from(schema.repositoryTechnologyStacks)
      .where(eq(schema.repositoryTechnologyStacks.repositoryId, committed.repository.id)))
      .toHaveLength(0);
  });

  it("旧 collection token 与 SBOM baseline 均不能覆盖新事实", async () => {
    const first = await commitRepositoryCollectionSnapshot(db, snapshot("920002", "18.3.1"));
    await applyRepositoryTechnologyStacksIfCurrent(db, {
      repositoryId: first.repository.id,
      githubRepositoryId: "920002",
      expectedVersion: first.version,
      expectedSbomPackages: first.repository.sbomPackages,
      relations: [{
        slug: "react",
        name: "React",
        url: "https://react.dev",
        description: "React 技术栈",
        packages: [{ system: "npm", name: "react", version: "18.3.1" }],
      }],
    });
    await commitRepositoryCollectionSnapshot(db, snapshot("920002", "19.0.0"));

    await expect(applyRepositoryTechnologyStacksIfCurrent(db, {
      repositoryId: first.repository.id,
      githubRepositoryId: "920002",
      expectedVersion: first.version,
      expectedSbomPackages: first.repository.sbomPackages,
      relations: [],
    })).resolves.toBe("stale");

    const rows = await db.select({ packages: schema.repositoryTechnologyStacks.packages })
      .from(schema.repositoryTechnologyStacks)
      .where(eq(schema.repositoryTechnologyStacks.repositoryId, first.repository.id));
    expect(rows[0].packages).toEqual([
      { system: "npm", name: "react", version: "18.3.1" },
    ]);
  });

  it("每个 source 的 relation、checkpoint 与最终 receipt 在租约事务中提交", async () => {
    await commitRepositoryCollectionSnapshot(db, snapshot("920010", "18.3.1"));
    await commitRepositoryCollectionSnapshot(db, snapshot("920011", "19.0.0"));
    const plan = await prepareTechnologyStackEntitiesBackfill(db);
    const job = await runningBackfillJob("v-checkpoint");
    const now = new Date("2026-08-18T00:10:00.000Z");

    await expect(applyTechnologyStackBackfillSource(
      db, job.id, "worker-1", "v-checkpoint", plan, plan.sources[0], () => now,
    )).resolves.toBe("applied");
    await expect(applyTechnologyStackBackfillSource(
      db, job.id, "worker-1", "v-checkpoint", plan, plan.sources[0], () => now,
    )).resolves.toBe("already_applied");

    const [checkpoint] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(checkpoint.status).toBe("running");
    expect(checkpoint.result).toMatchObject({
      outcome: "running",
      processedSources: 1,
      lastGithubRepositoryId: "920010",
    });

    await expect(applyTechnologyStackBackfillSource(
      db, job.id, "worker-1", "v-checkpoint", plan, plan.sources[1], () => now,
    )).resolves.toBe("applied");
    const [completed] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(completed).toMatchObject({
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(completed.result).toMatchObject({
      outcome: "succeeded",
      processedSources: 2,
      totalSources: 2,
    });
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(2);
  });

  it("失去 lease 或 repository snapshot 变旧时不写 relation/checkpoint", async () => {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot("920020", "18.3.1"));
    const plan = await prepareTechnologyStackEntitiesBackfill(db);
    const lostLease = await runningBackfillJob("v-lost-lease", "worker-2");

    await expect(applyTechnologyStackBackfillSource(
      db,
      lostLease.id,
      "worker-1",
      "v-lost-lease",
      plan,
      plan.sources[0],
      () => new Date("2026-08-18T00:10:00.000Z"),
    )).rejects.toBeInstanceOf(TechnologyStackBackfillLeaseLostError);
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(0);

    await db.delete(schema.jobs).where(eq(schema.jobs.id, lostLease.id));
    const staleJob = await runningBackfillJob("v-stale");
    await commitRepositoryCollectionSnapshot(db, snapshot("920020", "19.0.0"));
    await expect(applyTechnologyStackBackfillSource(
      db,
      staleJob.id,
      "worker-1",
      "v-stale",
      plan,
      plan.sources[0],
      () => new Date("2026-08-18T00:10:00.000Z"),
    )).resolves.toBe("stale");
    const [unchangedJob] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, staleJob.id));
    expect(unchangedJob.result).toBeNull();
    expect(await db.select().from(schema.repositoryTechnologyStacks)
      .where(eq(schema.repositoryTechnologyStacks.repositoryId, committed.repository.id)))
      .toHaveLength(0);
  });

  it("repository lock 等待跨过 lease expiry 时旧 Worker 整个事务零写", async () => {
    await commitRepositoryCollectionSnapshot(db, snapshot("920025", "18.3.1"));
    const plan = await prepareTechnologyStackEntitiesBackfill(db);
    const job = await runningBackfillJob("v-lock-expiry");
    const blocker = await pool.connect();
    let released = false;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock($1::integer, hashtext($2))",
        [0x44535643, "920025"],
      );
      const applying = applyTechnologyStackBackfillSource(
        db,
        job.id,
        "worker-1",
        "v-lock-expiry",
        plan,
        plan.sources[0],
        () => new Date(released
          ? "2026-08-18T02:00:00.000Z"
          : "2026-08-18T00:10:00.000Z"),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      released = true;
      await blocker.query("commit");
      await expect(applying).rejects.toBeInstanceOf(TechnologyStackBackfillLeaseLostError);
    } finally {
      if (!released) await blocker.query("rollback");
      blocker.release();
    }
    const [unchanged] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(unchanged.result).toBeNull();
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(0);
  });

  it("多 source 使用前进时钟，后续 lease 过期不会复用首个 source 时刻", async () => {
    await commitRepositoryCollectionSnapshot(db, snapshot("920026", "18.3.1"));
    await commitRepositoryCollectionSnapshot(db, snapshot("920027", "19.0.0"));
    const job = await runningBackfillJob("v-fresh-clock");
    let calls = 0;
    await expect(executeTechnologyStackEntitiesBackfill(
      db,
      job,
      "worker-1",
      () => new Date(calls++ < 2
        ? "2026-08-18T00:10:00.000Z"
        : "2026-08-18T02:00:00.000Z"),
    )).rejects.toBeInstanceOf(TechnologyStackBackfillLeaseLostError);
    const [checkpoint] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(checkpoint.status).toBe("running");
    expect(checkpoint.result).toMatchObject({ processedSources: 1 });
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(1);
  });

  it("SBOM null fallback 在同一 stable-ID lock 后复核 legacy evidence baseline", async () => {
    const source = await commitRepositoryCollectionSnapshot(db, {
      ...snapshot("920028", "18.3.1"),
      sbom: { status: "skipped" },
    });
    const [target] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react",
      name: "React",
      owner: "tech-stack",
      url: "https://react.dev",
      isReference: true,
    }).returning();
    const [edge] = await db.insert(schema.repoRelationships).values({
      userId,
      sourceRepoId: source.repository.id,
      targetRepoId: target.id,
      edgeType: "dependency",
      evidence: {
        kind: "dependency",
        resolvedBy: "tech-stack-catalog",
        packages: [{ system: "npm", name: "react", version: "18.3.1" }],
      },
    }).returning();
    const plan = await prepareTechnologyStackEntitiesBackfill(db);
    const job = await runningBackfillJob("v-legacy-race");
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      await writer.query(
        "select pg_advisory_xact_lock($1::integer, hashtext($2))",
        [0x44535643, "920028"],
      );
      await writer.query(
        "update repo_relationships set evidence = $1::jsonb where id = $2",
        [JSON.stringify({
          kind: "dependency",
          resolvedBy: "tech-stack-catalog",
          packages: [{ system: "npm", name: "react", version: "19.0.0" }],
        }), edge.id],
      );
      const applying = applyTechnologyStackBackfillSource(
        db,
        job.id,
        "worker-1",
        "v-legacy-race",
        plan,
        plan.sources[0],
        () => new Date("2026-08-18T00:10:00.000Z"),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      await writer.query("commit");
      await expect(applying).resolves.toBe("stale");
    } finally {
      writer.release();
    }
    const [unchanged] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(unchanged.result).toBeNull();
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(0);
  });

  it("legacy evidence 原始重复数变化时即使 canonical packages 相同也返回 stale", async () => {
    const source = await commitRepositoryCollectionSnapshot(db, {
      ...snapshot("920029", "18.3.1"),
      sbom: { status: "skipped" },
    });
    const [target] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react",
      name: "React",
      owner: "tech-stack",
      url: "https://react.dev",
      isReference: true,
    }).returning();
    const reactPackage = { system: "npm", name: "react", version: "18.3.1" };
    const [edge] = await db.insert(schema.repoRelationships).values({
      userId,
      sourceRepoId: source.repository.id,
      targetRepoId: target.id,
      edgeType: "dependency",
      evidence: {
        kind: "dependency",
        resolvedBy: "tech-stack-catalog",
        packages: [reactPackage, reactPackage],
      },
    }).returning();
    const plan = await prepareTechnologyStackEntitiesBackfill(db);
    expect(plan.sources[0].evidenceAudit[0].rawPackages).toBe(2);
    const job = await runningBackfillJob("v-legacy-multiplicity");
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      await writer.query(
        "select pg_advisory_xact_lock($1::integer, hashtext($2))",
        [0x44535643, "920029"],
      );
      await writer.query(
        "update repo_relationships set evidence = $1::jsonb where id = $2",
        [JSON.stringify({
          kind: "dependency",
          resolvedBy: "tech-stack-catalog",
          packages: [reactPackage],
        }), edge.id],
      );
      const applying = applyTechnologyStackBackfillSource(
        db,
        job.id,
        "worker-1",
        "v-legacy-multiplicity",
        plan,
        plan.sources[0],
        () => new Date("2026-08-18T00:10:00.000Z"),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      await writer.query("commit");
      await expect(applying).resolves.toBe("stale");
    } finally {
      writer.release();
    }
    const [unchanged] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(unchanged.result).toBeNull();
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(0);
  });

  it("真实 graph rebuild 与 backfill 交错后 new/legacy 只出现同一原子结果", async () => {
    const source = await commitRepositoryCollectionSnapshot(db, {
      ...snapshot("920035", "18.3.1"),
      sbom: { status: "skipped" },
    });
    const [target] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react",
      name: "React",
      owner: "tech-stack",
      url: "https://react.dev",
      isReference: true,
    }).returning();
    await db.insert(schema.userWatchedRepositories).values([
      { userId, repoId: source.repository.id, repoFullName: source.repository.fullName },
      { userId, repoId: target.id, repoFullName: target.fullName },
    ]);
    await db.insert(schema.repoRelationships).values({
      userId,
      sourceRepoId: source.repository.id,
      targetRepoId: target.id,
      edgeType: "dependency",
      evidence: {
        kind: "dependency",
        resolvedBy: "tech-stack-catalog",
        packages: [{ system: "npm", name: "react", version: "18.3.1" }],
      },
    });
    const plan = await prepareTechnologyStackEntitiesBackfill(db);
    const job = await runningBackfillJob("v-graph-interleave");
    let enterAtomicCommit!: () => void;
    let releaseAtomicCommit!: () => void;
    const entered = new Promise<void>((resolve) => { enterAtomicCommit = resolve; });
    const release = new Promise<void>((resolve) => { releaseAtomicCommit = resolve; });
    const rebuilding = recomputeDependencyEdges(db, userId, {
      resolveMapping: async () => null,
      delayMs: 0,
      beforeAtomicCommit: async () => {
        enterAtomicCommit();
        await release;
      },
    });
    await entered;
    expect((await prepareTechnologyStackEntitiesBackfill(db)).digest).toBe(plan.digest);

    await expect(applyTechnologyStackBackfillSource(
      db,
      job.id,
      "worker-1",
      "v-graph-interleave",
      plan,
      plan.sources[0],
      () => new Date("2026-08-18T00:10:00.000Z"),
    )).resolves.toBe("applied");
    releaseAtomicCommit();
    await expect(rebuilding).resolves.toBe(0);

    await expect(compareTechnologyStackProjection(db, userId)).resolves.toMatchObject({
      equal: true,
      legacyCount: 0,
      newCount: 0,
    });
  });

  it("真实 PostgreSQL fixture 中 malformed legacy evidence fail closed", async () => {
    const source = await commitRepositoryCollectionSnapshot(db, {
      ...snapshot("920030", "18.3.1"),
      sbom: { status: "skipped" },
    });
    const [target] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react",
      name: "React",
      owner: "tech-stack",
      url: "https://react.dev",
      isReference: true,
    }).returning();
    await db.insert(schema.repoRelationships).values({
      userId,
      sourceRepoId: source.repository.id,
      targetRepoId: target.id,
      edgeType: "dependency",
      evidence: {
        kind: "dependency",
        resolvedBy: "tech-stack-catalog",
        packages: [{ system: "npm", name: "react", version: "" }],
      },
    });

    await expect(prepareTechnologyStackEntitiesBackfill(db)).rejects.toThrow();
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(0);
  });

  it("shadow projection 按 watched source 比较并报告 package 差异", async () => {
    const source = await commitRepositoryCollectionSnapshot(db, snapshot("920040", "19.0.0"));
    const [target] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react",
      name: "React",
      owner: "tech-stack",
      url: "https://react.dev",
      isReference: true,
    }).returning();
    await db.insert(schema.userWatchedRepositories).values({
      userId,
      repoId: source.repository.id,
      repoFullName: source.repository.fullName,
    });
    await db.insert(schema.repoRelationships).values({
      userId,
      sourceRepoId: source.repository.id,
      targetRepoId: target.id,
      edgeType: "dependency",
      evidence: {
        kind: "dependency",
        resolvedBy: "tech-stack-catalog",
        packages: [{ system: "npm", name: "react", version: "19.0.0" }],
      },
    });
    await applyRepositoryTechnologyStacksIfCurrent(db, {
      repositoryId: source.repository.id,
      githubRepositoryId: "920040",
      expectedVersion: source.version,
      expectedSbomPackages: source.repository.sbomPackages,
      relations: [{
        slug: "react",
        name: "React",
        url: "https://react.dev",
        description: "React 技术栈",
        packages: [{ system: "npm", name: "react", version: "19.0.0" }],
      }],
    });
    await expect(compareTechnologyStackProjection(db, userId)).resolves.toMatchObject({
      equal: true,
      legacyCount: 1,
      newCount: 1,
    });

    await db.update(schema.repositoryTechnologyStacks)
      .set({ packages: [{ system: "npm", name: "react", version: "18.3.1" }] })
      .where(eq(schema.repositoryTechnologyStacks.repositoryId, source.repository.id));
    await expect(compareTechnologyStackProjection(db, userId)).resolves.toMatchObject({
      equal: false,
      legacyCount: 1,
      newCount: 1,
    });
  });

  it("空库 backfill 仍以租约事务生成唯一成功 receipt", async () => {
    const job = await runningBackfillJob("v-empty");
    await expect(executeTechnologyStackEntitiesBackfill(
      db,
      job,
      "worker-1",
      () => new Date("2026-08-18T00:10:00.000Z"),
    )).resolves.toMatchObject({
      outcome: "succeeded",
      totalSources: 0,
      processedSources: 0,
    });
    const [completed] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(completed.status).toBe("succeeded");
  });

  it("空库 terminal update 前 lease 过期时不写成功 receipt", async () => {
    const job = await runningBackfillJob("v-empty-expired");
    let calls = 0;
    await expect(executeTechnologyStackEntitiesBackfill(
      db,
      job,
      "worker-1",
      () => new Date(calls++ === 0
        ? "2026-08-18T00:10:00.000Z"
        : "2026-08-18T02:00:00.000Z"),
    )).rejects.toBeInstanceOf(TechnologyStackBackfillLeaseLostError);
    const [unchanged] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(unchanged.status).toBe("running");
    expect(unchanged.result).toBeNull();
  });
});
