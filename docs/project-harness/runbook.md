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
pnpm db:migrate
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

### 技术栈存储模式（Phase C 终态）

- `TECHNOLOGY_STACK_STORAGE_MODE`：技术栈事实的存储模式。Phase C 已于 2026-08-20
  在生产执行完毕（cleanup + 独立 closeout APPROVE），终态 revision 仅支持
  `legacy_cleaned`，生产 `.env` 固定该值；枚举中的其余三个迁移中间态值在当前
  revision 下启动直接失败（fail closed，不自动回退）。历史迁移流程见
  "技术栈 new_only 切换与 cleanup 维护窗口"一节（已执行完毕，仅作回滚/审计参考）。
- 本地开发：`.env` / `.env.local` 设 `TECHNOLOGY_STACK_STORAGE_MODE=legacy_cleaned`。
  `pnpm db:push` 直建库（无 `is_reference` 列）与迁移文件建成的库（列存在但伪数据为 0）
  在 marker 矩阵下均放行 `legacy_cleaned`。

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

`db:migrate` 是本地开发的默认建库入口，会执行已纳入版本控制且经过审查的迁移。
`db:push` 只用于不依赖手写迁移 SQL 的本地 schema 实验；它不会创建 migration 中的 function、trigger
等自定义对象。生产环境必须先备份，再通过手动部署输入显式执行迁移。

### 分组树迁移 `0011`

`0011_violet_hammerhead.sql` 为 `repository_groups` 增加单父级层级、同用户组合外键、同级索引
和循环检测 trigger。既有行保持 `parent_id = null`，不修改 `group_members`。生产执行仍属于
显式维护动作，不随普通部署自动 `db:push`：

本地开发分组层级功能时也必须使用 `pnpm db:migrate` 建库；`pnpm db:push` 只能同步 Drizzle
schema，不能安装本迁移的循环检测 function/trigger，因此不具备与迁移库一致的数据库防线。

1. 记录分组与成员行数，并创建、校验 PostgreSQL custom-format 备份；
2. 审查目标镜像包含 `0011` 迁移和对应 schema，再显式启用部署迁移输入；
3. 迁移后核对所有旧分组仍为根级、成员行数不变，并验证树读取、创建子组、移动、聚合读取和
   删除含子组失败；
4. 只有所有 `parent_id` 仍为空时，才可在停止相关写入后执行
   `packages/db/drizzle/rollback/0011_repository_group_hierarchy.sql`；已有层级数据时改用迁移前
   备份恢复或先形成经人工确认的数据降级方案，禁止直接丢弃父子关系。

本迁移的本地门禁必须使用真实 PostgreSQL，覆盖 0010→0011 升级、受保护回滚、跨用户父级、
循环、删除约束、精确同级排序和双连接并发移动，并连续运行两次。

## 技术雷达 Worker

本地 `pnpm dev` 会同时启动 API、Web 和 Worker。scheduler 仅在
`ENABLE_SCHEDULER=true` 时创建每日 GitHub Search 与 GitHub Trending 任务；Worker 可以独立运行
并消费 `jobs`。Worker 当前处理 `analysis.health`、`graph.rebuild`、`radar.discover.github`、
`trending.sync.github`、`external-resource.content` 和手动触发的 `repository.identity.backfill`，
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

## 技术栈 new_only 切换与 cleanup 维护窗口（历史流程，2026-08-20 已执行完毕）

Phase C 的状态机为 `new_read_dual_write -> new_only -> legacy_cleaned`。当前代码 revision（cleanup revision）支持 `new_only` 与 `legacy_cleaned` 两态——维护窗口前以 new_only 运行，cleanup 脚本切 legacy_cleaned 后以同一 revision 重启；dual-write 兼容、legacy writer、legacy 读路径与 Phase A backfill 均已删除，`repositories.is_reference` 列定义已从 schema 移除（journal 中的 DROP COLUMN 由 cleanup receipt 守卫，常规迁移与 fresh 重放均为 no-op）。

### new_only 切换（维护窗口，人工执行）

