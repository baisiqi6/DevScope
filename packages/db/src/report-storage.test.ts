import { describe, expect, it } from "vitest";
import type { CompetitiveAnalysisReport } from "@devscope/shared";
import { generateMarkdown } from "./report-storage";

const report: CompetitiveAnalysisReport = {
  reportId: "report-1",
  executionId: "execution-1",
  generatedAt: "2026-07-15T02:00:00.000Z",
  analysisType: "health_report",
  executiveSummary: {
    overview: "测试报告",
    keyFindings: [],
    recommendation: "watch",
    confidenceLevel: "medium",
  },
  detailedAnalysis: {
    marketPosition: { leaders: [], challengers: [], niche: [], emerging: [] },
    technologyComparison: [],
    communityMetrics: [{
      repo: "owner/repo",
      contributorCount: 2,
      issueResolutionRate: 72,
      commitFrequency: "daily",
    }],
  },
  riskMatrix: {
    overallRisk: "medium",
    risks: [{
      repo: "owner/repo",
      category: "technical",
      description: "测试风险",
      severity: 25,
    }],
  },
  investmentRecommendations: {
    watchList: ["owner/repo"],
    avoidList: [],
    rationale: "继续观察。",
  },
  dataSources: [],
  toolOutputs: [],
};

describe("generateMarkdown", () => {
  it("明确标注样本/AI 估算指标并按 100 分制展示风险", () => {
    const markdown = generateMarkdown(report);

    expect(markdown).toContain("近期提交贡献者（样本）");
    expect(markdown).toContain("Issue 解决率（AI 估算）");
    expect(markdown).toContain("25/100");
    expect(markdown).not.toMatch(/25\/10(?:\s|\|)/);
  });
});
