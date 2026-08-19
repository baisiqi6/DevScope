import { describe, it, expect } from "vitest";
import {
  DEFAULT_EXTERNAL_RESOLUTION_SETTINGS,
  classifyCanonicalizationResponse,
  classifyDepsDevResponse,
  interpretCanonicalizationRow,
  interpretMappingRow,
  mappingRetryAt,
  canonicalizationRetryAt,
  resolveExternalResolutionSettings,
  runBoundedPool,
  ExternalRequestBudget,
  GraphBudgetExceededError,
  GraphRateLimitedError,
} from "./deps-cache";

const NOW = new Date("2026-08-19T00:00:00.000Z");

// ============================================================================
// deps.dev 响应分类
// ============================================================================

describe("classifyDepsDevResponse", () => {
  it("200 + SOURCE_REPO（github.com）→ resolved 并提取 owner/repo", () => {
    const outcome = classifyDepsDevResponse(
      200,
      { relatedProjects: [{ relationType: "SOURCE_REPO", projectKey: { id: "github.com/facebook/react" } }] },
      null,
    );
    expect(outcome.status).toBe("resolved");
    expect(outcome.sourceRepo).toBe("facebook/react");
    expect(outcome.errorSummary).toBeNull();
  });

  it("200 无 SOURCE_REPO → not_found（权威阴性）", () => {
    const outcome = classifyDepsDevResponse(
      200,
      { relatedProjects: [{ relationType: "OTHER", projectKey: { id: "github.com/x/y" } }] },
      null,
    );
    expect(outcome.status).toBe("not_found");
    expect(outcome.sourceRepo).toBeNull();
  });

  it("200 relatedProjects 缺失 → error（schema 漂移不伪造权威阴性；空数组才是明确无映射）", () => {
    const outcome = classifyDepsDevResponse(200, { versionKey: {} }, null);
    expect(outcome.status).toBe("error");
    expect(outcome.errorSummary).toBe("malformed_response");
    // 空数组：权威响应明确无 SOURCE_REPO
    expect(classifyDepsDevResponse(200, { relatedProjects: [] }, null).status).toBe("not_found");
  });

  it("200 SOURCE_REPO 指向非 GitHub → not_found（不可用于 GitHub 图谱）", () => {
    const outcome = classifyDepsDevResponse(
      200,
      { relatedProjects: [{ relationType: "SOURCE_REPO", projectKey: { id: "gitee.com/foo/bar" } }] },
      null,
    );
    expect(outcome.status).toBe("not_found");
  });

  it("200 relatedProjects 非数组 → error（malformed）", () => {
    const outcome = classifyDepsDevResponse(200, { relatedProjects: "oops" }, null);
    expect(outcome.status).toBe("error");
    expect(outcome.errorSummary).toBeTruthy();
  });

  it("404 → not_found（权威阴性）", () => {
    const outcome = classifyDepsDevResponse(404, { message: "not found" }, null);
    expect(outcome.status).toBe("not_found");
  });

  it("429 → error 并保留 Retry-After 秒数", () => {
    const outcome = classifyDepsDevResponse(429, {}, 37);
    expect(outcome.status).toBe("error");
    expect(outcome.retryAfterSeconds).toBe(37);
  });

  it("5xx → error", () => {
    for (const status of [500, 503]) {
      expect(classifyDepsDevResponse(status, {}, null).status).toBe("error");
    }
  });

  it("403 等其他 4xx → error（不是权威阴性）", () => {
    expect(classifyDepsDevResponse(403, {}, null).status).toBe("error");
  });
});

// ============================================================================
// GitHub canonicalization 响应分类
// ============================================================================

describe("classifyCanonicalizationResponse", () => {
  it("200 + full_name → resolved", () => {
    const outcome = classifyCanonicalizationResponse(200, { full_name: "react/react" }, null);
    expect(outcome.status).toBe("resolved");
    expect(outcome.canonicalFullName).toBe("react/react");
  });

  it("200 响应体缺失 full_name → error（malformed）", () => {
    const outcome = classifyCanonicalizationResponse(200, { id: 123 }, null);
    expect(outcome.status).toBe("error");
  });

  it("404 → not_found（仓库已删除/不可见，保持原名）", () => {
    const outcome = classifyCanonicalizationResponse(404, { message: "Not Found" }, null);
    expect(outcome.status).toBe("not_found");
    expect(outcome.canonicalFullName).toBeNull();
  });

  it("429 → error 并保留 Retry-After", () => {
    const outcome = classifyCanonicalizationResponse(429, {}, 120);
    expect(outcome.status).toBe("error");
    expect(outcome.retryAfterSeconds).toBe(120);
  });

  it("5xx/403 → error", () => {
    expect(classifyCanonicalizationResponse(502, {}, null).status).toBe("error");
    expect(classifyCanonicalizationResponse(403, {}, null).status).toBe("error");
  });
});

