# DevScope × Langtum 集成方案

## 📋 方案概述

使用 **Langtum 平台** 作为工作流引擎，通过 **Webhook** 与 DevScope 后端集成。这是最快速、最低成本的实施方案。

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户/定时触发                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Langtum 平台                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  工作流 1: 每日健康度报告                                 │   │
│  │  工作流 2: 快速评估                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                    ↓ Webhook 调用                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DevScope 后端 API                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  POST /api/webhook/langtum                               │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │  接收 Langtum 节点回调                            │    │   │
│  │  │  • 调用 @devscope/ai 进行 LLM 操作               │    │   │
│  │  │  • 调用 @devscope/db 进行数据存储                │    │   │
│  │  │  • 返回结果给 Langtum                            │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DevScope 前端                                 │
│  • 触发工作流按钮                                               │
│  • 实时进度展示 (通过 Langtum SDK)                              │
│  • 报告查看器                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 在 Langtum 中创建工作流

### 工作流 1: 每日健康度报告

在 Langtum 平台上创建工作流，配置如下：

#### 节点配置

| 节点 ID | 节点类型 | 配置说明 | 输出变量 |
|---------|---------|---------|----------|
| `get_watched` | HTTP 请求 | 调用 DevScope API 获取关注列表 | `repositories` |
| `loop_repos` | 循环节点 | 遍历 `repositories` | - |
| `fetch_github` | HTTP 请求 | GitHub API 获取仓库数据 | `github_data` |
| `analyze_health` | **Webhook** | 调用 DevScope LLM 分析接口 | `analysis` |
| `validate` | 代码节点 | Zod 验证输出 | `is_valid` |
| `aggregate` | 代码节点 | 聚合排序结果 | `ranked_list` |
| `generate_report` | **Webhook** | 调用 DevScope 生成报告接口 | `report_markdown` |
| `send_notification` | HTTP 请求 | 发送 Webhook/邮件 | `delivery_id` |

#### Langtum 工作流 JSON 示例

```json
{
  "name": "daily_health_report",
  "description": "每日项目健康度报告",
  "trigger": {
    "type": "cron",
    "expression": "0 8 * * *"
  },
  "nodes": [
    {
      "id": "get_watched",
      "type": "http",
      "config": {
        "method": "POST",
        "url": "https://your-api.com/api/webhook/langtum",
        "headers": {
          "X-Action": "get_watched_repositories"
        },
        "body": {
          "user_id": "{{USER_ID}}"
        }
      }
    },
    {
      "id": "loop_repos",
      "type": "loop",
      "iterable": "$.get_watched.repositories",
      "nodes": [
        {
          "id": "fetch_github",
          "type": "http",
          "config": {
            "url": "https://api.github.com/repos/{{$.owner}}/{{$.repo}}"
          }
        },
        {
          "id": "analyze_health",
          "type": "webhook",
          "config": {
            "url": "https://your-api.com/api/webhook/langtum",
            "method": "POST",
            "headers": {
              "X-Action": "analyze_repository"
            },
            "body": {
              "owner": "{{$.owner}}",
              "repo": "{{$.repo}}",
              "github_data": "{{$.fetch_github}}"
            }
          }
        }
      ]
    },
    {
      "id": "generate_report",
      "type": "webhook",
      "config": {
        "url": "https://your-api.com/api/webhook/langtum",
        "method": "POST",
        "headers": {
          "X-Action": "generate_report"
        },
        "body": {
          "analyses": "{{$.loop_repos}}"
        }
      }
    }
  ]
}
```

### 工作流 2: 快速评估 (6节点)

| 节点 ID | 节点类型 | 功能说明 | Webhook Action |
|---------|---------|---------|----------------|
| `collect_info` | HTTP 请求 | 采集 GitHub + HN 数据 | - |
| `code_quality` | **Webhook** | LLM 代码质量分析 | `analyze_code_quality` |
| `community` | **Webhook** | LLM 社区活跃度分析 | `analyze_community` |
| `competitors` | **Webhook** | LLM 竞品分析 | `analyze_competitors` |
| `risks` | **Webhook** | LLM 风险评估 | `assess_risks` |
| `final_report` | **Webhook** | 生成最终报告 | `generate_final_report` |

---

## 🔌 DevScope 后端实现

