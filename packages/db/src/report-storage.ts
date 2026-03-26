/**
 * @package @devscope/db
 * @description 报告存储服务
 *
 * 将 Agent 生成的分析报告保存到文件系统，
 * 支持 JSON 和 Markdown 两种格式。
 *
 * @module report-storage
 */

import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { competitiveAnalysisReportSchema } from "@devscope/shared";

// 本地推断类型，避免跨包类型导入问题
type CompetitiveAnalysisReport = z.infer<typeof competitiveAnalysisReportSchema>;

// ============================================================================
// 配置
// ============================================================================

/**
 * 报告存储根目录
 */
const REPORTS_DIR = path.resolve(process.cwd(), "reports");

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 确保报告目录存在
 */
async function ensureReportsDir(): Promise<void> {
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
  } catch {
    // 目录已存在，忽略错误
  }
}

/**
 * 格式化日期时间
 */
function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// Markdown 生成
// ============================================================================

/**
 * 生成 Markdown 格式的报告
 */
function generateMarkdown(report: CompetitiveAnalysisReport): string {
  const lines: string[] = [];

  // 标题
  lines.push(`# 竞争格局分析报告`);
  lines.push("");
  lines.push(`**报告 ID**: \`${report.reportId}\``);
  lines.push(`**生成时间**: ${formatDateTime(report.generatedAt)}`);
  lines.push(`**分析类型**: ${getAnalysisTypeLabel(report.analysisType)}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 执行摘要
  lines.push("## 执行摘要");
  lines.push("");
  lines.push(report.executiveSummary.overview);
  lines.push("");
  lines.push("### 关键发现");
  lines.push("");
  for (const finding of report.executiveSummary.keyFindings) {
    lines.push(`- ${finding}`);
  }
  lines.push("");
  lines.push("### 总体建议");
  lines.push("");
  lines.push(
    `**${getRecommendationLabel(report.executiveSummary.recommendation)}** ` +
      `(置信度: ${getConfidenceLabel(report.executiveSummary.confidenceLevel)})`
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // 详细分析
  lines.push("## 详细分析");
  lines.push("");
  lines.push("### 市场定位");
  lines.push("");
  lines.push("| 分类 | 项目 |");
  lines.push("|------|------|");
  lines.push(
    `| **领导者** | ${report.detailedAnalysis.marketPosition.leaders.join(", ") || "无"} |`
  );
  lines.push(
    `| **挑战者** | ${report.detailedAnalysis.marketPosition.challengers.join(", ") || "无"} |`
  );
  lines.push(
    `| **细分市场** | ${report.detailedAnalysis.marketPosition.niche.join(", ") || "无"} |`
  );
  lines.push(
    `| **新兴项目** | ${report.detailedAnalysis.marketPosition.emerging.join(", ") || "无"} |`
  );
  lines.push("");

  // 技术对比表
  lines.push("### 技术对比");
  lines.push("");
  lines.push("| 项目 | 语言 | Stars | Forks | 活跃度 |");
  lines.push("|------|------|-------|-------|--------|");
  for (const item of report.detailedAnalysis.technologyComparison) {
    lines.push(
      `| ${item.repo} | ${item.language || "N/A"} | ${formatNumber(item.stars)} | ` +
        `${formatNumber(item.forks)} | ${getActivityLabel(item.activityLevel)} |`
    );
  }
  lines.push("");

  // 社区指标表
  lines.push("### 社区指标");
  lines.push("");
  lines.push("| 项目 | 贡献者 | Issue 解决率 | 提交频率 |");
  lines.push("|------|--------|--------------|----------|");
  for (const item of report.detailedAnalysis.communityMetrics) {
    lines.push(
      `| ${item.repo} | ${item.contributorCount} | ${item.issueResolutionRate}% | ` +
        `${getCommitFrequencyLabel(item.commitFrequency)} |`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // 风险矩阵
  lines.push("## 风险矩阵");
  lines.push("");
  lines.push(`**总体风险等级**: ${getRiskLabel(report.riskMatrix.overallRisk)}`);
  lines.push("");
  if (report.riskMatrix.risks.length > 0) {
    lines.push("| 项目 | 类别 | 描述 | 严重度 | 缓解措施 |");
    lines.push("|------|------|------|--------|----------|");
    for (const risk of report.riskMatrix.risks) {
      lines.push(
        `| ${risk.repo} | ${getRiskCategoryLabel(risk.category)} | ${risk.description} | ` +
          `${risk.severity}/10 | ${risk.mitigation || "N/A"} |`
      );
    }
  } else {
    lines.push("_暂无风险项_");
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // 投资建议
  lines.push("## 投资建议");
  lines.push("");
  if (report.investmentRecommendations.topPick) {
    lines.push(`- **首选项目**: ${report.investmentRecommendations.topPick}`);
  }
  lines.push(
    `- **关注列表**: ${report.investmentRecommendations.watchList.join(", ") || "无"}`
  );
  lines.push(
    `- **规避列表**: ${report.investmentRecommendations.avoidList.join(", ") || "无"}`
  );
  lines.push("");
  lines.push("### 理由");
  lines.push("");
  lines.push(report.investmentRecommendations.rationale);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 数据来源
  lines.push("## 数据来源");
  lines.push("");
  lines.push("> 以下为本报告的数据来源，确保分析结论可追溯、可验证。");
  lines.push("");
  for (const source of report.dataSources) {
    lines.push(
      `- **${getDataSourceLabel(source.type)}**: ${source.repo} ` +
        `(${formatDateTime(source.timestamp)}) - ${source.details}`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // 工具调用记录
  if (report.toolOutputs.length > 0) {
    lines.push("## 工具调用记录");
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>点击展开查看详细工具调用记录</summary>");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(report.toolOutputs, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // 页脚
  lines.push("---");
  lines.push("");
  lines.push(`*本报告由 DevScope AI 自动生成于 ${formatDateTime(new Date())}*`);

  return lines.join("\n");
}

// ============================================================================
// 标签转换函数
// ============================================================================

function getAnalysisTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    competitive_landscape: "竞争格局分析",
    health_report: "健康度报告",
    single_repo: "单仓库分析",
  };
  return labels[type] || type;
}

function getRecommendationLabel(rec: string): string {
  const labels: Record<string, string> = {
    invest: "建议投资",
    watch: "建议观望",
    avoid: "建议规避",
    mixed: "混合建议",
  };
  return labels[rec] || rec;
}

function getConfidenceLabel(level: string): string {
  const labels: Record<string, string> = {
    high: "高",
    medium: "中",
    low: "低",
  };
  return labels[level] || level;
}

function getActivityLabel(level: string): string {
  const labels: Record<string, string> = {
    high: "🟢 高",
    medium: "🟡 中",
    low: "🟠 低",
    dead: "🔴 停滞",
  };
  return labels[level] || level;
}

function getRiskLabel(level: string): string {
  const labels: Record<string, string> = {
    low: "🟢 低风险",
    medium: "🟡 中等风险",
    high: "🟠 高风险",
    critical: "🔴 严重风险",
  };
  return labels[level] || level;
}

function getRiskCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    technical: "技术风险",
    community: "社区风险",
    business: "商业风险",
    compliance: "合规风险",
  };
  return labels[category] || category;
}

function getDataSourceLabel(type: string): string {
  const labels: Record<string, string> = {
    github_api: "GitHub API",
    ossinsight: "OSSInsight",
    ai_analysis: "AI 分析",
  };
  return labels[type] || type;
}

function getCommitFrequencyLabel(freq: string): string {
  const labels: Record<string, string> = {
    daily: "每日",
    weekly: "每周",
    monthly: "每月",
    sporadic: "不定期",
  };
  return labels[freq] || freq;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 保存报告到文件系统
 *
 * @param executionId - 执行 ID
 * @param report - 报告数据
 * @returns 报告 ID 和存储路径
 */
export async function saveReport(
  executionId: string,
  report: CompetitiveAnalysisReport
): Promise<{ reportId: string; path: string }> {
  await ensureReportsDir();

  const reportId = report.reportId || uuidv4();
  const reportDir = path.join(REPORTS_DIR, executionId);

  await fs.mkdir(reportDir, { recursive: true });

  // 保存 JSON 版本
  const jsonPath = path.join(reportDir, "report.json");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  // 保存 Markdown 版本
  const mdPath = path.join(reportDir, "report.md");
  const markdown = generateMarkdown(report);
  await fs.writeFile(mdPath, markdown, "utf-8");

  // 保存元数据
  const metaPath = path.join(reportDir, "meta.json");
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        reportId,
        executionId,
        generatedAt: report.generatedAt,
        analysisType: report.analysisType,
        repos: report.detailedAnalysis.technologyComparison.map((t: { repo: string }) => t.repo),
      },
      null,
      2
    ),
    "utf-8"
  );

  return { reportId, path: reportDir };
}

/**
 * 从文件系统加载报告
 *
 * @param executionId - 执行 ID
 * @returns 报告数据，如果不存在则返回 null
 */
export async function loadReport(executionId: string): Promise<CompetitiveAnalysisReport | null> {
  try {
    const reportPath = path.join(REPORTS_DIR, executionId, "report.json");
    const content = await fs.readFile(reportPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 加载报告的 Markdown 内容
 *
 * @param executionId - 执行 ID
 * @returns Markdown 内容，如果不存在则返回 null
 */
export async function loadReportMarkdown(executionId: string): Promise<string | null> {
  try {
    const mdPath = path.join(REPORTS_DIR, executionId, "report.md");
    return await fs.readFile(mdPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 列出所有报告
 *
 * @returns 报告元数据列表
 */
export async function listReports(): Promise<
  Array<{
    executionId: string;
    reportId: string;
    generatedAt: string;
    analysisType: string;
    repos: string[];
  }>
> {
  await ensureReportsDir();

  const dirs = await fs.readdir(REPORTS_DIR);
  const reports: Array<{
    executionId: string;
    reportId: string;
    generatedAt: string;
    analysisType: string;
    repos: string[];
  }> = [];

  for (const dir of dirs) {
    try {
      const metaPath = path.join(REPORTS_DIR, dir, "meta.json");
      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);
      reports.push({
        executionId: dir,
        ...meta,
      });
    } catch {
      // 忽略无效目录
    }
  }

  // 按生成时间倒序排列
  reports.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

  return reports;
}

/**
 * 删除报告
 *
 * @param executionId - 执行 ID
 */
export async function deleteReport(executionId: string): Promise<void> {
  const reportDir = path.join(REPORTS_DIR, executionId);
  await fs.rm(reportDir, { recursive: true, force: true });
}

/**
 * 获取报告存储目录
 */
export function getReportsDir(): string {
  return REPORTS_DIR;
}
