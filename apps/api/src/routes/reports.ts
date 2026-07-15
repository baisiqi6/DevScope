/**
 * @package @devscope/api/routes
 * @description 报告 API 路由
 *
 * 提供报告的查询、加载等功能。
 *
 * @module reports
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createDb,
  getWorkflowReportByExecutionId,
  loadReport,
  ownsWorkflowExecution,
} from "@devscope/db";
import { competitiveAnalysisReportSchema } from "@devscope/shared";
import { findCurrentUserId } from "../current-user";

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
      const db = createDb();
      const userId = await findCurrentUserId(db);

      if (userId === null) {
        return reply.status(404).send({
          error: "Report not found",
          executionId,
        });
      }

      // 数据库优先；仅为旧报告保留受 userId 约束的文件缓存回退。
      let report = await getWorkflowReportByExecutionId(db, executionId, userId);
      if (!report && await ownsWorkflowExecution(db, executionId, userId)) {
        const cachedReport = await loadReport(executionId);
        report = cachedReport
          ? competitiveAnalysisReportSchema.parse(cachedReport)
          : null;
      }

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
