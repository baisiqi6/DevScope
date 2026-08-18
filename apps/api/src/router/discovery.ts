import { z } from "zod";
import {
  createGithubDiscoveryJobPayload,
  enqueueRestartableJob,
  getJobByIdempotencyKey,
  getLatestGitHubTrendingSnapshot,
  GITHUB_DISCOVERY_JOB,
  GITHUB_DISCOVERY_JOB_KEY,
  GITHUB_TRENDING_SYNC_JOB,
  GITHUB_TRENDING_SYNC_JOB_KEY,
  githubDiscoveryJobPayloadSchema,
  githubDiscoveryJobResultSchema,
  githubTrendingSyncJobPayloadSchema,
  githubTrendingSyncJobResultSchema,
  listRadarCandidates,
} from "@devscope/db";
import { router, publicProcedure } from "../trpc";
import { getOrCreateCurrentUserId } from "../current-user";

const periodSchema = z.enum(["daily", "weekly", "monthly"]);

const trendingSyncStatusSchema = z.object({
  status: z.enum(["idle", "running", "completed", "failed"]),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  result: githubTrendingSyncJobResultSchema.nullable(),
  error: z.string().nullable(),
});

const radarSyncStatusSchema = z.object({
  status: z.enum(["idle", "running", "completed", "failed"]),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  result: githubDiscoveryJobResultSchema.nullable(),
  error: z.string().nullable(),
});

export const discoveryRouter = router({
  getTrending: publicProcedure
    .input(z.object({
      period: periodSchema.default("daily"),
      language: z.string().regex(/^(all|[a-z0-9+.#-]+)$/).default("all"),
    }).default({}))
    .query(async ({ ctx, input }) => {
      const result = await getLatestGitHubTrendingSnapshot(
        ctx.db,
        input.period,
        input.language,
      );
      if (!result) return null;

      return {
        period: result.snapshot.period,
        language: result.snapshot.language,
        snapshotDate: result.snapshot.snapshotDate,
        sourceUrl: result.snapshot.sourceUrl,
        fetchedAt: result.snapshot.fetchedAt.toISOString(),
        entries: result.entries.map((entry) => ({
          rank: entry.rank,
          fullName: entry.fullName,
          url: entry.url,
          description: entry.description,
          language: entry.language,
          stars: entry.stars,
          forks: entry.forks,
          starsInPeriod: entry.starsInPeriod,
        })),
      };
    }),

  getRadar: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).default({}))
    .query(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const candidates = await listRadarCandidates(ctx.db, userId, input.limit);
      return candidates.map((candidate) => ({
        id: candidate.id,
        fullName: candidate.fullName,
        url: candidate.url,
        description: candidate.description,
        language: candidate.language,
        stars: candidate.stars,
        forks: candidate.forks,
        status: candidate.status,
        source: candidate.source,
        score: candidate.deterministicScore,
        scoreBreakdown: candidate.scoreBreakdown,
        evidence: candidate.evidence,
        firstSeenAt: candidate.firstSeenAt.toISOString(),
        lastSeenAt: candidate.lastSeenAt.toISOString(),
      }));
    }),

  startRadarSync: publicProcedure
    .output(z.object({
      status: z.literal("running"),
      startedAt: z.string(),
      alreadyRunning: z.boolean(),
    }))
    .mutation(async ({ ctx }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const payload = createGithubDiscoveryJobPayload(new Date());
      const { job, enqueued } = await enqueueRestartableJob(ctx.db, {
        userId,
        type: GITHUB_DISCOVERY_JOB,
        idempotencyKey: GITHUB_DISCOVERY_JOB_KEY,
        payload,
        maxAttempts: 3,
      });
      const storedPayload = githubDiscoveryJobPayloadSchema.parse(job.payload);
      const requestedAt = storedPayload.requestedAt
        ? new Date(storedPayload.requestedAt)
        : job.updatedAt;

      return {
        status: "running" as const,
        startedAt: (job.startedAt ?? requestedAt).toISOString(),
        alreadyRunning: !enqueued,
      };
    }),

  getRadarSyncStatus: publicProcedure
    .output(radarSyncStatusSchema)
    .query(async ({ ctx }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const job = await getJobByIdempotencyKey(
        ctx.db,
        userId,
        GITHUB_DISCOVERY_JOB_KEY,
      );
      if (!job) {
        return {
          status: "idle" as const,
          startedAt: null,
          finishedAt: null,
          result: null,
          error: null,
        };
      }

      const payload = githubDiscoveryJobPayloadSchema.parse(job.payload);
      const requestedAt = payload.requestedAt ? new Date(payload.requestedAt) : job.updatedAt;
      const startedAt = (job.startedAt ?? requestedAt).toISOString();
      if (job.status === "succeeded") {
        return {
          status: "completed" as const,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result: githubDiscoveryJobResultSchema.parse(job.result),
          error: null,
        };
      }
      if (job.status === "dead" || job.status === "cancelled") {
        return {
          status: "failed" as const,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result: null,
          error: job.lastError ?? "DevScope 发现榜同步失败",
        };
      }

      return {
        status: "running" as const,
        startedAt,
        finishedAt: null,
        result: null,
        error: null,
      };
    }),

  startTrendingSync: publicProcedure
    .output(z.object({
      status: z.literal("running"),
      startedAt: z.string(),
      alreadyRunning: z.boolean(),
    }))
    .mutation(async ({ ctx }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const requestedAt = new Date();
      const { job, enqueued } = await enqueueRestartableJob(ctx.db, {
        userId,
        type: GITHUB_TRENDING_SYNC_JOB,
        idempotencyKey: GITHUB_TRENDING_SYNC_JOB_KEY,
        payload: {
          requestedAt: requestedAt.toISOString(),
          snapshotDate: requestedAt.toISOString().slice(0, 10),
          language: "all",
          periods: ["daily", "weekly", "monthly"],
        },
        maxAttempts: 3,
      });
      const payload = githubTrendingSyncJobPayloadSchema.parse(job.payload);

      return {
        status: "running" as const,
        startedAt: (job.startedAt ?? new Date(payload.requestedAt)).toISOString(),
        alreadyRunning: !enqueued,
      };
    }),

  getTrendingSyncStatus: publicProcedure
    .output(trendingSyncStatusSchema)
    .query(async ({ ctx }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const job = await getJobByIdempotencyKey(
        ctx.db,
        userId,
        GITHUB_TRENDING_SYNC_JOB_KEY,
      );
      if (!job) {
        return {
          status: "idle" as const,
          startedAt: null,
          finishedAt: null,
          result: null,
          error: null,
        };
      }

      const payload = githubTrendingSyncJobPayloadSchema.parse(job.payload);
      const startedAt = (job.startedAt ?? new Date(payload.requestedAt)).toISOString();
      if (job.status === "succeeded") {
        return {
          status: "completed" as const,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result: githubTrendingSyncJobResultSchema.parse(job.result),
          error: null,
        };
      }
      if (job.status === "dead" || job.status === "cancelled") {
        return {
          status: "failed" as const,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result: null,
          error: job.lastError ?? "GitHub Trending 同步失败",
        };
      }

      return {
        status: "running" as const,
        startedAt,
        finishedAt: null,
        result: null,
        error: null,
      };
    }),
});
