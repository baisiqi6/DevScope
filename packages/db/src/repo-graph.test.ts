import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSbomPackages,
  recomputeSimilarityEdges,
  recomputeDependencyEdges,
  poolRepoEmbedding,
  getRepoGraphData,
} from "./repo-graph";
import sbomFixture from "./__fixtures__/sbom-tailwindcss.json";

// ============================================================================
// SBOM 解析测试（真实 fixture）
// ============================================================================

describe("parseSbomPackages", () => {
  it("应从真实 SBOM fixture 中解析出精确版本的 npm 包", () => {
    const packages = parseSbomPackages(sbomFixture as Record<string, unknown>);

    expect(packages.length).toBeGreaterThan(0);

    for (const pkg of packages) {
      expect(pkg.name).toBeTruthy();
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(pkg.version).not.toContain("^");
      expect(pkg.version).not.toContain("~");
      expect(pkg.version).not.toContain("catalog:");
      expect(pkg.version).not.toContain(">=");
    }
  });

  it("不应包含范围 spec（^、~、catalog:）", () => {
    const packages = parseSbomPackages(sbomFixture as Record<string, unknown>);

    const names = packages.map((p) => `${p.name}@${p.version}`);
    expect(names).not.toContain("@jridgewell/remapping@^2.3.5");
    expect(names).not.toContain("enhanced-resolve@catalog:");
    expect(names).not.toContain("lightningcss@catalog:");
  });

  it("应包含精确版本的包", () => {
    const packages = parseSbomPackages(sbomFixture as Record<string, unknown>);

    const names = packages.map((p) => `${p.name}@${p.version}`);
    expect(names).toContain("object-assign@4.1.1");
    expect(names).toContain("picocolors@1.1.1");
    expect(names).toContain("nanoid@3.3.12");
  });

  it("应去重同名同版本的包", () => {
    const packages = parseSbomPackages(sbomFixture as Record<string, unknown>);
    const keys = packages.map((p) => `${p.name}@${p.version}`);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it("空 SBOM 返回空数组", () => {
    expect(parseSbomPackages({})).toEqual([]);
    expect(parseSbomPackages({ sbom: {} })).toEqual([]);
    expect(parseSbomPackages({ sbom: { packages: [] } })).toEqual([]);
  });

  it("应过滤非 npm 包（如 cargo、github actions）", () => {
    const packages = parseSbomPackages(sbomFixture as Record<string, unknown>);
    const names = packages.map((p) => p.name);
    expect(names).not.toContain("serde");
    expect(names).not.toContain("actions/checkout");
    expect(names).not.toContain("regex");
  });
});

// ============================================================================
// Mean Pooling 测试
// ============================================================================

describe("poolRepoEmbedding", () => {
  function createMockDb(chunks: Array<{ embedding: number[] | null }>) {
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(chunks),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
      _updateSet: updateSet,
    } as any;
  }

  it("应对 readme/description chunks 做 mean pooling", async () => {
    const db = createMockDb([
      { embedding: [1, 0, 0] },
      { embedding: [0, 1, 0] },
    ]);

    const result = await poolRepoEmbedding(db, 1);

    expect(result).toBe(true);
    expect(db._updateSet).toHaveBeenCalledWith({ embedding: [0.5, 0.5, 0] });
  });

  it("无有效 chunk 时置 null", async () => {
    const db = createMockDb([]);

    const result = await poolRepoEmbedding(db, 1);

    expect(result).toBe(false);
    expect(db._updateSet).toHaveBeenCalledWith({ embedding: null });
  });

  it("单个 chunk 时 mean 等于自身", async () => {
    const db = createMockDb([{ embedding: [3, 4, 5] }]);

    const result = await poolRepoEmbedding(db, 1);

    expect(result).toBe(true);
    expect(db._updateSet).toHaveBeenCalledWith({ embedding: [3, 4, 5] });
  });
});

// ============================================================================
// 相似边重算测试
// ============================================================================

describe("recomputeSimilarityEdges", () => {
  function createMockDb(repos: Array<{ id: number; embedding: number[] | null }>) {
    const insertedValues: any[] = [];
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn().mockImplementation((vals) => {
      insertedValues.push(...vals);
      return Promise.resolve();
    });

    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(repos),
        }),
      }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      transaction: vi.fn().mockImplementation(async (fn: any) => {
        await fn({
          delete: vi.fn().mockReturnValue({ where: deleteWhere }),
          insert: vi.fn().mockReturnValue({ values: insertValues }),
        });
      }),
      _insertedValues: insertedValues,
      _deleteWhere: deleteWhere,
    } as any;
  }

  it("应计算 cosine 相似度并保留 topK 且 >= minScore 的边", async () => {
    const repos = [
      { id: 1, embedding: [1, 0, 0] },
      { id: 2, embedding: [1, 0, 0] },
      { id: 3, embedding: [0, 1, 0] },
    ];
    const db = createMockDb(repos);

    const count = await recomputeSimilarityEdges(db, { topK: 8, minScore: 0.75 });

    expect(count).toBe(2);
    expect(db._insertedValues).toHaveLength(2);
    const edge = db._insertedValues[0];
    expect(edge.edgeType).toBe("similarity");
    expect(edge.score).toBeCloseTo(1.0);
  });

  it("低于 minScore 的不产生边", async () => {
    const repos = [
      { id: 1, embedding: [1, 0, 0] },
      { id: 2, embedding: [0, 1, 0] },
    ];
    const db = createMockDb(repos);

    const count = await recomputeSimilarityEdges(db, { minScore: 0.75 });

    expect(count).toBe(0);
  });

  it("全量替换：先删除旧 similarity 边再插入新边", async () => {
    const repos = [
      { id: 1, embedding: [1, 0, 0] },
      { id: 2, embedding: [1, 0, 0] },
    ];
    const db = createMockDb(repos);

    await recomputeSimilarityEdges(db);

    expect(db.transaction).toHaveBeenCalled();
    expect(db._deleteWhere).toHaveBeenCalled();
  });

  it("topK 限制每仓库最多保留 K 条边", async () => {
    const repos = [
      { id: 1, embedding: [1, 0, 0] },
      { id: 2, embedding: [0.99, 0.01, 0] },
      { id: 3, embedding: [0.98, 0.02, 0] },
      { id: 4, embedding: [0.97, 0.03, 0] },
    ];
    const db = createMockDb(repos);

    const count = await recomputeSimilarityEdges(db, { topK: 2, minScore: 0.75 });

    const fromRepo1 = db._insertedValues.filter(
      (e: any) => e.sourceRepoId === 1
    );
    expect(fromRepo1.length).toBeLessThanOrEqual(2);
  });

  it("无 embedding 的仓库不产生边", async () => {
    const db = createMockDb([]);
    const count = await recomputeSimilarityEdges(db);
    expect(count).toBe(0);
  });
});

