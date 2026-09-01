import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "./index";
import {
  hackernewsItems,
  groupMembers,
  repoChunks,
  repoRelationships,
  releases,
  repositories,
  repositoryTechnologyStacks,
  userWatchedRepositories,
} from "./schema";

const REPOSITORY_LIFECYCLE_LOCK_NAMESPACE = "devscope.repository_lifecycle";

export interface RepositoryDeleteImpact {
  repoId: number;
  groupMemberships: number;
  chunks: number;
  releases: number;
  hackernewsItems: number;
  relationships: number;
  technologyStacks: number;
  otherWatchers: number;
}

export interface RepositoryLifecycleResult {
  success: true;
  repoId: number;
  isArchived: boolean;
  repositoryDeleted: boolean;
}

async function countRows(
  db: Pick<Db, "select">,
  table: typeof groupMembers | typeof repoChunks | typeof releases | typeof hackernewsItems | typeof repoRelationships | typeof repositoryTechnologyStacks | typeof userWatchedRepositories,
  condition: SQL<unknown>,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(table)
    .where(condition);
  return Number(row?.count ?? 0);
}

export async function getRepositoryDeleteImpact(
  db: Db,
  userId: number,
  repoId: number,
): Promise<RepositoryDeleteImpact> {
  const [association] = await db
    .select({ id: userWatchedRepositories.id })
    .from(userWatchedRepositories)
    .where(and(
      eq(userWatchedRepositories.userId, userId),
      eq(userWatchedRepositories.repoId, repoId),
    ))
    .limit(1);
  if (!association) throw new Error("仓库不存在或无权访问");

  const [groupMemberships, chunks, releaseRows, hnRows, relationshipRows, technologyStackRows, otherWatchers] = await Promise.all([
    countRows(db, groupMembers, sql`${groupMembers.repoId} = ${repoId} AND ${groupMembers.groupId} IN (SELECT id FROM repository_groups WHERE user_id = ${userId})`),
    countRows(db, repoChunks, eq(repoChunks.repoId, repoId)),
    countRows(db, releases, eq(releases.repoId, repoId)),
    countRows(db, hackernewsItems, eq(hackernewsItems.repoId, repoId)),
    countRows(db, repoRelationships, sql`(${repoRelationships.sourceRepoId} = ${repoId} OR ${repoRelationships.targetRepoId} = ${repoId})`),
    countRows(db, repositoryTechnologyStacks, eq(repositoryTechnologyStacks.repositoryId, repoId)),
    countRows(db, userWatchedRepositories, sql`${userWatchedRepositories.repoId} = ${repoId} AND ${userWatchedRepositories.userId} <> ${userId}`),
  ]);

  return {
    repoId,
    groupMemberships,
    chunks,
    releases: releaseRows,
    hackernewsItems: hnRows,
    relationships: relationshipRows,
    technologyStacks: technologyStackRows,
    otherWatchers,
  };
}

export async function setRepositoryArchived(
  db: Db,
  userId: number,
  repoId: number,
  isArchived: boolean,
): Promise<RepositoryLifecycleResult> {
  const [updated] = await db
    .update(userWatchedRepositories)
    .set({ isArchived, updatedAt: new Date() })
    .where(and(
      eq(userWatchedRepositories.userId, userId),
      eq(userWatchedRepositories.repoId, repoId),
    ))
    .returning({ repoId: userWatchedRepositories.repoId });
  if (!updated) throw new Error("仓库不存在或无权访问");
  return { success: true, repoId, isArchived, repositoryDeleted: false };
}

export async function deleteRepositoryForUser(
  db: Db,
  userId: number,
  repoId: number,
): Promise<RepositoryLifecycleResult> {
  return db.transaction(async (tx) => {
    // Serialize watcher removal for one shared repository. Without a row/advisory
    // lock, two concurrent last-watcher deletes can both observe count=2 and
    // leave an orphan repository after removing their associations.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtext(${REPOSITORY_LIFECYCLE_LOCK_NAMESPACE}),
      ${repoId}::integer
    )`);

    const [association] = await tx
      .select({ id: userWatchedRepositories.id })
      .from(userWatchedRepositories)
      .where(and(
        eq(userWatchedRepositories.userId, userId),
        eq(userWatchedRepositories.repoId, repoId),
      ))
      .limit(1);
    if (!association) throw new Error("仓库不存在或无权访问");

    const [watcherCount] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(userWatchedRepositories)
      .where(eq(userWatchedRepositories.repoId, repoId));
    const otherWatchers = Number(watcherCount?.count ?? 0) - 1;

    await tx.execute(sql`
      DELETE FROM group_members
      WHERE repo_id = ${repoId}
        AND group_id IN (SELECT id FROM repository_groups WHERE user_id = ${userId})
    `);
    await tx
      .delete(userWatchedRepositories)
      .where(and(
        eq(userWatchedRepositories.userId, userId),
        eq(userWatchedRepositories.repoId, repoId),
      ));

    if (otherWatchers > 0) {
      return { success: true, repoId, isArchived: false, repositoryDeleted: false };
    }

    await tx.delete(repoChunks).where(eq(repoChunks.repoId, repoId));
    await tx.delete(hackernewsItems).where(eq(hackernewsItems.repoId, repoId));
    await tx.delete(releases).where(eq(releases.repoId, repoId));
    await tx.delete(repoRelationships).where(orRepo(repoId));
    await tx.delete(repositoryTechnologyStacks).where(eq(repositoryTechnologyStacks.repositoryId, repoId));
    await tx.delete(repositories).where(eq(repositories.id, repoId));
    return { success: true, repoId, isArchived: false, repositoryDeleted: true };
  });
}

function orRepo(repoId: number) {
  return sql`${repoRelationships.sourceRepoId} = ${repoId} OR ${repoRelationships.targetRepoId} = ${repoId}`;
}
