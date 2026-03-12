/**
 * @package @devscope/api
 * @description Langtum Webhook 处理器
 *
 * 接收和处理来自 Langtum 工作流平台的 Webhook 通知。
 *
 * @module webhook/langtum
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import {
  createLangtumClient,
  WebhookSignatureError,
  type WebhookHeaders,
  type WebhookRequestBody,
  type WebhookEventType,
  LangtumClient,
} from "@devscope/ai";
import { createDb } from "@devscope/db";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Webhook 事件处理器类型
 */
type WebhookEventHandler = (
  payload: WebhookRequestBody,
  client: LangtumClient
) => Promise<void>;

// ============================================================================
// Webhook 处理器类
// ============================================================================

/**
 * Langtum Webhook 处理器
 * @description 处理来自 Langtum 平台的 Webhook 请求
 *
 * @example
 * ```typescript
 * const handler = new LangtumWebhookHandler();
 *
 * // 在 Fastify 路由中使用
 * fastify.post('/api/webhook/langtum', async (req, reply) => {
 *   await handler.handle(req, reply);
 * });
 * ```
 */
export class LangtumWebhookHandler {
  private client: LangtumClient;
  private eventHandlers: Map<WebhookEventType, WebhookEventHandler>;

  constructor() {
    this.client = createLangtumClient();
    this.eventHandlers = new Map();

    // 注册默认事件处理器
    this.registerDefaultHandlers();
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 处理 Webhook 请求
   *
   * @param req Fastify 请求对象
   * @param reply Fastify 响应对象
   *
   * @example
   * ```typescript
   * fastify.post('/api/webhook/langtum', async (req, reply) => {
   *   await webhookHandler.handle(req, reply);
   * });
   * ```
   */
  async handle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      // 1. 验证签名
      const headers = req.headers as WebhookHeaders;
      const body = req.body as WebhookRequestBody;

      if (!this.client.verifyWebhookSignature(headers, body)) {
        throw new WebhookSignatureError("Invalid webhook signature");
      }

      // 2. 获取事件类型
      const eventType = LangtumClient.getEventType(headers);
      if (!eventType) {
        reply.code(400).send({ error: "Missing or invalid event type" });
        return;
      }

      // 3. 获取对应的处理器
      const handler = this.eventHandlers.get(eventType);
      if (!handler) {
        reply.code(400).send({ error: `No handler registered for event: ${eventType}` });
        return;
      }

      // 4. 执行处理器
      await handler(body, this.client);

      // 5. 返回成功响应
      reply.code(200).send({ received: true });
    } catch (error) {
      // 错误处理
      if (error instanceof WebhookSignatureError) {
        reply.code(401).send({ error: error.message });
        return;
      }

      console.error("Error processing webhook:", error);
      reply.code(500).send({ error: "Internal server error" });
    }
  }

  /**
   * 注册自定义事件处理器
   *
   * @param eventType 事件类型
   * @param handler 事件处理器函数
   *
   * @example
   * ```typescript
   * handler.registerHandler("workflow.completed", async (payload, client) => {
   *   console.log("Workflow completed:", payload.execution_id);
   *   // 自定义处理逻辑
   * });
   * ```
   */
  registerHandler(eventType: WebhookEventType, handler: WebhookEventHandler): void {
    this.eventHandlers.set(eventType, handler);
  }

  // ========================================================================
  // 默认事件处理器
  // ========================================================================

  /**
   * 注册默认事件处理器
   */
  private registerDefaultHandlers(): void {
    // workflow.started - 工作流开始执行
    this.registerHandler("workflow.started", async (payload) => {
      console.log(`[Webhook] Workflow started: ${payload.execution_id}`);
      await this.updateExecutionStatus(payload.execution_id, "running");
    });

    // workflow.progress - 工作流进度更新
    this.registerHandler("workflow.progress", async (payload) => {
      console.log(
        `[Webhook] Workflow progress: ${payload.execution_id} - ${payload.progress_percent}%`
      );
      await this.updateExecutionProgress(
        payload.execution_id,
        payload.progress_percent || 0,
        payload.current_node
      );
    });

    // workflow.completed - 工作流执行完成
    this.registerHandler("workflow.completed", async (payload, client) => {
      console.log(`[Webhook] Workflow completed: ${payload.execution_id}`);

      // 保存结果到数据库
      await this.saveWorkflowResult(payload);

      // 更新执行状态
      await this.updateExecutionStatus(payload.execution_id, "completed", payload.result);
    });

    // workflow.failed - 工作流执行失败
    this.registerHandler("workflow.failed", async (payload) => {
      console.error(`[Webhook] Workflow failed: ${payload.execution_id}`);

      // 更新执行状态为失败
      await this.updateExecutionStatus(
        payload.execution_id,
        "failed",
        undefined,
        payload.result?.toString() || "Unknown error"
      );
    });
  }

  // ========================================================================
  // 数据库操作方法
  // ========================================================================

  /**
   * 更新工作流执行状态
   */
  private async updateExecutionStatus(
    executionId: string,
    status: "running" | "completed" | "failed" | "cancelled",
    result?: unknown,
    error?: string
  ): Promise<void> {
    const db = createDb();

    // TODO: 实现数据库更新逻辑
    // UPDATE workflow_executions
    // SET status = $1, result = $2, error = $3, updated_at = NOW()
    // WHERE execution_id = $4

    console.log(`[DB] Update execution ${executionId} status to ${status}`);
  }

  /**
   * 更新工作流执行进度
   */
  private async updateExecutionProgress(
    executionId: string,
    progressPercent: number,
    currentNode?: string
  ): Promise<void> {
    const db = createDb();

    // TODO: 实现数据库更新逻辑
    // UPDATE workflow_executions
    // SET progress_percent = $1, current_node = $2, updated_at = NOW()
    // WHERE execution_id = $3

    console.log(
      `[DB] Update execution ${executionId} progress: ${progressPercent}% at ${currentNode}`
    );
  }

  /**
   * 保存工作流结果到数据库
   */
  private async saveWorkflowResult(payload: WebhookRequestBody): Promise<void> {
    const db = createDb();

    // 根据工作流类型保存不同的结果
    if (payload.workflow_id === LangtumClient.WORKFLOWS.DAILY_HEALTH_REPORT) {
      await this.saveDailyReportResult(payload);
    } else if (payload.workflow_id === LangtumClient.WORKFLOWS.QUICK_ASSESSMENT) {
      await this.saveQuickAssessmentResult(payload);
    }
  }

  /**
   * 保存每日健康度报告结果
   */
  private async saveDailyReportResult(payload: WebhookRequestBody): Promise<void> {
    const db = createDb();

    // TODO: 实现数据库保存逻辑
    // INSERT INTO workflow_reports (report_id, execution_id, user_id, report_type, result, created_at)
    // VALUES ($1, $2, $3, 'daily_report', $4, NOW())

    console.log(`[DB] Save daily report result for execution ${payload.execution_id}`);
  }

  /**
   * 保存快速评估结果
   */
  private async saveQuickAssessmentResult(payload: WebhookRequestBody): Promise<void> {
    const db = createDb();

    // TODO: 实现数据库保存逻辑
    // INSERT INTO workflow_reports (report_id, execution_id, user_id, report_type, result, created_at)
    // VALUES ($1, $2, $3, 'quick_assessment', $4, NOW())

    console.log(`[DB] Save quick assessment result for execution ${payload.execution_id}`);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 LangtumWebhookHandler 实例
 *
 * @example
 * ```typescript
 * const handler = createLangtumWebhookHandler();
 * ```
 */
export function createLangtumWebhookHandler(): LangtumWebhookHandler {
  return new LangtumWebhookHandler();
}

// ============================================================================
// Fastify 路由配置辅助函数
// ============================================================================

/**
 * 配置 Fastify Webhook 路由
 *
 * @param fastify Fastify 实例
 * @param path Webhook 路径（默认: /api/webhook/langtum）
 *
 * @example
 * ```typescript
 * import fastify from 'fastify';
 * import { registerWebhookRoute } from './webhook/langtum';
 *
 * const app = fastify();
 * registerWebhookRoute(app);
 * ```
 */
export function registerWebhookRoute(
  fastify: any,
  path: string = "/api/webhook/langtum"
): void {
  const handler = createLangtumWebhookHandler();

  fastify.post(path, async (req: FastifyRequest, reply: FastifyReply) => {
    await handler.handle(req, reply);
  });

  // 添加健康检查端点
  fastify.get(`${path}/health`, async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.code(200).send({ status: "ok", service: "langtum-webhook" });
  });

  console.log(`[Webhook] Registered Langtum webhook route: ${path}`);
}
