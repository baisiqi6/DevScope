import { describe, expect, it, vi } from "vitest";
import {
  assertTechnologyStackStorageModeSupported,
  parseTechnologyStackStorageMode,
} from "./technology-stack-entities";

describe("technology stack rollout contract", () => {
  it("未知 mode 与尚未实现的 cutover mode 均 fail closed", () => {
    expect(() => parseTechnologyStackStorageMode("typo")).toThrow();
    expect(() => assertTechnologyStackStorageModeSupported(
      parseTechnologyStackStorageMode("new_read_dual_write"),
      ["legacy_shadow_dual_write"],
    )).toThrow("当前 revision 不支持");
    expect(parseTechnologyStackStorageMode(undefined)).toBe("legacy_shadow_dual_write");
  });
});

// ============================================================================
// Phase B/C：启动一致性检查与 marker 矩阵
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

  it("marker 矩阵：列存在但 legacy 伪数据仍在时 legacy_cleaned fail", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    await expect(
      assertStorageModeStartupConsistency(mockDb({ columnExists: true, legacyRefs: 13 }), "legacy_cleaned"),
    ).rejects.toThrow(/未执行 cleanup/);
  });

  it("marker 矩阵：列存在但伪数据为 0 时 legacy_cleaned 放行（补删窗口与 fresh 重放库）", async () => {
    const { assertStorageModeStartupConsistency } = await import("./technology-stack-entities");
    // cleanup 删除事务已提交但 DROP COLUMN 前崩溃，或从未存在 legacy 表示的
    // fresh 重放库：不存在需要守护的冻结形态（implementation review P1-2）
    await expect(
      assertStorageModeStartupConsistency(mockDb({ columnExists: true, legacyRefs: 0 }), "legacy_cleaned"),
    ).resolves.toBeUndefined();
  });
});
