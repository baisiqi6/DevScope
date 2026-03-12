# DevScope Workflow 实施方案

## 📋 方案概述

基于现有 DevScope 项目架构，实现两个核心工作流：
1. **每日项目健康度报告** - 定时批量分析用户关注的仓库
2. **新项目快速评估** - 单个仓库的深度分析（6节点工作流）

---

## 🏗️ 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端层 (apps/web)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  WorkflowDashboard.tsx - 工作流列表与触发                │   │
│  │  WorkflowProgress.tsx - 实时进度展示 (SSE/WebSocket)     │   │
│  │  WorkflowReportViewer.tsx - 报告查看器                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ tRPC
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API 层 (apps/api)                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  workflow.router.ts - 工作流路由                         │   │
│  │  ├── triggerDailyReport() - 触发每日报告                │   │
│  │  ├── triggerQuickAssessment() - 触发快速评估            │   │
│  │  ├── getWorkflowProgress() - 获取进度                   │   │
│  │  └── getWorkflowReports() - 获取报告列表                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Workflow 引擎层 (新增)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  packages/workflow-engine/                               │   │
│  │  ├── engine.ts - 工作流执行引擎                          │   │
│  │  ├── nodes/ - 节点实现                                   │   │
│  │  │   ├── llm-node.ts - LLM节点                          │   │
│  │  │   ├── code-node.ts - 代码节点                        │   │
│  │  │   ├── http-node.ts - HTTP节点                        │   │
│  │  │   ├── loop-node.ts - 循环节点                        │   │
│  │  │   ├── branch-node.ts - 条件分支节点                  │   │
│  │  │   └── aggregation-node.ts - 聚合节点                 │   │
│  │  ├── scheduler.ts - 定时调度器                          │   │
│  │  └── progress-tracker.ts - 进度追踪                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   现有服务层                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ @devscope/ai │  │ @devscope/db │  │ @devscope/shared     │  │
│  │ AIProvider   │  │ Drizzle ORM  │  │ Zod Schemas          │  │
│  │ Embedding    │  │ Pipeline     │  │ Types                │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📦 新增包结构

### packages/workflow-engine

```
packages/workflow-engine/
├── src/
│   ├── engine.ts              # 工作流执行引擎
│   ├── scheduler.ts           # 定时调度器
│   ├── progress-tracker.ts    # 进度追踪 (Redis/内存)
│   ├── nodes/
│   │   ├── base.ts            # 基础节点类
│   │   ├── llm-node.ts        # LLM节点
│   │   ├── code-node.ts       # 代码节点
│   │   ├── http-node.ts       # HTTP请求节点
│   │   ├── loop-node.ts       # 循环节点
│   │   ├── branch-node.ts     # 条件分支节点
│   │   └── aggregation-node.ts # 聚合节点
│   ├── workflows/
│   │   ├── daily-health-report.ts    # 每日健康度报告
│   │   └── quick-assessment.ts       # 快速评估工作流
│   ├── index.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

---

## 🔄 工作流 1: 每日项目健康度报告

### 工作流图

```
┌─────────────────────────────────────────────────────────────────┐
│                     开始 (定时触发 08:00)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 1: 获取用户关注列表                                        │
│  类型: HTTP / 数据库查询                                         │
│  输入: userId                                                   │
│  输出: repositories: [{owner, repo}, ...]                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 2: 循环处理每个仓库                                        │
│  类型: LOOP                                                     │
│  遍历: repositories                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  子节点 2.1: GitHub 数据采集                            │   │
│  │  类型: HTTP (GitHub API)                                │   │
│  │  输入: {owner, repo}                                    │   │
│  │  输出: repoData                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  子节点 2.2: LLM 健康度分析                             │   │
│  │  类型: LLM                                              │   │
│  │  模型: claude-3-5-sonnet-20241022                      │   │
│  │  Schema: repositoryAnalysisSchema                       │   │
│  │  输出: analysis                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  子节点 2.3: 验证输出                                   │   │
│  │  类型: CODE (Zod 验证)                                  │   │
│  │  输出: isValid: boolean                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 3: 聚合与排序                                              │
│  类型: CODE                                                     │
│  逻辑: 按 healthScore 降序排列                                  │
│  输出: rankedAnalyses                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 4: 生成报告                                                │
│  类型: LLM                                                      │
│  模板: Markdown 报告模板                                        │
│  输出: reportMarkdown                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 5: 发送通知                                                │
│  类型: HTTP (Webhook / 邮件)                                    │
│  输出: deliveryId                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          结束                                    │
│  存储报告到数据库，发送完成信号                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 实现代码示例

