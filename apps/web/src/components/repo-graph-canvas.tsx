"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import type { RepoGraphEdge, RepoGraphNode } from "@devscope/shared";
import { languageColor } from "@/lib/language-colors";

type FGExtraLink = Pick<RepoGraphEdge, "type" | "score">;

export type GraphNodeDatum = NodeObject<RepoGraphNode>;
export type GraphLinkDatum = LinkObject<RepoGraphNode, FGExtraLink>;

type GraphMethods = ForceGraphMethods<NodeObject<RepoGraphNode>, LinkObject<RepoGraphNode, FGExtraLink>>;

interface RepoGraphCanvasProps {
  nodes: GraphNodeDatum[];
  links: GraphLinkDatum[];
  reducedMotion: boolean;
  isMobile: boolean;
  selectedNodeId: number | null;
  focusRequest: { nodeId: number; seq: number } | null;
  onNodeHover: (node: GraphNodeDatum | null) => void;
  onNodeSelect: (id: number | null) => void;
}

interface ThemePalette {
  primary: string;
  warning: string;
  muted: string;
  foreground: string;
}

function readPalette(): ThemePalette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    primary: read("--primary"),
    warning: read("--warning"),
    muted: read("--muted-foreground"),
    foreground: read("--foreground"),
  };
}

function oklch(triplet: string, alpha: number): string {
  return `oklch(${triplet} / ${alpha})`;
}

function useThemePalette(): ThemePalette {
  const [palette, setPalette] = useState<ThemePalette>(readPalette);

  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return palette;
}

// force-graph 初始化后会把 link.source/target 替换为节点对象引用
function endpointId(endpoint: GraphLinkDatum["source"]): number | undefined {
  if (endpoint == null) return undefined;
  if (typeof endpoint === "object") return endpoint.id;
  return Number(endpoint);
}

function nodeRadius(node: GraphNodeDatum): number {
  return 2 + Math.log10((node.stars ?? 0) + 1) * 2.4;
}

const LABEL_FONT = '"Geist Variable","PingFang SC","Hiragino Sans GB",system-ui,sans-serif';

