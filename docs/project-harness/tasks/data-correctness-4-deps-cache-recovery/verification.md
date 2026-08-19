# Implementation Verification：data-correctness-4-deps-cache-recovery

> 记录日期：2026-08-19（UTC）
> 分支：`codex/deps-cache-recovery`（base `main@8868246`）
> 状态：实现完成，待独立 implementation review 与 PR/CI

## 实现范围

- `packages/db/src/deps-cache.ts`（新增）：三态 resolution（`resolved/not_found/error`）、`retry_after` 语义、响应分类（deps.dev/GitHub canonicalization）、缓存行解释、`ExternalRequestBudget`（按 provider 分列、耗尽抛 `GraphBudgetExceededError`）、`runBoundedPool`（并发上限 + pacing + 错误停止调度）、429 `GraphRateLimitedError`、`GraphLeaseLostError`、真实 `fetchDepsDevOutcome`（AbortSignal timeout + Retry-After 解析）、upsert/rename 回写 helpers、`resolveExternalResolutionSettings`（13 个环境变量、越界 fail closed）。
- `packages/db/src/schema/index.ts`：`package_repo_mappings` 增加 `resolution_status`（enum，DEFAULT `'error'`）/`retry_after`/`last_error`/`last_resolved_repo` + CHECK `resolved ⟺ source_repo IS NOT NULL`；新表 `github_repo_name_canonicalizations`（不套用同款 CHECK）；`jobs.progress` jsonb。
- `packages/db/drizzle/0009_damp_captain_america.sql`：显式迁移 + 确定性回填（非 null → `resolved` + 30 天复查点；null → `error` + 15 分钟退避）+ CHECK。回填放在 ADD COLUMN 与 ADD CHECK 之间；重放不漂移。
- `packages/db/src/repo-graph.ts`：`recomputeDependencyEdges` 重构为「唯一 key 去重 → 缓存分类 → 有界并发解析（预算/429 fail closed，receipt 立即落库）→ canonicalization freshness（持久化 + rename 批量回写）→ assertLease 后原子提交」；`rebuildRepoGraph` 编排 embedding → sbom → similarity → deps（SBOM 外呼计入 GitHub 预算；预算耗尽时零图写入）、stage duration、budget/counters 快照；`backfillRepoEmbeddings`/`backfillSbomPackages` 接入进度与预算。
- `packages/db/src/jobs.ts`：`updateJobProgress`（`WHERE id+lease_owner+running+lease_expires_at>now` 条件 UPDATE）、`assertJobLease`、`createJobProgressSink`（节流 + 丢租约抛 `GraphLeaseLostError`）。
- `packages/shared`：`graphRebuildStageSchema`（含 `similarity`/`shadow_compare`）、`graphRebuildProgressSchema`、result schema 可选扩展；`GitHubClient.getCanonicalFullNameDetailed`（timeout + 原始结果，不在 client 内分类）+ `getCanonicalFullName` 补 timeout。
- `apps/worker`：启动即校验外呼配置（fail closed）；GRAPH job 传 `jobId/workerId`；`defaultRebuildGraph` 组装 settings/sink/assertLease + shadow_compare 阶段进度。
- `apps/api/src/router/graph.ts`：status 增加 `progress`（safeParse，损坏行降级 null）。
- `.env.example`/`runbook.md`：13 个配置项 + 预算/终态重启运维说明。

## 关键设计决策（偏离或细化 plan 处）

1. similarity 阶段移到 SBOM 之后：预算在 SBOM 阶段耗尽时保证任何图关系零写入（plan 的 fail closed 语义按最严格解释执行）；stage 枚举不变。
2. 429 → 写入带 Retry-After 的 receipt 后整个 attempt fail closed（job 60s 重试），而不是降级继续：与预算语义一致，避免半份图。
3. `resolved` 复查失败降级为「移动」旧值到 `last_resolved_repo`（CHECK 数据库强制），本轮按无映射。
4. 迁移回填给 resolved 行补 30 天复查点（集成测试发现：否则 12669 个迁移行立即变 due，warm rebuild 失效）。

## 验证证据

