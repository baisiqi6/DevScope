import { v4 as uuidv4 } from "uuid";
import { createAgent, StreamCallbacks } from "@devscope/ai";
import type { Db } from "./index";
import { workflowExecutions } from "./schema";
import { completeWorkflowWithReport } from "./workflow-reports";
import { saveReport } from "./report-storage";
import type { AgentWorkflowEvent, CompetitiveAnalysisReport } from "@devscope/shared";
import { and, eq, inArray } from "drizzle-orm";
import {
  COMPETITIVE_ANALYSIS_SYSTEM_PROMPT,
  HEALTH_REPORT_SYSTEM_PROMPT,
  SINGLE_REPO_ANALYSIS_SYSTEM_PROMPT,
} from "@devscope/ai";

export type AnalysisType = "competitive_landscape" | "health_report" | "single_repo";

export interface RunWorkflowInput {
  repos: string[];
  analysisType: AnalysisType;
  context?: string;
}

export interface WorkflowCallbacks {
  onEvent?: (event: AgentWorkflowEvent) => void;
  onText?: StreamCallbacks["onText"];
  onToolUse?: StreamCallbacks["onToolUse"];
  onToolResult?: StreamCallbacks["onToolResult"];
}

export interface RunWorkflowResult {
  executionId: string;
  report: CompetitiveAnalysisReport;
  reportPath: string;
}

export interface RunWorkflowOptions {
  executionId?: string;
  signal?: AbortSignal;
  /** Worker 重试时复用 API 已创建的 execution，而不是重复插入。 */
  resumeExecution?: boolean;
}

function getSystemPrompt(analysisType: string): string {
  switch (analysisType) {
    case "health_report":
      return HEALTH_REPORT_SYSTEM_PROMPT;
    case "single_repo":
      return SINGLE_REPO_ANALYSIS_SYSTEM_PROMPT;
    case "competitive_landscape":
    default:
      return COMPETITIVE_ANALYSIS_SYSTEM_PROMPT;
  }
}

function getAnalysisTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    competitive_landscape: "竞争格局分析",
    health_report: "健康度报告",
    single_repo: "单仓库分析",
  };
  return labels[type] || type;
}

