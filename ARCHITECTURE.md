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
  ├── GitHub API
  ├── DeepSeek 或其他 OpenAI-compatible API
  ├── BGE-M3 embedding 服务

后台执行面
  API / Scheduler → PostgreSQL jobs → Worker
    ├── analysis.health → workflow_executions / workflow_reports
    ├── graph.rebuild   → repo_relationships
    └── radar.discover.github → radar_candidates

统一 Agent 调用面
  CLI / MCP → API Client → tRPC API

独立 CLI Skills
  repo-fetch → repo-analyze → report-generate
```

生产环境由 Nginx 作为唯一公开入口。Web、API 和 PostgreSQL 只绑定到回环地址，不能直接暴露到公网。

## Monorepo 职责

| 目录              | 职责                                                            |
| ----------------- | --------------------------------------------------------------- |
| `apps/web`        | Next.js App Router 页面、组件、tRPC 客户端和 SSE 交互           |
| `apps/api`        | Fastify 入口、tRPC 路由、Agent/Workflow SSE 路由和调度器        |
| `apps/worker`     | 持久任务领取、续租/恢复、健康分析、图谱重建与候选入箱          |
| `apps/cli`        | 可安装的 `devscope` CLI、JSON 输出和退出码                     |
| `apps/mcp`        | MCP stdio Server 与工具注册                                    |
| `packages/ai`     | OpenAI-compatible 的统一文本、流式和结构化输出接口              |
| `packages/client` | tRPC transport、认证请求头、公开调用 facade 与响应校验          |
| `packages/db`     | Drizzle schema、数据库访问、GitHub 数据采集和分析管道           |
| `packages/shared` | Zod schema、共享 TypeScript 类型、GitHub 客户端                 |
| `skills`          | 可独立执行或通过管道组合的命令行工具                            |

主要依赖方向：

```text
apps/web ───────────────► packages/shared
apps/api ───────────────► packages/ai, packages/db, packages/shared
apps/worker ─────────────► packages/db, packages/shared
apps/cli ───────────────► packages/client ───────────────► tRPC API
apps/mcp ───────────────► packages/client ───────────────► tRPC API
packages/db ────────────► packages/ai, packages/shared
skills/repo-analyze ────► packages/ai, packages/shared
skills/repo-fetch ──────► packages/shared
skills/report-generate ─► packages/shared
```

共享包不能反向依赖应用层；Web 不直接连接数据库。CLI 与 MCP 也不能直接依赖数据库或 AI 包，所有业务行为都经 API 执行。这样可以让未来应用鉴权、租户隔离、限流和审计在服务端统一生效。

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

仓库详情页可以启动单仓库健康分析。交互式 Agent 路径通过 SSE 推送过程事件，
请求取消会沿 Web proxy、API、workflow runner 传到模型请求；流意外中断不会伪装成完成。
需要跨进程恢复的健康分析则先创建 `analysis.health` job，由 Worker 领取、续租和重试。
两条入口最终共用同一个数据库 workflow runner：结构化报告先经过 Zod 校验，再通过
数据库事务写入 `workflow_reports` 并把对应 `workflow_executions` 标记为 `completed`。

```text
仓库详情页
  → SSE: POST /api/agent/workflow/stream
    或 tRPC startHealthAnalysis → jobs → Worker
  → workflow_executions (pending / running)
  → Agent 分析 + Zod 校验
  → PostgreSQL 事务：workflow_reports + execution completed
  → 仓库报告历史 / 报告详情页
