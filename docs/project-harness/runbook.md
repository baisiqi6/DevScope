# DevScope 运行手册

本文是本地开发、验证、生产部署、回滚和 dogfood 反馈处理的唯一操作来源。架构边界见 [architecture.md](architecture.md)，任务状态见 [harness-checklist.json](harness-checklist.json)。

以下各节先说明本地开发，随后说明生产运行；命令和门禁变化必须在同一批次更新本文。

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
- 一组分析模型配置：优先使用通用 `OPENAI_COMPATIBLE_*`；未配置时回退到 `DEEPSEEK_*`。

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

### Repository identity cutover

- `REPOSITORY_IDENTITY_CUTOVER`：正式仓库稳定 ID 的三阶段发布开关。默认 `disabled`；只有最新一次 `repository.identity.backfill` 结果为 `applied`、冲突为空且可解析正式仓库均已带 ID 后，才改为 `enabled`。在 `disabled` 阶段仍可给同名旧行附加 ID、处理已知 ID 的 rename，但拒绝创建 ID 与 `fullName` 都未命中的新正式行。

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
`ENABLE_SCHEDULER=true` 时创建每日 GitHub Search 与 GitHub Trending 任务；Worker 可以独立运行
并消费 `jobs`。Worker 当前处理 `analysis.health`、`graph.rebuild`、`radar.discover.github`、
`trending.sync.github` 和手动触发的 `repository.identity.backfill`，
运行中会续租，异常中断后的过期任务会被恢复。健康分析需要 AI 配置，图谱依赖回填和 Radar
发现需要 `GITHUB_TOKEN`。Trending 默认每天 `06:15`（`SCHEDULER_TIMEZONE`）抓取三个周期，
也可以从“发现”页面手动启动；Radar 默认每天 `06:00` 创建搜索任务，也可以从对应页签手动
启动。定时与手动入口分别共享对应的可恢复、防重任务。Radar 结果只写入 `radar_candidates`，
不会自动进入正式仓库列表。

Trending 优先抓取 `github.com/trending`。当部署网络无法连接 GitHub HTML 站点时，Worker
会回退读取 `raw.githubusercontent.com/isboyjc/github-trending-api` 的 MIT 许可快照；只有通过
严格结构校验且发布时间不超过 48 小时的数据才会写入数据库。

