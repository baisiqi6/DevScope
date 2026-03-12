# Langtum 工作流配置指南

本文档详细描述如何在 Langtum 平台配置 DevScope 的两个核心工作流。

---

## 前置准备

### Step 1: 获取 API Key

1. 进入 Langtum 平台 **系统设置 → 开放平台**
2. 点击 **新增 API Key**
3. 配置权限：
   - **描述**: `DevScope Integration`
   - **权限来源用户**: 选择有工作流访问权限的用户
   - **限制功能模块权限**: 开启，选择 **工作流** 模块
4. 保存生成的 API Key，配置到 DevScope `.env`:
   ```bash
   LANGTUM_API_KEY=lt_xxxxxxxxxxxxx
   LANGTUM_BASE_URL=https://api.langtum.com
   ```

### Step 2: 创建知识库（可选）

为工作流添加领域知识支持：

1. 创建知识库 `DevScope-Domain-Knowledge`
2. 添加文档：
   - GitHub 项目健康度评估标准
   - 开源项目投资决策框架
   - 技术栈分类与趋势分析

---

## 工作流 1: 每日项目健康度报告

### 工作流信息

| 配置项 | 值 |
|--------|-----|
| **工作流名称** | `devscope-daily-health-report` |
| **触发方式** | API 调用 + Cron 定时 |
| **输入模式** | Start 节点接收 |
| **输出模式** | End 节点输出 |

