# DevScope × Langtum 集成方案 (修正版)

## 📋 方案概述

基于 Langtum 平台的 **开始→处理→结束** 工作流模式，实现以下架构：

- **对接方式**：混合模式（后端调用 Langtum API + Webhook 进度通知 + Polling 获取结果）
- **节点处理**：Langtum 内置 LLM 能力（仅在需要时调用 DevScope API）
- **触发模式**：触发+通知模式（Langtum 定时触发 → Webhook 通知 DevScope）

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                      DevScope 前端                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • 触发工作流按钮                                        │   │
│  │  • 实时进度展示 (Polling Langtum)                       │   │
│  │  • 报告查看器                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ tRPC
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DevScope 后端 API                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  POST /api/workflow/trigger                             │   │
│  │  → 调用 Langtum OpenAPI 触发工作流                      │   │
│  │                                                          │   │
│  │  POST /api/webhook/langtum/progress                     │   │
│  │  ← 接收 Langtum 进度 Webhook                            │   │
│  │                                                          │   │
│  │  POST /api/webhook/langtum/completed                    │   │
│  │  ← 接收 Langtum 完成通知，存储报告                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP OpenAPI
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Langtum 平台                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  工作流: 开始节点 → [处理节点] → 结束节点                 │   │
│  │                                                          │   │
│  │  • LLM 节点: 直接配置 Claude 模型和 Prompt               │   │
│  │  • HTTP 节点: 调用 DevScope API 获取数据                 │   │
│  │  • Cron 触发器: 每天 8:00 自动触发                       │   │
│  │  • Webhook 输出: 进度/完成通知                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 工作流 1: 每日健康度报告

### Langtum 工作流设计

