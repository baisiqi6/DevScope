# 真实 PostgreSQL 迁移、事务与并发持续门禁

## Item

- Checklist item：`data-quality-5-postgres-integration-gates`
- Priority：P0
- 前置：Phase A closeout、deps.dev cache recovery closeout（均已 done）
- 状态：plan review 第一轮 `changes_requested`，findings 已修订待复核；现有集成用例 34 个（collection 10 + stack 14 + deps-cache 10）

## Outcome

把现有按任务临时运行的 PostgreSQL integration scripts/tests 收敛为一个开发机与 CI 共用的 `pnpm test:integration` 门禁。它使用隔离的 PostgreSQL 16 + pgvector，覆盖真实 migration、constraint、transaction、advisory lock、lease 和双连接强制交错；任何时候都不能连接开发库或生产库。

## Current Gap

- `packages/db/src/collection.integration.test.ts` 与 `technology-stack-entities.integration.test.ts` 已证明真实数据库用例有价值，但仍是分散资产；
- `.github/workflows/ci.yml` 目前没有 PostgreSQL service，也没有正式 `test:integration` step；
- 大量快速测试 mock Drizzle builder，无法证明 DDL、partial index、JSONB、timestamp precision、`FOR UPDATE SKIP LOCKED`、rollback 和 advisory-lock 行为；
- 本 item 不重写现有测试框架，只把成熟 fixture、runner 和 CI 生命周期规范化。

## Isolation Contract

- 默认使用 `pgvector/pgvector:pg16`，与项目开发/生产大版本一致；
- `TEST_DATABASE_URL` 只允许指向 admin 入口（`postgres` 库）；测试库名一律由 runner 唯一派生（`devscope_test_<random>`）并记录，**不接受显式复用**（防并发冲突与 cleanup 违约）；禁止 `devscope`、`template*` 等业务/系统库名；
- 只有显式的 `TEST_DATABASE_URL` 可启用 integration tests；host/database allowlist、`NODE_ENV=test` 与 `TEST_DATABASE_DESTRUCTIVE=1` sentinel 任一不满足即拒绝运行；not-configured 在本地=skip、在 CI（`INTEGRATION_REQUIRED=1`，仅 integration job 注入）=fail closed；quality job 不注入任何 `TEST_DATABASE_*` 变量；
- 集成文件单进程串行执行（`fileParallelism: false` + singleFork）：多个集成文件共享同一派生库，文件级并发会互相清理数据；unit config 排除 `*.integration.test.ts` 保持 `pnpm test` 快速；
- test setup 只允许删除自己创建并记录的临时 database/schema；cleanup 使用明确目标，不接受通配符或环境变量空值；
- 并发测试必须使用至少两个独立连接，不能用单连接 promise 顺序伪装竞争；
- 外网、真实 GitHub、deps.dev、AI provider 和生产 credentials 一律不参与。

## Execution Plan

### 1. Inventory and canonical runner

- 盘点现有 integration tests、migration runner、Docker Compose、CI 与 package scripts；
- 选择最小公共入口：root `pnpm test:integration` 调用 DB package 的 integration config；
- 复用 Vitest、Drizzle migration 和现有 fixture helper，不引入 Testcontainers 等新框架，除非独立 plan review 证明 CI service 无法满足隔离/并发要求；
- 把连接建立、migration、fixture、强制交错和 cleanup helper 放在 `packages/db`，其他 package 只通过公开 test helper 使用。

### 2. Migration matrix

drizzle migrator 只按 `created_at` 跳过、不比对 hash，且在 vitest vite-node 环境下不可用；因此 runner 自管迁移应用：按 journal 顺序逐文件单事务执行 SQL，并手写 `drizzle.__drizzle_migrations` 行（hash=文件 SHA-256，created_at=journal.when，与生产逐条一致）。至少覆盖：

1. 空库从 `0000` 顺序迁移到最新，pgvector extension 与 migration metadata 一致；
2. **0004 baseline 升级**：`applyMigrationRange(0..3)` 后按 0004 之前的时点形态播种 era fixture（0004 本身执行 dedupe/回填，fixture 必须先于它存在）——重复 `(user_id, repo_id)` 的 watch 行、无 `user_id` 的 repo_relationships 边、接近 int4 上限的 releases 行（0006 前 int4）、重复 `github_repo_id` 的 radar_candidates 行（0007 合并语义）、`source_repo` null 与非空混合的 package_repo_mappings 行（0009 回填）——再 `applyMigrationRange(4..latest)` 续迁，断言 dedupe/回填/类型扩大摘要；
3. **drift 检测由 runner 自建**：`verifyMigrationJournal` 按顺序比对库内 hash 行与本地文件 SHA-256，多余/缺失/不一致即 fail closed；用例覆盖一致通过与篡改检测（临时副本模拟历史文件变更）；
4. Release bigint、repository stable ID、atomic replacement、technology-stack expand、deps-cache migration 的数据前后摘要（即上述 fixture 的断言口径）；
5. Phase C 实现后追加 cleanup 与 restore rehearsal；未实现的未来 migration 不在本 item 伪造测试。