// ============================================================================
// 缓存行解释：状态 × retry_after
// ============================================================================

describe("interpretMappingRow", () => {
  it("无行 → due（miss，允许外呼）", () => {
    expect(interpretMappingRow(undefined, NOW)).toEqual({ kind: "due" });
  });

  it("resolved 且未到复查点 → hit，使用缓存 sourceRepo", () => {
    const row = {
      resolutionStatus: "resolved" as const,
      sourceRepo: "facebook/react",
      retryAfter: new Date(NOW.getTime() + 60_000),
    };
    expect(interpretMappingRow(row, NOW)).toEqual({ kind: "hit", sourceRepo: "facebook/react" });
  });

  it("resolved 且已到复查点 → due（到期复查）", () => {
    const row = {
      resolutionStatus: "resolved" as const,
      sourceRepo: "facebook/react",
      retryAfter: new Date(NOW.getTime() - 1_000),
    };
    expect(interpretMappingRow(row, NOW)).toEqual({ kind: "due" });
  });

  it("not_found 且未到长 TTL 复查点 → negative，不外呼", () => {
    const row = {
      resolutionStatus: "not_found" as const,
      sourceRepo: null,
      retryAfter: new Date(NOW.getTime() + 60_000),
    };
    expect(interpretMappingRow(row, NOW)).toEqual({ kind: "negative" });
  });

  it("not_found 且已到复查点 → due（允许复查）", () => {
    const row = {
      resolutionStatus: "not_found" as const,
      sourceRepo: null,
      retryAfter: new Date(NOW.getTime() - 1_000),
    };
    expect(interpretMappingRow(row, NOW)).toEqual({ kind: "due" });
  });

  it("error 且未到 retry_after → pending，不外呼、按无映射参与本轮", () => {
    const row = {
      resolutionStatus: "error" as const,
      sourceRepo: null,
      retryAfter: new Date(NOW.getTime() + 60_000),
    };
    expect(interpretMappingRow(row, NOW)).toEqual({ kind: "pending" });
  });

  it("error 且已到 retry_after → due（可重试）", () => {
    const row = {
      resolutionStatus: "error" as const,
      sourceRepo: null,
      retryAfter: new Date(NOW.getTime() - 1_000),
    };
    expect(interpretMappingRow(row, NOW)).toEqual({ kind: "due" });
  });

  it("error 行的 lastResolvedRepo 只是证据，不影响解释结果", () => {
    const row = {
      resolutionStatus: "error" as const,
      sourceRepo: null,
      retryAfter: new Date(NOW.getTime() + 60_000),
      lastResolvedRepo: "facebook/react",
    };
    expect(interpretMappingRow(row, NOW)).toEqual({ kind: "pending" });
  });
});

describe("interpretCanonicalizationRow", () => {
  it("resolved 未到期 → hit，返回 canonical 名", () => {
    const row = {
      resolutionStatus: "resolved" as const,
      canonicalFullName: "react/react",
      retryAfter: new Date(NOW.getTime() + 60_000),
    };
    expect(interpretCanonicalizationRow(row, NOW)).toEqual({
      kind: "hit",
      canonicalFullName: "react/react",
    });
  });

  it("error 未到期 → pending（保持原名，不外呼）", () => {
    const row = {
      resolutionStatus: "error" as const,
      canonicalFullName: "facebook/react",
      retryAfter: new Date(NOW.getTime() + 60_000),
    };
    expect(interpretCanonicalizationRow(row, NOW)).toEqual({ kind: "pending" });
  });

  it("not_found 未到期 → negative", () => {
    const row = {
      resolutionStatus: "not_found" as const,
      canonicalFullName: null,
      retryAfter: new Date(NOW.getTime() + 60_000),
    };
    expect(interpretCanonicalizationRow(row, NOW)).toEqual({ kind: "negative" });
  });

  it("到期（任意状态）→ due", () => {
    for (const resolutionStatus of ["resolved", "not_found", "error"] as const) {
      const row = {
        resolutionStatus,
        canonicalFullName: null,
        retryAfter: new Date(NOW.getTime() - 1),
      };
      expect(interpretCanonicalizationRow(row, NOW)).toEqual({ kind: "due" });
    }
  });

  it("无行 → due", () => {
    expect(interpretCanonicalizationRow(undefined, NOW)).toEqual({ kind: "due" });
  });
});