### 新增 Webhook 路由

```typescript
// apps/api/src/webhook/langtum.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { createAI } from '@devscope/ai';
import { createDb } from '@devscope/db';
import { z } from 'zod';

const ai = createAI();

// Langtum Webhook 处理器
export async function langtumWebhook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const action = request.headers['x-action'] as string;
  const body = request.body as any;

  try {
    switch (action) {
      // 获取用户关注列表
      case 'get_watched_repositories':
        return await getWatchedRepositories(body);

      // 分析仓库健康度
      case 'analyze_repository':
        return await analyzeRepository(body);

      // 代码质量分析
      case 'analyze_code_quality':
        return await analyzeCodeQuality(body);

      // 社区活跃度分析
      case 'analyze_community':
        return await analyzeCommunity(body);

      // 竞品分析
      case 'analyze_competitors':
        return await analyzeCompetitors(body);

      // 风险评估
      case 'assess_risks':
        return await assessRisks(body);

      // 生成报告
      case 'generate_report':
        return await generateReport(body);

      default:
        return reply.status(400).send({ error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Langtum webhook error:', error);
    return reply.status(500).send({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

// 实现各个 Action 处理函数

async function getWatchedRepositories(input: any) {
  const db = createDb();
  const watched = await db
    .select()
    .from(userWatchedRepositories)
    .where(eq(userWatchedRepositories.userId, input.userId));

  return {
    repositories: watched.map((w) => ({
      owner: w.repoFullName.split('/')[0],
      repo: w.repoFullName.split('/')[1],
    })),
  };
}

async function analyzeRepository(input: any) {
  const { owner, repo, githubData } = input;

  const result = await ai.structuredComplete(
    `分析 GitHub 仓库 ${owner}/${repo} 的健康状况...`,
    {
      schema: repositoryAnalysisSchema,
      toolName: 'repository_analysis',
      system: '你是专业的开源项目分析师...',
      temperature: 0.3,
    }
  );

  return { analysis: result };
}

async function analyzeCodeQuality(input: any) {
  const codeQualitySchema = z.object({
    architectureScore: z.number().min(0).max(100),
    codeQualityScore: z.number().min(0).max(100),
    documentationScore: z.number().min(0).max(100),
    findings: z.array(z.string()),
  });

  const result = await ai.structuredComplete(
    `分析代码质量：\n${JSON.stringify(input.githubData)}`,
    {
      schema: codeQualitySchema,
      toolName: 'code_quality_analysis',
      system: '你是代码质量分析专家...',
    }
  );

  return { codeQuality: result };
}

async function analyzeCommunity(input: any) {
  const communitySchema = z.object({
    activityLevel: z.enum(['high', 'medium', 'low']),
    communityEngagement: z.number().min(0).max(100),
    responseTime: z.number(),
    contributors: z.number(),
  });

  const result = await ai.structuredComplete(
    `分析社区活跃度：\n${JSON.stringify(input.githubData)}`,
    {
      schema: communitySchema,
      toolName: 'community_analysis',
    }
  );

  return { community: result };
}

async function analyzeCompetitors(input: any) {
  const competitorSchema = z.object({
    competitors: z.array(
      z.object({
        name: z.string(),
        url: z.string(),
        similarity: z.number().min(0).max(100),
        strengths: z.array(z.string()),
        weaknesses: z.array(z.string()),
      })
    ),
    competitivePosition: z.enum(['leader', 'challenger', 'follower', 'niche']),
  });

  const result = await ai.structuredComplete(
    `分析 ${input.repo} 的竞争格局...`,
    {
      schema: competitorSchema,
      toolName: 'competitor_analysis',
    }
  );

  return { competitors: result };
}

async function assessRisks(input: any) {
  const riskSchema = z.object({
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    riskFactors: z.array(
      z.object({
        category: z.string(),
        description: z.string(),
        severity: z.number().min(1).max(10),
        mitigation: z.string(),
      })
    ),
  });

  // 汇总前面节点的结果
  const context = {
    codeQuality: input.codeQuality,
    community: input.community,
    githubData: input.githubData,
  };

  const result = await ai.structuredComplete(
    `评估项目风险：\n${JSON.stringify(context)}`,
    {
      schema: riskSchema,
      toolName: 'risk_assessment',
    }
  );

  return { risks: result };
}

async function generateReport(input: any) {
  const { analyses } = input;

  const report = await ai.complete(
    `生成健康度报告，基于以下分析结果：\n${JSON.stringify(analyses, null, 2)}`,
    {
      system: `你是报告生成专家，请生成 Markdown 格式的报告。
