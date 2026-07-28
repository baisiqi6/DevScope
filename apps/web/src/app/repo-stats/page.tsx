/**
 * @package @devscope/web
 * @description 仓库统计详情页面
 *
 * 展示 GitHub 仓库的详细统计数据。
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedBackground } from "@/components/animated-background";
import { NumberTicker } from "@/components/number-ticker";
import {
  ArrowLeft,
  CircleDot,
  ExternalLink,
  FileText,
  GitFork,
  Scale,
  Star,
} from "lucide-react";

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

  const getStats = trpc.getRepositoryStats.useQuery(
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
      <div className="py-8 text-center">
        <p className="text-muted-foreground">未指定仓库</p>
        <Button className="mt-4" onClick={() => router.push("/")}>
          返回首页
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="正在加载统计数据" className="space-y-6">
        <div className="h-32 animate-pulse-soft rounded-lg border bg-muted/40" />
        <div className="h-48 animate-pulse-soft rounded-lg border bg-muted/40" />
        <div className="h-48 animate-pulse-soft rounded-lg border bg-muted/40" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="py-8 text-center">
        <p className="text-destructive">加载失败: {error || "未知错误"}</p>
        <Button className="mt-4" onClick={() => router.push("/")}>
          返回首页
        </Button>
      </div>
    );
  }

  const formatHours = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}分钟`;
    if (hours < 24) return `${Math.round(hours)}小时`;
    return `${Math.round(hours / 24)}天`;
  };
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("zh-CN");

  const healthScore = calculateHealthScore(stats);
  const healthTone =
    healthScore >= 80
      ? { text: "text-success", bar: "bg-success", label: "健康" }
      : healthScore >= 60
        ? { text: "text-warning", bar: "bg-warning", label: "良好" }
        : { text: "text-destructive", bar: "bg-destructive", label: "需要关注" };

  return (
    <div className="space-y-6">
      {/* 健康度评分 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-lg">
            <span>仓库健康度评分</span>
            <span className={`text-4xl font-bold ${healthTone.text}`}>
              <NumberTicker value={healthScore} />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-4 w-full rounded-full bg-muted">
            <div
              className={`h-4 rounded-full ${healthTone.bar}`}
              style={{ width: `${healthScore}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{healthTone.label}</p>
        </CardContent>
      </Card>

      {/* 基础信息 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="text-lg">基础信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <a
                href={stats.repository.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-lg font-semibold text-primary underline-offset-4 hover:underline"
              >
                {stats.repository.fullName}
                <ExternalLink className="h-4 w-4" />
              </a>
              {stats.repository.description && (
                <p className="text-muted-foreground">{stats.repository.description}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Star className="h-3.5 w-3.5" />
                  Stars
                </p>
                <p className="font-semibold">
                  <NumberTicker value={stats.repository.stars} />
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <GitFork className="h-3.5 w-3.5" />
                  Forks
                </p>
                <p className="font-semibold">
                  <NumberTicker value={stats.repository.forks} />
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">语言</p>
                <p className="font-semibold">{stats.repository.language || "N/A"}</p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Scale className="h-3.5 w-3.5" />
                  License
                </p>
                <p className="font-semibold">{stats.repository.license || "N/A"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">创建时间</p>
                <p>{formatDate(stats.repository.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">最后推送</p>
                <p>{formatDate(stats.repository.pushedAt)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 代码活跃度 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="text-lg">代码活跃度</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">最近提交</p>
              <p className="font-semibold">{formatDate(stats.commitFrequency.lastCommitDate)}</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <StatTile label="过去 7 天提交" value={stats.commitFrequency.commitsLast7Days} />
              <StatTile label="过去 30 天提交" value={stats.commitFrequency.commitsLast30Days} />
              <StatTile label="过去 90 天提交" value={stats.commitFrequency.commitsLast90Days} />
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">分支数</p>
                <p className="font-semibold">{stats.commitFrequency.totalBranches}</p>
              </div>
              <div>
                <p className="text-muted-foreground">标签数</p>
                <p className="font-semibold">{stats.commitFrequency.totalTags}</p>
              </div>
              <div>
                <p className="text-muted-foreground">默认分支</p>
                <p className="font-semibold">{stats.commitFrequency.defaultBranch}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issues 统计 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CircleDot className="h-4 w-4 text-muted-foreground" />
            Issues 管理
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <StatTile label="开放中" value={stats.issuesStats.openIssues} />
              <StatTile label="已关闭" value={stats.issuesStats.closedIssues} />
              <StatTile label="总计" value={stats.issuesStats.totalIssues} />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">平均解决时间</p>
                <p className="font-semibold">{formatHours(stats.issuesStats.avgResolutionTime)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">解决率</p>
                <p className="font-semibold">
                  {stats.issuesStats.totalIssues > 0
                    ? Math.round((stats.issuesStats.closedIssues / stats.issuesStats.totalIssues) * 100)
                    : 0}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">7 天新增/关闭</p>
                <p className="font-semibold">
                  +{stats.issuesStats.openIssuesLast7Days} / -{stats.issuesStats.closedIssuesLast7Days}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">超过 30 天未处理</p>
                <p className="font-semibold text-warning">{stats.issuesStats.issuesStaleOver30Days}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pull Requests 统计 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="text-lg">Pull Requests 管理</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <StatTile label="开放中" value={stats.prStats.openPRs} />
              <StatTile label="已合并" value={stats.prStats.mergedPRs} />
              <StatTile label="已关闭" value={stats.prStats.closedPRs} />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">平均合并时间</p>
                <p className="font-semibold">{formatHours(stats.prStats.avgMergeTime)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">合并率</p>
                <p className="font-semibold">
                  {stats.prStats.totalPRs > 0
                    ? Math.round((stats.prStats.mergedPRs / stats.prStats.totalPRs) * 100)
                    : 0}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">7 天新增/合并</p>
                <p className="font-semibold">
                  +{stats.prStats.openPRsLast7Days} / ✓{stats.prStats.mergedPRsLast7Days}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">超过 30 天未处理</p>
                <p className="font-semibold text-warning">{stats.prStats.prsStaleOver30Days}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 贡献者 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="text-lg">贡献者</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatTile label="总贡献者数" value={stats.contributorsStats.totalContributors} />
              <StatTile label="30 天新贡献者" value={stats.contributorsStats.newContributorsLast30Days} />
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">Top 10 贡献者</p>
              <div className="space-y-2">
                {stats.contributorsStats.topContributors.map((contributor) => (
                  <div
                    key={contributor.login}
                    className="flex items-center justify-between rounded-md border p-2 transition-colors duration-150 hover:border-border-hover hover:bg-card-hover"
                  >
                    <a
                      href={`https://github.com/${contributor.login}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {contributor.login}
                    </a>
                    <span className="font-semibold">
                      {contributor.contributions.toLocaleString()} 次贡献
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 社区文件 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-4 w-4 text-muted-foreground" />
            社区文件
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
        <Button onClick={() => router.push("/")}>返回首页</Button>
        <Button variant="outline" onClick={() => window.open(stats.repository.url, "_blank")}>
          在 GitHub 上查看
        </Button>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/80 bg-muted/40 p-3">
      <p className="text-2xl font-bold">
        <NumberTicker value={value} />
      </p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function FileCheck({ name, has }: { name: string; has: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border p-2 transition-colors duration-150 ${
        has
          ? "border-success/30 bg-success/10 hover:bg-success/15"
          : "border-border/80 bg-muted/40 hover:bg-card-hover"
      }`}
    >
      <span className={has ? "text-success" : "text-muted-foreground"}>{has ? "✓" : "✗"}</span>
      <span className={`text-sm ${has ? "text-foreground" : "text-muted-foreground"}`}>{name}</span>
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
      <AnimatedBackground />

      <div className="container mx-auto max-w-5xl px-4 py-6 sm:py-8">
        <header className="command-page-header mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="command-kicker">数据面板</p>
            <h1 className="text-2xl font-semibold tracking-tight">仓库统计</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              查看单个仓库的活跃度、Issues、PR 与社区健康指标。
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
            <ArrowLeft />
            返回仓库列表
          </Button>
        </header>
        <Suspense
          fallback={
            <div aria-busy="true" className="space-y-6">
              <div className="h-32 animate-pulse-soft rounded-lg border bg-muted/40" />
              <div className="h-48 animate-pulse-soft rounded-lg border bg-muted/40" />
            </div>
          }
        >
          <StatsContent />
        </Suspense>
      </div>
    </main>
  );
}
