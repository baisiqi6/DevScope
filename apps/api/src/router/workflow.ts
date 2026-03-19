/**
 * @package @devscope/api
 * @description 工作流 tRPC 路由
 *
 * 提供与 Langtum 工作流平台的集成接口。
 *
 * @module router/workflow
 */

import { z } from "zod";
import { publicProcedure } from "../trpc";
import { router } from "../trpc";
import {
  createLangtumClient,
  LangtumClient,
  type WorkflowExecutionDetail,
} from "@devscope/ai";
import { createDb, createGitHubCollector, createPipeline } from "@devscope/db";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 每日健康度报告触发请求
 */
const dailyHealthReportInputSchema = z.object({
  /** 用户 ID */
  user_id: z.number(),
  /** 关注的仓库列表 */
  watchlist: z.array(z.string()).min(1),
  /** 报告日期（可选，格式: YYYY-MM-DD） */
  report_date: z.string().optional(),
});

/**
 * 快速评估触发请求
 */
const quickAssessmentInputSchema = z.object({
  /** GitHub 仓库（格式: owner/repo） */
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "Invalid repository format. Expected: owner/repo"),
  /** 用户 ID */
  user_id: z.number(),
  /** 评估深度（可选） */
  assessment_depth: z.enum(["standard", "deep"]).optional(),
});

/**
 * 通用工作流触发输入（Langcore 平台）
 */
const customWorkflowInputSchema = z.object({
  /** 工作流 ID */
  workflowId: z.string().min(1),
  /** 输入变量（对应工作流定义的 input） */
  input: z.record(z.unknown()),
  /** 运行模式（默认 sync） */
  runMode: z.enum(["sync", "async"]).default("sync"),
});

/**
 * 单仓库分析输入
 */
const analyzeRepoInputSchema = z.object({
  /** GitHub 仓库（格式: owner/repo） */
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "Invalid repository format. Expected: owner/repo"),
  /** 工作流 ID（可选） */
  workflowId: z.string().optional(),
});

/**
 * GitHub 仓库详细信息（发送给 Langcore 工作流）
 */
const repoDataSchema = z.object({
  full_name: z.string(),
  name: z.string(),
  owner: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  stars: z.number(),
  language: z.string().nullable(),
  updated_at: z.string(),
});

/**
 * 完整分析流程输入（拉取关注列表 -> 采集数据 -> Langtum分析 -> 存储结果）
 */
const analyzeFollowingInputSchema = z.object({
  /** 工作流 ID（默认使用 cmmlmarrt010hgjpg0qi53204） */
  workflowId: z.string().optional(),
  /** 关注列表上限 */
  limit: z.number().min(1).max(100).default(30),
  /** 是否采集仓库数据到本地数据库（可选，耗时较长） */
  collectData: z.boolean().default(false),
});

/**
 * 工作流执行详情响应
 */
const workflowExecutionDetailSchema = z.object({
  execution_id: z.string(),
  workflow_id: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  started_at: z.string(),
  current_node: z.string().optional(),
  progress_percent: z.number().int().min(0).max(100).optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
  estimated_completion_at: z.string().optional(),
});

/**
 * 每日健康度报告结果
 */
const dailyHealthReportResultSchema = z.object({
  report_id: z.string(),
  user_id: z.number(),
  report_date: z.string(),
  total_repos: z.number(),
  summary: z.string(),
  analyses: z.array(
    z.object({
      repo: z.string(),
      health_score: z.number().min(0).max(100),
      activity_level: z.enum(["high", "medium", "low", "dead"]),
      key_metrics: z.object({
        stars_growth: z.number(),
        issue_resolution_rate: z.number(),
        contributor_diversity: z.number(),
      }),
      risk_factors: z.array(z.string()),
      opportunities: z.array(z.string()),
      recommendation: z.enum(["invest", "watch", "avoid"]),
    })
  ),
  attention_required: z.array(
    z.object({
      repo: z.string(),
      reason: z.string(),
      previous_score: z.number(),
      current_score: z.number(),
    })
  ),
  generated_at: z.string(),
});

/**
 * 快速评估结果
 */