```typescript
// packages/workflow-engine/src/workflows/daily-health-report.ts

import { WorkflowEngine } from '../engine';
import { LLMNode, CodeNode, HttpNode, LoopNode } from '../nodes';
import { repositoryAnalysisSchema } from '@devscope/shared';

export const dailyHealthReportWorkflow = {
  name: 'daily_health_report',
  description: '每日项目健康度报告',
  trigger: {
    type: 'cron',
    expression: '0 8 * * *', // 每天 8:00
  },
  nodes: [
    // 节点 1: 获取用户关注列表
    {
      id: 'fetch_watched_repos',
      type: 'code',
      handler: async (input) => {
        const db = createDb();
        const watched = await getWatchedRepositories(db, input.userId);
        return { repositories: watched };
      },
    },

    // 节点 2: 循环处理
    {
      id: 'process_repos_loop',
      type: 'loop',
      iterable: '$.repositories',
      nodes: [
        // 子节点 2.1: GitHub 数据采集
        {
          id: 'fetch_github_data',
          type: 'http',
          config: {
            url: `https://api.github.com/repos/${$.owner}/${$.repo}`,
            method: 'GET',
          },
        },

        // 子节点 2.2: LLM 分析
        {
          id: 'analyze_health',
          type: 'llm',
          config: {
            model: 'claude-3-5-sonnet-20241022',
            schema: repositoryAnalysisSchema,
            system: '你是专业的开源项目分析师...',
            temperature: 0.3,
          },
        },

        // 子节点 2.3: 验证
        {
          id: 'validate_output',
          type: 'code',
          handler: async (input) => {
            const validated = repositoryAnalysisSchema.safeParse(input.analysis);
            return {
              isValid: validated.success,
              analysis: validated.success ? validated.data : null,
            };
          },
        },
      ],
    },

    // 节点 3: 聚合排序
    {
      id: 'aggregate_and_rank',
      type: 'code',
      handler: async (input) => {
        const validAnalyses = input.results.filter(r => r.isValid);
        const ranked = validAnalyses.sort(
          (a, b) => b.analysis.healthScore - a.analysis.healthScore
        );
        return { rankedAnalyses: ranked };
      },
    },

    // 节点 4: 生成报告
    {
      id: 'generate_report',
      type: 'llm',
      config: {
        model: 'claude-3-5-sonnet-20241022',
        prompt: `基于以下分析结果，生成一份 Markdown 格式的健康度报告：
${JSON.stringify($.rankedAnalyses, null, 2)}

报告格式：
# 项目健康度日报
## 重点关注
## 需要关注
## 风险项目
## 数据统计`,
      },
    },

    // 节点 5: 发送通知
    {
      id: 'send_notification',
      type: 'http',
      config: {
        url: process.env.WEBHOOK_URL,
        method: 'POST',
        body: {
          report: '$.reportMarkdown',
          timestamp: new Date().toISOString(),
        },
      },
    },
  ],
};
```

---

## 🔄 工作流 2: 新项目快速评估 (6节点)

### 工作流图

```
┌─────────────────────────────────────────────────────────────────┐
│  开始 (用户触发: 输入 GitHub URL)                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 1: 信息采集                                                │
│  类型: HTTP + 代码节点                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • GitHub API: 仓库基本信息                              │   │
│  │ • HackerNews API: 相关讨论                              │   │
│  │ • README 解析                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 2: 代码质量分析                                            │
│  类型: LLM                                                      │
│  Schema: z.object({                                             │
│    architectureScore: z.number(),                               │
│    codeQualityScore: z.number(),                                │
│    documentationScore: z.number(),                              │
│    findings: z.array(z.string()),                               │
│  })                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 3: 社区活跃度分析                                          │
│  类型: LLM                                                      │
│  输入: stars, forks, issues, commits 数据                       │
│  Schema: z.object({                                             │
│    activityLevel: z.enum(["high", "medium", "low"]),            │
│    communityEngagement: z.number(),                             │
│    responseTime: z.number(),                                    │
│    contributors: z.number(),                                    │
│  })                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 4: 竞品分析                                                │
│  类型: LLM + HTTP                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • 基于项目语言和关键词搜索相似项目                       │   │
│  │ • LLM 分析竞争优势和劣势                                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 5: 风险评估                                                │
│  类型: LLM                                                      │
│  Schema: z.object({                                             │
│    riskLevel: z.enum(["low", "medium", "high", "critical"]),    │
│    riskFactors: z.array(z.object({                              │
│      category: z.string(),                                      │
│      description: z.string(),                                   │
│      mitigation: z.string(),                                    │
│    })),                                                         │
│  })                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  节点 6: 最终报告                                                │
│  类型: LLM + 聚合                                              │
│  汇总所有节点结果，生成综合评估报告                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  结束 (返回报告 + 存储到数据库)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 实现代码示例

