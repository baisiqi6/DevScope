"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import type { RepoGraphEdge, RepoGraphNode } from "@devscope/shared";
import { languageColor } from "@/lib/language-colors";
import { loadGraphLayout, saveGraphLayout } from "@/lib/graph-layout";
import { oklch, useThemePalette } from "@/lib/theme-palette";

type FGExtraLink = Pick<RepoGraphEdge, "type" | "score">;

export type GraphNodeDatum = NodeObject<RepoGraphNode>;
export type GraphLinkDatum = LinkObject<RepoGraphNode, FGExtraLink>;

type GraphMethods = ForceGraphMethods<NodeObject<RepoGraphNode>, LinkObject<RepoGraphNode, FGExtraLink>>;

export interface RepoGraphRendererProps {
  nodes: GraphNodeDatum[];
  links: GraphLinkDatum[];
  reducedMotion: boolean;
  isMobile: boolean;
  selectedNodeId: string | null;
  focusRequest: { nodeId: string; seq: number } | null;
  layoutVersion: number;
  onNodeHover: (node: GraphNodeDatum | null) => void;
  onNodeSelect: (id: string | null) => void;
}

// force-graph 初始化后会把 link.source/target 替换为节点对象引用
function endpointId(endpoint: GraphLinkDatum["source"]): string | undefined {
  if (endpoint == null) return undefined;
  if (typeof endpoint === "object") return endpoint.id;
  return String(endpoint);
}

function nodeRadius(node: GraphNodeDatum, degree: number): number {
  // 语言节点没有 stars，固定一个适中尺寸作为枢纽
  if (node.kind === "language") return 5;
  // 基石节点按连接度（被多少边依赖）定尺寸，视觉上与仓库节点同量级
  if (node.kind === "reference") return 5 + Math.log10(degree + 1) * 4.2;
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
  layoutVersion,
  onNodeHover,
  onNodeSelect,
}: RepoGraphRendererProps) {
  const fgRef = useRef<GraphMethods | undefined>(undefined);
  const fittedRef = useRef(false);
  const palette = useThemePalette();
  const [hoverId, setHoverId] = useState<string | null>(null);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  // 连接度（无向边计数）：基石节点尺寸的驱动量
  const degreeById = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of links) {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      if (s == null || t == null) continue;
      map.set(s, (map.get(s) ?? 0) + 1);
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return map;
  }, [links]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
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
    const stored = loadGraphLayout();
    for (const node of nodes) {
      const pos = stored[node.fullName];
      if (pos) {
        node.x = pos.x;
        node.y = pos.y;
        node.fx = pos.x;
        node.fy = pos.y;
      } else {
        node.fx = undefined;
        node.fy = undefined;
      }
    }
    if (layoutVersion > 0) fgRef.current?.d3ReheatSimulation();
  }, [nodes, layoutVersion]);

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

      const base = nodeRadius(node, degreeById.get(node.id) ?? 0);
      const r = isHovered ? base * 1.3 : base;

      ctx.globalAlpha = dimmed ? 0.15 : 1;

      // 按节点类型着色：仓库=语言色，基石依赖=琥珀色，语言=主色
      let fill: string;
      if (node.kind === "reference") {
        fill = oklch(palette.warning, 0.9);
      } else if (node.kind === "language") {
        fill = oklch(palette.primary, 0.9);
      } else {
        fill = languageColor(node.language) ?? oklch(palette.muted, 0.9);
      }

      if (!dimmed) {
        ctx.shadowColor = oklch(palette.primary, isHovered || isSelected ? 0.9 : 0.5);
        ctx.shadowBlur = isHovered || isSelected ? 14 : 5;
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      if (node.kind === "reference") {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
      } else if (node.kind === "language") {
        // 黑洞化：漆黑核心 + 青色吸积环渐变
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI, false);
        ctx.fill();
        const ringGradient = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 2.2);
        ringGradient.addColorStop(0, oklch(palette.primary, 0));
        ringGradient.addColorStop(0.55, oklch(palette.primary, 0.9));
        ringGradient.addColorStop(1, oklch(palette.primary, 0));
        ctx.fillStyle = ringGradient;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.2, 0, 2 * Math.PI, false);
        ctx.fill();
      } else {
        ctx.arc(x, y, r, 0, 2 * Math.PI, false);
        ctx.fill();
      }
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
    [hoverId, selectedNodeId, focusId, adjacency, palette, degreeById]
  );

  const paintNodeArea = useCallback((node: GraphNodeDatum, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node, degreeById.get(node.id) ?? 0) + 2, 0, 2 * Math.PI, false);
    ctx.fill();
  }, [degreeById]);

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
      if (link.type === "written_in") {
        return oklch(palette.muted, state === "active" ? 0.4 : 0.16);
      }
      return oklch(palette.primary, state === "active" ? 0.65 : 0.26);
    },
    [linkState, palette]
  );

  const linkWidth = useCallback(
    (link: GraphLinkDatum): number => {
      const active = linkState(link) === "active";
      if (link.type === "written_in") return active ? 0.9 : 0.5;
      if (link.type === "dependency") return active ? 2.2 : 1.4;
      const score = link.score ?? 0.5;
      return (0.3 + score * 1.1) * (active ? 1.6 : 1);
    },
    [linkState]
  );

  const linkParticles = useCallback(
    (link: GraphLinkDatum): number => {
      // written_in 边不显示粒子
      if (link.type === "written_in") return 0;
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

  const linkLineDash = useCallback(
    (link: GraphLinkDatum): number[] | null => (link.type === "written_in" ? [2, 2] : null),
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

  const handleNodeDragEnd = useCallback(
    (node: NodeObject<RepoGraphNode>) => {
      node.fx = node.x;
      node.fy = node.y;
      saveGraphLayout(nodes, false);
    },
    [nodes]
  );

  const handleEngineStop = useCallback(() => {
    saveGraphLayout(nodes, false);
    if (fittedRef.current) return;
    fittedRef.current = true;
    fgRef.current?.zoomToFit(reducedMotion ? 0 : 400, 60);
  }, [nodes, reducedMotion]);

  return (
    <ForceGraph2D<RepoGraphNode, FGExtraLink>
      ref={fgRef}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      nodeId="id"
      nodeVal={(node) => nodeRadius(node, degreeById.get(node.id as string) ?? 0) ** 2}
      nodeLabel={() => ""}
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={paintNodeArea}
      linkColor={linkColor}
      linkWidth={linkWidth}
      linkLineDash={linkLineDash}
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