export async function runAgentWorkflow(
  db: Db,
  userId: number,
  input: RunWorkflowInput,
  callbacks: WorkflowCallbacks = {},
  options: RunWorkflowOptions = {},
): Promise<RunWorkflowResult> {
  const execId = options.executionId ?? uuidv4();
  const startedAt = new Date();

  if (options.resumeExecution) {
    const resumed = await db
      .update(workflowExecutions)
      .set({
        status: "running",
        error: null,
        progressPercent: 0,
        currentNode: "agent",
        startedAt,
        completedAt: null,
        updatedAt: startedAt,
      })
      .where(
        and(
          eq(workflowExecutions.executionId, execId),
          eq(workflowExecutions.userId, userId),
          inArray(workflowExecutions.status, ["pending", "failed"]),
        )
      )
      .returning({ executionId: workflowExecutions.executionId });

    if (resumed.length !== 1) {
      throw new Error(`工作流执行记录不可恢复: ${execId}`);
    }
  } else {
    await db.insert(workflowExecutions).values({
      executionId: execId,
      userId,
      workflowId: "agent_competitive_analysis",
      workflowType: input.analysisType,
      status: "running",
      input: input as unknown as Record<string, unknown>,
      startedAt,
    });
  }

  callbacks.onEvent?.({
    type: "init",
    data: { executionId: execId, timestamp: new Date().toISOString() },
  });

  try {
    options.signal?.throwIfAborted();
    const agent = createAgent({ systemPrompt: getSystemPrompt(input.analysisType) });

    const repoList = input.repos.map((r) => `- ${r}`).join("\n");
    const prompt = `请对以下 GitHub 仓库进行${getAnalysisTypeLabel(input.analysisType)}：

${repoList}

${input.context ? `\n额外上下文：\n${input.context}\n` : ""}

请按照以下步骤完成分析：

1. **数据采集**：使用 repo_fetch 工具获取每个仓库的详细数据
2. **健康度分析**：使用 repo_analyze 工具分析每个仓库的健康度
3. **竞争格局分析**：基于采集的数据，分析：
   - 市场定位对比
   - 技术栈差异
   - 社区活跃度对比
   - 发展趋势对比
4. **报告生成**：使用 report_generate 工具生成最终报告

**重要提示**：
- 所有分析内容必须使用中文输出
- report_generate 的 analyses 必须传入 repo_analyze 返回的完整对象数组，不得只传仓库名称
- 风险严重度及其他评分统一使用 0-100 量纲
- 无法由工具数据直接计算的指标必须标注"AI 估算"或"数据不足"
- 确保每个分析结论都有数据支撑，并在报告中标注数据来源`;

    const streamCallbacks: StreamCallbacks = {
      onText: (text) => {
        callbacks.onText?.(text);
        callbacks.onEvent?.({
          type: "text",
          data: { text, timestamp: new Date().toISOString() },
        });
      },
      onToolUse: (name, toolInput) => {
        callbacks.onToolUse?.(name, toolInput);
        callbacks.onEvent?.({
          type: "tool_use",
          data: { name, input: toolInput as Record<string, unknown>, timestamp: new Date().toISOString() },
        });
      },
      onToolResult: (name, result) => {
        callbacks.onToolResult?.(name, result);
        callbacks.onEvent?.({
          type: "tool_result",
          data: { name, result, timestamp: new Date().toISOString() },
        });
      },
    };

    const result = await agent.stream(prompt, streamCallbacks, options.signal);
    options.signal?.throwIfAborted();

    const report = await generateStructuredReport(
      execId,
      result.toolCalls,
      input.repos,
      input.analysisType,
      result.output,
    );

    await completeWorkflowWithReport(db, {
      userId,
      repoFullName: input.repos.length === 1 ? input.repos[0] : null,
      report,
    });

    let reportPath = "";
    try {
      const savedReport = await saveReport(execId, report);
      reportPath = savedReport.path;
    } catch (error) {
      console.warn("[Workflow] Failed to write optional report cache:", error);
    }

    callbacks.onEvent?.({
      type: "report",
      data: {
        reportId: report.reportId,
        reportPath,
        summary: report.executiveSummary.overview,
        timestamp: new Date().toISOString(),
      },
    });

    callbacks.onEvent?.({
      type: "complete",
      data: { executionId: execId, status: "completed", timestamp: new Date().toISOString() },
    });

    return { executionId: execId, report, reportPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cancelled = options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    const status = cancelled ? "cancelled" : "failed";

    callbacks.onEvent?.({
      type: "complete",
      data: { executionId: execId, status, error: cancelled ? undefined : errorMessage, timestamp: new Date().toISOString() },
    });

    try {
      await db
        .update(workflowExecutions)
        .set({
          status,
          error: cancelled ? null : errorMessage,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowExecutions.executionId, execId),
            eq(workflowExecutions.userId, userId),
            eq(workflowExecutions.status, "running"),
          ),
        );
    } catch (e) {
      console.error("[Workflow] Failed to update execution record:", e);
    }

    throw error;
  }
}
// ============================================================================
// 报告生成
// ============================================================================

/**
 * 从 Agent 结果生成结构化报告
 */
