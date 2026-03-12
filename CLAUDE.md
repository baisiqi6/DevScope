# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 📋 项目概述

**DevScope** 是一个面向技术投资人和独立开发者的开源生态智能分析平台，通过 AI 实时掌握 GitHub 项目健康度、技术趋势和竞争格局。

### 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│                        DevScope 架构                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │   Next.js   │────▶│   tRPC API  │────▶│  Anthropic  │   │
│  │   :3000     │     │    :3001    │     │   Claude    │   │
│  └─────────────┘     └──────┬──────┘     └─────────────┘   │
│                              │                               │
│                              ▼                               │
│                       ┌─────────────┐                       │
│                       │ PostgreSQL  │                       │
│                       │ + pgvector  │                       │
│                       └─────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 类别 | 技术 |
|------|------|
| **前端** | Next.js 15, Tailwind CSS, shadcn/ui |
| **后端** | Fastify, tRPC, Drizzle ORM |
| **数据库** | PostgreSQL 15+, pgvector |
| **AI** | Anthropic Claude SDK (Tool Use API) |
| **验证** | Zod |
| **包管理** | pnpm + Turborepo |
| **测试** | Vitest |

### 规划中的功能

- [ ] **RAG 检索增强**：文本分块 + 向量嵌入 + 语义搜索
- [ ] **CLI Skills**：独立的命令行工具集
- [ ] **Workflow 编排**：复杂分析流程的自动化
- [ ] **Agent SDK**：自主深度研究能力
- [ ] **监控系统**：指标埋点 + Agent 执行日志

---

## 🚀 快速开始

### 环境要求

```bash
Node.js 18+
pnpm 8+
PostgreSQL 15+ (或 Docker)
```

### 安装步骤

```bash
# 克隆项目
git clone <repository-url>
cd devscope

# 安装依赖
pnpm install

# 复制环境变量
cp .env.example .env

# 启动数据库（Docker）
docker-compose up -d postgres

# 运行数据库迁移
pnpm db:push

# 启动开发服务器
pnpm dev
```

### 环境变量配置

```bash
# .env 文件配置
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/devscope
ANTHROPIC_API_KEY=sk-ant-xxx
PORT=3001  # API 端口
```

---

## 📁 项目结构

```
devscope/
├── apps/                          # 可部署应用
│   ├── web/                       # Next.js 前端 (:3000)
│   │   ├── app/                   # App Router 页面
│   │   ├── components/            # React 组件
│   │   │   └── ui/                # shadcn/ui 组件
│   │   └── lib/                   # 工具函数
│   │
│   └── api/                       # Fastify 后端 (:3001)
│       ├── src/
│       │   ├── index.ts           # 服务器入口
│       │   ├── router.ts          # tRPC 路由定义
│       │   ├── trpc.ts            # tRPC 配置
│       │   └── context.ts         # 请求上下文
│       └── vitest.config.ts       # 测试配置
│
├── packages/                      # 共享包
│   ├── db/                        # 数据库层
│   │   ├── src/
│   │   │   ├── schema/            # Drizzle 表定义
│   │   │   │   └── index.ts       # users, documents + pgvector
│   │   │   └── index.ts           # createDb() 工厂函数
│   │   ├── drizzle.config.ts      # Drizzle 配置
│   │   └── tsup.config.ts         # 构建配置
│   │
│   ├── ai/                        # AI 能力封装
│   │   ├── src/
│   │   │   └── index.ts           # AIProvider + structuredComplete
│   │   ├── vitest.config.ts       # 测试配置
│   │   └── tsup.config.ts
│   │
│   └── shared/                    # 共享类型
│       ├── src/
│       │   └── index.ts           # Zod Schemas + TypeScript 类型
│       └── tsup.config.ts
│
├── docker-compose.yml             # Docker 服务配置
├── turbo.json                     # Turborepo 配置
├── pnpm-workspace.yaml            # pnpm 工作区配置
├── package.json
├── tsconfig.json                  # 根 TypeScript 配置
└── CLAUDE.md                      # 本文件
```

---

## 💻 常用命令

### 开发

```bash
# 启动所有服务
pnpm dev

# 启动特定服务
pnpm --filter @devscope/web dev     # 前端 :3000
pnpm --filter @devscope/api dev     # 后端 :3001

# 类型检查
pnpm lint
```

### 构建

