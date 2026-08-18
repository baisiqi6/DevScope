import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import {
  enqueueRestartableJob,
  enqueueTechnologyStackEntitiesBackfillJob,
  getJobByIdempotencyKey,
  getLatestTechnologyStackEntitiesBackfillJob,
  getRepoGraphData,
  GRAPH_REBUILD_JOB,
  GRAPH_REBUILD_JOB_KEY,
  graphRebuildJobPayloadSchema,
  technologyStackEntitiesBackfillJobPayloadSchema,
  technologyStackEntitiesBackfillJobResultSchema,
} from "@devscope/db";
import {
  rebuildGraphStatusSchema,
  rebuildRepoGraphResultSchema,
  repoGraphSchema,
} from "@devscope/shared";
import { getOrCreateCurrentUserId } from "../current-user";

export const graphRouter = router({
  getRepoGraph: publicProcedure
    .output(repoGraphSchema)
    .query(async ({ ctx }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      return getRepoGraphData(ctx.db, userId);
    }),

  startRebuildGraph: publicProcedure
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
        type: GRAPH_REBUILD_JOB,
        idempotencyKey: GRAPH_REBUILD_JOB_KEY,
        payload: { requestedAt: requestedAt.toISOString() },
        priority: 10,
        maxAttempts: 3,
      });
      const payload = graphRebuildJobPayloadSchema.parse(job.payload);

      return {
        status: "running" as const,
        startedAt: (job.startedAt ?? new Date(payload.requestedAt)).toISOString(),
        alreadyRunning: !enqueued,
      };
    }),

  getRebuildGraphStatus: publicProcedure
    .output(rebuildGraphStatusSchema)
    .query(async ({ ctx }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const job = await getJobByIdempotencyKey(ctx.db, userId, GRAPH_REBUILD_JOB_KEY);

      if (!job) {
        return {
          status: "idle" as const,
          startedAt: null,
          finishedAt: null,
          result: null,
          error: null,
        };
      }

      const payload = graphRebuildJobPayloadSchema.parse(job.payload);
      const startedAt = (job.startedAt ?? new Date(payload.requestedAt)).toISOString();
      if (job.status === "succeeded") {
        const result = rebuildRepoGraphResultSchema.parse(job.result);
        return {
          status: "completed" as const,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result,
          error: null,
        };
      }

      if (job.status === "dead" || job.status === "cancelled") {
        return {
          status: "failed" as const,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result: null,
          error: job.lastError ?? (job.status === "cancelled" ? "图谱重建已取消" : "图谱重建失败"),
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

  startTechnologyStackEntitiesBackfill: publicProcedure
    .input(z.object({
      version: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    }).default({}))
    .output(z.object({
      jobId: z.number().int().positive(),
      version: z.string(),
      status: z.literal("running"),
      alreadyRunning: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const requestedAt = new Date();
      const version = input.version ?? requestedAt.toISOString().replace(/[-:.]/g, "");
      const { job, enqueued } = await enqueueTechnologyStackEntitiesBackfillJob(ctx.db, {
        userId,
        version,
        requestedAt,
      });
      const payload = technologyStackEntitiesBackfillJobPayloadSchema.parse(job.payload);
      return {
        jobId: job.id,
        version: payload.version,
        status: "running" as const,
        alreadyRunning: !enqueued,
      };
    }),

  getTechnologyStackEntitiesBackfillStatus: publicProcedure
    .output(z.object({
      status: z.enum(["idle", "running", "completed", "failed"]),
      version: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
      result: technologyStackEntitiesBackfillJobResultSchema.nullable(),
      error: z.string().nullable(),
    }))
    .query(async ({ ctx }) => {
      const job = await getLatestTechnologyStackEntitiesBackfillJob(ctx.db);
      if (!job) {
        return {
          status: "idle" as const,
          version: null,
          startedAt: null,
          finishedAt: null,
          result: null,
          error: null,
        };
      }
      const payload = technologyStackEntitiesBackfillJobPayloadSchema.parse(job.payload);
      const startedAt = (job.startedAt ?? new Date(payload.requestedAt)).toISOString();
      if (job.status === "succeeded") {
        return {
          status: "completed" as const,
          version: payload.version,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result: technologyStackEntitiesBackfillJobResultSchema.parse(job.result),
          error: null,
        };
      }
      if (job.status === "dead" || job.status === "cancelled") {
        return {
          status: "failed" as const,
          version: payload.version,
          startedAt,
          finishedAt: job.completedAt?.toISOString() ?? job.updatedAt.toISOString(),
          result: job.result
            ? technologyStackEntitiesBackfillJobResultSchema.parse(job.result)
            : null,
          error: job.lastError ?? "Technology stack entities backfill failed",
        };
      }
      return {
        status: "running" as const,
        version: payload.version,
        startedAt,
        finishedAt: null,
        result: job.result
          ? technologyStackEntitiesBackfillJobResultSchema.parse(job.result)
          : null,
        error: null,
      };
    }),
});
