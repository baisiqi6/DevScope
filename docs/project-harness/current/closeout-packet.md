# Closeout Packet

## Subject

- Checklist item: `data-correctness-1a-release-id-bigint`
- Reviewer: `release_id_migration_reviewer`
- Updated at: `2026-08-18`
- Canonical plan path: `docs/project-harness/tasks/data-correctness-1a-release-id-bigint/plan.md`

## Item Snapshot

- Title: 将 GitHub Release ID 迁移为无损 bigint
- Status: doing
- Workflow status: closeout_requested
- Priority: p0
- Owner: codex
- Session: codex-20260817-release-id-bigint
- Dependencies: None

## Acceptance

遵循 domain-model.md 的 Release ID 约束完成显式迁移与回归覆盖；以生产迁移前即时记录的 Release 行集为基线，ID、行数和归属保持一致，超过 int4 上限的 ID 可无损写入、读取和经 API 返回。

## Verification

本地实现、迁移锁演练与全仓门禁通过；独立 correctness review APPROVE；PR #27 / main@2b18ebf 已部署，生产备份与在线库 191 条有序 (id, repo_id) 行集哈希一致，服务健康与认证边界通过。详见 verification.md。

## Handoff

生产 acceptance 已完成；等待 release_id_migration_reviewer 独立 closeout verdict，批准后由 Harness mark-done。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
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
8. 在单独授权后完成生产备份、迁移、数据一致性核验与访问控制抽查，再更新 checklist、progress 和 handoff。

## Verification

- RED/GREEN regression：超过 `2147483647` 的 GitHub Release ID；
- PostgreSQL：空库迁移、历史 fixture、迁移前后 `min/max/count` 和归属比对；
- Focused tests：DB collector/schema/API ID contract；
- Full gates：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- Review：独立 reviewer 明确给出 `approved | changes_requested | blocked`；
- Production：PR #27 与 workflow run 32112032164 已成功；迁移前备份和在线库的 191 条有序 `(id, repo_id)` 行集哈希一致，服务健康及认证边界通过。

## Exit Criteria

- 所有 acceptance 均有可定位证据；
- 显式迁移和回滚策略经过 review；
- checklist 只在 review approved 且验证落盘后标记 `done`；
- 没有把其他整改项顺带并入本任务。

## Handoff

若本轮未完成，下一 session 从最后一个已记录 verification artifact 继续；先重新运行 Harness 校验并确认 lease，没有有效 lease 时不得假定仍由旧 session 持有任务。

当前实现、本地演练与生产验收证据见 [verification.md](verification.md)。本 item 等待独立 closeout review 后关闭。
```

## Recent Progress Context

```md
# DevScope Harness 进展

> 更新时间：2026-08-18
> 基线：`main@2b18ebf`
> 部署形态：Standalone
> 当前状态：首个数据 Correctness item 已完成生产验收，等待独立 closeout review

## 已完成

- 完成项目、文档、源码、测试和生产数据库的只读基线审计；
- 将项目范围、架构、数据模型、运行手册、任务状态和 task plan 拆成唯一事实来源；
- 建立高风险数据整改 checklist 和第一个 Release ID 任务计划；
- 保持 Agent/MCP 接口指南为独立接口文档，通过 Harness 单向引用。
- 完成 `releases.id` 的 Drizzle `bigint` 映射、无损采集边界、十进制字符串 API 契约和显式迁移；
- 删除 tag hash 伪 Release 降级，在本地 PostgreSQL 完成 188 条历史 fixture 升级与大 ID 往返演练；
- focused tests、全仓 lint/typecheck/test/build 与迁移再生成检查全部通过。
- 独立 reviewer 首轮提出 JavaScript safe integer 与迁移锁门禁问题；修订后 continuity 复核为 `APPROVE`。
- PR #27 已通过 CI 并合并，手动部署 workflow run 32112032164 已完成生产备份、显式迁移和应用发布；
- 生产 `releases.id` 已变为 `bigint`，迁移前备份与在线库 191 条有序 `(id, repo_id)` 行集哈希一致；
- 生产 API/Web/Worker/PostgreSQL/Nginx 健康，未认证访问为 401，Keychain + SSH tunnel 的认证 health 为 `ok`。

## 已验证基线

2026-08-17 对 `main@b64d6a0` 与生产 PostgreSQL 完成只读检查：

- PostgreSQL 16.13，`vector` 0.8.2；
- `0000`–`0005` 六条迁移的 SHA-256 与生产迁移历史逐条一致；
- 1 个用户、20 个真实仓库、10 个技术栈 reference rows；
- 19173 个 chunks 全部含有 1024 维 embedding；
- 未发现重复 chunk key、workflow 用户错配、图自环、非法计数或 Trending 数量错配；
- DB 包 8 个测试文件、101 个单元测试通过，typecheck 通过；
- 现有持久化测试主要 mock Drizzle query builder，尚无真实 PostgreSQL 集成测试。

这些是日期化证据，不是永久不变的产品声明。需要依赖生产现状时必须重新验证。

## 当前 handoff

- 当前 item：`data-correctness-1a-release-id-bigint`；
- Canonical plan：`tasks/data-correctness-1a-release-id-bigint/plan.md`；
- Verification：`tasks/data-correctness-1a-release-id-bigint/verification.md`；
- 独立 correctness/迁移 review 已批准，生产验收已完成并落盘；
- 下一步只进行独立 closeout review；批准后通过 Harness 状态机标记 `done`，再选择下一个整改 item。

