"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import * as THREE from "three";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  BLACK_HOLE_EXTENT, GRAPH_LENS_SHADER, createBlackHoleMaterial,
  createRepositoryMaterial, selectGraphLenses, type ProjectedGraphLens,
} from "@/lib/graph-black-hole";
import type { RepoGraphEdge, RepoGraphNode } from "@devscope/shared";
import { languageColor } from "@/lib/language-colors";
import { loadGraphLayout, saveGraphLayout } from "@/lib/graph-layout";
import { oklch, useThemePalette, type ThemePalette } from "@/lib/theme-palette";
import { isTechnologyStackGraphNode } from "@/lib/repo-graph-node";
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
  maxDistance: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface NodeObjectEntry {
  node: GraphNodeDatum;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>;
  /** 语言节点的黑洞吸积环（仅 kind=language 存在） */
  ring?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  label: THREE.Sprite;
  baseColor: THREE.Color;
  baseScale: number;
}

const LABEL_FONT = '"Geist Variable","PingFang SC","Hiragino Sans GB",system-ui,sans-serif';
const LABEL_HEIGHT = 7;
const LABEL_VISIBLE_DISTANCE = 260;
const MAX_VISIBLE_LABELS = 48;
const MAX_RENDER_PIXEL_RATIO = 1.5;
const STAR_COUNT = 320;

let sharedSphereGeometry: THREE.SphereGeometry | undefined;
let sharedOctahedronGeometry: THREE.OctahedronGeometry | undefined;

function getSharedSphereGeometry(): THREE.SphereGeometry {
  sharedSphereGeometry ??= new THREE.SphereGeometry(1, 32, 24);
  return sharedSphereGeometry;
}

function getSharedOctahedronGeometry(): THREE.OctahedronGeometry {
  sharedOctahedronGeometry ??= new THREE.OctahedronGeometry(1);
  return sharedOctahedronGeometry;
}

