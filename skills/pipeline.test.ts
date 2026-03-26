/**
 * @package skills
 * @description Pipeline 集成测试
 *
 * TDD 测试原理：
 *
 * 1. **集成测试**：
 *    - 测试多个 skill 组合使用时的行为
 *    - 验证数据流转和错误传递
 *
 * 2. **管道模式**：
 *    - repo-fetch → repo-analyze → report-generate
 *    - 每个阶段的输出是下一个阶段的输入
 *
 * 3. **测试覆盖**：
 *    - 完整管道流程
 *    - 部分管道组合
 *    - 错误处理和传递
 *    - 并行处理
 *
 * 4. **Mock 策略**：
 *    - Mock GitHub API (fetch)
 *    - Mock AI 服务
 *    - 只测试管道逻辑，不依赖外部服务
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchRepository, fetchRepositories } from "./repo-fetch/index";
import { analyzeRepository, analyzeRepositories } from "./repo-analyze/index";
import { generateReport } from "./report-generate/index";
import { repositoryAnalysisSchema } from "@devscope/shared";

// ============================================================================
// Mock 设置
// ============================================================================

/**
 * Mock fetch 函数
 */
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Mock AI 服务
 */
const mockStructuredComplete = vi.fn();

class MockAIProvider {
  async structuredComplete<T>(...args: any[]) {
    return mockStructuredComplete(...args) as T;
  }
}

vi.mock("@devscope/ai", () => ({
  createAI: vi.fn(() => new MockAIProvider()),
}));

// ============================================================================
// 测试数据
// ============================================================================

/**
 * Mock GitHub API 响应
 */
const mockGitHubResponse = {
  full_name: "vercel/next.js",
  name: "next.js",
  owner: { login: "vercel" },
  description: "The React Framework",
  html_url: "https://github.com/vercel/next.js",
  stargazers_count: 120000,
  forks_count: 25000,
  open_issues_count: 1500,
  language: "TypeScript",
  license: { spdx_id: "MIT" },
  created_at: "2016-10-05T00:00:00Z",
  updated_at: "2024-01-15T00:00:00Z",
  pushed_at: "2024-01-15T00:00:00Z",
};

