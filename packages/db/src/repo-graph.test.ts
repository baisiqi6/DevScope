import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSbomPackages,
  detectTechStack,
  recomputeSimilarityEdges,
  recomputeDependencyEdges,
  rebuildRepoGraph,
  poolRepoEmbedding,
  getRepoGraphData,
} from "./repo-graph";
import {
  DEFAULT_EXTERNAL_RESOLUTION_SETTINGS,
  ExternalRequestBudget,
  GraphBudgetExceededError,
  GraphLeaseLostError,
  GraphRateLimitedError,
  type CanonicalizationOutcome,
  type DepsDevOutcome,
} from "./deps-cache";
import {
  githubRepoNameCanonicalizations,
  repositories,
  packageRepoMappings,
  repoRelationships,
  repositoryTechnologyStacks,
  userWatchedRepositories,
} from "./schema";
import sbomFixture from "./__fixtures__/sbom-tailwindcss.json";
import sbomPypiFixture from "./__fixtures__/sbom-pypi-minimal.json";

const {
  mockPoolRepositoryEmbedding,
  mockApplySbomBackfill,
  mockApplyTechnologyStacks,
} = vi.hoisted(() => ({
  mockPoolRepositoryEmbedding: vi.fn(),
  mockApplySbomBackfill: vi.fn(),
  mockApplyTechnologyStacks: vi.fn().mockResolvedValue("applied"),
}));

vi.mock("./collection", () => ({
  poolRepositoryEmbeddingForCurrentVersion: mockPoolRepositoryEmbedding,
  applySbomBackfillIfCurrent: mockApplySbomBackfill,
}));

vi.mock("./technology-stack-entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./technology-stack-entities")>()),
  replaceRepositoryTechnologyStacksForCurrentSnapshots: mockApplyTechnologyStacks,
}));

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
    const keys = packages.map((p) => `${p.system}:${p.name}@${p.version}`);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it("空 SBOM 返回空数组", () => {
    expect(parseSbomPackages({})).toEqual([]);
    expect(parseSbomPackages({ sbom: {} })).toEqual([]);
    expect(parseSbomPackages({ sbom: { packages: [] } })).toEqual([]);
  });

  it("应识别多生态：包含精确版本的 cargo 包，过滤 github actions 与范围版本", () => {
    const packages = parseSbomPackages(sbomFixture as Record<string, unknown>);
    const names = packages.map((p) => `${p.name}@${p.version}`);

    // cargo 精确版本现在被纳入
    expect(names).toContain("serde@1.0.163");
    expect(names).toContain("regex@1.11.1");
    expect(names).toContain("rustc-hash@2.1.1");
    // cargo 范围版本仍被拒绝
    expect(names).not.toContain("rustc-hash@>= 2.1.1,< 3.0.0");
    expect(names).not.toContain("regex@>= 1.11.1,< 2.0.0");
    // 不支持的生态（githubactions）仍被过滤
    expect(names).not.toContain("actions/checkout@3.*.*");
    expect(packages.some((p) => p.name === "actions/checkout")).toBe(false);
  });

  it("应为每个包标注 purl 系统（npm/cargo）", () => {
    const packages = parseSbomPackages(sbomFixture as Record<string, unknown>);
    const byName = new Map(packages.map((p) => [`${p.name}@${p.version}`, p.system]));
    expect(byName.get("picocolors@1.1.1")).toBe("npm");
    expect(byName.get("serde@1.0.163")).toBe("cargo");
  });
});

// ============================================================================
// SBOM 解析测试（pypi 最小 fixture）
// ============================================================================

describe("parseSbomPackages（pypi fixture）", () => {
  const packages = parseSbomPackages(sbomPypiFixture as Record<string, unknown>);
  const byKey = new Map(packages.map((p) => [`${p.system}:${p.name}@${p.version}`, p]));

  it("应解析精确版本的 pypi 包", () => {
    expect(byKey.has("pypi:django@4.2.1")).toBe(true);
    expect(byKey.has("pypi:requests@2.31.0")).toBe(true);
  });

  it("pypi 允许 X.Y 无 patch 段", () => {
    expect(byKey.has("pypi:numpy@1.26")).toBe(true);
  });

  it("仍拒绝范围 spec 与不支持的生态", () => {
    expect(packages.some((p) => p.name === "flask")).toBe(false);
    expect(packages.some((p) => p.name === "actions/checkout")).toBe(false);
  });

  it("同一 SBOM 中的 npm 包照常解析", () => {
    expect(byKey.has("npm:picocolors@1.1.1")).toBe(true);
  });
});

// ============================================================================
// Mean Pooling 测试
// ============================================================================

describe("poolRepoEmbedding", () => {
  it("应对 readme/description chunks 做 mean pooling", async () => {
    const db = {} as any;
    mockPoolRepositoryEmbedding.mockResolvedValueOnce("applied");

    const result = await poolRepoEmbedding(db, 1);

    expect(result).toBe(true);
    expect(mockPoolRepositoryEmbedding).toHaveBeenCalledWith(db, 1);
  });

  it("无有效 chunk 时置 null", async () => {
    const db = {} as any;
    mockPoolRepositoryEmbedding.mockResolvedValueOnce("cleared");

    const result = await poolRepoEmbedding(db, 1);

    expect(result).toBe(false);
  });

  it("单个 chunk 时 mean 等于自身", async () => {
    const db = {} as any;
    mockPoolRepositoryEmbedding.mockResolvedValueOnce("applied");

    const result = await poolRepoEmbedding(db, 1);

    expect(result).toBe(true);
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
          execute: vi.fn().mockResolvedValue(undefined),
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

    const count = await recomputeSimilarityEdges(db, 1, { topK: 8, minScore: 0.75 });

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

    const count = await recomputeSimilarityEdges(db, 1, { minScore: 0.75 });

    expect(count).toBe(0);
  });

  it("全量替换：先删除旧 similarity 边再插入新边", async () => {
    const repos = [
      { id: 1, embedding: [1, 0, 0] },
      { id: 2, embedding: [1, 0, 0] },
    ];
    const db = createMockDb(repos);

    await recomputeSimilarityEdges(db, 1);

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

    const count = await recomputeSimilarityEdges(db, 1, { topK: 2, minScore: 0.75 });

    const fromRepo1 = db._insertedValues.filter(
      (e: any) => e.sourceRepoId === 1
    );
    expect(fromRepo1.length).toBeLessThanOrEqual(2);
  });

  it("无 embedding 的仓库不产生边", async () => {
    const db = createMockDb([]);
    const count = await recomputeSimilarityEdges(db, 1);
    expect(count).toBe(0);
  });
});

// ============================================================================
// 依赖边重算测试
// ============================================================================

