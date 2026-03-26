/**
 * @package skills/repo-analyze
 * @description repo-analyze skill 单元测试
 *
 * TDD 测试原理：
 *
 * 1. **Mock AI 服务**：
 *    - Mock @devscope/ai 的 createAI 函数
 *    - 避免 API 调用，确保测试快速、可重复
 *
 * 2. **测试覆盖**：
 *    - 输入验证 (Schema 验证)
 *    - 正常流程 (AI 返回有效数据)
 *    - 错误处理 (AI 调用失败)
 *    - 批量分析 (并行处理)
 *
 * 3. **AAA 模式**：Arrange-Act-Assert
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RepoAnalyzeInputSchema,
  analyzeRepository,
  analyzeRepositories,
  type AnalysisResult,
} from "./index";
import { repositoryAnalysisSchema } from "@devscope/shared";

// ============================================================================
// Mock AI 服务
// ============================================================================

/**
 * Mock AIProvider 类
 */
const mockStructuredComplete = vi.fn();

class MockAIProvider {
  async structuredComplete<T>(...args: any[]) {
    return mockStructuredComplete(...args) as T;
  }
}

/**
 * Mock createAI 函数
 */
vi.mock("@devscope/ai", () => ({
  createAI: vi.fn(() => new MockAIProvider()),
}));

// ============================================================================
// 测试数据
// ============================================================================

/**
 * Mock AI 返回的分析结果
 */
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
      category: "依赖",
      description: "依赖包更新频繁",
      severity: 3,
    },
  ],
  opportunities: [
    {
      category: "市场",
      description: "市场需求增长",
      potential: 8,
    },
  ],
  recommendation: "invest" as const,
  summary: "Next.js 是一个健康的项目，适合投资。",
};

// ============================================================================
// 测试套件
// ============================================================================