export default function RepoGraphCanvas({
  nodes,
  links,
  reducedMotion,
  isMobile,
  selectedNodeId,
  focusRequest,
  onNodeHover,
  onNodeSelect,
}: RepoGraphCanvasProps) {
  const fgRef = useRef<GraphMethods | undefined>(undefined);
  const fittedRef = useRef(false);
  const palette = useThemePalette();
  const [hoverId, setHoverId] = useState<number | null>(null);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const adjacency = useMemo(() => {
    const map = new Map<number, Set<number>>();
    const add = (a: number, b: number) => {
      let set = map.get(a);
      if (!set) {
        set = new Set();
        map.set(a, set);
      }
      set.add(b);
    };
    for (const link of links) {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      if (s == null || t == null) continue;
      add(s, t);
      add(t, s);
    }
    return map;
  }, [links]);

  useEffect(() => {
    fittedRef.current = false;
  }, [nodes]);

  useEffect(() => {
    if (!focusRequest) return;
    const fg = fgRef.current;
    const node = nodes.find((n) => n.id === focusRequest.nodeId);
    if (!fg || !node || node.x == null || node.y == null) return;
    const duration = reducedMotion ? 0 : 600;
    fg.centerAt(node.x, node.y, duration);
    fg.zoom(2.4, duration);
  }, [focusRequest, nodes, reducedMotion]);

  const focusId = hoverId ?? selectedNodeId;

  const paintNode = useCallback(
    (node: GraphNodeDatum, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const isHovered = node.id === hoverId;
      const isSelected = node.id === selectedNodeId;
      const inNeighborhood =
        focusId != null && (node.id === focusId || adjacency.get(focusId)?.has(node.id) === true);
      const dimmed = focusId != null && !inNeighborhood;

      const base = nodeRadius(node);
      const r = isHovered ? base * 1.3 : base;

      ctx.globalAlpha = dimmed ? 0.15 : 1;

      if (!dimmed) {
        ctx.shadowColor = oklch(palette.primary, isHovered || isSelected ? 0.9 : 0.5);
        ctx.shadowBlur = isHovered || isSelected ? 14 : 5;
      }
      ctx.fillStyle = languageColor(node.language) ?? oklch(palette.muted, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI, false);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isSelected) {
        ctx.strokeStyle = oklch(palette.foreground, 0.85);
        ctx.lineWidth = 1.4 / globalScale;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.4 / globalScale, 0, 2 * Math.PI, false);
        ctx.stroke();
      }

      if (isHovered || isSelected) {
        const fontSize = 11 / globalScale;
        ctx.font = `${fontSize}px ${LABEL_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = oklch(palette.foreground, 0.92);
        ctx.fillText(node.fullName, x, y + r + 3 / globalScale);
      }

      ctx.globalAlpha = 1;
    },
    [hoverId, selectedNodeId, focusId, adjacency, palette]
  );

  const paintNodeArea = useCallback((node: GraphNodeDatum, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node) + 2, 0, 2 * Math.PI, false);
    ctx.fill();
  }, []);

  const linkState = useCallback(
    (link: GraphLinkDatum): "normal" | "active" | "dimmed" => {
      if (focusId == null) return "normal";
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      return s === focusId || t === focusId ? "active" : "dimmed";
    },
    [focusId]
  );

  const linkColor = useCallback(
    (link: GraphLinkDatum): string => {
      const state = linkState(link);
      if (state === "dimmed") return oklch(palette.primary, 0.03);
      if (link.type === "dependency") {
        return oklch(palette.warning, state === "active" ? 0.75 : 0.38);
      }
      return oklch(palette.primary, state === "active" ? 0.65 : 0.26);
    },
    [linkState, palette]
  );

  const linkWidth = useCallback(
    (link: GraphLinkDatum): number => {
      const active = linkState(link) === "active";
      if (link.type === "dependency") return active ? 2.2 : 1.4;
      const score = link.score ?? 0.5;
      return (0.3 + score * 1.1) * (active ? 1.6 : 1);
    },
    [linkState]
  );

  const linkParticles = useCallback(
    (link: GraphLinkDatum): number => {
      if (reducedMotion || linkState(link) === "dimmed") return 0;
      const base = link.type === "dependency" ? 4 : 2;
      return isMobile ? Math.ceil(base / 2) : base;
    },
    [reducedMotion, isMobile, linkState]
  );

  const linkParticleSpeed = useCallback(
    (link: GraphLinkDatum): number => (link.type === "dependency" ? 0.015 : 0.004),
    []
  );

  const linkParticleWidth = useCallback(
    (link: GraphLinkDatum): number => (link.type === "dependency" ? 2.4 : 1.5),
    []
  );

  const linkArrowLength = useCallback(
    (link: GraphLinkDatum): number => (link.type === "dependency" ? 4 : 0),
    []
  );

  const handleNodeHover = useCallback(
    (node: NodeObject<RepoGraphNode> | null) => {
      const next = (node as GraphNodeDatum | null) ?? null;
      setHoverId(next?.id ?? null);
      onNodeHover(next);
    },
    [onNodeHover]
  );

  const handleNodeClick = useCallback(
    (node: NodeObject<RepoGraphNode>) => {
      onNodeSelect((node as GraphNodeDatum).id);
    },
    [onNodeSelect]
  );

  const handleBackgroundClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  const handleNodeDragEnd = useCallback((node: NodeObject<RepoGraphNode>) => {
    node.fx = undefined;
    node.fy = undefined;
    fgRef.current?.d3ReheatSimulation();
  }, []);

  const handleEngineStop = useCallback(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    fgRef.current?.zoomToFit(reducedMotion ? 0 : 400, 60);
  }, [reducedMotion]);

  return (
    <ForceGraph2D<RepoGraphNode, FGExtraLink>
      ref={fgRef}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      nodeId="id"
      nodeVal={(node) => nodeRadius(node) ** 2}
      nodeLabel={() => ""}
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={paintNodeArea}
      linkColor={linkColor}
      linkWidth={linkWidth}
      linkDirectionalParticles={linkParticles}
      linkDirectionalParticleSpeed={linkParticleSpeed}
      linkDirectionalParticleWidth={linkParticleWidth}
      linkDirectionalParticleColor={linkColor}
      linkDirectionalArrowLength={linkArrowLength}
      linkDirectionalArrowRelPos={1}
      linkDirectionalArrowColor={linkColor}
      warmupTicks={60}
      cooldownTicks={300}
      onEngineStop={handleEngineStop}
      onNodeHover={handleNodeHover}
      onNodeClick={handleNodeClick}
      onBackgroundClick={handleBackgroundClick}
      onNodeDragEnd={handleNodeDragEnd}
    />
  );
}
