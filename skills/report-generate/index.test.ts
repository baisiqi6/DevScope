/**
 * @package skills/report-generate
 * @description report-generate skill 单元测试
 *
 * TDD 测试原理：
 *
 * 1. **纯函数测试**：
 *    - report-generate 主要是纯函数，无需 mock
 *    - 测试输入输出的一致性
 *
 * 2. **测试覆盖**：
 *    - 输入验证 (Schema 验证)
 *    - 各类型报告生成 (summary, detailed, comparison)
 *    - Markdown 格式化输出
 *    - 统计计算正确性
 *    - 边界条件（空数据、单仓库等）
 *
 * 3. **AAA 模式**：Arrange-Act-Assert
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ReportInputSchema,
  generateReport,
  generateMarkdown,
  type Report,
  type ReportSection,
  type ReportMetadata,
} from "./index";

// ============================================================================
// 测试数据
// ============================================================================

/**
 * Mock 分析数据 - 高质量仓库
 */
const mockHighQualityAnalysis = {
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
  repo: "vercel/next.js",
};

/**
 * Mock 分析数据 - 中等质量仓库
 */
const mockMediumQualityAnalysis = {
  healthScore: 60,
  activityLevel: "medium" as const,
  keyMetrics: {
    starsGrowthRate: 5.2,
    issueResolutionRate: 70,
    contributorDiversityScore: 55,
  },
  riskFactors: [
    {
      category: "维护",
      description: "维护团队规模较小",
      severity: 5,
    },
  ],
  opportunities: [],
  recommendation: "watch" as const,
  summary: "项目表现一般，建议观望。",
  repo: "owner/repo2",
};

/**
 * Mock 分析数据 - 低质量仓库
 */
const mockLowQualityAnalysis = {
  healthScore: 30,
  activityLevel: "low" as const,
  keyMetrics: {
    starsGrowthRate: -5.0,
    issueResolutionRate: 40,
    contributorDiversityScore: 25,
  },
  riskFactors: [
    {
      category: "活跃度",
      description: "项目几乎不再维护",
      severity: 9,
    },
  ],
  opportunities: [],
  recommendation: "avoid" as const,
  summary: "不建议投资。",
  repo: "dead/project",
};

/**
 * Mock 分析数据 - 包含 repository 信息
 */
const mockAnalysisWithRepository = {
  ...mockHighQualityAnalysis,
  repository: {
    fullName: "vercel/next.js",
    name: "next.js",
    owner: "vercel",
    description: "The React Framework",
    stars: 120000,
    forks: 25000,
    openIssues: 1500,
    language: "TypeScript",
    license: "MIT",
    url: "https://github.com/vercel/next.js",
  },
};

// ============================================================================
// 测试套件
// ============================================================================