// ============================================================================
// retry_after 计算
// ============================================================================

describe("mappingRetryAt / canonicalizationRetryAt", () => {
  const settings = DEFAULT_EXTERNAL_RESOLUTION_SETTINGS;

  it("resolved → now + resolvedTtl（长 TTL 复查点）", () => {
    expect(mappingRetryAt("resolved", NOW, settings).getTime())
      .toBe(NOW.getTime() + settings.depsResolvedTtlMs);
  });

  it("not_found → now + notFoundTtl", () => {
    expect(mappingRetryAt("not_found", NOW, settings).getTime())
      .toBe(NOW.getTime() + settings.depsNotFoundTtlMs);
  });

  it("error → now + errorRetry（短退避）", () => {
    expect(mappingRetryAt("error", NOW, settings).getTime())
      .toBe(NOW.getTime() + settings.depsErrorRetryMs);
    expect(settings.depsErrorRetryMs).toBeLessThan(settings.depsNotFoundTtlMs);
  });

  it("canonicalization 使用独立 TTL 配置", () => {
    expect(canonicalizationRetryAt("resolved", NOW, settings).getTime())
      .toBe(NOW.getTime() + settings.canonResolvedTtlMs);
    expect(canonicalizationRetryAt("not_found", NOW, settings).getTime())
      .toBe(NOW.getTime() + settings.canonNotFoundTtlMs);
    expect(canonicalizationRetryAt("error", NOW, settings).getTime())
      .toBe(NOW.getTime() + settings.canonErrorRetryMs);
  });
});

// ============================================================================
// 配置解析：非法配置 fail closed
// ============================================================================

describe("resolveExternalResolutionSettings", () => {
  it("空环境返回合法默认值：预算覆盖日期化冷启动基线并留 headroom", () => {
    const settings = resolveExternalResolutionSettings({});
    expect(settings).toEqual(DEFAULT_EXTERNAL_RESOLUTION_SETTINGS);
    // 冷启动基线：约 6000 deps.dev miss + 3053 canonicalization + SBOM 请求
    expect(settings.depsRequestBudget).toBeGreaterThanOrEqual(7000);
    expect(settings.githubRequestBudget).toBeGreaterThanOrEqual(4000);
    // 保守个位数并发
    expect(settings.depsConcurrency).toBeLessThanOrEqual(8);
    expect(settings.githubConcurrency).toBeLessThanOrEqual(8);
    expect(settings.pacingMs).toBeGreaterThan(0);
    // 超时有界
    expect(settings.depsTimeoutMs).toBeGreaterThanOrEqual(1000);
    expect(settings.depsTimeoutMs).toBeLessThanOrEqual(60000);
  });

  it("接受边界内的合法覆盖", () => {
    const settings = resolveExternalResolutionSettings({
      DEPS_DEV_TIMEOUT_MS: "5000",
      GRAPH_DEPS_CONCURRENCY: "2",
      GRAPH_GITHUB_REQUEST_BUDGET: "9000",
      GRAPH_PACING_MS: "50",
    });
    expect(settings.depsTimeoutMs).toBe(5000);
    expect(settings.depsConcurrency).toBe(2);
    expect(settings.githubRequestBudget).toBe(9000);
    expect(settings.pacingMs).toBe(50);
  });

  it("非法值逐项 fail closed，错误信息包含变量名", () => {
    expect(() => resolveExternalResolutionSettings({ DEPS_DEV_TIMEOUT_MS: "100" }))
      .toThrow(/DEPS_DEV_TIMEOUT_MS/);
    expect(() => resolveExternalResolutionSettings({ DEPS_DEV_TIMEOUT_MS: "70000" }))
      .toThrow(/DEPS_DEV_TIMEOUT_MS/);
    expect(() => resolveExternalResolutionSettings({ DEPS_DEV_TIMEOUT_MS: "abc" }))
      .toThrow(/DEPS_DEV_TIMEOUT_MS/);
    expect(() => resolveExternalResolutionSettings({ GRAPH_DEPS_CONCURRENCY: "0" }))
      .toThrow(/GRAPH_DEPS_CONCURRENCY/);
    expect(() => resolveExternalResolutionSettings({ GRAPH_DEPS_CONCURRENCY: "64" }))
      .toThrow(/GRAPH_DEPS_CONCURRENCY/);
    expect(() => resolveExternalResolutionSettings({ GRAPH_PACING_MS: "-1" }))
      .toThrow(/GRAPH_PACING_MS/);
    expect(() => resolveExternalResolutionSettings({ GRAPH_DEPS_REQUEST_BUDGET: "10" }))
      .toThrow(/GRAPH_DEPS_REQUEST_BUDGET/);
    expect(() => resolveExternalResolutionSettings({ GRAPH_GITHUB_REQUEST_BUDGET: "0" }))
      .toThrow(/GRAPH_GITHUB_REQUEST_BUDGET/);
  });
});

