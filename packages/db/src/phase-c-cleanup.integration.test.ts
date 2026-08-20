import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { commitRepositoryCollectionSnapshot, type RepositoryCollectionSnapshot } from "./collection";
import { getRepoGraphData } from "./repo-graph";
import { snapshotLegacyTechnologyStackBaseline } from "./baseline-compare";
import {
  validateTechnologyStackCleanup,
  executeTechnologyStackCleanup,
} from "./technology-stack-cleanup";
import { TECHNOLOGY_STACK_SUPPORTED_MODES } from "./technology-stack-entities";

// ============================================================================
// Phase C cleanup：前置校验 gate、执行语义、回滚 rehearsal
// ============================================================================

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "phase-c-cu/";
// 模拟 cleanup revision 的支持集：cleanup 后服务以 legacy_cleaned 重启
const CLEANUP_REVISION_INPUT = {
  mode: "new_only",
  userId: 0,
  supportedModes: ["new_only", "legacy_cleaned"] as const,
};

function snapshot(id: string, fullName: string): RepositoryCollectionSnapshot {
  return {
    repository: {
      githubRepositoryId: id, fullName, name: fullName.split("/")[1], owner: fullName.split("/")[0],
      description: "cleanup fixture", url: `https://github.test/${fullName}`,
      stars: 1, forks: 0, openIssues: 0, language: "TypeScript", license: "MIT",
      readme: "fixture", readmeUrl: null, lastFetchedAt: new Date(),     },
    chunks: [], hackernews: { status: "success", items: [] },
    releases: { status: "success", items: [] },
    sbom: { status: "success", packages: [] },
    allowNewStableIdentity: true,
  };
}

