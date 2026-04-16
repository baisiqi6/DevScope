/**
 * @package @devscope/web/hooks
 * @description Agent 工作流 SSE 客户端 Hook
 *
 * 提供 React Hook 用于连接 SSE 端点，实时接收 Agent 思考过程。
 * 支持通过 sessionStorage 持久化工作流状态，导航后可恢复。
 *
 * @module use-agent-workflow
 */

import { useState, useCallback, useRef, useEffect } from "react";
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
  /** 分析类型，用于 sessionStorage key 区分 */
  analysisType: "competitive_landscape" | "health_report" | "single_repo";
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

/**
 * sessionStorage 中持久化的状态
 */
interface PersistedWorkflowState {
  executionId: string | null;
  status: WorkflowStatus;
  report: ReportResult | null;
  error: string | null;
  startTime: number | null;
  workflowInput: WorkflowInput | null;
}

// ============================================================================
// sessionStorage 辅助函数
// ============================================================================

const STORAGE_KEY_PREFIX = "devscope:workflow";

function getStorageKey(analysisType: string): string {
  return `${STORAGE_KEY_PREFIX}:${analysisType}`;
}

function saveToStorage(analysisType: string, state: PersistedWorkflowState): void {
  try {
    sessionStorage.setItem(getStorageKey(analysisType), JSON.stringify(state));
  } catch (e) {
    console.warn("[useAgentWorkflow] Failed to save to sessionStorage:", e);
  }
}

function loadFromStorage(analysisType: string): PersistedWorkflowState | null {
  try {
    const raw = sessionStorage.getItem(getStorageKey(analysisType));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedWorkflowState;
  } catch (e) {
    console.warn("[useAgentWorkflow] Failed to load from sessionStorage:", e);
    return null;
  }
}

function clearStorage(analysisType: string): void {
  try {
    sessionStorage.removeItem(getStorageKey(analysisType));
  } catch (e) {
    console.warn("[useAgentWorkflow] Failed to clear sessionStorage:", e);
  }
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
 *   analysisType: "competitive_landscape",
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
export function useAgentWorkflow(options: UseAgentWorkflowOptions) {
  const { analysisType } = options;

  // 从 sessionStorage 恢复初始状态
  const getInitialState = (): WorkflowState => {
    const persisted = loadFromStorage(analysisType);
    if (persisted && persisted.executionId) {
      if (
        persisted.status === "completed" ||
        persisted.status === "failed" ||
        persisted.status === "cancelled"
      ) {
        return {
          status: persisted.status,
          events: [],
          currentTool: null,
          thinkingText: "",
          outputText: "",
          terminalOutput: "",
          report: persisted.report,
          error: persisted.error,
          executionId: persisted.executionId,
          startTime: persisted.startTime,
        };
      }
      if (persisted.status === "running") {
        // 恢复轮询逻辑会在 useEffect 中处理
        return {
          status: "running",
          events: [],
          currentTool: null,
          thinkingText: "",
          outputText: "",
          terminalOutput: "",
          report: null,
          error: null,
          executionId: persisted.executionId,
          startTime: persisted.startTime,
        };
      }
    }
    return {
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
    };
  };

  const [state, setState] = useState<WorkflowState>(getInitialState);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentInputRef = useRef<WorkflowInput | null>(null);
  const recoveryAttemptedRef = useRef(false);
  const isStartWorkflowRef = useRef(false);

  // 恢复轮询：当从 sessionStorage 恢复了 running 状态时，轮询后端确认实际状态
  useEffect(() => {
    if (recoveryAttemptedRef.current) return;
    if (isStartWorkflowRef.current) return;
    if (state.status !== "running" || !state.executionId) return;

    recoveryAttemptedRef.current = true;

    const POLL_INTERVAL = 3000; // 3 秒
    const MAX_POLL_ATTEMPTS = 200; // ~10 分钟

    let attempts = 0;
    let cancelled = false;

    async function checkStatus() {
      if (cancelled) return;

      try {
        const response = await fetch(`/api/workflow/status/${state.executionId}`);

        if (!response.ok) {
          if (response.status === 404) {
            setState((prev) => ({
              ...prev,
              status: "failed",
              error: "工作流执行记录未找到，可能服务已重启",
            }));
            clearStorage(analysisType);
            return;
          }
          attempts++;
          if (attempts < MAX_POLL_ATTEMPTS) {
            setTimeout(checkStatus, POLL_INTERVAL);
          } else {
            setState((prev) => ({
              ...prev,
              status: "failed",
              error: "多次尝试后无法连接服务器",
            }));
          }
          return;
        }

        const data = await response.json();

        if (data.status === "completed") {
          // 后端已完成，加载报告
          try {
            const reportResponse = await fetch(`/api/reports/${state.executionId}`);
            if (reportResponse.ok) {
              const reportData = await reportResponse.json();
              setState((prev) => ({
                ...prev,
                status: "completed",
                report: {
                  reportId: reportData.reportId || state.executionId!,
                  reportPath: "",
                  summary: reportData.executiveSummary?.overview || "分析完成",
                },
                executionId: data.executionId,
              }));
            } else {
              setState((prev) => ({
                ...prev,
                status: "completed",
                report: {
                  reportId: state.executionId!,
                  reportPath: "",
                  summary: "分析完成",
                },
              }));
            }
          } catch {
            setState((prev) => ({
              ...prev,
              status: "completed",
              report: {
                reportId: state.executionId!,
                reportPath: "",
                summary: "分析完成",
              },
            }));
          }
        } else if (data.status === "failed") {
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: data.error || "工作流在服务器上执行失败",
          }));
        } else if (data.status === "running" || data.status === "pending") {
          attempts++;
          if (attempts < MAX_POLL_ATTEMPTS) {
            setTimeout(checkStatus, POLL_INTERVAL);
          }
        } else {
          // cancelled 等其他状态
          setState((prev) => ({ ...prev, status: data.status }));
        }
      } catch (err) {
        console.error("[useAgentWorkflow] Recovery poll error:", err);
        attempts++;
        if (attempts < MAX_POLL_ATTEMPTS) {
          setTimeout(checkStatus, POLL_INTERVAL);
        }
      }
    }

    checkStatus();

    return () => {
      cancelled = true;
    };
  }, [state.status, state.executionId, analysisType]);

  // 持久化状态到 sessionStorage
  useEffect(() => {
    if (state.status === "idle" && !state.executionId) return;

    saveToStorage(analysisType, {
      executionId: state.executionId,
      status: state.status,
      report: state.report,
      error: state.error,
      startTime: state.startTime,
      workflowInput: currentInputRef.current,
    });
  }, [state.status, state.executionId, state.report, state.error, state.startTime, analysisType]);

  /**
   * 启动工作流
   */
  const startWorkflow = useCallback(
    async (input: WorkflowInput) => {
      currentInputRef.current = input;
      isStartWorkflowRef.current = true;
      recoveryAttemptedRef.current = true; // 防止恢复轮询干扰新的工作流

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
      } finally {
        isStartWorkflowRef.current = false;
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
    clearStorage(analysisType);
    currentInputRef.current = null;
    recoveryAttemptedRef.current = false;
    isStartWorkflowRef.current = false;
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
  }, [analysisType]);

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