1. 确认 shadow 零差异：最后一次 dual-write rebuild 的 shadow receipt 一致；
2. 停止 API/Worker（`docker compose stop api worker`，Web 可继续展示维护态）；
3. 编辑服务器 `.env`：`TECHNOLOGY_STACK_STORAGE_MODE=new_only`；
4. 以 `apply_database_migration=true` 手动触发 deploy workflow 部署 new_only revision（journal 应用 0010：receipt 表创建，DROP COLUMN 为 no-op）；
5. 启动后验证：health、401、认证 MCP、图谱/列表/分组/采集路径，rebuild 一次确认冻结基线单向包含通过；
6. 观察窗口内回退方式：恢复上一兼容镜像 + `.env` 回 `new_read_dual_write`（legacy 数据未动）。

### cleanup 维护窗口（workflow 显式 opt-in）

前置条件（缺一不可）：

- new_only 观察窗口结束、冻结基线比较持续通过；
- **已部署 cleanup revision**（`TECHNOLOGY_STACK_SUPPORTED_MODES` 含 `legacy_cleaned`，即当前 main；new_only revision 会被 `cleanup-cli --validate` 的 revision gate 拒绝——cleanup 后不存在可启动 mode）；
- 记录目标 SHA、API/Worker 运行 revision 与镜像 digest，核对与待部署 main 一致；
- 确认无 active `graph.rebuild`/backfill job、无长事务或 advisory-lock writer。

执行：手动触发 deploy workflow 并置 `technology_stack_legacy_cleanup=true`（与 `apply_database_migration=true` 互斥；workflow 级 `concurrency: production` 防与普通部署并发）。固定顺序为 preflight 校验 → pg_dump 备份并验证可读 → 停服务执行删除事务+写 receipt+切 `legacy_cleaned`+DROP COLUMN → 重启 → health/401/业务不变量验证。

回滚：停止新服务 → 恢复 cleanup 前数据库备份 → 恢复上一兼容镜像与 mode → 启动 → 复核摘要。不靠重新抓取或手工补行恢复。若 cleanup 删除事务已提交但 DROP COLUMN 前中断，重跑 `--execute` 走补删完成路径（不再写第二条 receipt）。注意此时 `.env` 已被切为 `legacy_cleaned`，workflow preflight 的 new_only 检查不再放行——补删需人工 SSH 执行 `docker compose ... run --rm --no-deps api node packages/db/dist/cleanup-cli.mjs --execute`（gate 语义不变，mode 由 CLI 环境读取）。

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

1. `OPENAI_COMPATIBLE_*`（生产当前默认 MiniMax M3：大陆站 `https://api.minimaxi.com/v1`，国际站 `https://api.minimax.io/v1`，key 与站点必须匹配）
2. `DEEPSEEK_*`（显式回滚配置）

如果两组都未提供，AI Provider 会在初始化时返回缺少 API Key 的明确错误。

provider 差异由 `packages/ai/src/request-builder.ts` 统一处理：MiniMax M 系列发送 `max_completion_tokens`（`max_tokens` 已被官方标记 deprecated）、注入 `thinking: {type: "disabled"}`（默认 adaptive thinking 会把 `<think>` 写入 content 污染 JSON/工具输出）、不发送 `response_format`（官方 schema 未声明，会被静默忽略）；DeepSeek 回滚路径保持 `max_tokens` + `response_format: json_object` 不变。thinking 污染的 content 在 `JSON.parse` 处 fail closed，不做标签剥离。BGE-M3 embedding 与 pgvector 1024 维不随本配置变化。

### 语义搜索失败

确认 embedding endpoint 支持 OpenAI-compatible `/embeddings` 请求，并返回 1024 维向量。不要只修改模型名而忽略数据库维度。

### 真实 PostgreSQL 集成门禁（test:integration）

`pnpm test:integration` 在隔离 PostgreSQL 16 + pgvector 上运行迁移、事务、并发与租约矩阵（CI 的 `integration` job 必跑；本地可选）：

- 本地运行：起一个一次性容器（`docker run -d --name devscope-test-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 pgvector/pgvector:pg16`），然后
  `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres TEST_DATABASE_DESTRUCTIVE=1 NODE_ENV=test pnpm test:integration`；