### 3. Transaction and concurrency matrix

复用/新增映射（现有 34 例 = collection 10 + technology-stack 14 + deps-cache 10）：

| 矩阵条目 | 归属 |
|---|---|
| chunks/HN/releases failure 保旧、`success([])` 清旧、rollback | 复用（collection 10 例） |
| technology-stack atomic replacement、backfill checkpoint、lost lease 零写入 | 复用（stack 14 例） |
| deps.dev 三态/TTL/预算 fail-retry | 复用（deps-cache 10 例） |
| collection-vs-collection advisory lock 交错结果 | 复用（既有 Promise.all 用例作结果断言） |
| **barrier 证明两条事务实际重叠**（一事务持锁、另一事务在 pg_locks 中观测到等待） | 新增 |
| **jobs `FOR UPDATE SKIP LOCKED` 双连接**：两条连接同时领取、同 job 只一方成功 | 新增 |
| **renewJobLease / recoverExpiredJobs**（现仅 mock 覆盖） | 新增 |
| **terminal receipt 部分唯一索引**（active singleton） | 新增 |
| **Release ID > 2147483647 无损往返**（现用例未超限） | 新增 |
| **repository rename/transfer 冲突合并与唯一索引**（rename 路径从未集成验证） | 新增 |

每个竞态用例设置短 statement/test timeout 防止 CI 挂死。

### 4. CI integration

- `quality` job 保持现状（不注入 `TEST_DATABASE_*`）；
- 独立 `integration` job：service `pgvector/pgvector:pg16`（固定 major tag；health check 通过后运行），env 注入 `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`、`TEST_DATABASE_DESTRUCTIVE=1`、`NODE_ENV=test`、`INTEGRATION_REQUIRED=1`；
- 两 job 并行且都作为 PR/`main` 必需门禁；**branch protection 的 required check 由 operator 在合并前于 GitHub 仓库设置中添加**（不在 ci.yml 能力内，作为交付步骤记录）；
- 固定 Node 22 / pnpm 9.15.4 / pgvector:pg16；test 日志输出 database name、migration range、case 名与耗时，不输出连接密码；job timeout 20 分钟、单测 timeout 30s、cleanup 在 always 路径（globalSetup teardown）。



### 5. RED, implementation and review

1. 先证明危险 database name、缺 sentinel/NODE_ENV 会 fail closed；缺少 `TEST_DATABASE_URL` 在本地 skip、在 CI（`INTEGRATION_REQUIRED=1`）fail；migration drift 由 `verifyMigrationJournal` 检出；
2. 让现有 integration cases 经统一 runner 运行，再补齐矩阵中的缺口；
3. `pnpm test:integration` 连续运行两次，证明无残留状态；
4. 本地/CI 都运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:integration`、`pnpm build`；
5. 独立 Reviewer 检查隔离、强制交错真实性、flakiness、timeout 和 secret handling；
6. PR/CI 全绿后合并，本 item 不需要生产 deploy 或生产数据库写入。

## Files In Scope

- `packages/db/src/test-integration/`：guard、runner（含 `verifyMigrationJournal`）、global-setup、setup-file 及其单测；
- `packages/db/vitest.config.ts`（unit 排除 integration）、`packages/db/vitest.integration.config.ts`（新）；
- `packages/db/package.json` 与 root `package.json` 的 `test:integration` scripts；
- 新增 `packages/db/src/migration.integration.test.ts`、`packages/db/src/concurrency.integration.test.ts`；
- `.github/workflows/ci.yml`（integration job）；
- `.env.example`（TEST_DATABASE_* 说明）与 [runbook.md](../../runbook.md)（本地 docker pg16 流程、变量语义、CI 必跑 vs 本地可选差异、required check 操作步骤）。

## Local Gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:<port>/postgres \
  TEST_DATABASE_DESTRUCTIVE=1 NODE_ENV=test pnpm test:integration
```

连续运行两次 `test:integration`，断言无残留数据库。

## Handoff Rules For Later Items

- Phase B/C 与后续 schema/transaction 改动必须在同一 PR 增加对应 integration case；
- `test:integration` 失败不能通过 `continue-on-error`、重试掩盖、测试 skip 或 mock 降级绕过；
- 若 CI provider 故障，可记录基础设施 blocker，但不得宣称功能门禁通过；
- 本 item 只建立基线，不把公开多用户/RLS 或性能压测混入。

## Exit Criteria

- root `pnpm test:integration` 在本地隔离库和 CI PostgreSQL service 行为一致；
- migration、transaction、并发、lease 和恢复矩阵真实通过；
- 危险连接与不安全 cleanup fail closed；
- PR 必需检查包含独立 integration job，且现有 quick tests 保持快速；
- 运行两次无残留、无 flaky retry、无 secrets，独立 implementation review approved。
