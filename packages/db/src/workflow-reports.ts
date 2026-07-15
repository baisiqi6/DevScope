/**
 * 工作流报告数据库存储。
 *
 * PostgreSQL 是完整报告的事实来源；文件系统只保留为可选导出缓存。
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { competitiveAnalysisReportSchema } from "@devscope/shared";
import type { Db } from "./index";
import { workflowExecutions, workflowReports } from "./schema";

// 本地从 schema 推断，避免并行 watch 时依赖 shared 尚未刷新的声明文件。
type CompetitiveAnalysisReport = z.infer<typeof competitiveAnalysisReportSchema>;

export interface CompleteWorkflowWithReportInput {
  userId: number;
  repoFullName: string | null;
  report: CompetitiveAnalysisReport;
}

export interface WorkflowReportSummary {
  reportId: string;
  executionId: string;
  summary: string | null;
  createdAt: Date;
}

/**
 * 在一个事务内持久化报告并完成工作流。
 * 任何一步失败都会回滚，避免出现“执行已完成但报告不可读”的状态。
 */
export async function completeWorkflowWithReport(
  db: Db,
  input: CompleteWorkflowWithReportInput
): Promise<void> {
  const report = competitiveAnalysisReportSchema.parse(input.report);
  const completedAt = new Date();

  await db.transaction(async (tx) => {
    const updatedExecutions = await tx
      .update(workflowExecutions)
      .set({
        status: "completed",
        completedAt,
        result: report,
        progressPercent: 100,
        currentNode: "completed",
        durationMs: sql<number>`GREATEST(0, ROUND(EXTRACT(EPOCH FROM (${completedAt} - ${workflowExecutions.startedAt})) * 1000))::integer`,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(workflowExecutions.executionId, report.executionId),
          eq(workflowExecutions.userId, input.userId),
          eq(workflowExecutions.status, "running")
        )
      )
      .returning({ executionId: workflowExecutions.executionId });

    if (updatedExecutions.length !== 1) {
      throw new Error(`工作流执行记录不可完成: ${report.executionId}`);
    }

    await tx.insert(workflowReports).values({
      reportId: report.reportId,
      executionId: report.executionId,
      userId: input.userId,
      reportType: "quick_assessment",
      reportData: report,
      summary: report.executiveSummary.overview,
      repoFullName: input.repoFullName,
    });
  });
}

/** 获取当前用户的单份报告，并在返回前校验数据库 JSON。 */
export async function getWorkflowReportByExecutionId(
  db: Db,
  executionId: string,
  userId: number
): Promise<CompetitiveAnalysisReport | null> {
  const [row] = await db
    .select({ reportData: workflowReports.reportData })
    .from(workflowReports)
    .where(
      and(
        eq(workflowReports.executionId, executionId),
        eq(workflowReports.userId, userId)
      )
    )
    .limit(1);

  return row ? competitiveAnalysisReportSchema.parse(row.reportData) : null;
}

/** 按仓库列出当前用户未归档的报告，最新报告优先。 */
export async function listWorkflowReportsByRepository(
  db: Db,
  repoFullName: string,
  userId: number
): Promise<WorkflowReportSummary[]> {
  return db
    .select({
      reportId: workflowReports.reportId,
      executionId: workflowReports.executionId,
      summary: workflowReports.summary,
      createdAt: workflowReports.createdAt,
    })
    .from(workflowReports)
    .where(
      and(
        eq(workflowReports.userId, userId),
        eq(workflowReports.repoFullName, repoFullName),
        eq(workflowReports.reportType, "quick_assessment"),
        eq(workflowReports.isArchived, false)
      )
    )
    .orderBy(desc(workflowReports.createdAt));
}

/** 文件缓存回退前确认执行记录属于当前用户。 */
export async function ownsWorkflowExecution(
  db: Db,
  executionId: string,
  userId: number
): Promise<boolean> {
  const rows = await db
    .select({ executionId: workflowExecutions.executionId })
    .from(workflowExecutions)
    .where(
      and(
        eq(workflowExecutions.executionId, executionId),
        eq(workflowExecutions.userId, userId),
        eq(workflowExecutions.status, "completed")
      )
    )
    .limit(1);

  return rows.length === 1;
}
