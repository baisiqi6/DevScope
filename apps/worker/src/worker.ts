import {
  claimNextJob,
  completeJob,
  failJob,
  GRAPH_REBUILD_JOB,
  graphRebuildJobPayloadSchema,
  GITHUB_DISCOVERY_JOB,
  GITHUB_TRENDING_SYNC_JOB,
  getRadarInterestProfile,
  githubDiscoveryJobPayloadSchema,
  githubTrendingSyncJobPayloadSchema,
  GitHubCollector,
  HEALTH_ANALYSIS_JOB,
  healthAnalysisJobPayloadSchema,
  recoverExpiredJobs,
  REPOSITORY_IDENTITY_BACKFILL_JOB,
  TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB,
  repositoryIdentityBackfillJobPayloadSchema,
  technologyStackEntitiesBackfillJobPayloadSchema,
  executeRepositoryIdentityBackfill,
  executeTechnologyStackEntitiesBackfill,
  compareTechnologyStackProjection,
  parseTechnologyStackStorageMode,
  rebuildRepoGraph,
  renewJobLease,
  runAgentWorkflow,
  saveGitHubTrendingSnapshot,
  upsertRadarCandidate,
  assertJobLease,
  createJobProgressSink,
  classifyCanonicalizationResponse,
  fetchDepsDevOutcome,
  resolveExternalResolutionSettings,
  GraphRateLimitedError,
  type CanonicalizationOutcome,
  type Db,
  type GitHubSearchRepo,
  type Job,
  type RadarInterestProfile,
  type RebuildRepoGraphResult,
  type ResolveGitHubRepositoryIdentity,
  type UpsertRadarCandidateInput,
} from "@devscope/db";
import { GitHubClient } from "@devscope/shared";
import { fetchGitHubTrending } from "./github-trending";
import { scoreRadarCandidate } from "./radar-score";

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
  rebuildGraph?: (
    db: Db,
    userId: number,
    jobContext?: { jobId?: number; workerId?: string }
  ) => Promise<RebuildRepoGraphResult>;
  fetchTrending?: typeof fetchGitHubTrending;
  saveTrendingSnapshot?: typeof saveGitHubTrendingSnapshot;
  getInterestProfile?: (db: Db, userId: number) => Promise<RadarInterestProfile>;
  workerId?: string;
  resolveRepositoryIdentity?: ResolveGitHubRepositoryIdentity;
  runRepositoryIdentityBackfill?: typeof executeRepositoryIdentityBackfill;
  runTechnologyStackEntitiesBackfill?: typeof executeTechnologyStackEntitiesBackfill;
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
  // 外呼配置在启动时校验：非法值 fail closed，不进入轮询
  resolveExternalResolutionSettings(process.env);
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
      const result = await executeJob(db, job, {
        ...dependencies,
        workerId: options.workerId,
      });
      if (
        job.type !== REPOSITORY_IDENTITY_BACKFILL_JOB
        && job.type !== TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB
      ) {
        await completeJob(db, job.id, options.workerId, result, now());
      }
      console.log(`[Worker] 完成任务 #${job.id} ${job.type}`);
    } catch (error) {
      try {
        // 429 的服务端 Retry-After 必须跨 attempt 生效，避免 60s 后立刻打满配额
        const retryDelayMs = error instanceof GraphRateLimitedError
          ? Math.max(options.retryDelayMs ?? 60_000, error.retryAfterSeconds * 1000)
          : options.retryDelayMs;
        const failed = await failJob(db, job.id, options.workerId, error, {
          retryDelayMs,
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
  const now = dependencies.now ?? (() => new Date());

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
    const result = await rebuildGraph(db, job.userId, {
      jobId: job.id,
      workerId: dependencies.workerId,
    });
    return { ...result };
  }

  if (job.type === GITHUB_TRENDING_SYNC_JOB) {
    const payload = githubTrendingSyncJobPayloadSchema.parse(job.payload);
    const fetchTrending = dependencies.fetchTrending ?? fetchGitHubTrending;
    const saveTrendingSnapshot = dependencies.saveTrendingSnapshot ?? saveGitHubTrendingSnapshot;
    let entries = 0;

    for (const period of payload.periods) {
      const result = await fetchTrending(period, payload.language);
      await saveTrendingSnapshot(db, {
        period,
        language: payload.language,
        snapshotDate: payload.snapshotDate,
        sourceUrl: result.sourceUrl,
        fetchedAt: now(),
        entries: result.entries,
      });
      entries += result.entries.length;
    }

    return {
      source: "github_trending",
      snapshots: payload.periods.length,
      entries,
    };
  }

  if (job.type === REPOSITORY_IDENTITY_BACKFILL_JOB) {
    repositoryIdentityBackfillJobPayloadSchema.parse(job.payload);
    if (!dependencies.workerId) {
      throw new Error("Repository identity backfill 缺少 workerId");
    }
    const runBackfill = dependencies.runRepositoryIdentityBackfill
      ?? executeRepositoryIdentityBackfill;
    const resolveIdentity = dependencies.resolveRepositoryIdentity
      ?? createDefaultRepositoryIdentityResolver();
    return runBackfill(
      db,
      job,
      dependencies.workerId,
      resolveIdentity,
      now(),
    );
  }

  if (job.type === TECHNOLOGY_STACK_ENTITIES_BACKFILL_JOB) {
    technologyStackEntitiesBackfillJobPayloadSchema.parse(job.payload);
    if (!dependencies.workerId) {
      throw new Error("Technology stack entities backfill 缺少 workerId");
    }
    const runBackfill = dependencies.runTechnologyStackEntitiesBackfill
      ?? executeTechnologyStackEntitiesBackfill;
    return runBackfill(db, job, dependencies.workerId, now);
  }

  if (job.type !== GITHUB_DISCOVERY_JOB) {
    throw new Error(`不支持的任务类型: ${job.type}`);
  }

  const payload = githubDiscoveryJobPayloadSchema.parse(job.payload);
  const searchRepositories = dependencies.searchRepositories ?? defaultSearchRepositories;
  const upsertCandidate = dependencies.upsertCandidate ?? upsertRadarCandidate;
  const getInterestProfile = dependencies.getInterestProfile ?? getRadarInterestProfile;
  const interestProfile = await getInterestProfile(db, job.userId);
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

    const observedAt = now();
    const score = scoreRadarCandidate(repository, interestProfile, observedAt);
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
      deterministicScore: score.total,
      scoreBreakdown: score.breakdown,
      evidence: {
        query: payload.query,
        topics: repository.topics,
        createdAt: repository.createdAt.toISOString(),
        updatedAt: repository.updatedAt.toISOString(),
        pushedAt: repository.pushedAt.toISOString(),
        observedAt: observedAt.toISOString(),
        interestProfile: {
          totalRepositories: interestProfile.totalRepositories,
          matchedLanguage: repository.language?.toLowerCase() ?? null,
        },
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

async function defaultRebuildGraph(
  db: Db,
  userId: number,
  jobContext?: { jobId?: number; workerId?: string }
): Promise<RebuildRepoGraphResult> {
  // 非法外呼配置在任务开始时 fail closed，不静默使用默认值
  const settings = resolveExternalResolutionSettings(process.env);
  const github = new GitHubClient(process.env.GITHUB_TOKEN || undefined);
  const progress = jobContext?.jobId && jobContext?.workerId
    ? createJobProgressSink(db, jobContext.jobId, jobContext.workerId)
    : undefined;
  const assertLease = jobContext?.jobId && jobContext?.workerId
    ? (executor?: Parameters<typeof assertJobLease>[0]) =>
      assertJobLease(executor ?? db, jobContext.jobId!, jobContext.workerId!)
    : undefined;

  const result = await rebuildRepoGraph(db, userId, {
    resolveMapping: (system, packageName, packageVersion) =>
      fetchDepsDevOutcome(system, packageName, packageVersion, settings),
    canonicalize: (fullName) =>
      canonicalizeViaGitHub(github, fullName, settings.githubTimeoutMs),
    fetchSbom: (fullName) => github.getSbom(fullName),
    settings,
    progress,
    assertLease,
  });

  if (parseTechnologyStackStorageMode(process.env.TECHNOLOGY_STACK_STORAGE_MODE)
    === "legacy_shadow_dual_write") {
    await progress?.({
      stage: "shadow_compare",
      completed: 0,
      total: 1,
      ...(result.counters ?? {}),
    });
    const shadowStartedAt = Date.now();
    const comparison = await compareTechnologyStackProjection(db, userId);
    if (!comparison.equal) {
      throw new Error(`Technology stack shadow mismatch: ${JSON.stringify(comparison)}`);
    }
    console.log(
      `[Worker] Technology stack shadow 一致: legacy=${comparison.legacyCount}, new=${comparison.newCount}`,
    );
    await progress?.({
      stage: "shadow_compare",
      completed: 1,
      total: 1,
      ...(result.counters ?? {}),
    });
    return {
      ...result,
      stages: [
        ...(result.stages ?? []),
        { stage: "shadow_compare" as const, durationMs: Date.now() - shadowStartedAt },
      ],
    };
  }
  return result;
}

async function canonicalizeViaGitHub(
  github: GitHubClient,
  fullName: string,
  timeoutMs: number
): Promise<CanonicalizationOutcome> {
  const fetched = await github.getCanonicalFullNameDetailed(fullName, timeoutMs);
  if (fetched.kind === "timeout") {
    return { status: "error", canonicalFullName: null, retryAfterSeconds: null, errorSummary: "timeout" };
  }
  if (fetched.kind === "network_error") {
    return { status: "error", canonicalFullName: null, retryAfterSeconds: null, errorSummary: "network_error" };
  }
  return classifyCanonicalizationResponse(
    fetched.httpStatus,
    fetched.body,
    fetched.retryAfterSeconds
  );
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

function createDefaultRepositoryIdentityResolver(): ResolveGitHubRepositoryIdentity {
  const github = new GitHubCollector(process.env.GITHUB_TOKEN);
  return async (fullName) => {
    const [owner, repo] = fullName.split("/");
    try {
      const repository = await github.getRepository(owner, repo);
      return {
        githubRepositoryId: repository.githubRepositoryId,
        fullName: repository.fullName,
      };
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
