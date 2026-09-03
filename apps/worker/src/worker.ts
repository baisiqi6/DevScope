import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
  EXTERNAL_RESOURCE_CONTENT_JOB,
  externalResourceContentJobPayloadSchema,
  externalResourceContents,
  externalResources,
  externalResourceSaves,
  ingestExternalResource,
  repositoryIdentityBackfillJobPayloadSchema,
  executeRepositoryIdentityBackfill,
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
  ingestExternalResource?: typeof ingestExternalResource;
  contentProcessingStaleMs?: number;
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
      if (job.type !== REPOSITORY_IDENTITY_BACKFILL_JOB) {
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

  if (job.type === EXTERNAL_RESOURCE_CONTENT_JOB) {
    const payload = externalResourceContentJobPayloadSchema.parse(job.payload);
    if (!dependencies.workerId) throw new Error("正文采集任务缺少 workerId");
    const ingest = dependencies.ingestExternalResource ?? ingestExternalResource;
    const resourceResult = await processExternalResourceContent(db, job.userId, job.id, dependencies.workerId, payload.resourceId, ingest, now, dependencies.contentProcessingStaleMs);
    return resourceResult;
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

export async function processExternalResourceContent(
  db: Db,
  userId: number,
  jobId: number,
  workerId: string,
  resourceId: number,
  ingest: typeof ingestExternalResource,
  now: () => Date,
  staleAfterMs = 10 * 60_000,
): Promise<Record<string, unknown>> {
  const claim = await db.transaction(async (tx) => {
    await assertJobLease(tx as unknown as Db, jobId, workerId, now());
    const [resource] = await tx.select({
      id: externalResources.id,
      url: externalResources.url,
      userId: externalResources.userId,
      ingestionMode: externalResources.ingestionMode,
      contentStatus: externalResources.contentStatus,
      contentProcessingJobId: externalResources.contentProcessingJobId,
      contentProcessingStartedAt: externalResources.contentProcessingStartedAt,
    }).from(externalResources).where(eq(externalResources.id, resourceId)).limit(1).for("update");
    if (!resource || resource.userId !== userId) throw new Error("外部资源不存在或无权访问");
    if (resource.ingestionMode !== "content") throw new Error("外部资源未显式启用正文采集");
    const [saved] = await tx.select({ resourceId: externalResourceSaves.resourceId })
      .from(externalResourceSaves)
      .where(and(eq(externalResourceSaves.userId, userId), eq(externalResourceSaves.resourceId, resourceId))).limit(1);
    if (!saved) throw new Error("外部资源未被当前用户收藏");
    if (resource.contentStatus === "completed") return { status: "already_completed" as const };
    const currentTime = now();
    if (resource.contentStatus === "processing" && resource.contentProcessingStartedAt &&
      currentTime.getTime() - resource.contentProcessingStartedAt.getTime() < staleAfterMs) {
      throw new Error("外部资源正文正在由其他任务处理");
    }
    const [claimed] = await tx.update(externalResources)
      .set({ contentStatus: "processing", contentProcessingJobId: jobId, contentProcessingStartedAt: currentTime, contentError: null, updatedAt: currentTime })
      .where(eq(externalResources.id, resourceId)).returning({ id: externalResources.id });
    if (!claimed) throw new Error("外部资源正文 claim 失败");
    return { status: "claimed" as const, url: resource.url };
  });
  if (claim.status === "already_completed") return { status: "already_completed", resourceId };
  const result = await ingest(claim.url);
  if (result.status === "failure") {
    await db.transaction(async (tx) => {
      await assertJobLease(tx as unknown as Db, jobId, workerId, now());
      const [updated] = await tx.update(externalResources).set({ contentStatus: "failed", contentError: `${result.errorKind}: ${result.error}`.slice(0, 1000), contentProcessingJobId: null, contentProcessingStartedAt: null, updatedAt: now() })
        .where(and(eq(externalResources.id, resourceId), eq(externalResources.contentProcessingJobId, jobId), eq(externalResources.contentStatus, "processing"))).returning({ id: externalResources.id });
      if (!updated) throw new Error("正文失败写回时 claim 已失效");
    });
    throw new Error(`正文采集失败（${result.errorKind}）`);
  }
  const contentHash = createHash("sha256").update(result.text).digest("hex");
  await db.transaction(async (tx) => {
    await assertJobLease(tx as unknown as Db, jobId, workerId, now());
    await tx.insert(externalResourceContents).values({
      resourceId,
      userId,
      contentType: result.contentType,
      contentText: result.text,
      byteLength: result.bytes,
      contentHash,
      finalUrl: result.finalUrl,
      fetchedAt: now(),
      parserVersion: "external-resource-ingestion-v1",
    }).onConflictDoUpdate({
      target: externalResourceContents.resourceId,
      set: {
        contentType: result.contentType,
        contentText: result.text,
        byteLength: result.bytes,
        contentHash,
        finalUrl: result.finalUrl,
        fetchedAt: now(),
        parserVersion: "external-resource-ingestion-v1",
        userId,
      },
    });
    await assertJobLease(tx as unknown as Db, jobId, workerId, now());
    const [updated] = await tx.update(externalResources).set({ contentStatus: "completed", contentFetchedAt: now(), contentError: null, contentProcessingJobId: null, contentProcessingStartedAt: null, updatedAt: now() }).where(and(eq(externalResources.id, resourceId), eq(externalResources.contentProcessingJobId, jobId), eq(externalResources.contentStatus, "processing"))).returning({ id: externalResources.id });
    if (!updated) throw new Error("正文成功写回时 claim 已失效");
  });
  return { status: "completed", resourceId, contentType: result.contentType, bytes: result.bytes };
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

  // Phase C：旧 shadow compare 已随 legacy writer 退役；观察窗口由
  // recomputeDependencyEdges 提交后的冻结基线单向包含比较守护（drift 即抛错）。
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