describeIntegration("phase C cleanup operation", () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  let userId: number;

  async function clean() {
    await db.delete(schema.jobs);
    await db.delete(schema.groupMembers);
    await db.delete(schema.repositoryGroups);
    await db.delete(schema.repoRelationships);
    await db.delete(schema.repositoryTechnologyStacks);
    await db.delete(schema.technologyStacks);
    await db.delete(schema.userWatchedRepositories);
    await db.delete(schema.repositories);
    await db.execute(sql`drop table if exists technology_stack_baseline_receipts`);
    await db.execute(sql`drop table if exists technology_stack_cleanup_receipts`);
    // 恢复 is_reference 列（cleanup 会 drop）
    await db.execute(sql`
      alter table repositories add column if not exists is_reference boolean default false not null
    `);
  }

  beforeAll(async () => {
    const [u] = await db.insert(schema.users).values({
      email: "phase-c-cu@test.invalid", name: "cleanup",
    }).returning({ id: schema.users.id });
    userId = u.id;
  });
  beforeEach(clean);
  afterAll(async () => { await clean(); await db.delete(schema.users).where(eq(schema.users.id, userId)); await pool.end(); });
  afterEach(() => vi.unstubAllEnvs());

  /** 造一个“可清理”的完整形态：真实仓库 + 新表事实 + legacy 冻结行 + 基线快照 */
  async function seedCleanable() {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot("970001", `${PREFIX}a/app`));
    await db.insert(schema.userWatchedRepositories).values({
      userId, repoId: committed.repository.id, repoFullName: committed.repository.fullName, enableDailyReport: false,
    });
    const [stack] = await db.insert(schema.technologyStacks).values({
      slug: "react", name: "React", url: "https://react.dev", description: "React 技术栈",
    }).returning();
    await db.insert(schema.repositoryTechnologyStacks).values({
      repositoryId: committed.repository.id, technologyStackId: stack.id,
      packages: [{ system: "npm", name: "react", version: "19.0.0" }],
    });
    const [refRow] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react", name: "React", owner: "tech-stack",
      url: "https://react.dev", embeddingStatus: "completed",
    }).returning();
    await db.insert(schema.userWatchedRepositories).values({
      userId, repoId: refRow.id, repoFullName: "tech-stack/react", enableDailyReport: false,
    });
    await db.insert(schema.repoRelationships).values({
      userId, sourceRepoId: committed.repository.id, targetRepoId: refRow.id,
      edgeType: "dependency", score: null,
      evidence: { kind: "dependency", resolvedBy: "tech-stack-catalog", packages: [{ system: "npm", name: "react", version: "19.0.0" }] },
    });
    await snapshotLegacyTechnologyStackBaseline(db, userId);
    return { committed, refRow };
  }

  it("gate：mode 不是 new_only 时拒绝", async () => {
    await seedCleanable();
    const v = await validateTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, mode: "new_read_dual_write" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("new_only");
  });

  it("gate：revision 支持集不含 legacy_cleaned 时拒绝（死锁防护）", async () => {
    await seedCleanable();
    // 模拟 new_only revision 的支持集——cleanup 会把服务切到 legacy_cleaned，
    // 执行 revision 必须先支持它（implementation review P1-1）；当前 cleanup
    // revision 的编译期默认集含 legacy_cleaned，不受此 gate 拒绝
    const v = await validateTechnologyStackCleanup(db, {
      mode: "new_only", userId, supportedModes: ["new_only"],
    });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("legacy_cleaned");

    // 对照：编译期常量必须含 legacy_cleaned，且默认分支（不传 supportedModes）
    // 通过该 gate——若常量被误改回 new_only-only，此处立即失败（review P3-1）
    expect(TECHNOLOGY_STACK_SUPPORTED_MODES).toContain("legacy_cleaned");
    const v2 = await validateTechnologyStackCleanup(db, { mode: "new_only", userId });
    expect(v2.reasons.join(" ")).not.toContain("legacy_cleaned");
  });

  it("gate：active job 未排空时拒绝", async () => {
    await seedCleanable();
    await db.insert(schema.jobs).values({
      userId, type: "graph.rebuild", idempotencyKey: "k", payload: {}, status: "running",
      leaseOwner: "w", leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const v = await validateTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("active job");
  });

  it("gate：group_members 引用伪仓库时显式拒绝（cascade 拦截）", async () => {
    const { refRow } = await seedCleanable();
    const [group] = await db.insert(schema.repositoryGroups).values({
      userId, name: "g", color: "#fff", orderIndex: 0,
    }).returning();
    await db.insert(schema.groupMembers).values({ groupId: group.id, repoId: refRow.id, orderIndex: 0 });
    const v = await validateTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("group_members");
    await db.delete(schema.groupMembers);
  });

  it("gate：基线 missing（一一映射失败）时拒绝", async () => {
    const { committed } = await seedCleanable();
    await db.delete(schema.repositoryTechnologyStacks).where(
      eq(schema.repositoryTechnologyStacks.repositoryId, committed.repository.id));
    const v = await validateTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/一一映射|单向包含/);
  });

  it("执行：完整 cleanup 后伪数据清零、真实数据保持、列被移除、receipt 落盘", async () => {
    const { committed } = await seedCleanable();
    const result = await executeTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });
    expect(result.validation.ok).toBe(true);
    expect(result.validation.counts.pseudoRepositories).toBe(1);
    expect(result.validation.counts.pseudoWatched).toBe(1);
    expect(result.validation.counts.legacyStackEdges).toBe(1);

    const pseudoLeft = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from repositories where github_repository_id is null and full_name like 'tech-stack/%'`);
    expect(Number(pseudoLeft.rows![0].n)).toBe(0);

    // 列已移除，drizzle 生成列（isReference）不可用——用原 SQL 断言
    const real = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from repositories where id = ${committed.repository.id}
        and github_repository_id is not null`);
    expect(Number(real.rows![0].n)).toBe(1);
    const realWatch = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from user_watched_repositories w join repositories r on r.id = w.repo_id
      where w.repo_id = ${committed.repository.id} and r.github_repository_id is not null`);
    expect(Number(realWatch.rows![0].n)).toBe(1);
    const rts = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from repository_technology_stacks`);
    expect(Number(rts.rows![0].n)).toBe(1);

    const col = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from information_schema.columns
      where table_name='repositories' and column_name='is_reference'`);
    expect(Number(col.rows![0].n)).toBe(0);

    const receipt = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from technology_stack_cleanup_receipts`);
    expect(Number(receipt.rows![0].n)).toBe(1);

    // 无列环境关键路径（RED 固化）：列已不存在时图谱读路径正常工作，
    // stack 节点来自 repository_technology_stacks，reference kind 消失
    const graph = await getRepoGraphData(db, userId);
    expect(graph.nodes.some((n) => n.id === "stack:react")).toBe(true);
    expect(graph.nodes.every((n) => n.kind !== "reference")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "repo")).toBe(true);
  });

  it("补删完成路径：删除事务已提交但列仍在时，重跑只补列删除且不写第二条 receipt", async () => {
    await seedCleanable();
    await executeTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });
    // 模拟 DROP COLUMN 前中断：手工恢复列（数据与 receipt 已提交）
    await db.execute(sql`
      alter table repositories add column if not exists is_reference boolean default false not null
    `);

    const again = await validateTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });
    expect(again.ok).toBe(true);
    expect(again.alreadyCleaned).toBe(true);

    const result = await executeTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });
    expect(result.droppedColumn).toBe(true);
    const receipts = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from technology_stack_cleanup_receipts`);
    expect(Number(receipts.rows![0].n)).toBe(1);
    const col = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from information_schema.columns
      where table_name='repositories' and column_name='is_reference'`);
    expect(Number(col.rows![0].n)).toBe(0);
  });

  it("回滚 rehearsal：备份恢复语义（重建伪形态 + 列）后业务路径可用", async () => {
    const { committed, refRow } = await seedCleanable();
    const beforeEdges = await db.select().from(schema.repoRelationships);

    await executeTechnologyStackCleanup(db, { ...CLEANUP_REVISION_INPUT, userId });

    // 模拟“恢复 cleanup 前备份”：还原列 + 伪形态（真实备份演练在 runbook 维护窗口执行，
    // 这里验证语义可恢复性——同 schema/数据形态可重建）
    await db.execute(sql`alter table repositories add column if not exists is_reference boolean default false not null`);
    const [restored] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react", name: "React", owner: "tech-stack",
      url: "https://react.dev", embeddingStatus: "completed",
    }).onConflictDoNothing().returning({ id: schema.repositories.id });
    await db.insert(schema.userWatchedRepositories).values({
      userId, repoId: restored.id, repoFullName: "tech-stack/react", enableDailyReport: false,
    }).onConflictDoNothing();
    await db.insert(schema.repoRelationships).values(
      beforeEdges.map((e) => ({
        userId: e.userId, sourceRepoId: e.sourceRepoId,
        targetRepoId: e.targetRepoId === refRow.id ? restored.id : e.targetRepoId,
        edgeType: e.edgeType, score: e.score, evidence: e.evidence,
      })),
    ).onConflictDoNothing();

    // 恢复后的业务路径：新表读投影照常工作——伪形态回来了但正向条件不读它，
    // reference kind 不重新出现，真实仓库与 stack 节点完整
    const graph = await getRepoGraphData(db, userId);
    expect(graph.nodes.some((n) => n.fullName === committed.repository.fullName)).toBe(true);
    expect(graph.nodes.some((n) => n.id === "stack:react")).toBe(true);
    expect(graph.nodes.every((n) => n.kind !== "reference")).toBe(true);
    expect(graph.edges.filter((e) => e.target === "stack:react")).toHaveLength(1);
  });
});