// ============================================================================
// 预算
// ============================================================================

describe("ExternalRequestBudget", () => {
  it("按 provider 独立计数，耗尽后拒绝并抛 GraphBudgetExceededError", () => {
    const settings = { ...DEFAULT_EXTERNAL_RESOLUTION_SETTINGS, depsRequestBudget: 2, githubRequestBudget: 1 };
    const budget = new ExternalRequestBudget(settings);
    expect(budget.tryAcquire("deps.dev")).toBe(true);
    expect(budget.tryAcquire("deps.dev")).toBe(true);
    expect(() => budget.tryAcquire("deps.dev")).toThrow(GraphBudgetExceededError);
    // deps.dev 耗尽不影响 github
    expect(budget.tryAcquire("github")).toBe(true);
    expect(() => budget.tryAcquire("github")).toThrow(GraphBudgetExceededError);
  });

  it("暴露已用与剩余计数，供进度与 receipt 使用", () => {
    const settings = { ...DEFAULT_EXTERNAL_RESOLUTION_SETTINGS, depsRequestBudget: 3 };
    const budget = new ExternalRequestBudget(settings);
    budget.tryAcquire("deps.dev");
    budget.tryAcquire("deps.dev");
    expect(budget.used("deps.dev")).toBe(2);
    expect(budget.remaining("deps.dev")).toBe(1);
  });
});

// ============================================================================
// 有界并发池
// ============================================================================

describe("runBoundedPool", () => {
  it("观测到的最大并发不超过 concurrency", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    await runBoundedPool(items, { concurrency: 3, pacingMs: 0 }, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("所有任务完成，没有永久 pending 的 Promise", async () => {
    const done: number[] = [];
    const items = [1, 2, 3, 4, 5];
    await runBoundedPool(items, { concurrency: 2, pacingMs: 0 }, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      done.push(item);
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("单个任务抛错：停止调度新任务，已启动任务可完成，错误向外传播", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let started = 0;
    let settled = 0;
    await expect(runBoundedPool(items, { concurrency: 2, pacingMs: 0 }, async (item) => {
      started++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      settled++;
      if (item === 0) throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(started).toBeLessThan(items.length);
    expect(settled).toBe(started);
  });

  it("pacing 强制相邻任务开始时间间隔不小于 pacingMs", async () => {
    const starts: number[] = [];
    const items = Array.from({ length: 5 }, (_, i) => i);
    const pacingMs = 15;
    await runBoundedPool(items, { concurrency: 3, pacingMs }, async () => {
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(pacingMs - 5);
    }
  });
});

// ============================================================================
// GraphRateLimitedError 元数据
// ============================================================================

describe("GraphRateLimitedError", () => {
  it("携带 provider 与 retryAfterSeconds 供 receipt 使用", () => {
    const error = new GraphRateLimitedError("github", 42);
    expect(error.provider).toBe("github");
    expect(error.retryAfterSeconds).toBe(42);
  });
});
