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

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AgentThinkingView } from "@/components/agent-thinking-view";
import { HealthReportView } from "@/components/health-report-view";
import { Navigation } from "@/components/navigation";
import { AnimatedBackground } from "@/components/animated-background";
import { ExecutionTimer } from "@/components/execution-timer";
import { useAgentWorkflow } from "@/hooks/use-agent-workflow";
import { Activity, Play, RotateCcw, HeartPulse, GitCommit, Users, MessageSquare, FileCode } from "lucide-react";
import { motion } from "framer-motion";

// ============================================================================
// 页面组件
// ============================================================================

export default function HealthReportPage() {
  const [repo, setRepo] = useState<string>("");
  const [context, setContext] = useState<string>("");

  const {
    status,
    events,
    currentTool,
    thinkingText,
    outputText,
    report,
    error,
    executionId,
    startTime,
    startWorkflow,
    cancelWorkflow,
    reset,
  } = useAgentWorkflow({
    analysisType: "health_report",
    onComplete: (report) => {
      console.log("Health report completed:", report);
    },
    onError: (error) => {
      console.error("Health report failed:", error);
    },
  });

  /**
   * 开始分析
   */
  const handleStart = () => {
    const repoClean = repo.trim();

    if (!repoClean || !repoClean.includes("/")) {
      alert("请输入有效的仓库地址 (格式: owner/repo)");
      return;
    }

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
            className="text-2xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            DevScope - 健康度报告
          </motion.h1>
          <Navigation />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* 页面标题 */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-md">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">仓库健康度评估</h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                从 8 大维度深度分析 GitHub 仓库的健康状况
              </p>
            </div>
          </div>

          {/* 维度说明 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[
              { icon: GitCommit, label: "代码活跃度", color: "blue" },
              { icon: Users, label: "社区参与度", color: "green" },
              { icon: MessageSquare, label: "Issue 管理", color: "purple" },
              { icon: FileCode, label: "技术质量", color: "orange" },
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="flex items-center gap-2 p-3 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700"
              >
                <item.icon className={`h-4 w-4 text-${item.color}-500`} />
                <span className="text-sm font-medium">{item.label}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* 输入区域 */}
        {!isCompleted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <Card className="mb-6 border-2 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl flex items-center gap-2">
                      <HeartPulse className="h-6 w-6 text-green-600" />
                      开始健康度评估
                    </CardTitle>
                    <CardDescription className="mt-2 text-base">
                      输入仓库地址，AI Agent 将从 8 大维度进行全面分析
                    </CardDescription>
                  </div>
                  <div className="hidden md:flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <Activity className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {/* 仓库输入 */}
                <div>
                  <Label htmlFor="repo" className="text-base font-medium mb-2 block">
                    仓库地址
                  </Label>
                  <p className="text-sm text-gray-500 mb-2">
                    格式: owner/repo（例如：RubyMetric/chsrc）
                  </p>
                  <Textarea
                    id="repo"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="RubyMetric/chsrc"
                    rows={2}
                    disabled={isRunning}
                    className="font-mono text-lg"
                  />
                </div>

                {/* 额外上下文 */}
                <div>
                  <Label htmlFor="context" className="text-base font-medium mb-2 block">
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
                <div className="flex gap-3 items-center">
                  <Button
                    onClick={handleStart}
                    disabled={isRunning}
                    size="lg"
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                  >
                    {isRunning ? (
                      <>
                        <span className="animate-spin mr-2">⏳</span>
                        分析中...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
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
                      <RotateCcw className="h-4 w-4 mr-2" />
                      重新评估
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* 错误显示 */}
        {isFailed && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Card className="border-red-200 bg-red-50 dark:bg-red-900/20">
              <CardContent className="py-6">
                <div className="flex items-center gap-3 text-red-600">
                  <Activity className="h-6 w-6" />
                  <div>
                    <p className="font-medium">分析失败</p>
                    <p className="text-sm text-red-500 mt-1">{error}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* 恢复状态提示 */}
        {isRunning && events.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/30">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                  <span className="animate-spin">⏳</span>
                  <p>正在恢复分析状态，服务器仍在处理中...</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Agent 思考过程展示 */}
        {(isRunning || (isCompleted && !report)) && (
          <AgentThinkingView
            status={status}
            events={events}
            currentTool={currentTool}
            thinkingText={thinkingText}
            outputText={outputText}
          />
        )}

        {/* 报告展示 */}
        {isCompleted && executionId && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <HealthReportView reportId={executionId} executionId={executionId} />
          </motion.div>
        )}
      </div>
    </main>
  );
}
