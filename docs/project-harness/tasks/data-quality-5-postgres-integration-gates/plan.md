# 真实 PostgreSQL 迁移、事务与并发持续门禁

## Item

- Checklist item：`data-quality-5-postgres-integration-gates`
- Priority：P0
- 前置：Phase A closeout、deps.dev cache recovery closeout

## Outcome

把现有按任务临时运行的 PostgreSQL integration scripts/tests 收敛为一个开发机与 CI 共用的 `pnpm test:integration` 门禁。它使用隔离的 PostgreSQL 16 + pgvector，覆盖真实 migration、constraint、transaction、advisory lock、lease 和双连接强制交错；任何时候都不能连接开发库或生产库。

## Current Gap

- `packages/db/src/collection.integration.test.ts` 与 `technology-stack-entities.integration.test.ts` 已证明真实数据库用例有价值，但仍是分散资产；
- `.github/workflows/ci.yml` 目前没有 PostgreSQL service，也没有正式 `test:integration` step；
- 大量快速测试 mock Drizzle builder，无法证明 DDL、partial index、JSONB、timestamp precision、`FOR UPDATE SKIP LOCKED`、rollback 和 advisory-lock 行为；
- 本 item 不重写现有测试框架，只把成熟 fixture、runner 和 CI 生命周期规范化。

## Isolation Contract

- 默认使用 `pgvector/pgvector:pg16`，与项目开发/生产大版本一致；
- runner 每次生成唯一 database name 或临时容器，禁止使用 `devscope`、`postgres` 业务库名作为测试目标；
- 只有显式的 `TEST_DATABASE_URL` 可启用 integration tests；host/database allowlist、`NODE_ENV=test` 与 destructive sentinel 任一不满足即拒绝运行；
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

至少覆盖：

1. 空库从 `0000` 顺序迁移到最新，pgvector extension 与 migration metadata 一致；
2. 从含历史 fixture 的 `0004` baseline 升级到最新；
3. migration 重跑幂等边界和 checksum/order drift 检测；
4. Release bigint、repository stable ID、atomic replacement、technology-stack expand、deps-cache migration 的数据前后摘要；
5. Phase C 实现后追加 cleanup 与 restore rehearsal；未实现的未来 migration 不在本 item 伪造测试。

### 3. Transaction and concurrency matrix

- Release ID 超过 signed int4 上限的无损往返；
- repository rename/transfer、冲突合并与唯一索引；
- chunks/HN/releases 的 failure 保旧、`success([])` 清旧、插入失败 rollback；
- collection-vs-collection、collection-vs-graph 的 stable-ID advisory lock 强制交错；
- technology-stack per-source atomic replacement、backfill checkpoint、lost lease 零写入；
- deps.dev `resolved/not_found/error`、TTL/retry_after、预算耗尽后的持久状态；
- jobs 的 `FOR UPDATE SKIP LOCKED`、heartbeat、reclaim、terminal receipt 唯一性；
- 每个竞态用 barrier/lock 明确证明两条事务实际重叠，并设置短 statement/test timeout 防止 CI 挂死。

### 4. CI integration

- 在独立 `integration` job 启动 PostgreSQL service，health check 通过后再运行 migration/tests；
- quality job 保持快速反馈；integration job 与 quality 并行，但二者都作为 PR/`main` 必需门禁；
- 固定 Node/pnpm/PostgreSQL major，不使用未锁定 `latest`；
- test 日志输出 database name、migration range、case 名称和耗时，不输出连接密码；
- failure 时上传脱敏日志，不上传数据库 dump 或业务 fixture 中的秘密；
- 设置 job 和单测试 timeout，cleanup 放在 always-run 路径。

### 5. RED, implementation and review

1. 先证明缺少 `TEST_DATABASE_URL`、危险 database name、单连接伪并发和 migration drift 会 fail closed；
2. 让现有 integration cases 经统一 runner 运行，再补齐矩阵中的缺口；
3. `pnpm test:integration` 连续运行两次，证明无残留状态；
4. 本地/CI 都运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:integration`、`pnpm build`；
5. 独立 Reviewer 检查隔离、强制交错真实性、flakiness、timeout 和 secret handling；
6. PR/CI 全绿后合并，本 item 不需要生产 deploy 或生产数据库写入。

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
