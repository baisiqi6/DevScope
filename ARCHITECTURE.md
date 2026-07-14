# DevScope 架构说明

本文描述当前代码中的实际架构，不记录尚未落地的历史方案。

## 系统边界

```text
浏览器
  │
  ▼
Next.js Web :3000
  │  /api/trpc 与 /api/agent 反向代理
  ▼
Fastify + tRPC API :3100
  ├── PostgreSQL + pgvector :5432
  ├── GitHub / OSS Insight
  ├── DeepSeek 或其他 OpenAI-compatible API
  ├── Anthropic（可选）
  ├── BGE-M3 embedding 服务
  └── Langtum/Langcore（实验性、可选）

CLI Skills
  repo-fetch → repo-analyze → report-generate
```

生产环境由 Nginx 作为唯一公开入口。Web、API 和 PostgreSQL 只绑定到回环地址，不能直接暴露到公网。

## Monorepo 职责

| 目录              | 职责                                                            |
| ----------------- | --------------------------------------------------------------- |
| `apps/web`        | Next.js App Router 页面、组件、tRPC 客户端和 SSE 交互           |
| `apps/api`        | Fastify 入口、tRPC 路由、Agent/Workflow SSE 路由和调度器        |
| `packages/ai`     | Anthropic 与 OpenAI-compatible 的统一文本、流式和结构化输出接口 |
| `packages/db`     | Drizzle schema、数据库访问、GitHub 数据采集和分析管道           |
| `packages/shared` | Zod schema、共享 TypeScript 类型、GitHub 客户端                 |
| `skills`          | 可独立执行或通过管道组合的命令行工具                            |

主要依赖方向：

```text
apps/web ───────────────► packages/shared
apps/api ───────────────► packages/ai, packages/db, packages/shared
packages/db ────────────► packages/shared
skills/repo-analyze ────► packages/ai, packages/shared
skills/repo-fetch ──────► packages/shared
skills/report-generate ─► packages/shared
```

共享包不能反向依赖应用层；Web 不直接连接数据库。

## 请求与数据流

### Web 请求

浏览器统一访问同源路径：

- tRPC：`/api/trpc/*`
- Agent SSE：`/api/agent/*`

Next.js 根据 `API_REWRITE_TARGET` 将请求转发到 API 服务，开发默认值为 `http://localhost:3100`，生产容器中为 `http://api:3100`。

### 仓库分析

```text
GitHub 数据 → 数据库存储/聚合 → AI 结构化分析 → Zod 校验 → 页面或报告
```

AI 层支持两类 provider：

- `openai-compatible`：优先读取 `OPENAI_COMPATIBLE_*`，也支持 `DEEPSEEK_*`；
- `anthropic`：读取 `ANTHROPIC_API_KEY`。

环境中存在 OpenAI-compatible 或 DeepSeek 配置时会自动选择兼容模式，否则回退到 Anthropic。

### 语义搜索

BGE-M3 生成 1024 维向量，数据库通过 pgvector 保存和检索。服务可使用硅基流动或其他 OpenAI-compatible embedding endpoint。

### CLI Skills

```bash
echo "vercel/next.js" \
  | npx tsx skills/repo-fetch/index.ts --include-issues --include-commits \
  | npx tsx skills/repo-analyze/index.ts \
  | npx tsx skills/report-generate/index.ts --title "Next.js 分析报告"
```

三个工具以 JSON/stdin 为主要衔接方式，适合单独使用，也适合脚本编排。

## 类型与验证边界

- TypeScript：编译期类型检查；
- Zod：API 输入、输出与 AI 结构化结果的运行时校验；
- tRPC：Web 与 API 的类型共享；
- Drizzle：数据库 schema 和查询类型推断。

这些机制不能替代鉴权和租户隔离。当前 tRPC 路由仍使用 `publicProcedure`，所以系统只适合在外层访问控制保护下作为单用户私有服务运行。

## 当前风险与演进方向

### 单用户假设

部分业务仍存在默认用户、首个用户或未显式传递 `userId` 的路径。公开多用户版必须先建立统一身份上下文，并强制所有数据访问携带租户范围。

### 数据库演进

公开版前需要完成正式迁移基线、外键和唯一约束复核，并避免使用 `db:push` 直接修改生产 schema。

### 实验能力

Workflow、Langtum/Langcore、调度器及部分报告接口包含可选配置或未完成路径。它们应继续与稳定核心解耦，不应阻塞仓库、搜索和基础分析功能。

### 生产边界

- Nginx 是唯一公网入口；
- Web、API、PostgreSQL 仅绑定回环地址；
- 私有版在应用鉴权落地前使用反向代理访问控制；
- 密钥只进入服务器环境文件或密钥系统，不进入 Git；
- 部署必须使用干净工作树、可追溯镜像和显式迁移。

具体操作见 [生产运行手册](docs/PRODUCTION_RUNBOOK.md)。
