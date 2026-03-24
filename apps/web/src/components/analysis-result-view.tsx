/**
 * @package @devscope/web
 * @description AI 分析结果可视化组件
 *
 * 将 RepositoryAnalysis 结构化数据渲染为美观的可视化界面。
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { RepositoryAnalysis } from "@devscope/shared";

interface AnalysisResultViewProps {
  analysis: RepositoryAnalysis;
}

/**
 * 获取健康度对应的颜色
 */
function getHealthColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

/**
 * 获取健康度对应的背景色
 */
function getHealthBgColor(score: number): string {
  if (score >= 80) return "bg-green-100";
  if (score >= 60) return "bg-yellow-100";
  if (score >= 40) return "bg-orange-100";
  return "bg-red-100";
}

/**
 * 获取健康度对应的进度条颜色
 */
function getHealthProgressColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

/**
 * 获取活动级别对应的显示信息
 */
function getActivityLevelInfo(level: string): { label: string; color: string; bgColor: string } {
  switch (level) {
    case "high":
      return { label: "活跃", color: "text-green-700", bgColor: "bg-green-100" };
    case "medium":
      return { label: "中等", color: "text-yellow-700", bgColor: "bg-yellow-100" };
    case "low":
      return { label: "低迷", color: "text-orange-700", bgColor: "bg-orange-100" };
    case "dead":
      return { label: "停滞", color: "text-red-700", bgColor: "bg-red-100" };
    default:
      return { label: level, color: "text-gray-700", bgColor: "bg-gray-100" };
  }
}

/**
 * 获取推荐级别对应的显示信息
 */
function getRecommendationInfo(rec: string): { label: string; color: string; bgColor: string; icon: string } {
  switch (rec) {
    case "invest":
      return { label: "推荐投资", color: "text-green-700", bgColor: "bg-green-100", icon: "🚀" };
    case "watch":
      return { label: "持续观察", color: "text-blue-700", bgColor: "bg-blue-100", icon: "👀" };
    case "avoid":
      return { label: "建议规避", color: "text-red-700", bgColor: "bg-red-100", icon: "⚠️" };
    default:
      return { label: rec, color: "text-gray-700", bgColor: "bg-gray-100", icon: "❓" };
  }
}

/**
 * 获取风险严重程度对应的颜色
 */
function getSeverityColor(severity: number): string {
  if (severity >= 8) return "bg-red-500";
  if (severity >= 5) return "bg-orange-500";
  return "bg-yellow-500";
}

/**
 * 获取机会潜在影响对应的颜色
 */
function getPotentialColor(potential: number): string {
  if (potential >= 8) return "bg-green-500";
  if (potential >= 5) return "bg-emerald-500";
  return "bg-teal-500";
}

/**
 * 健康度仪表盘组件
 */
function HealthGauge({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-32">
        <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
          {/* 背景圆环 */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            className="text-gray-200"
          />
          {/* 进度圆环 */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            className={getHealthColor(score)}
            style={{
              strokeDasharray: circumference,
              strokeDashoffset,
              transition: "stroke-dashoffset 0.5s ease-in-out",
            }}
          />
        </svg>
        {/* 中心分数 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-3xl font-bold ${getHealthColor(score)}`}>
            {score}
          </span>
        </div>
      </div>
      <span className="mt-2 text-sm font-medium text-muted-foreground">健康度评分</span>
    </div>
  );
}

/**
 * 关键指标卡片
 */
function KeyMetricsCards({ metrics }: { metrics: RepositoryAnalysis["keyMetrics"] }) {
  const items = [
    {
      label: "Stars 增长率",
      value: metrics.starsGrowthRate,
      suffix: "%",
      icon: "📈",
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      label: "Issue 解决率",
      value: metrics.issueResolutionRate,
      suffix: "%",
      icon: "🔧",
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      label: "贡献者多样性",
      value: metrics.contributorDiversityScore,
      suffix: "",
      icon: "👥",
      color: "text-teal-600",
      bgColor: "bg-teal-50",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} className={`${item.bgColor} border-0`}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{item.icon}</span>
              <span className="text-sm text-muted-foreground">{item.label}</span>
            </div>
            <div className="flex items-end gap-1">
              <span className={`text-2xl font-bold ${item.color}`}>
                {item.value.toFixed(1)}
              </span>
              {item.suffix && (
                <span className="text-sm text-muted-foreground mb-1">{item.suffix}</span>
              )}
            </div>
            <Progress
              value={item.value}
              max={100}
              className="mt-3 h-2"
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * 风险因素列表
 */
function RiskFactorsList({ factors }: { factors: RepositoryAnalysis["riskFactors"] }) {
  if (factors.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        未发现明显风险因素
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {factors.map((factor, index) => (
        <div
          key={index}
          className="flex items-start gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100"
        >
          <div
            className={`w-2 h-2 rounded-full mt-2 ${getSeverityColor(factor.severity)}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-red-800">
                {factor.category}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600">
                严重度: {factor.severity}/10
              </span>
            </div>
            <p className="text-sm text-red-700">{factor.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 机会因素列表
 */
function OpportunitiesList({ opportunities }: { opportunities: RepositoryAnalysis["opportunities"] }) {
  if (opportunities.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        暂未识别到明显机会
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {opportunities.map((opp, index) => (
        <div
          key={index}
          className="flex items-start gap-3 p-3 rounded-lg bg-green-50/50 border border-green-100"
        >
          <div
            className={`w-2 h-2 rounded-full mt-2 ${getPotentialColor(opp.potential)}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-green-800">
                {opp.category}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-600">
                潜力: {opp.potential}/10
              </span>
            </div>
            <p className="text-sm text-green-700">{opp.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 主组件：分析结果可视化
 */
export function AnalysisResultView({ analysis }: AnalysisResultViewProps) {
  const activityInfo = getActivityLevelInfo(analysis.activityLevel);
  const recInfo = getRecommendationInfo(analysis.recommendation);

  return (
    <div className="space-y-6">
      {/* 顶部概览：健康度 + 活动级别 + 推荐 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            {/* 健康度仪表盘 */}
            <HealthGauge score={analysis.healthScore} />

            {/* 活动级别和推荐 */}
            <div className="flex flex-col gap-4 items-center md:items-end">
              {/* 活动级别 */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">活动级别</span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${activityInfo.bgColor} ${activityInfo.color}`}
                >
                  {activityInfo.label}
                </span>
              </div>

              {/* 推荐级别 */}
              <div
                className={`px-4 py-2 rounded-lg ${recInfo.bgColor} ${recInfo.color} flex items-center gap-2`}
              >
                <span className="text-lg">{recInfo.icon}</span>
                <span className="font-semibold">{recInfo.label}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 关键指标 */}
      <div>
        <h3 className="text-lg font-semibold mb-3">关键指标</h3>
        <KeyMetricsCards metrics={analysis.keyMetrics} />
      </div>

      {/* 风险与机会 */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* 风险因素 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span>⚠️</span>
              <span>风险因素</span>
              <span className="text-xs font-normal text-muted-foreground">
                ({analysis.riskFactors.length}项)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RiskFactorsList factors={analysis.riskFactors} />
          </CardContent>
        </Card>

        {/* 机会因素 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span>💡</span>
              <span>发展机会</span>
              <span className="text-xs font-normal text-muted-foreground">
                ({analysis.opportunities.length}项)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <OpportunitiesList opportunities={analysis.opportunities} />
          </CardContent>
        </Card>
      </div>

      {/* 分析摘要 */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>📝</span>
            <span>分析摘要</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {analysis.summary}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