## Harness 初始化验证

- EXharness checklist semantic validator：通过，0 warnings；
- `harness-checklist.json` 与 `harness-config.json` JSON 解析：通过；
- 10 个 Markdown 文件的本地链接目标检查：通过；
- 旧文档路径残留检查与 `git diff --check`：通过；
- `pnpm lint`：通过，保留 16 个既有前端 warnings；
- `pnpm typecheck`、`pnpm test`、`pnpm build`：通过。

## 未关闭风险

风险定义与目标设计见 [domain-model.md](domain-model.md)，当前状态和依赖见 [harness-checklist.json](harness-checklist.json)。本文件不重复维护风险表。

## 更新规则

- 只记录日期化验证摘要、完成结果和下一 handoff；
- 稳定设计变化写入对应规范，不在此复制；
- item 状态只通过 checklist 更新；
- 详细执行轨迹、review 和 receipt 写入对应 task 目录；
- 历史细节由 Git 保存，不把本文件写成逐命令流水账。
```

## Current Review Content

```md
# 独立审查结论

- Item：`data-correctness-1a-release-id-bigint`
- Reviewer：`release_id_migration_reviewer`
- Context mode：`limited-fresh`
- 日期：2026-08-18
- 首轮 Verdict：`CHANGES_REQUESTED`

## P1：采集边界仍先把 Release ID 收窄为 JavaScript `number`

### Evidence

- `GitHubRelease.id` 和 Octokit response 当前仍使用 `number`；
- JSON 中的 `9007199254740993` 会被 Node 解析为 `9007199254740992`，但同一响应的 Release API URL 仍保留精确十进制 ID；
- pipeline 当前在 `insertReleases()` 校验 ID 之前删除旧 Releases。

### Impact

PostgreSQL `bigint` 范围内但超过 `Number.MAX_SAFE_INTEGER` 的合法 ID 无法全链路无损；转换失败时还可能在后续原子替换整改完成前留下空数据。

### Minimal correction

- 从正式 Release API URL 严格提取十进制 ID，使 `GitHubRelease.id` 保持 `string`；
- 在删除旧 Releases 之前完成全部 ID 范围校验；
- 增加超过 safe integer、PostgreSQL bigint 上限和越界不删除旧数据的回归测试。

## P2：迁移演练缺少锁影响、执行时间和失败回滚证据

### Evidence

`integer → bigint` 的 `ALTER COLUMN TYPE` 需要表重写和 `ACCESS EXCLUSIVE` lock。当前验证记录没有冲突事务、`lock_timeout`、实际耗时或失败回滚结果；部署流程会在旧应用仍运行时执行迁移。

### Impact

持有冲突锁的长事务可能令迁移无限等待，并让后续 Releases 请求排队。现有证据不足以证明生产迁移行为有界。

### Minimal correction

- 在隔离 PostgreSQL 中持有冲突事务，记录有界失败、释放后的成功耗时和事务回滚；
- 为生产迁移增加明确 `lock_timeout` 和 fail-closed 操作说明，或在迁移窗口暂停相关应用连接；
- 同步更新 runbook 与 verification。

## 已独立核验

- focused DB tests：2 files / 15 tests 通过；
- API router tests：1 file / 34 tests 通过；
- `pnpm lint` 与 `pnpm typecheck` 通过；
- migration snapshot 只包含 `releases.id: integer → bigint`，journal 链接正确；
- tRPC ID 字符串契约与当前 Web 调用方兼容；
- tag hash fallback 已移除；成功空结果清理和整体原子替换仍属于后续 item；
- 未连接生产、未编辑文件、未 commit、未 push、未部署。

## Context mode 说明

采用 `limited-fresh`：reviewer 只读取完成判断所需的目标、canonical plan、non-goals、真实 diff 和证据，不继承此前自我判断或旧 verdict。

## Operator 修订响应

2026-08-18 已完成两项最小修正：

- P1：Release ID 改由 API URL 提取为十进制字符串，pipeline 在删除旧数据前完成 `bigint` 转换；增加 safe integer、bigint 上限和不删除旧数据测试；
- P2：部署迁移进程增加 `5s lock_timeout`；隔离 PostgreSQL 已验证锁冲突在 0.34 秒内失败且完整回滚，释放锁后迁移在 0.11 秒内成功。

修订证据已追加到 `tasks/data-correctness-1a-release-id-bigint/verification.md`，等待同一 reviewer 以 continuity 模式复核；此处保留首轮 verdict，不由 Operator 自行改写为批准。

## Continuity 复核

- Reviewer：`release_id_migration_reviewer`
- 日期：2026-08-18
- Final verdict：`APPROVE`

Reviewer 重新读取当前代码、diff 和证据后确认：

- P1 已关闭：URL 十进制 ID、`number|string|bigint` 边界与删除前校验一致，3 files / 53 focused tests 及 DB/API typecheck 通过；
- P2 已关闭：生产迁移具备 `5s lock_timeout`，锁冲突 fail-closed、失败回滚、成功耗时和 bigint 最大值往返证据齐全；
- 未发现新的阻塞问题；
- 生产仍为 `UNVERIFIED`，批准不授予迁移或部署权限。

采用 continuity 是因为本轮仅验证同一 reviewer 上轮两个明确 finding 的局部修订，同时仍重新核对了最新事实。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
