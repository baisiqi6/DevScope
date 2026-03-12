# 架构设计文档

## 系统架构

DevScope 采用典型的 Monorepo 前后端分离架构，并配备独立的 CLI Skills 系统：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              用户/开发者                                   │
└─────────────────────────────────────────────────────────────────────────┘
          │                                    │
          ▼                                    ▼
┌──────────────────────┐          ┌──────────────────────────────────┐
│  CLI Skills 层       │          │  Web 应用层                      │
│  ┌────────────────┐  │          │  ┌─────────────────────────────┐ │
│  │  repo-fetch    │  │          │  │  apps/web (Next.js 15)      │ │
│  │  (GitHub API)  │──┼──┐       │  │  ┌─────────────┐            │ │
│  └────────────────┘  │  │       │  │  │ App Router  │            │ │
│  ┌────────────────┐  │  │       │  │  └─────────────┘            │ │
│  │  repo-analyze  │  │  │       │  │  ┌──────────────┐           │ │
│  │  (AI 分析)     │◄─┼──┼───┐   │  │  │  shadcn/ui   │           │ │
│  └────────────────┘  │  │   │   │  │  └──────────────┘           │ │
│  ┌────────────────┐  │  │   │   │  │  ┌─────────────────────┐    │ │
│  │ report-generate│  │  │   │   │  │  │    React Query      │    │ │
│  │ (报告生成)     │  │  │   │   │  │  └─────────────────────┘    │ │
│  └────────────────┘  │  │   │   │  └─────────────────────────────┘ │
└──────────────────────┘  │   │   └──────────────────────────────────┘
         │                 │   │                │
         │                 │   │         │ tRPC (类型安全 RPC) │
         │                 │   │                ▼
         │                 │   │   ┌──────────────────────────────────┐
         │                 │   │   │  apps/api (Fastify)              │
         │                 │   │   │  ┌─────────────┐  ┌──────────────┐│
         │                 │   │   │  │  tRPC Router│  │  中间件      ││
         │                 │   │   │  │  (API 路由) │  │  (CORS 等)   ││
         │                 │   │   │  └─────────────┘  └──────────────┘│
         │                 │   │   └──────────────────────────────────┘
         │                 │   │                │
         ▼                 ▼   ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  packages/ai                        packages/db                     │
│  ┌────────────────┐                 ┌────────────────────┐          │
│  │ AIProvider     │                 │ Drizzle ORM        │          │
│  │ (Claude Tool   │                 │ (数据库操作)        │          │
│  │  Use API)      │                 │ + pgvector         │          │
│  └────────────────┘                 └────────────────────┘          │
│                                                                  │
│  packages/shared                                                 │
│  ┌────────────────┐                                             │
│  │ Zod Schemas    │  ◄────── 类型定义 ──────┐                   │
│  │ TS Types       │                         │                   │
│  └────────────────┘                         │                   │
└─────────────────────────────────────────────┼───────────────────┘
                                              │
                                              ▼
                                ┌──────────────────────────┐
                                │  PostgreSQL + pgvector   │
                                │  (向量数据库，可选)       │
                                └──────────────────────────┘
```

## 包依赖关系

```
apps/web
  └── @devscope/shared

apps/api
  ├── @devscope/db
  ├── @devscope/ai
  └── @devscope/shared

packages/db
  └── @devscope/shared

packages/ai
  └── @devscope/shared

packages/shared
  (基础包，无内部依赖)

skills/repo-fetch
  └── @devscope/shared

skills/repo-analyze
  ├── @devscope/ai
  └── @devscope/shared

skills/report-generate
  └── @devscope/shared