```

PostgreSQL 是报告的事实来源。`reports/<executionId>` 仍可生成 JSON/Markdown，
但只作为可选导出缓存；容器文件写入失败或容器重建不会影响已入库报告的读取。
报告列表和详情查询当前都显式按服务端解析的 `userId` 过滤。现阶段该值仍来自
单用户上下文，未来接入会话鉴权时应替换统一的当前用户解析逻辑。

### 持久后台任务

API 内 scheduler 按日创建带 `userId` 和 `idempotencyKey` 的
`radar.discover.github` 任务，不直接调用外部发现源；用户发起的健康分析和图谱重建也进入
同一 `jobs` 队列。独立 Worker 使用 PostgreSQL
lease 与 `FOR UPDATE SKIP LOCKED` 领取任务，失败后进入 `retry_wait`，超过最大尝试
次数后进入 `dead`；进程中断留下的过期 lease 会被重新排队。

```text
API / Scheduler → jobs → Worker → workflow / graph / radar 数据
```

候选按 `(userId, fullName)` 去重，并保留查询条件、topics、创建/更新时间等发现证据。
候选不会自动写入正式 `repositories`。当前只完成可靠发现与候选池基础；兴趣画像、
确定性评分、研究 Agent、digest 和反馈闭环仍属于后续迭代。

AI 层统一使用 `openai-compatible` provider：优先读取 `OPENAI_COMPATIBLE_*`，
也支持 `DEEPSEEK_*`，当前生产默认模型为 `deepseek-chat`。未配置 API Key 时会在初始化阶段明确失败。

### 语义搜索

BGE-M3 生成 1024 维向量，数据库通过 pgvector 保存和检索。服务可使用硅基流动或其他 OpenAI-compatible embedding endpoint。

### 关系图谱

图谱包含仓库、语言和技术栈三类节点。仓库相似边来自仓库级向量，语言边来自仓库主语言；
依赖重建会从 SBOM 识别 React、Vue、Spring Boot 等稳定技术栈，并写入
`tech-stack/<slug>` 轻量节点。`deps.dev` 的 `SOURCE_REPO` 只用于连接已经采集的仓库，
不会再把 lodash 等公共库的源码仓库提升为技术栈节点。技术栈轻量行不参与采集、向量化或仓库列表。
前端默认使用 2D 渲染，并在桌面 WebGL 可用且未开启减少动态效果时允许手动切换到 3D；
两种模式分别持久化布局，切换时会卸载未使用的渲染器，避免 3D 的 WebGL 与动画循环在后台继续运行。

### CLI Skills

```bash
echo "vercel/next.js" \
  | npx tsx skills/repo-fetch/index.ts --include-issues --include-commits \
  | npx tsx skills/repo-analyze/index.ts \
  | npx tsx skills/report-generate/index.ts --title "Next.js 分析报告"
```

三个工具以 JSON/stdin 为主要衔接方式，适合单独使用，也适合脚本编排。
`repo-analyze` 同时接受逐行 `owner/repo` 和 `repo-fetch` 输出的 JSON 数组；JSON 中的采集结果
会作为受长度限制的分析上下文，而不是被丢弃。

### 用户数据边界

`repositories` 表示可共享的 GitHub 仓库实体；`user_watched_repositories` 表示用户与仓库的
关联，并承载备注、star 时间和关注设置。列表、详情、搜索、分组、任务、报告和图谱都以该关联
或显式 `userId` 作为可见性边界。当前身份来源仍是单用户解析器，不能据此宣称已完成公共多用户鉴权。

### CLI 与 MCP

`packages/client` 是面向外部调用面的稳定 facade。它通过 tRPC HTTP transport 调用 API，并使用 Zod 再次校验响应。`apps/cli` 将该 facade 映射为稳定 JSON 命令；`apps/mcp` 将同一组能力映射为七个 MCP tools。

```text
人类 / shell / Agent ──► devscope CLI ─┐
                                      ├──► API Client ──► Fastify + tRPC API
MCP Host / Agent ──────► MCP stdio ───┘
```

首批范围只包含健康检查、仓库列表/详情/采集、向量化状态、语义搜索和分组列表。采集仍由 API 执行业务逻辑；MCP 工具不会在本地直接调用 GitHub、数据库或模型服务。

## 类型与验证边界

- TypeScript：编译期类型检查；
- Zod：API 输入、输出与 AI 结构化结果的运行时校验；
- tRPC：Web 与 API 的类型共享；
- Drizzle：数据库 schema 和查询类型推断。

这些机制不能替代鉴权和租户隔离。当前 tRPC 路由仍使用 `publicProcedure`，所以系统只适合在外层访问控制保护下作为单用户私有服务运行。

## 当前风险与演进方向

### 单用户假设

身份解析仍使用默认用户/首个用户语义。公开多用户版必须先接入统一会话身份，再进行完整授权测试；
现有显式 `userId` 查询边界只是必要基础，不等于鉴权已经完成。

### 数据库演进

Drizzle baseline 及后续显式迁移已纳入版本控制。迁移 `0004` 把历史误用 `serial` 的外键改回
普通 `integer`，建立用户仓库真实唯一约束，并把备注/star 时间和图边回填到用户边界。
后续 schema 变化仍必须生成、实测和审查显式迁移；公开版前还需进行多用户数据演练。

### 实验能力

仓库健康分析的报告入库、历史列表和详情读取已经形成可恢复的数据库链路。
调度器和 Worker 已通过持久 jobs 解耦；Radar 当前只有 GitHub Search 发现与候选入箱，
尚未形成完整推荐产品。其他报告类型仍包含可选配置或未完成路径，应继续与稳定核心解耦，
不应阻塞仓库、搜索和基础分析功能。未来接入自研工作流系统时，应通过独立适配层接入，
不要把外部执行器协议写入现有报告数据模型。

### 生产边界

- Nginx 是唯一公网入口；
- Web、API、PostgreSQL 仅绑定回环地址；
- 私有版在应用鉴权落地前使用反向代理访问控制；
- 密钥只进入服务器环境文件或密钥系统，不进入 Git；
- 部署必须使用干净工作树、可追溯镜像和显式迁移。

具体操作见 [生产运行手册](docs/PRODUCTION_RUNBOOK.md)。
