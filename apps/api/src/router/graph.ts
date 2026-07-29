import { router, publicProcedure } from "../trpc";
import { getRepoGraphData, rebuildRepoGraph } from "@devscope/db";
import { repoGraphSchema, rebuildRepoGraphResultSchema, GitHubClient } from "@devscope/shared";

export const graphRouter = router({
  getRepoGraph: publicProcedure
    .output(repoGraphSchema)
    .query(async ({ ctx }) => {
      return getRepoGraphData(ctx.db);
    }),

  rebuildRepoGraph: publicProcedure
    .output(rebuildRepoGraphResultSchema)
    .mutation(async ({ ctx }) => {
      // 依赖边构建时将 deps.dev 的过期 fullName 归一为 GitHub 当前规范名；
      // 同时回填历史采集缺失的 SBOM（SBOM 持久化与多生态解析之前的数据）
      const gh = new GitHubClient(process.env.GITHUB_TOKEN || undefined);
      return rebuildRepoGraph(ctx.db, {
        canonicalize: (fullName) => gh.getCanonicalFullName(fullName),
        fetchSbom: (fullName) => gh.getSbom(fullName),
      });
    }),
});