- `TEST_DATABASE_URL` 只允许指向 admin 入口（`postgres` 库）；测试库名由 runner 唯一派生（`devscope_test_*`）并在结束时自动删除，连续两次运行不得有残留库；
- 隔离门禁 fail closed：危险/业务库名、缺 `TEST_DATABASE_DESTRUCTIVE=1`、`NODE_ENV≠test`、host 不在 allowlist 都会拒绝运行；CI 通过 `INTEGRATION_REQUIRED=1` 保证未配置时直接失败而不是静默跳过；
- 迁移按 journal 顺序单事务应用并手写 `drizzle.__drizzle_migrations`（hash=文件 SHA-256），`verifyMigrationJournal` 提供 checksum/order drift 校验——drizzle migrator 本身只按时间戳跳过、不比对 hash；
- `quality` job（lint/typecheck/test/build）不注入任何 `TEST_DATABASE_*` 变量，保持快速反馈；
- **required check**：GitHub Ruleset `main-required-checks` 已把 `quality` 与 `integration` 都设为默认分支 required checks；调整 job 名称时必须同批更新 Ruleset，避免门禁因 context 漂移失效；
- 本机环境注意：若宿主 5432 已被系统 PostgreSQL 占用（docker 端口映射不生效），隔离容器请用其他端口（如 5433）；
- 进程被硬杀（SIGKILL）时 teardown 不会执行，可能残留 `devscope_test_*` 库；用
  `docker exec <pg容器> psql -U postgres -c "select datname from pg_database where datname like 'devscope_test_%'"` 检查并手动 DROP。

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
3. GitHub Actions runner 用完整 Git 历史生成目标 SHA 的 Git bundle，并把三个 full-SHA 镜像保存为压缩 Docker archive；
4. runner 为 bundle/archive 生成 SHA-256 清单，通过现有 SSH authority 传入按 `SHA-run_id` 隔离的服务器 staging 目录；生产服务器不主动访问 GitHub/GHCR；
5. 服务器先验证 checksum、bundle target、fast-forward ancestry、磁盘空间和三个 image revision，再 `docker load`、更新 `latest` 与单一 `rollback` tag，并执行 `git merge --ff-only`；
6. 只重建 DevScope 的 `web`、`api`、`worker` 等目标服务；
7. 如有数据库迁移，单独审查、备份、执行和验证；
8. 使用 `nginx -t` 验证配置后执行 reload，不随意 restart 共享 Nginx；随后运行 `bash scripts/https-reload-if-present.sh` 刷新已安装的独立 TLS edge upstream。成功后删除本次 staging，失败时保留它用于诊断。

生产服务器的 Mihomo 或其他公网代理不是常规部署链路的依赖。代理订阅失效不得通过关闭 checksum、改用镜像 `latest` 猜测值或恢复服务器侧 `git pull/docker pull` 绕过；应先保持现有生产容器不动，再修复受控的 runner→SSH 传输链路。`rollback` tag 只保存上一次运行镜像，业务健康检查失败时按本节回滚流程恢复。

生产 API 容器默认使用 `SCHEDULER_TIMEZONE=Asia/Shanghai` 解释 cron 时间，不依赖容器自身的 UTC 时区。

首次上线 Worker 前必须应用 `packages/db/drizzle` 中已审查的迁移。外部资源正文功能还需要
`0014`–`0016`（正文表、约束与 processing claim）按 journal 顺序应用。手动部署工作流的
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

### 独立 HTTPS 入口与续期

本节是操作流程，不表示已经上线。只覆盖 `devscope.cn` / `www.devscope.cn`，保留 Basic Auth
和旧 SSH tunnel；不更换凭据、不发布多用户、不迁移数据库。只增加独立 TLS edge，现有
`devscope-nginx`、API、Web、Worker、PostgreSQL 不得 restart/recreate；共享 Nginx 仅配置检查
成功后 reload。不要为本次配置发布触发会重建三应用的常规 deploy workflow。

#### 1. 发布前与备份

先完成本地四门禁、`python3 scripts/test-https.py`、独立实现审查与 required CI；生产只从
干净工作树 fast-forward 到已接受的精确提交，沿用 Git bundle/checksum→SSH，不在服务器
`git pull`。再次核对备案放行、两域名 A/AAAA（存在 AAAA 时 IPv6 也必须能到达本入口）、
80/443 云防火墙和主机监听、磁盘与 Docker 权限，443 不得被其他站点占用。缺少账号权限时
暂停，不扩大开放端口或变更备案资料。