- `packages/db` 单元测试：206 passed（含 `deps-cache.test.ts` 41 个、`repo-graph.test.ts` 49 个，覆盖分类/TTL/预算/429/并发/降级/rename/lost-lease/进度）。
- `apps/worker`：9 passed（含 context 传递、非法配置启动失败）。
- `apps/api`：13 passed（含 progress 透传与损坏降级）。
- 隔离 PostgreSQL 16 + pgvector（一次性容器 `devscope-deps-test-pg`，localhost:5433）从 `0000` 应用全部 10 条迁移后：`deps-cache.integration.test.ts` 9 passed（CHECK/DEFAULT、回填重放不漂移、迁移文件 pin、TTL 转移、预算 fail/retry 续跑、canonicalization freshness warm 零外呼、rename 回写保状态、`jobs.progress` lease-authoritative、降级证据、zero-diff）。
- 既有集成测试回归：`technology-stack-entities` 14 + `collection` 10（与新增 9 个串行跑同一库，33/33；注意三个集成文件不能并发跑同一 TEST_DATABASE_URL，属既有行为，data-quality-5 处理）。
- 全仓门禁：`pnpm lint` ✓、`pnpm typecheck`（14/14 tasks）✓、`pnpm test`（11/11 tasks）✓、`pnpm build`（9/9 tasks）✓、`pnpm db:generate` 再生成无差异 ✓、`git diff --check` ✓。

## Implementation Review 处置（2026-08-19）

第一轮 implementation review verdict 为 `changes_requested`（evt-20260819T024101Z-ed5c6734），全部 findings 已修复：

- **P1 canonicalization 降级擦除旧 canonical 值**：`upsertCanonicalizationOutcome` 增加 `previousCanonicalFullName`，error/not_found 降级保留旧值证据（与 deps.dev 侧 `last_resolved_repo` 对称）；新增单测固定。
- **P2 429 Retry-After 跨 attempt**：Worker 捕获 `GraphRateLimitedError` 时以 `max(retryDelayMs, retryAfterSeconds*1000)` 传给 `failJob`；新增单测（部分 mock `@devscope/db` 的队列函数）。
- **P2 lease 复核入事务**：`assertJobLease` 改为 `SELECT ... FOR UPDATE`；graph 事务首句用事务执行器再次复核（对齐 technology-stack-entities 先例），新增"事务外+事务内各一次"断言。
- **P2 回滚窗口说明**：runbook 记录迁移 0009 后应用层回滚期间旧镜像写非空 `source_repo` 会违反 CHECK 使 graph job 失败、重新升级自愈。
- **P2 真实 HTTP 层测试**：新增 `deps-cache.http.test.ts`（本地 http server：200/空数组/404/429+Retry-After/5xx/非法 JSON/挂起超时/连接拒绝）+ `parseRetryAfterSeconds` 单测；`fetchDepsDevOutcome` 增加仅供测试的 `baseUrl` 注入参数，生产默认不变。
- **P3 relatedProjects 缺失 → error**（schema 漂移不伪造阴性，空数组才是明确无映射）；**json 读体中止 → timeout 口径**；**stage duration 细分**（deps_resolution 只计解析池、github_canonicalization/atomic_commit 独立计时、shadow_compare 真实时长）；**预算口径与 similarity 顺序**写入 runbook。

修复后重跑：db 单测 101（deps-cache 41 + http 9 + repo-graph 51）、worker 18、api 全套；隔离 PostgreSQL 串行 33/33；全仓 lint/typecheck(14)/test(11)/build(9) 通过。

## 未验证项

- 生产部署、生产 rebuild（冷/暖两次）、MCP/生产健康检查：按 plan 属 PR/CI 后的生产门禁，需用户显式授权后执行。
- CI 中的集成测试仍跳过（无 TEST_DATABASE_URL），由 `data-quality-5-postgres-integration-gates` 解决。

## Continuity 复核（第二轮，approved）

- Verdict：`approved`（evt 见 events.jsonl）；10 条 findings 全部 closed，无 P0–P2 新发现。
- 遗留 P3：(a) 事务内 assertLease 的真实 PG 用例已补（见下）；(b) 连接拒绝用例端口假设已改为 listen-then-close；(c) 计数笔误已修正；(d) 集成 fixture 撞唯一约束的既有脆弱性移交 `data-quality-5-postgres-integration-gates`。
- 第二轮后补充：集成测试新增「事务内 FOR UPDATE 租约复核拒绝 lost-lease 提交」用例（真实 PostgreSQL）。

## 生产验收（2026-08-19，已获用户授权）

### Preflight（只读）

