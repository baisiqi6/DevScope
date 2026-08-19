import { describe, expect, it } from "vitest";
import {
  assertTechnologyStackStorageModeSupported,
  compareTechnologyStackProjectionRows,
  parseLegacyTechnologyStackEvidence,
  parseTechnologyStackStorageMode,
  sameTechnologyStackPackages,
} from "./technology-stack-entities";

describe("legacy technology stack evidence", () => {
  it("严格接受并规范排序 canonical package triples", () => {
    expect(parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [
        { system: "npm", name: "react-dom", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
      ],
    })).toEqual({
      rawCount: 3,
      packages: [
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react-dom", version: "19.0.0" },
      ],
    });
  });

  it("拒绝缺字段 package、错误 kind 与错误 resolver，不能过滤后伪装成功", () => {
    expect(() => parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [{ system: "npm", name: "react" }],
    })).toThrow();
    expect(() => parseLegacyTechnologyStackEvidence({
      kind: "similarity",
      resolvedBy: "tech-stack-catalog",
      packages: [],
    })).toThrow();
    expect(() => parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "deps.dev",
      packages: [],
    })).toThrow();
  });

  it("跨用户副本只按 canonical triples 比较，不受顺序和重复影响", () => {
    const left = parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react-dom", version: "19.0.0" },
      ],
    }).packages;
    const reordered = parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [
        { system: "npm", name: "react-dom", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
      ],
    }).packages;
    const divergent = parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [{ system: "npm", name: "react", version: "18.3.1" }],
    }).packages;

    expect(sameTechnologyStackPackages(left, reordered)).toBe(true);
    expect(sameTechnologyStackPackages(left, divergent)).toBe(false);
  });
});

describe("technology stack rollout contract", () => {
  it("未知 mode 与尚未实现的 cutover mode 均 fail closed", () => {
    expect(() => parseTechnologyStackStorageMode("typo")).toThrow();
    expect(() => assertTechnologyStackStorageModeSupported(
      parseTechnologyStackStorageMode("new_read_dual_write"),
      ["legacy_shadow_dual_write"],
    )).toThrow("当前 revision 不支持");
    expect(parseTechnologyStackStorageMode(undefined)).toBe("legacy_shadow_dual_write");
  });

  it("shadow comparison 忽略 package 顺序，但报告真实差异", () => {
    const legacy = [{
      githubRepositoryId: "100",
      slug: "react",
      stackName: "React",
      packages: [
        { system: "npm", name: "react-dom", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
      ],
    }];
    const reordered = [{
      ...legacy[0],
      packages: [...legacy[0].packages].reverse(),
    }];
    expect(compareTechnologyStackProjectionRows(legacy, reordered)).toMatchObject({
      equal: true,
      legacyCount: 1,
      newCount: 1,
    });

    const divergent = [{
      ...legacy[0],
      packages: [{ system: "npm", name: "react", version: "18.3.1" }],
    }];
    expect(compareTechnologyStackProjectionRows(legacy, divergent)).toMatchObject({
      equal: false,
      legacyCount: 1,
      newCount: 1,
    });
  });
});

// ============================================================================
// Phase B：启动一致性检查
// ============================================================================

describe("assertStorageModeStartupConsistency", () => {
  function mockDb(opts: {
    stacksExists?: boolean;
    legacyRefs?: number;
    newRelations?: number;
    columnExists?: boolean;
  }) {
    const results = [
      { rows: [{ col_exists: opts.columnExists ?? true }] },
      { rows: [{ stacks_exists: opts.stacksExists ?? true, relations_exists: opts.stacksExists ?? true }] },
      { rows: [{ legacy_stack_refs: String(opts.legacyRefs ?? 0), new_relations: String(opts.newRelations ?? 0) }] },
    ];
    let call = 0;
    return {
      execute: vi.fn().mockImplementation(async () => results[call++]),
    } as any;
  }

  it("新表缺失时拒绝启动（迁移未应用）", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ stacksExists: false }), "new_read_dual_write"),
    ).rejects.toThrow(/0008 未应用/);
    await expect(
      assertStorageModeStartupConsistency(mockDb({ stacksExists: false }), "legacy_shadow_dual_write"),
    ).rejects.toThrow(/0008 未应用/);
  });

  it("cleaned+legacy 组合拒绝启动（回退窗口不存在）", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ legacyRefs: 0, newRelations: 79 }), "legacy_shadow_dual_write"),
    ).rejects.toThrow(/cleaned\+legacy/);
  });

  it("new_read 但新表未回填而 legacy 有数据时拒绝启动", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ legacyRefs: 79, newRelations: 0 }), "new_read_dual_write"),
    ).rejects.toThrow(/未回填/);
  });

  it("空库首次部署（两 count 皆 0）两 mode 都放行", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ legacyRefs: 0, newRelations: 0 }), "legacy_shadow_dual_write"),
    ).resolves.toBeUndefined();
    await expect(
      assertStorageModeStartupConsistency(mockDb({ legacyRefs: 0, newRelations: 0 }), "new_read_dual_write"),
    ).resolves.toBeUndefined();
  });

  it("正常双写状态（两侧都有数据）放行", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ legacyRefs: 13, newRelations: 79 }), "new_read_dual_write"),
    ).resolves.toBeUndefined();
  });

  it("new_only 走完整检查链（列在+表在+计数）", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    const db = mockDb({ legacyRefs: 13, newRelations: 79 });
    await expect(
      assertStorageModeStartupConsistency(db, "new_only"),
    ).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it("marker 矩阵：列不存在时仅 legacy_cleaned 放行，其余 mode fail", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ columnExists: false }), "legacy_cleaned"),
    ).resolves.toBeUndefined();
    for (const mode of ["legacy_shadow_dual_write", "new_read_dual_write", "new_only"] as const) {
      await expect(
        assertStorageModeStartupConsistency(mockDb({ columnExists: false }), mode),
      ).rejects.toThrow(/legacy_cleaned/);
    }
  });

  it("marker 矩阵：列存在但 mode=legacy_cleaned 时 fail", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ columnExists: true }), "legacy_cleaned"),
    ).rejects.toThrow(/未执行 cleanup/);
  });
});