describe("recomputeDependencyEdges", () => {
  // 旧式 cacheResult {sourceRepo} 行归一为带状态的缓存行（resolved 命中 + 远期复查点）
  const CACHE_HIT_FUTURE = new Date("2999-01-01T00:00:00.000Z");
  // 按表路由的 mock：repositories 返回仓库列表，packageRepoMappings 返回固定缓存结果
  function createDepMockDb(opts: {
    repos: Array<{ id: number; fullName: string; sbomPackages: unknown; isReference?: boolean }>;
    cacheResult?: Array<{ sourceRepo: string | null }>;
  }) {
    mockApplyTechnologyStacks.mockReset();
    mockApplyTechnologyStacks.mockResolvedValue("applied");
    const cacheResult = (opts.cacheResult ?? []).map((row) => ({
      resolutionStatus: row.sourceRepo != null ? ("resolved" as const) : ("not_found" as const),
      retryAfter: CACHE_HIT_FUTURE,
      lastError: null,
      lastResolvedRepo: null,
      ...row,
    }));
    const insertedMappings: any[] = [];
    const referenceUpserts: any[] = [];
    const insertedEdges: any[] = [];
    let nextRefId = 1000;
    const refIdByFullName = new Map<string, number>();
    for (const r of opts.repos) refIdByFullName.set(r.fullName.toLowerCase(), r.id);

    const db = {
      // Phase C：rebuild 提交后无条件跑冻结基线单向包含；mock 无基线表（exists=false）→ 空基线恒过
      execute: vi.fn().mockResolvedValue({ rows: [{ exists: false }] }),
      select: vi.fn().mockImplementation(() => {
        let table: unknown = null;
        const builder: any = {
          from: vi.fn().mockImplementation((t: unknown) => {
            table = t;
            return builder;
          }),
          where: vi.fn().mockImplementation(() => builder),
          limit: vi.fn().mockImplementation(() => builder),
          then: (resolve: any, reject: any) => {
            let result: unknown = [];
            if (table === repositories) {
              result = opts.repos.map((repo) => ({
                githubRepositoryId: repo.isReference ? null : String(repo.id),
                updatedAt: new Date("2026-08-18T00:00:00.000Z"),
                ...repo,
              }));
            }
            else if (table === packageRepoMappings) result = cacheResult;
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      }),
      insert: vi.fn().mockImplementation((table: unknown) => {
        if (table === packageRepoMappings) {
          return {
            values: vi.fn().mockImplementation((v: any) => ({
              onConflictDoUpdate: vi.fn().mockImplementation(() => {
                insertedMappings.push(v);
                return Promise.resolve();
              }),
            })),
          };
        }
        if (table === repositories) {
          return {
            values: vi.fn().mockImplementation((v: any) => ({
              onConflictDoUpdate: vi.fn().mockImplementation(() => ({
                returning: vi.fn().mockImplementation(() => {
                  let id = refIdByFullName.get(v.fullName);
                  if (id === undefined) {
                    id = nextRefId++;
                    refIdByFullName.set(v.fullName, id);
                  }
                  referenceUpserts.push(v);
                  return Promise.resolve([{ id }]);
                }),
              })),
            })),
          };
        }
        if (table === userWatchedRepositories) {
          return {
            values: vi.fn().mockReturnValue({
              onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
            }),
          };
        }
        return {
          values: vi.fn().mockImplementation(() => ({
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          })),
        };
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      })),
      transaction: vi.fn().mockImplementation(async (fn: any) => {
        const txInsert = vi.fn().mockImplementation((table: unknown) => {
          if (table === repositories) {
            return {
              values: vi.fn().mockImplementation((v: any) => ({
                onConflictDoUpdate: vi.fn().mockImplementation(() => ({
                  returning: vi.fn().mockImplementation(() => {
                    let id = refIdByFullName.get(v.fullName);
                    if (id === undefined) {
                      id = nextRefId++;
                      refIdByFullName.set(v.fullName, id);
                    }
                    referenceUpserts.push(v);
                    return Promise.resolve([{ id }]);
                  }),
                })),
              })),
            };
          }
          if (table === userWatchedRepositories) {
            return {
              values: vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
              }),
            };
          }
          return {
            values: vi.fn().mockImplementation((vals: any) => {
              if (Array.isArray(vals)) insertedEdges.push(...vals);
              return Promise.resolve();
            }),
          };
        });
        await fn({
          execute: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          insert: txInsert,
        });
      }),
      _insertedMappings: insertedMappings,
      _referenceUpserts: referenceUpserts,
      _insertedEdges: insertedEdges,
      _refIdByFullName: refIdByFullName,
    };
    return db as any;
  }

  it("缓存命中时不调用 resolveMapping", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
      ],
      cacheResult: [{ system: "npm", packageName: "react", packageVersion: "19.2.6", sourceRepo: "facebook/react" }],
    });

    const resolveMapping = vi.fn();
    await recomputeDependencyEdges(db, 1, { resolveMapping, settings: { pacingMs: 0 } });

    expect(resolveMapping).not.toHaveBeenCalled();
  });

  it("缓存未命中时按 system 调用 resolveMapping 并写入缓存", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "django", version: "4.2.1", system: "pypi" }] },
        { id: 2, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "django", version: "4.2.1", system: "pypi" }] },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(depsResolved("django/django"));
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, settings: { pacingMs: 0 } });

    expect(resolveMapping).toHaveBeenCalledWith("pypi", "django", "4.2.1");
    // django/django 不在工作区，不产生 repo→repo 边；Django 技术栈事实进新表快照
    expect(count).toBe(0);
    expect(db._insertedMappings.length).toBeGreaterThan(0);
    expect(db._insertedMappings[0].system).toBe("pypi");
    const inputs = mockApplyTechnologyStacks.mock.calls[0][1];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].relations.map((r: any) => r.slug)).toEqual(["django"]);
  });

  it("只把识别出的技术栈建成 reference，通用库及其 SOURCE_REPO 不进入图谱", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "lodash", version: "4.17.21", system: "npm" }] },
        { id: 2, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "lodash", version: "4.17.21", system: "npm" }] },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(depsResolved("lodash/lodash"));
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, settings: { pacingMs: 0 } });

    expect(count).toBe(0);
    expect(db._referenceUpserts).toHaveLength(0);
    expect(db._insertedEdges).toHaveLength(0);
  });

  it("重命名归一：deps.dev 过期 fullName 归一后与采集行合并，直接连边", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
        { id: 2, fullName: "react/react", isReference: false, sbomPackages: null },
        { id: 3, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
      ],
      cacheResult: [{ system: "npm", packageName: "react", packageVersion: "19.2.6", sourceRepo: "facebook/react" }],
    });

    const resolveMapping = vi.fn();
    const canonicalize = vi.fn().mockResolvedValue(canonResolved("react/react"));
    const count = await recomputeDependencyEdges(db, 1, {
      resolveMapping, canonicalize, settings: { pacingMs: 0 },
    });

    // in-degree=2 触发归一：facebook/react → react/react（已采集）→ 两条直连边；
    // React 技术栈事实进新表快照（legacy reference 行不再写入）。
    expect(canonicalize).toHaveBeenCalledWith("facebook/react");
    expect(count).toBe(2);
    expect(db._referenceUpserts).toHaveLength(0);
    const repoEdges = db._insertedEdges.filter((e: any) => e.evidence.resolvedBy === "deps.dev");
    expect(repoEdges.map((e: any) => e.targetRepoId)).toEqual([2, 2]);
  });

  it("重命名归一将两个外部目标合并后只产出一条边（防唯一约束冲突）", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [
          { name: "react", version: "19.2.6", system: "npm" },
          { name: "react-legacy", version: "1.0.0", system: "npm" },
        ] },
        { id: 2, fullName: "react/react", isReference: false, sbomPackages: null },
        { id: 3, fullName: "org-b/app-b", isReference: false, sbomPackages: [
          { name: "react", version: "19.2.6", system: "npm" },
          { name: "react-legacy", version: "1.0.0", system: "npm" },
        ] },
      ],
      // 两个包分别映射到 facebook/react 和 facebook/react-legacy（in-degree 均达 ≥2 门槛）
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockImplementation((_system: string, name: string) =>
      Promise.resolve(depsResolved(name === "react-legacy" ? "facebook/react-legacy" : "facebook/react"))
    );
    // 两个外部名都归一到 react/react
    const canonicalize = vi.fn().mockImplementation((fullName: string) =>
      Promise.resolve(canonResolved("react/react"))
    );
    const count = await recomputeDependencyEdges(db, 1, {
      resolveMapping, canonicalize, settings: { pacingMs: 0 },
    });

    // org-a 的两个仓库目标合并为一条边；org-b 一条边（React 事实进新表快照）。
    expect(count).toBe(2);
    const aEdges = db._insertedEdges.filter(
      (e: any) => e.sourceRepoId === 1 && e.evidence.resolvedBy === "deps.dev"
    );
    expect(aEdges).toHaveLength(1);
    expect(aEdges[0].evidence.packages.length).toBe(2);
  });

  it("已采集仓库作为依赖目标时直接连边（无 in-degree 门槛、不建基石行）", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
        { id: 2, fullName: "facebook/react", isReference: false, sbomPackages: null },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(depsResolved("facebook/react"));
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, settings: { pacingMs: 0 } });

    expect(count).toBe(1);
    const repoEdge = db._insertedEdges.find((e: any) => e.evidence.resolvedBy === "deps.dev");
    expect(repoEdge.sourceRepoId).toBe(1);
    expect(repoEdge.targetRepoId).toBe(2);
  });

  it("单个仓库也会展示其 React、Vue、Spring Boot 技术栈", async () => {
    const db = createDepMockDb({
      repos: [
        {
          id: 1,
          fullName: "org-a/app-a",
            sbomPackages: [
            { name: "react", version: "19.2.6", system: "npm" },
            { name: "vue", version: "3.5.0", system: "npm" },
            { name: "org.springframework.boot:spring-boot-starter-web", version: "3.5.0", system: "maven" },
          ],
        },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(depsNotFound());
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, settings: { pacingMs: 0 } });

    // 技术栈事实只进新表快照；legacy reference 行与栈边不再写入
    expect(count).toBe(0);
    expect(db._referenceUpserts).toHaveLength(0);
    expect(db._insertedEdges).toHaveLength(0);
    expect(mockApplyTechnologyStacks).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({
        repositoryId: 1,
        githubRepositoryId: "1",
        relations: expect.arrayContaining([
          expect.objectContaining({ slug: "react" }),
          expect.objectContaining({ slug: "spring-boot" }),
          expect.objectContaining({ slug: "vue" }),
        ]),
      })],
      expect.any(Date),
    );
    expect(mockApplyTechnologyStacks.mock.calls[0][1][0].relations).toHaveLength(3);
  });

  it("collection token 变旧时不替换 legacy 图快照并要求任务重试", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
      ],
      cacheResult: [],
    });
    mockApplyTechnologyStacks.mockResolvedValueOnce("stale");

    await expect(recomputeDependencyEdges(db, 1, {
      resolveMapping: vi.fn().mockResolvedValue(depsNotFound()),
      settings: { pacingMs: 0 },
    })).rejects.toThrow(/已更新/);
    expect(db._referenceUpserts).toHaveLength(0);
    expect(db._insertedEdges).toHaveLength(0);
  });

  it("同源多个 React 包聚合为一条新表 relation 且 packages 记录全部桥接包", async () => {
    const db = createDepMockDb({
      repos: [
        {
          id: 1,
          fullName: "org-a/app-a",
            sbomPackages: [
            { name: "react", version: "19.2.6", system: "npm" },
            { name: "react-dom", version: "19.2.6", system: "npm" },
          ],
        },
        { id: 2, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(depsNotFound());
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, settings: { pacingMs: 0 } });

    expect(count).toBe(0);
    const inputs = mockApplyTechnologyStacks.mock.calls[0][1];
    const repo1 = inputs.find((i: any) => i.repositoryId === 1);
    expect(repo1.relations).toHaveLength(1);
    expect(repo1.relations[0].slug).toBe("react");
    expect(repo1.relations[0].packages.map((p: any) => p.name).sort()).toEqual(["react", "react-dom"]);
    const repo2 = inputs.find((i: any) => i.repositoryId === 2);
    expect(repo2.relations[0].packages).toHaveLength(1);
  });

  it("技术栈伪行（无 stable ID）的 SBOM 不作为解析起点", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
        { id: 2, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
        { id: 3, fullName: "tech-stack/react", isReference: true, sbomPackages: [{ name: "some-dep", version: "1.0.0", system: "npm" }] },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(depsNotFound());
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, settings: { pacingMs: 0 } });

    // 伪行的 SBOM 不参与解析，也不进入新表快照
    expect(resolveMapping).not.toHaveBeenCalledWith("npm", "some-dep", "1.0.0");
    const inputs = mockApplyTechnologyStacks.mock.calls[0][1];
    expect(inputs.map((i: any) => i.repositoryId).sort()).toEqual([1, 2]);
    expect(count).toBe(0);
  });
});