```typescript
// packages/workflow-engine/src/workflows/quick-assessment.ts

import { z } from 'zod';

// 定义各节点的 Schema
const codeQualitySchema = z.object({
  architectureScore: z.number().min(0).max(100),
  codeQualityScore: z.number().min(0).max(100),
  documentationScore: z.number().min(0).max(100),
  findings: z.array(z.string()),
});

const communityActivitySchema = z.object({
  activityLevel: z.enum(["high", "medium", "low"]),
  communityEngagement: z.number().min(0).max(100),
  responseTime: z.number(), // 平均响应时间（小时）
  contributors: z.number(),
});

const competitorAnalysisSchema = z.object({
  competitors: z.array(z.object({
    name: z.string(),
    url: z.string(),
    similarity: z.number().min(0).max(100),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
  })),
  competitivePosition: z.enum(["leader", "challenger", "follower", "niche"]),
});

const riskAssessmentSchema = z.object({
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  riskFactors: z.array(z.object({
    category: z.string(),
    description: z.string(),
    severity: z.number().min(1).max(10),
    mitigation: z.string(),
  })),
});

export const quickAssessmentWorkflow = {
  name: 'quick_assessment',
  description: '新项目快速评估 (6节点)',
  trigger: {
    type: 'manual', // 用户手动触发
  },
  nodes: [
    // 节点 1: 信息采集
    {
      id: 'collect_information',
      type: 'code',
      handler: async (input) => {
        const { owner, repo } = parseGitHubUrl(input.url);
        const githubData = await fetchGitHubData(owner, repo);
        const hnData = await fetchHackerNewsData(repo);
        return {
          github: githubData,
          hackernews: hnData,
        };
      },
    },

    // 节点 2: 代码质量分析
    {
      id: 'analyze_code_quality',
      type: 'llm',
      config: {
        model: 'claude-3-5-sonnet-20241022',
        schema: codeQualitySchema,
        system: '你是代码质量分析专家，评估项目的架构、代码质量和文档...',
        prompt: `基于以下信息分析代码质量：