describe("report-generate", () => {
  // ========================================================================
  // 输入验证测试
  // ========================================================================

  describe("ReportInputSchema", () => {
    it("应该验证有效的报告输入", () => {
      const result = ReportInputSchema.safeParse({
        title: "测试报告",
        type: "summary",
        analyses: [mockHighQualityAnalysis],
        format: "markdown",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("测试报告");
        expect(result.data.type).toBe("summary");
        expect(result.data.format).toBe("markdown");
      }
    });

    it("应该使用默认值", () => {
      const result = ReportInputSchema.parse({
        title: "测试报告",
        analyses: [],
      });

      expect(result.type).toBe("summary");
      expect(result.format).toBe("markdown");
      expect(result.analyses).toEqual([]);
    });

    it("应该拒绝空标题", () => {
      const result = ReportInputSchema.safeParse({
        title: "",
        analyses: [],
      });

      expect(result.success).toBe(false);
    });

    it("应该只允许有效的 type 枚举值", () => {
      const validTypes = ["summary", "detailed", "comparison"];

      for (const type of validTypes) {
        const result = ReportInputSchema.safeParse({
          title: "测试",
          type,
          analyses: [],
        });
        expect(result.success).toBe(true);
      }
    });

    it("应该拒绝无效的 type", () => {
      const result = ReportInputSchema.safeParse({
        title: "测试",
        type: "invalid",
        analyses: [],
      });

      expect(result.success).toBe(false);
    });

    it("应该只允许有效的 format 枚举值", () => {
      const validFormats = ["json", "markdown", "html"];

      for (const format of validFormats) {
        const result = ReportInputSchema.safeParse({
          title: "测试",
          format,
          analyses: [],
        });
        expect(result.success).toBe(true);
      }
    });

    it("应该支持可选的 content 字段", () => {
      const result = ReportInputSchema.safeParse({
        title: "测试报告",
        analyses: [],
        content: "额外的报告内容",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("额外的报告内容");
      }
    });
  });

  // ========================================================================
  // 报告生成测试
  // ========================================================================

  describe("generateReport", () => {
    it("应该生成 summary 类型报告", () => {
      const report = generateReport({
        title: "测试报告",
        type: "summary",
        analyses: [mockHighQualityAnalysis],
      });

      expect(report.type).toBe("summary");
      expect(report.title).toBe("Open Source Analysis Report");
      expect(report.sections).toBeDefined();
      expect(report.generatedAt).toBeDefined();
    });

    it("应该生成 detailed 类型报告", () => {
      const report = generateReport({
        title: "详细报告",
        type: "detailed",
        analyses: [mockHighQualityAnalysis],
        content: "这是详细内容",
      });

      expect(report.type).toBe("detailed");
      // detailed 应该包含额外的详细章节
      const hasDetailSection = report.sections.some(
        (s) => s.title === "详细分析"
      );
      expect(hasDetailSection).toBe(true);
    });

    it("应该生成 comparison 类型报告", () => {
      const report = generateReport({
        title: "对比报告",
        type: "comparison",
        analyses: [
          mockHighQualityAnalysis,
          mockMediumQualityAnalysis,
        ],
      });

      expect(report.type).toBe("comparison");
      const hasComparisonSection = report.sections.some(
        (s) => s.title === "对比分析"
      );
      expect(hasComparisonSection).toBe(true);
    });

    it("应该正确计算统计数据", () => {
      const report = generateReport({
        title: "统计报告",
        analyses: [
          mockHighQualityAnalysis,    // 85
          mockMediumQualityAnalysis,  // 60
          mockLowQualityAnalysis,     // 30
        ],
      });

      expect(report.metadata.totalRepositories).toBe(3);
      expect(report.metadata.averageHealthScore).toBe(58); // (85 + 60 + 30) / 3 = 58.33 -> 58
    });

    it("应该正确识别 top performers", () => {
      const report = generateReport({
        title: "排名报告",
        analyses: [
          mockLowQualityAnalysis,     // 30
          mockHighQualityAnalysis,    // 85
          mockMediumQualityAnalysis,  // 60
        ],
      });

      // 应该按 healthScore 降序排列
      expect(report.metadata.topPerformers[0]).toBe("vercel/next.js");
      expect(report.metadata.topPerformers[1]).toBe("owner/repo2");
    });

    it("应该处理包含 repository 信息的数据", () => {
      const report = generateReport({
        title: "仓库信息报告",
        analyses: [mockAnalysisWithRepository],
      });

      expect(report.metadata.topPerformers[0]).toBe("vercel/next.js");
    });
  });

  // ========================================================================
  // 边界条件测试
  // ========================================================================

  describe("边界条件", () => {
    it("应该处理空分析数据", () => {
      const report = generateReport({
        title: "空报告",
        analyses: [],
      });

      expect(report.title).toBe("Empty Report");
      expect(report.summary).toBe("没有可分析的数据");
      expect(report.metadata.totalRepositories).toBe(0);
      expect(report.metadata.averageHealthScore).toBe(0);
      expect(report.metadata.topPerformers).toEqual([]);
    });

    it("应该处理单个仓库", () => {
      const report = generateReport({
        title: "单仓库报告",
        analyses: [mockHighQualityAnalysis],
      });

      expect(report.metadata.totalRepositories).toBe(1);
      expect(report.metadata.averageHealthScore).toBe(85);
      expect(report.metadata.topPerformers).toHaveLength(1);
    });

    it("应该处理大量仓库（>10）", () => {
      const manyAnalyses = Array.from({ length: 15 }, (_, i) => ({
        ...mockHighQualityAnalysis,
        healthScore: 50 + i,
        repo: `owner/repo${i}`,
      }));

      const report = generateReport({
        title: "多仓库报告",
        analyses: manyAnalyses,
      });

      expect(report.metadata.totalRepositories).toBe(15);
      // 超过 10 个仓库不应该在详情中显示所有仓库
      const detailSection = report.sections.find((s) => s.title === "仓库详情");
      expect(detailSection).toBeUndefined();
    });

    it("应该处理极端的 healthScore 值", () => {
      const report = generateReport({
        title: "极端值报告",
        analyses: [
          { ...mockHighQualityAnalysis, healthScore: 0 },
          { ...mockHighQualityAnalysis, healthScore: 100 },
        ],
      });

      expect(report.metadata.averageHealthScore).toBe(50);
    });

    it("应该处理所有 recommendation 类型", () => {
      const report = generateReport({
        title: "推荐类型报告",
        analyses: [
          { ...mockHighQualityAnalysis, recommendation: "invest" as const },
          { ...mockHighQualityAnalysis, recommendation: "watch" as const },
          { ...mockHighQualityAnalysis, recommendation: "avoid" as const },
        ],
      });

      expect(report.metadata.totalRepositories).toBe(3);
    });

    it("应该处理没有 riskFactors 的数据", () => {
      const noRiskData = {
        ...mockHighQualityAnalysis,
        riskFactors: [],
      };

      const report = generateReport({
        title: "无风险报告",
        analyses: [noRiskData],
      });

      expect(report.metadata.totalRepositories).toBe(1);
    });

    it("应该处理没有 opportunities 的数据", () => {
      const noOpportunityData = {
        ...mockHighQualityAnalysis,
        opportunities: [],
      };

      const report = generateReport({
        title: "无机会报告",
        analyses: [noOpportunityData],
      });

      expect(report.metadata.totalRepositories).toBe(1);
    });

    it("应该处理缺少 repo 字段的数据", () => {
      const noRepoData = {
        ...mockHighQualityAnalysis,
        repo: undefined,
      };

      const report = generateReport({
        title: "无 repo 字段报告",
        analyses: [noRepoData],
      });

      // 应该能处理，但 repo 可能为 undefined
      expect(report.metadata.totalRepositories).toBe(1);
    });
  });

  // ========================================================================
  // Summary 生成测试
  // ========================================================================

  describe("Summary 生成", () => {
    it("应该根据平均分生成不同的总结文本", () => {
      // 高分 (>= 70)
      const highReport = generateReport({
        title: "高分报告",
        analyses: [{ ...mockHighQualityAnalysis, healthScore: 75 }],
      });
      expect(highReport.summary).toContain("整体表现良好");

      // 中分 (>= 50)
      const mediumReport = generateReport({
        title: "中等报告",
        analyses: [{ ...mockHighQualityAnalysis, healthScore: 55 }],
      });
      expect(mediumReport.summary).toContain("整体表现中等");

      // 低分 (< 50)
      const lowReport = generateReport({
        title: "低分报告",
        analyses: [{ ...mockHighQualityAnalysis, healthScore: 35 }],
      });
      expect(lowReport.summary).toContain("整体表现有待提升");
    });

    it("应该正确统计推荐分布", () => {
      const report = generateReport({
        title: "推荐分布报告",
        analyses: [
          { ...mockHighQualityAnalysis, recommendation: "invest" as const },
          { ...mockHighQualityAnalysis, recommendation: "invest" as const },
          { ...mockHighQualityAnalysis, recommendation: "watch" as const },
          { ...mockHighQualityAnalysis, recommendation: "avoid" as const },
        ],
      });

      expect(report.summary).toContain("建议投资: 2 个");
      expect(report.summary).toContain("建议观望: 1 个");
      expect(report.summary).toContain("建议避免: 1 个");
    });

    it("应该包含仓库总数", () => {
      const report = generateReport({
        title: "数量报告",
        analyses: [
          mockHighQualityAnalysis,
          mockMediumQualityAnalysis,
        ],
      });

      expect(report.summary).toContain("分析了 2 个开源仓库");
    });
  });

  // ========================================================================
  // Markdown 生成测试
  // ========================================================================

  describe("generateMarkdown", () => {
    it("应该生成有效的 Markdown 格式", () => {
      const report: Report = {
        title: "测试报告",
        type: "summary",
        summary: "这是总结",
        sections: [
          {
            title: "章节 1",
            content: "内容 1",
            level: 1,
          },
          {
            title: "章节 2",
            content: "内容 2",
            level: 2,
          },
        ],
        generatedAt: "2024-01-15T00:00:00Z",
        metadata: {
          totalRepositories: 5,
          topPerformers: ["repo1", "repo2"],
          averageHealthScore: 70,
        },
      };

      const markdown = generateMarkdown(report);

      // 验证标题
      expect(markdown).toContain("# 测试报告");
      expect(markdown).toContain("**生成时间**: 2024-01-15T00:00:00Z");

      // 验证章节
      expect(markdown).toContain("# 章节 1");
      expect(markdown).toContain("## 章节 2");

      // 验证内容
      expect(markdown).toContain("内容 1");
      expect(markdown).toContain("内容 2");

      // 验证元数据
      expect(markdown).toContain("**元数据**");
      expect(markdown).toContain("- 总仓库数: 5");
      expect(markdown).toContain("- 平均健康度: 70");
      expect(markdown).toContain("- 顶级仓库: repo1, repo2");
    });

    it("应该根据 level 生成正确的标题层级", () => {
      const report: Report = {
        title: "层级测试",
        type: "summary",
        summary: "测试",
        sections: [
          { title: "L1", content: "C1", level: 1 },
          { title: "L2", content: "C2", level: 2 },
          { title: "L3", content: "C3", level: 3 },
        ],
        generatedAt: "2024-01-15T00:00:00Z",
        metadata: {
          totalRepositories: 1,
          topPerformers: [],
          averageHealthScore: 50,
        },
      };

      const markdown = generateMarkdown(report);

      expect(markdown).toContain("# L1");
      expect(markdown).toContain("## L2");
      expect(markdown).toContain("### L3");
    });

    it("应该正确处理分隔线", () => {
      const report: Report = {
        title: "分隔线测试",
        type: "summary",
        summary: "测试",
        sections: [],
        generatedAt: "2024-01-15T00:00:00Z",
        metadata: {
          totalRepositories: 1,
          topPerformers: [],
          averageHealthScore: 50,
        },
      };

      const markdown = generateMarkdown(report);

      // 验证分隔线存在
      expect(markdown).toContain("---");
    });

    it("应该处理空章节列表", () => {
      const report: Report = {
        title: "空章节测试",
        type: "summary",
        summary: "测试",
        sections: [],
        generatedAt: "2024-01-15T00:00:00Z",
        metadata: {
          totalRepositories: 0,
          topPerformers: [],
          averageHealthScore: 0,
        },
      };

      const markdown = generateMarkdown(report);

      expect(markdown).toContain("# 空章节测试");
      expect(markdown).toContain("**元数据**");
    });

    it("应该处理特殊字符", () => {
      const report: Report = {
        title: "特殊字符测试 *_*",
        type: "summary",
        summary: "包含 **加粗** 和 *斜体*",
        sections: [
          {
            title: "代码 `示例`",
            content: "```const x = 1;```",
            level: 1,
          },
        ],
        generatedAt: "2024-01-15T00:00:00Z",
        metadata: {
          totalRepositories: 1,
          topPerformers: ["owner/repo-with-dash"],
          averageHealthScore: 50,
        },
      };

      const markdown = generateMarkdown(report);

      expect(markdown).toContain("特殊字符测试 *_*");
      expect(markdown).toContain("**加粗**");
      expect(markdown).toContain("*斜体*");
      expect(markdown).toContain("代码 `示例`");
      expect(markdown).toContain("owner/repo-with-dash");
    });
  });

  // ========================================================================
  // 对比报告测试
  // ========================================================================

  describe("对比报告", () => {
    it("应该需要至少 2 个仓库才能生成对比", () => {
      const report = generateReport({
        title: "单仓库对比",
        type: "comparison",
        analyses: [mockHighQualityAnalysis],
      });

      const comparisonSection = report.sections.find(
        (s) => s.title === "对比分析"
      );
      expect(comparisonSection?.content).toContain("需要至少 2 个仓库");
    });

    it("应该正确对比 healthScore", () => {
      const report = generateReport({
        title: "健康度对比",
        type: "comparison",
        analyses: [
          { ...mockHighQualityAnalysis, healthScore: 90, repo: "repo1" },
          { ...mockHighQualityAnalysis, healthScore: 70, repo: "repo2" },
          { ...mockHighQualityAnalysis, healthScore: 50, repo: "repo3" },
        ],
      });

      const comparisonSection = report.sections.find(
        (s) => s.title === "对比分析"
      );

      expect(comparisonSection?.content).toContain("healthScore");
      expect(comparisonSection?.content).toContain("1. repo1: 90");
      expect(comparisonSection?.content).toContain("2. repo2: 70");
      expect(comparisonSection?.content).toContain("3. repo3: 50");
    });

    it("应该对比多个指标", () => {
      const analyses = [
        {
          ...mockHighQualityAnalysis,
          healthScore: 80,
          stars: 10000,
          forks: 2000,
          repo: "repo1",
        },
        {
          ...mockHighQualityAnalysis,
          healthScore: 60,
          stars: 5000,
          forks: 1000,
          repo: "repo2",
        },
      ];

      const report = generateReport({
        title: "多指标对比",
        type: "comparison",
        analyses,
      });

      const comparisonSection = report.sections.find(
        (s) => s.title === "对比分析"
      );

      expect(comparisonSection?.content).toContain("healthScore");
      expect(comparisonSection?.content).toContain("stars");
      expect(comparisonSection?.content).toContain("forks");
    });
  });

  // ========================================================================
  // 详细报告测试
  // ========================================================================

  describe("详细报告", () => {
    it("应该包含额外的详细章节", () => {
      const extraContent = "这是额外的详细分析内容";

      const report = generateReport({
        title: "详细测试",
        type: "detailed",
        analyses: [mockHighQualityAnalysis],
        content: extraContent,
      });

      // 应该包含基础 summary 的章节
      expect(report.sections.length).toBeGreaterThan(0);

      // 应该包含详细分析章节
      const detailSection = report.sections.find(
        (s) => s.title === "详细分析"
      );
      expect(detailSection).toBeDefined();
      expect(detailSection?.content).toContain(extraContent);
    });

    it("应该处理没有 content 的详细报告", () => {
      const report = generateReport({
        title: "无内容详细报告",
        type: "detailed",
        analyses: [mockHighQualityAnalysis],
      });

      const detailSection = report.sections.find(
        (s) => s.title === "详细分析"
      );
      expect(detailSection?.content).toBe("无额外内容");
    });
  });

  // ========================================================================
  // Report 类型验证测试
  // ========================================================================

  describe("Report 类型安全", () => {
    it("应该生成符合 Report 类型的数据", () => {
      const report = generateReport({
        title: "类型测试",
        analyses: [mockHighQualityAnalysis],
      });

      // 验证必需字段
      expect(report).toHaveProperty("title");
      expect(report).toHaveProperty("type");
      expect(report).toHaveProperty("summary");
      expect(report).toHaveProperty("sections");
      expect(report).toHaveProperty("generatedAt");
      expect(report).toHaveProperty("metadata");

      // 验证 metadata 字段
      expect(report.metadata).toHaveProperty("totalRepositories");
      expect(report.metadata).toHaveProperty("topPerformers");
      expect(report.metadata).toHaveProperty("averageHealthScore");

      // 验证类型
      expect(typeof report.title).toBe("string");
      expect(typeof report.type).toBe("string");
      expect(typeof report.summary).toBe("string");
      expect(Array.isArray(report.sections)).toBe(true);
      expect(typeof report.generatedAt).toBe("string");
      expect(typeof report.metadata.totalRepositories).toBe("number");
      expect(Array.isArray(report.metadata.topPerformers)).toBe(true);
      expect(typeof report.metadata.averageHealthScore).toBe("number");
    });

    it("应该生成符合 ReportSection 类型的章节", () => {
      const report = generateReport({
        title: "章节类型测试",
        analyses: [mockHighQualityAnalysis],
      });

      report.sections.forEach((section: ReportSection) => {
        expect(section).toHaveProperty("title");
        expect(section).toHaveProperty("content");
        expect(section).toHaveProperty("level");

        expect(typeof section.title).toBe("string");
        expect(typeof section.content).toBe("string");
        expect(typeof section.level).toBe("number");
      });
    });

    it("应该生成符合 ReportMetadata 类型的元数据", () => {
      const report = generateReport({
        title: "元数据类型测试",
        analyses: [mockHighQualityAnalysis],
      });

      const metadata: ReportMetadata = report.metadata;

      expect(typeof metadata.totalRepositories).toBe("number");
      expect(Array.isArray(metadata.topPerformers)).toBe(true);
      metadata.topPerformers.forEach((performer) => {
        expect(typeof performer).toBe("string");
      });
      expect(typeof metadata.averageHealthScore).toBe("number");
    });
  });
});