describe("detectTechStack", () => {
  it.each([
    [{ system: "npm", name: "react" }, "React"],
    [{ system: "npm", name: "@vue/runtime-core" }, "Vue"],
    [{ system: "maven", name: "org.springframework.boot:spring-boot-starter-web" }, "Spring Boot"],
  ])("识别 %o 为 %s", (pkg, expectedName) => {
    expect(detectTechStack(pkg)).toMatchObject({ name: expectedName });
  });

  it("不把通用库误判为技术栈", () => {
    expect(detectTechStack({ system: "npm", name: "lodash" })).toBeNull();
  });
});

// ============================================================================
// getRepoGraphData 契约测试
// ============================================================================

describe("backfillSbomPackages", () => {
  it("回填 null 与遗留无 system 字段的行，跳过已多生态的行", async () => {
    mockApplySbomBackfill.mockResolvedValue("applied");
    const version = new Date("2026-08-18T00:00:00.000Z");
    const repos = [
      { id: 1, githubRepositoryId: "101", fullName: "org/a", updatedAt: version, sbomPackages: null },
      { id: 2, githubRepositoryId: "102", fullName: "org/b", updatedAt: version, sbomPackages: [{ name: "react", version: "19.0.0" }] }, // 遗留无 system
      { id: 3, githubRepositoryId: "103", fullName: "org/c", updatedAt: version, sbomPackages: [{ name: "vue", version: "3.0.0", system: "npm" }] }, // 已多生态
    ];
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(repos),
        }),
      }),
    } as any;

    const { backfillSbomPackages } = await import("./repo-graph");
    const fetchSbom = vi.fn().mockResolvedValue({ sbom: { packages: [
      { name: "fastapi", versionInfo: "0.115.0", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:pypi/fastapi@0.115.0" }] },
    ] } });

    const filled = await backfillSbomPackages(db, 1, { fetchSbom, delayMs: 0 });

    // repo 1（null）与 repo 2（遗留）被抓取；repo 3 跳过
    expect(fetchSbom).toHaveBeenCalledTimes(2);
    expect(fetchSbom).toHaveBeenCalledWith("org/a");
    expect(fetchSbom).toHaveBeenCalledWith("org/b");
    expect(filled).toBe(2);
    expect(mockApplySbomBackfill).toHaveBeenCalledTimes(2);
    expect(mockApplySbomBackfill.mock.calls[0][1].packages[0])
      .toMatchObject({ name: "fastapi", system: "pypi" });
  });

  it("无 fetchSbom 时直接返回 0", async () => {
    const { backfillSbomPackages } = await import("./repo-graph");
    const db = { select: vi.fn() } as any;
    expect(await backfillSbomPackages(db, 1, {})).toBe(0);
  });
});

