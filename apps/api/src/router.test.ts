/**
 * @package @devscope/api
 * @description tRPC 路由单元测试
 *
 * 测试 tRPC 路由的功能，包括：
 * - 健康检查接口
 * - 问候接口
 * - 仓库分析接口（mock AI 服务）
 *
 * @module router.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// ============================================================================
// Mock AI 服务
// ============================================================================

// Mock @devscope/ai 模块
vi.mock("@devscope/ai", () => {
  const mockStructuredComplete = vi.fn();
  const mockComplete = vi.fn();
  const mockEmbed = vi.fn();

  class MockEmbeddingProvider {
    embed = mockEmbed;
  }

  return {
    createAI: vi.fn(() => ({
      structuredComplete: mockStructuredComplete,
      complete: mockComplete,
    })),
    EmbeddingProvider: MockEmbeddingProvider,
    __mockStructuredComplete: mockStructuredComplete,
    __mockComplete: mockComplete,
    __mockEmbed: mockEmbed,
  };
});

// Mock @devscope/db 模块
vi.mock("@devscope/db", () => {
  const mockGetRepositoryByFullName = vi.fn();
  const mockSemanticSearchRepoChunks = vi.fn();

  return {
    createDb: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
    getRepositoryByFullName: mockGetRepositoryByFullName,
    semanticSearchRepoChunks: mockSemanticSearchRepoChunks,
    __mockGetRepositoryByFullName: mockGetRepositoryByFullName,
    __mockSemanticSearchRepoChunks: mockSemanticSearchRepoChunks,
  };
});

// ============================================================================
// 导入被测试的模块和 mock 函数
// ============================================================================

import { appRouter, type AppRouter } from "./router";
import { __mockStructuredComplete as mockStructuredComplete } from "@devscope/ai";
import { __mockComplete as mockComplete, __mockEmbed as mockEmbed } from "@devscope/ai";
import {
  __mockGetRepositoryByFullName as mockGetRepositoryByFullName,
  __mockSemanticSearchRepoChunks as mockSemanticSearchRepoChunks,
} from "@devscope/db";

// ============================================================================
// 测试套件
// ============================================================================

describe("appRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // 健康检查接口测试
  // ========================================================================

  describe("health", () => {
    it("应该返回服务状态", async () => {
      const caller = appRouter.createCaller({});

      const result = await caller.health();

      expect(result).toEqual({
        status: "ok",
        timestamp: expect.any(String),
      });

      // 验证 timestamp 是有效的 ISO 8601 格式
      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });

  // ========================================================================
  // 问候接口测试
  // ========================================================================

  describe("greet", () => {
    it("应该返回问候消息", async () => {
      const caller = appRouter.createCaller({});

      const result = await caller.greet({ name: "Claude" });

      expect(result).toEqual({
        message: "Hello, Claude!",
      });
    });

    it("应该验证输入参数", async () => {
      const caller = appRouter.createCaller({});

      // 缺少 name 参数应该抛出错误
      await expect(caller.greet({} as any)).rejects.toThrow();
    });

    it("应该支持任意字符串作为名字", async () => {
      const caller = appRouter.createCaller({});

      const result1 = await caller.greet({ name: "世界" });
      const result2 = await caller.greet({ name: "123" });
      const result3 = await caller.greet({ name: "test@example.com" });

      expect(result1.message).toBe("Hello, 世界!");
      expect(result2.message).toBe("Hello, 123!");
      expect(result3.message).toBe("Hello, test@example.com!");
    });
  });

  // ========================================================================
  // 仓库分析接口测试
  // ========================================================================

  describe("analyzeRepository", () => {
    it("应该成功分析仓库并返回结构化数据", async () => {
      // Mock AI 服务返回
      const mockAnalysisResult = {
        healthScore: 85,
        activityLevel: "high" as const,
        keyMetrics: {
          starsGrowthRate: 15.5,
          issueResolutionRate: 92,
          contributorDiversityScore: 78,
        },
        riskFactors: [
          {
            category: "技术债",
            description: "部分代码需要重构",
            severity: 5,
          },
        ],
        opportunities: [
          {
            category: "性能优化",
            description: "引入缓存可提升响应速度",
            potential: 8,
          },
        ],
        recommendation: "invest" as const,
        summary: "这是一个健康的项目，值得投资。",
      };

      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      const caller = appRouter.createCaller({});

      const result = await caller.analyzeRepository({
        owner: "vercel",
        repo: "next.js",
      });

      // 验证返回的结构化数据
      expect(result).toEqual(mockAnalysisResult);

      // 验证 AI 服务被正确调用
      expect(mockStructuredComplete).toHaveBeenCalledTimes(1);
      expect(mockStructuredComplete).toHaveBeenCalledWith(
        expect.stringContaining("GitHub 仓库: vercel/next.js"),
        expect.objectContaining({
          schema: expect.any(Object),
          toolName: "repository_analysis",
          temperature: 0.3,
        })
      );
    });

    it("应该在分析结果包含额外上下文时使用它", async () => {
      mockStructuredComplete.mockResolvedValue({
        healthScore: 75,
        activityLevel: "medium" as const,
        keyMetrics: {
          starsGrowthRate: 8.2,
          issueResolutionRate: 85,
          contributorDiversityScore: 65,
        },
        riskFactors: [],
        opportunities: [],
        recommendation: "watch" as const,
        summary: "项目状况良好，建议观望。",
      });

      const caller = appRouter.createCaller({});

      const result = await caller.analyzeRepository({
        owner: "facebook",
        repo: "react",
        context: "这是一个前端框架项目",
      });

      expect(result.healthScore).toBe(75);

      // 验证上下文被包含在提示词中
      expect(mockStructuredComplete).toHaveBeenCalledWith(
        expect.stringContaining("额外上下文:"),
        expect.any(Object)
      );
    });

    it("应该验证输入参数符合 Schema", async () => {
      const caller = appRouter.createCaller({});

      // 缺少必需参数
      await expect(
        caller.analyzeRepository({ owner: "test" } as any)
      ).rejects.toThrow();

      // repo 为空字符串
      await expect(
        caller.analyzeRepository({ owner: "test", repo: "" } as any)
      ).rejects.toThrow();
    });

    it("应该验证输出符合 Schema 约束", async () => {
      // Mock 返回无效数据（healthScore 超出范围）
      mockStructuredComplete.mockResolvedValue({
        healthScore: 150, // 超出 0-100 范围
        activityLevel: "high" as const,
        keyMetrics: {
          starsGrowthRate: 10,
          issueResolutionRate: 90,
          contributorDiversityScore: 80,
        },
        riskFactors: [],
        opportunities: [],
        recommendation: "invest" as const,
        summary: "Test",
      });

      const caller = appRouter.createCaller({});

      // tRPC 的 output 验证应该捕获无效数据
      await expect(
        caller.analyzeRepository({ owner: "test", repo: "repo" })
      ).rejects.toThrow();
    });

    it("应该处理 AI 服务错误", async () => {
      // Mock AI 服务抛出错误
      mockStructuredComplete.mockRejectedValue(
        new Error("AI service unavailable")
      );

      const caller = appRouter.createCaller({});

      await expect(
        caller.analyzeRepository({ owner: "test", repo: "test" })
      ).rejects.toThrow("AI service unavailable");
    });

    it("应该支持不同的仓库组合", async () => {
      const repositories = [
        { owner: "vuejs", repo: "vue" },
        { owner: "sveltejs", repo: "svelte" },
        { owner: "solid-js", repo: "solid" },
      ];

      mockStructuredComplete.mockResolvedValue({
        healthScore: 80,
        activityLevel: "medium" as const,
        keyMetrics: {
          starsGrowthRate: 10,
          issueResolutionRate: 85,
          contributorDiversityScore: 70,
        },
        riskFactors: [],
        opportunities: [],
        recommendation: "watch" as const,
        summary: "OK",
      });

      const caller = appRouter.createCaller({});

      // 测试多个仓库
      for (const repo of repositories) {
        const result = await caller.analyzeRepository(repo);

        expect(result.healthScore).toBe(80);
        expect(mockStructuredComplete).toHaveBeenCalledWith(
          expect.stringContaining(`GitHub 仓库: ${repo.owner}/${repo.repo}`),
          expect.any(Object)
        );
      }

      expect(mockStructuredComplete).toHaveBeenCalledTimes(3);
    });
  });

  // ========================================================================
  // 语义搜索接口测试
  // ========================================================================

  describe("semanticSearch", () => {
    // Mock 数据
    const mockRepository = {
      id: 1,
      fullName: "test/repo",
      name: "repo",
      owner: "test",
      description: "Test repository",
      url: "https://github.com/test/repo",
      stars: 1000,
      forks: 100,
      openIssues: 10,
      language: "TypeScript",
      license: "MIT",
      createdAt: new Date("2020-01-01"),
      updatedAt: new Date("2024-01-01"),
      lastFetchedAt: new Date("2024-01-01"),
    };

    const mockChunks = [
      {
        id: 1,
        repoId: 1,
        content: "Test chunk 1: This explains how to deploy the application.",
        chunkType: "readme" as const,
        sourceId: undefined,
        chunkIndex: 0,
        tokenCount: 10,
        createdAt: new Date("2024-01-01"),
      },
      {
        id: 2,
        repoId: 1,
        content: "Test chunk 2: Configuration options for production.",
        chunkType: "readme" as const,
        sourceId: undefined,
        chunkIndex: 1,
        tokenCount: 8,
        createdAt: new Date("2024-01-01"),
      },
    ];

    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockAnswer = "Based on the documentation, you can deploy using Docker or Vercel.";

    beforeEach(() => {
      // 设置默认 mock 返回值
      mockGetRepositoryByFullName.mockResolvedValue(mockRepository);
      mockSemanticSearchRepoChunks.mockResolvedValue(mockChunks);
      mockEmbed.mockResolvedValue(mockEmbedding);
      mockComplete.mockResolvedValue(mockAnswer);
    });

    it("应该成功执行语义搜索并返回结果", async () => {
      const caller = appRouter.createCaller({});

      const result = await caller.semanticSearch({
        repo: "test/repo",
        query: "How to deploy?",
        limit: 5,
        generateAnswer: true,
      });

      // 验证返回的结构
      expect(result.repository).toEqual({
        id: 1,
        fullName: "test/repo",
        name: "repo",
        owner: "test",
        description: "Test repository",
      });

      expect(result.chunks).toHaveLength(2);
      expect(result.chunks[0].content).toBe(mockChunks[0].content);
      expect(result.answer).toBe(mockAnswer);
      expect(result.duration).toBeGreaterThan(0);

      // 验证函数调用
      expect(mockGetRepositoryByFullName).toHaveBeenCalledWith(
        expect.anything(), // db instance
        "test/repo"
      );
      expect(mockEmbed).toHaveBeenCalledWith("How to deploy?");
      expect(mockSemanticSearchRepoChunks).toHaveBeenCalledWith(
        expect.anything(), // db instance
        1, // repository id
        mockEmbedding,
        5 // limit
      );
      expect(mockComplete).toHaveBeenCalled();
    });

    it("应该在仓库不存在时抛出错误", async () => {
      mockGetRepositoryByFullName.mockResolvedValue(null);

      const caller = appRouter.createCaller({});

      await expect(
        caller.semanticSearch({
          repo: "nonexistent/repo",
          query: "test query",
        })
      ).rejects.toThrow("Repository nonexistent/repo not found");
    });

    it("应该验证仓库名称格式", async () => {
      const caller = appRouter.createCaller({});

      await expect(
        caller.semanticSearch({
          repo: "invalid-format",
          query: "test",
        })
      ).rejects.toThrow("Invalid repository format");
    });

    it("应该验证输入参数", async () => {
      const caller = appRouter.createCaller({});

      // 空 repo
      await expect(
        caller.semanticSearch({ repo: "", query: "test" } as any)
      ).rejects.toThrow();

      // 空 query
      await expect(
        caller.semanticSearch({ repo: "test/repo", query: "" } as any)
      ).rejects.toThrow();

      // limit 超出范围
      await expect(
        caller.semanticSearch({ repo: "test/repo", query: "test", limit: 50 } as any)
      ).rejects.toThrow();
    });

    it("应该支持禁用 AI 回答生成", async () => {
      const caller = appRouter.createCaller({});

      const result = await caller.semanticSearch({
        repo: "test/repo",
        query: "test query",
        limit: 3,
        generateAnswer: false,
      });

      expect(result.chunks).toHaveLength(2);
      expect(result.answer).toBeUndefined();
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("应该处理空搜索结果", async () => {
      mockSemanticSearchRepoChunks.mockResolvedValue([]);

      const caller = appRouter.createCaller({});

      const result = await caller.semanticSearch({
        repo: "test/repo",
        query: "test query",
        generateAnswer: false,
      });

      expect(result.chunks).toHaveLength(0);
      expect(result.answer).toBeUndefined();
    });

    it("应该在生成 AI 回答时跳过空结果", async () => {
      mockSemanticSearchRepoChunks.mockResolvedValue([]);

      const caller = appRouter.createCaller({});

      const result = await caller.semanticSearch({
        repo: "test/repo",
        query: "test query",
        generateAnswer: true,
      });

      expect(result.chunks).toHaveLength(0);
      expect(result.answer).toBeUndefined();
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("应该验证输出 Schema 约束", async () => {
      // 注意：tRPC 的输出验证会在运行时验证，如果 mock 返回无效的 chunkType
      // tRPC 会抛出 ZodError。这里我们只验证有效数据的情况。

      const caller = appRouter.createCaller({});

      const result = await caller.semanticSearch({
        repo: "test/repo",
        query: "test",
        generateAnswer: false,
      });

      // 验证返回值符合 Schema 结构
      expect(result).toHaveProperty("repository");
      expect(result).toHaveProperty("chunks");
      expect(result).toHaveProperty("duration");
      expect(Array.isArray(result.chunks)).toBe(true);
    });

    it("应该返回正确的耗时统计", async () => {
      const caller = appRouter.createCaller({});

      const result = await caller.semanticSearch({
        repo: "test/repo",
        query: "test query",
        limit: 5,
      });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeLessThan(10000); // 应该在 10 秒内完成
    });

    it("应该支持自定义返回结果数量", async () => {
      const caller = appRouter.createCaller({});

      await caller.semanticSearch({
        repo: "test/repo",
        query: "test query",
        limit: 10,
      });

      expect(mockSemanticSearchRepoChunks).toHaveBeenCalledWith(
        expect.anything(),
        1,
        mockEmbedding,
        10 // 传入的 limit
      );
    });
  });

  // ========================================================================
  // Schema 验证测试
  // ========================================================================

  describe("Schema 验证", () => {
    it("应该正确验证所有必需字段", async () => {
      const caller = appRouter.createCaller({});

      // 测试 healthScore 边界值
      const testCases = [
        { healthScore: 0, shouldPass: true },
        { healthScore: 50, shouldPass: true },
        { healthScore: 100, shouldPass: true },
        { healthScore: -1, shouldPass: false },
        { healthScore: 101, shouldPass: false },
      ];

      for (const testCase of testCases) {
        mockStructuredComplete.mockResolvedValue({
          ...testCase,
          activityLevel: "medium" as const,
          keyMetrics: {
            starsGrowthRate: 10,
            issueResolutionRate: 85,
            contributorDiversityScore: 70,
          },
          riskFactors: [],
          opportunities: [],
          recommendation: "watch" as const,
          summary: "Test",
        });

        if (testCase.shouldPass) {
          const result = await caller.analyzeRepository({
            owner: "test",
            repo: "test",
          });
          expect(result.healthScore).toBe(testCase.healthScore);
        } else {
          await expect(
            caller.analyzeRepository({ owner: "test", repo: "test" })
          ).rejects.toThrow();
        }
      }
    });

    it("应该验证 activityLevel 枚举值", async () => {
      const validLevels = ["high", "medium", "low", "dead"] as const;
      const invalidLevel = "invalid" as const;

      // 测试有效值
      for (const level of validLevels) {
        mockStructuredComplete.mockResolvedValue({
          healthScore: 75,
          activityLevel: level,
          keyMetrics: {
            starsGrowthRate: 10,
            issueResolutionRate: 85,
            contributorDiversityScore: 70,
          },
          riskFactors: [],
          opportunities: [],
          recommendation: "watch" as const,
          summary: "Test",
        });

        const caller = appRouter.createCaller({});
        const result = await caller.analyzeRepository({
          owner: "test",
          repo: "test",
        });
        expect(result.activityLevel).toBe(level);
      }

      // 测试无效值（需要在 AI 返回后被 Zod 验证拒绝）
      mockStructuredComplete.mockResolvedValue({
        healthScore: 75,
        activityLevel: invalidLevel as any,
        keyMetrics: {
          starsGrowthRate: 10,
          issueResolutionRate: 85,
          contributorDiversityScore: 70,
        },
        riskFactors: [],
        opportunities: [],
        recommendation: "watch" as const,
        summary: "Test",
      });

      const caller = appRouter.createCaller({});
      await expect(
        caller.analyzeRepository({ owner: "test", repo: "test" })
      ).rejects.toThrow();
    });

    it("应该验证 keyMetrics 字段约束", async () => {
      // 测试 issueResolutionRate 边界
      const testCases = [
        { rate: 0, shouldPass: true },
        { rate: 50, shouldPass: true },
        { rate: 100, shouldPass: true },
        { rate: -1, shouldPass: false },
        { rate: 101, shouldPass: false },
      ];

      for (const testCase of testCases) {
        mockStructuredComplete.mockResolvedValue({
          healthScore: 75,
          activityLevel: "medium" as const,
          keyMetrics: {
            starsGrowthRate: 10,
            issueResolutionRate: testCase.rate,
            contributorDiversityScore: 70,
          },
          riskFactors: [],
          opportunities: [],
          recommendation: "watch" as const,
          summary: "Test",
        });

        const caller = appRouter.createCaller({});

        if (testCase.shouldPass) {
          const result = await caller.analyzeRepository({
            owner: "test",
            repo: "test",
          });
          expect(result.keyMetrics.issueResolutionRate).toBe(testCase.rate);
        } else {
          await expect(
            caller.analyzeRepository({ owner: "test", repo: "test" })
          ).rejects.toThrow();
        }
      }
    });

    it("应该验证 riskFactors 数组约束", async () => {
      // 测试 severity 边界值
      mockStructuredComplete.mockResolvedValue({
        healthScore: 75,
        activityLevel: "medium" as const,
        keyMetrics: {
          starsGrowthRate: 10,
          issueResolutionRate: 85,
          contributorDiversityScore: 70,
        },
        riskFactors: [
          {
            category: "测试",
            description: "描述",
            severity: 1, // 最小值
          },
          {
            category: "测试",
            description: "描述",
            severity: 10, // 最大值
          },
        ],
        opportunities: [],
        recommendation: "watch" as const,
        summary: "Test",
      });

      const caller = appRouter.createCaller({});
      const result = await caller.analyzeRepository({
        owner: "test",
        repo: "test",
      });

      expect(result.riskFactors).toHaveLength(2);
      expect(result.riskFactors[0].severity).toBe(1);
      expect(result.riskFactors[1].severity).toBe(10);
    });

    it("应该验证 recommendation 枚举值", async () => {
      const validRecommendations = ["invest", "watch", "avoid"] as const;

      for (const rec of validRecommendations) {
        mockStructuredComplete.mockResolvedValue({
          healthScore: 75,
          activityLevel: "medium" as const,
          keyMetrics: {
            starsGrowthRate: 10,
            issueResolutionRate: 85,
            contributorDiversityScore: 70,
          },
          riskFactors: [],
          opportunities: [],
          recommendation: rec,
          summary: "Test",
        });

        const caller = appRouter.createCaller({});
        const result = await caller.analyzeRepository({
          owner: "test",
          repo: "test",
        });
        expect(result.recommendation).toBe(rec);
      }
    });
  });
});

// ============================================================================
// 类型测试
// ============================================================================

describe("AppRouter 类型", () => {
  it("应该正确导出 AppRouter 类型", () => {
    // 这是一个编译时类型检查
    type AppRouterType = AppRouter;

    // 验证类型包含我们期望的路由
    const _routerShape: AppRouterType = {
      health: expect.any(Function),
      greet: expect.any(Function),
      analyzeRepository: expect.any(Function),
      semanticSearch: expect.any(Function),
    };
  });
});
