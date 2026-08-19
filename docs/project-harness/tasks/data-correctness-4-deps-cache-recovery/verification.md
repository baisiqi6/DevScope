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
