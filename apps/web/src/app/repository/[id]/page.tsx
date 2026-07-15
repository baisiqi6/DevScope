/**
 * @package @devscope/web
 * @description 仓库详情页面
 *
 * 显示单个仓库的详细信息和采集统计。
 */

"use client";

import { Suspense, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { AnimatedBackground } from "@/components/animated-background";
import { EmbeddingProgress, EmbeddingStatusBadge } from "@/components/embedding-progress";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Activity, ArrowRight, FileText } from "lucide-react";

interface RepositoryDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

/**
 * 仓库详情内容组件
 * 只在 id 有效时才渲染，避免 tRPC 查询验证问题
 */
function RepositoryDetailContent({ id }: { id: number }) {
  const router = useRouter();

  const { data: repository, isLoading, error } = trpc.getRepository.useQuery(
    { id },
    {
      retry: false,
    }
  );

  const { data: releases, isLoading: isLoadingReleases } = trpc.getReleases.useQuery(
    { repoId: id, limit: 5 },
    {
      retry: false,
    }
  );

  const { data: healthReports, isLoading: isLoadingHealthReports } =
    trpc.getRepositoryHealthReports.useQuery(
      { repoFullName: repository?.fullName ?? "placeholder/repository" },
      {
        enabled: Boolean(repository?.fullName),
        retry: false,
      }
    );

  if (isLoading || isLoadingReleases) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error || !repository) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">
            {error?.message || "仓库不存在"}
          </h1>
          <Button onClick={() => router.push("/")}>返回首页</Button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      {/* 动画背景 */}
      <AnimatedBackground />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button asChild variant="ghost" className="mb-4">
          <Link href="/">← 返回仓库列表</Link>
        </Button>

        {/* 仓库基本信息 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="mb-6 bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
            <CardHeader>
              <CardTitle className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <a
                    href={repository.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 font-semibold transition-colors"
                  >
                    {repository.owner}/{repository.name}
                  </a>
                  {repository.language && (
                    <span className="ml-2 text-sm font-normal text-slate-600 bg-blue-50 px-2 py-1 rounded-full">
                      {repository.language}
                    </span>
                  )}
                </div>
                <EmbeddingStatusBadge repoId={id} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {repository.description && (
                <p className="text-slate-600 mb-4">{repository.description}</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 p-3 rounded-lg">
                  <div className="text-amber-700 text-xs font-medium mb-1">Stars</div>
                  <div className="text-xl font-bold text-amber-900">{(repository.stars ?? 0).toLocaleString()}</div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 rounded-lg">
                  <div className="text-blue-700 text-xs font-medium mb-1">Forks</div>
                  <div className="text-xl font-bold text-blue-900">{(repository.forks ?? 0).toLocaleString()}</div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100/50 p-3 rounded-lg">
                  <div className="text-green-700 text-xs font-medium mb-1">Open Issues</div>
                  <div className="text-xl font-bold text-green-900">{(repository.openIssues ?? 0).toLocaleString()}</div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 p-3 rounded-lg">
                  <div className="text-purple-700 text-xs font-medium mb-1">License</div>
                  <div className="text-xl font-bold text-purple-900">{repository.license || "N/A"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* 健康分析与历史报告 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <Card className="mb-6 bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Activity />
                    健康分析
                  </CardTitle>
                  <CardDescription>
                    基于仓库数据启动 AI 健康度评估，完成后会保存到报告历史。
                  </CardDescription>
                </div>
                <Button asChild>
                  <Link href={`/analysis/health?repo=${encodeURIComponent(repository.fullName)}`}>
                    开始分析
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">历史报告</h3>
                  <Badge variant="secondary">
                    {healthReports?.length ?? 0} 份
                  </Badge>
                </div>

                {isLoadingHealthReports ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    正在加载报告历史...
                  </p>
                ) : healthReports && healthReports.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {healthReports.map((report) => (
                      <div
                        key={report.reportId}
                        className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <FileText className="mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-sm font-medium">
                              {report.summary || "仓库健康度报告"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(report.createdAt).toLocaleString("zh-CN")}
                            </p>
                          </div>
                        </div>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/analysis/health/report/${report.executionId}`}>
                            打开报告
                          </Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed py-8 text-center">
                    <p className="text-sm font-medium">还没有健康分析报告</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      首次分析完成后，报告会显示在这里。
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* 采集统计 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Card className="mb-6 bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
            <CardHeader>
              <CardTitle>数据采集统计</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 p-4 rounded-lg text-center">
                  <div className="text-indigo-700 text-sm font-medium mb-1">总文本块</div>
                  <div className="text-2xl font-bold text-indigo-900">{repository.chunkStats.total}</div>
                </div>
                <div className="bg-gradient-to-br from-cyan-50 to-cyan-100/50 p-4 rounded-lg text-center">
                  <div className="text-cyan-700 text-sm font-medium mb-1">README 分块</div>
                  <div className="text-2xl font-bold text-cyan-900">{repository.chunkStats.readme}</div>
                </div>
                <div className="bg-gradient-to-br from-pink-50 to-pink-100/50 p-4 rounded-lg text-center">
                  <div className="text-pink-700 text-sm font-medium mb-1">Issues 分块</div>
                  <div className="text-2xl font-bold text-pink-900">{repository.chunkStats.issues}</div>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 p-4 rounded-lg text-center">
                  <div className="text-orange-700 text-sm font-medium mb-1">Commits 分块</div>
                  <div className="text-2xl font-bold text-orange-900">{repository.chunkStats.commits}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* 向量化进度 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <EmbeddingProgress repoId={id} />
        </motion.div>

        {/* Releases */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <Card className="mb-6 bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
            <CardHeader>
              <CardTitle>发布版本</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingReleases ? (
                <div className="text-center text-muted-foreground py-4">加载中...</div>
              ) : releases && releases.length > 0 ? (
                <div className="space-y-4">
                  {releases.map((release) => (
                    <div key={release.id} className="border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <a
                              href={release.htmlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 font-semibold transition-colors"
                            >
                              {release.tagName}
                            </a>
                            {release.isPrerelease && (
                              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                                Pre-release
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-medium text-slate-700">{release.name}</h4>
                        </div>
                        <div className="text-xs text-slate-500">
                          {release.publishedAt && formatDistanceToNow(new Date(release.publishedAt), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </div>
                      </div>

                      {release.body && (
                        <div className="text-sm text-slate-600 mb-3 line-clamp-3">
                          {release.body.substring(0, 200)}
                          {release.body.length > 200 && "..."}
                        </div>
                      )}

                      {/* 下载链接 */}
                      <div className="flex flex-wrap gap-2">
                        {release.zipUrl && (
                          <a
                            href={release.zipUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1"
                          >
                            <span>📦</span> ZIP 源码
                          </a>
                        )}
                        {release.tarUrl && (
                          <a
                            href={release.tarUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1"
                          >
                            <span>📦</span> TAR 源码
                          </a>
                        )}
                        {release.assets.map((asset) => (
                          <a
                            key={asset.name}
                            href={asset.browserDownloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1"
                            title={`下载次数: ${asset.downloadCount}`}
                          >
                            <span>⬇️</span> {asset.name}
                            <span className="text-xs text-slate-500">({asset.downloadCount})</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <div className="text-4xl mb-2">📦</div>
                  <p>该仓库暂无发布版本</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* README 预览 */}
        {repository.readme && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
              <CardHeader className="border-b border-slate-200/60">
                <CardTitle className="text-gray-900">README</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[600px] overflow-y-auto p-6 bg-slate-50/50">
                  <MarkdownRenderer content={repository.readme} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </main>
  );
}

export default function RepositoryDetailPage({ params }: RepositoryDetailPageProps) {
  // 使用 React 的 use hook 同步解析 params Promise
  const resolvedParams = use(params);
  const id = parseInt(resolvedParams.id, 10);

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-center text-muted-foreground">加载中...</div></div>}>
      <RepositoryDetailContent id={id} />
    </Suspense>
  );
}
