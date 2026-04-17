/**
 * @package @devscope/api/routes/sse
 * @description Agent 工作流 SSE 端点
 *
 * 提供 Server-Sent Events 端点，用于实时推送 Agent 思考过程。
 *
 * @module agent-workflow
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { createAgent, StreamCallbacks } from "@devscope/ai";
import { createDb, saveReport } from "@devscope/db";
import type {
  AgentWorkflowEvent,
  CompetitiveAnalysisReport,
} from "@devscope/shared";
import { workflowExecutions } from "@devscope/db";
import { eq } from "drizzle-orm";
import {
  COMPETITIVE_ANALYSIS_SYSTEM_PROMPT,
  HEALTH_REPORT_SYSTEM_PROMPT,
  SINGLE_REPO_ANALYSIS_SYSTEM_PROMPT,
} from "@devscope/ai";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * SSE 请求体
 */
interface SSERequestBody {
  repos: string[];
  analysisType: "competitive_landscape" | "health_report" | "single_repo";
  context?: string;
  userId?: number;
}

// ============================================================================
// SSE 辅助函数
// ============================================================================

/**
 * 发送 SSE 事件
 */
function sendEvent(reply: FastifyReply, event: AgentWorkflowEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * 获取分析类型标签
 */
function getAnalysisTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    competitive_landscape: "竞争格局分析",
    health_report: "健康度报告",
    single_repo: "单仓库分析",
  };
  return labels[type] || type;
}

/**
 * 创建终端输出拦截器
 * 拦截 console.log 等输出并通过 SSE 发送
 */
function createTerminalInterceptor(reply: FastifyReply) {
  const levels = ["log", "info", "warn", "error", "debug"] as const;
  const originals: Record<string, (...args: any[]) => void> = {};

  // 保存原始方法
  for (const level of levels) {
    originals[level] = console[level].bind(console);
  }

  // 返回清理函数
  const cleanup = () => {
    for (const level of levels) {
      console[level] = originals[level];
    }
  };

  // 重写 console 方法
  for (const level of levels) {
    console[level] = ((...args: any[]) => {
      // 调用原始方法（保持终端输出）
      originals[level](...args);

      // 通过 SSE 发送
      const message = args
        .map((arg) => {
          if (typeof arg === "string") return arg;
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        })
        .join(" ");

      sendEvent(reply, {
        type: "terminal",
        data: {
          level,
          message,
          timestamp: new Date().toISOString(),
          source: "agent",
        },
      });
    }) as any;
  }

  return cleanup;
}

// ============================================================================
// 报告生成
// ============================================================================

/**
 * 从 Agent 结果生成结构化报告
 */
