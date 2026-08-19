# 技术栈实体分离验证

## 生产只读基线

2026-08-18 在 `main@de3b91722d0b9b120bd6ae7308bbf92af5dc0bdf` 部署后读取生产 PostgreSQL：

- 50 个 repository rows，其中 40 个真实仓库、10 个 `tech-stack/*` reference rows；
- 50 条 watched relations，其中 40 条指向真实仓库、10 条是技术栈伪收藏；
- reference group members 为 0；
- 37 条 dependency edges，其中 34 条指向技术栈 reference，3 条连接真实仓库；
- 34 条技术栈边全部为 `resolvedBy=tech-stack-catalog` 且 packages 为数组，共 203 条包/版本 evidence；
- 10 条技术栈伪收藏均有对应 dependency edge，没有 orphan reference watch。

具体节点为 Axum、Express、FastAPI、Next.js、React、React Native、Svelte、Tauri、Vite、Vue。Spring Boot 是目录支持并需要回归测试的产品语义，但当前生产 SBOM 没有形成该节点，不能伪造为迁移基线。

以上数字是本轮迁移输入的日期化证据，不是长期固定验收常量。实现、隔离 PostgreSQL 演练、PR/CI、分阶段部署和生产 closeout 尚未开始。

## Phase A 本地实现证据

2026-08-18 在 `codex/data-architecture-3-technology-stack-entities` 完成 expand/shadow 阶段实现：

- `0008_round_peter_parker.sql` 仅创建 `technology_stacks`、`repository_technology_stacks`、外键/索引和两个 backfill job 部分唯一索引；不包含业务 backfill、legacy 删除或列删除；
- `technology_stack.entities.backfill` 使用 versioned global singleton，prepare 零业务写入；每个 source 的 relation/checkpoint/receipt 由 fresh lease authority 控制，同一 version 终态不可复用；
- legacy evidence 经过 strict schema、canonical packages、原始 multiplicity 和 ordered digest 验证；SBOM `NULL` fallback 在 stable-ID lock 后重新核验，SQL `NULL` 与 JSONB `null` 明确区分；
- graph rebuild 的最终 DB-only 阶段在一个事务内全序锁定并复核全部 source snapshot，同时提交 new relations 与 legacy reference/watch/edges/cleanup；网络和 deps.dev 解析均位于事务外；
- shadow compare 以当前用户 watched real repositories 投影 top-N，对 source stable ID、stack slug 和 sorted packages 做结构化比较；不一致会让 graph job 失败；
- shared graph schema 与 Web 2D/3D consumer 已先兼容 `reference` 和 `technology_stack` 两种 contract，本阶段 API 仍输出 legacy contract；
- 当前 revision 只接受 `TECHNOLOGY_STACK_STORAGE_MODE=legacy_shadow_dual_write`，未知或未来模式 fail closed。

## 隔离 PostgreSQL 16 + pgvector 演练

使用独立临时 `pgvector/pgvector:pg16` 容器，从 `0000` 到 `0008` 逐条以单事务、`ON_ERROR_STOP=1` 应用迁移；13/13 个定向场景通过，临时容器在测试后删除。覆盖：

- per-source replace、success empty、旧 token/SBOM stale；
- relation/checkpoint/final receipt 同事务、owner/lease 丢失零写入、repository lock 等待跨 expiry；
- 多 source fresh clock、SBOM `NULL` legacy evidence 改写、duplicate → deduplicated multiplicity 变化；
- 真实 graph rebuild 与 backfill 在原 dual-write 中间点强制交错，最终 new/legacy 只出现同一原子结果；
- malformed legacy evidence fail closed、shadow package diff、空库成功 receipt 与空库 terminal expiry rollback。

## 本地质量门禁与独立审查

以下命令全部通过：

```bash
pnpm db:generate
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm db:generate` 报告无 schema drift；lint 保留 16 条既有 Web warnings、0 errors。Phase A implementation continuity review 最终为 `APPROVE`，未发现剩余 P0–P3 finding。