新增迁移 `0005_github_trending.sql` 创建 Trending 快照和条目表。生产环境执行前仍需按
[生产部署与运维](#生产部署与运维)一节完成备份、迁移审查和回滚准备，不要使用 `db:push`。

### Repository identity 三阶段发布

迁移 `0007_square_arclight.sql` 增加 nullable `repositories.github_repository_id`、正式仓库/Radar 稳定 ID 部分唯一索引和 identity backfill active singleton。迁移会在锁定 Radar 写入后确定性合并同一用户的重复 GitHub ID；保留最早 `firstSeenAt`、按 `lastSeenAt DESC, updatedAt DESC, id DESC` 选择最新证据，并保留唯一非默认状态。若同组存在多个不同非默认状态，整个迁移事务 fail closed。

生产必须依次执行：

1. 备份后在 `REPOSITORY_IDENTITY_CUTOVER=disabled` 下部署 schema 与 compatibility code；
2. 暂停正式仓库采集，通过 `discovery.startRepositoryIdentityBackfill` 创建版本化 one-shot job，并轮询 `discovery.getRepositoryIdentityBackfillStatus`；`blocked` 不是成功，必须先处理 conflicts；
3. 只有结果为 `applied`、conflicts 为空且重新核验通过后，才把 API 的 `REPOSITORY_IDENTITY_CUTOVER` 改为 `enabled` 并恢复采集。

每次 backfill 的终态 job/result 不可重置；新一轮必须使用新 version。任一阶段异常先保持或恢复 `disabled` 并暂停采集；已经完成数据写入而需要整体回退时使用 Stage 1 前备份，不执行临时 down migration。

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

本地 API 默认不需要认证。调用受 Nginx Basic Auth 保护的环境时，通过进程环境设置 `DEVSCOPE_BASE_URL`、`DEVSCOPE_USERNAME` 和 `DEVSCOPE_PASSWORD`。不要把密码写进命令参数或提交到仓库。完整命令和 MCP 配置见 [Agent 调用接口](../AGENT_INTERFACES.md)。

## 独立 CLI Skills

```bash
npx tsx skills/repo-fetch/index.ts vercel/next.js
npx tsx skills/repo-analyze/index.ts vercel/next.js
cat analysis.json | npx tsx skills/report-generate/index.ts --format markdown
```

完整 stdin/stdout 管道已经过集成测试：

```bash
echo "vercel/next.js" \
  | npx tsx skills/repo-fetch/index.ts --include-issues --include-commits \
  | npx tsx skills/repo-analyze/index.ts \
  | npx tsx skills/report-generate/index.ts --title "Next.js 分析报告"
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

### 图重建外呼预算与终态重启

图重建（`graph.rebuild`）对 deps.dev resolution、GitHub canonicalization 和 SBOM backfill 的全部外呼按 provider 计预算（配置见 `.env.example` 的 `GRAPH_*`/`DEPS_DEV_TIMEOUT_MS` 段）：

- 任一 provider 预算耗尽或收到 429 时，任务在图原子提交前失败（fail closed），已写入的 cache receipt 保留，下一次 attempt 从缓存续跑，不会重复已完成的解析；
- `graph.rebuild` 的 `maxAttempts=3`；若数据规模增长导致 3 次尝试后进入 `dead`，通过发现页再次触发重建（`enqueueRestartableJob`）是设计内恢复路径，从 cache receipt 继续即可；
- 进度通过 `graph.getRebuildGraphStatus` 的 `progress` 字段观察（stage、completed/total、cache/外呼计数）；该字段由持有租约的 Worker 写入，不是业务事实来源；
- warm rebuild 在 TTL/freshness 内对 `resolved` 映射与已持久化 canonicalization 零外呼；出现大量剩余外呼时先核对 `retry_after` 与新增 SBOM，而不是调大预算；
- 非法 `GRAPH_*` 配置会让 Worker 启动即失败，修正配置后重启即可，不需要数据修复；
- 预算按逻辑外呼计数：`getSbom` 内部对 5xx 的单次重试计一次预算；similarity 边在 deps 解析前的独立事务提交，因此"预算耗尽零图写入"对 SBOM 阶段耗尽严格成立，deps 阶段耗尽时 similarity 已完成全量替换（与旧版行为一致，边数据仍是完整快照）；
- 迁移 0009 之后的应用层回滚窗口内，旧镜像写非空 `source_repo` 会违反 CHECK 使 graph job 失败（读路径不受影响、数据不损坏），重新升级新版本即自愈。

## 生产部署与运维

本文适用于当前单用户私有版。所有操作都应可审计、可回滚，并避免影响同机运行的其他站点。

### 安全基线

1. Nginx 是唯一公网入口；
2. Web、API、PostgreSQL 仅绑定 `127.0.0.1`；
3. 应用级鉴权完成前，DevScope 路由必须启用反向代理访问控制；
4. `.env`、认证文件和备份不进入 Git；
5. 数据库使用独立强密码，定期轮换；
6. 不在部署阶段隐式执行 `db:push`；
7. 不覆盖或重启同一 Nginx 中与 DevScope 无关的站点。

### 部署前检查

本地：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git status --short
```

服务器：

```bash
cd /home/devscope/DevScope
git status --short
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

服务器工作树必须干净。若发现本地修改，先备份并确认归属，禁止直接覆盖。

### 部署流程

自动部署工作流目前只允许手动触发。推荐过程：

> 根目录 `deploy.sh` 已停用，只保留失败提示。它不是生产入口，也不得绕过本手册恢复旧的一键部署行为。

1. 确认目标提交和镜像已通过 CI；
2. 备份生产 `.env`、Nginx 配置和必要数据；
3. 使用 `git pull --ff-only` 更新，不在服务器直接合并；
4. 拉取固定版本镜像，避免不可追溯的临时构建；
5. 只重建 DevScope 的 `web`、`api`、`worker` 等目标服务；
6. 如有数据库迁移，单独审查、备份、执行和验证；
7. 使用 `nginx -t` 验证配置后执行 reload，不随意 restart 共享 Nginx。

生产 API 容器默认使用 `SCHEDULER_TIMEZONE=Asia/Shanghai` 解释 cron 时间，不依赖容器自身的 UTC 时区。

首次上线 Worker 前必须应用 `packages/db/drizzle` 中已审查的迁移。手动部署工作流的
`apply_database_migration` 默认为 `false`；只有在确认迁移内容、备份空间和回滚窗口后才设为
`true`。工作流会先把 PostgreSQL custom-format 备份写入
`/home/devscope/backups/devscope/`，再显式执行 `db:migrate`。未应用迁移时，Worker schema
检查会阻止部署继续。

迁移 `0005_github_trending.sql` 新增 GitHub Trending 快照、排名和查询索引。部署包含发现榜时，
必须将 `apply_database_migration` 设为 `true`；工作流会同时核对 `jobs`、`radar_candidates`、
`github_trending_snapshots` 和 `github_trending_entries` 四张 Worker 必需表。

迁移 `0004_tidy_giant_man.sql` 会去重并重建用户仓库唯一约束、回填现有仓库关联和图边
`userId`、迁移备注/star 时间，并移除历史外键列错误的 `serial` defaults/sequences。执行前必须
确认备份可恢复；执行后抽查仓库列表、备注、图谱和 workflow 历史，再启动 Worker。

迁移 `0006_release_id_bigint.sql` 只把 `releases.id` 从 PostgreSQL `integer` 扩大为 `bigint`。
执行前后必须比对 Releases 的 `count/min/max` 与 `repo_id` 归属，并通过 API 抽查 ID 已作为
十进制字符串返回。该迁移允许继续写入超过 `2147483647` 的 ID，因而不能在不检查新数据的
情况下原地降级；生产回滚按本手册使用部署前 custom-format 备份。该类型变更需要
`ACCESS EXCLUSIVE` lock，必须安排维护窗口并排查长期事务；部署 workflow 通过
`PGOPTIONS="-c lock_timeout=5s"` 使锁等待有界，超时即停止部署，不得去掉超时后盲目重试。

### 数据迁移门禁

每个生产 schema 批次必须满足：

1. 生成并审查显式迁移，本地仅可用 `db:push` 做开发试验；
2. 迁移前产生 PostgreSQL custom-format 备份并验证可读；
3. 在生产数据副本或等价 fixture 上演练，记录行数、冲突、执行时间和锁影响；
4. 完成 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 与本批次 PostgreSQL 集成测试；
5. 部署后同时验证容器、API、数据库约束、对象行数与业务读路径；
6. 不在部署中重启或覆盖同机其他站点，不用 HTTP 200 代替业务验证。

含数据类型扩大或去重的迁移不保证可无损反向降级。回滚依赖部署前数据库备份和上一个已验证镜像，不临时编写破坏性 down migration。

### 访问控制

当前 API 的 tRPC procedure 尚未实现应用级身份认证。外层访问控制至少覆盖：

- `/`
- `/api/`
- `/trpc/`

同机其他站点的 location 必须显式保持原有行为。认证密码只保存在服务器哈希文件与操作者的安全凭据存储中，不写进仓库或聊天记录。

应用鉴权和租户隔离完成后，再评估是否移除外层保护。

#### 服务器专属 Nginx 片段

仓库内的 `nginx/conf.d/default.conf` 只维护 DevScope 通用代理，并通过通配符加载以下服务器专属片段：

- `nginx/conf.d/server-local/shared-routes*.conf`：同机其他应用的 location 和 upstream；
- `nginx/conf.d/server-local/devscope-auth*.conf`：DevScope location 共用的访问控制；
- `nginx/conf.d/server-local/.devscope.htpasswd`：Basic Auth 密码哈希。

`server-local/` 已被 Git 忽略，但仍会被现有 Nginx 目录挂载读取。生产主机负责备份这些文件；部署不得删除、覆盖或提交它们。修改后只允许先执行 `nginx -t`，成功后再 reload。

### 数据库密码轮换

轮换时应在同一维护窗口内完成：

1. 备份 `.env`；
2. 生成新的随机强密码；
3. 在 PostgreSQL 中更新角色密码；
4. 原子更新 `.env` 中的 `POSTGRES_PASSWORD` / `DATABASE_URL`；
5. 重建 API 服务并验证连接；
6. 失败时恢复旧角色密码、旧环境文件和原服务；
7. 确认备份权限为 `600`，完成后按保留策略清理。

任何命令输出都不得打印新旧密码。

### 验证清单

服务器内部：

```bash
curl --fail http://127.0.0.1:3100/trpc/health
curl --fail http://127.0.0.1:3000/
curl --fail --max-time 20 https://raw.githubusercontent.com/isboyjc/github-trending-api/main/data/daily/all.json > /dev/null
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=50 worker
```

若 `github.com/trending` 在生产网络不可达，上述 GitHub 托管快照必须可达且保持新鲜，否则
Trending 任务会按设计失败并保留上一份成功快照，不能用 Radar 的 GitHub Search 结果代替。

公网侧应验证：

- 未认证访问 DevScope 返回 `401`；
- 使用有效凭据访问首页和 health 返回 `200`；
- 同机其他站点状态与变更前一致；
- API、Web、Worker、PostgreSQL 容器健康；
- 日志中没有持续的数据库认证、代理或 5xx 错误。

### 回滚

按变更的逆序回滚：

1. 恢复 Nginx 配置备份并 `nginx -t`；
2. reload Nginx；
3. 恢复环境文件和数据库角色密码；
4. 恢复上一个已验证镜像或提交；
5. 再次执行内部与公网验证。

如果迁移需要回滚，先停止 Worker，再使用本次部署前生成的 custom-format 备份恢复数据库，
然后恢复上一个 API/Worker 镜像。不得只删除 `jobs` 或 `radar_candidates` 表来代替完整回滚，
也不得在未确认备份可读前执行恢复。

回滚不能依赖未记录的手工状态。每次生产变更都应记录时间、目标提交、备份位置和验证结果，但不得记录密钥明文。

## Dogfood 反馈闭环

生产持久会话通过 DevScope MCP 完成真实的仓库采集、分组、备注、搜索和分析。该会话使用公开的 API/MCP 边界，不为了完成操作而直接修改 PostgreSQL。

出现问题时，按以下最小格式沉淀：

```markdown
### Dogfood observation: <short title>

- Time:
- Entry point: MCP | CLI | Web
- User intent:
- Expected:
- Actual:
- Reproduction:
- Evidence: request/job/execution/repository identifiers and redacted logs
- Impact: blocked | wrong data | stale data | confusing UX | performance
- Frequency: once | intermittent | reproducible
- Workaround:
```

反馈处理顺序：

1. 先确认这是产品缺陷、数据一致性问题、操作器摩擦还是当前未支持能力；
2. 保留可复现证据，不记录密码、Token、Basic Auth 值或完整私有数据；
3. 在工程会话中对照源码、任务状态与数据库事实进行归因；
4. 先增加失败复现或回归测试，再执行最小修复；
5. 修复经过正常发布与生产复查后，才关闭 observation。

Dogfood observation 只有在可复现、有生产证据或有清晰失败条件时才进入 [Harness checklist](harness-checklist.json)。反馈不自动扩大生产写入权限，也不代替迁移门禁。
