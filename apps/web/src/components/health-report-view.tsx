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
      let md = report.aiAnalysis;
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
      <Card className="w-full">
        <CardContent className="py-12 flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-500">加载报告中...</p>
        </CardContent>
      </Card>
    );
  }

  // 错误状态
  if (error) {
    return (
      <Card className="w-full border-red-200 bg-red-50 dark:bg-red-900/20">
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-red-500" />
          <p className="text-red-600 font-medium">报告加载失败</p>
          <p className="text-sm text-red-500 mt-1">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card className="w-full">
        <CardContent className="py-8 text-center text-gray-500">
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

  // 获取健康等级
  const getHealthLevel = (score: number | null) => {
    if (score === null) return { label: "未知", color: "gray", icon: Minus };
    if (score >= 80) return { label: "优秀", color: "green", icon: CheckCircle2 };
    if (score >= 60) return { label: "良好", color: "blue", icon: CheckCircle2 };
    if (score >= 40) return { label: "一般", color: "yellow", icon: AlertTriangle };
    if (score >= 20) return { label: "需关注", color: "orange", icon: AlertTriangle };
    return { label: "危急", color: "red", icon: XCircle };
  };

  const healthLevel = healthScores && healthScores.totalScore !== null
    ? getHealthLevel(healthScores.totalScore)
    : { label: "未知", color: "gray", icon: Minus };

  const HealthIcon = healthLevel.icon;

  return (
    <div className="space-y-6">
      {/* 报告头部 */}
      <Card className="border-2 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-md">
                <Activity className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-2xl">仓库健康度评估报告</CardTitle>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                  <span>生成时间: {new Date(report.generatedAt).toLocaleString("zh-CN")}</span>
                  <span>•</span>
                  <span className="font-mono text-xs">ID: {report.reportId.substring(0, 8)}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" />
                下载
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* 健康度总览 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-green-600" />
            健康度总览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 mb-6">
            {/* 总分 */}
            <div className="flex items-center gap-4">
              <div className={`p-4 rounded-full bg-${healthLevel.color}-100 text-${healthLevel.color}-600`}>
                <HealthIcon className="h-8 w-8" />
              </div>
              <div>
                <p className="text-sm text-gray-500">健康度评分</p>
                <p className="text-3xl font-bold">
                  {healthScores && healthScores.totalScore !== null ? healthScores.totalScore : "N/A"}
                  <span className="text-lg text-gray-400">/100</span>
                </p>
                <Badge className={`mt-1 bg-${healthLevel.color}-600 text-white`}>
                  {healthLevel.label}
                </Badge>
              </div>
            </div>

            {/* 活跃度等级 */}
            {healthScores?.activityLevel && (
              <div className="flex-1">
                <p className="text-sm text-gray-500 mb-1">活跃度等级</p>
                <Badge variant="outline" className="text-lg py-1 px-3">
                  {healthScores.activityLevel.toUpperCase()}
                </Badge>
              </div>
            )}
          </div>

          {/* 执行摘要 */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <p className="text-gray-700 dark:text-gray-300">{report.executiveSummary.overview}</p>
          </div>
        </CardContent>
      </Card>

      {/* AI 详细分析 */}
      {report.aiAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-purple-600" />
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {dimensions.map((dim, index) => {
                      const scorePercent = dim.score || 0;
                      const scoreColor = scorePercent >= 80 ? "green" : scorePercent >= 60 ? "blue" : scorePercent >= 40 ? "yellow" : "red";

                      return (
                        <div key={index} className="border rounded-lg p-3 bg-white dark:bg-gray-800">
                          <div className="flex items-center gap-2 mb-2">
                            <dim.icon className="h-4 w-4" />
                            <span className="text-sm font-medium">{dim.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={scorePercent}
                              max={100}
                              className="flex-1 h-2"
                            />
                            <span className={`text-sm font-bold text-${scoreColor}-600`}>
                              {dim.score !== null ? dim.score : "N/A"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
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
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-2">
                  <span>查看完整分析报告</span>
                  <span className="transform group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-4">
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-bold prose-headings:text-xl prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h1:text-green-600 prose-h2:text-green-600 prose-h3:text-green-600 prose-strong:text-gray-900 prose-table:text-sm prose-pre:bg-gray-50 dark:prose-pre:bg-gray-800 prose-code:text-pink-600">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ node, ...props }) => (
                          <div className="overflow-x-auto my-4">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" {...props} />
                          </div>
                        ),
                        thead: ({ node, ...props }) => (
                          <thead className="bg-gray-50 dark:bg-gray-800" {...props} />
                        ),
                        th: ({ node, ...props }) => (
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider" {...props} />
                        ),
                        td: ({ node, ...props }) => (
                          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap" {...props} />
                        ),
                        code: ({ node, className, ...props }) => {
                          const isInline = className?.includes("language-") || false;
                          return isInline ? (
                            <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-pink-600 font-mono text-sm" {...props} />
                          ) : (
                            <code className="block p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-pink-600 font-mono text-sm overflow-x-auto" {...props} />
                          );
                        },
                        h1: ({ node, ...props }) => (
                          <h1 className="text-2xl font-bold text-green-600 mt-6 mb-4 first:mt-0" {...props} />
                        ),
                        h2: ({ node, ...props }) => (
                          <h2 className="text-xl font-bold text-green-600 mt-5 mb-3 first:mt-0" {...props} />
                        ),
                        h3: ({ node, ...props }) => (
                          <h3 className="text-lg font-semibold text-green-600 mt-4 mb-2" {...props} />
                        ),
                        ul: ({ node, ...props }) => (
                          <ul className="space-y-2 my-4 ml-4 list-disc" {...props} />
                        ),
                        ol: ({ node, ...props }) => (
                          <ol className="space-y-2 my-4 ml-4 list-decimal" {...props} />
                        ),
                        li: ({ node, ...props }) => (
                          <li className="text-gray-700 dark:text-gray-300" {...props} />
                        ),
                        blockquote: ({ node, ...props }) => (
                          <blockquote className="border-l-4 border-green-500 pl-4 py-2 my-4 bg-green-50 dark:bg-green-900/20 italic text-gray-700 dark:text-gray-300" {...props} />
                        ),
                        a: ({ node, ...props }) => (
                          <a className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" {...props} />
                        ),
                        strong: ({ node, ...props }) => (
                          <strong className="font-semibold text-gray-900 dark:text-gray-100" {...props} />
                        ),
                        hr: ({ node, ...props }) => (
                          <hr className="my-6 border-gray-300 dark:border-gray-700" {...props} />
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              风险评估矩阵
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.riskMatrix.risks.map((risk, index) => {
                const severity = risk.severity || 0;
                const severityLevel = severity >= 70 ? "high" : severity >= 40 ? "medium" : "low";
                const severityColor = severityLevel === "high" ? "red" : severityLevel === "medium" ? "yellow" : "green";

                return (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className={`bg-${severityColor}-100 text-${severityColor}-700`}>
                          {risk.category}
                        </Badge>
                      </div>
                      <Badge variant="outline">{severity}/100</Badge>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                      {risk.description}
                    </p>
                    {risk.mitigation && (
                      <div className="text-xs text-gray-500">
                        <strong>缓解措施：</strong>{risk.mitigation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 整体风险等级 */}
            {report.riskMatrix.overallRisk && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">整体风险等级</span>
                  <Badge className={`${
                    report.riskMatrix.overallRisk === "critical" ? "bg-red-600" :
                    report.riskMatrix.overallRisk === "high" ? "bg-orange-600" :
                    report.riskMatrix.overallRisk === "medium" ? "bg-yellow-600" :
                    "bg-green-600"
                  } text-white`}>
                    {report.riskMatrix.overallRisk.toUpperCase()}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 数据来源 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">数据来源</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {report.dataSources?.map((source, index) => (
              <div key={index} className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
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