## Phase A 首次生产部署与 fail-closed 证据

PR #35 的 CI 通过并 squash merge 为 `main@eae3127433280831f4f30467f583e0dfe6aaaa98`；deploy workflow run `32144833809` 成功完成构建、生产备份、显式 `0008` migration 和服务发布。生产证据如下：

- 迁移前备份为 `/home/devscope/backups/devscope/pre-migration-20260818-215751.dump`，大小 133875886 bytes，`pg_restore --list` 可读取 221 个目录项；
- API、Web、Worker image revision 与服务器 HEAD 均为 `eae3127433280831f4f30467f583e0dfe6aaaa98`，API/Worker 模式均为 `legacy_shadow_dual_write`；
- migration rows 从 8 增至 9；两张新表与 6 个新索引存在；旧基线保持 40 个真实仓库、10 个 reference rows、40+10 条 watched relations、34 条技术栈边和 203 条 evidence；
- API/Web 内网 health 为 200，未认证 tunnel 请求为 401；Keychain 注入的本地 MCP launcher 返回 `status: ok`，没有读取或输出凭据。

随后启动 version `phase-a-eae3127-v1`、job 27。任务只处理第一个 source 后便把历史微秒 `updated_at` 与 JavaScript 毫秒 token 判为 stale；重试耗尽后进入 `dead`，result 保留 `1/40` checkpoint，没有成功 receipt。旧 API read path 和业务基线不受影响，因此无需回滚 expand migration；失败 job 保留为不可变审计证据。

## 微秒 collection token 修复证据

在 `codex/technology-stack-token-precision` 上将数据库侧 repository token 比较规范为 `date_trunc('milliseconds', updated_at)` 对 canonical UTC 毫秒 timestamp；stable GitHub ID、SBOM baseline、lease authority 和 evidence digest 仍分别复核。新增真实 PostgreSQL 场景直接写入 `2026-08-18 10:04:52.387753`，prepare 得到 `2026-08-18T10:04:52.387Z`，apply 成功。