```bash
cd /home/devscope/DevScope
git status --short
docker ps --format '{{.Names}} {{.ID}} {{.Image}}'
docker inspect --format '{{.Name}} {{.Id}} {{.Image}} {{.State.StartedAt}}' devscope-nginx devscope-api devscope-web devscope-worker devscope-postgres
docker network inspect devscope_devscope-network --format '{{.Name}}'
ss -ltn
command -v timeout
```

若现有业务容器命名不同，以 `docker ps` 解析的确切名称保存身份，不盲目执行。记录共享
`shared-routes.conf`、`devscope-auth.conf` 与 `.devscope.htpasswd` 的 SHA-256（不输出内容），
以及 `/supplier-search/`、`/billmapper/` 的原 scheme/Host/path、状态与命中配置归属。相同
502 不能独自证明路由未变。最终域名 HTTP server 同样 include 原 shared routes，只有
DevScope fallback 308；共享应用不跳转到 TLS Web，也不在本轮新增 HTTPS。两个目标域名、
IP/loopback/其他 Host 的共享路径均按相同请求对照基线，不依赖对既有消费者的推测。

在 `/home/devscope/backups/devscope/` 建立本轮 mode `700` 专属目录，备份 `.env`、完整
`nginx/`、已有 TLS state/runtime env、两个 systemd unit 的现有状态（如存在）；archive mode
`600`，用 `tar -tf` 静默确认可读。私钥/ACME account/认证文件不出服务器、不进 Git、不展开
打印。记录本轮原先不存在的文件，回滚才能只撤销本轮新增。没有 DB mutation，无需额外
数据库恢复。保存准确目标 SHA、bundle/image archive 校验和及原五容器身份。

镜像在受控本地/runner 拉取服务器架构，再 `docker save`，生成 SHA-256 清单，通过已有 SSH
authority 上传，服务器验证 checksum 后 `docker load`。新 TLS edge 使用本轮明确选择的
stable Nginx 1.30.6；原共享 HTTP 1.29.8 只保留兼容验证，不随本轮重建或升级，也不声称其
安全问题已经鉴定/修复。不因拉取失败更换 `latest` 或临时启用代理。当前批准的 immutable images：

```text
nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951
certbot/certbot:v5.8.0@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20
```

按平台导出、离线 load 后，Docker 可能只恢复平台 manifest 内容 ID，不恢复 registry/index
引用。先确认 archive 校验成功，再核验 amd64 ID 与以下批准内容一致；不要因
`No such image` 改用未核验镜像。为 one-shot Certbot 加本任务专属版本 tag，防止常规
`image prune` 删除无 tag 的暂时未运行镜像；实际运行仍固定内容 ID。若 tag 已存在，先核对
内容，不覆盖来源不明 tag，也不改任何全局 `latest`：

```bash
docker image inspect --platform linux/amd64 sha256:84ed8c0dd296c188bfc24ed506f46589e9285fb0b11cf3a04d91d524d3067e11 --format '{{.Id}} {{.Architecture}}'
docker image inspect --platform linux/amd64 sha256:398c47284a6d6782825be71685f677ef3a1e65b8b5c278a8b1e99f6da84b4eb9 --format '{{.Id}} {{.Architecture}}'
docker tag sha256:84ed8c0dd296c188bfc24ed506f46589e9285fb0b11cf3a04d91d524d3067e11 devscope-https/nginx:1.30.6-amd64
docker tag sha256:398c47284a6d6782825be71685f677ef3a1e65b8b5c278a8b1e99f6da84b4eb9 devscope-https/certbot:5.8.0-amd64
```

在服务器以安全编辑器建立 `/home/devscope/.config/devscope-https/runtime.env`（目录 `700`、
文件 `600`，不 source 到 shell，不含业务 `.env` 内容）：

```dotenv
DEVSCOPE_TLS_NGINX_IMAGE=sha256:84ed8c0dd296c188bfc24ed506f46589e9285fb0b11cf3a04d91d524d3067e11
DEVSCOPE_TLS_CERTBOT_IMAGE=sha256:398c47284a6d6782825be71685f677ef3a1e65b8b5c278a8b1e99f6da84b4eb9
DEVSCOPE_TLS_NETWORK=devscope_devscope-network
DEVSCOPE_TLS_CONF_DIR=/home/devscope/DevScope/nginx/conf.d
DEVSCOPE_TLS_STATE_DIR=/home/devscope/.local/state/devscope-https
```

