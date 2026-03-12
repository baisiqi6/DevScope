# Langtum 工作流集成实现摘要

本文档汇总 DevScope 与 Langtum 工作流平台集成的实现状态。

---

## 实现状态

| 任务 | 状态 | 文件 |
|------|------|------|
| Langtum 工作流配置指南 | ✅ 已完成 | [LANGTUM_WORKFLOW_CONFIG.md](./LANGTUM_WORKFLOW_CONFIG.md) |
| Langtum API 客户端 | ✅ 已完成 | `packages/ai/src/langtum.ts` |
| 工作流 tRPC 路由 | ✅ 已完成 | `apps/api/src/router/workflow.ts` |
| Webhook 处理器 | ✅ 已完成 | `apps/api/src/webhook/langtum.ts` |
| 数据库 Schema 扩展 | ✅ 已完成 | `packages/db/src/schema/index.ts` |
| 前端工作流组件 | ⏳ 待实现 | - |

---

## 文件清单

### 新增文件

```
doc/Dev1/
├── LANGTUM_WORKFLOW_CONFIG.md          # 工作流配置指南
├── LANGTUM_INTEGRATION_V2.md           # 集成架构设计
├── LANGTUM_INTEGRATION_SUMMARY.md      # 本文件

packages/ai/src/
└── langtum.ts                          # Langtum API 客户端

apps/api/src/
├── router/
│   └── workflow.ts                     # 工作流 tRPC 路由
└── webhook/
    └── langtum.ts                      # Webhook 处理器
```

### 修改文件

```
packages/ai/
├── src/index.ts                        # 添加 langtum 导出
├── package.json                        # 添加 langtum 入口
└── tsup.config.ts                      # 添加 langtum 构建入口

packages/db/src/
└── schema/index.ts                     # 添加工作流相关表

apps/api/src/
├── index.ts                            # 注册 Webhook 路由
└── router.ts                           # 集成工作流路由器
```

---

## 环境变量配置

在 `.env` 文件中添加以下配置：

```bash
# Langtum 平台配置
LANGTUM_API_KEY=lt_xxxxxxxxxxxxx
LANGTUM_API_SECRET=secret_xxxxxxxxxxxxx
LANGTUM_BASE_URL=https://api.langtum.com

# 工作流名称（与 Langtum 平台配置一致）
LANGTUM_WORKFLOW_DAILY=devscope-daily-health-report
LANGTUM_WORKFLOW_QUICK=devscope-quick-assessment

# Webhook 配置
WEBHOOK_SECRET=your_webhook_signature_secret
```

---

## tRPC API 接口

### 触发每日健康度报告

```typescript
// 调用方式
await apiClient.workflow.triggerDailyReport.mutate({
  user_id: 1,
  watchlist: ["vercel/next.js", "facebook/react"],
  report_date: "2026-03-11", // 可选
});

// 返回
{
  execution_id: string,
  workflow_id: string,
  status: "pending" | "running",
  message: string
}
```

### 触发快速评估

```typescript
// 调用方式
await apiClient.workflow.triggerQuickAssessment.mutate({
  repo: "vercel/next.js",
  user_id: 1,
  assessment_depth: "standard", // 可选: "standard" | "deep"
});

// 返回
{
  execution_id: string,
  workflow_id: string,
  status: "pending" | "running",
  message: string
}
```

### 查询执行状态

```typescript
// 调用方式
await apiClient.workflow.getExecutionStatus.query({
  execution_id: "exec_xxxxxxxxxxxxx"
});

// 返回
{
  execution_id: string,
  workflow_id: string,
  status: "pending" | "running" | "completed" | "failed" | "cancelled",
  started_at: string,
  current_node?: string,
  progress_percent?: number,
  result?: unknown,
  error?: string,
  completed_at?: string,
  duration_ms?: number
}
```

### 获取报告列表

```typescript
// 每日报告列表
await apiClient.workflow.listDailyReports.query({
  user_id: 1,
  limit: 10,
  offset: 0
});

// 快速评估列表
await apiClient.workflow.listQuickAssessments.query({
  user_id: 1,
  repo: "vercel/next.js", // 可选：过滤特定仓库
  limit: 10,
  offset: 0
});
```

---

## Webhook 端点

### 接收地址

```
POST /api/webhook/langtum
```

### 请求头

```http
x-langtum-signature: sha256=...
x-langtum-timestamp: 1234567890
x-langtum-event: workflow.completed
content-type: application/json
```

### 事件类型

| 事件 | 描述 |
|------|------|
| `workflow.started` | 工作流开始执行 |
| `workflow.progress` | 执行进度更新 |
| `workflow.completed` | 执行成功完成 |
| `workflow.failed` | 执行失败 |

---

## 数据库表结构

### workflow_executions

记录每次工作流的执行状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial | 主键 |
| executionId | text | Langtum 执行 ID（唯一） |
| userId | serial | 用户 ID |
| workflowId | text | 工作流标识 |
| workflowType | text | 类型：daily_health_report / quick_assessment |
| status | enum | pending / running / completed / failed / cancelled |
| input | jsonb | 输入参数 |
| result | jsonb | 执行结果 |
| error | text | 错误信息 |
| progressPercent | integer | 进度百分比 0-100 |
| currentNode | text | 当前节点 |
| startedAt | timestamp | 开始时间 |
| completedAt | timestamp | 完成时间 |
| durationMs | integer | 执行时长（毫秒） |

### workflow_reports

存储工作流生成的结构化报告。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial | 主键 |
| reportId | text | 报告 ID（UUID，对外暴露） |
| executionId | text | 关联执行 ID |
| userId | serial | 用户 ID |
| reportType | enum | daily_health_report / quick_assessment |
| reportData | jsonb | 完整报告内容 |
| summary | text | 报告摘要 |
| reportDate | text | 报告日期（每日报告） |
| repoFullName | text | 仓库全名（快速评估） |
| isRead | boolean | 是否已读 |
| isArchived | boolean | 是否已归档 |

