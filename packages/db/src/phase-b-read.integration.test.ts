import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { commitRepositoryCollectionSnapshot, type RepositoryCollectionSnapshot } from "./collection";
import { getRepoGraphData } from "./repo-graph";

// ============================================================================
// Phase B：new_read_dual_write 读投影的真实 PostgreSQL 集成用例
// 重点：两用户 watched set 隔离（租户边界）、正向条件、legacy 栈边排除、
// 同 stack 多 relation 去重、mode 分流。
// ============================================================================

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "phase-b-test/";

function snapshot(githubRepositoryId: string, fullName: string, packages: Array<{ name: string; version: string; system: string }>): RepositoryCollectionSnapshot {
  return {
    repository: {
      githubRepositoryId,
      fullName,
      name: fullName.split("/")[1],
      owner: fullName.split("/")[0],
      description: "phase b fixture",
      url: `https://github.test/${fullName}`,
      stars: 1,
      forks: 0,
      openIssues: 0,
      language: "TypeScript",
      license: "MIT",
      readme: "fixture",
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

describeIntegration("phase B new read projection on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  let userA: number;
  let userB: number;

  async function commitAndWatch(userId: number, id: string, fullName: string, packages: Array<{ name: string; version: string; system: string }>) {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot(id, fullName, packages));
    await db.insert(schema.userWatchedRepositories).values({
      userId,
      repoId: committed.repository.id,
      repoFullName: committed.repository.fullName,
      enableDailyReport: false,
    });
    return committed;
  }

  async function clean() {
    await db.delete(schema.repoRelationships);
    await db.delete(schema.repositoryTechnologyStacks);
    await db.delete(schema.technologyStacks);
    await db.delete(schema.userWatchedRepositories);
    await db.delete(schema.repositories);
  }

  beforeAll(async () => {
    const [a] = await db.insert(schema.users).values({
      email: "phase-b-a@test.invalid", name: "phase b a",
    }).returning({ id: schema.users.id });
    const [b] = await db.insert(schema.users).values({
      email: "phase-b-b@test.invalid", name: "phase b b",
    }).returning({ id: schema.users.id });
    userA = a.id;
    userB = b.id;
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await db.delete(schema.users).where(eq(schema.users.id, userA));
    await db.delete(schema.users).where(eq(schema.users.id, userB));
    await pool.end();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("两用户 disjoint watched set：各自图只含自己的 source 与其 stack 边", async () => {
    await commitAndWatch(userA, "950001", `${PREFIX}a/app`, [
      { name: "react", version: "19.0.0", system: "npm" },
    ]);
    await commitAndWatch(userB, "950002", `${PREFIX}b/lib`, [
      { name: "vue", version: "3.5.0", system: "npm" },
    ]);
    // 写入双方的 stack 事实（经 graph rebuild 事务路径以外直接造新表数据）
    const [repoA] = await db.select().from(schema.repositories).where(eq(schema.repositories.githubRepositoryId, "950001"));
    const [repoB] = await db.select().from(schema.repositories).where(eq(schema.repositories.githubRepositoryId, "950002"));
    const [reactStack] = await db.insert(schema.technologyStacks).values({
      slug: "react", name: "React", url: "https://react.dev", description: "React 技术栈",
    }).returning();
    const [vueStack] = await db.insert(schema.technologyStacks).values({
      slug: "vue", name: "Vue", url: "https://vuejs.org", description: "Vue 技术栈",
    }).returning();
    await db.insert(schema.repositoryTechnologyStacks).values([
      { repositoryId: repoA.id, technologyStackId: reactStack.id, packages: [{ system: "npm", name: "react", version: "19.0.0" }] },
      { repositoryId: repoB.id, technologyStackId: vueStack.id, packages: [{ system: "npm", name: "vue", version: "3.5.0" }] },
    ]);

    vi.stubEnv("TECHNOLOGY_STACK_STORAGE_MODE", "new_read_dual_write");
    const graphA = await getRepoGraphData(db, userA);
    const graphB = await getRepoGraphData(db, userB);

    const aRepos = graphA.nodes.filter((n) => n.kind === "repo");
    expect(aRepos).toHaveLength(1);
    expect(aRepos[0].fullName).toBe(`${PREFIX}a/app`);
    expect(graphA.nodes.filter((n) => n.id === "stack:react")).toHaveLength(1);
    expect(graphA.nodes.filter((n) => n.id === "stack:vue")).toHaveLength(0);
    expect(graphA.edges.filter((e) => e.target === "stack:react")).toHaveLength(1);

    expect(graphB.nodes.filter((n) => n.kind === "repo")[0].fullName).toBe(`${PREFIX}b/lib`);
    expect(graphB.nodes.filter((n) => n.id === "stack:vue")).toHaveLength(1);
    expect(graphB.nodes.filter((n) => n.id === "stack:react")).toHaveLength(0);
  });

  it("两用户 overlap 同一 stack：节点共享语义、边各归各的 source", async () => {
    await commitAndWatch(userA, "950003", `${PREFIX}a/shared1`, [
      { name: "react", version: "19.0.0", system: "npm" },
    ]);
    await commitAndWatch(userB, "950004", `${PREFIX}b/shared2`, [
      { name: "react", version: "18.0.0", system: "npm" },
    ]);
    const [repoA] = await db.select().from(schema.repositories).where(eq(schema.repositories.githubRepositoryId, "950003"));
    const [repoB] = await db.select().from(schema.repositories).where(eq(schema.repositories.githubRepositoryId, "950004"));
    const [reactStack] = await db.insert(schema.technologyStacks).values({
      slug: "react", name: "React", url: "https://react.dev", description: "React 技术栈",
    }).returning();
    await db.insert(schema.repositoryTechnologyStacks).values([
      { repositoryId: repoA.id, technologyStackId: reactStack.id, packages: [{ system: "npm", name: "react", version: "19.0.0" }] },
      { repositoryId: repoB.id, technologyStackId: reactStack.id, packages: [{ system: "npm", name: "react", version: "18.0.0" }] },
    ]);

    vi.stubEnv("TECHNOLOGY_STACK_STORAGE_MODE", "new_read_dual_write");
    const graphA = await getRepoGraphData(db, userA);
    const graphB = await getRepoGraphData(db, userB);

    // 同一 stack 节点在两用户图中语义一致（全局事实），但边只来自各自 watched source
    for (const graph of [graphA, graphB]) {
      expect(graph.nodes.filter((n) => n.id === "stack:react")).toHaveLength(1);
      expect(graph.edges.filter((e) => e.target === "stack:react")).toHaveLength(1);
    }
    expect(graphA.edges[0].source).toBe(String(repoA.id));
    expect(graphB.edges[0].source).toBe(String(repoB.id));
  });

  it("正向条件：无 stable ID 的 reference 行即使带伪 watch 也不进入新读", async () => {
    const [fake] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/legacy", name: "legacy", owner: "tech-stack",
      url: "https://legacy.test", isReference: true, embeddingStatus: "completed",
    }).returning();
    await db.insert(schema.userWatchedRepositories).values({
      userId: userA, repoId: fake.id, repoFullName: "tech-stack/legacy", enableDailyReport: false,
    });
    // 一个真实仓库做对照
    await commitAndWatch(userA, "950005", `${PREFIX}a/real`, []);

    vi.stubEnv("TECHNOLOGY_STACK_STORAGE_MODE", "new_read_dual_write");
    const graph = await getRepoGraphData(db, userA);
    const repoNodes = graph.nodes.filter((n) => n.kind === "repo");
    expect(repoNodes).toHaveLength(1);
    expect(repoNodes[0].fullName).toBe(`${PREFIX}a/real`);
    expect(graph.nodes.some((n) => n.fullName === "tech-stack/legacy")).toBe(false);
  });

  it("legacy 栈边被排除：resolvedBy=tech-stack-catalog 的边不产生悬空边", async () => {
    const committed = await commitAndWatch(userA, "950006", `${PREFIX}a/edges`, []);
    const [fakeStackRow] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/vite", name: "Vite", owner: "tech-stack",
      url: "https://vite.test", isReference: true, embeddingStatus: "completed",
    }).returning();
    await db.insert(schema.repoRelationships).values([
      {
        userId: userA, sourceRepoId: committed.repository.id, targetRepoId: fakeStackRow.id,
        edgeType: "dependency", score: null,
        evidence: { kind: "dependency", resolvedBy: "tech-stack-catalog", packages: [] },
      },
    ]);

    vi.stubEnv("TECHNOLOGY_STACK_STORAGE_MODE", "new_read_dual_write");
    const graph = await getRepoGraphData(db, userA);
    expect(graph.nodes.some((n) => n.id === String(fakeStackRow.id))).toBe(false);
    expect(graph.edges.filter((e) => e.target === String(fakeStackRow.id))).toHaveLength(0);
    expect(graph.nodes.filter((n) => n.kind === "technology_stack")).toHaveLength(0);
  });

  it("同 stack 多 package evidence 落在同一 relation 行：只产出一条 repo→stack 边", async () => {
    const committed = await commitAndWatch(userA, "950007", `${PREFIX}a/dup`, []);
    const [reactStack] = await db.insert(schema.technologyStacks).values({
      slug: "react", name: "React", url: "https://react.dev", description: "React 技术栈",
    }).returning();
    // (repository_id, technology_stack_id) 唯一约束保证一行聚合多 package evidence
    await db.insert(schema.repositoryTechnologyStacks).values({
      repositoryId: committed.repository.id, technologyStackId: reactStack.id,
      packages: [
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react-dom", version: "19.0.0" },
      ],
    });
    // 唯一约束阻止第二行（去重由 schema 保证，读路径去重为防御层）
    await expect(db.insert(schema.repositoryTechnologyStacks).values({
      repositoryId: committed.repository.id, technologyStackId: reactStack.id,
      packages: [{ system: "npm", name: "react", version: "18.0.0" }],
    })).rejects.toThrow();

    vi.stubEnv("TECHNOLOGY_STACK_STORAGE_MODE", "new_read_dual_write");
    const graph = await getRepoGraphData(db, userA);
    expect(graph.edges.filter((e) => e.target === "stack:react")).toHaveLength(1);
  });

  it("legacy mode（默认）不读新表：reference 投影保留、stack 节点不出现", async () => {
    const committed = await commitAndWatch(userA, "950008", `${PREFIX}a/legacymode`, []);
    const [reactStack] = await db.insert(schema.technologyStacks).values({
      slug: "react", name: "React", url: "https://react.dev", description: "React 技术栈",
    }).returning();
    await db.insert(schema.repositoryTechnologyStacks).values({
      repositoryId: committed.repository.id, technologyStackId: reactStack.id, packages: [],
    });
    const [fakeStackRow] = await db.insert(schema.repositories).values({
      fullName: "tech-stack/react", name: "React", owner: "tech-stack",
      url: "https://react.test", isReference: true, embeddingStatus: "completed",
    }).returning();
    await db.insert(schema.userWatchedRepositories).values({
      userId: userA, repoId: fakeStackRow.id, repoFullName: "tech-stack/react", enableDailyReport: false,
    });

    // 未设 mode → 默认 legacy_shadow_dual_write
    const graph = await getRepoGraphData(db, userA);
    expect(graph.nodes.some((n) => n.kind === "technology_stack")).toBe(false);
    expect(graph.nodes.some((n) => n.kind === "reference")).toBe(true);
  });
});