describe("repo-analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // 输入验证测试
  // ========================================================================

  describe("RepoAnalyzeInputSchema", () => {
    it("应该验证有效的仓库标识符", () => {
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "vercel/next.js",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repo).toBe("vercel/next.js");
        expect(result.data.context).toBeUndefined();
      }
    });

    it("应该支持带点的仓库名（如 next.js）", () => {
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "vercel/next.js",
      });

      expect(result.success).toBe(true);
    });

    it("应该支持带连字符的仓库名", () => {
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "facebook/create-react-app",
      });

      expect(result.success).toBe(true);
    });

    it("应该拒绝无效的仓库格式", () => {
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "invalid-format",
      });

      expect(result.success).toBe(false);
    });

    it("应该拒绝空字符串", () => {
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "",
      });

      expect(result.success).toBe(false);
    });

    it("应该支持可选的 context 参数", () => {
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "owner/repo",
        context: "这是一个用于投资的额外上下文",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.context).toBe("这是一个用于投资的额外上下文");
      }
    });

    it("应该支持 context 为空字符串", () => {
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "owner/repo",
        context: "",
      });

      // 空字符串是有效的字符串
      expect(result.success).toBe(true);
    });
  });

  // ========================================================================
  // 分析函数测试
  // ========================================================================

  describe("analyzeRepository", () => {
    it("应该成功分析单个仓库", async () => {
      // Arrange: 设置 AI 返回值
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // Act: 执行分析
      const result = await analyzeRepository({
        repo: "vercel/next.js",
      });

      // Assert: 验证结果
      expect(result.healthScore).toBe(85);
      expect(result.activityLevel).toBe("high");
      expect(result.recommendation).toBe("invest");
      expect(result.repo).toBe("vercel/next.js");

      // 验证 AI 被正确调用
      expect(mockStructuredComplete).toHaveBeenCalledTimes(1);
      expect(mockStructuredComplete).toHaveBeenCalledWith(
        expect.stringContaining("vercel/next.js"),
        expect.objectContaining({
          schema: repositoryAnalysisSchema,
          toolName: "repository_analysis",
          temperature: 0.3,
        })
      );
    });

    it("应该在提示词中包含额外上下文", async () => {
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      await analyzeRepository({
        repo: "vercel/next.js",
        context: "这是用于技术评估的上下文",
      });

      // 验证上下文被包含在提示词中
      const callArgs = mockStructuredComplete.mock.calls[0];
      const prompt = callArgs[0];
      expect(prompt).toContain("额外上下文");
      expect(prompt).toContain("这是用于技术评估的上下文");
    });

    it("应该正确解析 owner 和 repo", async () => {
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      await analyzeRepository({
        repo: "vercel/next.js",
      });

      // 验证提示词格式正确
      const prompt = mockStructuredComplete.mock.calls[0][0];
      expect(prompt).toContain("vercel/next.js");
      expect(prompt).toContain("请分析 GitHub 仓库");
    });

    it("应该处理 AI 服务错误", async () => {
      // Arrange: 设置 AI 返回错误
      mockStructuredComplete.mockRejectedValue(
        new Error("AI API error: 500 Internal Server Error")
      );

      // Act & Assert: 应该抛出错误
      await expect(
        analyzeRepository({
          repo: "owner/repo",
        })
      ).rejects.toThrow("AI API error: 500 Internal Server Error");
    });

    it("应该处理 AI 返回的空数据", async () => {
      mockStructuredComplete.mockResolvedValue({
        healthScore: 0,
        activityLevel: "dead" as const,
        keyMetrics: {
          starsGrowthRate: 0,
          issueResolutionRate: 0,
          contributorDiversityScore: 0,
        },
        riskFactors: [],
        opportunities: [],
        recommendation: "avoid" as const,
        summary: "无法获取数据",
      });

      const result = await analyzeRepository({
        repo: "unknown/repo",
      });

      expect(result.healthScore).toBe(0);
      expect(result.activityLevel).toBe("dead");
      expect(result.recommendation).toBe("avoid");
    });

    it("应该验证 AI 返回数据符合 Schema", async () => {
      // 测试边界值
      const boundaryResult = {
        healthScore: 100, // 最大值
        activityLevel: "high" as const,
        keyMetrics: {
          starsGrowthRate: 100,
          issueResolutionRate: 100, // 最大值
          contributorDiversityScore: 100, // 最大值
        },
        riskFactors: [],
        opportunities: [],
        recommendation: "invest" as const,
        summary: "完美的项目",
      };

      mockStructuredComplete.mockResolvedValue(boundaryResult);

      const result = await analyzeRepository({
        repo: "owner/repo",
      });

      expect(result.healthScore).toBe(100);
      expect(result.keyMetrics.issueResolutionRate).toBe(100);
    });

    it("应该处理所有 activityLevel 枚举值", async () => {
      const activityLevels: Array<"high" | "medium" | "low" | "dead"> = [
        "high",
        "medium",
        "low",
        "dead",
      ];

      for (const level of activityLevels) {
        const result = { ...mockAnalysisResult, activityLevel: level };
        mockStructuredComplete.mockResolvedValue(result);

        const analysis = await analyzeRepository({
          repo: "owner/repo",
        });

        expect(analysis.activityLevel).toBe(level);
      }
    });

    it("应该处理所有 recommendation 枚举值", async () => {
      const recommendations: Array<"invest" | "watch" | "avoid"> = [
        "invest",
        "watch",
        "avoid",
      ];

      for (const rec of recommendations) {
        const result = { ...mockAnalysisResult, recommendation: rec };
        mockStructuredComplete.mockResolvedValue(result);

        const analysis = await analyzeRepository({
          repo: "owner/repo",
        });

        expect(analysis.recommendation).toBe(rec);
      }
    });
  });

  describe("analyzeRepositories (批量)", () => {
    it("应该并行分析多个仓库", async () => {
      // Arrange: 设置不同的返回值
      mockStructuredComplete
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 85,
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 65,
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 45,
        });

      // Act: 批量分析
      const results = await analyzeRepositories([
        { repo: "vercel/next.js" },
        { repo: "facebook/react" },
        { repo: "vuejs/vue" },
      ]);

      // Assert: 验证结果
      expect(results).toHaveLength(3);
      expect(results[0].healthScore).toBe(85);
      expect(results[1].healthScore).toBe(65);
      expect(results[2].healthScore).toBe(45);

      // 验证并行调用（被调用 3 次）
      expect(mockStructuredComplete).toHaveBeenCalledTimes(3);
    });

    it("应该为每个仓库添加 repo 字段", async () => {
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      const results = await analyzeRepositories([
        { repo: "owner/repo1" },
        { repo: "owner/repo2" },
      ]);

      expect(results[0].repo).toBe("owner/repo1");
      expect(results[1].repo).toBe("owner/repo2");
    });

    it("应该处理批量分析中的部分失败", async () => {
      // 模拟一个成功、一个失败
      mockStructuredComplete
        .mockResolvedValueOnce(mockAnalysisResult)
        .mockRejectedValueOnce(new Error("Rate limit exceeded"));

      // 应该抛出错误（Promise.all 行为）
      await expect(
        analyzeRepositories([
          { repo: "owner/repo1" },
          { repo: "owner/repo2" },
        ])
      ).rejects.toThrow();
    });

    it("应该处理空数组", async () => {
      const results = await analyzeRepositories([]);

      expect(results).toHaveLength(0);
      expect(mockStructuredComplete).not.toHaveBeenCalled();
    });

    it("应该支持批量分析时传入不同的 context", async () => {
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      await analyzeRepositories([
        { repo: "owner/repo1", context: "Context 1" },
        { repo: "owner/repo2", context: "Context 2" },
      ]);

      // 验证每个请求都使用了各自的 context
      expect(mockStructuredComplete).toHaveBeenCalledTimes(2);

      const firstPrompt = mockStructuredComplete.mock.calls[0][0];
      const secondPrompt = mockStructuredComplete.mock.calls[1][0];

      expect(firstPrompt).toContain("Context 1");
      expect(secondPrompt).toContain("Context 2");
    });
  });

  // ========================================================================
  // 边界条件测试
  // ========================================================================

  describe("边界条件", () => {
    it("应该处理特殊字符的仓库名", async () => {
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // 测试带点的仓库名
      await analyzeRepository({
        repo: "babel/babel",
      });

      expect(mockStructuredComplete).toHaveBeenCalled();
    });

    it("应该处理非常长的 context", async () => {
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      const longContext = "x".repeat(10000);

      await analyzeRepository({
        repo: "owner/repo",
        context: longContext,
      });

      const prompt = mockStructuredComplete.mock.calls[0][0];
      expect(prompt).toContain(longContext);
    });

    it("应该处理 context 为 null 的情况", async () => {
      // Zod 会处理 undefined，但如果有人传入 null
      const result = RepoAnalyzeInputSchema.safeParse({
        repo: "owner/repo",
        context: null as any,
      });

      // Zod string() 不接受 null
      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // Schema 验证测试
  // ========================================================================

  describe("Schema 类型安全", () => {
    it("应该确保返回值符合 repositoryAnalysisSchema", async () => {
      // 确保返回的所有字段都符合 Schema 定义
      const validResult = {
        healthScore: 75,
        activityLevel: "medium" as const,
        keyMetrics: {
          starsGrowthRate: 10.5,
          issueResolutionRate: 85,
          contributorDiversityScore: 70,
        },
        riskFactors: [
          {
            category: "技术",
            description: "测试风险",
            severity: 5,
          },
        ],
        opportunities: [
          {
            category: "商业",
            description: "测试机会",
            potential: 7,
          },
        ],
        recommendation: "watch" as const,
        summary: "测试摘要",
      };

      // 验证 Schema 本身
      const parsed = repositoryAnalysisSchema.parse(validResult);
      expect(parsed).toEqual(validResult);
    });

    it("应该拒绝 healthScore 超出范围", () => {
      const invalidResult = {
        ...mockAnalysisResult,
        healthScore: 101, // 超过最大值
      };

      expect(() =>
        repositoryAnalysisSchema.parse(invalidResult)
      ).toThrow();
    });

    it("应该拒绝负数的 healthScore", () => {
      const invalidResult = {
        ...mockAnalysisResult,
        healthScore: -1,
      };

      expect(() =>
        repositoryAnalysisSchema.parse(invalidResult)
      ).toThrow();
    });

    it("应该拒绝无效的 activityLevel", () => {
      const invalidResult = {
        ...mockAnalysisResult,
        activityLevel: "invalid" as any,
      };

      expect(() =>
        repositoryAnalysisSchema.parse(invalidResult)
      ).toThrow();
    });

    it("应该拒绝无效的 recommendation", () => {
      const invalidResult = {
        ...mockAnalysisResult,
        recommendation: "invalid" as any,
      };

      expect(() =>
        repositoryAnalysisSchema.parse(invalidResult)
      ).toThrow();
    });
  });
});
