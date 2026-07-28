/**
 * @package @devscope/web/app/analysis/health
 * @description 健康度报告页面
 *
 * 深度分析单个 GitHub 仓库的健康状况，
 * 从 8 大维度进行全面评估。
 *
 * @module page
 */

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AgentThinkingView } from "@/components/agent-thinking-view";
import { HealthReportView } from "@/components/health-report-view";
import { AnimatedBackground } from "@/components/animated-background";
import { ExecutionTimer } from "@/components/execution-timer";
import { useAgentWorkflow } from "@/hooks/use-agent-workflow";
import { Activity, FileCode, GitCommit, HeartPulse, Loader2, MessageSquare, Play, RotateCcw, Users } from "lucide-react";

// ============================================================================
// 页面组件
// ============================================================================

export default function HealthReportPage() {
  const [repo, setRepo] = useState<string>("");
  const [context, setContext] = useState<string>("");
  const [inputError, setInputError] = useState<string | null>(null);

  const {
    status,
    events,
    currentTool,
    thinkingText,
    outputText,
    terminalOutput,
    report,
    error,
    executionId,
    startTime,
    startWorkflow,
    cancelWorkflow,
    reset,
  } = useAgentWorkflow({
    storageKey: "health",
    onComplete: (report) => {
      console.log("Health report completed:", report);
    },
    onError: (error) => {
      console.error("Health report failed:", error);
    },
  });

  // 从仓库详情页进入时预填 owner/repo，不覆盖用户已恢复的输入状态。
  useEffect(() => {
    const repoFromUrl = new URLSearchParams(window.location.search).get("repo");
    if (repoFromUrl) {
      setRepo((currentRepo) => currentRepo || repoFromUrl);
    }
  }, []);

  /**
   * 开始分析
   */
  const handleStart = () => {
    const repoClean = repo.trim();

    if (!repoClean || !repoClean.includes("/")) {
      setInputError("请输入有效的仓库地址，格式为 owner/repo。");
      return;
    }

    setInputError(null);
    startWorkflow({
      repos: [repoClean],
      analysisType: "health_report",
      context: context || undefined,
    });
  };

  /**
   * 重置
   */
  const handleReset = () => {
    reset();
    setRepo("");
    setContext("");
    setInputError(null);
  };

  const isRunning = status === "running";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <div className="container mx-auto max-w-5xl px-4 py-6 sm:py-8">
        {/* 页面标题 */}
        <header className="command-page-header mb-8">
          <p className="command-kicker">分析视口</p>
          <h1 className="text-2xl font-semibold tracking-tight">仓库健康度评估</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            从 8 大维度深度分析 GitHub 仓库的健康状况
          </p>

          {/* 维度说明 */}
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { icon: GitCommit, label: "代码活跃度" },
              { icon: Users, label: "社区参与度" },
              { icon: MessageSquare, label: "Issue 管理" },
              { icon: FileCode, label: "技术质量" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-2 rounded-lg border border-border/80 bg-card p-3"
              >
                <item.icon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{item.label}</span>
              </div>
            ))}
          </div>
        </header>

        {/* 输入区域 */}
        {!isCompleted && !isRunning && (
          <div>
            <Card className="command-surface mb-6">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <HeartPulse className="h-5 w-5 text-primary" />
                      开始健康度评估
                    </CardTitle>
                    <CardDescription className="mt-2">
                      输入仓库地址，AI Agent 将从 8 大维度进行全面分析
                    </CardDescription>
                  </div>
                  <div className="hidden h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-primary/10 md:flex">
                    <Activity className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {/* 仓库输入 */}
                <div>
                  <Label htmlFor="repo" className="mb-2 block text-base font-medium">
                    仓库地址
                  </Label>
                  <p className="mb-2 text-sm text-muted-foreground">
                    格式: owner/repo（例如：RubyMetric/chsrc）
                  </p>
                  <Textarea
                    id="repo"
                    value={repo}
                    onChange={(e) => {
                      setRepo(e.target.value);
                      if (inputError) setInputError(null);
                    }}
                    placeholder="RubyMetric/chsrc"
                    rows={2}
                    disabled={isRunning}
                    className="font-mono text-lg"
                    aria-invalid={Boolean(inputError)}
                    aria-describedby={inputError ? "repo-input-error" : undefined}
                  />
                  {inputError && (
                    <p id="repo-input-error" role="alert" className="mt-2 text-sm text-destructive">
                      {inputError}
                    </p>
                  )}
                </div>

                {/* 额外上下文 */}
                <div>
                  <Label htmlFor="context" className="mb-2 block text-base font-medium">
                    分析重点 (可选)
                  </Label>
                  <Textarea
                    id="context"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="例如：我特别关注社区的活跃度和项目的可持续性..."
                    rows={3}
                    disabled={isRunning}
                  />
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-3">
                  <Button onClick={handleStart} disabled={isRunning} size="lg">
                    {isRunning ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                        分析中...
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        开始评估
                      </>
                    )}
                  </Button>

                  {/* 执行计时器 */}
                  {isRunning && (
                    <ExecutionTimer isRunning={isRunning} startTime={startTime || undefined} />
                  )}

                  {isRunning && (
                    <Button variant="outline" onClick={cancelWorkflow} size="lg">
                      取消
                    </Button>
                  )}

                  {(isCompleted || isFailed) && (
                    <Button variant="outline" onClick={handleReset} size="lg">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      重新评估
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 错误显示 */}
        {isFailed && (
          <div className="mb-6">
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-6">
                <div className="flex items-center gap-3 text-destructive">
                  <Activity className="h-6 w-6" />
                  <div>
                    <p className="font-medium">分析失败</p>
                    <p className="mt-1 text-sm">{error}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 恢复状态提示 */}
        {isRunning && events.length === 0 && (
          <div className="mb-6">
            <Card className="border-signal/30 bg-signal/10">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-signal">
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    <p>正在恢复分析状态，服务器仍在处理中...</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    <RotateCcw className="mr-1 h-4 w-4" />
                    重新分析
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Agent 思考过程展示 */}
        {(isRunning || (isCompleted && !report)) && (
          <AgentThinkingView
            status={status}
            events={events}
            currentTool={currentTool}
            thinkingText={thinkingText}
            outputText={outputText}
            terminalOutput={terminalOutput}
          />
        )}

        {/* 报告展示 */}
        {isCompleted && executionId && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">健康度报告</h2>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="mr-2 h-4 w-4" />
                新建分析
              </Button>
            </div>
            <HealthReportView reportId={executionId} executionId={executionId} />
          </div>
        )}
      </div>
    </main>
  );
}