```

## 目录职责

### apps/web - 前端应用

- **src/app/** - Next.js App Router 页面
- **src/components/** - React 组件
  - **ui/** - shadcn/ui 基础组件
  - **features/** - 业务功能组件
- **src/lib/** - 工具函数和客户端配置

### apps/api - 后端 API

- **src/index.ts** - Fastify 服务器入口
- **src/router.ts** - tRPC 路由定义
- **src/trpc.ts** - tRPC 配置和处理器
- **src/context.ts** - 请求上下文创建

### packages/db - 数据库层

- **src/schema/** - Drizzle 数据模型定义
- **src/index.ts** - 数据库连接和导出

### packages/ai - AI 服务

- **src/index.ts** - Anthropic SDK 封装，提供统一的 AI 接口
  - `complete()` - 基础文本生成
  - `structuredComplete()` - 结构化输出（Tool Use）

### packages/shared - 共享类型

- **src/index.ts** - Zod schema 和 TypeScript 类型定义
  - `repositoryAnalysisSchema` - 仓库分析结果结构
  - `activityLevelSchema` - 活跃度枚举
  - `recommendationLevelSchema` - 推荐级别枚举

### skills/ - CLI Skills 系统

#### skills/repo-fetch - GitHub 数据获取

- 调用 GitHub REST API 获取仓库信息
- 支持批量获取和管道输入
- 可配置获取 Issues、Commits 等详细数据

#### skills/repo-analyze - AI 仓库分析

- 使用 `@devscope/ai` 进行结构化分析
- 输出符合 Zod Schema 的分析结果
- 支持单个或批量分析

#### skills/report-generate - 报告生成

- 汇总分析结果
- 生成 Markdown/JSON/HTML 格式报告
- 支持多种报告类型（summary/detailed/comparison）

## 数据流

### 1. CLI Skills 管道流程

```
echo "vercel/next.js"
    │
    ▼
repo-fetch → 获取 GitHub 数据 (JSON)
    │
    ▼
repo-analyze → AI 分析 (结构化输出)
    │
    ▼
report-generate → 生成报告 (Markdown)
```

### 2. Web/API 流程

```
用户 → Web UI → React Query → tRPC Client
                                    │
                                    ▼
                            tRPC Server (Fastify)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              packages/ai    packages/db    外部 API (GitHub)
            (AI 调用)        (数据库)        (通过 repo-fetch)
```

## 类型安全

整个项目通过以下方式实现端到端类型安全：

1. **TypeScript** - 所有代码使用 TypeScript 编写
2. **Zod** - 运行时类型验证
3. **tRPC** - 前后端类型自动同步
4. **Drizzle** - 数据库类型推断

## AI 结构化输出

使用 Claude 的 Tool Use API 实现强制结构化输出：

```
┌─────────────────────────────────────────────────────────────┐
│  1. 定义 Zod Schema                                          │
│     ┌─────────────────────────────────────────────────────┐  │
│     │ repositoryAnalysisSchema = z.object({               │  │
│     │   healthScore: z.number().min(0).max(100),          │  │
│     │   activityLevel: z.enum(["high", "medium", ...]),   │  │
│     │   ...                                               │  │
│     │ })                                                  │  │
│     └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Zod Schema → JSON Schema                                 │
│     自动转换并发送给 Claude API                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Claude 返回符合 Schema 的数据                             │
│     {                                                        │
│       "healthScore": 85,                                     │
│       "activityLevel": "high",                               │
│       ...                                                    │
│     }                                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Zod 验证返回数据                                          │
│     确保类型和约束正确                                        │
└─────────────────────────────────────────────────────────────┘
```

## 向量搜索设计（规划中）

使用 PostgreSQL + pgvector 实现语义搜索：

1. 文档内容通过 AI 生成 embedding
2. 存储在 pgvector 列中（1536 维）
3. 使用 HNSW 索引加速查询
4. 余弦相似度进行搜索

```
CREATE INDEX ON repo_embeddings
USING hnsw (embedding vector_cosine_ops);
```

## 开发规范

### 代码风格

- 使用 Prettier 进行代码格式化
- 遵循 ESLint 规则
- 使用 `pnpm lint` 检查代码

### 提交规范

建议使用 Conventional Commits：

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试
chore: 构建/工具
```

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件 | kebab-case | `repo-analyze.ts` |
| 组件 | PascalCase | `HealthScoreChart` |
| 函数/变量 | camelCase | `analyzeRepository` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 类型 | PascalCase + 后缀 | `AnalysisResult` |
| Zod Schema | camelCase + Schema | `repositoryAnalysisSchema` |
