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
import { Navigation } from "@/components/navigation";
import { AnimatedBackground } from "@/components/animated-background";
import { useAgentWorkflow } from "@/hooks/use-agent-workflow";
import { AlertCircle, Play, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";

// ============================================================================
// 页面组件
// ============================================================================

export default function CompetitiveAnalysisPage() {
  const [repos, setRepos] = useState<string>("");
  const [context, setContext] = useState<string>("");
  const [analysisType, setAnalysisType] = useState<"competitive_landscape" | "health_report" | "single_repo">(
    "competitive_landscape"
  );

  const {
    status,
    events,
    currentTool,
    thinkingText,
    outputText,
    report,
    error,
    executionId,
    startWorkflow,
    cancelWorkflow,
    reset,
  } = useAgentWorkflow({
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
      alert("请输入至少一个有效的仓库 (owner/repo 格式)");
      return;
    }

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
  };

  const isRunning = status === "running";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  return (
    <main className="min-h-screen">
      {/* 动画背景 */}
      <AnimatedBackground />

      {/* Header */}
      <header className="border-b border-slate-200/60 bg-white/70 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <motion.h1
            className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            DevScope
          </motion.h1>
          <Navigation />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">竞争格局分析</h1>
        <p className="text-gray-500 dark:text-gray-400">
          输入多个 GitHub 仓库，AI Agent 将自主完成数据采集、健康度分析和竞争格局对比，
          生成可追溯的分析报告。
        </p>
      </div>

      {/* 输入区域 */}
      {!isCompleted && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>分析配置</CardTitle>
            <CardDescription>配置要分析的仓库和分析类型</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 分析类型选择 */}
            <div>
              <Label className="text-base font-medium mb-3 block">分析类型</Label>
              <RadioGroup
                value={analysisType}
                onValueChange={(value) => setAnalysisType(value as any)}
                disabled={isRunning}
                className="grid grid-cols-3 gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="competitive_landscape" id="competitive" />
                  <Label htmlFor="competitive" className="cursor-pointer">
                    竞争格局分析
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="health_report" id="health" />
                  <Label htmlFor="health" className="cursor-pointer">
                    健康度报告
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="single_repo" id="single" />
                  <Label htmlFor="single" className="cursor-pointer">
                    单仓库分析
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* 仓库列表 */}
            <div>
              <Label htmlFor="repos" className="text-base font-medium mb-2 block">
                仓库列表
              </Label>
              <p className="text-sm text-gray-500 mb-2">
                每行一个仓库，格式: owner/repo
              </p>
              <Textarea
                id="repos"
                value={repos}
                onChange={(e) => setRepos(e.target.value)}
                placeholder={`vercel/next.js\nfacebook/react\nvuejs/vue\nsveltejs/svelte`}
                rows={6}
                disabled={isRunning}
                className="font-mono"
              />
            </div>

            {/* 额外上下文 */}
            <div>
              <Label htmlFor="context" className="text-base font-medium mb-2 block">
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
            <div className="flex gap-3">
              <Button onClick={handleStart} disabled={isRunning} size="lg">
                {isRunning ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    分析中...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    开始分析
                  </>
                )}
              </Button>

              {isRunning && (
                <Button variant="outline" onClick={cancelWorkflow} size="lg">
                  取消
                </Button>
              )}

              {(isCompleted || isFailed) && (
                <Button variant="outline" onClick={handleReset} size="lg">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  重新分析
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 错误显示 */}
      {error && (
        <Card className="mb-6 border-red-200 bg-red-50 dark:bg-red-950">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
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
          status={status}
        />
      )}

      {/* 报告展示 */}
      {isCompleted && report && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">分析报告</h2>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              新建分析
            </Button>
          </div>
          <ReportView reportId={report.reportId} executionId={executionId || undefined} />
        </div>
      )}

      {/* 使用说明 */}
      {!isRunning && events.length === 0 && !isCompleted && (
        <Card className="mt-8 bg-gray-50 dark:bg-gray-900">
          <CardHeader>
            <CardTitle className="text-lg">使用说明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium mb-2">分析流程</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                  <li>输入要分析的 GitHub 仓库列表</li>
                  <li>选择分析类型</li>
                  <li>点击"开始分析"</li>
                  <li>观察 Agent 实时思考过程</li>
                  <li>查看生成的结构化报告</li>
                </ol>
              </div>
              <div>
                <h4 className="font-medium mb-2">分析类型说明</h4>
                <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
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

            <div className="pt-4 border-t dark:border-gray-700">
              <h4 className="font-medium mb-2">报告内容</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
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
