# GitHub Release ID bigint 迁移计划

## Item

- Checklist item：`data-correctness-1a-release-id-bigint`
- Owner：`codex`
- Session：`codex-20260817-release-id-bigint`
- Updated at：2026-08-18
- Mode：`high-risk`

## Goal

消除 `releases.id` 的 signed `int4` 容量风险，使 GitHub Release ID 从采集、转换、数据库、查询到 API 输出全链路无损，同时保持现有数据和调用方兼容。

## In Scope

- 核对 Drizzle schema、迁移历史、GitHub Release 转换和 API/shared schema 中的 ID 类型；
- 先增加超过 `2147483647` 的失败复现和回归测试；
- 生成并审查显式 PostgreSQL 迁移，将目标列扩大为 `bigint`；
- 删除会截断、哈希或静默改变合法 GitHub ID 的降级逻辑；
- 在隔离 PostgreSQL 上演练空库迁移和含历史数据升级；
- 记录迁移前后 `min/max/count`、仓库归属与 API 表现；
- 完成本地质量门禁和独立 review。

## Out Of Scope

- 不同时实现 repository stable ID；
- 不修改 chunks、Hacker News 或 Releases 的整体替换事务；
- 不迁移技术栈实体或 deps.dev 缓存；
- 不建立公开多用户鉴权；
- 未获得单独授权时不连接或修改生产数据库，不部署、不 push。

## Acceptance Mapping

- Checklist acceptance：以生产迁移前即时记录的 Release 行集为基线，ID、行数和归属保持一致，超过 int4 上限的 ID 可无损写入、读取和经 API 返回；
- 设计来源：[domain-model.md 的 GitHub Release ID 约束](../../domain-model.md#1a-github-release-id)；
- 操作门禁：[runbook.md 的数据迁移门禁](../../runbook.md#数据迁移门禁)。

## Boundary Review

- `releases.id` 表示外部 GitHub identity，不生成内部替代 ID；
- TypeScript `number` 只在能证明全链路不超过安全整数时使用，否则通过明确的 string/bigint 边界传输；
- 迁移 SQL 不访问外网，不把网络调用放进数据库事务；
- 不用 `db:push` 代替显式迁移；
- 不以 HTTP 200 或单元测试通过代替数据一致性验证。

## Steps

1. 重新检查工作树、schema、迁移、转换函数、共享/API schema 和相关测试，记录当前 ID 类型链路。
2. 增加 int4 上限以上的 RED 测试，覆盖采集转换、数据库往返和 API 序列化边界。
3. 选择最小的无损 Drizzle/TypeScript 表示并更新 schema 与转换逻辑。
4. 运行 `pnpm db:generate`，逐行审查生成的迁移，确认只扩大目标列且无隐式重建或数据丢失。
5. 在隔离 PostgreSQL 中验证空库迁移、历史 fixture 升级、大 ID 往返与失败回滚。
6. 运行 focused tests，再运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
7. 生成 review packet，进行独立 correctness/迁移审查；修正后记录 verdict 和验证证据。
8. 更新 checklist、progress 和 handoff。生产演练与部署仍作为单独授权动作。

## Verification

- RED/GREEN regression：超过 `2147483647` 的 GitHub Release ID；
- PostgreSQL：空库迁移、历史 fixture、迁移前后 `min/max/count` 和归属比对；
- Focused tests：DB collector/schema/API ID contract；
- Full gates：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- Review：独立 reviewer 明确给出 `approved | changes_requested | blocked`；
- Production：未授权，当前保持 `UNVERIFIED`。

## Exit Criteria

- 所有 acceptance 均有可定位证据；
- 显式迁移和回滚策略经过 review；
- checklist 只在 review approved 且验证落盘后标记 `done`；
- 没有把其他整改项顺带并入本任务。

## Handoff

若本轮未完成，下一 session 从最后一个已记录 verification artifact 继续；先重新运行 Harness 校验并确认 lease，没有有效 lease 时不得假定仍由旧 session 持有任务。

当前实现与验证证据见 [verification.md](verification.md)。生产数据库仍未连接或修改。
