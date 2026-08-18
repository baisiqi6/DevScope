"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clock3,
  Code2,
  GitFork,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
} from "lucide-react";
import { AnimatedBackground } from "@/components/animated-background";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";

type TrendingPeriod = "daily" | "weekly" | "monthly";

const periodLabels: Record<TrendingPeriod, string> = {
  daily: "今日",
  weekly: "本周",
  monthly: "本月",
};

const scoreLabels: Record<string, string> = {
  popularity: "GitHub 热度",
  freshness: "近期活跃",
  languageAffinity: "语言偏好",
  community: "社区规模",
};

export default function DiscoverPage() {
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState<TrendingPeriod>("daily");
  const [trendingSyncActive, setTrendingSyncActive] = useState(false);
  const [radarSyncActive, setRadarSyncActive] = useState(false);
  const [collectingRepo, setCollectingRepo] = useState<string | null>(null);
  const [collectionResult, setCollectionResult] = useState<{
    repo: string;
    success: boolean;
    message: string;
  } | null>(null);

  const trendingQuery = trpc.discovery.getTrending.useQuery(
    { period, language: "all" },
    { refetchOnWindowFocus: false },
  );
  const radarQuery = trpc.discovery.getRadar.useQuery(
    { limit: 50 },
    { refetchOnWindowFocus: false },
  );
  const trendingSyncStatusQuery = trpc.discovery.getTrendingSyncStatus.useQuery(undefined, {
    refetchInterval: trendingSyncActive ? 3_000 : false,
    refetchOnWindowFocus: false,
  });
  const radarSyncStatusQuery = trpc.discovery.getRadarSyncStatus.useQuery(undefined, {
    refetchInterval: radarSyncActive ? 3_000 : false,
    refetchOnWindowFocus: false,
  });
  const startTrendingSync = trpc.discovery.startTrendingSync.useMutation({
    onSuccess: async () => {
      setTrendingSyncActive(true);
      await trendingSyncStatusQuery.refetch();
    },
  });
  const startRadarSync = trpc.discovery.startRadarSync.useMutation({
    onSuccess: async () => {
      setRadarSyncActive(true);
      await radarSyncStatusQuery.refetch();
    },
  });
  const collectRepository = trpc.collectRepository.useMutation();

  useEffect(() => {
    const status = trendingSyncStatusQuery.data?.status;
    if (status === "running" && !trendingSyncActive) {
      setTrendingSyncActive(true);
      return;
    }
    if (trendingSyncActive && (status === "completed" || status === "failed")) {
      setTrendingSyncActive(false);
      if (status === "completed") {
        void utils.discovery.getTrending.invalidate();
      }
    }
  }, [trendingSyncActive, trendingSyncStatusQuery.data?.status, utils.discovery.getTrending]);

  useEffect(() => {
    const status = radarSyncStatusQuery.data?.status;
    if (status === "running" && !radarSyncActive) {
      setRadarSyncActive(true);
      return;
    }
    if (radarSyncActive && (status === "completed" || status === "failed")) {
      setRadarSyncActive(false);
      if (status === "completed") {
        void utils.discovery.getRadar.invalidate();
      }
    }
  }, [radarSyncActive, radarSyncStatusQuery.data?.status, utils.discovery.getRadar]);

  const handleCollect = (repo: string) => {
    setCollectingRepo(repo);
    setCollectionResult(null);
    collectRepository.mutate(
      { repo, skipEmbeddings: false },
      {
        onSuccess: (result) => {
          const success = result.status !== "failed";
          setCollectionResult({
            repo,
            success,
            message: success
              ? "已加入仓库工作区，向量化将在后台继续。"
              : result.error || "采集失败，请稍后重试。",
          });
          setCollectingRepo(null);
          if (success) {
            void Promise.all([
              utils.getRepositories.invalidate(),
              utils.groups.getAll.invalidate(),
              utils.groupsQuery.getUngroupedRepos.invalidate(),
            ]);
          }
        },
        onError: (error) => {
          setCollectionResult({ repo, success: false, message: error.message });
          setCollectingRepo(null);
        },
      },
    );
  };

  const isTrendingSyncing = trendingSyncActive || startTrendingSync.isPending;
  const trendingSyncError = startTrendingSync.error?.message ??
    (trendingSyncStatusQuery.data?.status === "failed" ? trendingSyncStatusQuery.data.error : null);
  const isRadarSyncing = radarSyncActive || startRadarSync.isPending;
  const radarSyncError = startRadarSync.error?.message ??
    (radarSyncStatusQuery.data?.status === "failed" ? radarSyncStatusQuery.data.error : null);

  return (
    <main className="min-h-screen">
      <AnimatedBackground />
      <div className="container mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <header className="command-page-header mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="command-kicker">生态信号台</p>
            <h1 className="text-2xl font-semibold tracking-tight">发现</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              对照 GitHub 官方趋势，并用你的仓库兴趣形成独立的 DevScope 发现榜。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => startTrendingSync.mutate()}
            disabled={isTrendingSyncing}
          >
            {isTrendingSyncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {isTrendingSyncing ? "同步中" : "同步 Trending"}
          </Button>
        </header>

        {trendingSyncError && <InlineMessage tone="error">{trendingSyncError}</InlineMessage>}
        {collectionResult && (
          <InlineMessage tone={collectionResult.success ? "success" : "error"}>
            <span className="font-medium">{collectionResult.repo}</span>：{collectionResult.message}
          </InlineMessage>
        )}

        <Tabs defaultValue="trending" className="mt-5">
          <TabsList className="grid h-auto w-full grid-cols-2 sm:w-auto">
            <TabsTrigger value="trending">GitHub Trending</TabsTrigger>
            <TabsTrigger value="radar">DevScope 发现榜</TabsTrigger>
          </TabsList>

          <TabsContent value="trending" className="mt-5">
            <section aria-labelledby="trending-title">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="trending-title" className="text-lg font-semibold">GitHub Trending</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    保留 GitHub 的原始周期排名，不混入个人兴趣评分。
                  </p>
                </div>
                <Tabs
                  value={period}
                  onValueChange={(value) => setPeriod(value as TrendingPeriod)}
                >
                  <TabsList aria-label="Trending 周期" className="grid w-full grid-cols-3 sm:w-auto">
                    {Object.entries(periodLabels).map(([value, label]) => (
                      <TabsTrigger key={value} value={value}>{label}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              {trendingQuery.isLoading ? (
                <LoadingState label="正在读取 Trending 快照" />
              ) : trendingQuery.error ? (
                <ErrorState message={trendingQuery.error.message} onRetry={() => trendingQuery.refetch()} />
              ) : !trendingQuery.data ? (
                <EmptyState
                  title="还没有 Trending 快照"
                  description="启动一次同步后，Worker 会分别抓取今日、本周和本月榜单。"
                  action={(
                    <Button onClick={() => startTrendingSync.mutate()} disabled={isTrendingSyncing}>
                      {isTrendingSyncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                      {isTrendingSyncing ? "同步中" : "立即同步"}
                    </Button>
                  )}
                />
              ) : (
                <>
                  <SnapshotMeta
                    date={trendingQuery.data.snapshotDate}
                    fetchedAt={trendingQuery.data.fetchedAt}
                    sourceUrl={trendingQuery.data.sourceUrl}
                  />
                  <div className="mt-3 space-y-2">
                    {trendingQuery.data.entries.map((entry) => (
                      <RepositoryRow
                        key={entry.fullName}
                        leading={<span className="w-8 text-center font-mono text-sm text-muted-foreground">#{entry.rank}</span>}
                        fullName={entry.fullName}
                        url={entry.url}
                        description={entry.description}
                        language={entry.language}
                        metrics={[
                          { icon: Star, label: formatCount(entry.stars) },
                          { icon: GitFork, label: formatCount(entry.forks) },
                          { icon: Sparkles, label: `+${formatCount(entry.starsInPeriod)} ${periodLabels[period]}` },
                        ]}
                        collecting={collectingRepo === entry.fullName}
                        onCollect={() => handleCollect(entry.fullName)}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          </TabsContent>

          <TabsContent value="radar" className="mt-5">
            <section aria-labelledby="radar-title">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="radar-title" className="text-lg font-semibold">DevScope 发现榜</h2>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    基于 GitHub Search 候选、公开活跃信号和你已关注仓库的语言分布进行确定性排序。
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => startRadarSync.mutate()}
                  disabled={isRadarSyncing}
                >
                  {isRadarSyncing ? (
                    <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  {isRadarSyncing ? "发现中" : "同步发现榜"}
                </Button>
              </div>

              {isRadarSyncing && (
                <p role="status" className="mb-3 text-sm text-muted-foreground">
                  Worker 正在搜索候选并计算兴趣评分，完成后会自动刷新列表。
                </p>
              )}
              {radarSyncError && <InlineMessage tone="error">{radarSyncError}</InlineMessage>}
              {!isRadarSyncing && radarSyncStatusQuery.data?.status === "completed" && (
                <InlineMessage tone="success">
                  本次发现 {radarSyncStatusQuery.data.result?.discovered ?? 0} 个候选，
                  已更新 {radarSyncStatusQuery.data.result?.upserted ?? 0} 条记录。
                </InlineMessage>
              )}

              {radarQuery.isLoading ? (
                <LoadingState label="正在读取发现候选" />
              ) : radarQuery.error ? (
                <ErrorState message={radarQuery.error.message} onRetry={() => radarQuery.refetch()} />
              ) : !radarQuery.data?.length ? (
                <EmptyState
                  title="还没有发现候选"
                  description="手动同步或启用 Scheduler 后，Worker 会通过 GitHub Search 生成候选；候选不会自动进入仓库工作区。"
                  action={(
                    <Button onClick={() => startRadarSync.mutate()} disabled={isRadarSyncing}>
                      {isRadarSyncing ? (
                        <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Sparkles data-icon="inline-start" />
                      )}
                      {isRadarSyncing ? "发现中" : "开始发现"}
                    </Button>
                  )}
                />
              ) : (
                <div className="space-y-2">
                  {radarQuery.data.map((candidate, index) => (
                    <RepositoryRow
                      key={candidate.id}
                      leading={(
                        <div className="flex w-12 flex-col items-center">
                          <span className="font-mono text-sm text-muted-foreground">#{index + 1}</span>
                          <span className="mt-1 text-lg font-semibold text-primary">
                            {candidate.score ?? "—"}
                          </span>
                        </div>
                      )}
                      fullName={candidate.fullName}
                      url={candidate.url}
                      description={candidate.description}
                      language={candidate.language}
                      metrics={[
                        { icon: Star, label: formatCount(candidate.stars) },
                        { icon: GitFork, label: formatCount(candidate.forks) },
                        { icon: Clock3, label: formatDate(candidate.lastSeenAt) },
                      ]}
                      details={candidate.scoreBreakdown ? (
                        <details className="mt-3 text-xs text-muted-foreground">
                          <summary className="cursor-pointer select-none font-medium text-foreground/80">
                            为什么推荐 · {candidate.score ?? 0}/100
                          </summary>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {Object.entries(candidate.scoreBreakdown).map(([key, value]) => (
                              <div key={key} className="rounded-md border bg-muted/30 px-3 py-2">
                                <span>{scoreLabels[key] ?? key}</span>
                                <strong className="ml-2 text-foreground">+{value}</strong>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                      collecting={collectingRepo === candidate.fullName}
                      onCollect={() => handleCollect(candidate.fullName)}
                    />
                  ))}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function RepositoryRow({
  leading,
  fullName,
  url,
  description,
  language,
  metrics,
  details,
  collecting,
  onCollect,
}: {
  leading: React.ReactNode;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  metrics: Array<{ icon: typeof Star; label: string }>;
  details?: React.ReactNode;
  collecting: boolean;
  onCollect: () => void;
}) {
  return (
    <Card className="command-surface">
      <CardContent className="flex gap-3 p-4 sm:gap-4">
        <div className="shrink-0 pt-1">{leading}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 font-semibold text-foreground hover:text-primary"
              >
                <span className="truncate">{fullName}</span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {description || "暂无仓库简介"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onCollect}
              disabled={collecting}
              aria-label={`采集 ${fullName}`}
              className="shrink-0"
            >
              {collecting ? <Loader2 className="animate-spin" /> : <Check />}
              {collecting ? "采集中" : "采集"}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {language && (
              <Badge variant="secondary" className="gap-1 font-normal">
                <Code2 className="h-3 w-3" aria-hidden="true" />
                {language}
              </Badge>
            )}
            {metrics.map(({ icon: Icon, label }, index) => (
              <span key={`${label}-${index}`} className="inline-flex items-center gap-1">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
          {details}
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotMeta({ date, fetchedAt, sourceUrl }: { date: string; fetchedAt: string; sourceUrl: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span>快照日期 {date}</span>
      <span>采集于 {formatDate(fetchedAt)}</span>
      <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        查看 GitHub 原榜 <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </a>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
      <AlertCircle className="mb-3 h-6 w-6 text-destructive" />
      <p className="max-w-xl text-sm text-destructive">{message}</p>
      <Button className="mt-4" variant="outline" onClick={onRetry}><RefreshCw />重试</Button>
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
      <Sparkles className="mb-3 h-6 w-6 text-muted-foreground" />
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function InlineMessage({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={tone === "error"
        ? "mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        : "mb-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"}
    >
      {children}
    </div>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
