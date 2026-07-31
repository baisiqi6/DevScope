import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import {
  enqueueRestartableJob,
  getJobByIdempotencyKey,
  getRepoGraphData,
  GRAPH_REBUILD_JOB,
  GRAPH_REBUILD_JOB_KEY,
  graphRebuildJobPayloadSchema,
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
});
