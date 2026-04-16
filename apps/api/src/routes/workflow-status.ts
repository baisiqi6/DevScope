/**
 * @package @devscope/api/routes
 * @description 工作流状态查询路由
 *
 * 提供工作流执行状态的查询接口，用于前端恢复分析状态。
 *
 * @module workflow-status
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createDb, workflowExecutions } from "@devscope/db";
import { eq } from "drizzle-orm";

// ============================================================================
// 路由注册
// ============================================================================

/**
 * 注册工作流状态查询路由
 */
export async function registerWorkflowStatusRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/workflow/status/:executionId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { executionId } = req.params as { executionId: string };

    try {
      const db = createDb();

      const rows = await db
        .select({
          executionId: workflowExecutions.executionId,
          status: workflowExecutions.status,
          workflowType: workflowExecutions.workflowType,
          error: workflowExecutions.error,
          startedAt: workflowExecutions.startedAt,
          completedAt: workflowExecutions.completedAt,
          result: workflowExecutions.result,
        })
        .from(workflowExecutions)
        .where(eq(workflowExecutions.executionId, executionId))
        .limit(1);

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "Execution not found",
          executionId,
        });
      }

      const row = rows[0];
      return reply.send({
        executionId: row.executionId,
        status: row.status,
        workflowType: row.workflowType,
        error: row.error,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        hasReport: row.result !== null,
      });
    } catch (error) {
      console.error("[WorkflowStatus] Failed to query status:", error);
      return reply.status(500).send({
        error: "Failed to query workflow status",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  console.log("[WorkflowStatus] Route registered at GET /api/workflow/status/:executionId");
}
