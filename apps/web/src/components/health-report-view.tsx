/**
 * @package @devscope/web/components
 * @description 健康度报告展示组件
 *
 * 展示仓库的健康度评估报告，包含 8 大维度的详细分析。
 *
 * @module health-report-view
 */

"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Minus,
  Download,
  Loader2,
  Activity,
  Target,
  Zap,
  GitCommit,
  Users,
  MessageSquare,
  FileCode,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { CompetitiveAnalysisReport } from "@devscope/shared";

// ============================================================================
// 类型定义
// ============================================================================

interface HealthReportViewProps {
  /** 报告 ID */
  reportId: string;
  /** 执行 ID (可选，用于加载报告) */
  executionId?: string;
}

interface DimensionInfo {
  name: string;
  score: number | null;
  weight: string | null;
  status: string;
  icon: React.ComponentType<{ className?: string }>;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从 AI 分析文本中提取各维度评分
 */
function parseDimensionsFromText(aiAnalysis: string | null | undefined): DimensionInfo[] {
  if (!aiAnalysis) return [];

  const dimensions: DimensionInfo[] = [];

  // 定义 8 大维度的配置
  const dimensionConfigs = [
    {
      name: "代码活跃度",
      weight: "20%",
      icon: GitCommit,
      patterns: [
        /代码活跃度[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /1\.\s*代码活跃度[^0-9]*?(\d+)/,
        /\|\s*代码活跃度\s*\|\s*(\d+)\s*\|/,
      ],
    },
    {
      name: "社区参与度",
      weight: "15%",
      icon: Users,
      patterns: [
        /社区参与度[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /2\.\s*社区参与度[^0-9]*?(\d+)/,
        /\|\s*社区参与度\s*\|\s*(\d+)\s*\|/,
      ],
    },
    {
      name: "Issue 管理",
      weight: "15%",
      icon: MessageSquare,
      patterns: [
        /Issue\s*管理[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /3\.\s*Issue\s*管理[^0-9]*?(\d+)/,
        /\|\s*Issue\s*管理\s*\|\s*(\d+)\s*\|/,
      ],
    },
    {
      name: "PR 审查流程",
      weight: "10%",
      icon: FileCode,
      patterns: [
        /PR\s*审查[流程]?[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /4\.\s*PR\s*审查[^0-9]*?(\d+)/,
        /\|\s*PR\s*审查\s*\|\s*(\d+)\s*\|/,
      ],
    },
    {
      name: "项目成熟度",
      weight: "10%",
      icon: Activity,
      patterns: [
        /项目成熟度[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /5\.\s*项目成熟度[^0-9]*?(\d+)/,
        /\|\s*项目成熟度\s*\|\s*(\d+)\s*\|/,
      ],
    },
    {
      name: "技术栈质量",
      weight: "10%",
      icon: FileCode,
      patterns: [
        /技术栈[质量]?[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /6\.\s*技术栈[^0-9]*?(\d+)/,
        /\|\s*技术栈\s*\|\s*(\d+)\s*\|/,
      ],
    },
    {
      name: "用户采用度",
      weight: "10%",
      icon: TrendingUp,
      patterns: [
        /用户采用度[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /7\.\s*用户采用度[^0-9]*?(\d+)/,
        /\|\s*用户采用度\s*\|\s*(\d+)\s*\|/,
      ],
    },
    {
      name: "可维护性风险",
      weight: "10%",
      icon: AlertTriangle,
      patterns: [
        /可维护性[风险]?[：:]\s*(\d+)\s*(?:\/\s*100)?/,
        /8\.\s*可维护性[^0-9]*?(\d+)/,
        /\|\s*可维护性\s*\|\s*(\d+)\s*\|/,
      ],
    },
  ];

  // 对每个维度尝试提取分数
  for (const config of dimensionConfigs) {
    let score: number | null = null;

    // 尝试所有模式
    for (const pattern of config.patterns) {
      const match = aiAnalysis.match(pattern);
      if (match) {
        const extractedScore = parseInt(match[1]);
        if (!isNaN(extractedScore) && extractedScore >= 0 && extractedScore <= 100) {
          score = extractedScore;
          break;
        }
      }
    }

    // 确定状态
    let status = "未知";
    if (score !== null) {
      if (score >= 80) status = "优秀";
      else if (score >= 60) status = "良好";
      else if (score >= 40) status = "一般";
      else if (score >= 20) status = "需关注";
      else status = "危急";
    }

    dimensions.push({
      name: config.name,
      score,
      weight: config.weight,
      status,
      icon: config.icon,
    });
  }

  return dimensions;
}

/** 分数 → 语义状态色（仅表达真实状态语义）。 */
function getScoreTextClass(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-signal";
  if (score >= 40) return "text-warning";
  return "text-destructive";
}

// ============================================================================
// 主组件
// ============================================================================

export function HealthReportView({ reportId, executionId }: HealthReportViewProps) {
  const [report, setReport] = useState<CompetitiveAnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReport() {
      try {
        const idToUse = executionId || reportId;
        const response = await fetch(`/api/reports/${idToUse}`);
        if (!response.ok) {
          throw new Error("Failed to load report");
        }
        const data = await response.json();
        setReport(data);
      } catch (err) {
        console.error("Failed to load report:", err);
        setError(err instanceof Error ? err.message : "Failed to load report");
      } finally {
        setLoading(false);
      }
    }
    loadReport();
  }, [reportId, executionId]);

  /**
   * 生成 Markdown 格式的报告
   */
  const generateMarkdown = (): string => {
    if (!report) return "";

    // 如果有 AI 详细分析，优先使用
    if (report.aiAnalysis) {
      const md = report.aiAnalysis;
      const header = `---\n**报告 ID**: ${report.reportId}\n**生成时间**: ${new Date(report.generatedAt).toLocaleString("zh-CN")}\n**分析类型**: ${report.analysisType}\n---\n\n`;
      return header + md;
    }

    // 否则使用结构化数据生成报告
    let md = `# 仓库健康度评估报告\n\n`;
    md += `**报告 ID**: ${report.reportId}\n`;
    md += `**生成时间**: ${new Date(report.generatedAt).toLocaleString("zh-CN")}\n`;
    md += `**分析类型**: ${report.analysisType}\n\n`;

    md += `---\n\n`;

    // 执行摘要
    md += `## 执行摘要\n\n`;
    md += `${report.executiveSummary.overview}\n\n`;

    // 风险矩阵
    if (report.riskMatrix?.risks && report.riskMatrix.risks.length > 0) {
      md += `## 风险评估\n\n`;
      report.riskMatrix.risks.forEach(risk => {
        md += `### ${risk.category}\n`;
        md += `- **严重程度**: ${risk.severity}/100\n`;
        md += `- **描述**: ${risk.description}\n`;
        if (risk.mitigation) {
          md += `- **缓解措施**: ${risk.mitigation}\n`;
        }
        md += `\n`;
      });
    }

    return md;
  };

  /**
   * 处理下载
   */
  const handleDownload = () => {
    if (!report) return;
    const markdown = generateMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `health-report-${report.reportId.substring(0, 8)}-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 加载状态
  if (loading) {
    return (
      <Card className="command-surface w-full">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary motion-reduce:animate-none" />
          <p className="text-muted-foreground">加载报告中...</p>
        </CardContent>
      </Card>
    );
  }

  // 错误状态
  if (error) {
    return (
      <Card className="w-full border-destructive/30 bg-destructive/5">
        <CardContent className="py-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-destructive" />
          <p className="font-medium text-destructive">报告加载失败</p>
          <p className="mt-1 text-sm text-destructive/80">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card className="command-surface w-full">
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>报告不存在</p>
        </CardContent>
      </Card>
    );
  }

  // 从 AI 分析中提取各维度评分
  const parseHealthScores = () => {
    if (!report.aiAnalysis) return null;

    const text = report.aiAnalysis;

    // 尝试多种格式提取健康度总分
    const totalScorePatterns = [
      // 标准格式：健康度评分: 85/100
      /健康度[评分评估总分]?\s*[:：]\s*(\d+)\s*(?:\/\s*100)?/,
      // 总体评分: 85
      /总体评分\s*[:：]\s*(\d+)/,
      // 评分: 85/100
      /(?:综合)?评分\s*[:：]\s*(\d+)\s*\/\s*100/,
      // **总体评分**: 85
      /\*\s*总体评分\s*\*\s*[:：]\s*(\d+)/,
      // 85/100 [健康度]
      /(\d+)\s*\/\s*100\s*[(\[]健康度/,
      // 分数为 85 的表格行
      /\|\s*总分\s*\|\s*(\d+)\s*\|\s*100/,
      // 代码行中的分数
      /(?:健康度|总体|综合).*?(\d{2,3})\s*\/\s*100/,
      // 只有分数的情况（在表格中）
      /^(\d{1,3})\s*$/m,
    ];

    let totalScore: number | null = null;
    for (const pattern of totalScorePatterns) {
      const match = text.match(pattern);
      if (match) {
        const score = parseInt(match[1]);
        if (!isNaN(score) && score >= 0 && score <= 100) {
          totalScore = score;
          break;
        }
      }
    }

    // 如果还是找不到，尝试在整个文本中搜索任何 XX/100 的模式
    if (totalScore === null) {
      const allMatches = text.matchAll(/(\d{1,3})\s*\/\s*100/g);
      for (const match of allMatches) {
        const score = parseInt(match[1]);
        if (!isNaN(score) && score >= 0 && score <= 100) {
          totalScore = score;
          break;
        }
      }
    }

    // 尝试提取活跃度
    const activityPatterns = [
      /活跃度[等级评估状态]?\s*[:：]\s*(\w+)/i,
      /活动状态\s*[:：]\s*(\w+)/i,
      /活跃水平\s*[:：]\s*(\w+)/i,
    ];

    let activityLevel: string | null = null;
    for (const pattern of activityPatterns) {
      const match = text.match(pattern);
      if (match) {
        activityLevel = match[1];
        break;
      }
    }

    // 尝试提取风险因素
    const riskFactors: string[] = [];
    const riskMatches = text.matchAll(/风险因素[:：]\s*([^#\n]+)/g);
    for (const match of riskMatches) {
      riskFactors.push(match[1].trim());
    }

    // 尝试提取机会因素
    const opportunities: string[] = [];
    const oppMatches = text.matchAll(/机会因素[:：]\s*([^#\n]+)/g);
    for (const match of oppMatches) {
      opportunities.push(match[1].trim());
    }

    return { totalScore, activityLevel, riskFactors, opportunities };
  };

  const healthScores = parseHealthScores();

  // 获取健康等级（语义 token）
  const getHealthLevel = (score: number | null) => {
    if (score === null) {
      return { label: "未知", wrap: "bg-muted text-muted-foreground", badge: "bg-muted text-muted-foreground", icon: Minus };
    }
    if (score >= 80) {
      return { label: "优秀", wrap: "bg-success/15 text-success", badge: "bg-success text-success-foreground", icon: CheckCircle2 };
    }
    if (score >= 60) {
      return { label: "良好", wrap: "bg-signal/15 text-signal", badge: "bg-signal text-signal-foreground", icon: CheckCircle2 };
    }
    if (score >= 40) {
      return { label: "一般", wrap: "bg-warning/15 text-warning", badge: "bg-warning text-warning-foreground", icon: AlertTriangle };
    }
    if (score >= 20) {
      return { label: "需关注", wrap: "bg-warning/15 text-warning", badge: "bg-warning text-warning-foreground", icon: AlertTriangle };
    }
    return { label: "危急", wrap: "bg-destructive/15 text-destructive", badge: "bg-destructive text-destructive-foreground", icon: XCircle };
  };

  const healthLevel = healthScores && healthScores.totalScore !== null
    ? getHealthLevel(healthScores.totalScore)
    : getHealthLevel(null);

  const HealthIcon = healthLevel.icon;

  return (
    <div className="space-y-6">
      {/* 报告头部 */}
      <Card className="command-surface">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-xl border border-primary/25 bg-primary/10 p-3 text-primary">
                <Activity className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-2xl">仓库健康度评估报告</CardTitle>
                <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                  <span>生成时间: {new Date(report.generatedAt).toLocaleString("zh-CN")}</span>
                  <span>•</span>
                  <span className="font-mono text-xs">ID: {report.reportId.substring(0, 8)}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="mr-1 h-4 w-4" />
                下载
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* 健康度总览 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-primary" />
            健康度总览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex items-center gap-6">
            {/* 总分 */}
            <div className="flex items-center gap-4">
              <div className={`rounded-full p-4 ${healthLevel.wrap}`}>
                <HealthIcon className="h-8 w-8" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">健康度评分</p>
                <p className="text-3xl font-bold">
                  {healthScores && healthScores.totalScore !== null ? healthScores.totalScore : "N/A"}
                  <span className="text-lg text-muted-foreground">/100</span>
                </p>
                <Badge className={`mt-1 ${healthLevel.badge}`}>{healthLevel.label}</Badge>
              </div>
            </div>

            {/* 活跃度等级 */}
            {healthScores?.activityLevel && (
              <div className="flex-1">
                <p className="mb-1 text-sm text-muted-foreground">活跃度等级</p>
                <Badge variant="outline" className="px-3 py-1 text-lg">
                  {healthScores.activityLevel.toUpperCase()}
                </Badge>
              </div>
            )}
          </div>

          {/* 执行摘要 */}
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-foreground">{report.executiveSummary.overview}</p>
          </div>
        </CardContent>
      </Card>

      {/* AI 详细分析 */}
      {report.aiAnalysis && (
        <Card className="command-surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-5 w-5 text-primary" />
              AI 详细分析
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* 先提取关键指标展示 */}
            <div className="mb-6 space-y-4">
              {/* 维度评分卡片 */}
              {(() => {
                const dimensions = parseDimensionsFromText(report.aiAnalysis);
                if (dimensions.length === 0) return null;

                return (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    {dimensions.map((dim, index) => {
                      const scorePercent = dim.score || 0;

                      return (
                        <div key={index} className="rounded-lg border border-border/80 bg-card p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <dim.icon className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{dim.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={scorePercent}
                              max={100}
                              className="h-2 flex-1"
                            />
                            <span className={`text-sm font-bold ${getScoreTextClass(dim.score)}`}>
                              {dim.score !== null ? dim.score : "N/A"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {dim.weight && `权重 ${dim.weight} • `}
                            {dim.status}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* 完整的 Markdown 报告 */}
            <div className="border-t pt-4">
              <details className="group">
                <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">
                  <span>查看完整分析报告</span>
                  <span className="transform transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-4">
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-bold prose-headings:text-xl prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-strong:text-foreground prose-table:text-sm prose-pre:bg-muted prose-code:text-primary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ node, ...props }) => (
                          <div className="my-4 overflow-x-auto">
                            <table className="min-w-full divide-y divide-border" {...props} />
                          </div>
                        ),
                        thead: ({ node, ...props }) => (
                          <thead className="bg-muted/60" {...props} />
                        ),
                        th: ({ node, ...props }) => (
                          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground" {...props} />
                        ),
                        td: ({ node, ...props }) => (
                          <td className="whitespace-nowrap px-4 py-2 text-sm text-foreground" {...props} />
                        ),
                        code: ({ node, className, ...props }) => {
                          const isInline = className?.includes("language-") || false;
                          return isInline ? (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-primary" {...props} />
                          ) : (
                            <code className="block overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm text-primary" {...props} />
                          );
                        },
                        h1: ({ node, ...props }) => (
                          <h1 className="mb-4 mt-6 text-2xl font-bold text-foreground first:mt-0" {...props} />
                        ),
                        h2: ({ node, ...props }) => (
                          <h2 className="mb-3 mt-5 text-xl font-bold text-foreground first:mt-0" {...props} />
                        ),
                        h3: ({ node, ...props }) => (
                          <h3 className="mb-2 mt-4 text-lg font-semibold text-foreground" {...props} />
                        ),
                        ul: ({ node, ...props }) => (
                          <ul className="my-4 ml-4 list-disc space-y-2" {...props} />
                        ),
                        ol: ({ node, ...props }) => (
                          <ol className="my-4 ml-4 list-decimal space-y-2" {...props} />
                        ),
                        li: ({ node, ...props }) => (
                          <li className="text-foreground" {...props} />
                        ),
                        blockquote: ({ node, ...props }) => (
                          <blockquote className="my-4 border-l-4 border-primary/40 bg-primary/5 py-2 pl-4 italic text-foreground" {...props} />
                        ),
                        a: ({ node, ...props }) => (
                          <a className="text-primary underline underline-offset-4 hover:text-primary/80" target="_blank" rel="noopener noreferrer" {...props} />
                        ),
                        strong: ({ node, ...props }) => (
                          <strong className="font-semibold text-foreground" {...props} />
                        ),
                        hr: ({ node, ...props }) => (
                          <hr className="my-6 border-border" {...props} />
                        ),
                      }}
                    >
                      {report.aiAnalysis}
                    </ReactMarkdown>
                  </div>
                </div>
              </details>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 风险评估矩阵 */}
      {report.riskMatrix?.risks && report.riskMatrix.risks.length > 0 && (
        <Card className="command-surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-warning" />
              风险评估矩阵
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.riskMatrix.risks.map((risk, index) => {
                const severity = risk.severity || 0;
                const severityBadge =
                  severity >= 70
                    ? "bg-destructive/15 text-destructive"
                    : severity >= 40
                      ? "bg-warning/15 text-warning"
                      : "bg-success/15 text-success";

                return (
                  <div key={index} className="rounded-lg border border-border/80 p-4">
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={severityBadge}>{risk.category}</Badge>
                      </div>
                      <Badge variant="outline">{severity}/100</Badge>
                    </div>
                    <p className="mb-2 text-sm text-foreground">
                      {risk.description}
                    </p>
                    {risk.mitigation && (
                      <div className="text-xs text-muted-foreground">
                        <strong>缓解措施：</strong>{risk.mitigation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 整体风险等级 */}
            {report.riskMatrix.overallRisk && (
              <div className="mt-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">整体风险等级</span>
                  <Badge
                    className={
                      report.riskMatrix.overallRisk === "critical" || report.riskMatrix.overallRisk === "high"
                        ? "bg-destructive text-destructive-foreground"
                        : report.riskMatrix.overallRisk === "medium"
                          ? "bg-warning text-warning-foreground"
                          : "bg-success text-success-foreground"
                    }
                  >
                    {report.riskMatrix.overallRisk.toUpperCase()}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 数据来源 */}
      <Card className="command-surface">
        <CardHeader>
          <CardTitle className="text-lg">数据来源</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {report.dataSources?.map((source, index) => (
              <div key={index} className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>
                  <strong>{source.type}:</strong> {source.details}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