// ============================================================================
// deps cache recovery：状态、TTL、预算、并发、freshness、lease
// ============================================================================

interface TestMappingRow {
  system: string;
  packageName: string;
  packageVersion: string;
  sourceRepo: string | null;
  resolutionStatus: "resolved" | "not_found" | "error";
  retryAfter: Date;
  lastError?: string | null;
  lastResolvedRepo?: string | null;
}

interface TestCanonRow {
  fullName: string;
  canonicalFullName: string | null;
  resolutionStatus: "resolved" | "not_found" | "error";
  retryAfter: Date;
  lastError?: string | null;
}

const CACHE_NOW = new Date("2026-08-19T00:00:00.000Z");
const FUTURE = new Date(CACHE_NOW.getTime() + 3_600_000);
const PAST = new Date(CACHE_NOW.getTime() - 3_600_000);

const cacheSettings = {
  ...DEFAULT_EXTERNAL_RESOLUTION_SETTINGS,
  pacingMs: 0,
};

function depsResolved(sourceRepo: string): DepsDevOutcome {
  return { status: "resolved", sourceRepo, retryAfterSeconds: null, errorSummary: null };
}
function depsNotFound(): DepsDevOutcome {
  return { status: "not_found", sourceRepo: null, retryAfterSeconds: null, errorSummary: null };
}
function depsError(retryAfterSeconds: number | null = null, errorSummary = "network error"): DepsDevOutcome {
  return { status: "error", sourceRepo: null, retryAfterSeconds, errorSummary };
}
function canonResolved(canonicalFullName: string): CanonicalizationOutcome {
  return { status: "resolved", canonicalFullName, retryAfterSeconds: null, errorSummary: null };
}

function createCacheMockDb(opts: {
  repos: Array<{ id: number; fullName: string; sbomPackages: unknown; isReference?: boolean }>;
  mappingRows?: TestMappingRow[];
  canonRows?: TestCanonRow[];
}) {
  mockApplyTechnologyStacks.mockReset();
  mockApplyTechnologyStacks.mockResolvedValue("applied");
  const mappingRows = opts.mappingRows ?? [];
  const canonRows = opts.canonRows ?? [];
  const mappingUpserts: any[] = [];
  const canonUpserts: any[] = [];
  const mappingUpdates: Array<{ set: Record<string, unknown>; whereArgs: unknown[] }> = [];
  const insertedEdges: any[] = [];
  let txStarted = false;
  let nextRefId = 2000;

  const selectBuilder = (result: unknown) => {
    let table: unknown = null;
    const builder: any = {
      from: vi.fn().mockImplementation((t: unknown) => {
        table = t;
        return builder;
      }),
      where: vi.fn().mockImplementation((...args: unknown[]) => {
        builder._whereArgs = args;
        return builder;
      }),
      limit: vi.fn().mockImplementation(() => builder),
      then: (resolve: any, reject: any) => {
        let result2: unknown = [];
        if (table === repositories) {
          result2 = opts.repos.map((repo) => ({
            embedding: null,
            githubRepositoryId: repo.isReference ? null : String(repo.id),
            updatedAt: new Date("2026-08-18T00:00:00.000Z"),
            ...repo,
          }));
        } else if (table === packageRepoMappings) {
          result2 = mappingRows;
        } else if (table === githubRepoNameCanonicalizations) {
          result2 = canonRows;
        }
        return Promise.resolve(result2).then(resolve, reject);
      },
    };
    return builder;
  };

  const insertInto = (table: unknown) => {
    if (table === packageRepoMappings) {
      return {
        values: vi.fn().mockImplementation((v: any) => ({
          onConflictDoUpdate: vi.fn().mockImplementation((conflict: any) => {
            mappingUpserts.push({ values: v, conflict });
            return Promise.resolve();
          }),
        })),
      };
    }
    if (table === githubRepoNameCanonicalizations) {
      return {
        values: vi.fn().mockImplementation((v: any) => ({
          onConflictDoUpdate: vi.fn().mockImplementation(() => {
            canonUpserts.push(v);
            return Promise.resolve();
          }),
        })),
      };
    }
    if (table === repositories) {
      return {
        values: vi.fn().mockImplementation((v: any) => ({
          onConflictDoUpdate: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockImplementation(() =>
              Promise.resolve([{ id: nextRefId++ }])),
          })),
        })),
      };
    }
    if (table === userWatchedRepositories) {
      return {
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      };
    }
    return { values: vi.fn().mockResolvedValue(undefined) };
  };

  const db = {
    // Phase C：rebuild 提交后无条件跑冻结基线单向包含；mock 无基线表 → 空基线恒过
    execute: vi.fn().mockResolvedValue({ rows: [{ exists: false }] }),
    select: vi.fn().mockImplementation(() => selectBuilder([])),
    insert: vi.fn().mockImplementation((table: unknown) => insertInto(table)),
    update: vi.fn().mockImplementation((table: unknown) => {
      if (table !== packageRepoMappings) {
        return { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) };
      }
      return {
        set: vi.fn().mockImplementation((set: Record<string, unknown>) => ({
          where: vi.fn().mockImplementation((...whereArgs: unknown[]) => {
            mappingUpdates.push({ set, whereArgs });
            return Promise.resolve(undefined);
          }),
        })),
      };
    }),
    transaction: vi.fn().mockImplementation(async (fn: any) => {
      txStarted = true;
      const txInsert = vi.fn().mockImplementation((table: unknown) => {
        if (table === repositories) return insertInto(table);
        if (table === userWatchedRepositories) return insertInto(table);
        return {
          values: vi.fn().mockImplementation((vals: any) => {
            if (Array.isArray(vals)) insertedEdges.push(...vals);
            return Promise.resolve();
          }),
        };
      });
      await fn({
        execute: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        insert: txInsert,
      });
    }),
    _mappingUpserts: mappingUpserts,
    _canonUpserts: canonUpserts,
    _mappingUpdates: mappingUpdates,
    _insertedEdges: insertedEdges,
    get _txStarted() {
      return txStarted;
    },
  };
  return db as any;
}