格式：
# 项目健康度日报
## 重点关注 (healthScore > 80)
## 需要关注 (healthScore 60-80)
## 风险项目 (healthScore < 60)
## 数据统计`,
      maxTokens: 2000,
    }
  );

  // 保存到数据库
  const db = createDb();
  await saveReport(db, {
    workflowName: 'daily_health_report',
    content: report,
    metadata: { analyses },
  });

  return { reportMarkdown: report };
}
```

### 注册 Webhook 路由

```typescript
// apps/api/src/index.ts

import { langtumWebhook } from './webhook/langtum';

async function main() {
  const app = fastify();

  // 注册 Webhook 路由
  app.register(async function (app) {
    app.post('/api/webhook/langtum', langtumWebhook);
  });

  // ... 其他路由

  await app.listen({ port: 3001 });
}
```

---

## 🎨 前端集成

### 1. Langtum SDK 集成

```typescript
// apps/web/src/lib/langtum.ts

export interface LangtumClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class LangtumClient {
  private config: LangtumClientConfig;

  constructor(config: LangtumClientConfig) {
    this.config = config;
  }

  /**
   * 触发工作流执行
   */
  async triggerWorkflow(workflowName: string, input: any) {
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

    return await response.json(); // { executionId, status }
  }

  /**
   * 获取工作流执行进度
   */
  async getProgress(executionId: string) {
    const response = await fetch(
      `${this.config.baseUrl}/api/v1/executions/${executionId}`
    );

    return await response.json();
  }

  /**
   * 订阅工作流进度 (SSE)
   */
  subscribeProgress(executionId: string, onUpdate: (data: any) => void) {
    const eventSource = new EventSource(
      `${this.config.baseUrl}/api/v1/executions/${executionId}/stream`
    );

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onUpdate(data);
    };

    return eventSource;
  }
}
```

### 2. 触发工作流组件

```typescript
// apps/web/src/components/workflow-trigger.tsx

'use client';

import { useState } from 'react';
import { LangtumClient } from '@/lib/langtum';

export function WorkflowTrigger() {
  const [url, setUrl] = useState('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  const langtum = new LangtumClient({
    baseUrl: process.env.NEXT_PUBLIC_LANGTUM_URL!,
    apiKey: process.env.NEXT_PUBLIC_LANGTUM_API_KEY!,
  });

  const handleTrigger = async () => {
    setIsTriggering(true);
    try {
      const result = await langtum.triggerWorkflow('quick_assessment', {
        url,
      });
      setExecutionId(result.executionId);
    } catch (error) {
      console.error('Failed to trigger workflow:', error);
      alert('启动工作流失败');
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="space-y-4">
      {!executionId ? (
        <>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="w-full px-4 py-2 border rounded"
          />
          <button
            onClick={handleTrigger}
            disabled={isTriggering || !url}
            className="px-6 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {isTriggering ? '启动中...' : '开始评估'}
          </button>
        </>
      ) : (
        <WorkflowProgress executionId={executionId} />
      )}
    </div>
  );
}
```

### 3. 实时进度组件

```typescript
// apps/web/src/components/workflow-progress.tsx

'use client';

import { useEffect, useState } from 'react';
import { LangtumClient } from '@/lib/langtum';

interface WorkflowProgressProps {
  executionId: string;
  onComplete?: () => void;
}

