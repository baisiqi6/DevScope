# Implementation Verification：data-quality-5-postgres-integration-gates

> 记录日期：2026-08-19（UTC）
> 分支：`codex/pg-integration-gates`（base `main@0e58c02`）
> 状态：实现完成，待独立 implementation review 与 PR/CI

## 实现范围

- `packages/db/src/test-integration/guard.ts`：隔离门禁（host/database allowlist、`NODE_ENV=test`、`TEST_DATABASE_DESTRUCTIVE=1` 三重契约；`TEST_DATABASE_URL` 只允许 admin 入口 `postgres`，测试库名一律唯一派生 `devscope_test_<12hex>`，显式复用拒绝；结构化 rejected/not-configured/ok，不抛出）。
- `packages/db/src/test-integration/runner.ts`：唯一测试库生命周期（CREATE/DROP WITH FORCE，drop 目标正则 `^devscope_test_[a-z0-9]+$` fail closed）；迁移按 journal 顺序**每文件单事务**应用并手写 `drizzle.__drizzle_migrations`（hash=文件 SHA-256、created_at=journal.when，与生产逐条一致）；`verifyMigrationJournal` 自建 checksum/order/多余行 drift 校验（drizzle migrator 只按 created_at 跳过、不比对 hash，且在 vitest vite-node globalSetup 下静默不可用——本实现绕开它）。
- `packages/db/src/test-integration/global-setup.ts` / `setup-file.ts`：rejected 一律 fail；not-configured 本地 skip、`INTEGRATION_REQUIRED=1`（仅 CI 注入）时 fail；ok 时建库注入 `TEST_DATABASE_URL`（fork 继承）+ `TEST_DATABASE_ADMIN_URL`；teardown 在 always 路径删库。
- `packages/db/vitest.config.ts`（unit，排除 `*.integration.test.ts`）+ `vitest.integration.config.ts`（integration，singleFork 串行 + timeout 30s/120s）。
- scripts：db `test:integration` + root `test:integration`。
- `packages/db/src/migration.integration.test.ts`（3 例）：空库 0000→最新（pgvector/journal/关键表/drift 零）、drift 篡改检测（hash/多余行）、**0003 时点 era baseline 升级**（重复 watch→dedupe 留最新 notes、边回填 userId、0006 int4→bigint 老行保留+2147483648 插入、0007 radar 同 ID 合并 keeper/merge 证据/唯一索引、0009 mappings null→error+15min 与非空→resolved+30d）。
- `packages/db/src/concurrency.integration.test.ts`（6 例）：双连接 `FOR UPDATE SKIP LOCKED` 并发领取不重复、`renewJobLease` owner 边界 + `recoverExpiredJobs` 重领 attempt+1、terminal receipt 部分唯一索引拒绝第二个 active backfill、Release ID 2147483649 经采集边界往返、rename 复用同一行并更新 watch 冗余名、**advisory lock 真实重叠**（A 持 xact 锁、B 在 pg_locks 出现 not-granted advisory 才放行 A——顺带发现并修复 `COLLECTION_ADVISORY_LOCK_NAMESPACE` 未导出导致测试无法对齐锁 key 的问题）。
- `.github/workflows/ci.yml`：新增 `integration` job（pgvector/pgvector:pg16 service + health check、`INTEGRATION_REQUIRED=1`、与 quality 并行；quality 不注入 `TEST_DATABASE_*`）。
- `.env.example` + `runbook.md`：变量语义、本地一次性容器流程、CI 必跑 vs 本地可选、required check 的 operator 操作步骤。

## 与 plan 矩阵的映射

domain-model 七条最低覆盖：空库迁移（migration#1）、0004 升级（migration#3）、Release 大 ID + 改名去重（concurrency#4/#5 + migration#3 的 0007 合并）、替换回滚与并发（既有 collection 10 例 + concurrency#6 barrier）、技术栈回填（既有 stack 14 例）、deps 状态 TTL（既有 deps-cache 10 例）、jobs 租约（concurrency#1/#2/#3）。

## 验证证据

- 单测：guard 10 例（fail-closed 矩阵）全绿；db unit 全量（含 http 9、repo-graph 51 等）通过。
- 集成：**43/43 × 连续 2 次**（34 既有 + 3 迁移矩阵 + 6 并发矩阵），每次运行唯一派生库、结束自动删除、**零残留**（`pg_database` 计数 0）。
- 全仓：lint 13/13、typecheck 14/14、test 11/11（quality 路径不含 integration）、build 9/9。
- plan review 两轮：第一轮 `changes_requested`（P1×3/P2×4）全部修订（baseline 机制、drift 归属、串行隔离、唯一派生库名、矩阵映射表、Files In Scope、CI/本地差异）；第二轮 continuity 结论待记录（见下方追加）。

## 未验证项

- GitHub Actions 的 `integration` job 实际运行（PR 创建后由 CI 验证）；branch protection required check 需 operator 在合并后于仓库设置添加。
