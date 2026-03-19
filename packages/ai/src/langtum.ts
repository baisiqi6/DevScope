/**
 * @package @devscope/ai
 * @description Langtum 工作流平台 API 客户端
 *
 * 本模块提供与 Langtum 工作流平台的集成能力，包括：
 * - 触发工作流执行
 * - 查询工作流状态
 * - Webhook 签名验证
 *
 * @module langtum
 */

import { createHmac, randomUUID } from "crypto";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Langtum 客户端配置选项
 */
export interface LangtumConfig {
  /** Langtum API Key（默认从环境变量 LANGTUM_API_KEY 读取） */
  apiKey?: string;
  /** API Secret（用于 Webhook 签名验证，默认从环境变量 LANGTUM_API_SECRET 读取） */
  apiSecret?: string;
  /** Langtum API 基础 URL（默认从环境变量 LANGTUM_BASE_URL 读取） */
  baseURL?: string;
}

/**
 * 工作流触发输入
 */
export interface WorkflowTriggerInput {
  /** 用户 ID */
  user_id: number;
  [key: string]: unknown;
}

/**
 * 每日健康度报告工作流输入
 */
export interface DailyHealthReportInput extends WorkflowTriggerInput {
  /** 用户 ID */
  user_id: number;
  /** 关注的仓库列表 */
  watchlist: string[];
  /** 报告日期（可选，格式: YYYY-MM-DD） */
  report_date?: string;
}

/**
 * 快速评估工作流输入
 */
export interface QuickAssessmentInput extends WorkflowTriggerInput {
  /** GitHub 仓库（格式: owner/repo） */
  repo: string;
  /** 用户 ID */
  user_id: number;
  /** 评估深度（可选） */
  assessment_depth?: "standard" | "deep";
}

/**
 * 工作流执行状态
 */
export type WorkflowExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * 工作流执行响应
 */
export interface WorkflowExecutionResponse {
  /** 执行 ID */
  execution_id: string;
  /** 工作流 ID */
  workflow_id: string;
  /** 执行状态 */
  status: WorkflowExecutionStatus;
  /** 开始时间 */
  started_at: string;
  /** 预计完成时间（可选） */
  estimated_completion_at?: string;
}

/**
 * 工作流执行详情
 */
export interface WorkflowExecutionDetail extends WorkflowExecutionResponse {
  /** 当前节点（运行中时） */
  current_node?: string;
  /** 进度百分比（0-100） */
  progress_percent?: number;
  /** 执行结果（完成时） */
  result?: unknown;
  /** 错误信息（失败时） */
  error?: string;
  /** 完成时间 */
  completed_at?: string;
  /** 执行时长（毫秒） */
  duration_ms?: number;
}

/**
 * Langcore 平台实际返回的响应结构
 */
export interface LangcoreWorkflowResponse {
  status: "success" | "error";
  output?: {
    output?: {
      output?: string;
    };
    logId?: string;
    fullLog?: {
      id: string;
      workflowId: string;
      status: string;
      startTimetamp: number;
      endTimetamp: number;
      input: Record<string, unknown>;
      output: {
        output: string;
      };
      runDetails: unknown[];
    };
  };
  error?: string;
}

/**
 * Webhook 事件类型
 */
export type WebhookEventType =
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.progress"
  | "workflow.started";

/**
 * Webhook 请求头
 */
export interface WebhookHeaders {
  "x-langtum-signature"?: string;
  "x-langtum-timestamp"?: string;
  "x-langtum-event"?: string;
  "content-type"?: string;
}

/**
 * Webhook 请求体
 */
export interface WebhookRequestBody {
  /** 事件类型 */
  event: WebhookEventType;
  /** 工作流 ID */
  workflow_id: string;
  /** 执行 ID */
  execution_id: string;
  /** 状态 */
  status: WorkflowExecutionStatus;
  /** 结果（完成时） */
  result?: unknown;
  /** 开始时间 */
  started_at: string;
  /** 完成时间（可选） */
  completed_at?: string;
  /** 执行时长（毫秒，可选） */
  duration_ms?: number;
  /** 当前节点（进度事件） */
  current_node?: string;
  /** 进度百分比（进度事件） */
  progress_percent?: number;
  /** 节点输出（进度事件） */
  node_output?: unknown;
}