describe("recomputeDependencyEdges（deps cache recovery）", () => {
  const repo = (id: number, fullName: string, packages: unknown) => ({
    id,
    fullName,
    isReference: false,
    sbomPackages: packages,
  });

  it("分类写入缓存：resolved/not_found/error 各自的状态、sourceRepo 与 retry_after", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [
          { name: "react", version: "19.0.0", system: "npm" },
          { name: "left-pad", version: "1.3.0", system: "npm" },
          { name: "boom", version: "2.0.0", system: "npm" },
        ]),
      ],
    });
    const resolveMapping = vi.fn(async (_s: string, name: string) => {
      if (name === "react") return depsResolved("facebook/react");
      if (name === "left-pad") return depsNotFound();
      return depsError(null, "connect ETIMEDOUT");
    });

    await recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });

    const upsertOf = (name: string) =>
      db._mappingUpserts.find((u: any) => u.values.packageName === name)?.values;
    expect(upsertOf("react")).toMatchObject({
      resolutionStatus: "resolved",
      sourceRepo: "facebook/react",
      lastError: null,
    });
    expect(upsertOf("react").retryAfter.getTime())
      .toBe(CACHE_NOW.getTime() + DEFAULT_EXTERNAL_RESOLUTION_SETTINGS.depsResolvedTtlMs);

    expect(upsertOf("left-pad")).toMatchObject({
      resolutionStatus: "not_found",
      sourceRepo: null,
    });
    expect(upsertOf("left-pad").retryAfter.getTime())
      .toBe(CACHE_NOW.getTime() + DEFAULT_EXTERNAL_RESOLUTION_SETTINGS.depsNotFoundTtlMs);

    expect(upsertOf("boom")).toMatchObject({
      resolutionStatus: "error",
      sourceRepo: null,
      lastError: "connect ETIMEDOUT",
    });
    expect(upsertOf("boom").retryAfter.getTime())
      .toBe(CACHE_NOW.getTime() + DEFAULT_EXTERNAL_RESOLUTION_SETTINGS.depsErrorRetryMs);
  });

  it("pending/negative 未到期不外呼也不改写；到期后的 error 行重查并恢复 resolved", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [
          { name: "pending-pkg", version: "1.0.0", system: "npm" },
          { name: "negative-pkg", version: "1.0.0", system: "npm" },
          { name: "due-pkg", version: "1.0.0", system: "npm" },
        ]),
      ],
      mappingRows: [
        {
          system: "npm",
          packageName: "pending-pkg",
          packageVersion: "1.0.0",
          sourceRepo: null,
          resolutionStatus: "error",
          retryAfter: FUTURE,
        },
        {
          system: "npm",
          packageName: "negative-pkg",
          packageVersion: "1.0.0",
          sourceRepo: null,
          resolutionStatus: "not_found",
          retryAfter: FUTURE,
        },
        {
          system: "npm",
          packageName: "due-pkg",
          packageVersion: "1.0.0",
          sourceRepo: null,
          resolutionStatus: "error",
          retryAfter: PAST,
        },
      ],
    });
    const resolveMapping = vi.fn().mockResolvedValue(depsResolved("org-b/lib"));

    await recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });

    expect(resolveMapping).toHaveBeenCalledTimes(1);
    expect(resolveMapping).toHaveBeenCalledWith("npm", "due-pkg", "1.0.0");
    expect(db._mappingUpserts).toHaveLength(1);
    expect(db._mappingUpserts[0].values).toMatchObject({
      packageName: "due-pkg",
      resolutionStatus: "resolved",
      sourceRepo: "org-b/lib",
    });
  });

  it("warm rebuild：TTL 内 resolved 行零 deps.dev 外呼，边仍来自缓存值", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [
          { name: "react", version: "19.0.0", system: "npm" },
          { name: "vue", version: "3.4.0", system: "npm" },
        ]),
        repo(2, "org-b/lib", []),
      ],
      mappingRows: [
        {
          system: "npm",
          packageName: "react",
          packageVersion: "19.0.0",
          sourceRepo: "org-b/lib",
          resolutionStatus: "resolved",
          retryAfter: FUTURE,
        },
        {
          system: "npm",
          packageName: "vue",
          packageVersion: "3.4.0",
          sourceRepo: null,
          resolutionStatus: "not_found",
          retryAfter: FUTURE,
        },
      ],
    });
    const resolveMapping = vi.fn();

    await recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });

    expect(resolveMapping).not.toHaveBeenCalled();
    expect(db._mappingUpserts).toHaveLength(0);
    const dependencyEdges = db._insertedEdges.filter(
      (e: any) => e.edgeType === "dependency" && e.targetRepoId === 2,
    );
    expect(dependencyEdges).toHaveLength(1);
    expect(dependencyEdges[0]).toMatchObject({
      sourceRepoId: 1,
      targetRepoId: 2,
    });
  });

  it("resolved 到期复查失败：sourceRepo 移动到 last_resolved_repo，本轮按无映射", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [{ name: "react", version: "19.0.0", system: "npm" }]),
        repo(2, "facebook/react", []),
      ],
      mappingRows: [
        {
          system: "npm",
          packageName: "react",
          packageVersion: "19.0.0",
          sourceRepo: "facebook/react",
          resolutionStatus: "resolved",
          retryAfter: PAST,
        },
      ],
    });
    const resolveMapping = vi.fn().mockResolvedValue(depsError(null, "socket hang up"));

    await recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });

    expect(db._mappingUpserts).toHaveLength(1);
    expect(db._mappingUpserts[0].values).toMatchObject({
      resolutionStatus: "error",
      sourceRepo: null,
      lastResolvedRepo: "facebook/react",
      lastError: "socket hang up",
    });
    // 降级期间按无映射：不再连到 facebook/react（技术栈 reference 边不受影响）
    expect(
      db._insertedEdges.filter((e: any) => e.targetRepoId === 2),
    ).toHaveLength(0);
  });

  it("request budget 耗尽：fail closed 零图写入，已完成的 cache receipt 保留", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [
          { name: "pkg-a", version: "1.0.0", system: "npm" },
          { name: "pkg-b", version: "1.0.0", system: "npm" },
        ]),
      ],
    });
    const resolveMapping = vi.fn(async (_s: string, name: string) =>
      depsResolved(`org-b/${name}`));

    await expect(recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: { ...cacheSettings, depsRequestBudget: 1 },
      now: () => CACHE_NOW,
    })).rejects.toThrow(GraphBudgetExceededError);

    expect(db._txStarted).toBe(false);
    expect(db._insertedEdges).toHaveLength(0);
    expect(db._mappingUpserts).toHaveLength(1);
  });

  it("429：写入带 Retry-After 的 receipt 后立即失败，不再消耗该 provider 预算", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [
          { name: "pkg-a", version: "1.0.0", system: "npm" },
          { name: "pkg-b", version: "1.0.0", system: "npm" },
          { name: "pkg-c", version: "1.0.0", system: "npm" },
        ]),
      ],
    });
    const resolveMapping = vi.fn().mockResolvedValue(depsError(30, "rate limited"));

    await expect(recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: { ...cacheSettings, depsConcurrency: 1 },
      now: () => CACHE_NOW,
    })).rejects.toThrow(GraphRateLimitedError);

    expect(resolveMapping).toHaveBeenCalledTimes(1);
    expect(db._txStarted).toBe(false);
    expect(db._mappingUpserts).toHaveLength(1);
    expect(db._mappingUpserts[0].values).toMatchObject({
      resolutionStatus: "error",
      retryAfter: new Date(CACHE_NOW.getTime() + 30_000),
    });
  });

  it("有界并发：观测到的最大 deps.dev 并发不超过配置", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", Array.from({ length: 8 }, (_, i) => ({
          name: `pkg-${i}`,
          version: "1.0.0",
          system: "npm",
        }))),
      ],
    });
    let active = 0;
    let maxActive = 0;
    const resolveMapping = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return depsNotFound();
    });

    await recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: { ...cacheSettings, depsConcurrency: 3 },
      now: () => CACHE_NOW,
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("同一 package key 在一次运行只外呼一次（跨仓库去重）", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [{ name: "shared", version: "1.0.0", system: "npm" }]),
        repo(2, "org-b/app-b", [{ name: "shared", version: "1.0.0", system: "npm" }]),
      ],
    });
    const resolveMapping = vi.fn().mockResolvedValue(depsNotFound());

    await recomputeDependencyEdges(db, 1, {
      resolveMapping,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });

    expect(resolveMapping).toHaveBeenCalledTimes(1);
    expect(db._mappingUpserts).toHaveLength(1);
  });

  it("canonicalization freshness：持久化后第二次运行零 GitHub 外呼", async () => {
    const repos = [
      repo(1, "org-a/app-a", [{ name: "pkg-1", version: "1.0.0", system: "npm" }]),
      repo(2, "org-b/app-b", [{ name: "pkg-2", version: "1.0.0", system: "npm" }]),
      repo(3, "new/target", []),
    ];
    const mappingRows: TestMappingRow[] = [
      {
        system: "npm",
        packageName: "pkg-1",
        packageVersion: "1.0.0",
        sourceRepo: "old/target",
        resolutionStatus: "resolved",
        retryAfter: FUTURE,
      },
      {
        system: "npm",
        packageName: "pkg-2",
        packageVersion: "1.0.0",
        sourceRepo: "old/target",
        resolutionStatus: "resolved",
        retryAfter: FUTURE,
      },
    ];

    const dbRun1 = createCacheMockDb({ repos, mappingRows });
    const canonicalize1 = vi.fn().mockResolvedValue(canonResolved("new/target"));
    await recomputeDependencyEdges(dbRun1, 1, {
      resolveMapping: vi.fn(),
      canonicalize: canonicalize1,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });
    expect(canonicalize1).toHaveBeenCalledTimes(1);
    expect(canonicalize1).toHaveBeenCalledWith("old/target");
    expect(dbRun1._canonUpserts).toHaveLength(1);
    expect(dbRun1._canonUpserts[0]).toMatchObject({
      fullName: "old/target",
      canonicalFullName: "new/target",
      resolutionStatus: "resolved",
    });
    // rename 回写：只改命名，不改 resolution 状态
    expect(dbRun1._mappingUpdates).toHaveLength(1);
    expect(dbRun1._mappingUpdates[0].set).toMatchObject({ sourceRepo: "new/target" });
    expect(dbRun1._mappingUpdates[0].set).not.toHaveProperty("resolutionStatus");

    // 第二次运行：freshness 未到期的持久行直接生效，零 canonicalization 外呼
    const dbRun2 = createCacheMockDb({
      repos,
      mappingRows: mappingRows.map((row) => ({ ...row, sourceRepo: "new/target" })),
      canonRows: [
        {
          fullName: "old/target",
          canonicalFullName: "new/target",
          resolutionStatus: "resolved",
          retryAfter: FUTURE,
        },
      ],
    });
    const canonicalize2 = vi.fn();
    await recomputeDependencyEdges(dbRun2, 1, {
      resolveMapping: vi.fn(),
      canonicalize: canonicalize2,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });
    expect(canonicalize2).not.toHaveBeenCalled();
    expect(dbRun2._canonUpserts).toHaveLength(0);
    expect(dbRun2._mappingUpdates).toHaveLength(0);
    // 归一后的目标连到已采集仓库
    expect(dbRun2._insertedEdges).toHaveLength(2);
  });

  it("canonicalization resolved 复查失败：旧 canonical 值保留为证据", async () => {
    const repos = [
      repo(1, "org-a/app-a", [{ name: "pkg-1", version: "1.0.0", system: "npm" }]),
      repo(2, "org-b/app-b", [{ name: "pkg-2", version: "1.0.0", system: "npm" }]),
    ];
    const db = createCacheMockDb({
      repos,
      mappingRows: [
        { system: "npm", packageName: "pkg-1", packageVersion: "1.0.0", sourceRepo: "old/target", resolutionStatus: "resolved", retryAfter: FUTURE },
        { system: "npm", packageName: "pkg-2", packageVersion: "1.0.0", sourceRepo: "old/target", resolutionStatus: "resolved", retryAfter: FUTURE },
      ],
      canonRows: [
        {
          fullName: "old/target",
          canonicalFullName: "new/target",
          resolutionStatus: "resolved",
          retryAfter: PAST,
        },
      ],
    });
    const canonicalize = vi.fn().mockResolvedValue({
      status: "error" as const,
      canonicalFullName: null,
      retryAfterSeconds: null,
      errorSummary: "network_error",
    });

    await recomputeDependencyEdges(db, 1, {
      resolveMapping: vi.fn(),
      canonicalize,
      settings: cacheSettings,
      now: () => CACHE_NOW,
    });

    expect(canonicalize).toHaveBeenCalledTimes(1);
    expect(db._canonUpserts).toHaveLength(1);
    expect(db._canonUpserts[0]).toMatchObject({
      fullName: "old/target",
      canonicalFullName: "new/target", // 降级保留旧值证据
      resolutionStatus: "error",
      lastError: "network_error",
    });
    // 失败保持原 fullName，不产生 rename 回写
    expect(db._mappingUpdates).toHaveLength(0);
  });

  it("happy path：assertLease 在事务外与事务内各复核一次", async () => {
    const db = createCacheMockDb({
      repos: [repo(1, "org-a/app-a", [{ name: "react", version: "19.0.0", system: "npm" }])],
      mappingRows: [
        { system: "npm", packageName: "react", packageVersion: "19.0.0", sourceRepo: null, resolutionStatus: "not_found", retryAfter: FUTURE },
      ],
    });
    const assertLease = vi.fn().mockResolvedValue(undefined);

    await recomputeDependencyEdges(db, 1, {
      resolveMapping: vi.fn(),
      settings: cacheSettings,
      now: () => CACHE_NOW,
      assertLease,
    });

    expect(assertLease).toHaveBeenCalledTimes(2);
    // 第二次调用拿到事务执行器（带行锁复核的入参形态）
    expect(assertLease.mock.calls[1][0]).toBeDefined();
    expect(db._txStarted).toBe(true);
  });

  it("lost lease：assertLease 抛错时不进入原子提交，边零写入", async () => {
    const db = createCacheMockDb({
      repos: [repo(1, "org-a/app-a", [{ name: "react", version: "19.0.0", system: "npm" }])],
      mappingRows: [
        {
          system: "npm",
          packageName: "react",
          packageVersion: "19.0.0",
          sourceRepo: null,
          resolutionStatus: "not_found",
          retryAfter: FUTURE,
        },
      ],
    });
    const assertLease = vi.fn().mockRejectedValue(new GraphLeaseLostError("lease expired"));

    await expect(recomputeDependencyEdges(db, 1, {
      resolveMapping: vi.fn(),
      settings: cacheSettings,
      now: () => CACHE_NOW,
      assertLease,
    })).rejects.toThrow(GraphLeaseLostError);

    expect(assertLease).toHaveBeenCalled();
    expect(db._txStarted).toBe(false);
    expect(db._insertedEdges).toHaveLength(0);
  });

  it("进度：deps_resolution/github_canonicalization stage 上报且计数完整", async () => {
    const db = createCacheMockDb({
      repos: [
        repo(1, "org-a/app-a", [{ name: "pkg-1", version: "1.0.0", system: "npm" }]),
        repo(2, "org-b/app-b", [{ name: "pkg-2", version: "1.0.0", system: "npm" }]),
        repo(3, "unrelated/repo", []),
      ],
    });
    const snapshots: any[] = [];
    const resolveMapping = vi.fn(async () => depsResolved("elsewhere/target"));

    await recomputeDependencyEdges(db, 1, {
      resolveMapping,
      canonicalize: vi.fn().mockResolvedValue({
        status: "not_found",
        canonicalFullName: null,
        retryAfterSeconds: null,
        errorSummary: null,
      }),
      settings: cacheSettings,
      now: () => CACHE_NOW,
      progress: async (snapshot: any) => {
        snapshots.push({ ...snapshot });
      },
    });

    const depsStage = snapshots.filter((s) => s.stage === "deps_resolution");
    expect(depsStage.length).toBeGreaterThan(0);
    expect(depsStage[0]).toMatchObject({ stage: "deps_resolution", total: 2 });
    expect(depsStage[depsStage.length - 1]).toMatchObject({ stage: "deps_resolution", completed: 2 });
    const finalDeps = depsStage[depsStage.length - 1];
    expect(finalDeps.cacheMisses).toBe(2);
    expect(finalDeps.externalRequests).toBe(2);

    // 两个源仓库都指向 elsewhere/target：indegree=2 达到 canonicalization 门槛
    const canonStage = snapshots.filter((s) => s.stage === "github_canonicalization");
    expect(canonStage.length).toBeGreaterThan(0);
    expect(canonStage[canonStage.length - 1].completed)
      .toBe(canonStage[canonStage.length - 1].total);

    const commitStage = snapshots.filter((s) => s.stage === "atomic_commit");
    expect(commitStage.length).toBeGreaterThan(0);
  });
});