```bash
# 构建所有包
pnpm build

# 构建特定包
pnpm --filter @devscope/shared build
pnpm --filter @devscope/ai build
pnpm --filter @devscope/db build
pnpm --filter @devscope/api build
pnpm --filter @devscope/web build
```

### 数据库

```bash
# 生成迁移文件
pnpm db:generate

# 推送 schema 到数据库（开发环境）
pnpm db:push

# 打开 Drizzle Studio
pnpm db:studio
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
pnpm --filter @devscope/ai test
pnpm --filter @devscope/api test

# 测试 UI 界面
pnpm --filter @devscope/ai test:ui

# 测试覆盖率
pnpm --filter @devscope/ai test:coverage
```

### Docker

```bash
# 启动数据库
docker-compose up -d postgres

# 查看日志
docker-compose logs -f postgres

# 停止服务
docker-compose down

# 重建服务
docker-compose up -d --build postgres
```

---

## 🏗️ 架构设计

### Monorepo 包依赖关系

```
apps/web → @devscope/shared
apps/api → @devscope/db, @devscope/ai, @devscope/shared
packages/db → @devscope/shared
packages/ai → (无内部依赖)
packages/shared → (无依赖)
```

### 添加新功能的指导

| 需求 | 位置 |
|------|------|
| UI 组件 | `apps/web/src/components/` |
| API 路由 | `apps/api/src/router.ts` |
| 数据表模型 | `packages/db/src/schema/index.ts` |
| 共享类型 | `packages/shared/src/index.ts` |
| AI 操作 | `packages/ai/src/index.ts` |

---

## 🧠 AI 开发规范

### API 调用规范

**使用结构化输出（Tool Use）**：

```typescript
// ✅ 正确示例 - 使用 structuredComplete
import { z } from "zod";

const schema = z.object({
  healthScore: z.number().min(0).max(100),
  activityLevel: z.enum(["high", "medium", "low", "dead"]),
  recommendation: z.enum(["invest", "watch", "avoid"]),
});

const result = await ai.structuredComplete(prompt, {
  schema,
  toolName: "repository_analysis",
  system: "你是一个专业的开源项目分析师...",
  temperature: 0.3,
});

// 结果自动验证类型
console.log(result.healthScore); // number
console.log(result.activityLevel); // "high" | "medium" | "low" | "dead"
```

```typescript
// ❌ 错误示例 - 不验证返回类型
const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  messages: [{ role: 'user', content: prompt }],
  // 没有使用 Tool Use，返回文本需要手动解析
});
```

### Schema 定义规范

```typescript
// packages/shared/src/index.ts

export const repositoryAnalysisSchema = z.object({
  // 使用 .min()/.max() 添加数值约束
  healthScore: z.number().min(0).max(100),

  // 使用 enum 限制选项
  activityLevel: z.enum(["high", "medium", "low", "dead"]),

  // 嵌套对象
  keyMetrics: z.object({
    starsGrowthRate: z.number(),
    issueResolutionRate: z.number().min(0).max(100),
    contributorDiversityScore: z.number().min(0).max(100),
  }),

  // 数组类型
  riskFactors: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      severity: z.number().min(1).max(10),
    })
  ),

  // 可选字段
  notes: z.string().optional(),
});

// 导出 TypeScript 类型
export type RepositoryAnalysis = z.infer<typeof repositoryAnalysisSchema>;
```

---

## 🗄️ 数据库开发

### Schema 定义

```typescript
// packages/db/src/schema/index.ts

import { pgTable, serial, text, timestamp, vector } from "drizzle-orm/pg-core";

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: serial("user_id")
    .references(() => users.id)
    .notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  // pgvector 支持 - 1536 维向量（OpenAI embedding 维度）
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 类型推断
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
```

### 修改数据库 Schema

1. 编辑 `packages/db/src/schema/index.ts`
2. 运行 `pnpm db:generate` 生成迁移
3. 运行 `pnpm db:push` 应用到数据库

---

## 🔌 API 开发 (tRPC)

### 定义路由