### user_watched_repositories

用户关注的仓库列表。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial | 主键 |
| userId | serial | 用户 ID |
| repoId | serial | 仓库 ID |
| repoFullName | text | 仓库全名 |
| enableDailyReport | boolean | 是否启用每日报告 |
| priority | integer | 优先级（排序用） |
| notes | text | 备注 |

---

## 部署步骤

### 1. 数据库迁移

```bash
# 生成迁移文件
pnpm db:generate

# 推送 Schema 到数据库
pnpm db:push
```

### 2. 构建包

```bash
# 构建所有包
pnpm build

# 或单独构建
pnpm --filter @devscope/ai build
pnpm --filter @devscope/api build
```

### 3. 配置环境变量

复制 `.env.example` 到 `.env` 并填入 Langtum 配置。

### 4. 配置 Langtum 平台

参考 [LANGTUM_WORKFLOW_CONFIG.md](./LANGTUM_WORKFLOW_CONFIG.md) 完成以下配置：

1. 在 Langtum 创建 API Key
2. 创建工作流 `devscope-daily-health-report`
3. 创建工作流 `devscope-quick-assessment`
4. 配置 Webhook 回调地址
5. 设置 Cron 定时触发（可选）

### 5. 启动服务

```bash
pnpm dev
```

---

## 测试

### 测试 API 调用

```bash
# 测试触发每日报告
curl -X POST http://localhost:3001/trpc/workflow.triggerDailyReport \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "watchlist": ["vercel/next.js"],
    "report_date": "2026-03-11"
  }'

# 测试触发快速评估
curl -X POST http://localhost:3001/trpc/workflow.triggerQuickAssessment \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "vercel/next.js",
    "user_id": 1
  }'

# 测试查询状态
curl http://localhost:3001/trpc/workflow.getExecutionStatus?input=\
'{"execution_id":"exec_xxxxxxxxxxxxx"}'
```

### 测试 Webhook

```bash
# Webhook 健康检查
curl http://localhost:3001/api/webhook/langtum/health

# 应返回
# {"status":"ok","service":"langtum-webhook"}
```

---

## 后续工作

### 前端组件（待实现）

1. **工作流触发组件**
   - 每日报告配置界面
   - 快速评估提交表单

2. **执行状态展示**
   - 实时进度条
   - 节点状态显示

3. **报告展示页面**
   - 每日报告列表
   - 快速评估详情
   - 报告数据可视化

4. **关注列表管理**
   - 添加/删除关注仓库
   - 设置每日报告开关
   - 优先级排序

### 数据库查询逻辑（待实现）

在 `apps/api/src/router/workflow.ts` 和 `apps/api/src/webhook/langtum.ts` 中标记为 `TODO` 的部分：

1. 保存执行记录到数据库
2. 更新执行状态和进度
3. 查询报告列表
4. 获取报告详情

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              DevScope 系统                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐         ┌─────────────────────────────────────┐  │
│  │  前端 (Next.js) │         │  后端 API (Fastify + tRPC)          │  │
│  │                 │────────▶│                                     │  │
│  │  - 工作流触发   │         │  - workflowRouter                   │  │
│  │  - 状态展示     │         │  - Webhook Handler                  │  │
│  │  - 报告展示     │         │  - Database (Drizzle)               │  │
│  └─────────────────┘         └─────────────────────────────────────┘  │
│                                        │                                │
│                                        ▼                                │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │              packages/ai (Langtum Client)                       │  │
│  │                                                                 │  │
│  │  - triggerDailyReport()                                        │  │
│  │  - triggerQuickAssessment()                                     │  │
│  │  - getExecutionDetail()                                        │  │
│  │  - verifyWebhookSignature()                                    │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Langtum 工作流平台                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐    ┌─────────────────────────────────────┐   │
│  │  每日健康度报告       │    │  快速评估                          │   │
│  │  (devscope-daily-    │    │  (devscope-quick-                  │   │
│  │   health-report)     │    │   assessment)                      │   │
│  │                     │    │                                     │   │
│  │  Start → 数据采集    │    │  Start → 信息采集 → 代码质量        │   │
│  │       → 批量分析     │    │         → 社区活跃 → 竞品分析        │   │
│  │       → 报告汇总     │    │         → 风险评估 → 最终报告        │   │
│  │       → End         │    │         → End                      │   │
│  └─────────────────────┘    └─────────────────────────────────────┘   │
│                                                                         │
│                              │                                          │
│                              ▼                                          │
│                    ┌─────────────────┐                                │
│                    │  Webhook 回调    │                                │
│                    │  (workflow.xxx)  │                                │
│                    └─────────────────┘                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 故障排查

### 工作流触发失败

1. 检查 `LANGTUM_API_KEY` 是否正确
2. 验证工作流名称与 Langtum 平台一致
3. 查看 API 服务日志

### Webhook 未接收

1. 确认 DevScope API 地址可从外网访问
2. 检查 Webhook URL 配置
3. 验证签名密钥正确

### 数据库错误

1. 确认已运行数据库迁移
2. 检查数据库连接字符串
3. 查看 PostgreSQL 日志

---

## 相关文档

- [LANGTUM_WORKFLOW_CONFIG.md](./LANGTUM_WORKFLOW_CONFIG.md) - 工作流配置指南
- [LANGTUM_INTEGRATION_V2.md](./LANGTUM_INTEGRATION_V2.md) - 集成架构设计
- [项目要求.md](./项目要求.md) - 项目需求文档
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构文档

---

*最后更新：2026-03-11*