```
┌─────────────────────────────────────────────────────────────────┐
│  开始节点                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  输入: 无 (Cron 触发)                                    │   │
│  │  配置: 每天 08:00 触发                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 1: 获取用户关注列表                                    │
│  类型: HTTP 请求                                                │
│  配置:                                                          │
│    URL: {{DEVSCOPE_API_URL}}/api/workflow/watched-repos        │
│    Method: POST                                                │
│    Headers: { X-API-Key: {{API_KEY}} }                         │
│  输出变量: watched_repos                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 2: 循环处理每个仓库                                    │
│  类型: 循环节点                                                │
│  遍历: watched_repos.repositories                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  子节点 2.1: 获取 GitHub 数据                           │   │
│  │  类型: HTTP 请求                                        │   │
│  │  URL: https://api.github.com/repos/{{owner}}/{{repo}}  │   │
│  │                                                          │   │
│  │  子节点 2.2: LLM 健康度分析（Langtum 内置）             │   │
│  │  类型: LLM                                              │   │
│  │  模型: claude-3-5-sonnet-20241022                      │   │
│  │  System Prompt: [从 DevScope API 获取]                  │   │
│  │  User Prompt: 分析仓库 {{owner}}/{{repo}} 的健康状况   │   │
│  │  输出 Schema: [JSON Schema 格式]                       │   │
│  │                                                          │   │
│  │  子节点 2.3: 发送进度 Webhook                           │   │
│  │  类型: HTTP 请求                                        │   │
│  │  URL: {{DEVSCOPE_API_URL}}/api/webhook/langtum/progress │   │
│  │  Body: { step: "analyzing", repo: "{{owner}}/{{repo}}" }│   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 3: 汇总排序                                            │
│  类型: 代码节点 (JavaScript)                                    │
│  代码:                                                          │
│    const ranked = analyses.sort((a, b) =>                      │
│      b.health_score - a.health_score                            │
│    );                                                           │
│    return { ranked_analyses: ranked };                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 4: 生成报告（LLM）                                     │
│  类型: LLM                                                      │
│  模型: claude-3-5-sonnet-20241022                              │
│  Prompt: 基于以下分析结果生成 Markdown 日报...                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  结束节点                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  输出配置: Webhook                                       │   │
│  │  URL: {{DEVSCOPE_API_URL}}/api/webhook/langtum/completed │   │
│  │  Method: POST                                            │   │
│  │  Headers: { X-Webhook-Secret: {{SECRET}} }              │   │
│  │  Body: {                                                 │   │
│  │    workflow: "daily_health_report",                     │   │
│  │    report_markdown: "{{report_markdown}}",              │   │
│  │    execution_id: "{{execution_id}}",                   │   │
│  │    metadata: { ... }                                    │   │
│  │  }                                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 工作流 2: 快速评估 (6节点)

### Langtum 工作流设计

```
┌─────────────────────────────────────────────────────────────────┐
│  开始节点                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  输入: { url: string }  // 用户输入的 GitHub URL        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 1: 信息采集                                            │
│  类型: 代码节点 (JavaScript)                                    │
│  代码: 解析 URL，并行请求 GitHub API + HackerNews API          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 2: 代码质量分析（LLM）                                 │
│  类型: LLM                                                      │
│  模型: claude-3-5-sonnet-20241022                              │
│  System Prompt: 从 DevScope API 获取                            │
│  Output Schema: {                                              │
│    architecture_score: number,                                 │
│    code_quality_score: number,                                 │
│    documentation_score: number,                                │
│    findings: string[]                                          │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 3: 社区活跃度分析（LLM）                               │
│  类型: LLM                                                      │
│  Output Schema: {                                              │
│    activity_level: "high" | "medium" | "low",                  │
│    community_engagement: number,                               │
│    response_time: number,                                      │
│    contributors: number                                        │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 4: 竞品分析（LLM）                                     │
│  类型: LLM                                                      │
│  Output Schema: {                                              │
│    competitors: [{ name, url, similarity, strengths, weaknesses }],│
│    competitive_position: "leader" | "challenger" | "follower" | "niche"│
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 5: 风险评估（LLM）                                     │
│  类型: LLM                                                      │
│  Output Schema: {                                              │
│    risk_level: "low" | "medium" | "high" | "critical",         │
│    risk_factors: [{ category, description, severity, mitigation }]│
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  处理节点 6: 生成最终报告（LLM）                                 │
│  类型: LLM                                                      │
│  Prompt: 汇总前面 5 个节点的结果，生成综合评估报告              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  结束节点                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  输出配置: Webhook                                       │   │
│  │  URL: {{DEVSCOPE_API_URL}}/api/webhook/langtum/completed │   │
│  │  Body: { workflow: "quick_assessment", ... }            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔌 DevScope 后端实现

### 1. Langtum API 客户端

```typescript
// packages/ai/src/langtum.ts

export interface LangtumConfig {
  baseUrl: string;
  apiKey: string;
}

export class LangtumClient {
  private config: LangtumConfig;

  constructor(config: LangtumConfig) {
    this.config = config;
  }

  /**
   * 触发工作流执行
   */
  async triggerWorkflow(
    workflowName: string,
    input: Record<string, unknown>
  ): Promise<{ executionId: string; status: string }> {
    const response = await fetch(
      `${this.config.baseUrl}/api/v1/workflows/${workflowName}/trigger`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(input),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to trigger workflow: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 获取工作流执行状态
   */
  async getExecutionStatus(executionId: string) {
    const response = await fetch(
      `${this.config.baseUrl}/api/v1/executions/${executionId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get execution status: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 获取工作流执行结果
   */
  async getExecutionResult(executionId: string) {
    const response = await fetch(
      `${this.config.baseUrl}/api/v1/executions/${executionId}/result`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get execution result: ${response.statusText}`);
    }

    return await response.json();
  }
}
```

### 2. tRPC 路由

```typescript
// apps/api/src/router/workflow.ts

import { router, publicProcedure } from './trpc';
import { LangtumClient } from '@devscope/ai';
import { z } from 'zod';

const langtum = new LangtumClient({
  baseUrl: process.env.LANGTUM_API_URL!,
  apiKey: process.env.LANGTUM_API_KEY!,
});

export const workflowRouter = router({
  /**
   * 触发快速评估工作流
   */
  triggerQuickAssessment: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const result = await langtum.triggerWorkflow('quick_assessment', {
        url: input.url,
      });

      // 保存执行记录到数据库
      const db = createDb();
      await saveWorkflowExecution(db, {
        executionId: result.executionId,
        workflowName: 'quick_assessment',
        status: 'running',
        input: input,
      });

      return {
        executionId: result.executionId,
        status: result.status,
      };
    }),

  /**
   * 获取工作流执行状态（供前端轮询）
   */
  getExecutionStatus: publicProcedure
    .input(z.object({ executionId: z.string() }))
    .query(async ({ input }) => {
      // 先从本地数据库查询
      const db = createDb();
      const local = await getWorkflowExecution(db, input.executionId);

      if (!local) {
        throw new Error('Execution not found');
      }

      // 如果未完成，向 Langtum 查询最新状态
      if (local.status === 'running') {
        const remote = await langtum.getExecutionStatus(input.executionId);

        // 更新本地状态
        await updateWorkflowExecution(db, input.executionId, {
          status: remote.status,
          currentNode: remote.currentNode,
          completedNodes: remote.completedNodes,
        });

        return {
          executionId: local.executionId,
          workflowName: local.workflowName,
          status: remote.status,
          currentNode: remote.currentNode,
          completedNodes: remote.completedNodes,
          totalNodes: remote.totalNodes,
          startedAt: local.createdAt,
        };
      }

      // 已完成，返回本地数据
      return {
        executionId: local.executionId,
        workflowName: local.workflowName,
        status: local.status,
        result: local.result,
        startedAt: local.createdAt,
        completedAt: local.completedAt,
      };
    }),

  /**
   * 获取用户关注列表（供 Langtum 调用）
   */
  getWatchedRepos: publicProcedure
    .input(z.object({ userId: z.number().optional() }))
    .query(async ({ input }) => {
      const db = createDb();
      const watched = await db
        .select()
        .from(userWatchedRepositories)
        .where(
          input.userId
            ? eq(userWatchedRepositories.userId, input.userId)
            : sql`true`
        );

      return {
        repositories: watched.map((w) => ({
          owner: w.repoFullName.split('/')[0],
          repo: w.repoFullName.split('/')[1],
        })),
      };
    }),

  /**
   * 获取 LLM System Prompt（供 Langtum 调用）
   */
  getSystemPrompt: publicProcedure
    .input(z.object({ promptName: z.string() }))
    .query(async ({ input }) => {
      const prompts: Record<string, string> = {
        repository_analysis: `你是专业的开源项目分析师...`,
        code_quality: `你是代码质量分析专家...`,
        community_analysis: `你是社区分析专家...`,
        competitor_analysis: `你是市场竞争分析专家...`,
        risk_assessment: `你是风险评估专家...`,
      };

      const prompt = prompts[input.promptName];
      if (!prompt) {
        throw new Error(`Prompt not found: ${input.promptName}`);
      }

      return { prompt };
    }),

  /**
   * 获取工作流报告列表
   */
  getReports: publicProcedure
    .input(
      z.object({
        workflowName: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      const db = createDb();
      const reports = await db
        .select()
        .from(workflowReports)
        .where(
          input.workflowName
            ? eq(workflowReports.workflowName, input.workflowName)
            : sql`true`
        )
        .orderBy(desc(workflowReports.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return reports;
    }),

  /**
   * 获取单个报告
   */
  getReport: publicProcedure
    .input(z.object({ reportId: z.number() }))
    .query(async ({ input }) => {
      const db = createDb();
      const report = await db
        .select()
        .from(workflowReports)
        .where(eq(workflowReports.id, input.reportId))
        .limit(1);

      if (!report[0]) {
        throw new Error('Report not found');
      }

      return report[0];
    }),
});
```

### 3. Webhook 处理

```typescript
// apps/api/src/webhook/langtum.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { createDb } from '@devscope/db';
import crypto from 'crypto';

/**
 * 验证 Webhook 签名
 */
function verifyWebhookSignature(
  body: unknown,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');

  return signature === expectedSignature;
}

/**
 * 接收 Langtum 进度通知
 */
export async function langtumProgressWebhook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const signature = request.headers['x-webhook-signature'] as string;
  const secret = process.env.LANGTUM_WEBHOOK_SECRET!;

  // 验证签名
  if (!verifyWebhookSignature(request.body, signature, secret)) {
    return reply.status(401).send({ error: 'Invalid signature' });
  }

  const body = request.body as {
    executionId: string;
    workflowName: string;
    currentNode: string;
    completedNodes: string[];
    progress: number;
  };

  // 更新数据库中的执行状态
  const db = createDb();
  await updateWorkflowExecution(db, body.executionId, {
    currentNode: body.currentNode,
    completedNodes: body.completedNodes,
  });

  return { received: true };
}

/**
 * 接收 Langtum 完成通知
 */
export async function langtumCompletedWebhook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const signature = request.headers['x-webhook-signature'] as string;
  const secret = process.env.LANGTUM_WEBHOOK_SECRET!;

  // 验证签名
  if (!verifyWebhookSignature(request.body, signature, secret)) {
    return reply.status(401).send({ error: 'Invalid signature' });
  }

  const body = request.body as {
    executionId: string;
    workflowName: string;
    result: {
      reportMarkdown?: string;
      analyses?: unknown[];
      [key: string]: unknown;
    };
    metadata?: Record<string, unknown>;
  };

  // 保存报告到数据库
  const db = createDb();
  await saveWorkflowReport(db, {
    executionId: body.executionId,
    workflowName: body.workflowName,
    content: body.result.reportMarkdown || JSON.stringify(body.result),
    metadata: body.metadata,
  });

  // 更新执行状态为完成
  await updateWorkflowExecution(db, body.executionId, {
    status: 'completed',
    completedAt: new Date(),
    result: body.result,
  });

  return { received: true };
}
```

---

## 🎨 前端实现

### 1. 工作流触发组件

```typescript
// apps/web/src/components/workflow/quick-assessment-trigger.tsx

'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export function QuickAssessmentTrigger() {
  const [url, setUrl] = useState('');
  const triggerMutation = trpc.workflow.triggerQuickAssessment.useMutation({
    onSuccess: (data) => {
      // 跳转到进度页面
      window.location.href = `/workflows/${data.executionId}`;
    },
  });

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
        onClick={() => triggerMutation.mutate({ url })}
        disabled={triggerMutation.isPending || !url}
        className="px-6 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {triggerMutation.isPending ? '启动中...' : '开始评估'}
      </button>
    </div>
  );
}
```

### 2. 工作流进度组件（轮询）

```typescript
// apps/web/src/components/workflow/progress-viewer.tsx

'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useParams } from 'next/navigation';

export function WorkflowProgressViewer() {
  const { executionId } = useParams<{ executionId: string }>();
  const [status, setStatus] = useState<any>(null);

  // 轮询执行状态
  const statusQuery = trpc.workflow.getExecutionStatus.useQuery(
    { executionId: executionId! },
    {
      refetchInterval: (data) => {
        // 完成后停止轮询
        return data?.status === 'completed' ? false : 2000;
      },
    }
  );

  if (statusQuery.isLoading) return <div>加载中...</div>;
  if (statusQuery.error) return <div>错误: {statusQuery.error.message}</div>;

  const data = statusQuery.data;
  const progress = data
    ? Math.round((data.completedNodes?.length / data.totalNodes) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">工作流执行进度</h2>

        {/* 进度条 */}
        <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
          <div
            className="bg-blue-600 h-4 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 状态信息 */}
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-gray-500">工作流:</span>
            <span className="ml-2 font-medium">{data?.workflowName}</span>
          </div>
          <div>
            <span className="text-gray-500">状态:</span>
            <span className="ml-2 font-medium">{data?.status}</span>
          </div>
          <div>
            <span className="text-gray-500">当前节点:</span>
            <span className="ml-2 font-medium">{data?.currentNode || '-'}</span>
          </div>
          <div>
            <span className="text-gray-500">进度:</span>
            <span className="ml-2 font-medium">{progress}%</span>
          </div>
        </div>
      </div>

      {/* 完成后显示查看报告按钮 */}
      {data?.status === 'completed' && (
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

---

## 📊 数据库 Schema

```typescript
// packages/db/src/schema/workflow.ts

import { pgTable, serial, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

/**
 * 工作流执行记录表
 */
export const workflowExecutions = pgTable('workflow_executions', {
  id: serial('id').primaryKey(),
  executionId: text('execution_id').notNull().unique(),
  workflowName: text('workflow_name').notNull(),
  status: text('status').notNull(), // 'running' | 'completed' | 'failed'
  input: jsonb('input'),
  currentNode: text('current_node'),
  completedNodes: jsonb('completed_nodes').$type<string[]>(),
  totalNodes: integer('total_nodes'),
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

/**
 * 工作流报告表
 */
export const workflowReports = pgTable('workflow_reports', {
  id: serial('id').primaryKey(),
  executionId: text('execution_id').notNull().unique(),
  workflowName: text('workflow_name').notNull(),
  title: text('title'),
  content: text('content').notNull(), // Markdown
  format: text('format').default('markdown'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * 用户关注仓库表
 */
export const userWatchedRepositories = pgTable('user_watched_repositories', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  repoFullName: text('repo_full_name').notNull(),
  priority: integer('priority').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## 🚀 实施步骤

### Step 1: 在 Langtum 平台创建工作流 (1天)

1. 登录 Langtum 平台
2. 创建项目 `DevScope`
3. 创建工作流 `daily_health_report`：
   - 配置 Cron 触发器
   - 添加各处理节点
   - 配置结束节点 Webhook
4. 创建工作流 `quick_assessment`：
   - 配置 6 个处理节点
   - 配置结束节点 Webhook

### Step 2: 实现 DevScope 后端 (1天)

```bash
# 创建 Langtum 客户端
touch packages/ai/src/langtum.ts

# 创建工作流路由
touch apps/api/src/router/workflow.ts

# 创建 Webhook 处理
mkdir -p apps/api/src/webhook
touch apps/api/src/webhook/langtum.ts
```

### Step 3: 扩展数据库 Schema (0.5天)

```bash
# 添加工作流相关表
# 编辑 packages/db/src/schema/workflow.ts
```

### Step 4: 前端集成 (1天)

```bash
# 创建工作流组件
mkdir -p apps/web/src/components/workflow
touch apps/web/src/components/workflow/quick-assessment-trigger.tsx
touch apps/web/src/components/workflow/progress-viewer.tsx

# 创建页面
mkdir -p apps/web/src/app/workflows
touch apps/web/src/app/workflows/[executionId]/page.tsx
```

### Step 5: 联调测试 (0.5天)

---

## 🔐 环境变量

```bash
# .env.local

# Langtum 配置
LANGTUM_API_URL=https://your-langtum-instance.com
LANGTUM_API_KEY=your-api-key
LANGTUM_WEBHOOK_SECRET=your-webhook-secret

# DevScope API URL (供 Langtum 回调)
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

*文档生成时间: 2026-03-11*