```typescript
// apps/api/src/router.ts

import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { ai } from "@devscope/ai";
import { repositoryAnalysisSchema } from "@devscope/shared";

export const appRouter = router({
  // 健康检查
  health: publicProcedure.query(() => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  })),

  // 问候接口
  greet: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(({ input }) => ({
      message: `Hello, ${input.name}!`,
    })),

  // 仓库分析（使用 AI）
  analyzeRepository: publicProcedure
    .input(z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      context: z.string().optional(),
    }))
    .output(repositoryAnalysisSchema)
    .mutation(async ({ input }) => {
      const prompt = buildAnalysisPrompt(input.owner, input.repo, input.context);

      return await ai.structuredComplete(prompt, {
        schema: repositoryAnalysisSchema,
        toolName: "repository_analysis",
        system: "你是专业的开源项目分析师...",
        temperature: 0.3,
      });
    }),
});

// 导出类型给前端使用
export type AppRouter = typeof appRouter;
```

### tRPC 配置文件

```typescript
// apps/api/src/trpc.ts

import { initTRPC } from "@trpc/server";
import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure;
export const router = t.router;
```

```typescript
// apps/api/src/context.ts

import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  return {};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

---

## 🧪 测试规范

### 测试配置

项目使用 **Vitest** 进行单元测试，配置文件位于各包的 `vitest.config.ts`。

### Mock AI 服务

```typescript
// packages/ai/src/index.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// 创建共享的 mock 函数
const mockCreate = vi.fn();

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

describe("AIProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应该成功调用 Claude API", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello!" }],
    });

    const result = await ai.complete("Say hello");
    expect(result).toBe("Hello!");
  });
});
```

### Mock 数据库

```typescript
// apps/api/src/router.test.ts

vi.mock("@devscope/db", () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(),
    insert: vi.fn(),
  })),
}));
```

---

## 📝 代码规范

### TypeScript 配置

根 `tsconfig.json` 配置：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": {
      "@devscope/*": ["./packages/*/src"]
    }
  }
}
```

**注意**：使用 `tsup` 的包需要覆盖配置：
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "incremental": false,
    "moduleResolution": "node"
  }
}
```

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件 | kebab-case | `analyze-repository.ts` |
| 组件 | PascalCase | `HealthScoreChart` |
| 函数/变量 | camelCase | `fetchRepoData` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 类型/接口 | PascalCase + 后缀 | `AnalysisResult` |
| Zod Schema | camelCase + Schema | `repositoryAnalysisSchema` |

### Git 提交规范

```
<type>(<scope>): <subject>

type: feat|fix|docs|style|refactor|test|chore
scope: api|web|db|ai|shared
subject: 简洁的改动描述
```

示例：
```
feat(ai): 添加结构化输出方法
fix(api): 修复 tRPC 路由参数验证
docs: 更新 CLAUDE.md
test(db): 添加数据库单元测试
```

---

## 🐳 Docker 配置

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: devscope
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

---

## 📚 待实现功能

### RAG 检索增强 (规划中)

```typescript
// 文本分块策略
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
  separators: ['\n\n', '\n', '。', '，', ' '],
});

// pgvector HNSW 索引
CREATE INDEX ON repo_embeddings
USING hnsw (embedding vector_cosine_ops);
```

### CLI Skills 系统 (规划中)

```
skills/
├── repo-fetch/
├── repo-analyze/
└── report-generate/
```

### Workflow 编排 (规划中)

用于复杂分析流程的自动化编排。

### Agent SDK (规划中)

自主深度研究，多工具协作。

### 监控系统 (规划中)

- API 调用指标埋点
- Agent 执行日志
- 性能监控

---

## 🔍 故障排查

### API 调用失败

1. 检查 `ANTHROPIC_API_KEY` 是否正确设置
2. 检查网络连接（能否访问 `api.anthropic.com`）
3. 查看日志：`pnpm --filter @devscope/api dev`

### 数据库连接问题

1. 检查容器状态：`docker-compose ps postgres`
2. 验证连接串：确认 `DATABASE_URL` 正确
3. 重置数据库：`docker-compose down -v && docker-compose up -d`

### 测试失败

1. 确保所有包已构建：`pnpm build`
2. 清除缓存：`pnpm --filter @devscope/ai clean`
3. 运行单个测试：`pnpm --filter @devscope/ai test -- filename`

---

## 📚 相关资源

- [Anthropic Claude API 文档](https://docs.anthropic.com/)
- [tRPC 文档](https://trpc.io/docs)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
- [pgvector 文档](https://github.com/pgvector/pgvector)
- [Next.js 15 文档](https://nextjs.org/docs)

---

*最后更新：2026-03-10*
