"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { RepoGraphEdge, RepoGraphNode } from "@devscope/shared";
import { languageColor } from "@/lib/language-colors";
import { loadGraphLayout, saveGraphLayout } from "@/lib/graph-layout";
import { oklch, useThemePalette, type ThemePalette } from "@/lib/theme-palette";
import type {
  GraphLinkDatum,
  GraphNodeDatum,
  RepoGraphRendererProps,
} from "@/components/repo-graph-canvas";

type FG3ExtraLink = Pick<RepoGraphEdge, "type" | "score">;

type Graph3DMethods = ForceGraphMethods<
  NodeObject<RepoGraphNode>,
  LinkObject<RepoGraphNode, FG3ExtraLink>
>;

interface OrbitControlsLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
  maxDistance: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface NodeObjectEntry {
  node: GraphNodeDatum;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  label: THREE.Sprite;
  baseColor: THREE.Color;
}

const LABEL_FONT = '"Geist Variable","PingFang SC","Hiragino Sans GB",system-ui,sans-serif';
const LABEL_HEIGHT = 7;
const LABEL_VISIBLE_DISTANCE = 260;
const AUTO_ROTATE_SPEED = 0.5;
const AUTO_ROTATE_RESUME_MS = 8000;
const STAR_COUNT = 320;

function nodeRadius3D(node: GraphNodeDatum): number {
  return 1.6 + Math.log10((node.stars ?? 0) + 1) * 2.2;
}

// force-graph 初始化后会把 link.source/target 替换为节点对象引用
function endpointId(endpoint: GraphLinkDatum["source"]): number | undefined {
  if (endpoint == null) return undefined;
  if (typeof endpoint === "object") return endpoint.id;
  return Number(endpoint);
}

let colorProbeCtx: CanvasRenderingContext2D | null | undefined;

// THREE.Color 无法解析 oklch，借助 canvas 归一化为 #rrggbb
function toThreeColor(css: string): THREE.Color {
  const color = new THREE.Color();
  try {
    color.setStyle(css);
    return color;
  } catch {
    if (colorProbeCtx === undefined) {
      colorProbeCtx = document.createElement("canvas").getContext("2d");
    }
    if (colorProbeCtx) {
      colorProbeCtx.fillStyle = "#000000";
      colorProbeCtx.fillStyle = css;
      return new THREE.Color(colorProbeCtx.fillStyle);
    }
    return color.set("#888888");
  }
}

function nodeBaseColor(node: GraphNodeDatum, palette: ThemePalette): THREE.Color {
  return toThreeColor(languageColor(node.language) ?? oklch(palette.muted, 0.9));
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function createLabelSprite(text: string, palette: ThemePalette): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `500 44px ${LABEL_FONT}`;
  let aspect = 4;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  if (ctx) {
    ctx.font = font;
    const label = truncateText(ctx, text, 900);
    const textWidth = Math.ceil(ctx.measureText(label).width);
    canvas.width = textWidth + 32;
    canvas.height = 64;
    aspect = canvas.width / canvas.height;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = `#${toThreeColor(oklch(palette.foreground, 0.95)).getHexString()}`;
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
  }
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(LABEL_HEIGHT * aspect, LABEL_HEIGHT, 1);
  sprite.visible = false;
  sprite.raycast = () => {};
  return sprite;
}

function disposeEntry(entry: NodeObjectEntry): void {
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
  entry.label.material.map?.dispose();
  entry.label.material.dispose();
}

// 类型定义只声明了 cameraPosition 的 setter 重载；无参调用是运行时的 getter
function readCameraPosition(fg: Graph3DMethods): { x: number; y: number; z: number } {
  return (fg.cameraPosition as unknown as () => { x: number; y: number; z: number })();
}

function createStarTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.6)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
}

