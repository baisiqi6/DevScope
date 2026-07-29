"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Shuffle,
  Star,
  X,
} from "lucide-react";
import type { RepoGraphEdge, RepoGraphNode } from "@devscope/shared";
import { trpc } from "@/lib/trpc";
import { AnimatedBackground } from "@/components/animated-background";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/lib/use-media-query";
import { languageColor } from "@/lib/language-colors";
import { clearGraphLayout } from "@/lib/graph-layout";
import { cn } from "@/lib/utils";
import type { GraphLinkDatum, GraphNodeDatum } from "@/components/repo-graph-canvas";

const RepoGraphView = dynamic(() => import("@/components/repo-graph-view"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
      图谱组件加载中…
    </div>
  ),
});

// ============================================================================
// dev mock：NEXT_PUBLIC_GRAPH_MOCK=300 时注入确定性模拟数据，用于性能验证
// ============================================================================

const MOCK_SIZE = Number.parseInt(process.env.NEXT_PUBLIC_GRAPH_MOCK ?? "", 10);
const MOCK_ENABLED = Number.isFinite(MOCK_SIZE) && MOCK_SIZE > 0;

function buildMockGraph(size: number): { nodes: RepoGraphNode[]; edges: RepoGraphEdge[] } {
  let seed = 42;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const langs = [
    "TypeScript", "JavaScript", "Python", "Go", "Rust",
    "Java", "Ruby", "C++", "Shell", "Vue",
  ];
  const nodes: RepoGraphNode[] = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    fullName: `org-${Math.floor(i / 10)}/repo-${i}`,
    name: `repo-${i}`,
    language: langs[Math.floor(rand() * langs.length)],
    stars: Math.floor(10 ** (rand() * 5)),
    description: `用于图谱性能验证的模拟仓库 ${i}`,
  }));
  const edges: RepoGraphEdge[] = [];
  for (let i = 1; i < size; i++) {
    const similar = rand() < 0.65;
    edges.push({
      source: i + 1,
      target: Math.floor(rand() * i) + 1,
      type: similar ? "similarity" : "dependency",
      score: similar ? 0.4 + rand() * 0.6 : null,
    });
    if (rand() < 0.5) {
      const extra = Math.floor(rand() * size) + 1;
      const extraSimilar = rand() < 0.5;
      if (extra !== i + 1) {
        edges.push({
          source: i + 1,
          target: extra,
          type: extraSimilar ? "similarity" : "dependency",
          score: extraSimilar ? 0.3 + rand() * 0.7 : null,
        });
      }
    }
  }
  return { nodes, edges };
}

const MOCK_DATA = MOCK_ENABLED ? buildMockGraph(MOCK_SIZE) : null;

// ============================================================================

interface NeighborEntry {
  node: RepoGraphNode;
  score: number | null;
}

