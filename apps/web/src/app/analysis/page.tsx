/**
 * @package @devscope/web
 * @description 分析结果页面
 *
 * 展示 Langcore 工作流的分析结果。
 */

"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedBackground } from "@/components/animated-background";
import { AnalysisResultView } from "@/components/analysis-result-view";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import type { RepositoryAnalysis } from "@devscope/shared";

interface RepoData {
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  updated_at: string;
}

interface AnalysisResult {
  execution_id: string;
  workflow_id: string;
  status: string;
  message: string;
  following_count?: number;
  repos?: string[];
  repo_data?: RepoData;
  analysis_result?: string;
  collected_count?: number;
}

function AnalysisContent() {
  const searchParams = useSearchParams();
  const executionId = searchParams.get("executionId");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // 尝试从 sessionStorage 获取之前的结果
  const [previousResult] = useState<AnalysisResult | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = sessionStorage.getItem("analysisResult");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse stored result:", e);
      }
    }
    return null;
  });

  const displayResult = result || previousResult;

  const handleSaveResult = () => {
    if (displayResult) {
      sessionStorage.setItem("analysisResult", JSON.stringify(displayResult));
      alert("结果已保存");
    }
  };

  return (
    <>
      {!displayResult ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">暂无分析结果</p>
          <Button
            className="mt-4"
            onClick={() => window.location.href = "/"}
          >
            返回首页开始分析
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 执行状态 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>执行状态</span>
                <span className={`px-3 py-1 rounded-full text-sm ${
                  displayResult.status === "completed"
                    ? "bg-green-100 text-green-800"
                    : displayResult.status === "running"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-red-100 text-red-800"
                }`}>
                  {displayResult.status === "completed" ? "已完成" :
                   displayResult.status === "running" ? "运行中" : displayResult.status}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">执行 ID</p>
                  <p className="font-mono text-sm">{displayResult.execution_id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">工作流 ID</p>
                  <p className="font-mono text-sm">{displayResult.workflow_id}</p>
                </div>
                {displayResult.following_count !== undefined && (
                  <div>
                    <p className="text-sm text-muted-foreground">仓库数量</p>
                    <p className="font-semibold">{displayResult.following_count}</p>
                  </div>
                )}
                {displayResult.repo_data && (
                  <div>
                    <p className="text-sm text-muted-foreground">分析仓库</p>
                    <a
                      href={displayResult.repo_data.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      {displayResult.repo_data.full_name}
                    </a>
                  </div>
                )}
                {displayResult.collected_count !== undefined && (
                  <div>
                    <p className="text-sm text-muted-foreground">本地采集数</p>
                    <p className="font-semibold">{displayResult.collected_count || 0}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 仓库列表 */}
          {displayResult.repos && displayResult.repos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>分析的仓库列表</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {displayResult.repos.map((repo) => (
                    <a
                      key={repo}
                      href={`https://github.com/${repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 border rounded hover:bg-muted transition-colors"
                    >
                      <span className="text-blue-600 hover:text-blue-800 text-sm">
                        {repo}
                      </span>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 单个仓库详情 */}
          {displayResult.repo_data && (
            <Card>
              <CardHeader>
                <CardTitle>仓库详情</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-muted-foreground">仓库名称</p>
                    <a
                      href={displayResult.repo_data.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-semibold"
                    >
                      {displayResult.repo_data.full_name}
                    </a>
                  </div>
                  {displayResult.repo_data.description && (
                    <div>
                      <p className="text-sm text-muted-foreground">描述</p>
                      <p className="text-sm">{displayResult.repo_data.description}</p>
                    </div>
                  )}
                  <div className="flex gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">⭐ Stars</p>
                      <p className="font-semibold">{displayResult.repo_data.stars.toLocaleString()}</p>
                    </div>
                    {displayResult.repo_data.language && (
                      <div>
                        <p className="text-muted-foreground">🔷 Language</p>
                        <p className="font-semibold">{displayResult.repo_data.language}</p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 查看详细统计按钮 */}
          {displayResult.repo_data && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="lg"
                onClick={() => window.location.href = `/repo-stats?repo=${encodeURIComponent(displayResult.repo_data.full_name)}`}
              >
                📊 查看详细统计数据
              </Button>
            </div>
          )}

          {/* 分析结果 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>AI 分析结果</span>
                <Button size="sm" variant="outline" onClick={handleSaveResult}>
                  保存结果
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {displayResult.analysis_result ? (
                (() => {
                  try {
                    const parsed = JSON.parse(displayResult.analysis_result);
                    // 检查是否是 RepositoryAnalysis 格式
                    if (parsed.healthScore !== undefined && parsed.keyMetrics) {
                      return <AnalysisResultView analysis={parsed as RepositoryAnalysis} />;
                    }
                    // 其他格式仍显示 JSON
                    return (
                      <pre className="p-4 bg-muted rounded-lg overflow-auto max-h-[600px] text-sm">
                        {JSON.stringify(parsed, null, 2)}
                      </pre>
                    );
                  } catch {
                    // 如果不是 JSON，直接显示字符串
                    return (
                      <div className="p-4 bg-muted rounded-lg">
                        <p className="text-sm whitespace-pre-wrap">{displayResult.analysis_result}</p>
                      </div>
                    );
                  }
                })()
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>暂无分析结果数据</p>
                  <p className="text-sm mt-2">可能是工作流还在处理中</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 重新分析按钮 */}
          <div className="flex justify-center gap-4">
            <Button
              onClick={() => window.location.href = "/"}
            >
              重新分析
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export default function AnalysisPage() {
  const router = useRouter();
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
            DevScope - 分析结果
          </motion.h1>
          <Button
            variant="ghost"
            onClick={() => router.push("/")}
            className="hover:bg-blue-50 hover:text-blue-600 transition-colors"
          >
            返回首页
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <Suspense fallback={<div className="text-center py-8">加载中...</div>}>
          <AnalysisContent />
        </Suspense>
      </div>
    </main>
  );
}