隔离 PostgreSQL 场景由 13 增至 14，14/14 通过；`pnpm db:generate` 无 schema drift，`git diff --check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。独立 precision fix review verdict 为 `APPROVE`，未发现 P0–P3 finding。

## 尚未验证

- Phase A 的独立 production closeout；
- Phase B `new_read_dual_write` 与 Phase C `new_only → legacy_cleaned`。

Phase B `new_read_dual_write` 与 Phase C `new_only → legacy_cleaned` 不属于本次批准范围，整个 item 仍未完成；当前已 handoff 并暂停。

## Phase A 精度修复部署与最终生产证据

PR #36 的 CI 通过并 squash merge 为 `main@3fa0d9cde6443b3b39d494489c14a206e84cfef6`。deploy workflow run `32146784184` 以 `apply_database_migration=false` 成功发布；服务器 HEAD 与 API/Web/Worker image revision 均为该 SHA，migration rows 保持 9，API/Worker mode 保持 `legacy_shadow_dual_write`。API/Web 内网 health 为 200，未认证 tunnel 为 401，Keychain-backed MCP health 为 `ok`。

新 version `phase-a-token-ms-v2`、job #28 在 `2026-08-18T14:18:43.498Z` 至 `14:18:45.131Z` 完成，terminal receipt 为 `succeeded`、`40/40`、attempt 1；旧 job #27 保持 `dead` 和 `1/40` checkpoint，没有被重置。回填后新投影为 13 个 stack、79 条 repository-stack facts、25 个 source repositories、379 条 packages evidence。

graph job #9 从 `2026-08-18T14:20:25.255Z` 运行到 `15:31:09.406Z`，attempt 1 成功，result 为 `similarityEdges=40`、`dependencyEdges=93`、`pooledRepos=40`、`sbomBackfilled=0`。Worker 日志给出 shadow 一致，数据库结构化复核为：

- new projection：13 stacks、79 relations、25 source repositories、379 packages；
- legacy stack projection：79 edges、25 source repositories、379 packages；
- repositories：40 real + 13 reference；watches：40 real + 13 reference；
- stacks：`actix-web, axum, express, fastapi, flask, nextjs, nuxt, react, react-native, svelte, tauri, vite, vue`；
- legacy API graph：62 nodes（40 repo、13 reference、9 language）与 173 edges（93 dependency、40 similarity、40 written_in）。Phase A 仍返回 legacy contract，这是计划内行为。

认证 MCP dogfood 返回 health `ok`，`devscope_list_repositories(limit=100)` 精确返回 40 个真实仓库，没有泄漏 13 个 reference rows。上述计数是本次生产 receipt，不是长期常量。

## 生产暴露的后续 P1

graph job #9 共耗时约 70 分 44 秒。生产 40 个真实仓库当时包含 19007 个唯一 SBOM package/version，首次运行补齐约 6000 个 deps.dev cache miss；3053 个外部 GitHub target 达到 canonicalization 门槛并被串行请求。`resolveViaDepsDev` 和 `GitHubClient.getCanonicalFullName` 缺少完整 timeout/budget 边界，canonical freshness 未持久化，graph status 也没有 stage progress。

该问题没有破坏本次 shadow correctness，但属于进入 Phase B 前必须处理的 P1。唯一执行计划为 [依赖解析缓存恢复与外呼预算计划](../data-correctness-4-deps-cache-recovery/plan.md)；不得在本文件维护第二套方案。

## Phase A closeout 复核（2026-08-19）

前置 Hard Stop `data-correctness-4-deps-cache-recovery` 已于同日完成生产 closeout（PR #39 + 迁移 0009 + 冷/暖 rebuild），本项复核在其之后读取生产即时状态：

- 生产 HEAD `916bc66`（含 Phase A 代码 + deps-cache 修复）；迁移账本 10 条（0000-0009）；
- 宿主 `.env` 未设 `TECHNOLOGY_STACK_STORAGE_MODE`，compose 以 `${VAR:-legacy_shadow_dual_write}` fallback 显式注入容器，生效模式 `legacy_shadow_dual_write` 未被切换；
- backfill receipt：job #28 `succeeded`（terminal，未复用/重置），job #27 保持 `dead`；
- graph receipt：job #9 `succeeded`（attempt 1，dependencyEdges 93 / similarityEdges 40，含 stages/budget/counters 结果结构）；
- **new/legacy 投影零差异（SQL 独立复核）**：按 (github_repository_id, slug) 聚合、packages 排序签名双向 EXCEPT 均为 0 diff（79 行对 79 行；379/379 packages evidence；25/25 distinct sources）。注：直接文本比较存在 39 行数组顺序差异（写入端聚合顺序不同），sorted 语义（与 shadow compare 实现一致）下为零差异；
- 数据不变量：真实仓库 40、reference 13、watched 53、dependency 93、similarity 40、technology_stacks 13、chunks 34599；
- 无 active job、无过期 lease；服务健康与访问控制证据沿用同日同 revision 的验证（API/Web 200、公网 401、Keychain 认证 health ok、认证列表 40 个真实仓库零伪行）。

## Phase A closeout verdict（2026-08-19）

独立 closeout reviewer（fresh context，全程只读）重算了全部证据：PR/deploy SHA 祖先关系、迁移账本、mode fallback 链、backfill/graph receipts、投影零差异（采用保留 multiplicity 的排序签名，双向 EXCEPT 为 0）、Hard Stop 数据在位、无 active/过期 lease、服务健康。Verdict：`APPROVE`，无 P0-P2；3 条 P3 为记录措辞与跨文件时间线说明（P3-1 措辞已随批修正；graph job #9 的时间戳差异源于前置 item 的授权重跑，幂等全量重建后零差异已再次确认）。本 verdict 不授权 Phase B；`data-quality-5-postgres-integration-gates` 仍为其前置。
