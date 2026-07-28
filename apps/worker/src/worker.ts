import {
  claimNextJob,
  completeJob,
  failJob,
  GitHubCollector,
  recoverExpiredJobs,
  upsertRadarCandidate,
  type Db,
  type GitHubSearchRepo,
  type Job,
  type UpsertRadarCandidateInput,
} from "@devscope/db";
import { z } from "zod";

export const GITHUB_DISCOVERY_JOB = "radar.discover.github";

const githubDiscoveryPayloadSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  sort: z.enum(["stars", "forks", "help-wanted-issues", "updated"]).default("stars"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export interface WorkerOptions {
  workerId: string;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  recoveryIntervalMs?: number;
  retryDelayMs?: number;
}

export interface WorkerDependencies {
  searchRepositories?: (
    query: string,
    options: {
      limit: number;
      sort: "stars" | "forks" | "help-wanted-issues" | "updated";
      order: "asc" | "desc";
    }
  ) => Promise<GitHubSearchRepo[]>;
  upsertCandidate?: (
    db: Db,
    input: UpsertRadarCandidateInput
  ) => Promise<unknown>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

/**
 * 持续轮询任务队列，直到收到退出信号。
 */
export async function runWorker(
  db: Db,
  options: WorkerOptions,
  shouldStop: () => boolean,
  dependencies: WorkerDependencies = {}
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const leaseDurationMs = options.leaseDurationMs ?? 5 * 60_000;
  const recoveryIntervalMs = options.recoveryIntervalMs ?? 60_000;
  const sleep = dependencies.sleep ?? defaultSleep;
  const now = dependencies.now ?? (() => new Date());
  let lastRecoveryAt = 0;

  while (!shouldStop()) {
    const currentTime = now();
    if (currentTime.getTime() - lastRecoveryAt >= recoveryIntervalMs) {
      const recovered = await recoverExpiredJobs(db, currentTime);
      if (recovered > 0) {
        console.warn(`[Worker] 已回收 ${recovered} 个过期租约任务`);
      }
      lastRecoveryAt = currentTime.getTime();
    }

    const job = await claimNextJob(db, {
      workerId: options.workerId,
      leaseDurationMs,
      now: currentTime,
    });

    if (!job) {
      await sleep(pollIntervalMs);
      continue;
    }

    console.log(`[Worker] 开始任务 #${job.id} ${job.type}，第 ${job.attempt} 次尝试`);

    try {
      const result = await executeJob(db, job, dependencies);
      await completeJob(db, job.id, options.workerId, result, now());
      console.log(`[Worker] 完成任务 #${job.id} ${job.type}`);
    } catch (error) {
      const failed = await failJob(db, job.id, options.workerId, error, {
        retryDelayMs: options.retryDelayMs,
        now: now(),
      });
      console.error(
        `[Worker] 任务 #${job.id} ${job.type} 失败，状态 ${failed.status}:`,
        error
      );
    }
  }
}

/**
 * 执行一条已领取任务；所有 payload 都必须先经过 schema 校验。
 */
export async function executeJob(
  db: Db,
  job: Job,
  dependencies: WorkerDependencies = {}
): Promise<Record<string, unknown>> {
  if (job.type !== GITHUB_DISCOVERY_JOB) {
    throw new Error(`不支持的任务类型: ${job.type}`);
  }

  const payload = githubDiscoveryPayloadSchema.parse(job.payload);
  const searchRepositories = dependencies.searchRepositories ?? defaultSearchRepositories;
  const upsertCandidate = dependencies.upsertCandidate ?? upsertRadarCandidate;
  const repositories = await searchRepositories(payload.query, {
    limit: payload.limit,
    sort: payload.sort,
    order: payload.order,
  });
  let upserted = 0;

  for (const repository of repositories) {
    if (!repository.fullName?.includes("/")) {
      continue;
    }

    const observedAt = new Date();
    await upsertCandidate(db, {
      userId: job.userId,
      githubRepoId: repository.githubRepoId,
      fullName: repository.fullName,
      owner: repository.owner,
      name: repository.name,
      description: repository.description,
      language: repository.language,
      stars: repository.stars,
      forks: repository.forks,
      openIssues: repository.openIssues,
      source: "github_search",
      evidence: {
        query: payload.query,
        topics: repository.topics,
        createdAt: repository.createdAt.toISOString(),
        updatedAt: repository.updatedAt.toISOString(),
        pushedAt: repository.pushedAt.toISOString(),
        observedAt: observedAt.toISOString(),
      },
      observedAt,
    });
    upserted += 1;
  }

  return {
    source: "github_search",
    query: payload.query,
    discovered: repositories.length,
    upserted,
  };
}

async function defaultSearchRepositories(
  query: string,
  options: {
    limit: number;
    sort: "stars" | "forks" | "help-wanted-issues" | "updated";
    order: "asc" | "desc";
  }
): Promise<GitHubSearchRepo[]> {
  return new GitHubCollector(process.env.GITHUB_TOKEN).searchRepositories(query, options);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
