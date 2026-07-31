import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canRender3D,
  loadGraphRendererMode,
  resolveGraphRendererMode,
  saveGraphRendererMode,
} from "./graph-renderer-mode";

const desktopWebgl = { webgl: true, coarsePointer: false };

describe("graph renderer mode", () => {
  let storedMode: string | null;

  beforeEach(() => {
    storedMode = null;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => storedMode,
        setItem: (_key: string, value: string) => {
          storedMode = value;
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("没有保存偏好时默认使用 2D，并能持久化 3D 选择", () => {
    expect(loadGraphRendererMode()).toBe("2d");
    saveGraphRendererMode("3d");
    expect(loadGraphRendererMode()).toBe("3d");
  });

  it("默认偏好为 2D 时即使设备支持 WebGL 也保持 2D", () => {
    expect(resolveGraphRendererMode("2d", desktopWebgl, false, false)).toBe("2d");
  });

  it("仅在桌面细指针、WebGL 可用且未减少动态效果时启用 3D", () => {
    expect(canRender3D(desktopWebgl, false, false)).toBe(true);
    expect(resolveGraphRendererMode("3d", desktopWebgl, false, false)).toBe("3d");
  });

  it.each([
    [null, false, false],
    [{ webgl: false, coarsePointer: false }, false, false],
    [{ webgl: true, coarsePointer: true }, false, false],
    [desktopWebgl, true, false],
    [desktopWebgl, false, true],
  ])("3D 条件不满足时安全回退 2D", (capabilities, reducedMotion, isMobile) => {
    expect(resolveGraphRendererMode("3d", capabilities, reducedMotion, isMobile)).toBe("2d");
  });
});
