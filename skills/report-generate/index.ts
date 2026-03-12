/**
 * @package skills/report-generate
 * @description 分析报告生成工具
 *
 * 基于仓库分析和原始数据生成综合报告。
 *
 * 支持管道模式（stdin 输入）
 *
 * @example
 * # 直接使用
 * ./report-generate/index.ts --title "2024年Q1开源生态报告"
 *
 * # 管道组合
 * cat analysis.json | ./report-generate/index.ts --format markdown
 */

import { z } from "zod";

// ============================================================================
// 输入验证
// ============================================================================

/**
 * 报告输入 Schema
 */
export const ReportInputSchema = z.object({
  /** 报告标题 */
  title: z.string().min(1),
  /** 报告类型 */
  type: z.enum(["summary", "detailed", "comparison"]).default("summary"),
  /** 分析数据（通常是仓库分析的数组） */
  analyses: z.array(z.any()).default([]),
  /** 额外内容 */
  content: z.string().optional(),
  /** 输出格式 */
  format: z.enum(["json", "markdown", "html"]).default("markdown"),
});

/**
 * 报告输出
 */
export interface Report {
  title: string;
  type: string;
  summary: string;
  sections: ReportSection[];
  generatedAt: string;
  metadata: ReportMetadata;
}

/**
 * 报告章节
 */
export interface ReportSection {
  title: string;
  content: string;
  level: number;
}

/**
 * 报告元数据
 */
export interface ReportMetadata {
  totalRepositories: number;
  topPerformers: string[];
  averageHealthScore: number;
}

// ============================================================================
// 报告生成
// ============================================================================

/**
 * 生成汇总报告
 */
function generateSummaryReport(data: any[]): Report {
  if (data.length === 0) {
    return {
      title: "Empty Report",
      type: "summary",
      summary: "没有可分析的数据",
      sections: [],
      generatedAt: new Date().toISOString(),
      metadata: {
        totalRepositories: 0,
        topPerformers: [],
        averageHealthScore: 0,
      },
    };
  }

  // 计算统计数据
  const healthScores = data
    .map((d) => d.healthScore)
    .filter((s): s is number => typeof s === "number");
  const avgScore =
    healthScores.length > 0
      ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length
      : 0;

  // 找出表现最好的仓库
  const sorted = [...data].sort(
    (a, b) => (b.healthScore || 0) - (a.healthScore || 0)
  );
  const topPerformers = sorted.slice(0, 5).map((d) => d.repository?.fullName || d.repo);

  // 生成总结
  const summary = generateSummaryText(data, avgScore);

  // 生成章节
  const sections: ReportSection[] = [
    {
      title: "执行摘要",
      content: summary,
      level: 1,
    },
    {
      title: "总体统计",
      content: `总仓库数: ${data.length}\n平均健康度: ${avgScore.toFixed(1)}`,
      level: 1,
    },
  ];

  // 添加各仓库详情
  if (data.length <= 10) {
    sections.push({
      title: "仓库详情",
      content: data
        .map((d) => {
          const name = d.repository?.fullName || d.repo || "Unknown";
          const score = d.healthScore || "N/A";
          const activity = d.activityLevel || "N/A";
          const recommendation = d.recommendation || "N/A";
          return `- **${name}**: 评分 ${score}, 活跃度 ${activity}, 建议 ${recommendation}`;
        })
        .join("\n"),
      level: 1,
    });
  }

  return {
    title: "Open Source Analysis Report",
    type: "summary",
    summary,
    sections,
    generatedAt: new Date().toISOString(),
    metadata: {
      totalRepositories: data.length,
      topPerformers,
      averageHealthScore: Math.round(avgScore),
    },
  };
}

/**
 * 生成总结文本
 */
function generateSummaryText(data: any[], avgScore: number): string {
  const count = data.length;
  const investCount = data.filter((d) => d.recommendation === "invest").length;
  const watchCount = data.filter((d) => d.recommendation === "watch").length;
  const avoidCount = data.filter((d) => d.recommendation === "avoid").length;

  let text = `本报告分析了 ${count} 个开源仓库。`;

  if (avgScore >= 70) {
    text += `整体表现良好，平均健康度为 ${avgScore.toFixed(1)} 分。`;
  } else if (avgScore >= 50) {
    text += `整体表现中等，平均健康度为 ${avgScore.toFixed(1)} 分。`;
  } else {
    text += `整体表现有待提升，平均健康度为 ${avgScore.toFixed(1)} 分。`;
  }

  text += `\n\n投资建议分布：`;
  text += `\n- 建议投资: ${investCount} 个`;
  text += `\n- 建议观望: ${watchCount} 个`;
  text += `\n- 建议避免: ${avoidCount} 个`;

  return text;
}

