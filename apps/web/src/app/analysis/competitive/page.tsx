/**
 * @package @devscope/web/app/analysis/competitive
 * @description 竞争格局分析页面
 *
 * 用户输入仓库列表，Agent 自主完成竞争格局分析，
 * 通过 SSE 实时展示思考过程，最终生成可追溯的分析报告。
 *
 * @module page
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AgentThinkingView } from "@/components/agent-thinking-view";
import { ReportView } from "@/components/report-view";
import { AnimatedBackground } from "@/components/animated-background";
import { ExecutionTimer } from "@/components/execution-timer";
import { useAgentWorkflow } from "@/hooks/use-agent-workflow";
import { AlertCircle, GitCompare, Loader2, Play, RotateCcw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// 页面组件
// ============================================================================

export default function CompetitiveAnalysisPage() {
  const [repos, setRepos] = useState<string>("");
  const [context, setContext] = useState<string>("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [analysisType, setAnalysisType] = useState<"competitive_landscape" | "single_repo">(
    "competitive_landscape"
  );

  // 根据分析类型获取标题和描述
  const getAnalysisTypeConfig = () => {
    switch (analysisType) {
      case "competitive_landscape":
        return {
          title: "竞争格局分析",
          description: "输入多个 GitHub 仓库，AI Agent 将自主完成数据采集、健康度分析和竞争格局对比，生成可追溯的分析报告。",
          placeholder: "vercel/next.js\nfacebook/react\nvuejs/vue\nsveltejs/svelte",
          icon: <TrendingUp className="h-6 w-6 text-primary" />,
        };
      case "single_repo":
        return {
          title: "单仓库分析",
          description: "输入单个 GitHub 仓库，AI Agent 将快速生成概览报告，包含关键指标、风险因素和投资建议。",
          placeholder: "RubyMetric/chsrc",
          icon: <GitCompare className="h-6 w-6 text-primary" />,
        };
    }
  };

  const config = getAnalysisTypeConfig();

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
    storageKey: "competitive",
    onComplete: (report) => {
      console.log("Analysis completed:", report);
    },
    onError: (error) => {
      console.error("Analysis failed:", error);
    },
  });

  /**
   * 开始分析
   */
  const handleStart = () => {
    const repoList = repos
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && r.includes("/"));

    if (repoList.length === 0) {
      setInputError("请至少输入一个有效仓库，格式为 owner/repo。");
      return;
    }

    setInputError(null);
    startWorkflow({
      repos: repoList,
      analysisType,
      context: context || undefined,
    });
  };

  /**
   * 重置
   */
  const handleReset = () => {
    reset();
    setRepos("");
    setContext("");
    setInputError(null);
  };

  const isRunning = status === "running";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <div className="container mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {/* 页面标题 */}
        <header className="command-page-header mb-8">
          <p className="command-kicker">分析视口</p>
          <div className="flex items-center gap-3">
            {config.icon}
            <h1 className="text-2xl font-semibold tracking-tight">{config.title}</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{config.description}</p>
        </header>

        {/* 输入区域 */}
        {!isCompleted && !isRunning && (
          <div>
            <Card className="command-surface mb-6">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <Play className="h-5 w-5 text-primary" />
                      开始分析
                    </CardTitle>
                    <CardDescription className="mt-2">
                      选择分析类型，输入仓库地址，AI Agent 将自动完成分析
                    </CardDescription>
                  </div>
                  <div className="hidden h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-primary/10 md:flex">
                    {analysisType === "competitive_landscape" ? (
                      <TrendingUp className="h-5 w-5 text-primary" />
                    ) : (
                      <GitCompare className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {/* 分析类型选择 */}
                <div>
                  <Label className="mb-3 block text-base font-medium">选择分析类型</Label>
                  <RadioGroup
                    value={analysisType}
                    onValueChange={(value) => setAnalysisType(value as "competitive_landscape" | "single_repo")}
                    disabled={isRunning}
                    className="grid grid-cols-1 gap-3 md:grid-cols-2"
                  >
                    {/* 竞争格局分析 */}
                    <div
                      className={cn(
                        "relative flex h-full min-h-[120px] cursor-pointer flex-col rounded-lg border p-4 transition-colors duration-150",
                        analysisType === "competitive_landscape"
                          ? "border-primary/50 bg-primary/5"
                          : "border-border hover:border-border-hover hover:bg-card-hover",
                        isRunning && "cursor-not-allowed opacity-50"
                      )}
                      onClick={() => !isRunning && setAnalysisType("competitive_landscape")}
                    >
                      <div className="flex flex-1 items-start space-x-3">
                        <RadioGroupItem value="competitive_landscape" id="competitive" className="mt-1" />
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <TrendingUp
                              className={cn(
                                "h-5 w-5",
                                analysisType === "competitive_landscape" ? "text-primary" : "text-muted-foreground"
                              )}
                            />
                            <Label htmlFor="competitive" className="cursor-pointer font-semibold">
                              竞争格局分析
                            </Label>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            对比多个仓库，分析市场定位、技术栈差异和竞争关系
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* 单仓库分析 */}
                    <div
                      className={cn(
                        "relative flex h-full min-h-[120px] cursor-pointer flex-col rounded-lg border p-4 transition-colors duration-150",
                        analysisType === "single_repo"
                          ? "border-primary/50 bg-primary/5"
                          : "border-border hover:border-border-hover hover:bg-card-hover",
                        isRunning && "cursor-not-allowed opacity-50"
                      )}
                      onClick={() => !isRunning && setAnalysisType("single_repo")}
                    >
                      <div className="flex flex-1 items-start space-x-3">
                        <RadioGroupItem value="single_repo" id="single" className="mt-1" />
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <GitCompare
                              className={cn(
                                "h-5 w-5",
                                analysisType === "single_repo" ? "text-primary" : "text-muted-foreground"
                              )}
                            />
                            <Label htmlFor="single" className="cursor-pointer font-semibold">
                              单仓库分析
                            </Label>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            快速获取单个仓库的概览、关键指标和投资建议
                          </p>
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                {/* 仓库列表 */}
                <div>
                  <Label htmlFor="repos" className="mb-2 block text-base font-medium">
                    仓库列表
                  </Label>
                  <p className="mb-2 text-sm text-muted-foreground">每行一个仓库，格式: owner/repo</p>
                  <Textarea
                    id="repos"
                    value={repos}
                    onChange={(e) => {
                      setRepos(e.target.value);
                      if (inputError) setInputError(null);
                    }}
                    placeholder={config.placeholder}
                    rows={6}
                    disabled={isRunning}
                    className="font-mono"
                    aria-invalid={Boolean(inputError)}
                    aria-describedby={inputError ? "repos-input-error" : undefined}
                  />
                  {inputError && (
                    <p id="repos-input-error" role="alert" className="mt-2 text-sm text-destructive">
                      {inputError}
                    </p>
                  )}
                </div>

                {/* 额外上下文 */}
                <div>
                  <Label htmlFor="context" className="mb-2 block text-base font-medium">
                    额外上下文 (可选)
                  </Label>
                  <Textarea
                    id="context"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="例如：我正在评估前端框架的投资方向，重点关注性能和生态..."
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
                        开始分析
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
                      重新分析
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 错误显示 */}
        {error && (
          <Card className="mb-6 border-destructive/30 bg-destructive/5">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <p>{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 恢复状态提示 */}
        {isRunning && events.length === 0 && (
          <Card className="mb-6 border-signal/30 bg-signal/10">
            <CardContent className="pt-4">
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
        )}

        {/* 实时思考过程 */}
        {(isRunning || events.length > 0) && !isCompleted && (
          <AgentThinkingView
            events={events}
            currentTool={currentTool}
            thinkingText={thinkingText}
            outputText={outputText}
            terminalOutput={terminalOutput}
            status={status}
          />
        )}

        {/* 报告展示 */}
        {isCompleted && report && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">分析报告</h2>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="mr-2 h-4 w-4" />
                新建分析
              </Button>
            </div>
            <ReportView reportId={report.reportId} executionId={executionId || undefined} />
          </div>
        )}

        {/* 使用说明 */}
        {!isRunning && events.length === 0 && !isCompleted && (
          <Card className="command-surface mt-8">
            <CardHeader>
              <CardTitle className="text-lg">使用说明</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h4 className="mb-2 font-medium">分析流程</h4>
                  <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                    <li>输入要分析的 GitHub 仓库列表</li>
                    <li>选择分析类型</li>
                    <li>点击“开始分析”</li>
                    <li>观察 Agent 实时思考过程</li>
                    <li>查看生成的结构化报告</li>
                  </ol>
                </div>
                <div>
                  <h4 className="mb-2 font-medium">分析类型说明</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li>
                      <strong>竞争格局分析</strong>: 对比多个项目，分析市场定位
                    </li>
                    <li>
                      <strong>健康度报告</strong>: 评估项目的整体健康程度
                    </li>
                    <li>
                      <strong>单仓库分析</strong>: 深入分析单个项目
                    </li>
                  </ul>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="mb-2 font-medium">报告内容</h4>
                <p className="text-sm text-muted-foreground">
                  生成的报告将包含：执行摘要、市场定位分析、技术对比、社区指标、风险矩阵、
                  投资建议和数据来源追溯。所有分析结论都有数据支撑，确保可追溯、可验证。
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
