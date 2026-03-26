/**
 * @package @devscope/api/routes
 * @description 报告 API 路由
 *
 * 提供报告的查询、加载等功能。
 *
 * @module reports
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { loadReport } from "@devscope/db";

// ============================================================================
// 路由注册
// ============================================================================

/**
 * 注册报告相关路由
 */
export async function registerReportsRoutes(fastify: FastifyInstance): Promise<void> {
  // 获取单个报告
  fastify.get("/api/reports/:executionId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { executionId } = req.params as { executionId: string };

    try {
      const report = await loadReport(executionId);

      if (!report) {
        return reply.status(404).send({
          error: "Report not found",
          executionId,
        });
      }

      return reply.send(report);
    } catch (error) {
      console.error("[Reports] Failed to load report:", error);
      return reply.status(500).send({
        error: "Failed to load report",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