/**
 * 生成报告
 */
export function generateReport(
  input: z.infer<typeof ReportInputSchema>
): Report {
  switch (input.type) {
    case "summary":
      return generateSummaryReport(input.analyses);
    case "detailed":
      return generateDetailedReport(input);
    case "comparison":
      return generateComparisonReport(input.analyses);
    default:
      return generateSummaryReport(input.analyses);
  }
}

/**
 * 生成详细报告
 */
function generateDetailedReport(input: z.infer<typeof ReportInputSchema>): Report {
  const summary = generateSummaryReport(input.analyses);

  return {
    ...summary,
    type: "detailed",
    sections: [
      ...summary.sections,
      {
        title: "详细分析",
        content: input.content || "无额外内容",
        level: 1,
      },
    ],
  };
}

/**
 * 生成对比报告
 */
function generateComparisonReport(data: any[]): Report {
  const summary = generateSummaryReport(data);

  return {
    ...summary,
    type: "comparison",
    sections: [
      ...summary.sections,
      {
        title: "对比分析",
        content: generateComparisonContent(data),
        level: 1,
      },
    ],
  };
}

/**
 * 生成对比内容
 */
function generateComparisonContent(data: any[]): string {
  if (data.length < 2) {
    return "需要至少 2 个仓库进行对比分析";
  }

  const metrics = ["healthScore", "stars", "forks"];
  let content = "## 关键指标对比\n\n";

  for (const metric of metrics) {
    const sorted = [...data].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
    content += `### ${metric}\n`;
    content += sorted
      .map((d, i) => `${i + 1}. ${d.repository?.fullName || d.repo}: ${d[metric] || "N/A"}`)
      .join("\n");
    content += "\n\n";
  }

  return content;
}

// ============================================================================
// CLI 入口
// ============================================================================

/**
 * CLI 入口函数
 */
export async function main(args: string[]): Promise<void> {
  // 解析命令行参数
  let title = "Open Source Analysis Report";
  let type: "summary" | "detailed" | "comparison" = "summary";
  let format: "json" | "markdown" | "html" = "markdown";
  let content: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--title" && args[i + 1]) {
      title = args[i + 1];
      i++;
    } else if (arg === "--type" && args[i + 1]) {
      type = args[i + 1] as any;
      i++;
    } else if (arg === "--format" && args[i + 1]) {
      format = args[i + 1] as any;
      i++;
    }
  }

  // 从 stdin 读取数据
  let inputText = "";
  for await (const chunk of process.stdin) {
    inputText += chunk;
  }

  let analyses: any[] = [];
  try {
    const parsed = JSON.parse(inputText);
    analyses = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // 如果不是 JSON，尝试作为文本处理
    content = inputText;
  }

  try {
    // 生成报告
    const report = generateReport({
      title,
      type,
      analyses,
      content,
      format,
    });

    // 输出
    if (format === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else if (format === "markdown") {
      console.log(generateMarkdown(report));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "未知错误",
        details: error,
      })
    );
    process.exit(1);
  }
}

/**
 * 生成 Markdown 格式
 */
function generateMarkdown(report: Report): string {
  let md = `# ${report.title}\n\n`;
  md += `**生成时间**: ${report.generatedAt}\n\n`;
  md += `---\n\n`;

  for (const section of report.sections) {
    const heading = "#".repeat(section.level);
    md += `${heading} ${section.title}\n\n`;
    md += `${section.content}\n\n`;
  }

  md += `---\n\n`;
  md += `**元数据**\n`;
  md += `- 总仓库数: ${report.metadata.totalRepositories}\n`;
  md += `- 平均健康度: ${report.metadata.averageHealthScore}\n`;
  md += `- 顶级仓库: ${report.metadata.topPerformers.join(", ")}\n`;

  return md;
}
