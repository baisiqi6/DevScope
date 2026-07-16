# 本地开发指南

## 环境要求

- Node.js 20+
- pnpm 9+
- Docker 与 Docker Compose

## 首次启动

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:push
pnpm dev
```

默认服务：

| 服务        | 地址                                                     |
| ----------- | -------------------------------------------------------- |
| Web         | `http://localhost:3000`                                  |
| API         | `http://localhost:3100`                                  |
| Worker      | 后台进程，无监听端口                                     |
| tRPC health | `http://localhost:3100/trpc/health`                      |
| PostgreSQL  | `postgresql://postgres:postgres@localhost:5432/devscope` |

本地只需通过 Docker 启动 `postgres`。根目录 `docker-compose.yml` 中的全栈配置不作为日常开发入口。

## 环境变量

复制 `.env.example` 后按需要填写：

API 启动时会先读取根目录 `.env.local`，再用 `.env` 补齐未配置项。`.env.local` 已被 Git 忽略，适合覆盖本机数据库端口等差异；令牌、密码和其他敏感值仍不得提交。若 shell 或部署环境已经显式设置了同名变量，文件不会覆盖该值。

### 必需配置

- `DATABASE_URL`：PostgreSQL 连接串；
- `GITHUB_TOKEN`：GitHub 数据采集令牌；
- 一组分析模型配置：优先 `DEEPSEEK_API_KEY`，或使用 `OPENAI_COMPATIBLE_API_KEY`。

### 语义搜索

- `SILICONFLOW_API_KEY`
- `BGE_API_URL`
- `BGE_MODEL_NAME`

默认模型为 `BAAI/bge-m3`，当前数据库向量维度为 1024。切换 embedding 模型时必须同时核对输出维度和数据库 schema。

### 端口与代理

- `PORT` / `API_PORT`：API 端口，默认 `3100`；
- `API_REWRITE_TARGET`：Next.js 服务端代理目标，默认 `http://localhost:3100`。

### Worker

- `WORKER_POLL_INTERVAL_MS`：空队列轮询间隔，默认 `5000`；
- `WORKER_LEASE_DURATION_MS`：任务租约时长，默认 `300000`；
- `WORKER_RECOVERY_INTERVAL_MS`：过期租约回收间隔，默认 `60000`；
- `WORKER_RETRY_DELAY_MS`：失败后的基础重试等待，默认 `60000`。

浏览器请求使用同源路径 `/api/trpc/*` 和 `/api/agent/*`，通常不需要配置公开的后端地址。

## 开发命令

```bash
pnpm dev
pnpm dev:clean
pnpm --filter @devscope/web dev
pnpm --filter @devscope/api dev
pnpm --filter @devscope/worker dev
pnpm kill-ports
```

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

局部调试可以使用：

```bash
pnpm --filter @devscope/ai test
pnpm --filter @devscope/api test
pnpm --filter @devscope/client test
pnpm --filter @devscope/cli test
pnpm --filter @devscope/mcp test
pnpm --filter @devscope/worker test
pnpm --filter @devscope/web build
```

## 数据库

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm db:studio
```

`db:push` 只用于本地开发。`db:migrate` 执行已纳入版本控制且经过审查的迁移；生产环境必须先备份，再通过手动部署输入显式执行。

## 技术雷达 Worker

本地 `pnpm dev` 会同时启动 API、Web 和 Worker。scheduler 仅在
`ENABLE_SCHEDULER=true` 时创建每日 GitHub Search 任务；Worker 可以独立运行并消费
`jobs`。当前发现结果只写入 `radar_candidates`，不会自动进入正式仓库列表。

## CLI 与 MCP

新的 `devscope` CLI 和 MCP Server 都通过 `packages/client` 调用 API，不直接加载 `packages/db` 或 `packages/ai`：

```bash
# 开发模式
pnpm --filter @devscope/cli dev --help

# 构建后执行
pnpm build
node apps/cli/dist/index.js health
node apps/mcp/dist/index.js
```

本地 API 默认不需要认证。调用受 Nginx Basic Auth 保护的环境时，通过进程环境设置 `DEVSCOPE_BASE_URL`、`DEVSCOPE_USERNAME` 和 `DEVSCOPE_PASSWORD`。不要把密码写进命令参数或提交到仓库。完整命令和 MCP 配置见 [Agent 调用接口](AGENT_INTERFACES.md)。

## 独立 CLI Skills

```bash
npx tsx skills/repo-fetch/index.ts vercel/next.js
npx tsx skills/repo-analyze/index.ts vercel/next.js
cat analysis.json | npx tsx skills/report-generate/index.ts --format markdown
```

详细参数见各目录的 `SKILL.md`。

## 常见问题

### 端口被占用

```bash
pnpm kill-ports
```

### 数据库不可用

```bash
docker compose ps postgres
docker compose logs postgres
```

确认 `.env` 中 `DATABASE_URL` 与容器端口一致。

如果本机需要覆盖容器或远程数据库地址，可在根目录创建 `.env.local`：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/devscope
```

使用系统安装的 PostgreSQL 时，还需自行安装与当前 PostgreSQL 主版本匹配的 `pgvector`，并在目标数据库中启用 `vector` 扩展。项目默认仍推荐使用 `docker compose up -d postgres`，避免本机扩展版本不一致。

### AI 请求失败

确认所选 provider 的 API Key、base URL 和模型名称属于同一服务。OpenAI-compatible 模式按以下优先级读取配置：

1. `OPENAI_COMPATIBLE_*`
2. `DEEPSEEK_*`

如果两组都未提供，AI Provider 会在初始化时返回缺少 API Key 的明确错误。

### 语义搜索失败

确认 embedding endpoint 支持 OpenAI-compatible `/embeddings` 请求，并返回 1024 维向量。不要只修改模型名而忽略数据库维度。
