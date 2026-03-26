/**
 * @package @devscope/web/hooks
 * @description Agent 工作流 SSE 客户端 Hook
 *
 * 提供 React Hook 用于连接 SSE 端点，实时接收 Agent 思考过程。
 *
 * @module use-agent-workflow
 */

import { useState, useCallback, useRef } from "react";
import type { AgentWorkflowEvent } from "@devscope/shared";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 工作流状态
 */
export type WorkflowStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

/**
 * 报告结果
 */
export interface ReportResult {
  reportId: string;
  reportPath: string;
  summary: string;
}

/**
 * 工作流状态
 */
export interface WorkflowState {
  /** 当前状态 */
  status: WorkflowStatus;
  /** 所有事件列表 */
  events: AgentWorkflowEvent[];
  /** 当前正在使用的工具 */
  currentTool: string | null;
  /** 思考文本累积 */
  thinkingText: string;
  /** 输出文本累积 */
  outputText: string;
  /** 终端输出累积 */
  terminalOutput: string;
  /** 生成的报告 */
  report: ReportResult | null;
  /** 错误信息 */
  error: string | null;
  /** 执行 ID */
  executionId: string | null;
  /** 开始时间戳 */
  startTime: number | null;
}

/**
 * Hook 选项
 */
export interface UseAgentWorkflowOptions {
  /** 完成回调 */
  onComplete?: (report: ReportResult) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
  /** 事件回调 */
  onEvent?: (event: AgentWorkflowEvent) => void;
}

/**
 * 工作流输入
 */
export interface WorkflowInput {
  /** 要分析的仓库列表 */
  repos: string[];
  /** 分析类型 */
  analysisType: "competitive_landscape" | "health_report" | "single_repo";
  /** 额外上下文 */
  context?: string;
}

// ============================================================================
// Hook 实现
// ============================================================================

/**
 * Agent 工作流 Hook
 *
 * @param options - 配置选项
 * @returns 工作流状态和控制函数
 *
 * @example
 * ```tsx
 * const {
 *   status,
 *   events,
 *   thinkingText,
 *   report,
 *   startWorkflow,
 *   cancelWorkflow,
 * } = useAgentWorkflow({
 *   onComplete: (report) => console.log("完成:", report),
 * });
 *
 * // 启动工作流
 * startWorkflow({
 *   repos: ["vercel/next.js", "facebook/react"],
 *   analysisType: "competitive_landscape",
 * });
 * ```
 */
export function useAgentWorkflow(options: UseAgentWorkflowOptions = {}) {
  const [state, setState] = useState<WorkflowState>({
    status: "idle",
    events: [],
    currentTool: null,
    thinkingText: "",
    outputText: "",
    terminalOutput: "",
    report: null,
    error: null,
    executionId: null,
    startTime: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * 启动工作流
   */
  const startWorkflow = useCallback(
    async (input: WorkflowInput) => {
      // 重置状态
      setState({
        status: "running",
        events: [],
        currentTool: null,
        thinkingText: "",
        outputText: "",
        terminalOutput: "",
        report: null,
        error: null,
        executionId: null,
        startTime: Date.now(),
      });

      // 创建 AbortController
      abortControllerRef.current = new AbortController();

      try {
        // 使用 Next.js API Route 代理（方案 A）
        // 优点：无 CORS 问题，更安全，部署简单
        const response = await fetch("/api/agent/workflow/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No response body");
        }

        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // 解析 SSE 事件
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || ""; // 保留不完整的行

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6)) as AgentWorkflowEvent;

                // 调用事件回调
                options.onEvent?.(eventData);

                // 更新状态
                setState((prev) => {
                  const newEvents = [...prev.events, eventData];
                  let updates: Partial<WorkflowState> = { events: newEvents };

                  switch (eventData.type) {
                    case "thinking":
                      updates.thinkingText = prev.thinkingText + eventData.data.text;
                      break;
                    case "tool_use":
                      updates.currentTool = eventData.data.name;
                      break;
                    case "tool_result":
                      updates.currentTool = null;
                      break;
                    case "text":
                      updates.outputText = prev.outputText + eventData.data.text;
                      break;
                    case "terminal":
                      const timestamp = new Date(eventData.data.timestamp).toLocaleTimeString();
                      const level = eventData.data.level.toUpperCase();
                      updates.terminalOutput = prev.terminalOutput + `[${timestamp}] [${level}] ${eventData.data.message}\n`;
                      break;
                    case "report":
                      updates.report = eventData.data;
                      break;
                    case "complete":
                      updates.status = eventData.data.status;
                      updates.executionId = eventData.data.executionId;
                      if (eventData.data.error) {
                        updates.error = eventData.data.error;
                      }
                      break;
                  }

                  return { ...prev, ...updates };
                });
              } catch (e) {
                console.error("[SSE] Failed to parse event:", e);
              }
            }
          }
        }

        // 检查最终状态
        setState((prev) => {
          if (prev.status === "running") {
            return { ...prev, status: "completed" };
          }
          return prev;
        });

        // 调用完成回调
        setState((prev) => {
          if (prev.report) {
            options.onComplete?.(prev.report);
          }
          return prev;
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // 用户取消
          setState((prev) => ({ ...prev, status: "cancelled" }));
          return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        setState((prev) => ({ ...prev, status: "failed", error: errorMessage }));
        options.onError?.(errorMessage);
      }
    },
    [options]
  );

  /**
   * 取消工作流
   */
  const cancelWorkflow = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((prev) => ({ ...prev, status: "cancelled" }));
  }, []);

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setState({
      status: "idle",
      events: [],
      currentTool: null,
      thinkingText: "",
      outputText: "",
      terminalOutput: "",
      report: null,
      error: null,
      executionId: null,
      startTime: null,
    });
  }, []);

  return {
    ...state,
    startWorkflow,
    cancelWorkflow,
    reset,
  };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取事件的显示文本
 */
export function getEventDisplayText(event: AgentWorkflowEvent): string {
  switch (event.type) {
    case "thinking":
      return event.data.text.length > 50
        ? event.data.text.substring(0, 50) + "..."
        : event.data.text;
    case "tool_use":
      return `使用工具: ${event.data.name}`;
    case "tool_result":
      return `${event.data.name} 完成`;
    case "text":
      return event.data.text.length > 50
        ? event.data.text.substring(0, 50) + "..."
        : event.data.text;
    case "report":
      return `报告已生成: ${event.data.reportId.substring(0, 8)}...`;
    case "complete":
      return event.data.status === "completed" ? "分析完成" : `失败: ${event.data.error}`;
    default:
      return "未知事件";
  }
}

/**
 * 获取事件的图标类型
 */
export function getEventIconType(
  event: AgentWorkflowEvent
): "thinking" | "tool_use" | "tool_result" | "text" | "report" | "complete" | "terminal" {
  return event.type;
}