async function generateStructuredReport(
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

  // 构建社区指标数据
  const communityMetrics = repoAnalyzeResults.map((r) => ({
    repo: r.repo,
    contributorCount: r.data?.keyMetrics?.contributorDiversityScore || 0,
    issueResolutionRate: r.data?.keyMetrics?.issueResolutionRate || 0,
    commitFrequency: "weekly" as const, // 默认值，实际应从数据中获取
  }));

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
          category: risk.category || "technical",
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
  const overallRisk = avgSeverity >= 7 ? "critical" : avgSeverity >= 5 ? "high" : avgSeverity >= 3 ? "medium" : "low";

  // 构建投资建议
  const investRepos = repoAnalyzeResults.filter((r) => r.data?.recommendation === "invest").map((r) => r.repo);
  const watchRepos = repoAnalyzeResults.filter((r) => r.data?.recommendation === "watch").map((r) => r.repo);
  const avoidRepos = repoAnalyzeResults.filter((r) => r.data?.recommendation === "avoid").map((r) => r.repo);

  const topPick = investRepos[0] || sortedByStars[0]?.repo;
  const avgHealthScore = repoAnalyzeResults.length > 0
    ? repoAnalyzeResults.reduce((sum, r) => sum + (r.data?.healthScore || 0), 0) / repoAnalyzeResults.length
    : 50;

  // 构建数据来源
  const dataSources: Array<{
    type: "github_api" | "ossinsight" | "ai_analysis";
    repo: string;
    timestamp: string;
    details: string;
  }> = [];

  for (const fetch of repoFetchResults) {
    dataSources.push({
      type: "github_api",
      repo: fetch.repo,
      timestamp: now,
      details: `获取仓库基础数据: ${fetch.data?.repository?.stars || 0} stars, ${fetch.data?.repository?.forks || 0} forks`,
    });
  }

  for (const analyze of repoAnalyzeResults) {
    dataSources.push({
      type: "ai_analysis",
      repo: analyze.repo,
      timestamp: now,
      details: `健康度评分: ${analyze.data?.healthScore || "N/A"}, 活跃度: ${analyze.data?.activityLevel || "N/A"}`,
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
        `平均 Issue 解决率为 ${communityMetrics.reduce((s, m) => s + m.issueResolutionRate, 0) / communityMetrics.length || 0}%`,
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

// ============================================================================
// SSE 端点注册
// ============================================================================

/**
 * 注册 Agent 工作流 SSE 端点
 */
export async function registerAgentWorkflowSSE(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/agent/workflow/stream", async (req: FastifyRequest, reply: FastifyReply) => {
    const input = req.body as SSERequestBody;
    const executionId = uuidv4();

    // 设置 SSE 响应头
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no"); // 禁用 nginx 缓冲

    // CORS 头（允许前端直接访问）
    reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    reply.raw.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    reply.raw.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // 初始化数据库记录
    const db = createDb();
    try {
      // 尝试获取或创建默认用户
      const { users } = await import("@devscope/db");
      const existingUsers = await db.select().from(users).limit(1);
      let userId = input.userId;

      if (!userId && existingUsers.length === 0) {
        // 创建默认用户
        const [newUser] = await db.insert(users).values({
          username: "default",
          email: "default@devscope.local",
        }).returning();
        userId = newUser.id;
      } else if (!userId && existingUsers.length > 0) {
        userId = existingUsers[0].id;
      }

      await db.insert(workflowExecutions).values({
        executionId,
        userId: userId!,
        workflowId: "agent_competitive_analysis",
        workflowType: input.analysisType,
        status: "running",
        input: input as any,
        startedAt: new Date(),
      });
    } catch (e) {
      console.error("[SSE] Failed to create execution record:", e);
    }

    // 立即发送 executionId，前端可用于恢复状态
    sendEvent(reply, {
      type: "init",
      data: {
        executionId,
        timestamp: new Date().toISOString(),
      },
    });

    try {
      // 根据分析类型选择对应的系统提示词
      const getSystemPrompt = (analysisType: string): string => {
        switch (analysisType) {
          case "health_report":
            return HEALTH_REPORT_SYSTEM_PROMPT;
          case "single_repo":
            return SINGLE_REPO_ANALYSIS_SYSTEM_PROMPT;
          case "competitive_landscape":
          default:
            return COMPETITIVE_ANALYSIS_SYSTEM_PROMPT;
        }
      };

      // 创建终端输出拦截器
      const cleanupTerminal = createTerminalInterceptor(reply);

      try {
        // 创建 Agent
        const agent = createAgent({
          systemPrompt: getSystemPrompt(input.analysisType),
        });

        // 构建分析提示词
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
- 确保每个分析结论都有数据支撑，并在报告中标注数据来源`;

        // 流式回调
        const callbacks: StreamCallbacks = {
          onText: (text) => {
            sendEvent(reply, {
              type: "text",
              data: { text, timestamp: new Date().toISOString() },
            });
          },
          onToolUse: (name, toolInput) => {
            sendEvent(reply, {
              type: "tool_use",
              data: { name, input: toolInput as Record<string, unknown>, timestamp: new Date().toISOString() },
            });
          },
          onToolResult: (name, result) => {
            sendEvent(reply, {
              type: "tool_result",
              data: { name, result, timestamp: new Date().toISOString() },
            });
          },
        };

        // 运行 Agent
        const result = await agent.stream(prompt, callbacks);

        // 生成结构化报告
        const report = await generateStructuredReport(
          executionId,
          result.toolCalls,
          input.repos,
          input.analysisType,
          result.output  // 传入 AI 的详细文本分析
        );

        // 保存报告
        const { reportId, path: reportPath } = await saveReport(executionId, report);

        // 发送报告事件
        sendEvent(reply, {
          type: "report",
          data: {
            reportId,
            reportPath,
            summary: report.executiveSummary.overview,
            timestamp: new Date().toISOString(),
          },
        });

        // 更新执行状态
        try {
          await db
            .update(workflowExecutions)
            .set({
              status: "completed",
              completedAt: new Date(),
              result: report as any,
            })
            .where(eq(workflowExecutions.executionId, executionId));
        } catch (e) {
          console.error("[SSE] Failed to update execution record:", e);
        }

        // 发送完成事件
        sendEvent(reply, {
          type: "complete",
          data: {
            executionId,
            status: "completed",
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        console.error("[SSE] Agent workflow error:", error);

        sendEvent(reply, {
          type: "complete",
          data: {
            executionId,
            status: "failed",
            error: errorMessage,
            timestamp: new Date().toISOString(),
          },
        });

        // 更新执行状态
        try {
          await db
            .update(workflowExecutions)
            .set({
              status: "failed",
              error: errorMessage,
            })
            .where(eq(workflowExecutions.executionId, executionId));
        } catch (e) {
          console.error("[SSE] Failed to update execution record:", e);
        }
      } finally {
        // 清理终端拦截器
        cleanupTerminal();
      }
    } catch (outerError) {
      console.error("[SSE] Outer error:", outerError);
    }

    reply.raw.end();
  });

  console.log("[SSE] Agent workflow SSE endpoint registered at POST /api/agent/workflow/stream");
}
