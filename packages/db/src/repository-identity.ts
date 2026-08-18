import { normalizeGitHubRepositoryId } from "@devscope/shared";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./index";
import {
  jobs,
  repositories,
  userWatchedRepositories,
  type Job,
} from "./schema";
import {
  repositoryIdentityBackfillJobPayloadSchema,
  repositoryIdentityBackfillJobResultSchema,
} from "./jobs";

export interface RepositoryIdentityBaselineRow {
  id: number;
  fullName: string;
  githubRepositoryId: string | null;
}

export type RepositoryIdentityResolution =
  | {
      repositoryId: number;
      githubRepositoryId: string;
      fullName: string;
      unresolved?: false;
    }
  | {
      repositoryId: number;
      unresolved: true;
    };

export interface RepositoryIdentityUpdate {
  repositoryId: number;
  previousFullName: string;
  fullName: string;
  githubRepositoryId: string;
}

export interface RepositoryIdentityConflict {
  code:
    | "MISSING_RESOLUTION"
    | "DUPLICATE_GITHUB_REPOSITORY_ID"
    | "EXISTING_ID_MISMATCH"
    | "CANONICAL_NAME_OCCUPIED";
  repositoryIds: number[];
  githubRepositoryId?: string;
  fullName?: string;
}

export interface RepositoryIdentityBackfillPlan {
  baseline: RepositoryIdentityBaselineRow[];
  updates: RepositoryIdentityUpdate[];
  unresolved: Array<{ repositoryId: number; fullName: string }>;
  conflicts: RepositoryIdentityConflict[];
}

export interface ResolvedGitHubRepositoryIdentity {
  githubRepositoryId: string;
  fullName: string;
}

export type ResolveGitHubRepositoryIdentity = (
  fullName: string,
) => Promise<ResolvedGitHubRepositoryIdentity | null>;

/**
 * 纯函数：只有全部 GitHub 读取完成后才构建可应用计划。
 * 任一冲突都会清空 updates，确保调用方不会部分写入。
 */
export function buildRepositoryIdentityBackfillPlan(
  rows: RepositoryIdentityBaselineRow[],
  resolutions: RepositoryIdentityResolution[],
): RepositoryIdentityBackfillPlan {
  const resolutionByRepositoryId = new Map(
    resolutions.map((resolution) => [resolution.repositoryId, resolution]),
  );
  const rowByName = new Map(
    rows.map((row) => [row.fullName.toLowerCase(), row]),
  );
  const conflicts: RepositoryIdentityConflict[] = [];
  const unresolved: Array<{ repositoryId: number; fullName: string }> = [];
  const resolved = new Map<number, {
    githubRepositoryId: string;
    fullName: string;
  }>();

  for (const row of rows) {
    const resolution = resolutionByRepositoryId.get(row.id);
    if (!resolution) {
      conflicts.push({ code: "MISSING_RESOLUTION", repositoryIds: [row.id] });
      continue;
    }
    if (resolution.unresolved) {
      unresolved.push({ repositoryId: row.id, fullName: row.fullName });
      continue;
    }
    const githubRepositoryId = normalizeGitHubRepositoryId(
      resolution.githubRepositoryId,
    );
    const fullName = validateGitHubFullName(resolution.fullName);
    resolved.set(row.id, {
      githubRepositoryId,
      fullName,
    });
    if (row.githubRepositoryId) {
      const existingId = normalizeGitHubRepositoryId(row.githubRepositoryId);
      if (existingId !== githubRepositoryId) {
        conflicts.push({
          code: "EXISTING_ID_MISMATCH",
          repositoryIds: [row.id],
          githubRepositoryId,
        });
      }
    }
  }

  const repositoryIdsByGitHubId = new Map<string, number[]>();
  for (const [repositoryId, resolution] of resolved) {
    const repositoryIds = repositoryIdsByGitHubId.get(resolution.githubRepositoryId) ?? [];
    repositoryIds.push(repositoryId);
    repositoryIdsByGitHubId.set(resolution.githubRepositoryId, repositoryIds);
  }
  const duplicateRepositoryIds = new Set<number>();
  for (const [githubRepositoryId, repositoryIds] of repositoryIdsByGitHubId) {
    if (repositoryIds.length > 1) {
      repositoryIds.sort((left, right) => left - right);
      repositoryIds.forEach((id) => duplicateRepositoryIds.add(id));
      conflicts.push({
        code: "DUPLICATE_GITHUB_REPOSITORY_ID",
        repositoryIds,
        githubRepositoryId,
      });
    }
  }

  for (const [repositoryId, resolution] of resolved) {
    if (duplicateRepositoryIds.has(repositoryId)) continue;
    const occupied = rowByName.get(resolution.fullName.toLowerCase());
    if (!occupied || occupied.id === repositoryId) continue;
    const occupiedResolution = resolved.get(occupied.id);
    const occupiedId = occupiedResolution?.githubRepositoryId
      ?? occupied.githubRepositoryId;
    if (occupiedId !== resolution.githubRepositoryId) {
      conflicts.push({
        code: "CANONICAL_NAME_OCCUPIED",
        repositoryIds: [repositoryId, occupied.id].sort((left, right) => left - right),
        githubRepositoryId: resolution.githubRepositoryId,
        fullName: resolution.fullName,
      });
    }
  }

  const updates = conflicts.length > 0
    ? []
    : rows.flatMap((row) => {
        const resolution = resolved.get(row.id);
        if (!resolution) return [];
        if (
          row.githubRepositoryId === resolution.githubRepositoryId
          && row.fullName === resolution.fullName
        ) {
          return [];
        }
        return [{
          repositoryId: row.id,
          previousFullName: row.fullName,
          fullName: resolution.fullName,
          githubRepositoryId: resolution.githubRepositoryId,
        }];
      });

  return { baseline: rows, updates, unresolved, conflicts };
}

