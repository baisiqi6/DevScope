import { router, publicProcedure } from "../trpc";
import { getRepoGraphData, rebuildRepoGraph } from "@devscope/db";
import { repoGraphSchema, rebuildRepoGraphResultSchema } from "@devscope/shared";

export const graphRouter = router({
  getRepoGraph: publicProcedure
    .output(repoGraphSchema)
    .query(async ({ ctx }) => {
      return getRepoGraphData(ctx.db);
    }),

  rebuildRepoGraph: publicProcedure
    .output(rebuildRepoGraphResultSchema)
    .mutation(async ({ ctx }) => {
      return rebuildRepoGraph(ctx.db);
    }),
});