// ============================================================================
// LangtumClient 类
// ============================================================================

/**
 * Langtum 工作流平台 API 客户端
 * @description 封装 Langtum 平台的 API 调用
 *
 * @example
 * ```typescript
 * const client = new LangtumClient();
 *
 * // 触发快速评估
 * const execution = await client.triggerQuickAssessment({
 *   repo: "vercel/next.js",
 *   user_id: 1,
 * });
 *
 * // 查询状态
 * const detail = await client.getExecutionDetail(execution.execution_id);
 * ```
 */
export class LangtumClient {
  /** API Key */
  private readonly apiKey: string;
  /** API Secret（用于 webhook 验证） */
  private readonly apiSecret: string;
  /** API 基础 URL */
  private readonly baseURL: string;

  /** 工作流名称常量 */
  static readonly WORKFLOWS = {
    DAILY_HEALTH_REPORT: "devscope-daily-health-report",
    QUICK_ASSESSMENT: "devscope-quick-assessment",
  } as const;

  /**
   * 创建 LangtumClient 实例
   * @param config 配置选项
   * @throws {Error} 如果缺少 API Key
   */
  constructor(config: LangtumConfig = {}) {
    this.apiKey = config.apiKey || process.env.LANGTUM_API_KEY || "";
    this.apiSecret = config.apiSecret || process.env.LANGTUM_API_SECRET || "";
    this.baseURL =
      config.baseURL ||
      process.env.LANGTUM_BASE_URL ||
      "https://demo.langcore.cn";

    if (!this.apiKey) {
      throw new Error("LANGTUM_API_KEY is required");
    }
  }

  // ========================================================================
  // 工作流触发方法
  // ========================================================================

