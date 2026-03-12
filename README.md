# DevScope

<div align="center">

**开源生态智能分析平台**

面向技术投资人和独立开发者，通过 AI 实时掌握 GitHub 项目健康度、技术趋势和竞争格局

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.15-red)](https://pnpm.io/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.3-cyan)](https://turbo.build/)

</div>

## 📖 项目简介

DevScope 是一个面向技术投资人和独立开发者的**开源生态智能分析平台**，通过 AI 实时分析 GitHub 项目的健康度、技术趋势和竞争格局。

### 核心特性

- 🤖 **AI 驱动分析** — 使用 Claude API 进行深度仓库分析
- 📊 **结构化输出** — 强制返回符合 Schema 的结构化数据
- 🔧 **CLI Skills** — 独立的命令行工具，支持管道组合
- 🚀 **现代化技术栈** — Next.js 15 + Fastify + TypeScript
- 🗄️ **向量数据库** — Drizzle ORM + PostgreSQL + pgvector（支持 RAG 检索）
- 🔌 **类型安全** — tRPC 实现端到端类型安全
- 🎨 **精美 UI** — Tailwind CSS + shadcn/ui 组件库
- 📦 **Monorepo** — pnpm + Turborepo 高效构建

---

## 🎯 使用场景

```bash
# 一键分析 GitHub 仓库
echo "vercel/next.js" | repo-fetch | repo-analyze | report-generate

# 批量分析多个仓库
cat repos.txt | repo-fetch --batch | repo-analyze --batch

# 通过 API 调用
curl -X POST http://localhost:3001/trpc/analyzeRepository \
  -H "Content-Type: application/json" \
  -d '{"owner": "vercel", "repo": "next.js"}'
```

---

## 🏗️ 项目结构

```
DevScope/
├── apps/
│   ├── web/              # Next.js 15 前端应用
│   │   ├── src/
│   │   │   ├── app/      # App Router 页面
│   │   │   ├── components/  # React 组件
│   │   │   └── lib/      # 工具函数
│   │   └── package.json
│   │
│   └── api/              # Fastify 后端 API
│       ├── src/
│       │   ├── index.ts  # 服务器入口
│       │   ├── router.ts # tRPC 路由
│       │   ├── trpc.ts   # tRPC 配置
│       │   └── context.ts
│       └── package.json
│
├── packages/
│   ├── db/               # 数据库包
│   │   ├── src/schema/   # Drizzle 数据模型
│   │   └── drizzle.config.ts
│   │
│   ├── ai/               # AI 服务包
│   │   └── src/index.ts  # Anthropic SDK 封装
│   │
│   └── shared/           # 共享类型
│       └── src/index.ts  # Zod schemas + TypeScript 类型
│
├── skills/               # CLI Skills 命令行工具
│   ├── repo-fetch/       # GitHub 数据获取
│   ├── repo-analyze/     # AI 仓库分析
│   └── report-generate/  # 分析报告生成
│
├── pnpm-workspace.yaml   # pnpm 工作区配置
├── turbo.json            # Turborepo 构建配置
└── package.json          # 根配置文件
```

---

## 🚀 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- PostgreSQL 数据库（需安装 pgvector 扩展，可选）

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

复制 `.env.example` 创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 填入你的配置：

```env
# Anthropic API Key（必需）
ANTHROPIC_API_KEY=your-api-key-here

# GitHub Token（可选，提高 API 限流）
GITHUB_TOKEN=your-github-token

# 数据库连接（可选，用于 RAG 检索功能）
DATABASE_URL=postgresql://user:password@localhost:5432/devscope

# API 服务端口
API_PORT=3001
```

### 使用 CLI Skills

```bash
# 方式一：直接运行 TypeScript 文件（需要 tsx）
tsx skills/repo-fetch/index.ts vercel/next.js
tsx skills/repo-analyze/index.ts vercel/next.js

# 方式二：管道组合
echo "vercel/next.js" | tsx skills/repo-fetch/index.ts | tsx skills/repo-analyze/index.ts

# 方式三：通过 tRPC API（需要启动服务）
pnpm --filter @devscope/api dev
```

### 启动 Web 服务

```bash
# 启动所有服务（web + api）
pnpm dev

# 单独启动服务
pnpm --filter @devscope/web dev    # 前端 :3000
pnpm --filter @devscope/api dev    # 后端 :3001
```

### 构建

```bash
# 构建所有包
pnpm build

# 构建指定包
pnpm --filter @devscope/web build
pnpm --filter @devscope/api build
```

---

## 📦 包说明

### 应用 (Apps)

| 包名 | 说明 | 端口 |
|------|------|------|
| [`@devscope/web`](apps/web/) | Next.js 15 前端应用 | 3000 |
| [`@devscope/api`](apps/api/) | Fastify + tRPC API | 3001 |

### 库包 (Packages)

| 包名 | 说明 |
|------|------|
| [`@devscope/db`](packages/db/) | Drizzle ORM + PostgreSQL + pgvector |
| [`@devscope/ai`](packages/ai/) | Anthropic Claude SDK 封装 |
| [`@devscope/shared`](packages/shared/) | 共享类型定义 |

### CLI Skills

| 技能 | 说明 |
|------|------|
| [`repo-fetch`](skills/repo-fetch/) | 从 GitHub 获取仓库数据 |
| [`repo-analyze`](skills/repo-analyze/) | 使用 AI 分析仓库健康度 |
| [`report-generate`](skills/report-generate/) | 生成分析报告 |

---

## 🔧 可用命令

```bash
# 开发
pnpm dev              # 启动所有服务
pnpm build            # 构建所有包
pnpm lint             # 代码检查
pnpm clean            # 清理构建产物

# 数据库
pnpm db:generate      # 生成迁移文件
pnpm db:migrate       # 执行迁移
pnpm db:push          # 推送 schema
pnpm db:studio        # 打开数据库管理界面
```

---

## 📊 分析结果示例

```json
{
  "healthScore": 85,
  "activityLevel": "high",
  "keyMetrics": {
    "starsGrowthRate": 12.5,
    "issueResolutionRate": 92,
    "contributorDiversityScore": 78
  },
  "riskFactors": [
    {
      "category": "维护",
      "description": "核心维护者集中度高，存在单点风险",
      "severity": 6
    }
  ],
  "opportunities": [
    {
      "category": "生态",
      "description": "插件生态活跃，可扩展性强",
      "potential": 9
    }
  ],
  "recommendation": "invest",
  "summary": "Next.js 是一个成熟且活跃的框架..."
}
```

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | Next.js 15, Fastify |
| **语言** | TypeScript 5.7 |
| **样式** | Tailwind CSS |
| **组件** | shadcn/ui, Radix UI |
| **数据库** | PostgreSQL, pgvector（可选） |
| **ORM** | Drizzle ORM |
| **API** | tRPC |
| **AI** | Anthropic Claude (Tool Use) |
| **验证** | Zod |
| **包管理** | pnpm |
| **构建** | Turborepo |

---

## 🗺️ 开发路线图

- [x] Monorepo 架构搭建
- [x] AI 结构化输出封装
- [x] GitHub 仓库分析 API
- [x] CLI Skills 系统
- [ ] RAG 检索增强
- [ ] Web 前端界面
- [ ] Workflow 编排
- [ ] Agent SDK

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
