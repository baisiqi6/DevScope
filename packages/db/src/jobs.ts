/**
 * 持久任务队列操作。
 *
 * PostgreSQL 同时承担任务存储和并发租约，不引入额外队列服务。
 */

import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./index";
import { jobs, type Job } from "./schema";

export const HEALTH_ANALYSIS_JOB = "analysis.health";
export const GRAPH_REBUILD_JOB = "graph.rebuild";
export const GITHUB_DISCOVERY_JOB = "radar.discover.github";
export const GITHUB_TRENDING_SYNC_JOB = "trending.sync.github";

export const healthAnalysisJobPayloadSchema = z.object({
  executionId: z.string().uuid(),
  repoFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
});

export const graphRebuildJobPayloadSchema = z.object({
  requestedAt: z.string().datetime(),
});

export const githubTrendingSyncJobPayloadSchema = z.object({
  requestedAt: z.string().datetime(),
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  language: z.string().regex(/^(all|[a-z0-9+.#-]+)$/).default("all"),
  periods: z.array(z.enum(["daily", "weekly", "monthly"]))
    .min(1)
    .default(["daily", "weekly", "monthly"]),
});

export const githubTrendingSyncJobResultSchema = z.object({
  source: z.literal("github_trending"),
  snapshots: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
});

export const githubDiscoveryJobPayloadSchema = z.object({
  requestedAt: z.string().datetime().optional(),
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  sort: z.enum(["stars", "forks", "help-wanted-issues", "updated"]).default("stars"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const githubDiscoveryJobResultSchema = z.object({
  source: z.literal("github_search"),
  query: z.string(),
  discovered: z.number().int().nonnegative(),
  upserted: z.number().int().nonnegative(),
});

export function createGithubDiscoveryJobPayload(requestedAt: Date) {
  const createdSince = new Date(requestedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return githubDiscoveryJobPayloadSchema.parse({
    requestedAt: requestedAt.toISOString(),
    query: `created:>=${createdSince} stars:>=10 archived:false fork:false`,
    limit: 20,
    sort: "stars",
    order: "desc",
  });
}

export function healthAnalysisJobKey(repoFullName: string): string {
  return `analysis:health:${repoFullName.toLowerCase()}`;
}

export const GRAPH_REBUILD_JOB_KEY = "graph:rebuild";
export const GITHUB_DISCOVERY_JOB_KEY = "radar:github:new:7d";
export const GITHUB_TRENDING_SYNC_JOB_KEY = "trending:github:all";

type JobStore = Pick<Db, "insert" | "update" | "select">;

export interface EnqueueJobInput {
  userId: number;
  type: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface ClaimJobOptions {
  workerId: string;
  leaseDurationMs?: number;
  now?: Date;
}

export interface FailJobOptions {
  retryDelayMs?: number;
  now?: Date;
}

export interface EnqueueRestartableJobResult {
  job: Job;
  /** true 表示本次创建或把终态任务重新排队；false 表示已有活跃任务 */
  enqueued: boolean;
}

/**
 * 使用 `(userId, idempotencyKey)` 保证重复调度只产生一条任务。
 */
export async function enqueueJob(db: Db, input: EnqueueJobInput): Promise<Job> {
  const [created] = await db
    .insert(jobs)
    .values({
      userId: input.userId,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 3,
      availableAt: input.availableAt ?? new Date(),
    })
    .onConflictDoNothing({
      target: [jobs.userId, jobs.idempotencyKey],
    })
    .returning();

  if (created) {
    return created;
  }

  const [existing] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, input.userId),
        eq(jobs.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (!existing) {
    throw new Error("幂等任务已存在但无法读取");
  }

  return existing;
}

/**
 * 为同一资源只保留一个活跃任务；已有终态任务时复用该行并重新排队。
 * 适用于用户可重复触发、但同一时刻只能执行一次的长任务。
 */
export async function enqueueRestartableJob(
  db: JobStore,
  input: EnqueueJobInput
): Promise<EnqueueRestartableJobResult> {
  const now = new Date();
  const values = {
    userId: input.userId,
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload ?? {},
    priority: input.priority ?? 0,
    maxAttempts: input.maxAttempts ?? 3,
    availableAt: input.availableAt ?? now,
  };
  const [created] = await db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: [jobs.userId, jobs.idempotencyKey] })
    .returning();

  if (created) {
    return { job: created, enqueued: true };
  }

  const [restarted] = await db
    .update(jobs)
    .set({
      ...values,
      status: "queued",
      attempt: 0,
      result: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.userId, input.userId),
        eq(jobs.idempotencyKey, input.idempotencyKey),
        inArray(jobs.status, ["succeeded", "dead", "cancelled"])
      )
    )
    .returning();

  if (restarted) {
    return { job: restarted, enqueued: true };
  }

  const [existing] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, input.userId),
        eq(jobs.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (!existing) {
    throw new Error("幂等任务冲突后无法读取");
  }

  return { job: existing, enqueued: false };
}

export async function getJobByIdempotencyKey(
  db: JobStore,
  userId: number,
  idempotencyKey: string
): Promise<Job | null> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);

  return job ?? null;
}

/**
 * 领取下一条可执行任务。
 *
 * `FOR UPDATE SKIP LOCKED` 允许多个 Worker 并发轮询而不重复领取。
 */
export async function claimNextJob(
  db: Db,
  options: ClaimJobOptions
): Promise<Job | null> {
  const now = options.now ?? new Date();
  const leaseDurationMs = options.leaseDurationMs ?? 5 * 60 * 1000;
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, ["queued", "retry_wait"]),
          lte(jobs.availableAt, now),
          lt(jobs.attempt, jobs.maxAttempts)
        )
      )
      .orderBy(desc(jobs.priority), asc(jobs.availableAt), asc(jobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate) {
      return null;
    }

    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "running",
        attempt: candidate.attempt + 1,
        leaseOwner: options.workerId,
        leaseExpiresAt,
        startedAt: candidate.startedAt ?? now,
        updatedAt: now,
      })
      .where(eq(jobs.id, candidate.id))
      .returning();

    return claimed ?? null;
  });
}

