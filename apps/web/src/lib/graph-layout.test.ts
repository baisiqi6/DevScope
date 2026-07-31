import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGraphLayout, loadGraphLayout, saveGraphLayout } from "./graph-layout";

describe("graph layout storage", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("分别保存 2D 与 3D 布局，2D 不覆盖 3D 的 z 坐标", () => {
    saveGraphLayout([{ fullName: "org/repo", x: 10, y: 20, z: 30 }], "3d");
    saveGraphLayout([{ fullName: "org/repo", x: 40, y: 50, z: 60 }], "2d");

    expect(loadGraphLayout("3d")).toEqual({
      "org/repo": { x: 10, y: 20, z: 30 },
    });
    expect(loadGraphLayout("2d")).toEqual({
      "org/repo": { x: 40, y: 50 },
    });
  });

  it("重排布局时同时清理 2D、3D 与旧版缓存", () => {
    values.set("devscope-graph-layout", "{}");
    saveGraphLayout([{ fullName: "org/repo", x: 1, y: 2 }], "2d");
    saveGraphLayout([{ fullName: "org/repo", x: 1, y: 2, z: 3 }], "3d");

    clearGraphLayout();

    expect(values.size).toBe(0);
  });
});
