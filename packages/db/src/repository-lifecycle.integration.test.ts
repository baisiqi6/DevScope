import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, like, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import {
  deleteRepositoryForUser,
  getRepositoryDeleteImpact,
  setRepositoryArchived,
} from "./repository-lifecycle";

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "lifecycle-test/";

describeIntegration("repository lifecycle on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });

  beforeEach(async () => {
    await db.execute(sql`select 1`);
  });

  afterAll(async () => {
    const repos = await db.select({ id: schema.repositories.id })
      .from(schema.repositories)
      .where(like(schema.repositories.fullName, `${PREFIX}%`));
    for (const repo of repos) {
      await db.delete(schema.repoChunks).where(eq(schema.repoChunks.repoId, repo.id));
      await db.delete(schema.hackernewsItems).where(eq(schema.hackernewsItems.repoId, repo.id));
      await db.delete(schema.releases).where(eq(schema.releases.repoId, repo.id));
      await db.delete(schema.repoRelationships).where(
        sql`${schema.repoRelationships.sourceRepoId} = ${repo.id} OR ${schema.repoRelationships.targetRepoId} = ${repo.id}`,
      );
      await db.delete(schema.groupMembers).where(eq(schema.groupMembers.repoId, repo.id));
      await db.delete(schema.userWatchedRepositories).where(eq(schema.userWatchedRepositories.repoId, repo.id));
      await db.delete(schema.repositories).where(eq(schema.repositories.id, repo.id));
    }
    await pool.end();
  });

  it("按用户归档/恢复，并在最后一个 watcher 删除时清理共享事实", async () => {
    const [owner] = await db.insert(schema.users).values({
      email: `${PREFIX}owner@example.test`,
      name: "Lifecycle owner",
    }).returning({ id: schema.users.id });
    const [other] = await db.insert(schema.users).values({
      email: `${PREFIX}other@example.test`,
      name: "Lifecycle other",
    }).returning({ id: schema.users.id });
    const [repo] = await db.insert(schema.repositories).values({
      githubRepositoryId: `${Date.now()}01`,
      fullName: `${PREFIX}shared`,
      name: "shared",
      owner: "lifecycle-test",
      url: "https://github.test/lifecycle/shared",
      license: "MIT",
      licenseStatus: "standard_open_source",
    }).returning({ id: schema.repositories.id });
    await db.insert(schema.userWatchedRepositories).values([
      { userId: owner.id, repoId: repo.id, repoFullName: `${PREFIX}shared` },
      { userId: other.id, repoId: repo.id, repoFullName: `${PREFIX}shared` },
    ]);
    const [group] = await db.insert(schema.repositoryGroups).values({
      userId: owner.id,
      name: `${PREFIX}group`,
    }).returning({ id: schema.repositoryGroups.id });
    await db.insert(schema.groupMembers).values({ groupId: group.id, repoId: repo.id });
    const [stack] = await db.insert(schema.technologyStacks).values({
      slug: `${PREFIX}stack`, name: "Lifecycle Stack", url: "https://example.test/stack",
    }).returning({ id: schema.technologyStacks.id });
    await db.insert(schema.repositoryTechnologyStacks).values({
      repositoryId: repo.id, technologyStackId: stack.id, packages: [],
    });
    await db.insert(schema.repoChunks).values({ repoId: repo.id, content: "chunk", chunkType: "readme", chunkIndex: 0 });
    await db.insert(schema.hackernewsItems).values({ repoId: repo.id, type: "story", title: "hn" });
    await db.insert(schema.releases).values({
      id: BigInt(Date.now()), repoId: repo.id, tagName: "v1", name: "v1",
      author: "test", createdAt: new Date(), url: "https://github.test/release", htmlUrl: "https://github.test/release", assets: [],
    });

    await expect(getRepositoryDeleteImpact(db, owner.id, repo.id)).resolves.toMatchObject({
      groupMemberships: 1,
      chunks: 1,
      releases: 1,
      hackernewsItems: 1,
      technologyStacks: 1,
      otherWatchers: 1,
    });
    await expect(setRepositoryArchived(db, owner.id, repo.id, true)).resolves.toMatchObject({
      repoId: repo.id,
      isArchived: true,
      repositoryDeleted: false,
    });
    await expect(setRepositoryArchived(db, owner.id, repo.id, false)).resolves.toMatchObject({ isArchived: false });

    const deleteResults = await Promise.all([
      deleteRepositoryForUser(db, owner.id, repo.id),
      deleteRepositoryForUser(db, other.id, repo.id),
    ]);
    expect(deleteResults.map((result) => result.repositoryDeleted).sort()).toEqual([false, true]);
    expect(await db.select().from(schema.repositories).where(eq(schema.repositories.id, repo.id))).toHaveLength(0);
  });
});