/**
 * 将当前 Worker 持有的任务标记为成功。
 */
export async function completeJob(
  db: Db,
  jobId: number,
  workerId: string,
  result: Record<string, unknown> = {},
  now: Date = new Date()
): Promise<Job> {
  const [completed] = await db
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
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.leaseOwner, workerId)
      )
    )
    .returning();

  if (!completed) {
    throw new Error(`任务 ${jobId} 已失去租约，不能标记成功`);
  }

  return completed;
}

/** 为仍由当前 Worker 持有的运行中任务延长租约。 */
export async function renewJobLease(
  db: Db,
  jobId: number,
  workerId: string,
  leaseDurationMs: number,
  now: Date = new Date()
): Promise<Job> {
  const [renewed] = await db
    .update(jobs)
    .set({
      leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.leaseOwner, workerId)
      )
    )
    .returning();

  if (!renewed) {
    throw new Error(`任务 ${jobId} 已失去租约，不能续租`);
  }

  return renewed;
}

/**
 * 记录失败并根据 attempt 决定等待重试或进入 dead。
 */
export async function failJob(
  db: Db,
  jobId: number,
  workerId: string,
  error: unknown,
  options: FailJobOptions = {}
): Promise<Job> {
  const now = options.now ?? new Date();
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const message = error instanceof Error ? error.message : String(error);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.status, "running"),
          eq(jobs.leaseOwner, workerId)
        )
      )
      .limit(1)
      .for("update");

    if (!current) {
      throw new Error(`任务 ${jobId} 已失去租约，不能记录失败`);
    }

    const isDead = current.attempt >= current.maxAttempts;
    const [failed] = await tx
      .update(jobs)
      .set({
        status: isDead ? "dead" : "retry_wait",
        availableAt: isDead
          ? current.availableAt
          : new Date(now.getTime() + retryDelayMs),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: message,
        completedAt: isDead ? now : null,
        updatedAt: now,
      })
      .where(eq(jobs.id, current.id))
      .returning();

    if (!failed) {
      throw new Error(`任务 ${jobId} 失败状态未能保存`);
    }

    return failed;
  });
}

/**
 * 回收因 Worker 退出而过期的租约。
 */
export async function recoverExpiredJobs(
  db: Db,
  now: Date = new Date()
): Promise<number> {
  const retryable = await db
    .update(jobs)
    .set({
      status: "retry_wait",
      availableAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: "Worker 租约过期，任务已重新排队",
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.status, "running"),
        lte(jobs.leaseExpiresAt, now),
        lt(jobs.attempt, jobs.maxAttempts)
      )
    )
    .returning({ id: jobs.id });

  const exhausted = await db
    .update(jobs)
    .set({
      status: "dead",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: "Worker 租约过期且已达到最大尝试次数",
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.status, "running"),
        lte(jobs.leaseExpiresAt, now),
        gte(jobs.attempt, jobs.maxAttempts)
      )
    )
    .returning({ id: jobs.id });

  return retryable.length + exhausted.length;
}
