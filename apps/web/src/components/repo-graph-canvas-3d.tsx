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
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>;
  /** 语言节点的黑洞吸积环（仅 kind=language 存在） */
  ring?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  baseColor: THREE.Color;
}

const LABEL_FONT = '"Geist Variable","PingFang SC","Hiragino Sans GB",system-ui,sans-serif';
const LABEL_HEIGHT = 7;
const LABEL_VISIBLE_DISTANCE = 260;
const AUTO_ROTATE_SPEED = 0.5;
const AUTO_ROTATE_RESUME_MS = 8000;
const STAR_COUNT = 320;

function nodeRadius3D(node: GraphNodeDatum, degree: number): number {
  // 语言节点没有 stars，固定一个适中尺寸作为枢纽
  if (node.kind === "language") return 4.2;
  // 基石节点按连接度（被多少边依赖）定尺寸，视觉上与仓库球体同量级
  if (node.kind === "reference") return 4.5 + Math.log10(degree + 1) * 4;
  return 1.6 + Math.log10((node.stars ?? 0) + 1) * 2.2;
}

// force-graph 初始化后会把 link.source/target 替换为节点对象引用
function endpointId(endpoint: GraphLinkDatum["source"]): string | undefined {
  if (endpoint == null) return undefined;
  if (typeof endpoint === "object") return endpoint.id;
  return String(endpoint);
}

let colorProbeCtx: CanvasRenderingContext2D | null | undefined;

// THREE.Color.setStyle 不识别 oklch（只告警并返回默认白色），
// 现代 Chrome 的 canvas 归一化也保留 oklch 格式——必须自己做 OKLCH→sRGB 转换
const OKLCH_RE = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i;

function oklchToSrgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  const toGamma = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  };
  return [
    toGamma(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    toGamma(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    toGamma(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

// THREE.Color 无法解析 oklch，借助 canvas 归一化为 #rrggbb
function toThreeColor(css: string): THREE.Color {
  const trimmed = css.trim();
  const oklchMatch = OKLCH_RE.exec(trimmed);
  if (oklchMatch) {
    const [r, g, b] = oklchToSrgb(
      Number(oklchMatch[1]),
      Number(oklchMatch[2]),
      Number(oklchMatch[3])
    );
    return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  }
  if (colorProbeCtx === undefined) {
    colorProbeCtx = document.createElement("canvas").getContext("2d");
  }
  try {
    return new THREE.Color().setStyle(trimmed);
  } catch {
    if (colorProbeCtx) {
      colorProbeCtx.fillStyle = "#000000";
      colorProbeCtx.fillStyle = trimmed;
      return new THREE.Color(colorProbeCtx.fillStyle);
    }
    return new THREE.Color("#888888");
  }
}

function nodeBaseColor(node: GraphNodeDatum, palette: ThemePalette): THREE.Color {
  // 按节点类型着色：仓库=语言色，技术栈=琥珀色，语言=主色。
  // 技术栈用全饱和琥珀（无光照材质下 bloom 只加琥珀辉光，不会洗白）；语言节点略压暗避免喧宾夺主
  if (node.kind === "reference") return toThreeColor(oklch(palette.warning, 1));
  if (node.kind === "language") return toThreeColor(oklch(palette.primary, 1)).multiplyScalar(0.65);
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
  if (entry.ring) {
    entry.ring.geometry.dispose();
    entry.ring.material.map?.dispose();
    entry.ring.material.dispose();
  }
  entry.label.material.map?.dispose();
  entry.label.material.dispose();
}

/** 语言节点吸积环纹理：内缘淡、主环亮、外缘衰减的黑洞光环 */
function createAccretionTexture(color: THREE.Color): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const rgb = color
      .toArray()
      .map((v) => Math.round(v * 255))
      .join(",");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${rgb},0)`);
    gradient.addColorStop(0.5, `rgba(${rgb},0.15)`);
    gradient.addColorStop(0.72, `rgba(${rgb},0.95)`);
    gradient.addColorStop(0.85, `rgba(${rgb},0.4)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
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
  const objectsRef = useRef(new Map<string, NodeObjectEntry>());
  const starsMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const fittedRef = useRef(false);
  const flownRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const palette = useThemePalette();
  const paletteRef = useRef(palette);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const focusId = hoverId ?? selectedNodeId;
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;

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
    }
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
      if (entry.node.kind === "language") {
        // 黑洞核心不参与主题/聚焦染色，颜色变化只由吸积环承担。
        material.color.set("#000000");
      } else if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = isFocus ? 1.1 : dimmed ? 0.1 : 0.4;
      } else {
        // 无光照材质：用颜色明暗表达聚焦/常态
        material.color.copy(entry.baseColor).multiplyScalar(isFocus ? 1.4 : 1);
      }
      // 黑洞核心漆黑不可提亮，状态交给吸积环表达
      if (entry.ring) {
        entry.ring.material.opacity = dimmed ? 0.12 : 1;
        entry.ring.scale.setScalar(isFocus ? 1.2 : 1);
      }
      entry.mesh.scale.setScalar(isFocus ? 1.28 : 1);
    }
  }, []);

  useEffect(() => {
    applyNodeStates();
  }, [focusId, adjacency, applyNodeStates]);

  // 主题切换：原地更新几何体颜色与标签纹理，避免重建全部节点对象
  useEffect(() => {
    paletteRef.current = palette;
    for (const entry of objectsRef.current.values()) {
      entry.baseColor.copy(nodeBaseColor(entry.node, palette));
      if (entry.node.kind === "language") {
        entry.mesh.material.color.set("#000000");
      } else if (entry.mesh.material instanceof THREE.MeshStandardMaterial) {
        entry.mesh.material.color.copy(entry.baseColor).multiplyScalar(0.35);
        entry.mesh.material.emissive.copy(entry.baseColor);
      } else {
        entry.mesh.material.color.copy(entry.baseColor);
      }
      const fresh = createLabelSprite(
        entry.node.kind === "reference" ? entry.node.name : entry.node.fullName,
        palette
      );
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
    const stored = loadGraphLayout("3d");
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
  // 力导向参数：基石节点接入后边数激增，增强电荷排斥与边长避免簇成白团
  // ------------------------------------------------------------------

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as { strength?: (v: number) => void } | undefined;
    if (charge?.strength) charge.strength(-160);
    const link = fg.d3Force("link") as
      | { distance?: (v: (link: GraphLinkDatum) => number) => void }
      | undefined;
    if (link?.distance) {
      link.distance((l) => (l.type === "written_in" ? 70 : l.type === "dependency" ? 55 : 30));
    }

    // 吸积环缓慢自转，营造黑洞视界的扭曲感（ref 方法面无 onRenderFramePre，
    // 用独立 RAF 循环驱动；force-graph 本身连续渲染，旋转即生效）
    let raf = 0;
    const rotateRings = () => {
      const t = performance.now() * 0.0004;
      for (const entry of objectsRef.current.values()) {
        if (entry.ring) {
          entry.ring.rotation.z = t % (Math.PI * 2);
        }
      }
      raf = requestAnimationFrame(rotateRings);
    };
    raf = requestAnimationFrame(rotateRings);
    return () => cancelAnimationFrame(raf);
  }, []);

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

  // 标签距离自适应：仓库显示 fullName，技术栈显示产品名，聚焦节点常显
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
    const radius = nodeRadius3D(node, degreeById.get(node.id) ?? 0);
    // 按节点类型选择几何体：仓库=球体，技术栈=八面体，语言=黑洞（漆黑核心+吸积环）
    let geometry: THREE.BufferGeometry;
    let material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    let ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | undefined;
    if (node.kind === "reference") {
      geometry = new THREE.OctahedronGeometry(radius * 1.5);
      // 基石/语言用无光照材质：默认方向光的白色高光会把小节点洗成白点
      material = new THREE.MeshBasicMaterial({ color: baseColor.clone(), transparent: true, opacity: 1 });
    } else if (node.kind === "language") {
      geometry = new THREE.SphereGeometry(radius, 24, 16);
      // 黑洞核心：纯黑，吃掉一切光
      material = new THREE.MeshBasicMaterial({ color: new THREE.Color("#000000"), transparent: true, opacity: 1 });
      // 吸积环：倾斜的青色光环，AdditiveBlending 叠加后由 bloom 拉出辉光
      ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.25, radius * 2.3, 64),
        new THREE.MeshBasicMaterial({
          map: createAccretionTexture(baseColor),
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 1,
        })
      );
      ring.rotation.x = -1.15;
      ring.rotation.z = 0.35;
    } else {
      geometry = new THREE.SphereGeometry(radius, 24, 16);
      material = new THREE.MeshStandardMaterial({
        color: baseColor.clone().multiplyScalar(0.35),
        emissive: baseColor.clone(),
        emissiveIntensity: 0.4,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 1,
      });
    }
    const mesh = new THREE.Mesh(geometry, material);
    const label = createLabelSprite(node.kind === "reference" ? node.name : node.fullName, pal);
    label.position.y = (ring ? radius * 2.3 : radius) + LABEL_HEIGHT / 2 + 2;
    const group = new THREE.Group();
    group.add(mesh, label);
    if (ring) group.add(ring);

    const existing = objectsRef.current.get(node.id);
    if (existing) disposeEntry(existing);
    objectsRef.current.set(node.id, { node, mesh, ring, label, baseColor });
    applyNodeStates();
    return group;
  }, [applyNodeStates, degreeById]);

  const linkColors = useMemo(() => {
    const bg = toThreeColor(oklch(palette.background, 1));
    const primary = toThreeColor(oklch(palette.primary, 1));
    const warning = toThreeColor(oklch(palette.warning, 1));
    const muted = toThreeColor(oklch(palette.muted, 1));
    const mix = (color: THREE.Color, t: number) => `#${color.clone().lerp(bg, t).getHexString()}`;
    return {
      similarity: mix(primary, 0.45),
      similarityActive: mix(primary, 0.05),
      dependency: mix(warning, 0.35),
      dependencyActive: mix(warning, 0),
      // written_in 边大幅混向背景色，实现“低透明细虚线”的 3D 等效
      writtenIn: mix(muted, 0.75),
      writtenInActive: mix(muted, 0.45),
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
      if (link.type === "written_in") {
        return state === "active" ? linkColors.writtenInActive : linkColors.writtenIn;
      }
      return state === "active" ? linkColors.similarityActive : linkColors.similarity;
    },
    [linkState, linkColors]
  );

  const linkWidth = useCallback(
    (link: GraphLinkDatum): number => {
      const active = linkState(link) === "active";
      if (link.type === "written_in") return active ? 0.4 : 0.22;
      if (link.type === "dependency") return active ? 1.2 : 0.8;
      const score = link.score ?? 0.5;
      return (0.22 + score * 0.3) * (active ? 1.5 : 1);
    },
    [linkState]
  );

  const linkParticles = useCallback(
    (link: GraphLinkDatum): number => {
      // written_in 边不显示粒子
      if (link.type === "written_in") return 0;
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
      saveGraphLayout(nodes, "3d");
    },
    [nodes]
  );

  const handleEngineStop = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    saveGraphLayout(nodes, "3d");
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
      nodeVal={(node) => nodeRadius3D(node, degreeById.get(node.id as string) ?? 0) ** 2}
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