每条 Compose 命令必须显式指定 `--project-name devscope-https --env-file ... --file
docker-compose.https.yml`，绝不与业务 compose 叠加；运行前清除 shell 的 `COMPOSE_*` 和
`DEVSCOPE_TLS_*` 覆盖。可在当前服务器 shell 定义无凭据的数组（后续命令沿用）：

```bash
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES
unset DEVSCOPE_TLS_NGINX_IMAGE DEVSCOPE_TLS_CERTBOT_IMAGE DEVSCOPE_TLS_NETWORK DEVSCOPE_TLS_CONF_DIR DEVSCOPE_TLS_STATE_DIR
tls=(docker compose --project-name devscope-https --env-file /home/devscope/.config/devscope-https/runtime.env --file /home/devscope/DevScope/docker-compose.https.yml)
install -d -m 700 /home/devscope/.local/state/devscope-https
install -d -m 700 /home/devscope/.local/state/devscope-https/{letsencrypt,work,logs}
install -d -m 755 nginx/conf.d/server-local/acme-webroot/.well-known/acme-challenge
"${tls[@]}" config --services
```

缺 bind 源目录/必需变量应直接失败；不得为“能启动”把认证文件替换为空文件。检查现有
`devscope-auth.conf` 已启用 `auth_basic` 并引用原 `.devscope.htpasswd`；本轮不覆盖这两个文件。

通过 SSH 批处理执行时，优先传输脚本文件后运行；若用 `ssh ... bash -s`，需为
`docker compose run` 等交互式入口显式重定向 `</dev/null`，避免其消耗剩余脚本 stdin。
不能因前置 `nginx -t` 返回0就推断后续up已执行，仍须检查容器、监听和外部请求。

#### 2. HTTP bootstrap → staging → 正式证书

只安装 `nginx/https/acme-location.conf` 为 `nginx/conf.d/server-local/devscope-acme.conf`，
不要提前安装 `http-domain.conf`。目标文件如已存在先比较/备份，不覆盖来源不明内容。
tracked `default.conf` 现通过公共 `.inc` 保持旧路由行为；两个新 include 在没有服务器专属
文件时不改变 HTTP 行为。只在下列检查成功后 reload：

```bash
docker exec devscope-nginx nginx -t && docker exec devscope-nginx nginx -s reload
```

在专用 webroot 为两个域名分别放一次性随机 token，以外部未认证 HTTP 验证 200 且正文精确
相符，缺失 token/目录/多级路径应 404，相邻 `.well-known`/穿越请求不能读取任何配置文件。
主页、静态资源、`/api/`、`/trpc/`、`/api/agent/` 未认证仍 401；共享路由按相同 Host/path
对照基线。测试 token 验收后仅删除本轮 token。公网 HTTP 不发送 Basic Auth。

先建立**独立 staging state** 与独立 staging runtime env，除 `DEVSCOPE_TLS_STATE_DIR` 指向
`/home/devscope/.local/state/devscope-https-staging` 外保持上述值；预先建立其
根目录（mode700）及 `letsencrypt/work/logs` 目录；不能只对叶子mkdir而遗漏上级权限。
使用 `--staging` 的 `certonly` 命令演练；不要启动 TLS edge，
不要把 staging state 挂入正式 edge。正式签发时用正式 env，去掉 `--staging`：

```bash
docker compose --project-name devscope-https --env-file /home/devscope/.config/devscope-https/staging.env --file /home/devscope/DevScope/docker-compose.https.yml --profile certbot run --rm --no-deps certbot certonly --staging --webroot -w /var/www/acme --cert-name devscope.cn -d devscope.cn -d www.devscope.cn --non-interactive --agree-tos --register-unsafely-without-email
# 正式签发使用正式 runtime env，与 staging state 分离。
"${tls[@]}" --profile certbot run --rm --no-deps certbot certonly --webroot -w /var/www/acme --cert-name devscope.cn -d devscope.cn -d www.devscope.cn --non-interactive --agree-tos --register-unsafely-without-email
```