export async function generateStructuredReport(
  executionId: string,
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>,
  repos: string[],
  analysisType: string,
  aiOutput?: string  // 新增：Agent 的最终文本输出
): Promise<CompetitiveAnalysisReport> {
  const reportId = uuidv4();
  const now = new Date().toISOString();

  // 从工具调用中提取数据
  const repoFetchResults: Array<{ repo: string; data: any }> = [];
  const repoAnalyzeResults: Array<{ repo: string; data: any }> = [];

  for (const call of toolCalls) {
    if (call.tool === "repo_fetch") {
      const input = call.input as { repo: string };
      repoFetchResults.push({ repo: input.repo, data: call.output });
    } else if (call.tool === "repo_analyze") {
      const input = call.input as { repo: string };
      repoAnalyzeResults.push({ repo: input.repo, data: call.output });
    }
  }

  // 构建技术对比数据
  const technologyComparison = repoFetchResults.map((r) => ({
    repo: r.repo,
    language: r.data?.repository?.language || null,
    license: r.data?.repository?.license || null,
    stars: r.data?.repository?.stars || 0,
    forks: r.data?.repository?.forks || 0,
    activityLevel: repoAnalyzeResults.find((a) => a.repo === r.repo)?.data?.activityLevel || "medium",
  }));

  // 构建社区指标数据。贡献者和提交频率来自 repo_fetch 的近期提交样本；
  // Issue 解决率仍是 AI 估算，展示层必须明确标注来源。
  const communityMetrics = repoAnalyzeResults.map((r) => {
    const fetchResult = repoFetchResults.find((item) => item.repo === r.repo);
    const commits = Array.isArray(fetchResult?.data?.commits)
      ? fetchResult.data.commits as Array<{ author?: unknown; date?: unknown }>
      : [];
    const contributorCount = new Set(
      commits
        .map((commit) => typeof commit.author === "string" ? commit.author.trim() : "")
        .filter(Boolean)
    ).size;
    const commitTimestamps = commits
      .map((commit) => typeof commit.date === "string" ? Date.parse(commit.date) : Number.NaN)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const spanDays = commitTimestamps.length >= 2
      ? Math.max(1, (commitTimestamps.at(-1)! - commitTimestamps[0]) / 86_400_000)
      : 0;
    const commitsPerDay = spanDays > 0 ? commitTimestamps.length / spanDays : 0;
    const commitFrequency = commitsPerDay >= 1
      ? "daily"
      : commitsPerDay >= 1 / 7
        ? "weekly"
        : commitsPerDay >= 1 / 30
          ? "monthly"
          : "sporadic";

    return {
      repo: r.repo,
      contributorCount,
      issueResolutionRate: r.data?.keyMetrics?.issueResolutionRate ?? 0,
      commitFrequency,
    } as const;
  });

  // 计算市场定位
  const sortedByStars = [...technologyComparison].sort((a, b) => b.stars - a.stars);
  const leaders = sortedByStars.slice(0, Math.ceil(sortedByStars.length * 0.25)).map((r) => r.repo);
  const challengers = sortedByStars
    .slice(Math.ceil(sortedByStars.length * 0.25), Math.ceil(sortedByStars.length * 0.5))
    .map((r) => r.repo);
  const niche = sortedByStars
    .slice(Math.ceil(sortedByStars.length * 0.5), Math.ceil(sortedByStars.length * 0.75))
    .map((r) => r.repo);
  const emerging = sortedByStars.slice(Math.ceil(sortedByStars.length * 0.75)).map((r) => r.repo);

  // 构建风险矩阵
  const risks: Array<{
    repo: string;
    category: "technical" | "community" | "business" | "compliance";
    description: string;
    severity: number;
    mitigation?: string;
  }> = [];

  for (const analyze of repoAnalyzeResults) {
    if (analyze.data?.riskFactors) {
      for (const risk of analyze.data.riskFactors) {
        risks.push({
          repo: analyze.repo,
          category: risk.category,
          description: risk.description,
          severity: risk.severity,
        });
      }
    }
  }

  // 计算总体风险
  const avgSeverity = risks.length > 0
    ? risks.reduce((sum, r) => sum + r.severity, 0) / risks.length
    : 0;
  const overallRisk = avgSeverity >= 75
    ? "critical"
    : avgSeverity >= 50
      ? "high"
      : avgSeverity >= 25
        ? "medium"
        : "low";

  // 构建投资建议
  const investRepos = repoAnalyzeResults.filter((r) => r.data?.recommendation === "invest").map((r) => r.repo);
  const watchRepos = repoAnalyzeResults.filter((r) => r.data?.recommendation === "watch").map((r) => r.repo);
  const avoidRepos = repoAnalyzeResults.filter((r) => r.data?.recommendation === "avoid").map((r) => r.repo);

  const topPick = investRepos[0] || sortedByStars[0]?.repo;
  const avgHealthScore = repoAnalyzeResults.length > 0
    ? repoAnalyzeResults.reduce((sum, r) => sum + (r.data?.healthScore || 0), 0) / repoAnalyzeResults.length
    : 50;
  const avgIssueResolutionRate = communityMetrics.length > 0
    ? communityMetrics.reduce((sum, metric) => sum + metric.issueResolutionRate, 0) / communityMetrics.length
    : 0;

  // 构建数据来源
  const dataSources: Array<{
    type: "github_api" | "ossinsight" | "ai_analysis";
    repo: string;
    timestamp: string;
    details: string;
  }> = [];

  for (const fetch of repoFetchResults) {
    const sampledContributors = communityMetrics.find((metric) => metric.repo === fetch.repo)?.contributorCount ?? 0;
    dataSources.push({
      type: "github_api",
      repo: fetch.repo,
      timestamp: now,
      details: `获取仓库基础数据: ${fetch.data?.repository?.stars || 0} stars, ${fetch.data?.repository?.forks || 0} forks；近期提交样本包含 ${sampledContributors} 位不同作者`,
    });
  }

  for (const analyze of repoAnalyzeResults) {
    dataSources.push({
      type: "ai_analysis",
      repo: analyze.repo,
      timestamp: now,
      details: `健康度评分: ${analyze.data?.healthScore || "N/A"}, 活跃度: ${analyze.data?.activityLevel || "N/A"}；Issue 解决率为 AI 估算，非完整生命周期统计`,
    });
  }

  // 构建完整报告
  const report: CompetitiveAnalysisReport = {
    reportId,
    executionId,
    generatedAt: now,
    analysisType: analysisType as any,

    // AI 详细分析
    aiAnalysis: aiOutput,

    executiveSummary: {
      overview: `本报告分析了 ${repos.length} 个开源项目，平均健康度评分为 ${avgHealthScore.toFixed(1)} 分。` +
        `其中 ${investRepos.length} 个项目建议投资，${watchRepos.length} 个项目建议观望，${avoidRepos.length} 个项目建议规避。`,
      keyFindings: [
        `${leaders[0] || "无"} 在 Stars 数量上领先`,
        `AI 估算的平均 Issue 解决率为 ${avgIssueResolutionRate}%（非完整生命周期统计）`,
        `发现 ${risks.length} 个潜在风险因素`,
      ],
      recommendation: investRepos.length > repos.length / 2 ? "invest" : avoidRepos.length > repos.length / 2 ? "avoid" : "mixed",
      confidenceLevel: repoAnalyzeResults.length === repos.length ? "high" : "medium",
    },

    detailedAnalysis: {
      marketPosition: {
        leaders,
        challengers,
        niche,
        emerging,
      },
      technologyComparison,
      communityMetrics,
    },

    riskMatrix: {
      overallRisk: overallRisk as any,
      risks,
    },

    investmentRecommendations: {
      topPick,
      watchList: watchRepos,
      avoidList: avoidRepos,
      rationale: `基于健康度评分、社区活跃度和技术栈分析，${topPick} 是最具投资价值的项目。` +
        `该项目拥有活跃的社区支持和良好的技术健康度。`,
    },

    dataSources,
    toolOutputs: toolCalls.map((call) => ({
      tool: call.tool,
      input: call.input as Record<string, unknown>,
      output: call.output,
      timestamp: now,
    })),
  };

  return report;
}
