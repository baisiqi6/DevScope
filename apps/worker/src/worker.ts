import {
  claimNextJob,
  completeJob,
  failJob,
  GRAPH_REBUILD_JOB,
  graphRebuildJobPayloadSchema,
  GitHubCollector,
  HEALTH_ANALYSIS_JOB,
  healthAnalysisJobPayloadSchema,
  recoverExpiredJobs,
  rebuildRepoGraph,
  renewJobLease,
  runAgentWorkflow,
  upsertRadarCandidate,
  type Db,
  type GitHubSearchRepo,
  type Job,
  type UpsertRadarCandidateInput,
} from "@devscope/db";
import { GitHubClient } from "@devscope/shared";
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
  runHealthAnalysis?: typeof runAgentWorkflow;
  rebuildGraph?: (db: Db, userId: number) => Promise<{
    similarityEdges: number;
    dependencyEdges: number;
    pooledRepos: number;
    sbomBackfilled: number;
  }>;
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
    const stopLeaseHeartbeat = startLeaseHeartbeat(
      db,
      job.id,
      options.workerId,
      leaseDurationMs,
    );

    try {
      const result = await executeJob(db, job, dependencies);
      await completeJob(db, job.id, options.workerId, result, now());
      console.log(`[Worker] 完成任务 #${job.id} ${job.type}`);
    } catch (error) {
      try {
        const failed = await failJob(db, job.id, options.workerId, error, {
          retryDelayMs: options.retryDelayMs,
          now: now(),
        });
        console.error(
          `[Worker] 任务 #${job.id} ${job.type} 失败，状态 ${failed.status}:`,
          error
        );
      } catch (stateError) {
        // 租约可能已被其他 Worker 回收；不能让一次状态竞争终止整个轮询进程。
        console.error(
          `[Worker] 任务 #${job.id} 执行失败且无法写回状态，将等待租约恢复:`,
          stateError,
        );
      }
    } finally {
      stopLeaseHeartbeat();
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
  if (job.type === HEALTH_ANALYSIS_JOB) {
    const payload = healthAnalysisJobPayloadSchema.parse(job.payload);
    const runHealthAnalysis = dependencies.runHealthAnalysis ?? runAgentWorkflow;
    const result = await runHealthAnalysis(
      db,
      job.userId,
      { repos: [payload.repoFullName], analysisType: "health_report" },
      {},
      { executionId: payload.executionId, resumeExecution: true },
    );
    return {
      executionId: result.executionId,
      reportId: result.report.reportId,
    };
  }

  if (job.type === GRAPH_REBUILD_JOB) {
    graphRebuildJobPayloadSchema.parse(job.payload);
    const rebuildGraph = dependencies.rebuildGraph ?? defaultRebuildGraph;
    return rebuildGraph(db, job.userId);
  }

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

function startLeaseHeartbeat(
  db: Db,
  jobId: number,
  workerId: string,
  leaseDurationMs: number,
): () => void {
  const intervalMs = Math.max(1_000, Math.floor(leaseDurationMs / 3));
  const timer = setInterval(() => {
    void renewJobLease(db, jobId, workerId, leaseDurationMs).catch((error) => {
      console.error(`[Worker] 任务 #${jobId} 续租失败:`, error);
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

async function defaultRebuildGraph(db: Db, userId: number) {
  const github = new GitHubClient(process.env.GITHUB_TOKEN || undefined);
  return rebuildRepoGraph(db, userId, {
    canonicalize: (fullName) => github.getCanonicalFullName(fullName),
    fetchSbom: (fullName) => github.getSbom(fullName),
  });
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
