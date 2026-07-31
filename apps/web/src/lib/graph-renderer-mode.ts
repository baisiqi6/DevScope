export type GraphRendererMode = "2d" | "3d";

export interface GraphRendererCapabilities {
  webgl: boolean;
  coarsePointer: boolean;
}

const STORAGE_KEY = "devscope-graph-renderer-mode";

export function detectGraphRendererCapabilities(): GraphRendererCapabilities {
  let webgl = false;
  try {
    const canvas = document.createElement("canvas");
    webgl = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return {
    webgl,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  };
}

export function canRender3D(
  capabilities: GraphRendererCapabilities | null,
  reducedMotion: boolean,
  isMobile: boolean,
): boolean {
  return Boolean(
    capabilities?.webgl && !capabilities.coarsePointer && !reducedMotion && !isMobile,
  );
}

export function resolveGraphRendererMode(
  preference: GraphRendererMode,
  capabilities: GraphRendererCapabilities | null,
  reducedMotion: boolean,
  isMobile: boolean,
): GraphRendererMode {
  return preference === "3d" && canRender3D(capabilities, reducedMotion, isMobile) ? "3d" : "2d";
}

export function loadGraphRendererMode(): GraphRendererMode {
  if (typeof window === "undefined") return "2d";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
}

export function saveGraphRendererMode(mode: GraphRendererMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage 不可用或配额超限时仅保留本次页面状态
  }
}