  /**
   * 触发任意工作流（通用方法）
   *
   * @param workflowName 工作流名称
   * @param input 工作流输入
   * @returns 执行响应，包含 execution_id
   */
  private async triggerWorkflow(
    workflowName: string,
    input: WorkflowTriggerInput
  ): Promise<WorkflowExecutionResponse> {
    const url = `${this.baseURL}/api/v1/workflows/${workflowName}/trigger`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to trigger workflow: ${response.status} ${response.statusText} - ${error}`
      );
    }

    return (await response.json()) as WorkflowExecutionResponse;
  }

  /**
   * 触发每日健康度报告工作流
   *
   * @param input 工作流输入
   * @returns 执行响应，包含 execution_id
   *
   * @example
   * ```typescript
   * const response = await client.triggerDailyHealthReport({
   *   user_id: 1,
   *   watchlist: ["vercel/next.js", "facebook/react"],
   *   report_date: "2026-03-11",
   * });
   * console.log(response.execution_id);
   * ```
   */
  async triggerDailyHealthReport(
    input: DailyHealthReportInput
  ): Promise<WorkflowExecutionResponse> {
    return this.triggerWorkflow(
      LangtumClient.WORKFLOWS.DAILY_HEALTH_REPORT,
      input
    );
  }

  /**
   * 触发快速评估工作流
   *
   * @param input 工作流输入
   * @returns 执行响应，包含 execution_id
   *
   * @example
   * ```typescript
   * const response = await client.triggerQuickAssessment({
   *   repo: "vercel/next.js",
   *   user_id: 1,
   *   assessment_depth: "standard",
   * });
   * console.log(response.execution_id);
   * ```
   */
  async triggerQuickAssessment(
    input: QuickAssessmentInput
  ): Promise<WorkflowExecutionResponse> {
    return this.triggerWorkflow(
      LangtumClient.WORKFLOWS.QUICK_ASSESSMENT,
      input
    );
  }

  /**
   * 触发自定义工作流（Langcore 平台）
   *
   * @param workflowId 工作流 ID（如 cmmlmarrt010hgjpg0qi53204）
   * @param input 工作流输入对象（包含 shuru 等字段）
   * @param runMode 运行模式（默认 sync）
   * @returns 执行响应
   *
   * @example
   * ```typescript
   * const response = await client.triggerCustomWorkflow(
   *   "cmmlmarrt010hgjpg0qi53204",
   *   { shuru: "owner/repo1,owner/repo2" },
   *   "sync"
   * );
   * ```
   */
  async triggerCustomWorkflow(
    workflowId: string,
    input: Record<string, unknown>,
    runMode: "sync" | "async" = "sync"
  ): Promise<WorkflowExecutionDetail> {
    const url = `${this.baseURL}/api/workflow/run/${workflowId}`;

    console.log(`[LangtumClient] Request URL: ${url}`);
    console.log(`[LangtumClient] Request body:`, JSON.stringify({ input, runMode }, null, 2));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input,
        runMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to trigger workflow: ${response.status} ${response.statusText} - ${error}`
      );
    }

    const rawData = await response.json() as LangcoreWorkflowResponse;
    console.log(`[LangtumClient] Raw response:`, JSON.stringify(rawData, null, 2));

    // 转换 Langcore 响应格式为标准的 WorkflowExecutionDetail 格式
    const result = rawData.output?.output?.output;

    const detail: WorkflowExecutionDetail = {
      execution_id: rawData.output?.fullLog?.id || this.generateExecutionId(),
      workflow_id: rawData.output?.fullLog?.workflowId || workflowId,
      status: rawData.status === "success" ? "completed" :
              rawData.status === "error" ? "failed" : "running",
      started_at: rawData.output?.fullLog?.startTimetamp ?
        new Date(rawData.output.fullLog.startTimetamp).toISOString() :
        new Date().toISOString(),
      result: result,
      completed_at: rawData.output?.fullLog?.endTimetamp ?
        new Date(rawData.output.fullLog.endTimetamp).toISOString() :
        undefined,
      duration_ms: rawData.output?.fullLog?.startTimetamp && rawData.output?.fullLog?.endTimetamp ?
        rawData.output.fullLog.endTimetamp - rawData.output.fullLog.startTimetamp :
        undefined,
    };

    console.log(`[LangtumClient] Converted response:`, JSON.stringify(detail, null, 2));

    return detail;
  }

  // ========================================================================
  // 状态查询方法
  // ========================================================================

  /**
   * 查询工作流执行详情
   *
   * @param executionId 执行 ID
   * @returns 执行详情
   *
   * @example
   * ```typescript
   * const detail = await client.getExecutionDetail("exec_123456");
   * if (detail.status === "completed") {
   *   console.log(detail.result);
   * }
   * ```
   */
  async getExecutionDetail(
    executionId: string
  ): Promise<WorkflowExecutionDetail> {
    const url = `${this.baseURL}/api/v1/workflows/executions/${executionId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to get execution detail: ${response.status} ${response.statusText} - ${error}`
      );
    }

    return (await response.json()) as WorkflowExecutionDetail;
  }

  /**
   * 等待工作流执行完成
   *
   * @param executionId 执行 ID
   * @param options 等待选项
   * @returns 执行详情（完成或失败时）
   *
   * @example
   * ```typescript
   * const detail = await client.waitForCompletion("exec_123456", {
   *   timeout: 300000,  // 5 分钟
   *   interval: 2000,   // 每 2 秒检查一次
   * });
   * ```
   */
  async waitForCompletion(
    executionId: string,
    options: {
      /** 超时时间（毫秒，默认 5 分钟） */
      timeout?: number;
      /** 轮询间隔（毫秒，默认 2 秒） */
      interval?: number;
      /** 进度回调 */
      onProgress?: (detail: WorkflowExecutionDetail) => void;
    } = {}
  ): Promise<WorkflowExecutionDetail> {
    const {
      timeout = 5 * 60 * 1000, // 5 分钟
      interval = 2000, // 2 秒
      onProgress,
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const detail = await this.getExecutionDetail(executionId);

      // 调用进度回调
      if (onProgress) {
        onProgress(detail);
      }

      // 检查是否完成或失败
      if (detail.status === "completed" || detail.status === "failed") {
        return detail;
      }

      // 等待下一次轮询
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Workflow execution timeout after ${timeout}ms`);
  }

  // ========================================================================
  // Webhook 验证方法
  // ========================================================================

  /**
   * 验证 Webhook 请求签名
   *
   * @param headers 请求头
   * @param body 请求体
   * @returns 验证是否通过
   *
   * @example
   * ```typescript
   * const isValid = client.verifyWebhookSignature(
   *   req.headers,
   *   req.body
   * );
   * if (!isValid) {
   *   throw new Error("Invalid webhook signature");
   * }
   * ```
   */
  verifyWebhookSignature(
    headers: WebhookHeaders,
    body: unknown
  ): boolean {
    const signature = headers["x-langtum-signature"];
    const timestamp = headers["x-langtum-timestamp"];

    if (!signature || !timestamp) {
      return false;
    }

    // 检查时间戳（5 分钟内有效，防止重放攻击）
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    if (Math.abs(now - requestTime) > 300) {
      return false;
    }

    // 计算期望的签名
    const payload = JSON.stringify(body);
    const expectedSignature = this.generateSignature(payload, timestamp);

    // 使用 constant-time 比较，防止时序攻击
    return this.constantTimeCompare(signature, expectedSignature);
  }

  /**
   * 生成 HMAC-SHA256 签名
   *
   * @param payload 请求体
   * @param timestamp 时间戳
   * @returns 十六进制签名字符串
   */
  private generateSignature(payload: string, timestamp: string): string {
    const data = `${timestamp}.${payload}`;
    return createHmac("sha256", this.apiSecret)
      .update(data)
      .digest("hex");
  }

  /**
   * Constant-time 字符串比较
   * 防止时序攻击
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  // ========================================================================
  // 工具方法
  // ========================================================================

  /**
   * 生成唯一执行 ID（用于本地追踪）
   *
   * @returns UUID 格式的执行 ID
   */
  static generateExecutionId(): string {
    return randomUUID();
  }

  /**
   * 生成唯一执行 ID（实例方法）
   *
   * @returns UUID 格式的执行 ID
   */
  private generateExecutionId(): string {
    return LangtumClient.generateExecutionId();
  }

  /**
   * 从 headers 中提取事件类型
   *
   * @param headers 请求头
   * @returns 事件类型
   */
  static getEventType(headers: WebhookHeaders): WebhookEventType | null {
    const event = headers["x-langtum-event"];
    if (!event) {
      return null;
    }
    // 验证事件类型
    const validEvents: WebhookEventType[] = [
      "workflow.completed",
      "workflow.failed",
      "workflow.progress",
      "workflow.started",
    ];
    return validEvents.includes(event as WebhookEventType)
      ? (event as WebhookEventType)
      : null;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 LangtumClient 实例的工厂函数
 *
 * @param config 配置选项
 * @returns LangtumClient 实例
 *
 * @example
 * ```typescript
 * const client = createLangtumClient();
 * ```
 */
export function createLangtumClient(config?: LangtumConfig): LangtumClient {
  return new LangtumClient(config);
}

// ============================================================================
// 错误类
// ============================================================================

/**
 * Langtum API 错误
 */
export class LangtumAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public workflowId?: string,
    public executionId?: string
  ) {
    super(message);
    this.name = "LangtumAPIError";
  }
}

/**
 * 工作流执行超时错误
 */
export class WorkflowTimeoutError extends Error {
  constructor(
    message: string,
    public executionId: string,
    public timeout: number
  ) {
    super(message);
    this.name = "WorkflowTimeoutError";
  }
}

/**
 * Webhook 签名验证失败错误
 */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}
