import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { getRepoGraphData, rebuildRepoGraph } from "@devscope/db";
import { repoGraphSchema, rebuildGraphStatusSchema, GitHubClient } from "@devscope/shared";

// ============================================================================
// 异步重建状态机（进程内单例）
//
// 全量重建在生产可达十几分钟（SBOM 回填 + deps.dev 解析），同步 HTTP 会被
// Nginx 代理超时切断并返回 HTML 错误页。与批次一分析接口同一模式：
// start 立即返回，前端轮询 status；进程重启后状态自然归零（in-memory）。
// ============================================================================

export interface RebuildGraphState {
  status: "idle" | "running" | "completed" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  result: {
    similarityEdges: number;
    dependencyEdges: number;
    pooledRepos: number;
    sbomBackfilled: number;
  } | null;
  error: string | null;
}

let rebuildState: RebuildGraphState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
};

export const graphRouter = router({
  getRepoGraph: publicProcedure
    .output(repoGraphSchema)
    .query(async ({ ctx }) => {
      return getRepoGraphData(ctx.db);
    }),

  /**
   * 启动全量重建（fire-and-forget），立即返回；并发启动返回既有状态
   */
  startRebuildGraph: publicProcedure
    .output(z.object({
      status: z.enum(["idle", "running", "completed", "failed"]),
      startedAt: z.string().nullable(),
      alreadyRunning: z.boolean(),
    }))
    .mutation(async ({ ctx }) => {
      if (rebuildState.status === "running") {
        return { status: rebuildState.status, startedAt: rebuildState.startedAt, alreadyRunning: true };
      }

      rebuildState = {
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
        error: null,
      };

      // 依赖边构建时将 deps.dev 的过期 fullName 归一为 GitHub 当前规范名；
      // 同时回填历史采集缺失的 SBOM（SBOM 持久化与多生态解析之前的数据）
      const gh = new GitHubClient(process.env.GITHUB_TOKEN || undefined);
      rebuildRepoGraph(ctx.db, {
        canonicalize: (fullName) => gh.getCanonicalFullName(fullName),
        fetchSbom: (fullName) => gh.getSbom(fullName),
      })
        .then((result) => {
          rebuildState = {
            ...rebuildState,
            status: "completed",
            finishedAt: new Date().toISOString(),
            result,
            error: null,
          };
        })
        .catch((err: unknown) => {
          rebuildState = {
            ...rebuildState,
            status: "failed",
            finishedAt: new Date().toISOString(),
            result: null,
            error: err instanceof Error ? err.message : String(err),
          };
        });

      return { status: rebuildState.status, startedAt: rebuildState.startedAt, alreadyRunning: false };
    }),

  /**
   * 查询重建状态（前端轮询）
   */
  getRebuildGraphStatus: publicProcedure
    .output(rebuildGraphStatusSchema)
    .query(() => rebuildState),
});