export default function RepoGraphCanvas3D({
  nodes,
  links,
  reducedMotion,
  selectedNodeId,
  focusRequest,
  layoutVersion,
  onNodeHover,
  onNodeSelect,
}: RepoGraphRendererProps) {
  const fgRef = useRef<Graph3DMethods | undefined>(undefined);
  const objectsRef = useRef(new Map<number, NodeObjectEntry>());
  const starsMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const fittedRef = useRef(false);
  const flownRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const palette = useThemePalette();
  const paletteRef = useRef(palette);
  const [hoverId, setHoverId] = useState<number | null>(null);

  const focusId = hoverId ?? selectedNodeId;
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;

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

  const adjacencyRef = useRef(adjacency);
  adjacencyRef.current = adjacency;

  // ------------------------------------------------------------------
  // 材质状态：hover/选中时高亮自身与邻域，其余节点淡出
  // ------------------------------------------------------------------

  const applyNodeStates = useCallback(() => {
    const focus = focusIdRef.current;
    const neighbors = focus != null ? adjacencyRef.current.get(focus) : undefined;
    for (const [id, entry] of objectsRef.current) {
      const material = entry.mesh.material;
      const isFocus = id === focus;
      const dimmed = focus != null && !isFocus && neighbors?.has(id) !== true;
      material.opacity = dimmed ? 0.12 : 1;
      material.emissiveIntensity = isFocus ? 1.1 : dimmed ? 0.1 : 0.4;
      entry.mesh.scale.setScalar(isFocus ? 1.28 : 1);
    }
  }, []);

  useEffect(() => {
    applyNodeStates();
  }, [focusId, adjacency, applyNodeStates]);

  // 主题切换：原地更新球体颜色与标签纹理，避免重建全部节点对象
  useEffect(() => {
    paletteRef.current = palette;
    for (const entry of objectsRef.current.values()) {
      entry.baseColor.copy(nodeBaseColor(entry.node, palette));
      entry.mesh.material.color.copy(entry.baseColor).multiplyScalar(0.35);
      entry.mesh.material.emissive.copy(entry.baseColor);
      const fresh = createLabelSprite(entry.node.fullName, palette);
      entry.label.material.map?.dispose();
      entry.label.material.dispose();
      entry.label.material = fresh.material;
      entry.label.scale.copy(fresh.scale);
    }
    if (starsMaterialRef.current) {
      starsMaterialRef.current.color = toThreeColor(oklch(palette.muted, 1));
    }
    applyNodeStates();
  }, [palette, applyNodeStates]);

  // 节点集合变化后清理已移除节点的 three 对象
  useEffect(() => {
    const alive = new Set(nodes.map((n) => n.id));
    for (const [id, entry] of objectsRef.current) {
      if (!alive.has(id)) {
        disposeEntry(entry);
        objectsRef.current.delete(id);
      }
    }
  }, [nodes]);

  // ------------------------------------------------------------------
  // 布局持久化：恢复已保存位置并固定，新节点自由参与模拟
  // ------------------------------------------------------------------

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
        if (pos.z != null) {
          node.z = pos.z;
          node.fz = pos.z;
        } else {
          node.z = 0;
          node.fz = undefined;
        }
      } else {
        node.fx = undefined;
        node.fy = undefined;
        node.fz = undefined;
      }
    }
    if (layoutVersion > 0) fgRef.current?.d3ReheatSimulation();
  }, [nodes, layoutVersion]);

  // ------------------------------------------------------------------
  // 发光（UnrealBloomPass）、星点背景、相机自动环绕
  // ------------------------------------------------------------------

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const composer = fg.postProcessingComposer();
    // 发光强度需克制：阈值抬高避免整球过曝，节点少时尤其明显
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.35,
      0.3,
      0.35
    );
    const outputPass = new OutputPass();
    composer.addPass(bloomPass);
    composer.addPass(outputPass);
    return () => {
      composer.removePass(outputPass);
      composer.removePass(bloomPass);
      bloomPass.dispose();
      outputPass.dispose();
    };
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene();
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 1000 + Math.random() * 800;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const texture = createStarTexture();
    const material = new THREE.PointsMaterial({
      size: 2.4,
      map: texture,
      color: toThreeColor(oklch(paletteRef.current.muted, 1)),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const stars = new THREE.Points(geometry, material);
    stars.frustumCulled = false;
    stars.raycast = () => {};
    starsMaterialRef.current = material;
    scene.add(stars);
    return () => {
      scene.remove(stars);
      starsMaterialRef.current = null;
      geometry.dispose();
      material.dispose();
      texture.dispose();
    };
  }, []);

  const pauseAutoRotate = useCallback(() => {
    const controls = fgRef.current?.controls() as OrbitControlsLike | undefined;
    if (!controls) return;
    controls.autoRotate = false;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      controls.autoRotate = true;
    }, AUTO_ROTATE_RESUME_MS);
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const camera = fg.camera() as THREE.PerspectiveCamera;
    camera.far = 12000;
    camera.updateProjectionMatrix();
    const controls = fg.controls() as OrbitControlsLike;
    controls.maxDistance = 5000;
    controls.autoRotate = true;
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    const handleStart = () => pauseAutoRotate();
    controls.addEventListener("start", handleStart);
    return () => {
      controls.removeEventListener("start", handleStart);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [pauseAutoRotate]);

  // 标签距离自适应：相机靠近时显示 fullName，聚焦节点常显
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (time - last < 120) return;
      last = time;
      const fg = fgRef.current;
      if (!fg) return;
      const cam = readCameraPosition(fg);
      const focus = focusIdRef.current;
      const neighbors = focus != null ? adjacencyRef.current.get(focus) : undefined;
      const maxDistSq = LABEL_VISIBLE_DISTANCE * LABEL_VISIBLE_DISTANCE;
      for (const [id, entry] of objectsRef.current) {
        const { x, y, z } = entry.node;
        if (x == null || y == null || z == null) {
          entry.label.visible = false;
          continue;
        }
        const dimmed = focus != null && id !== focus && neighbors?.has(id) !== true;
        const dx = cam.x - x;
        const dy = cam.y - y;
        const dz = cam.z - z;
        const near = dx * dx + dy * dy + dz * dz < maxDistSq;
        entry.label.visible = !dimmed && (id === focus || near);
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  // ------------------------------------------------------------------
  // 搜索定位：相机飞向目标节点
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!focusRequest) return;
    const fg = fgRef.current;
    const node = nodes.find((n) => n.id === focusRequest.nodeId);
    if (!fg || !node || node.x == null || node.y == null || node.z == null) return;
    const target = { x: node.x, y: node.y, z: node.z };
    const distRatio = 1 + 160 / (Math.hypot(node.x, node.y, node.z) || 1);
    fg.cameraPosition(
      { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
      target,
      reducedMotion ? 0 : 1200
    );
    pauseAutoRotate();
  }, [focusRequest, nodes, reducedMotion, pauseAutoRotate]);

  // ------------------------------------------------------------------
  // 节点对象与边语义
  // ------------------------------------------------------------------

  const nodeThreeObject = useCallback((node: GraphNodeDatum) => {
    const pal = paletteRef.current;
    const baseColor = nodeBaseColor(node, pal);
    const radius = nodeRadius3D(node);
    const material = new THREE.MeshStandardMaterial({
      color: baseColor.clone().multiplyScalar(0.35),
      emissive: baseColor.clone(),
      emissiveIntensity: 0.4,
      roughness: 0.35,
      metalness: 0.1,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material);
    const label = createLabelSprite(node.fullName, pal);
    label.position.y = radius + LABEL_HEIGHT / 2 + 2;
    const group = new THREE.Group();
    group.add(mesh, label);

    const existing = objectsRef.current.get(node.id);
    if (existing) disposeEntry(existing);
    objectsRef.current.set(node.id, { node, mesh, label, baseColor });
    applyNodeStates();
    return group;
  }, [applyNodeStates]);

  const linkColors = useMemo(() => {
    const bg = toThreeColor(oklch(palette.background, 1));
    const primary = toThreeColor(oklch(palette.primary, 1));
    const warning = toThreeColor(oklch(palette.warning, 1));
    const mix = (color: THREE.Color, t: number) => `#${color.clone().lerp(bg, t).getHexString()}`;
    return {
      similarity: mix(primary, 0.45),
      similarityActive: mix(primary, 0.05),
      dependency: mix(warning, 0.35),
      dependencyActive: mix(warning, 0),
      dimmed: mix(primary, 0.9),
    };
  }, [palette]);

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
      if (state === "dimmed") return linkColors.dimmed;
      if (link.type === "dependency") {
        return state === "active" ? linkColors.dependencyActive : linkColors.dependency;
      }
      return state === "active" ? linkColors.similarityActive : linkColors.similarity;
    },
    [linkState, linkColors]
  );

  const linkWidth = useCallback(
    (link: GraphLinkDatum): number => {
      const active = linkState(link) === "active";
      if (link.type === "dependency") return active ? 1.2 : 0.8;
      const score = link.score ?? 0.5;
      return (0.22 + score * 0.3) * (active ? 1.5 : 1);
    },
    [linkState]
  );

  const linkParticles = useCallback(
    (link: GraphLinkDatum): number => {
      if (linkState(link) === "dimmed") return 0;
      return link.type === "dependency" ? 4 : 2;
    },
    [linkState]
  );

  const linkParticleSpeed = useCallback(
    (link: GraphLinkDatum): number => (link.type === "dependency" ? 0.015 : 0.004),
    []
  );

  const linkParticleWidth = useCallback(
    (link: GraphLinkDatum): number => (link.type === "dependency" ? 1 : 0.55),
    []
  );

  const linkArrowLength = useCallback(
    (link: GraphLinkDatum): number => (link.type === "dependency" ? 4 : 0),
    []
  );

  // ------------------------------------------------------------------
  // 交互回调
  // ------------------------------------------------------------------

  const handleNodeHover = useCallback(
    (node: NodeObject<RepoGraphNode> | null) => {
      const next = (node as GraphNodeDatum | null) ?? null;
      setHoverId(next?.id ?? null);
      onNodeHover(next);
      if (next) pauseAutoRotate();
    },
    [onNodeHover, pauseAutoRotate]
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
      node.fz = node.z;
      saveGraphLayout(nodes, true);
    },
    [nodes]
  );

  const handleEngineStop = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    saveGraphLayout(nodes, true);
    if (fittedRef.current) return;
    fittedRef.current = true;
    fg.zoomToFit(0, 80);
    if (!flownRef.current) {
      flownRef.current = true;
      pauseAutoRotate();
      const target = { ...readCameraPosition(fg) };
      const far = { x: target.x * 3.2, y: target.y * 3.2, z: target.z * 3.2 };
      fg.cameraPosition(far, { x: 0, y: 0, z: 0 }, 0);
      fg.cameraPosition(target, { x: 0, y: 0, z: 0 }, 1500);
    }
  }, [nodes, pauseAutoRotate]);

  return (
    <ForceGraph3D<RepoGraphNode, FG3ExtraLink>
      ref={fgRef}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      controlType="orbit"
      showNavInfo={false}
      nodeId="id"
      nodeVal={(node) => nodeRadius3D(node) ** 2}
      nodeLabel={() => ""}
      nodeThreeObject={nodeThreeObject}
      linkOpacity={1}
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
