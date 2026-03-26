/**
 * @package @devscope/web
 * @description 仓库统计详情页面
 *
 * 展示 GitHub 仓库的详细统计数据。
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedBackground } from "@/components/animated-background";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";

interface RepositoryStats {
  repository: {
    fullName: string;
    name: string;
    owner: string;
    description: string | null;
    url: string;
    stars: number;
    forks: number;
    openIssues: number;
    language: string | null;
    license: string | null;
    createdAt: string;
    updatedAt: string;
    pushedAt: string;
  };
  commitFrequency: {
    lastCommitDate: string;
    commitsLast7Days: number;
    commitsLast30Days: number;
    commitsLast90Days: number;
    totalBranches: number;
    totalTags: number;
    defaultBranch: string;
  };
  issuesStats: {
    openIssues: number;
    closedIssues: number;
    totalIssues: number;
    avgResolutionTime: number;
    openIssuesLast7Days: number;
    closedIssuesLast7Days: number;
    issuesWithNoAssignee: number;
    issuesStaleOver30Days: number;
  };
  prStats: {
    openPRs: number;
    mergedPRs: number;
    closedPRs: number;
    totalPRs: number;
    avgMergeTime: number;
    openPRsLast7Days: number;
    mergedPRsLast7Days: number;
    prsWithNoReview: number;
    prsStaleOver30Days: number;
  };
  contributorsStats: {
    totalContributors: number;
    topContributors: Array<{ login: string; contributions: number }>;
    newContributorsLast30Days: number;
  };
  communityFiles: {
    hasContributing: boolean;
    hasCodeOfConduct: boolean;
    hasSecurity: boolean;
    hasSupport: boolean;
    hasLicense: boolean;
    hasReadme: boolean;
  };
}

function StatsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const repo = searchParams.get("repo");
  const [stats, setStats] = useState<RepositoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getStats = trpc.workflow.getRepositoryStats.useQuery(
    { repo: repo || "" },
    {
      enabled: !!repo,
      retry: false,
    }
  );

  useEffect(() => {
    if (getStats.data) {
      setStats(getStats.data as unknown as RepositoryStats);
      setLoading(false);
    }
    if (getStats.error) {
      setError(getStats.error.message);
      setLoading(false);
    }
  }, [getStats.data, getStats.error]);

  if (!repo) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">未指定仓库</p>
        <Button
          className="mt-4"
          onClick={() => window.location.href = "/"}
        >
          返回首页
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">加载统计数据中...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500">加载失败: {error || "未知错误"}</p>
        <Button
          className="mt-4"
          onClick={() => window.location.href = "/"}
        >
          返回首页
        </Button>
      </div>
    );
  }

  const formatNumber = (num: number) => new Intl.NumberFormat("zh-CN").format(num);
  const formatHours = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}分钟`;
    if (hours < 24) return `${Math.round(hours)}小时`;
    return `${Math.round(hours / 24)}天`;
  };
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("zh-CN");

  // 计算健康度评分
  const healthScore = calculateHealthScore(stats);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* 健康度评分 */}
      <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>仓库健康度评分</span>
            <span className={`text-4xl font-bold ${
              healthScore >= 80 ? "text-green-600" :
              healthScore >= 60 ? "text-yellow-600" :
              "text-red-600"
            }`}>
              {healthScore}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div
              className={`h-4 rounded-full ${
                healthScore >= 80 ? "bg-green-600" :
                healthScore >= 60 ? "bg-yellow-600" :
                "bg-red-600"
              }`}
              style={{ width: `${healthScore}%` }}
            />
          </div>
          <p className="text-sm text-slate-600 mt-2">
            {healthScore >= 80 ? "健康" : healthScore >= 60 ? "良好" : "需要关注"}
          </p>
        </CardContent>
      </Card>

      {/* 基础信息 */}
      <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle>基础信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <a
                href={stats.repository.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 font-semibold text-lg"
              >
                {stats.repository.fullName}
              </a>
              {stats.repository.description && (
                <p className="text-slate-600">{stats.repository.description}</p>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-slate-600">⭐ Stars</p>
                <p className="font-semibold">{formatNumber(stats.repository.stars)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">🍴 Forks</p>
                <p className="font-semibold">{formatNumber(stats.repository.forks)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">🔷 Language</p>
                <p className="font-semibold">{stats.repository.language || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">📄 License</p>
                <p className="font-semibold">{stats.repository.license || "N/A"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-600">创建时间</p>
                <p>{formatDate(stats.repository.createdAt)}</p>
              </div>
              <div>
                <p className="text-slate-600">最后推送</p>
                <p>{formatDate(stats.repository.pushedAt)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 代码活跃度 */}
      <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle>代码活跃度</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-600">最近提交</p>
              <p className="font-semibold">{formatDate(stats.commitFrequency.lastCommitDate)}</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-lg border border-blue-200/50">
                <p className="text-2xl font-bold text-blue-600">{stats.commitFrequency.commitsLast7Days}</p>
                <p className="text-sm text-slate-600">过去 7 天提交</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-green-50 to-green-100/50 rounded-lg border border-green-200/50">
                <p className="text-2xl font-bold text-green-600">{stats.commitFrequency.commitsLast30Days}</p>
                <p className="text-sm text-slate-600">过去 30 天提交</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-lg border border-purple-200/50">
                <p className="text-2xl font-bold text-purple-600">{stats.commitFrequency.commitsLast90Days}</p>
                <p className="text-sm text-slate-600">过去 90 天提交</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-slate-600">分支数</p>
                <p className="font-semibold">{stats.commitFrequency.totalBranches}</p>
              </div>
              <div>
                <p className="text-slate-600">标签数</p>
                <p className="font-semibold">{stats.commitFrequency.totalTags}</p>
              </div>
              <div>
                <p className="text-slate-600">默认分支</p>
                <p className="font-semibold">{stats.commitFrequency.defaultBranch}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issues 统计 */}
      <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle>Issues 管理</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-gradient-to-br from-yellow-50 to-yellow-100/50 rounded-lg border border-yellow-200/50">
                <p className="text-2xl font-bold text-yellow-600">{stats.issuesStats.openIssues}</p>
                <p className="text-sm text-slate-600">开放中</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-green-50 to-green-100/50 rounded-lg border border-green-200/50">
                <p className="text-2xl font-bold text-green-600">{stats.issuesStats.closedIssues}</p>
                <p className="text-sm text-slate-600">已关闭</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-lg border border-blue-200/50">
                <p className="text-2xl font-bold text-blue-600">{stats.issuesStats.totalIssues}</p>
                <p className="text-sm text-slate-600">总计</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-600">平均解决时间</p>
                <p className="font-semibold">{formatHours(stats.issuesStats.avgResolutionTime)}</p>
              </div>
              <div>
                <p className="text-slate-600">解决率</p>
                <p className="font-semibold">
                  {stats.issuesStats.totalIssues > 0
                    ? Math.round((stats.issuesStats.closedIssues / stats.issuesStats.totalIssues) * 100)
                    : 0}%
                </p>
              </div>
              <div>
                <p className="text-slate-600">7 天新增/关闭</p>
                <p className="font-semibold">
                  +{stats.issuesStats.openIssuesLast7Days} / -{stats.issuesStats.closedIssuesLast7Days}
                </p>
              </div>
              <div>
                <p className="text-slate-600">超过 30 天未处理</p>
                <p className="font-semibold text-orange-600">{stats.issuesStats.issuesStaleOver30Days}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pull Requests 统计 */}
      <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle>Pull Requests 管理</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-gradient-to-br from-yellow-50 to-yellow-100/50 rounded-lg border border-yellow-200/50">
                <p className="text-2xl font-bold text-yellow-600">{stats.prStats.openPRs}</p>
                <p className="text-sm text-slate-600">开放中</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-green-50 to-green-100/50 rounded-lg border border-green-200/50">
                <p className="text-2xl font-bold text-green-600">{stats.prStats.mergedPRs}</p>
                <p className="text-sm text-slate-600">已合并</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-lg border border-gray-200/50">
                <p className="text-2xl font-bold text-gray-600">{stats.prStats.closedPRs}</p>
                <p className="text-sm text-slate-600">已关闭</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-600">平均合并时间</p>
                <p className="font-semibold">{formatHours(stats.prStats.avgMergeTime)}</p>
              </div>
              <div>
                <p className="text-slate-600">合并率</p>
                <p className="font-semibold">
                  {stats.prStats.totalPRs > 0
                    ? Math.round((stats.prStats.mergedPRs / stats.prStats.totalPRs) * 100)
                    : 0}%
                </p>
              </div>
              <div>
                <p className="text-slate-600">7 天新增/合并</p>
                <p className="font-semibold">
                  +{stats.prStats.openPRsLast7Days} / ✓{stats.prStats.mergedPRsLast7Days}
                </p>
              </div>
              <div>
                <p className="text-slate-600">超过 30 天未处理</p>
                <p className="font-semibold text-orange-600">{stats.prStats.prsStaleOver30Days}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 贡献者 */}
      <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle>贡献者</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-lg border border-blue-200/50">
                <p className="text-2xl font-bold text-blue-600">{stats.contributorsStats.totalContributors}</p>
                <p className="text-sm text-slate-600">总贡献者数</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-green-50 to-green-100/50 rounded-lg border border-green-200/50">
                <p className="text-2xl font-bold text-green-600">{stats.contributorsStats.newContributorsLast30Days}</p>
                <p className="text-sm text-slate-600">30 天新贡献者</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2">Top 10 贡献者</p>
              <div className="space-y-2">
                {stats.contributorsStats.topContributors.map((contributor) => (
                  <div key={contributor.login} className="flex items-center justify-between p-2 border rounded hover:bg-slate-50 transition-colors">
                    <a
                      href={`https://github.com/${contributor.login}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      {contributor.login}
                    </a>
                    <span className="font-semibold">{contributor.contributions} 次贡献</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 社区文件 */}
      <Card className="bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle>社区文件</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <FileCheck name="CONTRIBUTING.md" has={stats.communityFiles.hasContributing} />
            <FileCheck name="CODE_OF_CONDUCT.md" has={stats.communityFiles.hasCodeOfConduct} />
            <FileCheck name="SECURITY.md" has={stats.communityFiles.hasSecurity} />
            <FileCheck name="SUPPORT.md" has={stats.communityFiles.hasSupport} />
            <FileCheck name="LICENSE" has={stats.communityFiles.hasLicense} />
            <FileCheck name="README.md" has={stats.communityFiles.hasReadme} />
          </div>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <div className="flex justify-center gap-4">
        <Button
          onClick={() => router.push("/")}
          className="hover:bg-blue-50 hover:text-blue-600 transition-colors"
        >
          返回首页
        </Button>
        <Button
          variant="outline"
          onClick={() => window.open(stats.repository.url, "_blank")}
          className="hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 transition-colors"
        >
          在 GitHub 上查看
        </Button>
      </div>
    </motion.div>
  );
}

function FileCheck({ name, has }: { name: string; has: boolean }) {
  return (
    <div className={`flex items-center gap-2 p-2 border rounded transition-colors ${has ? "bg-green-50 border-green-200 hover:bg-green-100" : "bg-gray-50 border-gray-200 hover:bg-gray-100"}`}>
      <span className={has ? "text-green-600" : "text-gray-400"}>
        {has ? "✓" : "✗"}
      </span>
      <span className={`text-sm ${has ? "text-green-800" : "text-gray-500"}`}>
        {name}
      </span>
    </div>
  );
}

function calculateHealthScore(stats: RepositoryStats): number {
  let score = 0;

  // 代码活跃度 (30分)
  if (stats.commitFrequency.commitsLast30Days > 0) score += 10;
  if (stats.commitFrequency.commitsLast90Days > 10) score += 10;
  const daysSinceLastCommit = (Date.now() - new Date(stats.commitFrequency.lastCommitDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastCommit < 30) score += 10;

  // Issues 管理 (20分)
  if (stats.issuesStats.totalIssues > 0) {
    const resolutionRate = stats.issuesStats.closedIssues / stats.issuesStats.totalIssues;
    score += Math.round(resolutionRate * 10);
  }
  if (stats.issuesStats.avgResolutionTime < 168) score += 5; // 小于一周
  if (stats.issuesStats.issuesStaleOver30Days < stats.issuesStats.openIssues * 0.3) score += 5;

  // PRs 管理 (20分)
  if (stats.prStats.totalPRs > 0) {
    const mergeRate = stats.prStats.mergedPRs / stats.prStats.totalPRs;
    score += Math.round(mergeRate * 10);
  }
  if (stats.prStats.avgMergeTime < 168) score += 5; // 小于一周
  if (stats.prStats.prsStaleOver30Days < stats.prStats.openPRs * 0.3) score += 5;

  // 社区健康 (20分)
  if (stats.contributorsStats.totalContributors > 5) score += 5;
  if (stats.contributorsStats.totalContributors > 20) score += 5;
  if (stats.contributorsStats.newContributorsLast30Days > 0) score += 5;
  if (stats.repository.stars > 100) score += 5;

  // 社区文件 (10分)
  const communityFilesCount = [
    stats.communityFiles.hasContributing,
    stats.communityFiles.hasCodeOfConduct,
    stats.communityFiles.hasSecurity,
    stats.communityFiles.hasLicense,
    stats.communityFiles.hasReadme,
  ].filter(Boolean).length;
  score += Math.round(communityFilesCount * 2);

  return Math.min(100, Math.max(0, score));
}

export default function RepoStatsPage() {
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
            DevScope - 仓库统计
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
          <StatsContent />
        </Suspense>
      </div>
    </main>
  );
}
