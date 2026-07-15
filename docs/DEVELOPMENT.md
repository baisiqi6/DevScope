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
| tRPC health | `http://localhost:3100/trpc/health`                      |
| PostgreSQL  | `postgresql://postgres:postgres@localhost:5432/devscope` |

本地只需通过 Docker 启动 `postgres`。根目录 `docker-compose.yml` 中的全栈配置不作为日常开发入口。

## 环境变量

复制 `.env.example` 后按需要填写：

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

浏览器请求使用同源路径 `/api/trpc/*` 和 `/api/agent/*`，通常不需要配置公开的后端地址。

## 开发命令

```bash
pnpm dev
pnpm dev:clean
pnpm --filter @devscope/web dev
pnpm --filter @devscope/api dev
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
pnpm --filter @devscope/web build
```

## 数据库

```bash
pnpm db:generate
pnpm db:push
pnpm db:studio
```

`db:push` 只用于本地开发。准备生产变更时应生成并审查迁移文件，再按运行手册单独执行。

## CLI Skills

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

### AI 请求失败

确认所选 provider 的 API Key、base URL 和模型名称属于同一服务。OpenAI-compatible 模式按以下优先级读取配置：

1. `OPENAI_COMPATIBLE_*`
2. `DEEPSEEK_*`

如果两组都未提供，AI Provider 会在初始化时返回缺少 API Key 的明确错误。

### 语义搜索失败

确认 embedding endpoint 支持 OpenAI-compatible `/embeddings` 请求，并返回 1024 维向量。不要只修改模型名而忽略数据库维度。
