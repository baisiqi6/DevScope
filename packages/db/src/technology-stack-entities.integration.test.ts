import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { commitRepositoryCollectionSnapshot, type RepositoryCollectionSnapshot } from "./collection";
import { applyRepositoryTechnologyStacksIfCurrent } from "./technology-stack-entities";

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

  it("历史微秒 updated_at 按 canonical 毫秒 collection token 复核", async () => {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot("920003", "18.3.1"));
    await pool.query(
      "update repositories set updated_at = $1::timestamp where id = $2",
      ["2026-08-18 10:04:52.387753", committed.repository.id],
    );

    await expect(applyRepositoryTechnologyStacksIfCurrent(db, {
      repositoryId: committed.repository.id,
      githubRepositoryId: "920003",
      expectedVersion: new Date("2026-08-18T10:04:52.387Z"),
      expectedSbomPackages: committed.repository.sbomPackages,
      relations: [{
        slug: "react",
        name: "React",
        url: "https://react.dev",
        description: "React 技术栈",
        packages: [{ system: "npm", name: "react", version: "18.3.1" }],
      }],
    })).resolves.toBe("applied");
    expect(await db.select().from(schema.repositoryTechnologyStacks)).toHaveLength(1);
  });

});
