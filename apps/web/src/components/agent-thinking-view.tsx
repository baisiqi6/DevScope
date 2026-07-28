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
import { Loader2, CheckCircle2, Wrench, FileText, Brain, AlertCircle, Terminal } from "lucide-react";
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
  /** 终端输出累积 */
  terminalOutput: string;
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
  terminalOutput,
  status,
}: AgentThinkingViewProps) {
  return (
    <Card className="command-surface w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <StatusIcon status={status} />
          <span>Agent 思考过程</span>
          {status === "running" && (
            <Badge variant="secondary" className="ml-2">
              运行中
            </Badge>
          )}
          {status === "completed" && (
            <Badge className="ml-2 bg-success text-success-foreground">完成</Badge>
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
          <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 p-3">
            <Wrench className="h-4 w-4 text-primary" />
            <span className="text-sm text-primary">正在使用工具:</span>
            <Badge variant="outline" className="bg-background">
              {getToolLabel(currentTool)}
            </Badge>
          </div>
        )}

        {/* 思考文本 */}
        {thinkingText && (
          <div className="rounded-lg border border-border/60 bg-muted/60 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">思考中...</span>
            </div>
            <ScrollArea className="max-h-[150px]">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{thinkingText}</p>
            </ScrollArea>
          </div>
        )}

        {/* 输出文本 */}
        {outputText && (
          <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">输出</span>
            </div>
            <ScrollArea className="max-h-[200px]">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{outputText}</p>
            </ScrollArea>
          </div>
        )}

        {/* 终端输出 */}
        {terminalOutput && (
          <div className="rounded-lg border border-border/80 bg-background p-4">
            <div className="mb-2 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">终端输出</span>
            </div>
            <ScrollArea className="max-h-[300px]">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                {terminalOutput}
              </pre>
            </ScrollArea>
          </div>
        )}

        {/* 事件时间线 */}
        {events.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">
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
          <div className="py-8 text-center text-muted-foreground">
            <Brain className="mx-auto mb-2 h-12 w-12 opacity-50" />
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
      return <Loader2 className="h-5 w-5 animate-spin text-signal motion-reduce:animate-none" />;
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-success" />;
    case "failed":
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    case "cancelled":
      return <span className="text-sm text-warning">已取消</span>;
    default:
      return <Brain className="h-5 w-5 text-muted-foreground" />;
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
    <div className="flex items-start gap-2 rounded p-2 transition-colors duration-150 hover:bg-muted/50">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{content}</p>
        <p className="text-xs text-muted-foreground">{time}</p>
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
      return <Brain className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />;
    case "tool_use":
      return <Wrench className="mt-0.5 h-4 w-4 flex-shrink-0 text-signal" />;
    case "tool_result":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />;
    case "text":
      return <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />;
    case "terminal":
      return <Terminal className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />;
    case "report":
      return <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />;
    case "complete":
      return event.data.status === "completed" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
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
    case "terminal":
      const msg = event.data.message;
      return msg.length > 80 ? msg.substring(0, 80) + "..." : msg;
    case "report":
      return `报告已生成: ${event.data.summary.substring(0, 50)}...`;
    case "complete":
      return event.data.status === "completed"
        ? "分析完成"
        : `失败: ${event.data.error}`;
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
