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
  TrendingDown,
  Minus,
  Download,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

  useEffect(() => {
    // 这里应该从 API 加载报告
    // 暂时使用模拟数据
    setLoading(false);
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

  return (
    <div className="space-y-6">
      {/* 报告头部 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>竞争格局分析报告</CardTitle>
              <CardDescription>
                生成时间: {new Date(report.generatedAt).toLocaleString("zh-CN")}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
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
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>项目</TableHead>
                    <TableHead>语言</TableHead>
                    <TableHead className="text-right">Stars</TableHead>
                    <TableHead className="text-right">Forks</TableHead>
                    <TableHead>活跃度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.detailedAnalysis.technologyComparison.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.repo}</TableCell>
                      <TableCell>{item.language || "N/A"}</TableCell>
                      <TableCell className="text-right">{formatNumber(item.stars)}</TableCell>
                      <TableCell className="text-right">{formatNumber(item.forks)}</TableCell>
                      <TableCell>
                        <ActivityBadge level={item.activityLevel} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 社区指标 */}
        <TabsContent value="community">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>项目</TableHead>
                    <TableHead className="text-right">贡献者</TableHead>
                    <TableHead className="text-right">Issue 解决率</TableHead>
                    <TableHead>提交频率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.detailedAnalysis.communityMetrics.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.repo}</TableCell>
                      <TableCell className="text-right">{item.contributorCount}</TableCell>
                      <TableCell className="text-right">{item.issueResolutionRate}%</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getCommitFrequencyLabel(item.commitFrequency)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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
                        <TableCell className="max-w-[200px] truncate">{risk.description}</TableCell>
                        <TableCell className="text-center">
                          <SeverityBadge severity={risk.severity} />
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {risk.mitigation || "N/A"}
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