const quickAssessmentResultSchema = z.object({
  assessment_id: z.string(),
  repo: z.string(),
  overall_score: z.number().min(0).max(100),
  recommendation: z.enum(["highly_recommended", "recommended", "caution", "not_recommended"]),
  executive_summary: z.string(),
  code_quality: z.object({
    quality_score: z.number().min(0).max(100),
    architecture_rating: z.enum(["excellent", "good", "fair", "poor"]),
    documentation_completeness: z.number().min(0).max(100),
    test_coverage_estimate: z.number().min(0).max(100),
    dependency_health: z.enum(["healthy", "outdated", "vulnerable"]),
    ci_cd_presence: z.boolean(),
    findings: z.array(z.string()),
    recommendations: z.array(z.string()),
  }),
  community_health: z.object({
    activity_level: z.enum(["high", "medium", "low", "dormant"]),
    commit_frequency: z.enum(["daily", "weekly", "monthly", "sporadic"]),
    avg_response_time_hours: z.number(),
    contributor_count: z.number(),
    contributor_diversity: z.enum(["high", "medium", "low"]),
    community_mentions: z.number(),
    trend: z.enum(["growing", "stable", "declining"]),
  }),
  competitive_analysis: z.object({
    technology_category: z.string(),
    competitors: z.array(
      z.object({
        name: z.string(),
        repo: z.string(),
        stars: z.number(),
        relationship: z.enum(["direct", "indirect", "alternative"]),
      })
    ),
    market_position: z.enum(["leader", "challenger", "niche", "emerging"]),
    competitive_advantages: z.array(z.string()),
    competitive_disadvantages: z.array(z.string()),
  }),
  risk_assessment: z.object({
    overall_risk_level: z.enum(["low", "medium", "high", "critical"]),
    risks: z.array(
      z.object({
        category: z.enum(["technical", "community", "business", "compliance"]),
        description: z.string(),
        severity: z.enum(["low", "medium", "high", "critical"]),
        mitigation: z.string(),
      })
    ),
    risk_score: z.number().min(0).max(100),
  }),
  key_highlights: z.array(z.string()),
  key_concerns: z.array(z.string()),
  next_steps: z.array(z.string()),
  assessed_at: z.string(),
});

// ============================================================================
// 工作流路由器
// ============================================================================

/**
 * 工作流路由器
 * @description 包含所有工作流相关的 API 路由
 */