`--register-unsafely-without-email` 是不擅自填写用户邮箱的无邮箱账户选择；如用户提供并确认
通知邮箱，用 `--email` 取代它。不要输出账户或私钥。检查正式公开证书 SAN、issuer、有效期：

```bash
sudo openssl x509 -in /home/devscope/.local/state/devscope-https/letsencrypt/live/devscope.cn/fullchain.pem -noout -issuer -dates -ext subjectAltName
"${tls[@]}" run --rm --no-deps https nginx -t
"${tls[@]}" up -d --no-deps https
"${tls[@]}" ps
```

`up` 只包含 `https`，不要不带 service 执行业务 compose 命令。TLS main 精确 include 认证
片段；配置缺失则 `nginx -t`/启动失败，htpasswd 缺失时认证请求失败而非匿名放行。

#### 3. 外部 TLS 验收后再启用 308

从外部对两个域名使用系统可信 CA（不使用 `-k`、不关闭校验）确认 SAN/链/到期时间，未认证
主页、静态资源、API、tRPC、SSE 均 401。随后用安全凭据注入，经**已验证证书的 HTTPS** 验证
首页、页面实际引用的静态资源、health 和只读列表；不要把凭据写进 URL、命令参数、截图或
日志。只允许 HTTPS 或 SSH loopback 发送认证，不触发采集/DB 写入。对照实际 edge 证书与
磁盘证书指纹；磁盘证书更新不是线上已加载的证据。

确认以上通过后，安装 `nginx/https/http-domain.conf` 为
`nginx/conf.d/server-local/devscope-http-domain.conf`，`nginx -t && nginx -s reload` 仅 reload
共享 HTTP Nginx。复核两个精确域名 DevScope 业务路径 308 到同域同 path/query 的 HTTPS，
共享应用 paths 继续命中原 HTTP locations，不跳转；ACME 仍
200/404；IP、`127.0.0.1` 与其他 Host 不强制跳转，原 tunnel 继续使用。复核原五个容器的 ID、
image、StartedAt 与备份时完全一致；共享路由配置摘要不变。未启用 HSTS/preload/includeSubDomains，
不以此切换替代未来应用鉴权。

后续正常应用发布会 recreate API/Web，静态 upstream 地址可能变化，不能依靠每日续期偶然
reload 恢复。workflow 在原共享 Nginx check/reload 之后调用固定容器名的
`https-reload-if-present.sh`，无需 TLS runtime env 或 Certbot。成功查询后确认没有该容器才
兼容跳过；已安装停止、Docker 查询失败、配置检查或 reload 失败均非零并阻断发布完成。
每条 Docker 调用限30秒，始终 `nginx -t` 在 reload 前；不会创建、启动或重建代理。应用常规
部署与本轮“只新增入口、原五容器不重建”的接入发布是不同操作，不混用其命令。

维护边界：TLS main `nginx.conf` 当前为单文件 bind。未来 Git 更新若替换源文件 inode，现有
mount 可能仍指向旧文件，不能只做 reload 就宣称配置更新。那类单独获准的 TLS 配置变更应
先用 `"${tls[@]}" run --rm --no-deps https nginx -t` 校验新挂载，再仅
`"${tls[@]}" up -d --no-deps --force-recreate https` 使新 main 生效；绝不重建共享代理。
本轮首次创建不受影响，常规 API/Web 发布仍只调用上述 reload helper，不因此每次重建 TLS。

域名 HTTP server 必须显式保留 `client_max_body_size 10m`，使无局部 override 的共享代理仍与
旧默认 server 一致；不能只用空体 GET 验证。隔离回归覆盖两个目标域名、两个共享路径切换
前后的真实 2 MiB POST 上游接收，以及超过 10 MiB 的 413 边界。

#### 4. 续期演练、无人值守与诊断

续期 wrapper 只读取显式 TLS env，以固定 project/service 调用 `renew --cert-name devscope.cn`。
需要服务器 GNU coreutils `timeout`：Certbot 有 15 分钟上限，配置检查/reload 分别 30 秒；
错误非零传播，不继续 reload。Certbot 本身的证书 state 锁防并发，本轮不建立第二套调度器。

