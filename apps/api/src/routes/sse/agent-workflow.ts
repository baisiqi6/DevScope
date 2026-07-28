/**
 * @package @devscope/api/routes/sse
 * @description Agent 工作流 SSE 端点
 *
 * 提供 Server-Sent Events 端点，用于实时推送 Agent 思考过程。
 *
 * @module agent-workflow
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { createDb } from "@devscope/db";
import type { AgentWorkflowEvent, CompetitiveAnalysisReport } from "@devscope/shared";
import { getOrCreateCurrentUserId } from "../../current-user";
import { runAgentWorkflow } from "../../services/agent-workflow";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * SSE 请求体
 */
interface SSERequestBody {
  repos: string[];
  analysisType: "competitive_landscape" | "health_report" | "single_repo";
  context?: string;
}

// ============================================================================
// SSE 辅助函数
// ============================================================================

/**
 * 发送 SSE 事件
 */
function sendEvent(reply: FastifyReply, event: AgentWorkflowEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * 获取分析类型标签
 */
function getAnalysisTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    competitive_landscape: "竞争格局分析",
    health_report: "健康度报告",
    single_repo: "单仓库分析",
  };
  return labels[type] || type;
}

/**
 * 创建终端输出拦截器
 * 拦截 console.log 等输出并通过 SSE 发送
 */
function createTerminalInterceptor(reply: FastifyReply) {
  const levels = ["log", "info", "warn", "error", "debug"] as const;
  const originals: Record<string, (...args: any[]) => void> = {};

  // 保存原始方法
  for (const level of levels) {
    originals[level] = console[level].bind(console);
  }

  // 返回清理函数
  const cleanup = () => {
    for (const level of levels) {
      console[level] = originals[level];
    }
  };

  // 重写 console 方法
  for (const level of levels) {
    console[level] = ((...args: any[]) => {
      // 调用原始方法（保持终端输出）
      originals[level](...args);

      // 通过 SSE 发送
      const message = args
        .map((arg) => {
          if (typeof arg === "string") return arg;
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        })
        .join(" ");

      sendEvent(reply, {
        type: "terminal",
        data: {
          level,
          message,
          timestamp: new Date().toISOString(),
          source: "agent",
        },
      });
    }) as any;
  }

  return cleanup;
}


// ============================================================================
// SSE 端点注册
// ============================================================================

/**
 * 注册 Agent 工作流 SSE 端点
 */
export async function registerAgentWorkflowSSE(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/agent/workflow/stream", async (req: FastifyRequest, reply: FastifyReply) => {
    const input = req.body as SSERequestBody;

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

    const cleanupTerminal = createTerminalInterceptor(reply);

    try {
      await runAgentWorkflow(db, executionUserId, input, {
        onEvent: (event) => sendEvent(reply, event),
      });
    } catch (error) {
      console.error("[SSE] Agent workflow error:", error);
    } finally {
      cleanupTerminal();
    }

    reply.raw.end();
  });

  console.log("[SSE] Agent workflow SSE endpoint registered at POST /api/agent/workflow/stream");
}
