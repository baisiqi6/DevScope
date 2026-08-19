import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { commitRepositoryCollectionSnapshot, type RepositoryCollectionSnapshot } from "./collection";
import { recomputeDependencyEdges } from "./repo-graph";
import { snapshotLegacyTechnologyStackBaseline, compareBaselineToCurrent } from "./baseline-compare";

// ============================================================================
// Phase C new_only：冻结基线保持（P0）与单向包含比较
// ============================================================================

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "phase-c-test/";

function snapshot(githubRepositoryId: string, fullName: string, packages: Array<{ name: string; version: string; system: string }>): RepositoryCollectionSnapshot {
  return {
    repository: {
      githubRepositoryId, fullName,
      name: fullName.split("/")[1], owner: fullName.split("/")[0],
      description: "phase c fixture", url: `https://github.test/${fullName}`,
      stars: 1, forks: 0, openIssues: 0, language: "TypeScript", license: "MIT",
      readme: "fixture", readmeUrl: null, lastFetchedAt: new Date(),     },
    chunks: [], hackernews: { status: "success", items: [] },
    releases: { status: "success", items: [] },
    sbom: { status: "success", packages },
    allowNewStableIdentity: true,
  };
}

describeIntegration("phase C new_only frozen baseline", () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  let userId: number;

  async function clean() {
    await db.delete(schema.jobs);
    await db.delete(schema.repoRelationships);
    await db.delete(schema.repositoryTechnologyStacks);
    await db.delete(schema.technologyStacks);
    await db.delete(schema.userWatchedRepositories);
    await db.delete(schema.repositories);
    await db.execute(sql`drop table if exists technology_stack_baseline_receipts`);
  }

  beforeAll(async () => {
    const [u] = await db.insert(schema.users).values({
      email: "phase-c@test.invalid", name: "phase c",
    }).returning({ id: schema.users.id });
    userId = u.id;
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await pool.end();
  });

  async function seedWithLegacyRows() {
    const committed = await commitRepositoryCollectionSnapshot(
      db, snapshot("960001", `${PREFIX}a/app`, [{ name: "react", version: "19.0.0", system: "npm" }]),
    );
    await db.insert(schema.userWatchedRepositories).values({
      userId, repoId: committed.repository.id,
      repoFullName: committed.repository.fullName, enableDailyReport: false,
    });
    // legacy 冻结形态：reference 行 + 伪 watch + legacy 栈边（模拟 Phase B 遗留）
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
    // 新表事实
    const [stack] = await db.insert(schema.technologyStacks).values({
      slug: "react", name: "React", url: "https://react.dev", description: "React 技术栈",
    }).returning();
    await db.insert(schema.repositoryTechnologyStacks).values({
      repositoryId: committed.repository.id, technologyStackId: stack.id,
      packages: [{ system: "npm", name: "react", version: "19.0.0" }],
    });
    return { committed, refRow };
  }

  it("P0：new_only 下 rebuild 后 legacy 栈边/伪 watch/伪 repositories 行数逐项不变", async () => {
    const { refRow } = await seedWithLegacyRows();

    await recomputeDependencyEdges(db, userId, {
      resolveMapping: vi.fn().mockResolvedValue({
        status: "not_found", sourceRepo: null, retryAfterSeconds: null, errorSummary: null,
      }),
      settings: { pacingMs: 0 },
    });

    const edges = await db.select().from(schema.repoRelationships).where(and(
      eq(schema.repoRelationships.userId, userId),
      eq(schema.repoRelationships.edgeType, "dependency"),
    ));
    const legacyEdges = edges.filter((e) =>
      (e.evidence as { resolvedBy?: string })?.resolvedBy === "tech-stack-catalog");
    expect(legacyEdges).toHaveLength(1); // 冻结栈边未被全量替换摧毁

    const refStill = await db.select().from(schema.repositories).where(eq(schema.repositories.id, refRow.id));
    expect(refStill).toHaveLength(1); // GC 未删除 reference 行

    const fakeWatch = await db.select().from(schema.userWatchedRepositories).where(
      eq(schema.userWatchedRepositories.repoId, refRow.id));
    expect(fakeWatch).toHaveLength(1); // GC 未删除伪 watch
  });

  it("快照单向包含：基线 key 全在 new 中时通过；missing 时 fail", async () => {
    const { committed } = await seedWithLegacyRows();
    const receipt = await snapshotLegacyTechnologyStackBaseline(db, userId);
    expect(receipt.baselineKeys).toBe(1);

    // 基线存在（react 在新表）→ 通过
    await expect(compareBaselineToCurrent(db, userId)).resolves.toEqual(
      expect.objectContaining({ equal: true }),
    );

    // 删除新表 relation → missing → fail（合法消失需走裁定更新快照）
    await db.delete(schema.repositoryTechnologyStacks).where(
      eq(schema.repositoryTechnologyStacks.repositoryId, committed.repository.id));
    const result = await compareBaselineToCurrent(db, userId);
    expect(result.equal).toBe(false);
    expect(result.missingInNew.length).toBe(1);
  });

  it("digest 豁免：窗口内重采集（updatedAt 晚于冻结时间）不判漂移", async () => {
    await seedWithLegacyRows();
    await snapshotLegacyTechnologyStackBaseline(db, userId);
    // 模拟重采集更新 relation（updatedAt 变为当前时间，packages 变化）
    await db.execute(sql`update repository_technology_stacks
      set packages = '[{"system":"npm","name":"react","version":"19.1.0"}]'::jsonb,
          updated_at = now() + interval '1 hour'
      where 1=1`);
    await expect(compareBaselineToCurrent(db, userId)).resolves.toEqual(
      expect.objectContaining({ equal: true }),
    );
  });

  it("端到端：基线 missing 时 rebuild 在提交后抛错，冻结形态不被半清理", async () => {
    const { refRow } = await seedWithLegacyRows();
    await snapshotLegacyTechnologyStackBaseline(db, userId);
    // 模拟新表事实在窗口内无法由本轮 detection 恢复（SBOM 也清空）→ 单向包含 missing
    await db.execute(sql`delete from repository_technology_stacks`);
    await db.execute(sql`update repositories set sbom_packages = null`);

    await expect(recomputeDependencyEdges(db, userId, {
      resolveMapping: vi.fn().mockResolvedValue({
        status: "not_found", sourceRepo: null, retryAfterSeconds: null, errorSummary: null,
      }),
      settings: { pacingMs: 0 },
    })).rejects.toThrow(/单向包含失败/);

    // 抛错发生在提交之后，但 legacy 冻结形态（栈边/伪行/伪 watch）全程不被 rebuild 触碰
    const legacyEdges = await db.select().from(schema.repoRelationships).where(and(
      eq(schema.repoRelationships.userId, userId),
      eq(schema.repoRelationships.edgeType, "dependency"),
      sql`${schema.repoRelationships.evidence}->>'resolvedBy' = 'tech-stack-catalog'`,
    ));
    expect(legacyEdges).toHaveLength(1);
    const refStill = await db.select().from(schema.repositories).where(eq(schema.repositories.id, refRow.id));
    expect(refStill).toHaveLength(1);
    const fakeWatch = await db.select().from(schema.userWatchedRepositories).where(
      eq(schema.userWatchedRepositories.repoId, refRow.id));
    expect(fakeWatch).toHaveLength(1);
  });
});
