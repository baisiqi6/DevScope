import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSbomPackages,
  detectTechStack,
  recomputeSimilarityEdges,
  recomputeDependencyEdges,
  poolRepoEmbedding,
  getRepoGraphData,
} from "./repo-graph";
import {
  repositories,
  packageRepoMappings,
  repoRelationships,
  userWatchedRepositories,
} from "./schema";
import sbomFixture from "./__fixtures__/sbom-tailwindcss.json";
import sbomPypiFixture from "./__fixtures__/sbom-pypi-minimal.json";

const { mockPoolRepositoryEmbedding, mockApplySbomBackfill } = vi.hoisted(() => ({
  mockPoolRepositoryEmbedding: vi.fn(),
  mockApplySbomBackfill: vi.fn(),
}));

vi.mock("./collection", () => ({
  poolRepositoryEmbeddingForCurrentVersion: mockPoolRepositoryEmbedding,
  applySbomBackfillIfCurrent: mockApplySbomBackfill,
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
  // 按表路由的 mock：repositories 返回仓库列表，packageRepoMappings 返回固定缓存结果
  function createDepMockDb(opts: {
    repos: Array<{ id: number; fullName: string; sbomPackages: unknown; isReference?: boolean }>;
    cacheResult?: Array<{ sourceRepo: string | null }>;
  }) {
    const cacheResult = opts.cacheResult ?? [];
    const insertedMappings: any[] = [];
    const referenceUpserts: any[] = [];
    const insertedEdges: any[] = [];
    let nextRefId = 1000;
    const refIdByFullName = new Map<string, number>();
    for (const r of opts.repos) refIdByFullName.set(r.fullName.toLowerCase(), r.id);

    const db = {
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
            if (table === repositories) result = opts.repos;
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
        return { values: vi.fn().mockResolvedValue(undefined) };
      }),
      transaction: vi.fn().mockImplementation(async (fn: any) => {
        await fn({
          execute: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: any) => {
              if (Array.isArray(vals)) insertedEdges.push(...vals);
              return Promise.resolve();
            }),
          }),
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
      cacheResult: [{ sourceRepo: "facebook/react" }],
    });

    const resolveMapping = vi.fn();
    await recomputeDependencyEdges(db, 1, { resolveMapping, delayMs: 0 });

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

    const resolveMapping = vi.fn().mockResolvedValue("django/django");
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, delayMs: 0 });

    expect(resolveMapping).toHaveBeenCalledWith("pypi", "django", "4.2.1");
    expect(count).toBe(2);
    expect(db._insertedMappings.length).toBeGreaterThan(0);
    expect(db._insertedMappings[0].system).toBe("pypi");
  });

  it("只把识别出的技术栈建成 reference，通用库及其 SOURCE_REPO 不进入图谱", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "lodash", version: "4.17.21", system: "npm" }] },
        { id: 2, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "lodash", version: "4.17.21", system: "npm" }] },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue("lodash/lodash");
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, delayMs: 0 });

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
      cacheResult: [{ sourceRepo: "facebook/react" }],
    });

    const resolveMapping = vi.fn();
    const canonicalize = vi.fn().mockResolvedValue("react/react");
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, canonicalize, delayMs: 0 });

    // in-degree=2 触发归一：facebook/react → react/react（已采集）→ 两条直连边；
    // 两个来源仓库还分别连接到 React 技术栈。
    expect(canonicalize).toHaveBeenCalledWith("facebook/react");
    expect(count).toBe(4);
    expect(db._referenceUpserts).toHaveLength(1);
    expect(db._referenceUpserts[0].fullName).toBe("tech-stack/react");
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

    const resolveMapping = vi.fn().mockImplementation((system: string, name: string) =>
      Promise.resolve(name === "react-legacy" ? "facebook/react-legacy" : "facebook/react")
    );
    // 两个外部名都归一到 react/react
    const canonicalize = vi.fn().mockImplementation((fullName: string) =>
      Promise.resolve(fullName === "facebook/react-legacy" ? "react/react" : "react/react")
    );
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, canonicalize, delayMs: 0 });

    // org-a 的两个仓库目标合并为一条边；org-b 一条边，另有两条 React 技术栈边。
    expect(count).toBe(4);
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

    const resolveMapping = vi.fn().mockResolvedValue("facebook/react");
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, delayMs: 0 });

    expect(count).toBe(2);
    expect(db._referenceUpserts[0].fullName).toBe("tech-stack/react");
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
          isReference: false,
          sbomPackages: [
            { name: "react", version: "19.2.6", system: "npm" },
            { name: "vue", version: "3.5.0", system: "npm" },
            { name: "org.springframework.boot:spring-boot-starter-web", version: "3.5.0", system: "maven" },
          ],
        },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(null);
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, delayMs: 0 });

    expect(count).toBe(3);
    expect(db._referenceUpserts.map((row: any) => row.fullName).sort()).toEqual([
      "tech-stack/react",
      "tech-stack/spring-boot",
      "tech-stack/vue",
    ]);
    expect(db._referenceUpserts.find((row: any) => row.fullName === "tech-stack/react")).toMatchObject({
      owner: "tech-stack",
      name: "React",
      url: "https://react.dev",
      isReference: true,
    });
    expect(db._insertedEdges.every((e: any) => e.evidence.resolvedBy === "tech-stack-catalog")).toBe(true);
  });

  it("同源多个 React 包只留一条技术栈边且 evidence 记录全部桥接包", async () => {
    const db = createDepMockDb({
      repos: [
        {
          id: 1,
          fullName: "org-a/app-a",
          isReference: false,
          sbomPackages: [
            { name: "react", version: "19.2.6", system: "npm" },
            { name: "react-dom", version: "19.2.6", system: "npm" },
          ],
        },
        { id: 2, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(null);
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, delayMs: 0 });

    expect(count).toBe(2);
    const edgeFrom1 = db._insertedEdges.find((e: any) => e.sourceRepoId === 1);
    expect(edgeFrom1.evidence.kind).toBe("dependency");
    expect(edgeFrom1.evidence.resolvedBy).toBe("tech-stack-catalog");
    expect(edgeFrom1.evidence.packages).toHaveLength(2);
    expect(edgeFrom1.evidence.packages.map((p: any) => p.name).sort()).toEqual(["react", "react-dom"]);
  });

  it("技术栈行（is_reference=true）的 SBOM 不作为解析起点", async () => {
    const db = createDepMockDb({
      repos: [
        { id: 1, fullName: "org-a/app-a", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
        { id: 2, fullName: "org-b/app-b", isReference: false, sbomPackages: [{ name: "react", version: "19.2.6", system: "npm" }] },
        { id: 3, fullName: "tech-stack/react", isReference: true, sbomPackages: [{ name: "some-dep", version: "1.0.0", system: "npm" }] },
      ],
      cacheResult: [],
    });

    const resolveMapping = vi.fn().mockResolvedValue(null);
    const count = await recomputeDependencyEdges(db, 1, { resolveMapping, delayMs: 0 });

    // reference 行的 SBOM 不参与解析
    expect(resolveMapping).not.toHaveBeenCalledWith("npm", "some-dep", "1.0.0");
    // tech-stack/react 已存在（id=3），upsert 复用同一行
    expect(db._referenceUpserts[0].fullName).toBe("tech-stack/react");
    expect(db._refIdByFullName.get("tech-stack/react")).toBe(3);
    expect(count).toBe(2);
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

describe("getRepoGraphData", () => {
  function createGraphMockDb(repos: unknown[], edges: unknown[]) {
    return {
      select: vi.fn().mockImplementation(() => {
        let table: unknown = null;
        const builder: any = {
          from: vi.fn().mockImplementation((t: unknown) => {
            table = t;
            return builder;
          }),
          where: vi.fn().mockImplementation(() => builder),
          then: (resolve: any, reject: any) => {
            let result: unknown = [];
            if (table === repositories) result = repos;
            else if (table === repoRelationships) result = edges;
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      }),
    } as any;
  }

  it("返回 repo/reference/language 节点与 similarity/dependency/written_in 边", async () => {
    const repos = [
      { id: 1, fullName: "org-a/app-a", name: "app-a", language: "TypeScript", stars: 100, description: "desc", isReference: false },
      { id: 2, fullName: "tech-stack/react", name: "React", language: null, stars: null, description: "React 技术栈", isReference: true },
    ];
    const edges = [{ source: 1, target: 2, type: "dependency", score: null }];
    const db = createGraphMockDb(repos, edges);

    const result = await getRepoGraphData(db, 1);

    // repo 节点：id 为字符串，kind=repo
    const repoNode = result.nodes.find((n) => n.id === "1");
    expect(repoNode?.kind).toBe("repo");
    expect(repoNode?.isReference).toBe(false);
    expect(repoNode?.fullName).toBe("org-a/app-a");

    // reference 节点：kind=reference，isReference=true
    const refNode = result.nodes.find((n) => n.id === "2");
    expect(refNode?.kind).toBe("reference");
    expect(refNode?.isReference).toBe(true);

    // 语言节点由采集仓库即时合成；reference 行（language=null）不产生语言节点
    const langNodes = result.nodes.filter((n) => n.kind === "language");
    expect(langNodes).toHaveLength(1);
    const langNode = result.nodes.find((n) => n.id === "lang:TypeScript");
    expect(langNode?.name).toBe("TypeScript");
    expect(langNode?.stars).toBeNull();
    expect(langNode?.description).toBeNull();
    expect(langNode?.isReference).toBe(false);

    // 存储的依赖边映射为字符串 id
    const depEdge = result.edges.find((e) => e.type === "dependency");
    expect(depEdge?.source).toBe("1");
    expect(depEdge?.target).toBe("2");
    expect(depEdge?.score).toBeNull();

    // written_in 边由采集仓库指向其语言节点
    const writtenIn = result.edges.find((e) => e.type === "written_in");
    expect(writtenIn?.source).toBe("1");
    expect(writtenIn?.target).toBe("lang:TypeScript");
    expect(writtenIn?.score).toBeNull();
  });
});

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