export const workflowRouter = router({
  /**
   * 触发每日健康度报告工作流
   * @description 异步触发工作流，立即返回 execution_id
   */
  triggerDailyReport: publicProcedure
    .input(dailyHealthReportInputSchema)
    .output(
      z.object({
        execution_id: z.string(),
        workflow_id: z.string(),
        status: z.string(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const client = createLangtumClient();

      // 触发工作流
      const response = await client.triggerDailyHealthReport({
        user_id: input.user_id,
        watchlist: input.watchlist,
        report_date: input.report_date,
      });

      // 保存执行记录到数据库
      const db = createDb();
      // TODO: 实现数据库保存逻辑

      return {
        execution_id: response.execution_id,
        workflow_id: response.workflow_id,
        status: response.status,
        message: "Daily health report workflow triggered successfully",
      };
    }),

  /**
   * 触发快速评估工作流
   * @description 异步触发工作流，立即返回 execution_id
   */
  triggerQuickAssessment: publicProcedure
    .input(quickAssessmentInputSchema)
    .output(
      z.object({
        execution_id: z.string(),
        workflow_id: z.string(),
        status: z.string(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const client = createLangtumClient();

      // 触发工作流
      const response = await client.triggerQuickAssessment({
        repo: input.repo,
        user_id: input.user_id,
        assessment_depth: input.assessment_depth,
      });

      // 保存执行记录到数据库
      const db = createDb();
      // TODO: 实现数据库保存逻辑

      return {
        execution_id: response.execution_id,
        workflow_id: response.workflow_id,
        status: response.status,
        message: "Quick assessment workflow triggered successfully",
      };
    }),

  /**
   * 触发自定义工作流（通用方法）
   * @description 支持任意 Langcore 工作流触发
   */
  triggerCustomWorkflow: publicProcedure
    .input(customWorkflowInputSchema)
    .output(
      z.object({
        execution_id: z.string(),
        workflow_id: z.string(),
        status: z.string(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const client = createLangtumClient();

      // 触发工作流
      const response = await client.triggerCustomWorkflow(
        input.workflowId,
        input.input,
        input.runMode
      );

      return {
        execution_id: response.execution_id,
        workflow_id: response.workflow_id,
        status: response.status,
        message: "Custom workflow triggered successfully",
      };
    }),

  /**
   * 拉取关注列表并触发 Langcore 工作流
   * @description 自动获取 GitHub 关注列表，将仓库详细信息发送到 Langcore 工作流
   */
  triggerWithFollowing: publicProcedure
    .input(
      z.object({
        workflowId: z.string().optional(),
        limit: z.number().min(1).max(100).default(30),
      })
    )
    .output(
      z.object({
        execution_id: z.string(),
        workflow_id: z.string(),
        status: z.string(),
        message: z.string(),
        following_count: z.number(),
        repos: z.array(z.string()),
        repos_data: z.array(repoDataSchema),
      })
    )
    .mutation(async ({ input }) => {
      const github = createGitHubCollector();

      // 拉取关注列表
      const followingRepos = await github.getFollowing(undefined, input.limit);
      const repos = followingRepos.map((repo) => repo.fullName);

      // 转换为工作流所需格式 - 确保类型正确
      const reposData = followingRepos.map((repo) => ({
        full_name: String(repo.fullName),
        name: String(repo.name),
        owner: String(repo.owner),
        description: repo.description ?? null,
        url: String(repo.url),
        stars: Number(repo.stars),
        language: repo.language ?? null,
        updated_at: repo.updatedAt instanceof Date
          ? repo.updatedAt.toISOString()
          : String(repo.updatedAt),
      }));

      console.log(`[triggerWithFollowing] Found ${repos.length} following repos`);

      // 使用指定的工作流 ID 或默认的 cmmlmarrt010hgjpg0qi53204
      const workflowId = input.workflowId || "cmmlmarrt010hgjpg0qi53204";

      // 构建工作流输入（发送详细仓库数据）
      const workflowInput = {
        shuru: JSON.stringify(reposData),
      };

      const client = createLangtumClient();

      try {
        // 触发工作流
        const response = await client.triggerCustomWorkflow(
          workflowId,
          workflowInput,
          "sync"
        );

        console.log(`[triggerWithFollowing] Workflow triggered: ${response.execution_id}`);

        return {
          execution_id: String(response.execution_id),
          workflow_id: String(response.workflow_id),
          status: String(response.status),
          message: "Following repos workflow triggered successfully",
          following_count: repos.length,
          repos,
          repos_data: reposData,
        };
      } catch (error) {
        console.error("[triggerWithFollowing] Workflow error:", error);
        throw error;
      }
    }),

  /**
   * 完整分析流程：拉取关注列表 -> 采集数据 -> Langtum分析 -> 存储结果
   * @description 一键完成仓库数据采集和 AI 分析，返回结构化分析报告
   */
  analyzeFollowing: publicProcedure
    .input(analyzeFollowingInputSchema)
    .output(
      z.object({
        execution_id: z.string(),
        workflow_id: z.string(),
        status: z.string(),
        message: z.string(),
        following_count: z.number(),
        repos: z.array(z.string()),
        repos_data: z.array(repoDataSchema),
        analysis_result: z.string().optional(),
        collected_count: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const github = createGitHubCollector();
      const db = createDb();

      // 1. 拉取关注列表
      console.log("[analyzeFollowing] Step 1: Fetching following repos...");
      const followingRepos = await github.getFollowing(undefined, input.limit);
      const repos = followingRepos.map((repo) => repo.fullName);

      // 转换为工作流所需格式 - 确保类型正确
      const reposData = followingRepos.map((repo) => ({
        full_name: String(repo.fullName),
        name: String(repo.name),
        owner: String(repo.owner),
        description: repo.description ?? null,
        url: String(repo.url),
        stars: Number(repo.stars),
        language: repo.language ?? null,
        updated_at: repo.updatedAt instanceof Date
          ? repo.updatedAt.toISOString()
          : String(repo.updatedAt),
      }));

      console.log(`[analyzeFollowing] Found ${repos.length} following repos`);

      // 2. 可选：采集仓库数据到本地数据库
      let collectedCount = 0;
      if (input.collectData) {
        console.log("[analyzeFollowing] Step 2: Collecting repository data...");
        const pipeline = createPipeline(db);

        for (const repo of repos) {
          try {
            console.log(`[analyzeFollowing] Collecting: ${repo}`);
            await pipeline.run({ repo });
            collectedCount++;
          } catch (err) {
            console.error(`[analyzeFollowing] Failed to collect ${repo}:`, err);
          }
        }
        console.log(`[analyzeFollowing] Collected ${collectedCount} repos`);
      }

      // 3. 触发 Langtum 工作流进行分析
      console.log("[analyzeFollowing] Step 3: Triggering Langtum workflow...");
      const workflowId = input.workflowId || "cmmlmarrt010hgjpg0qi53204";
      // 发送详细仓库数据
      const workflowInput = {
        shuru: JSON.stringify(reposData),
      };

      const client = createLangtumClient();

      try {
        // 使用同步模式等待分析结果
        console.log(`[analyzeFollowing] Triggering workflow: ${workflowId}`);
        console.log(`[analyzeFollowing] Input length: ${reposData.length} repos`);
        const response = await client.triggerCustomWorkflow(
          workflowId,
          workflowInput,
          "sync"
        );

        console.log(`[analyzeFollowing] ===== Langtum API Response =====`);
        console.log(`[analyzeFollowing] Full response:`, JSON.stringify(response, null, 2));
        console.log(`[analyzeFollowing] execution_id: ${response.execution_id}`);
        console.log(`[analyzeFollowing] workflow_id: ${response.workflow_id}`);
        console.log(`[analyzeFollowing] status: ${response.status}`);
        console.log(`[analyzeFollowing] result type: ${typeof response.result}`);
        console.log(`[analyzeFollowing] result value:`, response.result);
        console.log(`[analyzeFollowing] ===== End Response =====`);

        // 将 analysis_result 转换为字符串以便传输
        let analysisResult: string | undefined;
        if (response.result) {
          try {
            analysisResult = typeof response.result === "string"
              ? response.result
              : JSON.stringify(response.result);
          } catch (e) {
            console.error("[analyzeFollowing] Failed to stringify result:", e);
            analysisResult = String(response.result);
          }
        }

        // 4. 返回结果（分析结果在 response.result 中）
        return {
          execution_id: String(response.execution_id),
          workflow_id: String(response.workflow_id),
          status: String(response.status),
          message: "Analysis completed successfully",
          following_count: repos.length,
          repos,
          repos_data: reposData,
          analysis_result: analysisResult,
          collected_count: collectedCount,
        };
      } catch (error) {
        console.error("[analyzeFollowing] Workflow error:", error);
        throw error;
      }
    }),

  /**
   * 分析单个仓库的健康度
   * @description 获取仓库详细信息并发送到 Langcore 工作流进行分析
   */
  analyzeRepo: publicProcedure
    .input(analyzeRepoInputSchema)
    .output(
      z.object({
        execution_id: z.string(),
        workflow_id: z.string(),
        status: z.string(),
        message: z.string(),
        repo_data: repoDataSchema,
        analysis_result: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const github = createGitHubCollector();

      // 解析仓库名
      const [owner, name] = input.repo.split("/");

      // 获取仓库详细信息
      console.log(`[analyzeRepo] Fetching repository: ${input.repo}`);
      const repoInfo = await github.getRepository(owner, name);

      // 转换为工作流所需格式 - 确保类型正确
      const repoData = {
        full_name: String(repoInfo.fullName),
        name: String(repoInfo.name),
        owner: String(repoInfo.owner),
        description: repoInfo.description ?? null,
        url: String(repoInfo.url),
        stars: Number(repoInfo.stars),
        language: repoInfo.language ?? null,
        updated_at: repoInfo.updatedAt instanceof Date
          ? repoInfo.updatedAt.toISOString()
          : String(repoInfo.updatedAt),
      };

      console.log(`[analyzeRepo] Repo data fetched: ${repoData.full_name}`);

      // 使用指定的工作流 ID 或默认的工作流
      const workflowId = input.workflowId || "cmmlmarrt010hgjpg0qi53204";

      // 发送详细仓库数据
      const workflowInput = {
        shuru: JSON.stringify([repoData]),
      };

      const client = createLangtumClient();

      try {
        // 触发工作流进行分析
        console.log(`[analyzeRepo] Triggering workflow: ${workflowId}`);
        console.log(`[analyzeRepo] Input:`, JSON.stringify(workflowInput, null, 2));
        const response = await client.triggerCustomWorkflow(
          workflowId,
          workflowInput,
          "sync"
        );

        console.log(`[analyzeRepo] ===== Langtum API Response =====`);
        console.log(`[analyzeRepo] Full response:`, JSON.stringify(response, null, 2));
        console.log(`[analyzeRepo] execution_id: ${response.execution_id}`);
        console.log(`[analyzeRepo] workflow_id: ${response.workflow_id}`);
        console.log(`[analyzeRepo] status: ${response.status}`);
        console.log(`[analyzeRepo] result type: ${typeof response.result}`);
        console.log(`[analyzeRepo] result value:`, response.result);
        console.log(`[analyzeRepo] ===== End Response =====`);

        // 将 analysis_result 转换为字符串以便传输
        let analysisResult: string | undefined;
        if (response.result) {
          try {
            analysisResult = typeof response.result === "string"
              ? response.result
              : JSON.stringify(response.result);
          } catch (e) {
            console.error("[analyzeRepo] Failed to stringify result:", e);
            analysisResult = String(response.result);
          }
        }

        return {
          execution_id: String(response.execution_id),
          workflow_id: String(response.workflow_id),
          status: String(response.status),
          message: "Repository analysis completed successfully",
          repo_data: repoData,
          analysis_result: analysisResult,
        };
      } catch (error) {
        console.error("[analyzeRepo] Workflow error:", error);
        throw error;
      }
    }),

  /**
   * 查询工作流执行状态
   * @description 根据 execution_id 查询工作流执行状态和结果
   */
  getExecutionStatus: publicProcedure
    .input(
      z.object({
        execution_id: z.string(),
      })
    )
    .output(workflowExecutionDetailSchema)
    .query(async ({ input }) => {
      const client = createLangtumClient();

      // 从 Langtum 查询执行状态
      const detail = await client.getExecutionDetail(input.execution_id);

      // 更新数据库记录
      const db = createDb();
      // TODO: 实现数据库更新逻辑

      return detail;
    }),

  /**
   * 获取用户的每日报告列表
   * @description 查询用户历史每日报告
   */
  listDailyReports: publicProcedure
    .input(
      z.object({
        user_id: z.number(),
        limit: z.number().min(1).max(100).default(10),
        offset: z.number().min(0).default(0),
      })
    )
    .output(
      z.object({
        reports: z.array(
          z.object({
            report_id: z.string(),
            report_date: z.string(),
            total_repos: z.number(),
            summary: z.string(),
            generated_at: z.string(),
          })
        ),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
      })
    )
    .query(async ({ input }) => {
      const db = createDb();

      // TODO: 实现数据库查询逻辑
      // 临时返回空数组
      return {
        reports: [],
        total: 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * 获取每日报告详情
   * @description 根据 report_id 获取完整报告内容
   */
  getDailyReportDetail: publicProcedure
    .input(
      z.object({
        report_id: z.string(),
      })
    )
    .output(dailyHealthReportResultSchema)
    .query(async ({ input }) => {
      const db = createDb();

      // TODO: 实现数据库查询逻辑
      throw new Error("Report not found");
    }),

  /**
   * 获取用户的快速评估列表
   * @description 查询用户历史快速评估
   */
  listQuickAssessments: publicProcedure
    .input(
      z.object({
        user_id: z.number(),
        repo: z.string().optional(), // 可选：过滤特定仓库
        limit: z.number().min(1).max(100).default(10),
        offset: z.number().min(0).default(0),
      })
    )
    .output(
      z.object({
        assessments: z.array(
          z.object({
            assessment_id: z.string(),
            repo: z.string(),
            overall_score: z.number(),
            recommendation: z.enum(["highly_recommended", "recommended", "caution", "not_recommended"]),
            assessed_at: z.string(),
          })
        ),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
      })
    )
    .query(async ({ input }) => {
      const db = createDb();

      // TODO: 实现数据库查询逻辑
      // 临时返回空数组
      return {
        assessments: [],
        total: 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * 获取快速评估详情
   * @description 根据 assessment_id 获取完整评估内容
   */
  getQuickAssessmentDetail: publicProcedure
    .input(
      z.object({
        assessment_id: z.string(),
      })
    )
    .output(quickAssessmentResultSchema)
    .query(async ({ input }) => {
      const db = createDb();

      // TODO: 实现数据库查询逻辑
      throw new Error("Assessment not found");
    }),

  /**
   * 取消正在运行的工作流
   * @description 取消指定 execution_id 的工作流执行
   */
  cancelExecution: publicProcedure
    .input(
      z.object({
        execution_id: z.string(),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      // TODO: 实现 Langtum API 的取消接口（如果支持）
      // 当前 Langtum API 可能不支持取消，需要确认
      throw new Error("Cancel operation not yet implemented");
    }),

  /**
   * 获取仓库详细统计数据
   * @description 获取仓库的完整统计数据，包括代码活跃度、Issues、PRs、贡献者等
   */
  getRepositoryStats: publicProcedure
    .input(
      z.object({
        repo: z.string().regex(/^[^/]+\/[^/]+$/, "Invalid repository format. Expected: owner/repo"),
      })
    )
    .output(
      z.object({
        repository: z.object({
          fullName: z.string(),
          name: z.string(),
          owner: z.string(),
          description: z.string().nullable(),
          url: z.string(),
          stars: z.number(),
          forks: z.number(),
          openIssues: z.number(),
          language: z.string().nullable(),
          license: z.string().nullable(),
          createdAt: z.string(),
          updatedAt: z.string(),
          pushedAt: z.string(),
        }),
        commitFrequency: z.object({
          lastCommitDate: z.string(),
          commitsLast7Days: z.number(),
          commitsLast30Days: z.number(),
          commitsLast90Days: z.number(),
          totalBranches: z.number(),
          totalTags: z.number(),
          defaultBranch: z.string(),
        }),
        issuesStats: z.object({
          openIssues: z.number(),
          closedIssues: z.number(),
          totalIssues: z.number(),
          avgResolutionTime: z.number(),
          openIssuesLast7Days: z.number(),
          closedIssuesLast7Days: z.number(),
          issuesWithNoAssignee: z.number(),
          issuesStaleOver30Days: z.number(),
        }),
        prStats: z.object({
          openPRs: z.number(),
          mergedPRs: z.number(),
          closedPRs: z.number(),
          totalPRs: z.number(),
          avgMergeTime: z.number(),
          openPRsLast7Days: z.number(),
          mergedPRsLast7Days: z.number(),
          prsWithNoReview: z.number(),
          prsStaleOver30Days: z.number(),
        }),
        contributorsStats: z.object({
          totalContributors: z.number(),
          topContributors: z.array(
            z.object({
              login: z.string(),
              contributions: z.number(),
            })
          ),
          newContributorsLast30Days: z.number(),
        }),
        communityFiles: z.object({
          hasContributing: z.boolean(),
          hasCodeOfConduct: z.boolean(),
          hasSecurity: z.boolean(),
          hasSupport: z.boolean(),
          hasLicense: z.boolean(),
          hasReadme: z.boolean(),
        }),
      })
    )
    .query(async ({ input }) => {
      const github = createGitHubCollector();

      const [owner, name] = input.repo.split("/");

      console.log(`[getRepositoryStats] Fetching stats for: ${input.repo}`);

      const stats = await github.getRepositoryStats(owner, name);

      return {
        repository: {
          fullName: stats.repository.fullName,
          name: stats.repository.name,
          owner: stats.repository.owner,
          description: stats.repository.description,
          url: stats.repository.url,
          stars: stats.repository.stars,
          forks: stats.repository.forks,
          openIssues: stats.repository.openIssues,
          language: stats.repository.language,
          license: stats.repository.license,
          createdAt: stats.repository.createdAt.toISOString(),
          updatedAt: stats.repository.updatedAt.toISOString(),
          pushedAt: stats.repository.pushedAt.toISOString(),
        },
        commitFrequency: {
          lastCommitDate: stats.commitFrequency.lastCommitDate.toISOString(),
          commitsLast7Days: stats.commitFrequency.commitsLast7Days,
          commitsLast30Days: stats.commitFrequency.commitsLast30Days,
          commitsLast90Days: stats.commitFrequency.commitsLast90Days,
          totalBranches: stats.commitFrequency.totalBranches,
          totalTags: stats.commitFrequency.totalTags,
          defaultBranch: stats.commitFrequency.defaultBranch,
        },
        issuesStats: stats.issuesStats,
        prStats: stats.prStats,
        contributorsStats: stats.contributorsStats,
        communityFiles: stats.communityFiles,
      };
    }),
});

/**
 * 导出工作流路由器类型
 */
export type WorkflowRouter = typeof workflowRouter;