/** GitHub 请求全部发生在事务外；返回前不会修改数据库。 */
export async function prepareRepositoryIdentityBackfill(
  db: Db,
  resolveIdentity: ResolveGitHubRepositoryIdentity,
): Promise<RepositoryIdentityBackfillPlan> {
  const rows = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      githubRepositoryId: repositories.githubRepositoryId,
    })
    .from(repositories)
    .where(eq(repositories.isReference, false))
    .orderBy(repositories.id);
  const resolutions: RepositoryIdentityResolution[] = [];

  for (const row of rows) {
    const resolved = await resolveIdentity(row.fullName);
    if (!resolved) {
      resolutions.push({ repositoryId: row.id, unresolved: true });
      continue;
    }
    resolutions.push({
      repositoryId: row.id,
      githubRepositoryId: normalizeGitHubRepositoryId(resolved.githubRepositoryId),
      fullName: resolved.fullName,
    });
  }

  return buildRepositoryIdentityBackfillPlan(rows, resolutions);
}

export class RepositoryIdentityLeaseLostError extends Error {
  constructor(jobId: number) {
    super(`Repository identity backfill job ${jobId} 已失去有效租约`);
    this.name = "RepositoryIdentityLeaseLostError";
  }
}

/**
 * 最终短事务：租约授权、repository mutation、关注冗余名称和 job result 同时提交。
 */
export async function applyRepositoryIdentityBackfill(
  db: Db,
  jobId: number,
  workerId: string,
  plan: RepositoryIdentityBackfillPlan,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.leaseOwner, workerId),
        gt(jobs.leaseExpiresAt, now),
      ))
      .limit(1)
      .for("update");
    if (!job) {
      throw new RepositoryIdentityLeaseLostError(jobId);
    }

    const result = repositoryIdentityBackfillJobResultSchema.parse({
      outcome: plan.conflicts.length > 0 ? "blocked" : "applied",
      updated: plan.conflicts.length > 0 ? [] : plan.updates,
      unresolved: plan.unresolved,
      conflicts: plan.conflicts,
    });

    if (result.outcome === "applied" && plan.baseline.length > 0) {
      const currentRows = await tx
        .select({
          id: repositories.id,
          fullName: repositories.fullName,
          githubRepositoryId: repositories.githubRepositoryId,
        })
        .from(repositories)
        .where(inArray(
          repositories.id,
          plan.baseline.map((row) => row.id),
        ))
        .orderBy(repositories.id)
        .for("update");
      if (!sameRepositoryIdentityBaseline(plan.baseline, currentRows)) {
        throw new Error("Repository identity baseline changed before apply");
      }

      for (const update of plan.updates) {
        await tx
          .update(repositories)
          .set({
            githubRepositoryId: update.githubRepositoryId,
            fullName: update.fullName,
            owner: update.fullName.split("/")[0],
            name: update.fullName.split("/")[1],
            url: `https://github.com/${update.fullName}`,
            updatedAt: now,
          })
          .where(eq(repositories.id, update.repositoryId));
        if (update.fullName !== update.previousFullName) {
          await tx
            .update(userWatchedRepositories)
            .set({ repoFullName: update.fullName, updatedAt: now })
            .where(and(
              eq(userWatchedRepositories.repoId, update.repositoryId),
              eq(userWatchedRepositories.repoFullName, update.previousFullName),
            ));
        }
      }
    }

    const [completed] = await tx
      .update(jobs)
      .set({
        status: "succeeded",
        result,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.leaseOwner, workerId),
      ))
      .returning();
    if (!completed) {
      throw new RepositoryIdentityLeaseLostError(jobId);
    }
    return result;
  });
}

export async function executeRepositoryIdentityBackfill(
  db: Db,
  job: Job,
  workerId: string,
  resolveIdentity: ResolveGitHubRepositoryIdentity,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  repositoryIdentityBackfillJobPayloadSchema.parse(job.payload);
  const plan = await prepareRepositoryIdentityBackfill(db, resolveIdentity);
  return applyRepositoryIdentityBackfill(db, job.id, workerId, plan, now);
}

function sameRepositoryIdentityBaseline(
  expected: RepositoryIdentityBaselineRow[],
  actual: RepositoryIdentityBaselineRow[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((row, index) => {
    const current = actual[index];
    return current?.id === row.id
      && current.fullName === row.fullName
      && current.githubRepositoryId === row.githubRepositoryId;
  });
}

function validateGitHubFullName(fullName: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new TypeError(`Invalid GitHub repository fullName: ${fullName}`);
  }
  return fullName;
}
