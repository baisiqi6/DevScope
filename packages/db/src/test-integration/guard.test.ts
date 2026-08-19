import { describe, expect, it } from "vitest";
import { deriveTestDatabaseName, resolveIntegrationGate } from "./guard";

// ============================================================================
// Isolation Contract fail-closed：任一条件不满足即拒绝运行
// ============================================================================

const VALID_BASE = {
  TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
  TEST_DATABASE_DESTRUCTIVE: "1",
  NODE_ENV: "test",
};

describe("resolveIntegrationGate（fail closed）", () => {
  it("缺少 TEST_DATABASE_URL 时返回 not-configured（本地可选、CI 必填由 runner 表达）", () => {
    const gate = resolveIntegrationGate({
      TEST_DATABASE_DESTRUCTIVE: "1",
      NODE_ENV: "test",
    });
    expect(gate.status).toBe("not-configured");
  });

  it("缺少 destructive sentinel 时拒绝", () => {
    const gate = resolveIntegrationGate({
      TEST_DATABASE_URL: VALID_BASE.TEST_DATABASE_URL,
      NODE_ENV: "test",
    });
    expect(gate.status).toBe("rejected");
    if (gate.status === "rejected") {
      expect(gate.reasons.join(" ")).toContain("TEST_DATABASE_DESTRUCTIVE");
    }
  });

  it("NODE_ENV 不是 test 时拒绝", () => {
    const gate = resolveIntegrationGate({
      TEST_DATABASE_URL: VALID_BASE.TEST_DATABASE_URL,
      TEST_DATABASE_DESTRUCTIVE: "1",
      NODE_ENV: "development",
    });
    expect(gate.status).toBe("rejected");
    if (gate.status === "rejected") {
      expect(gate.reasons.join(" ")).toContain("NODE_ENV");
    }
  });

  it("URL 指向开发业务库 devscope 时拒绝", () => {
    const gate = resolveIntegrationGate({
      ...VALID_BASE,
      TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/devscope",
    });
    expect(gate.status).toBe("rejected");
    if (gate.status === "rejected") {
      expect(gate.reasons.join(" ")).toContain("devscope");
    }
  });

  it("URL 指向非 allowlist 库名时拒绝", () => {
    for (const database of ["prod_copy", "template1", "mydb"]) {
      const gate = resolveIntegrationGate({
        ...VALID_BASE,
        TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:5432/${database}`,
      });
      expect(gate.status).toBe("rejected");
    }
  });

  it("URL 缺少库名时拒绝", () => {
    const gate = resolveIntegrationGate({
      ...VALID_BASE,
      TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/",
    });
    expect(gate.status).toBe("rejected");
  });

  it("URL 非法时拒绝而不是抛出", () => {
    const gate = resolveIntegrationGate({
      ...VALID_BASE,
      TEST_DATABASE_URL: "not a url",
    });
    expect(gate.status).toBe("rejected");
  });

  it("合法组合（postgres 仅作 admin 入口）返回 ok 并给出派生库名", () => {
    const gate = resolveIntegrationGate(VALID_BASE);
    expect(gate.status).toBe("ok");
    if (gate.status === "ok") {
      expect(gate.adminDatabase).toBe("postgres");
      expect(gate.testDatabaseName).toMatch(/^devscope_test_[a-z0-9]+$/);
      expect(gate.testDatabaseName).not.toBe("devscope");
    }
  });

  it("显式指向 devscope_test_* 库的 URL 拒绝（测试库名一律 runner 唯一派生）", () => {
    const gate = resolveIntegrationGate({
      ...VALID_BASE,
      TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/devscope_test_manual",
    });
    expect(gate.status).toBe("rejected");
    if (gate.status === "rejected") {
      expect(gate.reasons.join(" ")).toContain("devscope_test_manual");
    }
  });
});

describe("deriveTestDatabaseName", () => {
  it("每次生成唯一且带 devscope_test_ 前缀的库名", () => {
    const names = new Set(Array.from({ length: 50 }, () => deriveTestDatabaseName()));
    expect(names.size).toBe(50);
    for (const name of names) {
      expect(name).toMatch(/^devscope_test_[a-z0-9]{8,}$/);
      expect(name.length).toBeLessThanOrEqual(60);
    }
  });
});
