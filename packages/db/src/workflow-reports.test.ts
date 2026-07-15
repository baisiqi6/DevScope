import { describe, expect, it, vi } from "vitest";
import type { CompetitiveAnalysisReport } from "@devscope/shared";
import {
  completeWorkflowWithReport,
  getWorkflowReportByExecutionId,
  listWorkflowReportsByRepository,
  ownsWorkflowExecution,
} from "./workflow-reports";

const report: CompetitiveAnalysisReport = {
  reportId: "report-1",
  executionId: "execution-1",
  generatedAt: "2026-07-15T02:00:00.000Z",
  analysisType: "health_report",
  aiAnalysis: "健康分析正文",
  executiveSummary: {
    overview: "仓库整体健康。",
    keyFindings: ["提交活跃"],
    recommendation: "watch",
    confidenceLevel: "high",
  },
  detailedAnalysis: {
    marketPosition: {
      leaders: ["owner/repo"],
      challengers: [],
      niche: [],
      emerging: [],
    },
    technologyComparison: [{
      repo: "owner/repo",
      language: "TypeScript",
      license: "MIT",
      stars: 100,
      forks: 10,
      activityLevel: "high",
    }],
    communityMetrics: [{
      repo: "owner/repo",
      contributorCount: 8,
      issueResolutionRate: 90,
      commitFrequency: "weekly",
    }],
  },
  riskMatrix: {
    overallRisk: "low",
    risks: [],
  },
  investmentRecommendations: {
    topPick: "owner/repo",
    watchList: ["owner/repo"],
    avoidList: [],
    rationale: "维护状态稳定。",
  },
  dataSources: [],
  toolOutputs: [],
};

describe("workflow-reports", () => {
  it("应该在同一事务内完成执行并写入报告", async () => {
    const returning = vi.fn().mockResolvedValue([{ executionId: "execution-1" }]);
    const updateWhere = vi.fn(() => ({ returning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const tx = { update, insert };
    const db = {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => {
        await callback(tx);
      }),
    };

    await completeWorkflowWithReport(db as any, {
      userId: 7,
      repoFullName: "owner/repo",
      report,
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      result: report,
      progressPercent: 100,
      currentNode: "completed",
      durationMs: expect.anything(),
    }));
    expect(values).toHaveBeenCalledWith({
      reportId: "report-1",
      executionId: "execution-1",
      userId: 7,
      reportType: "quick_assessment",
      reportData: report,
      summary: "仓库整体健康。",
      repoFullName: "owner/repo",
    });
  });

  it("执行记录不属于当前用户时不应该写入报告", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const values = vi.fn();
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning })),
        })),
      })),
      insert: vi.fn(() => ({ values })),
    };
    const db = {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => {
        await callback(tx);
      }),
    };

    await expect(
      completeWorkflowWithReport(db as any, {
        userId: 8,
        repoFullName: "owner/repo",
        report,
      })
    ).rejects.toThrow("工作流执行记录不可完成");

    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("应该从数据库加载并校验完整报告", async () => {
    const db = createSelectDb([{ reportData: report }]);

    await expect(
      getWorkflowReportByExecutionId(db as any, "execution-1", 7)
    ).resolves.toEqual(report);
  });

  it("应该返回仓库报告摘要并识别执行归属", async () => {
    const summaries = [{
      reportId: "report-1",
      executionId: "execution-1",
      summary: "仓库整体健康。",
      createdAt: new Date("2026-07-15T02:00:00.000Z"),
    }];

    await expect(
      listWorkflowReportsByRepository(createSelectDb(summaries) as any, "owner/repo", 7)
    ).resolves.toEqual(summaries);

    await expect(
      ownsWorkflowExecution(createSelectDb([{ executionId: "execution-1" }]) as any, "execution-1", 7)
    ).resolves.toBe(true);
  });
});

function createSelectDb(rows: unknown[]) {
  const terminal = {
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockResolvedValue(rows),
  };

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => terminal),
      })),
    })),
  };
}