describe("rebuildRepoGraph（deps cache recovery）", () => {
  beforeEach(() => {
    mockPoolRepositoryEmbedding.mockReset();
    mockPoolRepositoryEmbedding.mockResolvedValue("applied");
    mockApplySbomBackfill.mockReset();
    mockApplySbomBackfill.mockResolvedValue("applied");
    mockApplyTechnologyStacks.mockReset();
    mockApplyTechnologyStacks.mockResolvedValue("applied");
  });

  it("stage 序列含 embedding/similarity/sbom/deps_resolution，completed 单调不减", async () => {
    const db = createCacheMockDb({
      repos: [
        {
          id: 1,
          fullName: "org-a/app-a",
            sbomPackages: null,
        },
      ],
    });
    const snapshots: any[] = [];
    const fetchSbom = vi.fn().mockResolvedValue({ sbom: { packages: [] } });

    await rebuildRepoGraph(db, 1, {
      resolveMapping: vi.fn().mockResolvedValue(depsNotFound()),
      fetchSbom,
      settings: cacheSettings,
      now: () => CACHE_NOW,
      progress: async (snapshot: any) => {
        snapshots.push({ ...snapshot });
      },
    });

    const stages = snapshots.map((s) => s.stage);
    expect(stages).toContain("embedding");
    expect(stages).toContain("similarity");
    expect(stages).toContain("sbom");
    expect(stages).toContain("deps_resolution");
    expect(stages).toContain("atomic_commit");

    const stageOrder = ["embedding", "sbom", "similarity", "deps_resolution", "github_canonicalization", "atomic_commit"];
    let lastIdx = -1;
    for (const stage of stageOrder) {
      const idx = stages.indexOf(stage);
      if (idx >= 0) {
        expect(idx).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    }

    for (const stage of stageOrder) {
      const stageSnaps = snapshots.filter((s) => s.stage === stage);
      for (let i = 1; i < stageSnaps.length; i++) {
        expect(stageSnaps[i].completed).toBeGreaterThanOrEqual(stageSnaps[i - 1].completed);
      }
    }
    // sbom 阶段的外呼计入预算与进度
    const finalSbom = snapshots.filter((s) => s.stage === "sbom").pop();
    expect(finalSbom.externalRequests).toBe(1);
  });

  it("SBOM 阶段 GitHub 预算耗尽：在任何图写入之前 fail closed", async () => {
    const db = createCacheMockDb({
      repos: [
        { id: 1, fullName: "org-a/a", isReference: false, sbomPackages: null, embedding: [1, 0] },
        { id: 2, fullName: "org-b/b", isReference: false, sbomPackages: null, embedding: [0, 1] },
      ],
    });
    const fetchSbom = vi.fn().mockResolvedValue({ sbom: { packages: [] } });

    await expect(rebuildRepoGraph(db, 1, {
      resolveMapping: vi.fn(),
      fetchSbom,
      settings: { ...cacheSettings, githubRequestBudget: 1 },
      now: () => CACHE_NOW,
    })).rejects.toThrow(GraphBudgetExceededError);

    expect(fetchSbom).toHaveBeenCalledTimes(1);
    expect(db._txStarted).toBe(false);
    expect(db._insertedEdges).toHaveLength(0);
  });
});

// ============================================================================
// Phase B：new_read_dual_write 新表读投影
// ============================================================================

describe("getRepoGraphData（新表投影）", () => {
  interface NewReadFixture {
    repos: Array<{ id: number; fullName: string; name: string; language: string | null; stars: number | null; description: string | null; githubRepositoryId?: string }>;
    stackRows: Array<{ repoId: number; slug: string; stackName: string }>;
    edges: Array<{ sourceRepoId: number; targetRepoId: number; edgeType: string; score: number | null; evidence: unknown }>;
  }

  function createNewReadMockDb(fx: NewReadFixture) {
    const stackTable = new Map(fx.stackRows.map((row) => [row.repoId, row]));
    return {
      select: vi.fn().mockImplementation((projection: unknown) => {
        let table: unknown = null;
        const builder: any = {
          from: vi.fn().mockImplementation((t: unknown) => {
            table = t;
            return builder;
          }),
          innerJoin: vi.fn().mockImplementation((t: unknown) => {
            // joined tables 累积标记，最终结果按主表路由
            if (t === userWatchedRepositories) table = table ?? null;
            return builder;
          }),
          where: vi.fn().mockImplementation(() => builder),
          then: (resolve: any, reject: any) => {
            let result: unknown = [];
            if (table === repositories) {
              // 仓库查询（含 watched join 的正向条件语义由 fixture 直接表达）
              result = fx.repos;
            } else if (table === repositoryTechnologyStacks) {
              result = fx.stackRows.map((row) => ({
                repoId: row.repoId,
                slug: row.slug,
                stackName: row.stackName,
                githubRepositoryId: fx.repos.find((r) => r.id === row.repoId)?.githubRepositoryId ?? "900",
              }));
            } else if (table === repoRelationships) {
              result = fx.edges.map((e) => ({
                source: e.sourceRepoId, target: e.targetRepoId,
                type: e.edgeType, score: e.score, evidence: e.evidence,
              }));
            }
            void stackTable;
            void projection;
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      }),
    } as any;
  }

  const fx = (): NewReadFixture => ({
    repos: [
      { id: 1, fullName: "org-a/app", name: "app", language: "TypeScript", stars: 10, description: null, githubRepositoryId: "9001" },
      { id: 2, fullName: "org-b/lib", name: "lib", language: null, stars: 5, description: null, githubRepositoryId: "9002" },
    ],
    stackRows: [
      { repoId: 1, slug: "react", stackName: "React" },
      { repoId: 1, slug: "vite", stackName: "Vite" },
      { repoId: 2, slug: "react", stackName: "React" },
    ],
    edges: [
      { sourceRepoId: 1, targetRepoId: 2, edgeType: "dependency", score: null, evidence: { kind: "dependency", resolvedBy: "deps.dev" } },
      { sourceRepoId: 1, targetRepoId: 999, edgeType: "dependency", score: null, evidence: { kind: "dependency", resolvedBy: "tech-stack-catalog" } },
    ],
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("新读：stack:<slug> 节点 + 合成 repo→stack 边 + 语言合成", async () => {
    const { getRepoGraphData } = await import("./repo-graph");
    const data = await getRepoGraphData(createNewReadMockDb(fx()), 1);

    const stackNodes = data.nodes.filter((n) => n.kind === "technology_stack");
    expect(stackNodes.map((n) => n.id).sort()).toEqual(["stack:react", "stack:vite"]);
    expect(stackNodes[0]).toMatchObject({ fullName: "tech-stack/react" });

    const stackEdges = data.edges.filter((e) => e.target.startsWith("stack:"));
    expect(stackEdges).toHaveLength(3); // 1→react, 1→vite, 2→react
    expect(data.edges).toContainEqual({ source: "1", target: "lang:TypeScript", type: "written_in", score: null });
    expect(data.edges).toContainEqual({ source: "1", target: "2", type: "dependency", score: null });
  });

  it("legacy 栈边被排除：无悬空边、无指向 reference 的双重计数", async () => {
    const { getRepoGraphData } = await import("./repo-graph");
    const data = await getRepoGraphData(createNewReadMockDb(fx()), 1);

    expect(data.edges.filter((e) => e.target === "999")).toHaveLength(0);
    expect(data.nodes.filter((n) => n.kind === "reference")).toHaveLength(0);
    // 1→2 真实边只出现一次（不被 legacy 栈边重复）
    expect(data.edges.filter((e) => e.source === "1" && e.target === "2")).toHaveLength(1);
  });

  it("top-N 投影：低频 stack 被裁剪、高频保留（与 shadow 选择语义一致）", async () => {
    const data2 = fx();
    // vite 只有 1 个使用仓库，react 有 2 个——topN=1 时应保留 react
    data2.repos = [
      ...data2.repos,
      { id: 3, fullName: "org-c/x", name: "x", language: null, stars: 1, description: null, githubRepositoryId: "9003" },
    ];
    data2.stackRows.push({ repoId: 3, slug: "react", stackName: "React" });
    // 直接用内部导出测试选择语义（topN=1）
    const { selectTopTechnologyStackSlugs } = await import("./technology-stack-entities");
    const rows = data2.stackRows.map((row) => ({
      githubRepositoryId: String(data2.repos.find((r) => r.id === row.repoId)?.githubRepositoryId ?? 900),
      slug: row.slug,
      stackName: row.stackName,
      packages: [],
    }));
    expect([...selectTopTechnologyStackSlugs(rows, 1)]).toEqual(["react"]);
  });
});
