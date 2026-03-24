/**
 * @package @devscope/web/components
 * @description Agent 思考过程可视化组件
 *
 * 实时展示 Agent 的思考过程、工具调用和事件时间线。
 *
 * @module agent-thinking-view
 */

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, Wrench, FileText, Brain, AlertCircle } from "lucide-react";
import type { AgentWorkflowEvent } from "@devscope/shared";
import type { WorkflowStatus } from "@/hooks/use-agent-workflow";

// ============================================================================
// 类型定义
// ============================================================================

interface AgentThinkingViewProps {
  /** 所有事件列表 */
  events: AgentWorkflowEvent[];
  /** 当前正在使用的工具 */
  currentTool: string | null;
  /** 思考文本累积 */
  thinkingText: string;
  /** 输出文本累积 */
  outputText: string;
  /** 当前状态 */
  status: WorkflowStatus;
}

// ============================================================================
// 主组件
// ============================================================================

export function AgentThinkingView({
  events,
  currentTool,
  thinkingText,
  outputText,
  status,
}: AgentThinkingViewProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StatusIcon status={status} />
          <span>Agent 思考过程</span>
          {status === "running" && (
            <Badge variant="secondary" className="ml-2">
              运行中
            </Badge>
          )}
          {status === "completed" && (
            <Badge variant="default" className="ml-2 bg-green-500">
              完成
            </Badge>
          )}
          {status === "failed" && (
            <Badge variant="destructive" className="ml-2">
              失败
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 当前工具指示器 */}
        {currentTool && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg flex items-center gap-2">
            <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm text-blue-700 dark:text-blue-300">正在使用工具:</span>
            <Badge variant="outline" className="bg-white dark:bg-gray-800">
              {getToolLabel(currentTool)}
            </Badge>
          </div>
        )}

        {/* 思考文本 */}
        {thinkingText && (
          <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                思考中...
              </span>
            </div>
            <ScrollArea className="max-h-[150px]">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {thinkingText}
              </p>
            </ScrollArea>
          </div>
        )}

        {/* 输出文本 */}
        {outputText && (
          <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">输出</span>
            </div>
            <ScrollArea className="max-h-[200px]">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {outputText}
              </p>
            </ScrollArea>
          </div>
        )}

        {/* 事件时间线 */}
        {events.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
              事件时间线 ({events.length} 个事件)
            </h4>
            <ScrollArea className="h-[300px]">
              <div className="space-y-1">
                {events.map((event, index) => (
                  <EventItem key={index} event={event} />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* 空状态 */}
        {events.length === 0 && status === "idle" && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Brain className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>等待开始分析...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// 子组件
// ============================================================================

/**
 * 状态图标
 */
function StatusIcon({ status }: { status: WorkflowStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case "failed":
      return <AlertCircle className="h-5 w-5 text-red-500" />;
    case "cancelled":
      return <span className="text-yellow-500">已取消</span>;
    default:
      return <Brain className="h-5 w-5 text-gray-400" />;
  }
}

/**
 * 事件项
 */
function EventItem({ event }: { event: AgentWorkflowEvent }) {
  const icon = getEventIcon(event);
  const content = getEventContent(event);
  const time = new Date(event.data.timestamp).toLocaleTimeString();

  return (
    <div className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{content}</p>
        <p className="text-xs text-gray-400">{time}</p>
      </div>
    </div>
  );
}

/**
 * 获取事件图标
 */
function getEventIcon(event: AgentWorkflowEvent) {
  switch (event.type) {
    case "thinking":
      return <Brain className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />;
    case "tool_use":
      return <Wrench className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />;
    case "tool_result":
      return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />;
    case "text":
      return <FileText className="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5" />;
    case "report":
      return <FileText className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />;
    case "complete":
      return event.data.status === "completed" ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
      );
    default:
      return null;
  }
}

/**
 * 获取事件内容
 */
function getEventContent(event: AgentWorkflowEvent): string {
  switch (event.type) {
    case "thinking":
      const text = event.data.text;
      return text.length > 80 ? text.substring(0, 80) + "..." : text;
    case "tool_use":
      return `使用 ${getToolLabel(event.data.name)}`;
    case "tool_result":
      return `${getToolLabel(event.data.name)} 完成`;
    case "text":
      const output = event.data.text;
      return output.length > 80 ? output.substring(0, 80) + "..." : output;
    case "report":
      return `报告已生成: ${event.data.summary.substring(0, 50)}...`;
    case "complete":
      return event.data.status === "completed"
        ? "✅ 分析完成"
        : `❌ 失败: ${event.data.error}`;
    default:
      return "未知事件";
  }
}

/**
 * 获取工具标签
 */
function getToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    repo_fetch: "获取仓库数据",
    repo_analyze: "分析仓库健康度",
    report_generate: "生成报告",
  };
  return labels[tool] || tool;
}