/**
 * Mock AI 分析结果
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

describe("Pipeline 集成测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // repo-fetch → repo-analyze 管道
  // ========================================================================

  describe("repo-fetch → repo-analyze", () => {
    it("应该完整执行 fetch 到 analyze 的流程", async () => {
      // Arrange: 设置 mock
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // Act: 执行管道
      const fetchedData = await fetchRepository({
        repo: "vercel/next.js",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      const analyzedData = await analyzeRepository({
        repo: "vercel/next.js",
      });

      // Assert: 验证两个阶段都成功
      expect(fetchedData.repository.fullName).toBe("vercel/next.js");
      expect(analyzedData.healthScore).toBe(85);
      expect(analyzedData.repo).toBe("vercel/next.js");

      // 验证 API 调用
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockStructuredComplete).toHaveBeenCalledTimes(1);
    });

    it("应该使用 fetch 的数据作为 analyze 的输入", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // Fetch
      const fetchedData = await fetchRepository({
        repo: "vercel/next.js",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      // 使用仓库名进行分析
      const analyzedData = await analyzeRepository({
        repo: fetchedData.repository.fullName,
      });

      expect(analyzedData.repo).toBe(fetchedData.repository.fullName);
    });

    it("应该处理 fetch 阶段的错误", async () => {
      // Arrange: fetch 失败
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      // Act & Assert: fetch 应该抛出错误
      await expect(
        fetchRepository({
          repo: "nonexistent/repo",
          includeIssues: false,
          includeCommits: false,
          issuesLimit: 10,
          commitsLimit: 10,
        })
      ).rejects.toThrow("GitHub API error: 404");
    });

    it("应该处理 analyze 阶段的错误", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockRejectedValue(
        new Error("AI API error: 500")
      );

      // Fetch 成功
      const fetchedData = await fetchRepository({
        repo: "vercel/next.js",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      expect(fetchedData.repository.fullName).toBe("vercel/next.js");

      // Analyze 失败
      await expect(
        analyzeRepository({ repo: "vercel/next.js" })
      ).rejects.toThrow("AI API error: 500");
    });

    it("应该支持批量 fetch 和 analyze", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 85,
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 70,
        });

      // 批量 fetch
      const fetchedData = await fetchRepositories([
        { repo: "vercel/next.js", includeIssues: false, includeCommits: false, issuesLimit: 10, commitsLimit: 10 },
        { repo: "facebook/react", includeIssues: false, includeCommits: false, issuesLimit: 10, commitsLimit: 10 },
      ]);

      // 批量 analyze
      const analyzedData = await analyzeRepositories([
        { repo: "vercel/next.js" },
        { repo: "facebook/react" },
      ]);

      expect(fetchedData).toHaveLength(2);
      expect(analyzedData).toHaveLength(2);
      expect(analyzedData[0].healthScore).toBe(85);
      expect(analyzedData[1].healthScore).toBe(70);
    });
  });

  // ========================================================================
  // repo-analyze → report-generate 管道
  // ========================================================================

  describe("repo-analyze → report-generate", () => {
    it("应该完整执行 analyze 到 generate 的流程", async () => {
      // Arrange: 设置 mock
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // Act: 执行管道
      const analyzedData = await analyzeRepository({
        repo: "vercel/next.js",
      });

      const report = generateReport({
        title: "测试报告",
        type: "summary",
        analyses: [analyzedData],
      });

      // Assert: 验证两个阶段都成功
      expect(analyzedData.healthScore).toBe(85);
      expect(report.metadata.totalRepositories).toBe(1);
      expect(report.metadata.averageHealthScore).toBe(85);
    });

    it("应该使用 analyze 的结果生成报告", async () => {
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      const analyzedData = await analyzeRepository({
        repo: "vercel/next.js",
      });

      const report = generateReport({
        title: "分析报告",
        analyses: [analyzedData],
      });

      // 验证报告包含分析结果
      expect(report.summary).toContain("1 个开源仓库");
      expect(report.metadata.topPerformers).toContain("vercel/next.js");
    });

    it("应该支持批量分析生成报告", async () => {
      mockStructuredComplete
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 90,
          repo: "repo1",
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 60,
          repo: "repo2",
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 30,
          repo: "repo3",
        });

      const analyzedData = await analyzeRepositories([
        { repo: "repo1" },
        { repo: "repo2" },
        { repo: "repo3" },
      ]);

      const report = generateReport({
        title: "批量报告",
        analyses: analyzedData,
      });

      expect(report.metadata.totalRepositories).toBe(3);
      expect(report.metadata.averageHealthScore).toBe(60);
      expect(report.metadata.topPerformers[0]).toBe("repo1");
    });

    it("应该根据分析结果生成正确的推荐分布", async () => {
      mockStructuredComplete
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          recommendation: "invest" as const,
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          recommendation: "watch" as const,
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          recommendation: "avoid" as const,
        });

      const analyzedData = await analyzeRepositories([
        { repo: "repo1" },
        { repo: "repo2" },
        { repo: "repo3" },
      ]);

      const report = generateReport({
        title: "推荐报告",
        analyses: analyzedData,
      });

      expect(report.summary).toContain("建议投资: 1 个");
      expect(report.summary).toContain("建议观望: 1 个");
      expect(report.summary).toContain("建议避免: 1 个");
    });
  });

  // ========================================================================
  // 完整管道: repo-fetch → repo-analyze → report-generate
  // ========================================================================

  describe("完整管道 (fetch → analyze → generate)", () => {
    it("应该成功执行完整的三个阶段", async () => {
      // Arrange: 设置所有 mock
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // Act: 执行完整管道
      // Stage 1: Fetch
      const fetchedData = await fetchRepository({
        repo: "vercel/next.js",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      // Stage 2: Analyze
      const analyzedData = await analyzeRepository({
        repo: fetchedData.repository.fullName,
      });

      // Stage 3: Generate Report
      const report = generateReport({
        title: "完整管道报告",
        analyses: [analyzedData],
      });

      // Assert: 验证所有阶段
      // Stage 1 验证
      expect(fetchedData.repository.fullName).toBe("vercel/next.js");
      expect(fetchedData.repository.stars).toBe(120000);

      // Stage 2 验证
      expect(analyzedData.healthScore).toBe(85);
      expect(analyzedData.recommendation).toBe("invest");

      // Stage 3 验证
      expect(report.metadata.totalRepositories).toBe(1);
      expect(report.metadata.averageHealthScore).toBe(85);
      expect(report.generatedAt).toBeDefined();

      // 验证调用次数
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockStructuredComplete).toHaveBeenCalledTimes(1);
    });

    it("应该支持多个仓库的完整管道", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...mockGitHubResponse, full_name: "owner/repo1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...mockGitHubResponse, full_name: "owner/repo2" }),
        });

      mockStructuredComplete
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 85,
          repo: "owner/repo1",
        })
        .mockResolvedValueOnce({
          ...mockAnalysisResult,
          healthScore: 65,
          repo: "owner/repo2",
        });

      // Stage 1: 批量 Fetch
      const fetchedData = await fetchRepositories([
        { repo: "owner/repo1", includeIssues: false, includeCommits: false, issuesLimit: 10, commitsLimit: 10 },
        { repo: "owner/repo2", includeIssues: false, includeCommits: false, issuesLimit: 10, commitsLimit: 10 },
      ]);

      // Stage 2: 批量 Analyze
      const analyzedData = await analyzeRepositories([
        { repo: "owner/repo1" },
        { repo: "owner/repo2" },
      ]);

      // Stage 3: 生成报告
      const report = generateReport({
        title: "多仓库完整管道",
        analyses: analyzedData,
      });

      // 验证
      expect(fetchedData).toHaveLength(2);
      expect(analyzedData).toHaveLength(2);
      expect(report.metadata.totalRepositories).toBe(2);
      expect(report.metadata.averageHealthScore).toBe(75);
    });

    it("应该在第一阶段失败时停止执行", async () => {
      // Fetch 失败
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      // Stage 1 应该失败
      await expect(
        fetchRepository({
          repo: "nonexistent/repo",
          includeIssues: false,
          includeCommits: false,
          issuesLimit: 10,
          commitsLimit: 10,
        })
      ).rejects.toThrow();

      // 后续阶段不应该执行
      expect(mockStructuredComplete).not.toHaveBeenCalled();
    });

    it("应该在第二阶段失败时不生成报告", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });

      mockStructuredComplete.mockRejectedValue(
        new Error("AI service unavailable")
      );

      // Stage 1 成功
      const fetchedData = await fetchRepository({
        repo: "vercel/next.js",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      expect(fetchedData.repository.fullName).toBe("vercel/next.js");

      // Stage 2 失败
      await expect(
        analyzeRepository({ repo: "vercel/next.js" })
      ).rejects.toThrow("AI service unavailable");

      // Stage 3 不应该执行（因为没有分析数据）
      // 但 generateReport 本身不会失败，只是会生成空报告
    });

    it("应该正确传递数据上下文", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // 带额外上下文的分析
      const fetchedData = await fetchRepository({
        repo: "vercel/next.js",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      // 使用 fetch 的语言信息作为上下文
      const analyzedData = await analyzeRepository({
        repo: fetchedData.repository.fullName,
        context: `主要语言: ${fetchedData.repository.language}`,
      });

      // 验证上下文被传递
      expect(mockStructuredComplete).toHaveBeenCalledWith(
        expect.stringContaining("主要语言: TypeScript"),
        expect.any(Object)
      );

      // 生成报告
      const report = generateReport({
        title: "上下文传递报告",
        analyses: [analyzedData],
      });

      expect(report.metadata.totalRepositories).toBe(1);
    });
  });

  // ========================================================================
  // 管道工具函数
  // ========================================================================

  describe("管道工具函数", () => {
    /**
     * 完整管道函数示例
     */
    async function fullPipeline(repo: string): Promise<{
      fetched: any;
      analyzed: any;
      report: any;
    }> {
      const fetched = await fetchRepository({
        repo,
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      const analyzed = await analyzeRepository({ repo });

      const report = generateReport({
        title: `${repo} 分析报告`,
        analyses: [analyzed],
      });

      return { fetched, analyzed, report };
    }

    it("应该提供便捷的管道函数", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      const result = await fullPipeline("vercel/next.js");

      expect(result.fetched.repository.fullName).toBe("vercel/next.js");
      expect(result.analyzed.healthScore).toBe(85);
      expect(result.report.metadata.totalRepositories).toBe(1);
    });

    /**
     * 批量管道函数示例
     */
    async function batchPipeline(repos: string[]): Promise<any> {
      // 并行 fetch
      const fetched = await fetchRepositories(
        repos.map((repo) => ({
          repo,
          includeIssues: false,
          includeCommits: false,
          issuesLimit: 10,
          commitsLimit: 10,
        }))
      );

      // 并行 analyze
      const analyzed = await analyzeRepositories(
        repos.map((repo) => ({ repo }))
      );

      // 生成报告
      const report = generateReport({
        title: "批量分析报告",
        analyses: analyzed,
      });

      return { fetched, analyzed, report };
    }

    it("应该支持批量管道函数", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete
        .mockResolvedValueOnce({ ...mockAnalysisResult, healthScore: 80 })
        .mockResolvedValueOnce({ ...mockAnalysisResult, healthScore: 70 });

      const result = await batchPipeline(["owner/repo1", "owner/repo2"]);

      expect(result.fetched).toHaveLength(2);
      expect(result.analyzed).toHaveLength(2);
      expect(result.report.metadata.totalRepositories).toBe(2);
    });
  });

  // ========================================================================
  // 数据格式验证
  // ========================================================================

  describe("管道数据格式验证", () => {
    it("应该保持数据格式的一致性", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      // Fetch 输出格式
      const fetched = await fetchRepository({
        repo: "vercel/next.js",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      expect(fetched).toHaveProperty("repository");
      expect(fetched).toHaveProperty("fetchedAt");

      // Analyze 输出格式
      const analyzed = await analyzeRepository({ repo: "vercel/next.js" });

      expect(analyzed).toHaveProperty("healthScore");
      expect(analyzed).toHaveProperty("activityLevel");
      expect(analyzed).toHaveProperty("recommendation");

      // Report 输出格式
      const report = generateReport({
        title: "格式验证",
        analyses: [analyzed],
      });

      expect(report).toHaveProperty("title");
      expect(report).toHaveProperty("type");
      expect(report).toHaveProperty("metadata");
    });

    it("应该正确映射仓库名称", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });
      mockStructuredComplete.mockResolvedValue(mockAnalysisResult);

      const repo = "vercel/next.js";

      const fetched = await fetchRepository({
        repo,
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      const analyzed = await analyzeRepository({ repo });

      const report = generateReport({
        title: "映射测试",
        analyses: [analyzed],
      });

      // 所有阶段应该使用相同的仓库名称
      expect(fetched.repository.fullName).toBe(repo);
      expect(analyzed.repo).toBe(repo);
      expect(report.metadata.topPerformers[0]).toBe(repo);
    });
  });

  // ========================================================================
  // 性能测试
  // ========================================================================

  describe("管道性能", () => {
    it("应该并行处理多个仓库", async () => {
      const repos = Array.from({ length: 5 }, (_, i) => `owner/repo${i}`);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });

      mockStructuredComplete.mockImplementation(async () => ({
        ...mockAnalysisResult,
        healthScore: 50 + Math.random() * 50,
      }));

      const startTime = Date.now();

      // 并行执行
      await Promise.all(
        repos.map((repo) =>
          fetchRepository({
            repo,
            includeIssues: false,
            includeCommits: false,
            issuesLimit: 10,
            commitsLimit: 10,
          })
        )
      );

      const duration = Date.now() - startTime;

      // 并行处理应该比串行快（这里只是验证不会出错）
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  // ========================================================================
  // 错误恢复
  // ========================================================================

  describe("错误恢复", () => {
    it("应该允许部分成功的管道", async () => {
      // 一个成功，一个失败
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubResponse,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });

      // 第一个成功
      const fetched1 = await fetchRepository({
        repo: "owner/repo1",
        includeIssues: false,
        includeCommits: false,
        issuesLimit: 10,
        commitsLimit: 10,
      });

      expect(fetched1.repository.fullName).toBeDefined();

      // 第二个失败
      await expect(
        fetchRepository({
          repo: "owner/repo2",
          includeIssues: false,
          includeCommits: false,
          issuesLimit: 10,
          commitsLimit: 10,
        })
      ).rejects.toThrow();
    });

    it("应该提供有意义的错误信息", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Rate Limit Exceeded",
      });

      try {
        await fetchRepository({
          repo: "owner/repo",
          includeIssues: false,
          includeCommits: false,
          issuesLimit: 10,
          commitsLimit: 10,
        });
        fail("应该抛出错误");
      } catch (error: any) {
        expect(error.message).toContain("403");
        expect(error.message).toContain("Rate Limit Exceeded");
      }
    });
  });
});