// ============================================================================
// 依赖边重算测试
// ============================================================================

describe("recomputeDependencyEdges", () => {
  function createMockDb(opts: {
    repos: Array<{ id: number; fullName: string }>;
    cachedMappings?: Array<{ sourceRepo: string | null }>;
  }) {
    const insertedValues: any[] = [];
    const insertedMappings: any[] = [];

    const selectMock = vi.fn().mockImplementation(() => {
      let fromTable: string = "";
      return {
        from: vi.fn().mockImplementation((table: any) => {
          fromTable = table?.constructor?.name || "";
          return {
            where: vi.fn().mockImplementation(() => {
              if (fromTable === "PgTable") {
                return Promise.resolve(opts.repos);
              }
              return Promise.resolve(opts.cachedMappings ?? []);
            }),
            limit: vi.fn().mockResolvedValue(opts.cachedMappings ?? []),
          };
        }),
      };
    });

    return {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(opts.repos),
        }),
      })),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: any) => {
          if (Array.isArray(vals)) insertedValues.push(...vals);
          return {
            onConflictDoUpdate: vi.fn().mockImplementation((opts: any) => {
              insertedMappings.push(opts);
              return Promise.resolve();
            }),
          };
        }),
      }),
      transaction: vi.fn().mockImplementation(async (fn: any) => {
        await fn({
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: any) => {
              if (Array.isArray(vals)) insertedValues.push(...vals);
              return Promise.resolve();
            }),
          }),
        });
      }),
      _insertedValues: insertedValues,
      _insertedMappings: insertedMappings,
    } as any;
  }

  it("缓存命中时不调用 resolveMapping", async () => {
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((...args: any[]) => {
            return {
              limit: vi.fn().mockResolvedValue([{ sourceRepo: "facebook/react" }]),
            };
          }),
        }),
      })),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      transaction: vi.fn().mockImplementation(async (fn: any) => {
        await fn({
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        });
      }),
    } as any;

    // Override first select to return repos
    let callCount = 0;
    db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: undefined,
            then: (resolve: any) => resolve([
              { id: 1, fullName: "vercel/next.js", sbomPackages: [{ name: "react", version: "19.2.6" }] },
              { id: 2, fullName: "facebook/react", sbomPackages: null },
            ]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ sourceRepo: "facebook/react" }]),
          }),
        }),
      };
    });

    const resolveMapping = vi.fn();
    const count = await recomputeDependencyEdges(db, {
      resolveMapping,
      delayMs: 0,
    });

    expect(resolveMapping).not.toHaveBeenCalled();
  });

  it("缓存未命中时调用 resolveMapping 并写入缓存", async () => {
    let selectCallCount = 0;
    const insertedEdges: any[] = [];

    const db = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockResolvedValue([
              { id: 1, fullName: "vercel/next.js", sbomPackages: [{ name: "react", version: "19.2.6" }] },
              { id: 2, fullName: "facebook/react", sbomPackages: null },
            ]),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: any) => {
          if (Array.isArray(vals)) insertedEdges.push(...vals);
          return {
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
      transaction: vi.fn().mockImplementation(async (fn: any) => {
        await fn({
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: any) => {
              if (Array.isArray(vals)) insertedEdges.push(...vals);
              return Promise.resolve();
            }),
          }),
        });
      }),
    } as any;

    const resolveMapping = vi.fn().mockResolvedValue("facebook/react");
    const count = await recomputeDependencyEdges(db, {
      resolveMapping,
      delayMs: 0,
    });

    expect(resolveMapping).toHaveBeenCalledWith("npm", "react", "19.2.6");
    expect(count).toBe(1);
  });

  it("target 不在工作区内的边被过滤", async () => {
    let selectCallCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockResolvedValue([
              { id: 1, fullName: "vercel/next.js", sbomPackages: [{ name: "lodash", version: "4.17.21" }] },
            ]),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ sourceRepo: "lodash/lodash" }]),
            }),
          }),
        };
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      transaction: vi.fn().mockImplementation(async (fn: any) => {
        await fn({
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        });
      }),
    } as any;

    const count = await recomputeDependencyEdges(db, { delayMs: 0 });
    expect(count).toBe(0);
  });
});

// ============================================================================
// getRepoGraphData 契约测试
// ============================================================================

describe("getRepoGraphData", () => {
  it("返回 nodes 和 edges 结构", async () => {
    const mockNodes = [
      { id: 1, fullName: "a/b", name: "b", language: "TypeScript", stars: 100, description: "desc" },
    ];
    const mockEdges = [
      { source: 1, target: 2, type: "similarity", score: 0.9 },
    ];

    let selectCallCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        return {
          from: vi.fn().mockResolvedValue(
            selectCallCount === 1 ? mockNodes : mockEdges
          ),
        };
      }),
    } as any;

    const result = await getRepoGraphData(db);

    expect(result.nodes).toEqual(mockNodes);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({
      source: 1,
      target: 2,
      type: "similarity",
      score: 0.9,
    });
  });
});