```bash
bash scripts/https-renew.sh /home/devscope/.config/devscope-https/runtime.env --dry-run
# dry-run 成功仅证明 ACME 演练，不替换正式证书、不 reload。
bash scripts/https-renew.sh /home/devscope/.config/devscope-https/runtime.env
# 普通 renew 可能尚未到期；仍须 nginx -t 成功才平滑 reload 独立 edge。
sudo install -m 644 scripts/systemd/devscope-https-renew.service /etc/systemd/system/devscope-https-renew.service
sudo install -m 644 scripts/systemd/devscope-https-renew.timer /etc/systemd/system/devscope-https-renew.timer
sudo systemctl daemon-reload
sudo systemctl start devscope-https-renew.service
sudo systemctl enable --now devscope-https-renew.timer
systemctl status devscope-https-renew.service --no-pager
systemctl list-timers devscope-https-renew.timer --all
journalctl -u devscope-https-renew.service --since '2 days ago' --no-pager
```

unit 在服务器以 `devscope`（有 Docker 权限）执行，无需本地电脑在线或保持 SSH 登录。
timer 按服务器系统时区每日 00/12 时加最多 1 小时随机延迟，`Persistent=true` 补错过检查，service 总上限
20 分钟。确认 `devscope` 可读 runtime env、可访问 Docker socket，unit path 与实际安装位置
一致；timer 下一次时间、service 成功退出与未来真实续期是不同证据。Certbot 会写服务器
state/logs，脱敏查看必要错误，不打印 key/account。

失败定位顺序：journal exit code/超时 → 80 challenge/DNS/AAAA/防火墙 → state 权限与空间 →
`"${tls[@]}" exec -T https nginx -t` → TLS edge logs 与证书日期/指纹；核对仍有效的旧证书可用。
超时如留下 one-shot 容器，先按 `com.docker.compose.project=devscope-https` 和
`com.docker.compose.service=certbot` 的标签精确定位，再仅清理已确认的本轮资源。禁止 prune、
重建共享服务或把续期失败降级为公网带密码 HTTP。现有 timer 不提供外部告警送达保证，
需按运维机制检查失败与到期时间，不能将未验证的提醒承诺为已配置。

Certbot 非交互式真实演练/到期续期还可能自行随机等待数分钟。确认进程和其日志中的
`Non-interactive renewal: random delay` 后等待有界任务，不因暂时没有新stdout就判定挂起；
本轮真实dry-run曾等待约360秒，再完整成功。普通renew返回0也可能只是尚未到期；应分别
记录“演练成功”“service执行成功”“线上证书指纹”和将来的真实换证，不混为一次续期已发生。

#### 5. 精确回滚

仅撤销本轮新增 redirect/bootstrap 片段（或恢复其本轮备份）及本轮 tracked 配置版本，
保留 `shared-routes.conf`、`devscope-auth.conf`、`.devscope.htpasswd`；共享 Nginx 必须先
`nginx -t` 成功再 reload，失败时恢复已知良好文件而非 restart。先撤销 redirect，确认旧
IP/loopback/tunnel 可用，再停止独立 TLS edge 和本轮 timer：

```bash
sudo systemctl disable --now devscope-https-renew.timer
sudo systemctl stop devscope-https-renew.service
"${tls[@]}" stop https
```

恢复原先已存在的 units/runtime 文件与启用状态时使用备份，不误删前次有效部署。证书、ACME
state、logs 和备份保留诊断，不 `down -v`/prune；不重建任何原五容器。仅续期失败而证书仍
有效时不必下线 HTTPS，应保持入口、报告非零失败并及时处理。记录每阶段实际执行、回滚
状态、未验证项；本地/CI 成功或签发成功均不能代替生产 closeout。

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

自 2026-09-29 起，dogfood 产品观察直接以本仓库 GitHub Issue 登记（带 `dogfood` label，待验证项另加 `needs-verification`），不再写入 [Dogfood Observations](dogfood-observations.md)；该文件为历史证据归档，不再更新。

创建 Issue 时沿用以下最小字段（正文小节）：

```markdown
### 背景：用户意图与预期
### 实际结果与复现
- Entry point: MCP | CLI | Web
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
5. 修复经过正常发布与生产复查后，才关闭对应 Issue。

确需跨 session 工程整改的 Issue 按 Harness 约定映射 checklist item（Issue #N ↔ `issue-N`）。反馈不自动扩大生产写入权限，也不代替迁移门禁。
