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
import { createDb } from "@devscope/db";

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
        status: z.enum(["pending", "running"]),
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
        status: z.enum(["pending", "running"]),
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
});

/**
 * 导出工作流路由器类型
 */
export type WorkflowRouter = typeof workflowRouter;
