/**
 * 持久任务队列操作。
 *
 * PostgreSQL 同时承担任务存储和并发租约，不引入额外队列服务。
 */

import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type { Db } from "./index";
import { jobs, type Job } from "./schema";

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
