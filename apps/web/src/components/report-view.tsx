/**
 * @package @devscope/web/components
 * @description 竞争分析报告展示组件
 *
 * 展示完整的竞争分析报告，包括执行摘要、详细分析、风险矩阵和投资建议。
 *
 * @module report-view
 */

"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Download,
  Loader2,
  FileText,
  Activity,
  GitCompare,
  Star,
  GitFork,
  Users,
  MessageSquare,
  Code,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { CompetitiveAnalysisReport } from "@devscope/shared";

// ============================================================================
// 类型定义
// ============================================================================

interface ReportViewProps {
  /** 报告 ID */
  reportId: string;
  /** 执行 ID (可选，用于加载报告) */
  executionId?: string;
}

// ============================================================================
// 主组件
// ============================================================================

export function ReportView({ reportId, executionId }: ReportViewProps) {
  const [report, setReport] = useState<CompetitiveAnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * 生成 Markdown 格式的报告
   */
  const generateMarkdown = (): string => {
    if (!report) return "";

    // 如果有 AI 详细分析，优先使用
    if (report.aiAnalysis) {
      let md = report.aiAnalysis;
      // 添加报告元数据头部
      const header = `---\n**报告 ID**: ${report.reportId}\n**生成时间**: ${new Date(report.generatedAt).toLocaleString("zh-CN")}\n**分析类型**: ${report.analysisType}\n---\n\n`;
      return header + md;
    }

    // 否则使用结构化数据生成报告
    let md = `# 竞争格局分析报告\n\n`;
    md += `**报告 ID**: ${report.reportId}\n`;
    md += `**生成时间**: ${new Date(report.generatedAt).toLocaleString("zh-CN")}\n`;
    md += `**分析类型**: ${report.analysisType}\n\n`;

    md += `---\n\n`;

    // 执行摘要
    md += `## 执行摘要\n\n`;
    md += `${report.executiveSummary.overview}\n\n`;
    md += `### 关键发现\n\n`;
    report.executiveSummary.keyFindings.forEach(finding => {
      md += `- ${finding}\n`;
    });
    md += `\n`;
    md += `**投资建议**: ${report.executiveSummary.recommendation}\n`;
    md += `**置信度**: ${report.executiveSummary.confidenceLevel}\n\n`;

    // 详细分析 - 市场定位
    md += `## 市场定位分析\n\n`;
    const marketPos = report.detailedAnalysis.marketPosition;
    md += `### 市场领导者\n\n`;
    if (marketPos.leaders && marketPos.leaders.length > 0) {
      marketPos.leaders.forEach(leader => {
        md += `- **${leader}**\n`;
      });
    }
    md += `\n`;
    md += `### 挑战者\n\n`;
    if (marketPos.challengers && marketPos.challengers.length > 0) {
      marketPos.challengers.forEach(challenger => {
        md += `- **${challenger}**\n`;
      });
    }
    md += `\n`;
    md += `### 细分市场\n\n`;
    if (marketPos.niche && marketPos.niche.length > 0) {
      marketPos.niche.forEach(item => {
        md += `- **${item}**\n`;
      });
    } else {
      md += `无\n`;
    }
    md += `\n`;
    md += `### 新兴项目\n\n`;
    if (marketPos.emerging && marketPos.emerging.length > 0) {
      marketPos.emerging.forEach(item => {
        md += `- **${item}**\n`;
      });
    } else {
      md += `无\n`;
    }
    md += `\n`;

    // 详细分析 - 技术对比
    md += `## 技术对比\n\n`;
    report.detailedAnalysis.technologyComparison.forEach(tech => {
      md += `### ${tech.repo}\n`;
      md += `- **语言**: ${tech.language || "N/A"}\n`;
      md += `- **许可证**: ${tech.license || "N/A"}\n`;
      md += `- **Stars**: ${tech.stars}\n`;
      md += `- **Forks**: ${tech.forks}\n`;
      md += `- **活跃度**: ${tech.activityLevel}\n\n`;
    });

    // 详细分析 - 社区指标
    md += `## 社区指标\n\n`;
    report.detailedAnalysis.communityMetrics.forEach(metric => {
      md += `### ${metric.repo}\n`;
      md += `- **贡献者数量**: ${metric.contributorCount}\n`;
      md += `- **Issue 解决率**: ${metric.issueResolutionRate}%\n`;
      md += `- **提交频率**: ${metric.commitFrequency}\n\n`;
    });

    // 风险矩阵
    md += `## 风险矩阵\n\n`;
    md += `**整体风险等级**: ${report.riskMatrix.overallRisk}\n\n`;
    if (report.riskMatrix.risks.length > 0) {
      md += `| 仓库 | 类别 | 描述 | 严重程度 | 缓解措施 |\n`;
      md += `|------|------|------|----------|----------|\n`;
      report.riskMatrix.risks.forEach(risk => {
        md += `| ${risk.repo} | ${risk.category} | ${risk.description} | ${risk.severity}/100 | ${risk.mitigation || "N/A"} |\n`;
      });
      md += `\n`;
    }

    // 投资建议
    md += `## 投资建议\n\n`;
    md += `### 首选项目\n\n`;
    md += report.investmentRecommendations.topPick || "无明确推荐\n";
    md += `\n`;
    md += `### 关注列表\n\n`;
    if (report.investmentRecommendations.watchList.length > 0) {
      report.investmentRecommendations.watchList.forEach(repo => {
        md += `- ${repo}\n`;
      });
    } else {
      md += `无\n`;
    }
    md += `\n`;
    md += `### 规避列表\n\n`;
    if (report.investmentRecommendations.avoidList.length > 0) {
      report.investmentRecommendations.avoidList.forEach(repo => {
        md += `- ${repo}\n`;
      });
    } else {
      md += `无\n`;
    }
    md += `\n`;
    md += `### 投资理由\n\n${report.investmentRecommendations.rationale}\n\n`;

    // 数据来源
    md += `## 数据来源\n\n`;
    report.dataSources.forEach(source => {
      md += `- **[${source.type}]**: ${source.repo || ""} - ${source.details || ""}\n`;
    });
    md += `\n`;

    md += `---\n\n`;
    md += `*本报告由 DevScope AI 分析生成，数据来源于 GitHub API 和 AI 分析，仅供参考。*\n`;

    return md;
  };

  /**
   * 下载报告
   */
  const handleDownload = () => {
    if (!report) return;

    const markdown = generateMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `analysis-report-${reportId.substring(0, 8)}-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    // 从 API 加载报告
    const loadReport = async () => {
      if (!executionId) {
        setError("缺少执行 ID");
        setLoading(false);
        return;
      }

      try {
        // 使用 Next.js API Route 代理
        const response = await fetch(`/api/reports/${executionId}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError("报告不存在");
          } else {
            setError(`加载失败: ${response.statusText}`);
          }
          return;
        }

        const data = await response.json();
        setReport(data);
      } catch (err) {
        console.error("[ReportView] Failed to load report:", err);
        setError(err instanceof Error ? err.message : "加载报告失败");
      } finally {
        setLoading(false);
      }
    };

    loadReport();
  }, [reportId, executionId]);

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <span className="ml-2 text-gray-500">加载报告中...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full border-red-200 bg-red-50">
        <CardContent className="py-8 text-center text-red-600">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card className="w-full">
        <CardContent className="py-8 text-center text-gray-500">
          <p>报告加载中或不存在</p>
        </CardContent>
      </Card>
    );
  }

  // 根据分析类型获取配置
  const getAnalysisConfig = () => {
    switch (report.analysisType) {
      case "competitive_landscape":
        return {
          title: "竞争格局分析报告",
          icon: <TrendingUp className="h-6 w-6" />,
          color: "blue",
          gradient: "from-blue-500 to-indigo-600",
        };
      case "health_report":
        return {
          title: "健康度报告",
          icon: <Activity className="h-6 w-6" />,
          color: "green",
          gradient: "from-green-500 to-emerald-600",
        };
      case "single_repo":
        return {
          title: "单仓库分析报告",
          icon: <GitCompare className="h-6 w-6" />,
          color: "purple",
          gradient: "from-purple-500 to-violet-600",
        };
      default:
        return {
          title: "分析报告",
          icon: <FileText className="h-6 w-6" />,
          color: "slate",
          gradient: "from-slate-500 to-gray-600",
        };
    }
  };

  const config = getAnalysisConfig();

  return (
    <div className="space-y-6">
      {/* 报告头部 */}
      <Card className="border-2 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-gradient-to-br ${config.gradient} text-white shadow-md`}>
                {config.icon}
              </div>
              <div>
                <CardTitle className="text-2xl">{config.title}</CardTitle>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    生成时间: {new Date(report.generatedAt).toLocaleString("zh-CN")}
                  </span>
                  <span>•</span>
                  <span className="font-mono text-xs">
                    ID: {report.reportId.substring(0, 8)}
                  </span>
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

      {/* 执行摘要 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">执行摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">{report.executiveSummary.overview}</p>

          {/* 关键发现 */}
          <div>
            <h4 className="font-medium mb-2">关键发现</h4>
            <ul className="space-y-1">
              {report.executiveSummary.keyFindings.map((finding, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  {finding}
                </li>
              ))}
            </ul>
          </div>

          {/* 总体建议 */}
          <div className="flex items-center gap-4">
            <div>
              <span className="text-sm text-gray-500">投资建议: </span>
              <RecommendationBadge recommendation={report.executiveSummary.recommendation} />
            </div>
            <div>
              <span className="text-sm text-gray-500">置信度: </span>
              <ConfidenceBadge level={report.executiveSummary.confidenceLevel} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 详细分析 */}
      <Tabs defaultValue="market" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="market">市场定位</TabsTrigger>
          <TabsTrigger value="tech">技术对比</TabsTrigger>
          <TabsTrigger value="community">社区指标</TabsTrigger>
          <TabsTrigger value="risk">风险矩阵</TabsTrigger>
        </TabsList>

        {/* 市场定位 */}
        <TabsContent value="market">
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MarketPositionCard
                  title="领导者"
                  repos={report.detailedAnalysis.marketPosition.leaders}
                  color="green"
                />
                <MarketPositionCard
                  title="挑战者"
                  repos={report.detailedAnalysis.marketPosition.challengers}
                  color="blue"
                />
                <MarketPositionCard
                  title="细分市场"
                  repos={report.detailedAnalysis.marketPosition.niche}
                  color="yellow"
                />
                <MarketPositionCard
                  title="新兴项目"
                  repos={report.detailedAnalysis.marketPosition.emerging}
                  color="purple"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 技术对比 */}
        <TabsContent value="tech">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">技术栈对比</h3>
              <span className="text-sm text-gray-500">共 {report.detailedAnalysis.technologyComparison.length} 个项目</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {report.detailedAnalysis.technologyComparison.map((item, index) => {
                // 计算相对最大值的百分比
                const maxStars = Math.max(...report.detailedAnalysis.technologyComparison.map(t => t.stars));
                const maxForks = Math.max(...report.detailedAnalysis.technologyComparison.map(t => t.forks));
                const starsPercent = (item.stars / maxStars) * 100;
                const forksPercent = (item.forks / maxForks) * 100;

                // 活跃度颜色
                const activityColors = {
                  high: "bg-green-500",
                  medium: "bg-blue-500",
                  low: "bg-yellow-500",
                  dead: "bg-gray-400",
                };
                const activityColor = activityColors[item.activityLevel as keyof typeof activityColors] || "bg-gray-400";

                return (
                  <Card key={index} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      {/* 项目名称 */}
                      <div className="flex items-center gap-2 mb-3">
                        <Code className="h-4 w-4 text-gray-500" />
                        <span className="font-medium text-sm truncate flex-1">{item.repo}</span>
                      </div>

                      {/* 语言标签 */}
                      <div className="mb-3">
                        {item.language ? (
                          <Badge variant="outline" className="text-xs">
                            {item.language}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-gray-400">
                            N/A
                          </Badge>
                        )}
                      </div>

                      {/* Stars 进度条 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1 text-gray-600">
                            <Star className="h-3 w-3" />
                            <span>Stars</span>
                          </div>
                          <span className="font-medium">{formatNumber(item.stars)}</span>
                        </div>
                        <Progress value={starsPercent} className="h-1.5" />
                      </div>

                      {/* Forks 进度条 */}
                      <div className="space-y-1 mt-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1 text-gray-600">
                            <GitFork className="h-3 w-3" />
                            <span>Forks</span>
                          </div>
                          <span className="font-medium">{formatNumber(item.forks)}</span>
                        </div>
                        <Progress value={forksPercent} className="h-1.5" />
                      </div>

                      {/* 活跃度 */}
                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Zap className="h-3 w-3" />
                          <span>活跃度</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className={`h-2 w-2 rounded-full ${activityColor}`} />
                          <ActivityBadge level={item.activityLevel} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* 社区指标 */}
        <TabsContent value="community">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">社区健康度对比</h3>
              <span className="text-sm text-gray-500">共 {report.detailedAnalysis.communityMetrics.length} 个项目</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {report.detailedAnalysis.communityMetrics.map((item, index) => {
                // 计算相对最大值的百分比
                const maxContributors = Math.max(...report.detailedAnalysis.communityMetrics.map(m => m.contributorCount));
                const contributorsPercent = (item.contributorCount / maxContributors) * 100;

                // Issue 解决率颜色
                const getResolutionColor = (rate: number) => {
                  if (rate >= 80) return "text-green-600";
                  if (rate >= 60) return "text-blue-600";
                  if (rate >= 40) return "text-yellow-600";
                  return "text-red-600";
                };

                return (
                  <Card key={index} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      {/* 项目名称 */}
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="h-4 w-4 text-gray-500" />
                        <span className="font-medium text-sm truncate flex-1">{item.repo}</span>
                      </div>

                      {/* 贡献者多样性 */}
                      <div className="space-y-1 mb-3">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1 text-gray-600">
                            <Users className="h-3 w-3" />
                            <span>贡献者多样性</span>
                          </div>
                          <span className="font-medium">{item.contributorCount.toFixed(1)}</span>
                        </div>
                        <Progress value={contributorsPercent} className="h-1.5" />
                      </div>

                      {/* Issue 解决率 */}
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1 text-xs text-gray-600">
                            <MessageSquare className="h-3 w-3" />
                            <span>Issue 解决率</span>
                          </div>
                          <span className={`text-sm font-bold ${getResolutionColor(item.issueResolutionRate)}`}>
                            {item.issueResolutionRate}%
                          </span>
                        </div>
                        <Progress value={item.issueResolutionRate} className="h-1.5" />
                      </div>

                      {/* 提交频率 */}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Activity className="h-3 w-3" />
                          <span>提交频率</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {getCommitFrequencyLabel(item.commitFrequency)}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* 社区指标汇总 */}
            <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200">
              <CardContent className="p-4">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  社区健康度排名
                </h4>
                <div className="space-y-2">
                  {report.detailedAnalysis.communityMetrics
                    .sort((a, b) => b.issueResolutionRate - a.issueResolutionRate)
                    .slice(0, 3)
                    .map((item, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${index === 0 ? "text-yellow-600" : index === 1 ? "text-gray-500" : "text-orange-600"}`}>
                            #{index + 1}
                          </span>
                          <span className="text-gray-700">{item.repo}</span>
                        </div>
                        <span className="font-medium">{item.issueResolutionRate}%</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 风险矩阵 */}
        <TabsContent value="risk">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">总体风险等级:</span>
                <RiskLevelBadge level={report.riskMatrix.overallRisk} />
              </div>

              {report.riskMatrix.risks.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>项目</TableHead>
                      <TableHead>类别</TableHead>
                      <TableHead>描述</TableHead>
                      <TableHead className="text-center">严重度</TableHead>
                      <TableHead>缓解措施</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.riskMatrix.risks.map((risk, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{risk.repo}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getRiskCategoryLabel(risk.category)}</Badge>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <div className="whitespace-pre-wrap break-words">{risk.description}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <SeverityBadge severity={risk.severity} />
                        </TableCell>
                        <TableCell className="max-w-md">
                          <div className="whitespace-pre-wrap break-words">{risk.mitigation || "N/A"}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-center text-gray-500 py-4">暂无风险项</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 投资建议 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">投资建议</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-2">首选项目</h4>
              {report.investmentRecommendations.topPick ? (
                <Badge className="bg-green-500">{report.investmentRecommendations.topPick}</Badge>
              ) : (
                <span className="text-gray-400">无明确推荐</span>
              )}
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-2">关注列表</h4>
              <div className="flex flex-wrap gap-1">
                {report.investmentRecommendations.watchList.length > 0 ? (
                  report.investmentRecommendations.watchList.map((repo) => (
                    <Badge key={repo} variant="secondary">
                      {repo}
                    </Badge>
                  ))
                ) : (
                  <span className="text-gray-400">无</span>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-2">规避列表</h4>
              <div className="flex flex-wrap gap-1">
                {report.investmentRecommendations.avoidList.length > 0 ? (
                  report.investmentRecommendations.avoidList.map((repo) => (
                    <Badge key={repo} variant="destructive">
                      {repo}
                    </Badge>
                  ))
                ) : (
                  <span className="text-gray-400">无</span>
                )}
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-2">理由</h4>
            <p className="text-gray-700 dark:text-gray-300">
              {report.investmentRecommendations.rationale}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 数据来源 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">数据来源</CardTitle>
          <CardDescription>本报告的数据来源，确保分析结论可追溯、可验证</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {report.dataSources.map((source, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                <DataSourceBadge type={source.type} />
                <span className="text-gray-600 dark:text-gray-400">{source.repo}</span>
                <span className="text-gray-400">-</span>
                <span className="text-gray-500">{source.details}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 辅助组件
// ============================================================================

function RecommendationBadge({ recommendation }: { recommendation: string }) {
  const config: Record<string, { label: string; className: string }> = {
    invest: { label: "建议投资", className: "bg-green-500" },
    watch: { label: "建议观望", className: "bg-yellow-500" },
    avoid: { label: "建议规避", className: "bg-red-500" },
    mixed: { label: "混合建议", className: "bg-blue-500" },
  };
  const { label, className } = config[recommendation] || { label: recommendation, className: "" };
  return <Badge className={className}>{label}</Badge>;
}

function ConfidenceBadge({ level }: { level: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    high: { label: "高", variant: "default" },
    medium: { label: "中", variant: "secondary" },
    low: { label: "低", variant: "outline" },
  };
  const { label, variant } = config[level] || { label: level, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

function ActivityBadge({ level }: { level: string }) {
  const config: Record<string, { label: string; className: string }> = {
    high: { label: "🟢 高", className: "text-green-600" },
    medium: { label: "🟡 中", className: "text-yellow-600" },
    low: { label: "🟠 低", className: "text-orange-600" },
    dead: { label: "🔴 停滞", className: "text-red-600" },
  };
  const { label, className } = config[level] || { label: level, className: "" };
  return <span className={className}>{label}</span>;
}

function RiskLevelBadge({ level }: { level: string }) {
  const config: Record<string, { label: string; className: string }> = {
    low: { label: "🟢 低风险", className: "bg-green-100 text-green-700" },
    medium: { label: "🟡 中等风险", className: "bg-yellow-100 text-yellow-700" },
    high: { label: "🟠 高风险", className: "bg-orange-100 text-orange-700" },
    critical: { label: "🔴 严重风险", className: "bg-red-100 text-red-700" },
  };
  const { label, className } = config[level] || { label: level, className: "" };
  return <Badge className={className}>{label}</Badge>;
}

function SeverityBadge({ severity }: { severity: number }) {
  const color =
    severity >= 8 ? "bg-red-500" : severity >= 5 ? "bg-orange-500" : "bg-yellow-500";
  return (
    <div className="flex items-center gap-1">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span>{severity}/10</span>
    </div>
  );
}

function DataSourceBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    github_api: { label: "GitHub API", variant: "default" },
    ossinsight: { label: "OSSInsight", variant: "secondary" },
    ai_analysis: { label: "AI 分析", variant: "outline" },
  };
  const { label, variant } = config[type] || { label: type, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

function MarketPositionCard({
  title,
  repos,
  color,
}: {
  title: string;
  repos: string[];
  color: "green" | "blue" | "yellow" | "purple";
}) {
  const colorClasses: Record<string, string> = {
    green: "border-green-200 bg-green-50 dark:bg-green-950",
    blue: "border-blue-200 bg-blue-50 dark:bg-blue-950",
    yellow: "border-yellow-200 bg-yellow-50 dark:bg-yellow-950",
    purple: "border-purple-200 bg-purple-50 dark:bg-purple-950",
  };

  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
      <h4 className="font-medium mb-2">{title}</h4>
      <div className="space-y-1">
        {repos.length > 0 ? (
          repos.map((repo) => (
            <div key={repo} className="text-sm text-gray-600 dark:text-gray-400">
              {repo}
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-400">无</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 辅助函数
// ============================================================================

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
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

function getCommitFrequencyLabel(freq: string): string {
  const labels: Record<string, string> = {
    daily: "每日",
    weekly: "每周",
    monthly: "每月",
    sporadic: "不定期",
  };
  return labels[freq] || freq;
}