export function WorkflowProgress({ executionId, onComplete }: WorkflowProgressProps) {
  const [progress, setProgress] = useState<any>(null);

  useEffect(() => {
    const langtum = new LangtumClient({
      baseUrl: process.env.NEXT_PUBLIC_LANGTUM_URL!,
      apiKey: process.env.NEXT_PUBLIC_LANGTUM_API_KEY!,
    });

    // 使用 SSE 订阅实时进度
    const eventSource = langtum.subscribeProgress(executionId, (data) => {
      setProgress(data);

      if (data.status === 'completed') {
        onComplete?.();
        eventSource.close();
      }
    });

    return () => {
      eventSource.close();
    };
  }, [executionId, onComplete]);

  if (!progress) {
    return <div>连接中...</div>;
  }

  const percentage = Math.round(
    (progress.completedSteps / progress.totalSteps) * 100
  );

  return (
    <div className="space-y-4">
      {/* 进度条 */}
      <div className="w-full bg-gray-200 rounded-full h-4">
        <div
          className="bg-blue-600 h-4 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* 状态文本 */}
      <div className="text-sm text-gray-600">
        {progress.currentNode} ({progress.completedSteps}/{progress.totalSteps})
      </div>

      {/* 完成后显示报告按钮 */}
      {progress.status === 'completed' && (
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

## 📊 数据库 Schema 扩展

```sql
-- 在 packages/db/src/schema/index.ts 中添加

/**
 * 用户关注仓库表
 */
export const userWatchedRepositories = pgTable('user_watched_repositories', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  repoFullName: text('repo_full_name').notNull(), // 'owner/repo'
  priority: integer('priority').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userRepoUnique: unique('user_repo_unique').on(table.userId, table.repoFullName),
}));

/**
 * 工作流报告表
 */
export const workflowReports = pgTable('workflow_reports', {
  id: serial('id').primaryKey(),
  executionId: text('execution_id').notNull().unique(),
  workflowName: text('workflow_name').notNull(),
  title: text('title'),
  content: text('content').notNull(), // Markdown
  format: text('format').default('markdown'), // 'markdown' | 'json' | 'html'
  metadata: jsonb('metadata'),
  status: text('status').default('completed'), // 'completed' | 'failed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowReport = typeof workflowReports.$inferSelect;
export type NewWorkflowReport = typeof workflowReports.$inferInsert;
```

---

## 🚀 实施步骤 (简化版)

### Step 1: 在 Langtum 创建工作流 (1天)

1. 登录 Langtum 平台
2. 创建项目文件夹 `DevScope`
3. 创建工作流 `daily_health_report`：
   - 添加各个节点
   - 配置 Webhook 调用
   - 设置 Cron 触发器
4. 创建工作流 `quick_assessment`：
   - 添加 6 个节点
   - 配置 Webhook 调用

### Step 2: 实现 Webhook API (1天)

```bash
# 创建 Webhook 处理文件
mkdir -p apps/api/src/webhook
touch apps/api/src/webhook/langtum.ts

# 安装依赖（如果需要）
pnpm add --filter @devscope/api @types/eventsource
```

实现 [langtumWebhook](apps/api/src/webhook/langtum.ts) 函数，处理所有 Action。

### Step 3: 前端集成 (1天)

```bash
# 创建 Langtum 客户端
touch apps/web/src/lib/langtum.ts

# 创建工作流组件
touch apps/web/src/components/workflow-trigger.tsx
touch apps/web/src/components/workflow-progress.tsx
```

### Step 4: 测试与调试 (0.5天)

1. 在 Langtum 平台手动触发工作流
2. 检查 Webhook 日志
3. 验证返回数据格式
4. 前端联调

---

## 🔐 环境变量配置

```bash
# .env.local

# Langtum 配置
NEXT_PUBLIC_LANGTUM_URL=https://your-langtum-instance.com
NEXT_PUBLIC_LANGTUM_API_KEY=your-langtum-api-key

# Webhook 密钥验证
LANGTUM_WEBHOOK_SECRET=your-webhook-secret
```

---

## 📝 Webhook 安全验证

```typescript
// 验证 Webhook 请求来源
export function verifyLangtumWebhook(request: FastifyRequest) {
  const signature = request.headers['x-langtum-signature'] as string;
  const secret = process.env.LANGTUM_WEBHOOK_SECRET;

  // 使用 HMAC 验证签名
  const expectedSignature = crypto
    .createHmac('sha256', secret!)
    .update(JSON.stringify(request.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    throw new Error('Invalid webhook signature');
  }
}
```

---

## ✅ 验收标准

- [ ] Langtum 中两个工作流可正常运行
- [ ] Webhook 接口正确响应所有 Action
- [ ] 前端能触发工作流并查看进度
- [ ] 工作流错误时有重试机制 (Langtum 内置)
- [ ] 报告正确保存到数据库

---

*文档生成时间: 2026-03-11*