### 节点配置

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Start: 接收触发参数                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Input Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "user_id": number,           // 用户 ID                        │   │
│  │   "watchlist": string[],       // 关注的仓库列表 ["vercel/next.js"] │ │
│  │   "report_date": string        // 报告日期 "2026-03-11" (可选)    │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LLM Node 1: 数据采集规划                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Model: Claude 3.5 Sonnet                                        │   │
│  │ System Prompt:                                                  │   │
│  │ "你是 DevScope 的数据采集专家。根据用户关注列表，规划需要采集的   │   │
│  │  GitHub 数据，包括：仓库基础信息、最近 30 天的 commits、issues、  │   │
│  │  PRs 统计、贡献者列表。"                                          │   │
│  │                                                                 │   │
│  │ 输出结构化的采集任务列表，每个任务包含仓库 owner/repo 和需要       │   │
│  │  采集的数据类型。"                                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  HTTP Request Node: 批量获取 GitHub 数据                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Method: POST                                                     │   │
│  │ URL: {{DEVSCOPE_API_URL}}/api/github/batch-fetch                │   │
│  │ Headers: { "Authorization": "Bearer {{DEVSCOPE_API_KEY}}" }      │   │
│  │ Body: 上一个节点的采集任务列表                                    │   │
│  │                                                                 │   │
│  │ 输出: 每个仓库的完整 GitHub 数据                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LLM Node 2: 批量健康度分析                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Model: Claude 3.5 Sonnet                                        │   │
│  │                                                                 │   │
│  │ 输入: GitHub 数据 + 分析模板                                      │   │
│  │                                                                 │   │
│  │ Output Schema (JSON Schema):                                     │   │
│  │ {                                                               │   │
│  │   "type": "object",                                             │   │
│  │   "properties": {                                               │   │
│  │     "analyses": {                                               │   │
│  │       "type": "array",                                          │   │
│  │       "items": {                                                │   │
│  │         "type": "object",                                       │   │
│  │         "properties": {                                         │   │
│  │           "repo": { "type": "string" },                         │   │
│  │           "health_score": { "type": "number", "minimum": 0, "maximum": 100 },    │
│  │           "activity_level": { "type": "string", "enum": ["high", "medium", "low", "dead"] }, │
│  │           "key_metrics": {                                      │   │
│  │             "type": "object",                                   │   │
│  │             "properties": {                                     │   │
│  │               "stars_growth": { "type": "number" },             │   │
│  │               "issue_resolution_rate": { "type": "number" },    │   │
│  │               "contributor_diversity": { "type": "number" }     │   │
│  │             }                                                   │   │
│  │           },                                                    │   │
│  │           "risk_factors": { "type": "array", "items": { "type": "string" } },     │
│  │           "opportunities": { "type": "array", "items": { "type": "string" } },    │   │
│  │           "recommendation": { "type": "string", "enum": ["invest", "watch", "avoid"] } │
│  │         },                                                      │   │
│  │         "required": ["repo", "health_score", "activity_level", "key_metrics", "recommendation"] │
│  │       }                                                         │   │
│  │     }                                                           │   │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  │                                                                 │   │
│  │ System Prompt:                                                  │   │
│  │ "你是 DevScope 的开源项目分析师。根据 GitHub 数据，评估项目健康度。│   │
│  │                                                                 │   │
│  │ 评分标准：                                                       │   │
│  │ - 健康度 85-100: 活跃且健康，值得关注                            │   │
│  │ - 健康度 70-84: 整体良好，存在小问题                             │   │
│  │ - 健康度 50-69: 需要关注，有下降风险                             │   │
│  │ - 健康度 <50: 高风险，建议谨慎                                   │   │
│  │                                                                 │   │
│  │ 必须严格按照 JSON Schema 输出。"                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LLM Node 3: 报告汇总与排序                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Model: Claude 3.5 Sonnet                                        │   │
│  │                                                                 │   │
│  │ 任务:                                                            │   │
│  │ 1. 按健康度降序排序                                               │   │
│  │ 2. 识别需要重点关注的项目（健康度下降 >10 分）                    │   │
│  │ 3. 生成执行摘要                                                   │   │
│  │                                                                 │   │
│  │ Output Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "type": "object",                                             │   │
│  │   "properties": {                                               │   │
│  │     "summary": { "type": "string" },                            │   │
│  │     "prioritized_repos": {                                      │   │
│  │       "type": "array",                                          │   │
│  │       "items": { "$ref": "#/definitions/repo_analysis" }       │   │
│  │     },                                                          │   │
│  │     "attention_required": {                                     │   │
│  │       "type": "array",                                          │   │
│  │       "items": {                                                │   │
│  │         "type": "object",                                       │   │
│  │         "properties": {                                         │   │
│  │           "repo": { "type": "string" },                         │   │
│  │           "reason": { "type": "string" },                       │   │
│  │           "previous_score": { "type": "number" },               │   │
│  │           "current_score": { "type": "number" }                 │   │
│  │         }                                                       │   │
│  │       }                                                         │   │
│  │     }                                                           │   │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  End: 输出报告                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Output Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "report_id": "string",        // UUID                          │   │
│  │   "user_id": "number",                                           │   │
│  │   "report_date": "string",                                        │   │
│  │   "total_repos": "number",                                        │   │
│  │   "summary": "string",                                           │   │
│  │   "analyses": [ /* repo analysis array */ ],                     │   │
│  │   "attention_required": [ /* alert array */ ],                    │   │
│  │   "generated_at": "string"        // ISO timestamp               │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cron 配置

在 Langtum 平台设置定时触发：
- **Cron 表达式**: `0 8 * * *` (每天 8:00)
- **时区**: Asia/Shanghai
- **默认输入**: 从数据库获取用户关注列表

---

## 工作流 2: 新项目快速评估

### 工作流信息

| 配置项 | 值 |
|--------|-----|
| **工作流名称** | `devscope-quick-assessment` |
| **触发方式** | API 调用（用户提交 GitHub URL） |
| **输入模式** | Start 节点接收 |
| **输出模式** | End 节点输出 |

### 节点配置

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Start: 接收评估请求                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Input Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "repo": string,              // "vercel/next.js"              │   │
│  │   "user_id": number,           // 用户 ID                        │   │
│  │   "assessment_depth": string   // "standard" | "deep" (可选)     │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Node 1: 信息采集                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Type: HTTP Request + LLM 组合                                    │   │
│  │                                                                 │   │
│  │ 1. HTTP Request: 调用 DevScope API 获取 GitHub 基础数据          │   │
│  │    URL: {{DEVSCOPE_API_URL}}/api/github/fetch                   │   │
│  │                                                                 │   │
│  │ 2. HTTP Request: 搜索 Hacker News 讨论                          │   │
│  │    URL: {{DEVSCOPE_API_URL}}/api/hackernews/search              │   │
│  │    Query: {{repo}}                                              │   │
│  │                                                                 │   │
│  │ 输出: 合并的数据包                                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Node 2: 代码质量分析                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Type: LLM (Claude 3.5 Sonnet)                                   │   │
│  │                                                                 │   │
│  │ System Prompt:                                                  │   │
│  │ "你是代码质量分析专家。评估以下维度：                             │   │
│  │                                                                 │   │
│  │ 1. 代码架构: 模块化程度、目录结构清晰度                          │   │
│  │ 2. 文档完整性: README、API 文档、贡献指南                        │   │
│  │ 3. 测试覆盖: 是否有测试目录、测试覆盖率                          │   │
│  │ 4. 依赖管理: 依赖版本、安全性更新                                │   │
│  │ 5. CI/CD: GitHub Actions、自动化测试                             │   │
│  │                                                                 │   │
│  │ 输出结构化的代码质量评分（0-100）和详细分析。"                     │   │
│  │                                                                 │   │
│  │ Output Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "type": "object",                                             │   │
│  │   "properties": {                                               │   │
│  │     "quality_score": { "type": "number", "minimum": 0, "maximum": 100 }, │
│  │     "architecture_rating": { "type": "string", "enum": ["excellent", "good", "fair", "poor"] }, │
│  │     "documentation_completeness": { "type": "number", "minimum": 0, "maximum": 100 }, │
│  │     "test_coverage_estimate": { "type": "number", "minimum": 0, "maximum": 100 }, │
│   │     "dependency_health": { "type": "string", "enum": ["healthy", "outdated", "vulnerable"] }, │
│  │     "ci_cd_presence": { "type": "boolean" },                     │   │
│  │     "findings": { "type": "array", "items": { "type": "string" } },      │
│  │     "recommendations": { "type": "array", "items": { "type": "string" } } │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Node 3: 社区活跃度分析                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Type: LLM (Claude 3.5 Sonnet)                                   │   │
│  │                                                                 │   │
│  │ 分析维度:                                                        │   │
│  │ - 提交频率和规律性                                               │   │
│  │ - Issue 和 PR 响应时间                                           │   │
│  │ - 贡献者多样性（公司 vs 个人）                                    │   │
│  │ - 社区讨论热度（Hacker News、Reddit）                             │   │
│  │                                                                 │   │
│  │ Output Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "type": "object",                                             │   │
│  │   "properties": {                                               │   │
│  │     "activity_level": { "type": "string", "enum": ["high", "medium", "low", "dormant"] }, │
│  │     "commit_frequency": { "type": "string", "enum": ["daily", "weekly", "monthly", "sporadic"] }, │
│  │     "avg_response_time_hours": { "type": "number" },            │   │
│  │     "contributor_count": { "type": "number" },                   │   │
│  │     "contributor_diversity": { "type": "string", "enum": ["high", "medium", "low"] }, │
│  │     "community_mentions": { "type": "number" },                  │   │
│  │     "trend": { "type": "string", "enum": ["growing", "stable", "declining"] } │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Node 4: 竞品分析                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Type: LLM + HTTP Request 组合                                    │   │
│  │                                                                 │   │
│  │ 1. 识别项目的主要技术栈和应用领域                                 │   │
│  │ 2. 搜索同类竞品（通过 GitHub API 或内置知识库）                   │   │
│  │ 3. 对比分析关键指标                                               │   │
│  │                                                                 │   │
│  │ Output Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "type": "object",                                             │   │
│  │   "properties": {                                               │   │
│  │     "technology_category": { "type": "string" },                │   │
│  │     "competitors": {                                            │   │
│  │       "type": "array",                                          │   │
│  │       "items": {                                                │   │
│  │         "type": "object",                                       │   │
│  │         "properties": {                                         │   │
│  │           "name": { "type": "string" },                         │   │
│  │           "repo": { "type": "string" },                         │   │
│  │           "stars": { "type": "number" },                        │   │
│  │           "relationship": { "type": "string", "enum": ["direct", "indirect", "alternative"] } │
│  │         }                                                       │   │
│  │       }                                                         │   │
│  │     },                                                          │   │
│  │     "market_position": { "type": "string", "enum": ["leader", "challenger", "niche", "emerging"] }, │
│  │     "competitive_advantages": { "type": "array", "items": { "type": "string" } }, │
│  │     "competitive_disadvantages": { "type": "array", "items": { "type": "string" } } │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Node 5: 风险评估                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Type: LLM (Claude 3.5 Sonnet)                                   │   │
│  │                                                                 │   │
│  │ 风险类别:                                                        │   │
│  │ - 技术风险: 依赖过时、安全问题、技术债务                          │   │
│  │ - 社区风险: 维护者流失、贡献者下降、issue 积压                    │   │
│  │ - 商业风险: 许可证、公司支持、竞争态势                            │   │
│  │ - 合规风险: 许可证兼容性、供应链安全                              │   │
│  │                                                                 │   │
│  │ Output Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "type": "object",                                             │   │
│  │   "properties": {                                               │   │
│  │     "overall_risk_level": { "type": "string", "enum": ["low", "medium", "high", "critical"] }, │
│  │     "risks": {                                                  │   │
│  │       "type": "array",                                          │   │
│  │       "items": {                                                │   │
│  │         "type": "object",                                       │   │
│  │         "properties": {                                         │   │
│  │           "category": { "type": "string", "enum": ["technical", "community", "business", "compliance"] }, │
│  │           "description": { "type": "string" },                   │   │
│  │           "severity": { "type": "string", "enum": ["low", "medium", "high", "critical"] }, │
│  │           "mitigation": { "type": "string" }                     │   │
│  │         },                                                      │   │
│  │         "required": ["category", "description", "severity"]      │   │
│  │       }                                                         │   │
│  │     },                                                          │   │
│  │     "risk_score": { "type": "number", "minimum": 0, "maximum": 100 } │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Node 6: 最终报告生成                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Type: LLM (Claude 3.5 Sonnet)                                   │   │
│  │                                                                 │   │
│  │ 任务: 汇总前面 5 个节点的分析结果，生成完整的评估报告             │   │
│  │                                                                 │   │
│  │ Output Schema:                                                   │   │
│  │ {                                                               │   │
│  │   "type": "object",                                             │   │
│  │   "properties": {                                               │   │
│  │     "assessment_id": { "type": "string" },                      │   │
│  │     "repo": { "type": "string" },                               │   │
│  │     "overall_score": { "type": "number", "minimum": 0, "maximum": 100 }, │
│  │     "recommendation": { "type": "string", "enum": ["highly_recommended", "recommended", "caution", "not_recommended"] }, │
│  │     "executive_summary": { "type": "string" },                  │   │
│  │     "code_quality": { "$ref": "#/definitions/code_quality" },   │   │
│  │     "community_health": { "$ref": "#/definitions/community" },  │   │
│  │     "competitive_analysis": { "$ref": "#/definitions/competitive" }, │
│  │     "risk_assessment": { "$ref": "#/definitions/risk" },        │   │
│  │     "key_highlights": { "type": "array", "items": { "type": "string" } }, │
│  │     "key_concerns": { "type": "array", "items": { "type": "string" } }, │
│  │     "next_steps": { "type": "array", "items": { "type": "string" } }, │
│  │     "assessed_at": { "type": "string" }                         │   │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  End: 输出评估报告                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Webhook 配置

### 配置 Webhook 接收地址

在 Langtum 平台配置 Webhook 回调：

| 配置项 | 值 |
|--------|-----|
| **Webhook URL** | `{{DEVSCOPE_API_URL}}/api/webhook/langtum` |
| **事件类型** | `workflow.completed`, `workflow.failed`, `workflow.progress` |
| **签名验证** | HMAC-SHA256（使用 API Secret） |

### Webhook 请求格式

```typescript
// workflow.completed 事件
{
  "event": "workflow.completed",
  "workflow_id": "devscope-quick-assessment",
  "execution_id": "exec_xxxxxxxxxxxxx",
  "status": "success",
  "result": {
    // End 节点输出的完整数据
  },
  "started_at": "2026-03-11T08:00:00Z",
  "completed_at": "2026-03-11T08:05:23Z",
  "duration_ms": 323000
}

// workflow.progress 事件（可选，用于实时进度）
{
  "event": "workflow.progress",
  "workflow_id": "devscope-quick-assessment",
  "execution_id": "exec_xxxxxxxxxxxxx",
  "current_node": "Node 3: 社区活跃度分析",
  "progress_percent": 50,
  "node_output": { /* 当前节点输出 */ }
}
```

---

## DevScope 环境变量配置

在 `.env` 文件中添加：

```bash
# Langtum 配置
LANGTUM_API_KEY=lt_xxxxxxxxxxxxx
LANGTUM_API_SECRET=secret_xxxxxxxxxxxxx
LANGTUM_BASE_URL=https://api.langtum.com
LANGTUM_WORKFLOW_DAILY=devscope-daily-health-report
LANGTUM_WORKFLOW_QUICK=devscope-quick-assessment

# Webhook 配置
WEBHOOK_SECRET=your_webhook_signature_secret
WEBHOOK_PATH=/api/webhook/langtum
```

---

## 工作流配置检查清单

### 工作流 1: 每日健康度报告

- [ ] 在 Langtum 创建工作流 `devscope-daily-health-report`
- [ ] 配置 Start 节点输入 Schema
- [ ] 配置 LLM 节点（数据采集规划、批量分析、报告汇总）
- [ ] 配置 HTTP Request 节点（调用 DevScope API）
- [ ] 配置 End 节点输出 Schema
- [ ] 设置 Cron 定时触发（每天 8:00）
- [ ] 配置 Webhook 回调
- [ ] 测试运行

### 工作流 2: 快速评估

- [ ] 在 Langtum 创建工作流 `devscope-quick-assessment`
- [ ] 配置 Start 节点输入 Schema
- [ ] 配置 6 个分析节点
- [ ] 为每个 LLM 节点配置 JSON Schema
- [ ] 配置 End 节点输出 Schema
- [ ] 配置 Webhook 回调
- [ ] 测试运行

---

## 测试步骤

### 1. 手动触发测试

```bash
# 测试每日报告
curl -X POST {{LANGTUM_BASE_URL}}/api/v1/workflows/devscope-daily-health-report/trigger \
  -H "Authorization: Bearer {{LANGTUM_API_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "watchlist": ["vercel/next.js", "facebook/react", "vuejs/core"]
  }'

# 测试快速评估
curl -X POST {{LANGTUM_BASE_URL}}/api/v1/workflows/devscope-quick-assessment/trigger \
  -H "Authorization: Bearer {{LANGTUM_API_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "vercel/next.js",
    "user_id": 1,
    "assessment_depth": "standard"
  }'
```

### 2. 验证 Webhook 接收

```bash
# 查看 DevScope 日志
pnpm --filter @devscope/api dev

# 应该看到 webhook 请求日志
```

### 3. 查询执行状态

```bash
curl -X GET {{LANGTUM_BASE_URL}}/api/v1/workflows/executions/exec_xxxxxxxxxxxxx \
  -H "Authorization: Bearer {{LANGTUM_API_KEY}}"
```

---

## 故障排查

### 问题: 工作流触发失败

1. 检查 API Key 权限是否包含工作流模块
2. 验证工作流名称是否正确
3. 查看输入数据是否符合 Schema

### 问题: Webhook 未接收

1. 确认 DevScope API 地址可从外网访问
2. 检查防火墙规则
3. 验证 Webhook URL 配置

### 问题: JSON Schema 验证失败

1. 确认 Schema 格式符合 Draft 7 规范
2. 检查必需字段和类型约束
3. 查看 Langtum 平台错误日志

---

*本文档随 Langtum 平台 API 更新而更新*