GitHub: ${$.github}
README: ${$.github.readme}`,
      },
    },

    // 节点 3: 社区活跃度分析
    {
      id: 'analyze_community',
      type: 'llm',
      config: {
        model: 'claude-3-5-sonnet-20241022',
        schema: communityActivitySchema,
        system: '你是社区分析专家，评估开源项目的社区活跃度...',
        prompt: `分析社区活跃度：
${JSON.stringify($.github)}`,
      },
    },

    // 节点 4: 竞品分析
    {
      id: 'analyze_competitors',
      type: 'llm',
      config: {
        model: 'claude-3-5-sonnet-20241022',
        schema: competitorAnalysisSchema,
        system: '你是市场竞争分析专家...',
        prompt: `分析 ${$.repo} 的竞争格局...`,
      },
    },

    // 节点 5: 风险评估
    {
      id: 'assess_risks',
      type: 'llm',
      config: {
        model: 'claude-3-5-sonnet-20241022',
        schema: riskAssessmentSchema,
        system: '你是风险评估专家...',
        prompt: `评估项目风险：
${$.codeQuality}
${$.community}
${$.github}`,
      },
    },

    // 节点 6: 最终报告
    {
      id: 'generate_final_report',
      type: 'llm',
      config: {
        model: 'claude-3-5-sonnet-20241022',
        prompt: `生成综合评估报告：
## 项目概览
${$.github}

## 代码质量
${$.codeQuality}

## 社区活跃度
${$.community}

## 竞争分析
${$.competitors}

## 风险评估
${$.risks}

请生成一份结构化的 Markdown 报告。`,
      },
    },
  ],
};
```

---

## 🔌 API 路由设计

### apps/api/src/router.ts

```typescript
import { router, publicProcedure } from './trpc';
import { WorkflowEngine } from '@devscope/workflow-engine';
import { z } from 'zod';

export const appRouter = router({
  // ... 现有路由

  // 工作流相关路由
  workflow: router({
    // 触发每日报告
    triggerDailyReport: publicProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        const engine = new WorkflowEngine();
        const executionId = await engine.trigger('daily_health_report', {
          userId: input.userId,
        });
        return { executionId };
      }),

    // 触发快速评估
    triggerQuickAssessment: publicProcedure
      .input(z.object({ url: z.string().url() }))
      .mutation(async ({ input }) => {
        const engine = new WorkflowEngine();
        const executionId = await engine.trigger('quick_assessment', {
          url: input.url,
        });
        return { executionId };
      }),

    // 获取工作流进度
    getProgress: publicProcedure
      .input(z.object({ executionId: z.string() }))
      .query(async ({ input }) => {
        const tracker = new ProgressTracker();
        return await tracker.getProgress(input.executionId);
      }),

    // 获取报告列表
    getReports: publicProcedure
      .input(z.object({
        userId: z.number().optional(),
        workflow: z.string().optional(),
        limit: z.number().default(20),
      }))
      .query(async ({ input }) => {
        const db = createDb();
        return await getWorkflowReports(db, input);
      }),

    // 获取单个报告
    getReport: publicProcedure
      .input(z.object({ reportId: z.number() }))
      .query(async ({ input }) => {
        const db = createDb();
        return await getWorkflowReport(db, input.reportId);
      }),
  }),
});
```

---

## 🎨 前端组件设计

### 1. 工作流触发组件

```typescript
// apps/web/src/components/workflow-trigger.tsx

import { trpc } from '@/lib/trpc';
import { useState } from 'react';

export function WorkflowTrigger() {
  const [url, setUrl] = useState('');
  const triggerMutation = trpc.workflow.triggerQuickAssessment.useMutation();

  const handleTrigger = () => {
    triggerMutation.mutate(
      { url },
      {
        onSuccess: (data) => {
          // 跳转到进度页面
          window.location.href = `/workflows/${data.executionId}`;
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo"
        className="w-full px-4 py-2 border rounded"
      />
      <button
        onClick={handleTrigger}
        disabled={triggerMutation.isPending}
        className="px-6 py-2 bg-blue-600 text-white rounded"
      >
        {triggerMutation.isPending ? '启动中...' : '开始评估'}
      </button>
    </div>
  );
}
```

