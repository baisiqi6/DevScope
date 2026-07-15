/**
 * @package @devscope/web
 * @description 仓库详情页面
 *
 * 显示单个仓库的详细信息和采集统计。
 */

'use client';

import { Suspense, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { AnimatedBackground } from '@/components/animated-background';
import { EmbeddingProgress, EmbeddingStatusBadge } from '@/components/embedding-progress';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CircleDot,
  Download,
  ExternalLink,
  FileText,
  GitFork,
  Package,
  Scale,
  Star,
} from 'lucide-react';

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

  const {
    data: repository,
    isLoading,
    error,
  } = trpc.getRepository.useQuery(
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
      { repoFullName: repository?.fullName ?? 'placeholder/repository' },
      {
        enabled: Boolean(repository?.fullName),
        retry: false,
      }
    );

  if (isLoading) {
    return <RepositoryLoadingState />;
  }

  if (error || !repository) {
    return (
      <main className="min-h-screen">
        <AnimatedBackground />
        <div className="container mx-auto max-w-3xl px-4 py-16">
          <div role="alert" className="rounded-lg border border-destructive/30 bg-card p-6">
            <h1 className="text-lg font-semibold">无法打开仓库详情</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {error?.message || '仓库不存在，可能已被删除或尚未采集。'}
            </p>
            <Button className="mt-5" onClick={() => router.push('/')}>
              <ArrowLeft />
              返回仓库工作区
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const repositoryMetrics = [
    { label: 'Stars', value: repository.stars ?? 0, icon: Star },
    { label: 'Forks', value: repository.forks ?? 0, icon: GitFork },
    { label: '开放 Issue', value: repository.openIssues ?? 0, icon: CircleDot },
    { label: '许可证', value: repository.license || '未标注', icon: Scale },
  ];
  const chunkStats = [
    ['总文本块', repository.chunkStats.total],
    ['README', repository.chunkStats.readme],
    ['Issues', repository.chunkStats.issues],
    ['Commits', repository.chunkStats.commits],
  ];

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <div className="container mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
          <Link href="/">
            <ArrowLeft />
            返回仓库工作区
          </Link>
        </Button>

        <header className="border-b pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 items-start gap-2">
                <h1 className="min-w-0 flex-1 break-words text-2xl font-semibold tracking-tight">
                  {repository.owner}/{repository.name}
                </h1>
                <a
                  href={repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="在 GitHub 打开仓库"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {repository.description || '该仓库暂无简介。'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              {repository.language && <Badge variant="secondary">{repository.language}</Badge>}
              <EmbeddingStatusBadge repoId={id} />
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border bg-card md:grid-cols-4">
            {repositoryMetrics.map(({ label, value, icon: Icon }, index) => (
              <div
                key={label}
                className={`px-4 py-3 ${index % 2 === 0 ? 'border-r' : ''} ${index < 2 ? 'border-b md:border-b-0' : ''} md:border-r md:last:border-r-0`}
              >
                <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </dt>
                <dd className="mt-1 truncate text-lg font-semibold tabular-nums">
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <div className="min-w-0 space-y-6">
            <Card className="shadow-none">
              <CardHeader className="border-b">
                <h2 className="text-lg font-semibold">README</h2>
                <CardDescription>仓库当前采集到的 README 内容。</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {repository.readme ? (
                  <div className="max-h-[70vh] overflow-y-auto p-4 sm:p-6">
                    <MarkdownRenderer content={repository.readme} />
                  </div>
                ) : (
                  <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                    当前没有可展示的 README 内容。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">发布版本</h2>
                    <CardDescription className="mt-1">最近采集的 5 个 Release。</CardDescription>
                  </div>
                  <Badge variant="secondary">{releases?.length ?? 0} 个</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingReleases ? (
                  <div className="space-y-3 p-6" aria-label="正在加载发布版本">
                    {[0, 1].map((item) => (
                      <div key={item} className="h-24 animate-pulse rounded-md bg-muted/50" />
                    ))}
                  </div>
                ) : releases && releases.length > 0 ? (
                  <div className="divide-y">
                    {releases.map((release) => (
                      <article key={release.id} className="p-4 sm:p-6">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <a
                                href={release.htmlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-primary underline-offset-4 hover:underline"
                              >
                                {release.tagName}
                              </a>
                              {release.isPrerelease && <Badge variant="outline">预发布</Badge>}
                            </div>
                            <h3 className="mt-1 text-sm font-medium">{release.name}</h3>
                          </div>
                          <time className="shrink-0 text-xs text-muted-foreground">
                            {release.publishedAt
                              ? formatDistanceToNow(new Date(release.publishedAt), {
                                  addSuffix: true,
                                  locale: zhCN,
                                })
                              : '发布时间未知'}
                          </time>
                        </div>

                        {release.body && (
                          <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {release.body.substring(0, 240)}
                            {release.body.length > 240 && '…'}
                          </p>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          {release.zipUrl && (
                            <Button asChild variant="outline" size="sm">
                              <a href={release.zipUrl} target="_blank" rel="noopener noreferrer">
                                <Package />
                                ZIP 源码
                              </a>
                            </Button>
                          )}
                          {release.tarUrl && (
                            <Button asChild variant="outline" size="sm">
                              <a href={release.tarUrl} target="_blank" rel="noopener noreferrer">
                                <Package />
                                TAR 源码
                              </a>
                            </Button>
                          )}
                          {release.assets.map((asset) => (
                            <Button key={asset.name} asChild variant="outline" size="sm">
                              <a
                                href={asset.browserDownloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`下载次数：${asset.downloadCount}`}
                              >
                                <Download />
                                <span className="max-w-48 truncate">{asset.name}</span>
                                <span className="text-muted-foreground">{asset.downloadCount}</span>
                              </a>
                            </Button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="px-6 py-10 text-center">
                    <Package className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">暂无发布版本</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      后续采集到 Release 后会显示在这里。
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card className="shadow-none">
              <CardHeader>
                <Activity className="h-5 w-5 text-primary" />
                <h2 className="pt-2 text-lg font-semibold">健康分析</h2>
                <CardDescription>
                  基于已采集数据运行 AI 评估，结论会保存到报告历史。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full">
                  <Link href={`/analysis/health?repo=${encodeURIComponent(repository.fullName)}`}>
                    开始分析
                    <ArrowRight />
                  </Link>
                </Button>

                <div className="mt-6 flex items-center justify-between border-b pb-2">
                  <h3 className="text-sm font-medium">历史报告</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {healthReports?.length ?? 0} 份
                  </span>
                </div>

                {isLoadingHealthReports ? (
                  <div className="mt-3 h-16 animate-pulse rounded-md bg-muted/50" />
                ) : healthReports && healthReports.length > 0 ? (
                  <div className="divide-y">
                    {healthReports.map((report) => (
                      <div key={report.reportId} className="py-3">
                        <div className="flex items-start gap-2">
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-sm font-medium">
                              {report.summary || '仓库健康度报告'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(report.createdAt).toLocaleString('zh-CN')}
                            </p>
                          </div>
                        </div>
                        <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0">
                          <Link href={`/analysis/health/report/${report.executionId}`}>
                            打开报告
                            <ArrowRight />
                          </Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-5 text-sm text-muted-foreground">
                    暂无报告，首次分析完成后会显示在这里。
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <h2 className="text-lg font-semibold">采集状态</h2>
                <CardDescription>用于搜索和分析的文本块数量。</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="divide-y border-y">
                  {chunkStats.map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 py-2.5 text-sm"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <EmbeddingProgress repoId={id} />
          </aside>
        </div>
      </div>
    </main>
  );
}

function RepositoryLoadingState() {
  return (
    <main className="min-h-screen">
      <AnimatedBackground />
      <div className="container mx-auto max-w-6xl px-4 py-8" aria-label="正在加载仓库详情">
        <div className="h-9 w-36 animate-pulse rounded-md bg-muted" />
        <div className="mt-6 border-b pb-6">
          <div className="h-8 w-72 max-w-full animate-pulse rounded-md bg-muted" />
          <div className="mt-3 h-5 w-full max-w-2xl animate-pulse rounded-md bg-muted/70" />
          <div className="mt-6 h-20 animate-pulse rounded-lg border bg-card" />
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="h-96 animate-pulse rounded-lg border bg-card" />
          <div className="h-72 animate-pulse rounded-lg border bg-card" />
        </div>
      </div>
    </main>
  );
}

export default function RepositoryDetailPage({ params }: RepositoryDetailPageProps) {
  const resolvedParams = use(params);
  const id = parseInt(resolvedParams.id, 10);

  if (!Number.isInteger(id) || id <= 0) {
    return (
      <main className="min-h-screen">
        <AnimatedBackground />
        <div className="container mx-auto max-w-3xl px-4 py-16">
          <div role="alert" className="rounded-lg border bg-card p-6">
            <h1 className="text-lg font-semibold">仓库地址无效</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              请从仓库工作区重新选择要查看的仓库。
            </p>
            <Button asChild className="mt-5">
              <Link href="/">
                <ArrowLeft />
                返回仓库工作区
              </Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <Suspense fallback={<RepositoryLoadingState />}>
      <RepositoryDetailContent id={id} />
    </Suspense>
  );
}
