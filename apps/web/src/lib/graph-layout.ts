export interface GraphLayoutPoint {
  x: number;
  y: number;
  z?: number;
}

export type GraphLayoutStore = Record<string, GraphLayoutPoint>;

const STORAGE_KEY = "devscope-graph-layout";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function loadGraphLayout(): GraphLayoutStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: GraphLayoutStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const point = value as Record<string, unknown>;
      if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) continue;
      result[key] =
        isFiniteNumber(point.z)
          ? { x: point.x, y: point.y, z: point.z }
          : { x: point.x, y: point.y };
    }
    return result;
  } catch {
    return {};
  }
}

interface LayoutNode {
  fullName: string;
  x?: number;
  y?: number;
  z?: number;
}

export function saveGraphLayout(nodes: readonly LayoutNode[], includeZ: boolean): void {
  if (typeof window === "undefined") return;
  const store: GraphLayoutStore = {};
  for (const node of nodes) {
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) continue;
    store[node.fullName] =
      includeZ && isFiniteNumber(node.z)
        ? { x: round1(node.x), y: round1(node.y), z: round1(node.z) }
        : { x: round1(node.x), y: round1(node.y) };
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage 不可用或配额超限时静默放弃持久化
  }
}

export function clearGraphLayout(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
}