### 2. 工作流进度展示

```typescript
// apps/web/src/components/workflow-progress.tsx

import { trpc } from '@/lib/trpc';
import { useEffect, useState } from 'react';

interface WorkflowProgressProps {
  executionId: string;
}

export function WorkflowProgress({ executionId }: WorkflowProgressProps) {
  const [progress, setProgress] = useState(null);

  // 使用轮询或 SSE 获取进度
  const progressQuery = trpc.workflow.getProgress.useQuery(
    { executionId },
    {
      refetchInterval: (data) => {
        // 完成后停止轮询
        return data?.state === 'completed' ? false : 2000;
      },
    }
  );

  if (progressQuery.isLoading) return <div>加载中...</div>;
  if (progressQuery.error) return <div>错误: {progressQuery.error.message}</div>;

  const { currentStep, totalSteps, completedSteps, state } = progressQuery.data;

  return (
    <div className="space-y-4">
      {/* 进度条 */}
      <div className="w-full bg-gray-200 rounded-full h-4">
        <div
          className="bg-blue-600 h-4 rounded-full transition-all"
          style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
        />
      </div>

      {/* 节点状态 */}
      <div className="space-y-2">
        {progressQuery.data.nodes.map((node) => (
          <div
            key={node.id}
            className={`flex items-center gap-2 p-3 rounded ${
              node.status === 'completed'
                ? 'bg-green-100'
                : node.status === 'running'
                ? 'bg-blue-100'
                : 'bg-gray-100'
            }`}
          >
            <span className="text-sm font-medium">{node.name}</span>
            <span className="text-xs text-gray-500">{node.status}</span>
          </div>
        ))}
      </div>

      {/* 完成后显示报告按钮 */}
      {state === 'completed' && (
        <button
          onClick={() => window.location.href = `/reports/${executionId}`}
          className="px-6 py-2 bg-green-600 text-white rounded"
        >
          查看报告
        </button>
      )}
    </div>
  );
}
```

### 3. 报告查看器

```typescript
// apps/web/src/components/workflow-report-viewer.tsx

import { trpc } from '@/lib/trpc';
import { useParams } from 'next/navigation';

export function WorkflowReportViewer() {
  const { reportId } = useParams();
  const { data: report, isLoading } = trpc.workflow.getReport.useQuery({
    reportId: Number(reportId),
  });

  if (isLoading) return <div>加载中...</div>;

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="bg-white rounded-lg shadow p-8">
        <h1 className="text-3xl font-bold mb-4">{report.title}</h1>
        <div className="text-sm text-gray-500 mb-6">
          生成时间: {new Date(report.createdAt).toLocaleString()}
        </div>

        {/* Markdown 内容渲染 */}
        <div className="prose max-w-none">
          <ReactMarkdown>{report.content}</ReactMarkdown>
        </div>

        {/* 元数据 */}
        <div className="mt-8 pt-8 border-t">
          <h3 className="text-lg font-semibold mb-4">元数据</h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">工作流</dt>
              <dd className="font-medium">{report.workflowName}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">执行时间</dt>
              <dd className="font-medium">{report.duration}ms</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">状态</dt>
              <dd className="font-medium">{report.status}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
```

---

## 📊 数据库 Schema 扩展

