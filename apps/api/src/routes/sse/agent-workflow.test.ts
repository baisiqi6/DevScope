import { describe, expect, it } from "vitest";
import { generateStructuredReport } from "./agent-workflow";

const repo = "owner/repo";

function createToolCalls(severity: number) {
  return [
    {
      tool: "repo_fetch",
      input: { repo },
      output: {
        repository: {
          language: "TypeScript",
          license: "MIT",
          stars: 100,
          forks: 10,
        },
        commits: [
          { author: "Alice", date: "2026-07-15T00:00:00.000Z" },
          { author: "Bob", date: "2026-07-14T12:00:00.000Z" },
          { author: "Alice", date: "2026-07-14T00:00:00.000Z" },
        ],
      },
    },
    {
      tool: "repo_analyze",
      input: { repo },
      output: {
        repo,
        healthScore: 80,
        activityLevel: "high",
        keyMetrics: {
          starsGrowthRate: 10,
          issueResolutionRate: 72,
          contributorDiversityScore: 90,
        },
        riskFactors: [{
          category: "technical",
          description: "测试风险",
          severity,
        }],
        opportunities: [],
        recommendation: "invest",
        summary: "项目状态良好。",
      },
    },
  ];
}

describe("generateStructuredReport", () => {
  it("使用近期提交样本计算贡献者和提交频率，并标明 AI 估算指标", async () => {
    const report = await generateStructuredReport(
      "execution-1",
      createToolCalls(20),
      [repo],
      "health_report",
      "分析正文"
    );

    expect(report.detailedAnalysis.communityMetrics).toEqual([{
      repo,
      contributorCount: 2,
      issueResolutionRate: 72,
      commitFrequency: "daily",
    }]);
    expect(report.executiveSummary.keyFindings).toContain("AI 估算的平均 Issue 解决率为 72%（非完整生命周期统计）");
  });

  it.each([
    [24, "low"],
    [25, "medium"],
    [50, "high"],
    [75, "critical"],
  ] as const)("按 0-100 量纲聚合风险 %s => %s", async (severity, expected) => {
    const report = await generateStructuredReport(
      `execution-${severity}`,
      createToolCalls(severity),
      [repo],
      "health_report"
    );

    expect(report.riskMatrix.overallRisk).toBe(expected);
  });
});
