/**
 * @package @devscope/api/routes/sse
 * @description Agent 工作流 SSE 端点
 *
 * 提供 Server-Sent Events 端点，用于实时推送 Agent 思考过程。
 *
 * @module agent-workflow
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createDb } from "@devscope/db";
import {
  agentWorkflowRequestSchema,
  type AgentWorkflowEvent,
} from "@devscope/shared";
import { getOrCreateCurrentUserId } from "../../current-user";
import { runAgentWorkflow } from "../../services/agent-workflow";

// ============================================================================
// SSE 辅助函数
// ============================================================================

/**
 * 发送 SSE 事件
 */
function sendEvent(reply: FastifyReply, event: AgentWorkflowEvent): void {
  if (!reply.raw.writableEnded && !reply.raw.destroyed) {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}


// ============================================================================
// SSE 端点注册
// ============================================================================

/**
 * 注册 Agent 工作流 SSE 端点
 */
export async function registerAgentWorkflowSSE(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/agent/workflow/stream", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = agentWorkflowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid workflow request",
        issues: parsed.error.issues,
      });
    }
    const input = parsed.data;

    // 设置 SSE 响应头
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no"); // 禁用 nginx 缓冲

    // CORS 头（允许前端直接访问）
    reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    reply.raw.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    reply.raw.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const db = createDb();
    let executionUserId: number;
    try {
      executionUserId = await getOrCreateCurrentUserId(db);
    } catch (e) {
      console.error("[SSE] Failed to resolve current user:", e);
      sendEvent(reply, {
        type: "complete",
        data: {
          executionId: "",
          status: "failed",
          error: "无法初始化工作流执行记录",
          timestamp: new Date().toISOString(),
        },
      });
      reply.raw.end();
      return;
    }

    const abortController = new AbortController();
    const abortWorkflow = () => abortController.abort();
    req.raw.once("aborted", abortWorkflow);
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) {
        abortWorkflow();
      }
    });

    try {
      await runAgentWorkflow(db, executionUserId, input, {
        onEvent: (event) => sendEvent(reply, event),
      }, { signal: abortController.signal });
    } catch (error) {
      if (!abortController.signal.aborted) {
        console.error("[SSE] Agent workflow error:", error);
      }
    }

    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      reply.raw.end();
    }
  });

  console.log("[SSE] Agent workflow SSE endpoint registered at POST /api/agent/workflow/stream");
}