export default function GraphPage() {
  const utils = trpc.useUtils();
  const graphQuery = trpc.graph.getRepoGraph.useQuery(undefined, { enabled: !MOCK_ENABLED });
  const rebuild = trpc.graph.rebuildRepoGraph.useMutation({
    onSuccess: (result) => {
      setRebuildMsg(
        `重建完成：${result.pooledRepos} 仓库 · 相似 ${result.similarityEdges} · 依赖 ${result.dependencyEdges}`
      );
      void utils.graph.getRepoGraph.invalidate();
    },
    onError: (error) => setRebuildMsg(`重建失败：${error.message}`),
  });

  const reduceMotion = useReducedMotion() ?? false;
  const isMobile = useMediaQuery("(max-width: 767px)");

  const [showSimilarity, setShowSimilarity] = useState(true);
  const [showDependency, setShowDependency] = useState(true);
  const [threshold, setThreshold] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: number; seq: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNodeDatum | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const focusSeq = useRef(0);

  const rawData = MOCK_DATA ?? graphQuery.data;

  // force-graph 会原地修改节点/边对象（追加坐标、替换端点引用），必须传入副本
  const nodes = useMemo<GraphNodeDatum[]>(
    () => rawData?.nodes.map((n) => ({ ...n })) ?? [],
    [rawData]
  );

  const links = useMemo<GraphLinkDatum[]>(() => {
    const edges = rawData?.edges ?? [];
    return edges
      .filter((e) =>
        e.type === "similarity"
          ? showSimilarity && (e.score ?? 0) >= threshold
          : showDependency
      )
      .map((e) => ({ ...e }));
  }, [rawData, showSimilarity, showDependency, threshold]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const statsById = useMemo(() => {
    const map = new Map<number, { similar: number; depOut: number; depIn: number }>();
    for (const node of nodes) map.set(node.id, { similar: 0, depOut: 0, depIn: 0 });
    for (const edge of rawData?.edges ?? []) {
      if (edge.type === "similarity") {
        const s = map.get(edge.source);
        const t = map.get(edge.target);
        if (s) s.similar += 1;
        if (t && edge.target !== edge.source) t.similar += 1;
      } else {
        const s = map.get(edge.source);
        const t = map.get(edge.target);
        if (s) s.depOut += 1;
        if (t) t.depIn += 1;
      }
    }
    return map;
  }, [nodes, rawData]);

  const neighbors = useMemo(() => {
    if (selectedId == null || !rawData) return null;
    const similar = new Map<number, NeighborEntry>();
    const dependsOn: NeighborEntry[] = [];
    const dependedBy: NeighborEntry[] = [];
    for (const edge of rawData.edges) {
      if (edge.type === "similarity") {
        const otherId = edge.source === selectedId ? edge.target : edge.target === selectedId ? edge.source : null;
        if (otherId == null) continue;
        const node = nodeById.get(otherId);
        if (!node) continue;
        const existing = similar.get(otherId);
        if (!existing || (edge.score ?? 0) > (existing.score ?? 0)) {
          similar.set(otherId, { node, score: edge.score });
        }
      } else if (edge.source === selectedId) {
        const node = nodeById.get(edge.target);
        if (node) dependsOn.push({ node, score: null });
      } else if (edge.target === selectedId) {
        const node = nodeById.get(edge.source);
        if (node) dependedBy.push({ node, score: null });
      }
    }
    return {
      similar: [...similar.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      dependsOn,
      dependedBy,
    };
  }, [selectedId, rawData, nodeById]);

  const focusNode = useCallback((id: number) => {
    focusSeq.current += 1;
    setFocusRequest({ nodeId: id, seq: focusSeq.current });
  }, []);

  const handleNodeHover = useCallback((node: GraphNodeDatum | null) => {
    setHoveredNode(node);
  }, []);

  const handleNodeSelect = useCallback((id: number | null) => {
    setSelectedId(id);
  }, []);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const q = searchText.trim().toLowerCase();
    if (!q) return;
    const match = nodes.find((n) => n.fullName.toLowerCase().includes(q));
    if (!match) {
      setSearchError("未找到匹配的仓库");
      return;
    }
    setSearchError(null);
    focusNode(match.id);
  };

  const handleTooltipMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = tooltipRef.current;
    if (!el) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.min(event.clientX - box.left + 14, box.width - 272);
    const y = Math.min(event.clientY - box.top + 14, box.height - 150);
    el.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
  };

  const selectedNode = selectedId != null ? nodeById.get(selectedId) ?? null : null;
  const rawEdgeCount = rawData?.edges.length ?? 0;
  const isLoading = !MOCK_ENABLED && graphQuery.isLoading;
  const error = !MOCK_ENABLED ? graphQuery.error : null;

  const toolbar = (
    <div className="command-toolbar">
      <div className="container mx-auto flex flex-wrap items-center gap-x-4 gap-y-2 px-4">
        <div className="mr-auto flex items-baseline gap-3">
          <h1 className="text-sm font-semibold">关系图谱</h1>
          <p className="text-xs text-muted-foreground">
            {nodes.length} 仓库 · {links.length} 条可见关系
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-1.5">
          <Input
            value={searchText}
            onChange={(event) => {
              setSearchText(event.target.value);
              setSearchError(null);
            }}
            placeholder="仓库名定位…"
            aria-label="按仓库 fullName 定位节点"
            className="h-9 w-40 max-w-[38vw]"
          />
          <Button type="submit" variant="outline" size="sm" aria-label="定位节点">
            <Search aria-hidden="true" />
          </Button>
        </form>
        {searchError && (
          <span role="alert" className="text-xs text-destructive">
            {searchError}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={showSimilarity}
            onClick={() => setShowSimilarity((v) => !v)}
            className={cn(!showSimilarity && "opacity-50")}
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
            相似边
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={showDependency}
            onClick={() => setShowDependency((v) => !v)}
            className={cn(!showDependency && "opacity-50")}
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warning" />
            依赖边
          </Button>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          相似度阈值
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            disabled={!showSimilarity}
            onChange={(event) => setThreshold(Number(event.target.value))}
            aria-label="相似度阈值"
            className="h-1.5 w-24 accent-primary disabled:opacity-40"
          />
          <span className="w-8 font-mono">{threshold.toFixed(2)}</span>
        </label>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              clearGraphLayout();
              setLayoutVersion((v) => v + 1);
            }}
          >
            <Shuffle aria-hidden="true" />
            重排布局
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rebuild.isPending || MOCK_ENABLED}
            title={MOCK_ENABLED ? "模拟数据模式下不可用" : undefined}
            onClick={() => {
              setRebuildMsg(null);
              rebuild.mutate();
            }}
          >
            <RefreshCw aria-hidden="true" className={cn(rebuild.isPending && "animate-spin")} />
            重建图谱
          </Button>
          {rebuildMsg && (
            <span role="status" className="text-xs text-muted-foreground">
              {rebuildMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
        关系图谱加载中…
      </div>
    );
  } else if (error) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium text-destructive">图谱数据加载失败</p>
        <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => graphQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  } else if (nodes.length === 0) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <Network aria-hidden="true" className="h-10 w-10 text-muted-foreground/60" />
        <p className="text-sm font-medium">暂无仓库关系数据</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          先采集更多仓库，再回到这里重建图谱，即可看到仓库之间的相似与依赖关系。
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/">回首页采集</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rebuild.isPending || MOCK_ENABLED}
            onClick={() => rebuild.mutate()}
          >
            <RefreshCw aria-hidden="true" className={cn(rebuild.isPending && "animate-spin")} />
            重建图谱
          </Button>
        </div>
      </div>
    );
  } else if (rawEdgeCount === 0) {
    content = (
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-2xl px-4 py-8">
          <p className="mb-4 text-sm text-muted-foreground">
            已采集 {nodes.length} 个仓库，但还没有关系边。尝试重建图谱，或先采集更多仓库。
          </p>
          <ul className="divide-y divide-border/60 rounded-lg border border-border/80 bg-card/60">
            {nodes.map((node) => (
              <li key={node.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: languageColor(node.language) ?? "oklch(var(--muted-foreground) / 0.6)" }}
                />
                <span className="truncate font-mono text-xs">{node.fullName}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Star aria-hidden="true" className="h-3 w-3" />
                  {node.stars ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="relative min-h-0 flex-1" onMouseMove={handleTooltipMove}>
        <RepoGraphView
          nodes={nodes}
          links={links}
          reducedMotion={reduceMotion}
          isMobile={isMobile}
          selectedNodeId={selectedId}
          focusRequest={focusRequest}
          layoutVersion={layoutVersion}
          onNodeHover={handleNodeHover}
          onNodeSelect={handleNodeSelect}
        />

        <div
          ref={tooltipRef}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 top-0 z-10 w-64 rounded-md border border-border/80 bg-popover/95 p-3 text-xs shadow-sm",
            !hoveredNode && "invisible"
          )}
        >
          {hoveredNode && (
            <>
              <p className="font-mono text-[13px] font-semibold">{hoveredNode.fullName}</p>
              {hoveredNode.description && (
                <p className="mt-1 line-clamp-2 text-muted-foreground">
                  {hoveredNode.description.length > 80
                    ? `${hoveredNode.description.slice(0, 80)}…`
                    : hoveredNode.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Star aria-hidden="true" className="h-3 w-3" />
                  {hoveredNode.stars ?? 0}
                </span>
                {hoveredNode.language && (
                  <span className="flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor:
                          languageColor(hoveredNode.language) ?? "oklch(var(--muted-foreground) / 0.6)",
                      }}
                    />
                    {hoveredNode.language}
                  </span>
                )}
                {(() => {
                  const stats = statsById.get(hoveredNode.id);
                  return stats ? (
                    <span>
                      相似 {stats.similar} · 依赖 {stats.depOut} · 被依赖 {stats.depIn}
                    </span>
                  ) : null;
                })()}
              </div>
            </>
          )}
        </div>

        <aside
          aria-label="仓库摘要"
          aria-hidden={!selectedNode}
          className={cn(
            "absolute z-20 flex flex-col border-border/80 bg-card/95 backdrop-blur-sm transition-transform duration-200 motion-reduce:transition-none",
            "max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[55%] max-md:rounded-t-lg max-md:border-t",
            "md:inset-y-0 md:right-0 md:w-80 md:border-l",
            selectedNode
              ? "max-md:translate-y-0 md:translate-x-0"
              : "pointer-events-none max-md:translate-y-full md:translate-x-full"
          )}
        >
          {selectedNode && (
            <>
              <header className="flex items-start justify-between gap-2 border-b border-border/80 p-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold">{selectedNode.fullName}</p>
                  {selectedNode.description && (
                    <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                      {selectedNode.description}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="关闭摘要面板"
                  onClick={() => setSelectedId(null)}
                >
                  <X aria-hidden="true" />
                </Button>
              </header>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Star aria-hidden="true" className="h-3.5 w-3.5" />
                    {selectedNode.stars ?? 0}
                  </span>
                  {selectedNode.language && (
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            languageColor(selectedNode.language) ??
                            "oklch(var(--muted-foreground) / 0.6)",
                        }}
                      />
                      {selectedNode.language}
                    </span>
                  )}
                </div>

                {neighbors && (
                  <>
                    <NeighborSection
                      title={`相似邻居（${neighbors.similar.length}）`}
                      entries={neighbors.similar}
                      onPick={(id) => {
                        setSelectedId(id);
                        focusNode(id);
                      }}
                    />
                    <NeighborSection
                      title={`依赖（${neighbors.dependsOn.length}）`}
                      entries={neighbors.dependsOn}
                      onPick={(id) => {
                        setSelectedId(id);
                        focusNode(id);
                      }}
                    />
                    <NeighborSection
                      title={`被依赖（${neighbors.dependedBy.length}）`}
                      entries={neighbors.dependedBy}
                      onPick={(id) => {
                        setSelectedId(id);
                        focusNode(id);
                      }}
                    />
                  </>
                )}
              </div>

              <footer className="border-t border-border/80 p-4">
                <Button asChild className="w-full">
                  <Link href={`/repository/${selectedNode.id}`}>
                    查看详情
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
              </footer>
            </>
          )}
        </aside>
      </div>
    );
  }

  return (
    <main className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      <AnimatedBackground />
      {toolbar}
      {content}
    </main>
  );
}

function NeighborSection({
  title,
  entries,
  onPick,
}: {
  title: string;
  entries: NeighborEntry[];
  onPick: (id: number) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h2>
      <ul className="space-y-1">
        {entries.map(({ node, score }) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onPick(node.id)}
              className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:border-border/80 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    languageColor(node.language) ?? "oklch(var(--muted-foreground) / 0.6)",
                }}
              />
              <span className="truncate font-mono">{node.fullName}</span>
              {score != null && (
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {Math.round(score * 100)}%
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