function nodeRadius3D(node: GraphNodeDatum, degree: number): number {
  // 语言节点没有 stars，固定一个适中尺寸作为枢纽
  if (node.kind === "language") return 6;
  // 基石节点按连接度（被多少边依赖）定尺寸，视觉上与仓库球体同量级
  if (isTechnologyStackGraphNode(node)) return 4.5 + Math.log10(degree + 1) * 4;
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
  // 保留语言/技术栈的语义色，材质与灯光负责体积层次。
  if (isTechnologyStackGraphNode(node)) return toThreeColor(oklch(palette.warning, 1));
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
  entry.mesh.material.dispose();
  if (entry.ring) {
    entry.ring.geometry.dispose();
    entry.ring.material.dispose();
  }
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(() => ({
    width: typeof window === "undefined" ? 1 : window.innerWidth,
    height: typeof window === "undefined" ? 1 : window.innerHeight,
  }));
  const objectsRef = useRef(new Map<string, NodeObjectEntry>());
  const starsMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const lensPassRef = useRef<ShaderPass | null>(null);
  const fittedRef = useRef(false);

  const palette = useThemePalette();
  const paletteRef = useRef(palette);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [lensPassReady, setLensPassReady] = useState(false);

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
        material.emissiveIntensity = isFocus ? 0.12 : dimmed ? 0.01 : 0.025;
      } else {
        // 无光照材质：用颜色明暗表达聚焦/常态
        material.color.copy(entry.baseColor).multiplyScalar(isFocus ? 1.4 : 1);
      }
      // 黑洞核心漆黑不可提亮，状态交给吸积环表达
      if (entry.ring) {
        entry.ring.material.opacity = dimmed ? 0.12 : 1;
        entry.ring.scale.setScalar(entry.baseScale * BLACK_HOLE_EXTENT * 2 * (isFocus ? 1.12 : 1));
        if (entry.ring.material instanceof THREE.ShaderMaterial) {
          entry.ring.material.uniforms.uFocus.value = isFocus ? 1 : 0;
          entry.ring.material.uniforms.uOpacity.value = dimmed ? 0.12 : 1;
        }
      }
      entry.mesh.scale.setScalar(entry.baseScale * (isFocus ? 1.12 : 1));
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
        entry.mesh.material.color.copy(entry.baseColor);
        entry.mesh.material.emissive.copy(entry.baseColor);
      } else {
        entry.mesh.material.color.copy(entry.baseColor);
      }
      if (entry.ring?.material instanceof THREE.ShaderMaterial) {
        entry.ring.material.uniforms.uColor.value.copy(entry.baseColor);
      }
      const fresh = createLabelSprite(
        isTechnologyStackGraphNode(entry.node) ? entry.node.name : entry.node.fullName,
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

  useEffect(() => {
    const entries = objectsRef.current;
    return () => {
      for (const entry of entries.values()) disposeEntry(entry);
      entries.clear();
    };
  }, []);

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

  }, []);

  // One shared lens pass; billboard orientation follows the camera, disk plane stays fixed.
  useEffect(() => {
    const fg = fgRef.current;
    const pass = lensPassRef.current;
    if (!fg || !pass || !lensPassReady) return;
    const position = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const view = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const normal = new THREE.Vector3(0.15, 0.9, 0.4).normalize();
    let frame = 0;
    const updateBlackHoles = (time: number) => {
      const camera = fg.camera();
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const canvas = fg.renderer().domElement;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const aspect = width / height;
      const lenses: ProjectedGraphLens[] = [];
      for (const [id, entry] of objectsRef.current) {
        if (!entry.ring) continue;
        const { node, ring } = entry;
        if (node.x == null || node.y == null || node.z == null) continue;
        position.set(node.x, node.y, node.z);
        projected.copy(position).project(camera);
        ring.quaternion.copy(camera.quaternion);
        view.copy(camera.position).sub(position).normalize();
        axis.crossVectors(normal, view);
        const angle = axis.lengthSq() < 0.00001 ? 0 : Math.atan2(axis.dot(up), axis.dot(right));
        const focused = id === focusIdRef.current;
        const radius = entry.baseScale * (focused ? 1.12 : 1);
        edge.copy(position).addScaledVector(right, radius).project(camera);
        const radiusUV = Math.abs(edge.x - projected.x) * aspect / 2;
        const radiusPx = radiusUV * height;
        const uniforms = ring.material.uniforms;
        uniforms.uAngle.value = angle;
        uniforms.uInclination.value = Math.abs(normal.dot(view));
        uniforms.uDetail.value = THREE.MathUtils.smoothstep(radiusPx, 3, 18);
        uniforms.uTime.value = reducedMotion ? 0 : time * 0.001;
        // Far-off, behind-camera and subpixel nodes never enter the lens loop.
        if (projected.z < -1 || projected.z > 1 || radiusPx < 2) continue;
        lenses.push({ id, x: (projected.x + 1) / 2, y: (projected.y + 1) / 2, radius: radiusUV, focused });
      }
      const visible = reducedMotion ? [] : selectGraphLenses(lenses, aspect);
      pass.enabled = visible.length > 0;
      pass.uniforms.uAspect.value = aspect;
      pass.uniforms.uCount.value = visible.length;
      visible.forEach((lens, i) => {
        pass.uniforms.uLenses.value[i].set(lens.x, lens.y, lens.radius, lens.focused ? 1 : 0.65);
      });
      frame = requestAnimationFrame(updateBlackHoles);
    };
    frame = requestAnimationFrame(updateBlackHoles);
    return () => { cancelAnimationFrame(frame); pass.enabled = false; };
  }, [lensPassReady, reducedMotion]);

  // ------------------------------------------------------------------
  // 后处理、环境反射与布光
  // ------------------------------------------------------------------

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const composer = fg.postProcessingComposer();
    const outputPass = new OutputPass();
    const lensPass = new ShaderPass(GRAPH_LENS_SHADER);
    lensPass.enabled = false;
    composer.addPass(outputPass);
    // A single scene sample before tone mapping; glow is bounded inside the black-hole shader.
    composer.insertPass(lensPass, 1);
    lensPassRef.current = lensPass;
    setLensPassReady(true);
    const renderer = fg.renderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO));
    composer.setPixelRatio(renderer.getPixelRatio());
    // Controlled studio lighting; no full-scene bloom on text or ordinary nodes.
    const previousLights = fg.lights();
    const hemisphere = new THREE.HemisphereLight(0xc6dcf5, 0x161a24, 0.8);
    const key = new THREE.DirectionalLight(0xffedda, 1.6);
    key.position.set(-150, 200, 180);
    const fill = new THREE.DirectionalLight(0x779fcc, 0.8);
    fill.position.set(160, -60, -120);
    fg.lights([hemisphere, key, fill]);
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmrem.fromScene(environment, 0.04);
    const previousEnvironment = fg.scene().environment;
    fg.scene().environment = environmentTarget.texture;
    environment.dispose();
    pmrem.dispose();
    const resize = () => {
      const width = Math.max(1, containerRef.current?.clientWidth ?? 1);
      const height = Math.max(1, containerRef.current?.clientHeight ?? 1);
      setCanvasSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    resize();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(resize);
    if (containerRef.current) resizeObserver?.observe(containerRef.current);
    window.addEventListener("resize", resize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      composer.removePass(outputPass);
      composer.removePass(lensPass);
      lensPassRef.current = null;
      setLensPassReady(false);
      fg.scene().environment = previousEnvironment;
      environmentTarget.dispose();
      fg.lights(previousLights);
      outputPass.dispose();
      lensPass.dispose();
    };
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene();
    const positions = new Float32Array(STAR_COUNT * 3);
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) + 0x27100001) | 0;
      return (seed >>> 0) / 0x100000000;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = 1000 + random() * 800;
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
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const camera = fg.camera() as THREE.PerspectiveCamera;
    camera.far = 12000;
    camera.updateProjectionMatrix();
    const controls = fg.controls() as OrbitControlsLike;
    controls.maxDistance = 5000;
    // Camera motion is user-driven. Ambient rotation made selection and labels
    // harder to read and consumed a render loop without conveying state.
    controls.autoRotate = false;
    const handleStart = () => pauseAutoRotate();
    controls.addEventListener("start", handleStart);
    return () => {
      controls.removeEventListener("start", handleStart);
    };
  }, [pauseAutoRotate]);

  // 标签距离自适应：仓库显示 fullName，技术栈显示产品名，聚焦节点常显
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (time - last < 160) return;
      last = time;
      const fg = fgRef.current;
      if (!fg) return;
      const cam = readCameraPosition(fg);
      const focus = focusIdRef.current;
      const neighbors = focus != null ? adjacencyRef.current.get(focus) : undefined;
      const maxDistSq = LABEL_VISIBLE_DISTANCE * LABEL_VISIBLE_DISTANCE;
      const candidates: Array<{ entry: NodeObjectEntry; distanceSq: number; focused: boolean }> = [];
      for (const [id, entry] of objectsRef.current) {
        entry.label.visible = false;
        const { x, y, z } = entry.node;
        if (x == null || y == null || z == null) {
          entry.label.visible = false;
          continue;
        }
        const dimmed = focus != null && id !== focus && neighbors?.has(id) !== true;
        const dx = cam.x - x;
        const dy = cam.y - y;
        const dz = cam.z - z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (!dimmed && (id === focus || distanceSq < maxDistSq)) {
          candidates.push({ entry, distanceSq, focused: id === focus });
        } else {
          entry.label.visible = false;
        }
      }
      candidates
        .sort((a, b) => Number(b.focused) - Number(a.focused) || a.distanceSq - b.distanceSq)
        .slice(0, MAX_VISIBLE_LABELS)
        .forEach(({ entry }) => {
          entry.label.visible = true;
        });
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
    const direction = new THREE.Vector3().copy(fg.camera().position).sub(new THREE.Vector3(node.x, node.y, node.z));
    if (direction.lengthSq() < 0.001) direction.set(0, 0, 1);
    direction.normalize().multiplyScalar(node.kind === "language" ? 190 : 160);
    fg.cameraPosition(
      { x: node.x + direction.x, y: node.y + direction.y, z: node.z + direction.z },
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
    let ring: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
    let baseScale = radius;
    if (isTechnologyStackGraphNode(node)) {
      geometry = getSharedOctahedronGeometry();
      baseScale = radius * 0.85;
      material = new THREE.MeshStandardMaterial({
        color: baseColor.clone(), metalness: 0.6, roughness: 0.3,
        emissive: baseColor.clone(), emissiveIntensity: 0.025,
        envMapIntensity: 0.75, flatShading: true, transparent: true,
      });
    } else if (node.kind === "language") {
      geometry = getSharedSphereGeometry();
      // 黑洞核心：纯黑，吃掉一切光
      material = new THREE.MeshBasicMaterial({ color: new THREE.Color("#000000"), transparent: true, opacity: 1 });
      // Billboard is the observed image, not a physical disk turned toward the camera.
      ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createBlackHoleMaterial(baseColor));
      ring.scale.setScalar(radius * BLACK_HOLE_EXTENT * 2);
      ring.raycast = () => {}; // Only the compact core is pickable, not the transparent quad.
      material.transparent = false;
      material.depthWrite = true; // Opaque core occludes graph edges behind it.
    } else {
      geometry = getSharedSphereGeometry();
      let seed = 0;
      for (const char of node.id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0;
      material = createRepositoryMaterial(baseColor, (seed >>> 0) % 1000);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(baseScale);
    const label = createLabelSprite(isTechnologyStackGraphNode(node) ? node.name : node.fullName, pal);
    label.position.y = (ring ? radius * 3.6 : baseScale) + LABEL_HEIGHT / 2 + 2;
    const group = new THREE.Group();
    group.add(mesh, label);
    if (ring) group.add(ring);

    const existing = objectsRef.current.get(node.id);
    if (existing) disposeEntry(existing);
    objectsRef.current.set(node.id, { node, mesh, ring, label, baseColor, baseScale });
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
      if (link.type === "written_in") return active ? 0.12 : 0;
      if (link.type === "dependency") return active ? 0.28 : 0.16;
      const score = link.score ?? 0.5;
      return (0.045 + score * 0.055) * (active ? 1.5 : 1);
    },
    [linkState]
  );

  const linkParticles = useCallback(
    (link: GraphLinkDatum): number => {
      // 粒子只表达当前邻域中的关系，空闲时保持画面安静。
      if (reducedMotion || focusId == null || link.type === "written_in") return 0;
      if (linkState(link) === "dimmed") return 0;
      return link.type === "dependency" ? 3 : 1;
    },
    [focusId, linkState, reducedMotion]
  );

  const linkParticleSpeed = useCallback(
    (link: GraphLinkDatum): number => (link.type === "dependency" ? 0.012 : 0.003),
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
    // Frame the connected cluster first; isolated satellites stay in the scene.
    const hasCluster = nodes.filter(node => (degreeById.get(node.id) ?? 0) >= 2).length >= 3;
    fg.zoomToFit(
      reducedMotion ? 0 : 900,
      80,
      hasCluster ? node => (degreeById.get(node.id as string) ?? 0) >= 2 : undefined,
    );
  }, [nodes, degreeById, reducedMotion]);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden" onPointerLeave={() => handleNodeHover(null)}>
      <ForceGraph3D<RepoGraphNode, FG3ExtraLink>
        ref={fgRef}
        width={canvasSize.width}
        height={canvasSize.height}
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
    </div>
  );
}