```sql
-- 工作流执行记录表
CREATE TABLE workflow_executions (
  id SERIAL PRIMARY KEY,
  workflow_name VARCHAR(100) NOT NULL,
  execution_id VARCHAR(100) UNIQUE NOT NULL,
  trigger_type VARCHAR(20) NOT NULL, -- 'manual' | 'cron' | 'webhook'
  input_data JSONB,
  status VARCHAR(20) NOT NULL, -- 'pending' | 'running' | 'completed' | 'failed'
  current_node VARCHAR(100),
  completed_nodes TEXT[],
  error_message TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_ms INTEGER
);

-- 工作流报告表
CREATE TABLE workflow_reports (
  id SERIAL PRIMARY KEY,
  execution_id VARCHAR(100) REFERENCES workflow_executions(execution_id),
  workflow_name VARCHAR(100) NOT NULL,
  title VARCHAR(500),
  content TEXT NOT NULL, -- Markdown
  format VARCHAR(20) DEFAULT 'markdown', -- 'markdown' | 'json' | 'html'
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 用户关注仓库表 (用于每日报告)
CREATE TABLE user_watched_repositories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  repo_full_name VARCHAR(200) NOT NULL, -- 'owner/repo'
  priority INTEGER DEFAULT 0, -- 优先级，用于排序
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, repo_full_name)
);
```

---

## 🚀 实施步骤

### Phase 1: 基础设施 (2-3天)

1. **创建 workflow-engine 包**
   ```bash
   mkdir -p packages/workflow-engine/src
   cd packages/workflow-engine
   pnpm init
   ```

2. **实现核心节点类型**
   - [ ] BaseNode 基类
   - [ ] LLMNode
   - [ ] CodeNode
   - [ ] HttpNode
   - [ ] LoopNode
   - [ ] BranchNode
   - [ ] AggregationNode

3. **实现工作流引擎**
   - [ ] Engine 类
   - [ ] 进度追踪器
   - [ ] 错误处理和重试逻辑
   - [ ] 状态持久化

### Phase 2: 工作流实现 (2-3天)

1. **每日健康度报告**
   - [ ] 定义工作流配置
   - [ ] 实现各节点逻辑
   - [ ] 配置定时任务

2. **快速评估工作流**
   - [ ] 定义 6 节点工作流
   - [ ] 实现各节点 Schema
   - [ ] 集成现有 AI 和 DB 服务

### Phase 3: API 和前端 (2天)

1. **tRPC 路由**
   - [ ] workflow.router.ts
   - [ ] 进度查询接口
   - [ ] 报告查询接口

2. **前端组件**
   - [ ] WorkflowTrigger
   - [ ] WorkflowProgress
   - [ ] ReportViewer
   - [ ] Dashboard 页面

### Phase 4: 测试和优化 (1-2天)

1. **单元测试**
   - [ ] 节点测试
   - [ ] 工作流测试

2. **集成测试**
   - [ ] 端到端测试
   - [ ] 性能测试

3. **错误处理优化**
   - [ ] 重试策略
   - [ ] 降级方案
   - [ ] 监控告警

---

## 📝 环境变量配置

```bash
# .env.local

# 工作流引擎配置
WORKFLOW_ENGINE_MODE=production  # 'development' | 'production'
WORKFLOW_TIMEOUT=300000  # 5分钟超时
WORKFLOW_MAX_CONCURRENT=5  # 最大并发执行数

# 定时任务配置
WORKFLOW_SCHEDULER_ENABLED=true
WORKFLOW_SCHEDULER_TIMEZONE=Asia/Shanghai

# 进度追踪配置
PROGRESS_TRACKER_TYPE=redis  # 'memory' | 'redis'
REDIS_URL=redis://localhost:6379

# 通知配置
WEBHOOK_URL=https://your-webhook-url.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=notifications@example.com
SMTP_PASS=your-password
```

---

## 🎯 交付标准

### 必须完成

- [ ] 两个工作流在 Langtum 中可运行
- [ ] 工作流通过 Webhook 与后端联通
- [ ] 前端有实时进度展示
- [ ] 至少一个工作流有错误处理和重试逻辑

### 可选完成

- [ ] 工作流可视化编辑器
- [ ] 报告导出功能 (PDF/Excel)
- [ ] 邮件通知集成
- [ ] 历史报告对比分析

---

*文档生成时间: 2026-03-11*