- 服务器 worktree 干净，HEAD `3fa0d9c`；容器 api/web/worker/postgres/nginx 全部健康；
- 无 active graph/backfill job；无长事务；备份目录 29G 可用；
- 迁移账本 9 条（0000-0008）；缓存基线 19282 行（598 null）；
- 生产未设 `TECHNOLOGY_STACK_STORAGE_MODE`，默认即 `legacy_shadow_dual_write`，mode 不变。

### 部署与迁移

- Deploy workflow run `32211735473`（main@916bc66，`apply_database_migration=true`）build+deploy 均 success；
- 迁移前备份 `/home/devscope/backups/devscope/pre-migration-20260819-112522.dump`（127MB，权限 600；`pg_restore --list` 可读，20 张表 TABLE DATA 完整）；
- 迁移账本 10 条；`0009` journal hash `b8496c01…` 与仓库文件 SHA-256 一致；
- 回填结果：`resolved` 18684（全部带 30 天复查点）+ `error` 598（全部带 15 分钟退避）= 19282，与基线逐行对账；
- CHECK 约束、`github_repo_name_canonicalizations` 表、`jobs.progress` 列均存在；
- 部署后 api/web 容器重建（nginx/postgres 未动），Worker 日志零 error。

### 冷 rebuild（job #9 restart，attempt 1）

- 运行 03:30:37–03:40:25 UTC，**588 秒**（对照 2026-08-18 同规模串行基线约 70 分钟）；
- 计数：cacheHits 19005 / cacheMisses 3056 / externalRequests 3061 / timeouts 0 / retryableErrors 0；
- 预算：github 3054/6000、depsDev 7/10000——单次 attempt 收敛；
- 阶段时长：embedding 1.9s、sbom 2.9s、similarity 57ms、deps_resolution 1.5s、github_canonicalization 577.7s（3049 个 target 全量首查）、atomic_commit 0.6s、shadow_compare 129ms；
- job `succeeded` 即 legacy/新表技术栈投影 shadow compare equal。

### Warm rebuild（同日 03:49–03:51）

- **88 秒**；cacheHits 21307 / externalRequests 721 / timeouts 0；
- 预算：github 132/6000、depsDev 589/10000；
- 剩余外呼全部可解释：598 个迁移期 `error` 行到期重试（depsDev 589）——其中 589 个转权威 `not_found`（证明历史 null 行多数是真阴性）、9 个仍为可重试 error；github 132 中约 127 为 canonicalization 到期/新行复查（按 checked_at 窗口核对），其余约 5 次为 SBOM 阶段计入 GitHub 预算的请求（sbomBackfilled=0 但该阶段有 2.66s 时长）；
- 缓存终态：`package_repo_mappings` resolved 18691 + not_found 589 + error 9；`github_repo_name_canonicalizations` resolved 3157 + not_found 19。

### 数据不变量（gate 6）

真实仓库 40、reference 13、watched 53（40 真实 + 13 影子期技术栈）、dependency 边 93、similarity 边 40、`repository_technology_stacks` 79、`technology_stacks` 13、chunks 34599（dogfood 持续采集后的当前值，未使用固定常量）。

### 服务与访问（gate 7）

- 服务器内部 API/Web health 200；公网入口未认证 401（Nginx 80）；
- SSH tunnel → Nginx 未认证 401、Keychain Basic Auth 注入后 `/trpc/health` `status: ok`；
- 认证 `getRepositories`（MCP repository list 等价路径）返回 40 个全部真实 GitHub 仓库、0 个 `tech-stack/` 伪行。

### 未验证项

- 无。生产门禁 1-8 全部完成，等待独立 production closeout review。

## Production closeout（2026-08-19）

- 独立 closeout reviewer（fresh context，全程只读）对 Git/CI/部署 revision/迁移 hash/备份可读性/在线缓存终态/数据不变量/服务健康/计划边界共 18 项做了实测核对，全部与本文档声称一致；
- 三个关键语义在生产数据层直接验证：`not_found` 589 行的 `fetched_at` 全部落在 warm rebuild 外呼窗口（非迁移直转）；9 个残留 error 行全部到期可重试且未被伪造阴性；legacy reference/watches/edges 未被清理、mode 未切换；
- Verdict：`APPROVE`（4 条 P3 记录精度/证据保留建议，无阻塞；P3-2 归因已随批补正）。
