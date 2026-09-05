import { describe, expect, it } from "vitest";
import { MAX_GRAPH_LENSES, selectGraphLenses, type ProjectedGraphLens } from "./graph-black-hole";

const lens = (id: string, patch: Partial<ProjectedGraphLens> = {}): ProjectedGraphLens => ({
  id, x: 0.5, y: 0.5, radius: 0.02, focused: false, ...patch,
});

describe("graph lens GPU budget", () => {
  it("保留边缘仍可见的透镜，剔除完全离屏或无效投影", () => {
    const result = selectGraphLenses([
      lens("edge", { x: -0.03 }),
      lens("outside", { x: -0.2 }),
      lens("invalid", { radius: NaN }),
      lens("zero", { radius: 0 }),
    ], 2);
    expect(result.map(l => l.id)).toEqual(["edge"]);
  });

  it("密集图谱不超预算，优先保留选中黑洞和近处大黑洞", () => {
    const entries = Array.from({ length: 30 }, (_, i) => lens(String(i), { radius: (i + 1) / 1000 }));
    entries.push(lens("focus", { radius: 0.001, focused: true }));
    const original = entries.map(l => l.id);
    const result = selectGraphLenses(entries, 1.6);
    expect(result).toHaveLength(MAX_GRAPH_LENSES);
    expect(result[0].id).toBe("focus");
    expect(result[1].id).toBe("29");
    expect(entries.map(l => l.id)).toEqual(original);
  });

  it("宽窄视口使用同一屏幕像素半径剔除边界", () => {
    const entry = lens("left", { x: -0.05 });
    expect(selectGraphLenses([entry], 1)).toHaveLength(1);
    expect(selectGraphLenses([entry], 2)).toHaveLength(0);
  });
});
