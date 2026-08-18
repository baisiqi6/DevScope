# Closeout Packet

## Subject

- Checklist item: `data-correctness-1b-repository-identity`
- Reviewer: `release_id_migration_reviewer`
- Updated at: `2026-08-18`
- Canonical plan path: `docs/project-harness/tasks/data-correctness-1b-repository-identity/plan.md`

## Item Snapshot

- Title: 以 GitHub 稳定 ID 统一仓库身份
- Status: doing
- Workflow status: closeout_requested
- Priority: p0
- Owner: codex
- Session: codex-20260818-repository-identity
- Dependencies: None

## Acceptance

同一 GitHub repository ID 在改名或转移前后只对应一个仓库实体和一个用户候选状态；回填与冲突合并可审计，无法确认时 fail closed。

## Verification

PR #29 and clean CI passed; production backup, explicit 0007 migration, Radar dedupe, one-shot job 26 applied 22 IDs with zero unresolved/conflicts, cutover enabled, service/auth/MCP checks passed.

## Handoff

Independent closeout reviewer must verify the plan-to-production evidence before mark-done.

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 以 GitHub 稳定 ID 统一仓库身份

## Item

- Checklist item: `data-correctness-1b-repository-identity`
- Owner: `codex`
- Session: `codex-20260818-repository-identity`
- Updated at: `2026-08-18`

## Goal

同一 GitHub repository ID 在改名或转移前后只对应一个仓库实体和一个用户候选状态；回填与冲突合并可审计，无法确认时 fail closed。

## In Scope

- 为正式 `repositories` 增加可空的 GitHub repository ID，并对非空值建立全局部分唯一索引；
- 将 GitHub repository ID 作为正十进制字符串从采集边界传入，拒绝 unsafe `number`、非正整数和静默截断；
- 将正式仓库 upsert 改为分阶段的 ID 优先、规范化 `fullName` 回退：compatibility 阶段只允许给同名行附加 ID 或更新已知 ID 行，禁止创建新的 ID 行；cutover 后同一 ID 改名时更新原实体和冗余关注名称，不创建第二行；
- 将 Radar 候选 upsert 改为非空 ID 优先、缺失 ID 时按 `(userId, fullName)` 回退，并保留用户已选择的状态；
- 在显式迁移中确定性合并现有 Radar 同 ID 重复：保留最早 `firstSeenAt`、最新 GitHub 名称/证据和唯一非默认用户状态，并把合并来源写入 evidence；存在多个互相冲突的非默认状态时迁移 fail closed；
- 复用现有持久 `jobs` 增加版本化 one-shot repository identity backfill：每次已获准的新运行使用新的 idempotency key，终态行不重置；数据库部分唯一约束保证全局最多一个 active identity backfill，重复触发返回同一 active job；先从 GitHub API 收集并完整校验全部结果，再在同一个短事务中锁定/校验 job lease、写入 repository 更新并保存结构化终态 result；
- 对多个正式仓库行解析为同一 GitHub ID、规范名称已被其他身份占用或并发唯一约束冲突的情况，在任何回填写入前 fail closed，不自动猜测关联数据合并策略；
- 增加本地 PostgreSQL 迁移/历史数据演练、focused tests、全仓门禁、独立 review 和生产备份/迁移/验收。

## Out Of Scope

- 不在本 item 中整改 chunks、Hacker News、Releases 的整体原子替换；
- 不迁移 `tech-stack/*` reference 行为独立技术栈实体，该工作属于 `data-architecture-3-technology-stack-entities`；
- 不重写 workflow report、历史 job payload 或 package mapping 中作为历史证据保存的旧 `fullName`；
- 不为无法从当前 GitHub 权限解析的仓库猜测 ID，也不在 SQL migration 中访问 GitHub；
- 不引入第二套队列、分布式锁或通用 identity framework；
- 不实现公开多用户鉴权。

## Acceptance Mapping

- Current item acceptance: "同一 GitHub repository ID 在改名或转移前后只对应一个仓库实体和一个用户候选状态；回填与冲突合并可审计，无法确认时 fail closed。"
- This plan satisfies it by:
  - 正式仓库和 Radar 都以非空 GitHub ID 为第一身份，`fullName` 只作兼容回退；
  - old-name/new-name 回归测试证明同一 ID 只更新同一行，并保留 Radar 用户状态；
  - 不可重置的 one-shot backfill job result 与 Radar merge evidence 提供审计证据；
  - 所有有歧义的正式仓库冲突在事务写入前停止并报告，不做破坏性自动合并。

## Boundary Review

- Scope non-goals checked：保持当前单用户私有版，不引入公开身份系统；
- Architecture boundaries checked：schema、identity reconciliation 和 job contract 放在 `packages/db`，GitHub 数据获取沿用现有 client/collector，持久执行复用 `apps/worker` 与 `jobs`，API 只提供版本化 one-shot 手动启动/最新状态入口；
- Domain-model decisions checked：遵循 [domain-model.md 的 1B 设计](../../domain-model.md#1b-github-repository-id)，使用 nullable ID、部分唯一索引、双读兼容、外部回填和 fail-closed 冲突策略；
- Potential overlap with other items：Radar 去重只处理稳定身份；正式仓库关联数据的原子替换、技术栈 reference 行和最终 PostgreSQL integration suite 分别留给后续 item；
- Simplicity check：不创建新 audit 表；回填审计复用不可变的 job result，Radar SQL 合并证据复用候选 `evidence`。

## Steps

1. 固化生产只读基线：正式仓库/候选数量、重复 ID、当前 GitHub 可解析和 unresolved 集合、关联表范围。
2. 先增加 RED tests：unsafe repository ID、正式仓库 attach/rename/conflict、Radar 同 ID 改名与状态保持、backfill 全量校验后写入和冲突零写入。
3. 更新 schema、GitHub collector/shared client、compatibility 写路径和 one-shot Worker job contract；compatibility 默认关闭“全新 stable ID 行插入”，生成并逐行审查显式迁移。
4. 在隔离 PostgreSQL 中应用 `0000` 至最新迁移，覆盖已知 Radar 重复、冲突状态 fail closed、部分唯一约束、compatibility 防重复窗口、正式仓库 rename 和 backfill fixture。
5. 运行 focused tests、DB/API/Worker typecheck，再运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
6. 生成 review packet，由独立 reviewer 审查 ID 精度、冲突规则、迁移锁/回滚、job 审计和范围边界；修复所有阻塞 finding。
7. PR/CI 通过并合并后按三个阶段发布：先备份并部署 compatibility/schema；暂停正式仓库采集入口后执行 one-shot backfill；验收所有可解析行与 structured result 后才启用 cutover，并恢复采集。
8. 生产验收 schema/index、仓库/候选行集、用户关注/分组、job result、服务健康和认证边界；每阶段都有独立回滚点，closeout review 批准后由 Harness 标记 `done`。

## Verification

- Repository ID：只接受正十进制字符串或安全正整数，跨 JSON 继续使用 string；
- Repository upsert：同 ID 的旧名/新名同步后保持同一内部 `id`，用户关注关系不丢失且 `repoFullName` 更新；不同 ID 占用同一名称或两个正式行解析为同一 ID时 fail closed；
- Radar：同一 `(userId, githubRepoId)` 改名后只有一个候选，保留用户状态与最早发现时间；缺 ID 时仍按规范化 fullName 工作；
- Backfill：先完成全部 GitHub 读取/校验再写；unresolved 不填假值；conflict 时 0 repository writes，并保存 `outcome: blocked`、updated/unresolved/conflicts；成功保存 `outcome: applied`；
- Job authority：最终 apply 事务必须 `FOR UPDATE` 锁定 job 行，验证 `status=running`、`leaseOwner` 与未过期 lease，再原子写入 repositories 和终态 structured result；apply 前失去 lease 必须 0 writes；
- Job audit：每次运行使用版本化 one-shot idempotency key，既有终态行和 result 不得被后续运行清空或覆盖；API 明确区分 `applied`、`blocked` 与执行失败；
- Job singleton：`jobs.type = repository.identity.backfill` 且状态为 `queued | running | retry_wait` 时，以数据库部分唯一索引保证全局最多一条；并发重复触发只创建/领取一个 active run，返回同一 job；只有前一 run 进入终态后才能显式创建下一版本；
- Migration：历史重复按 `lastSeenAt DESC, updatedAt DESC, id DESC` 选择最新名称/证据；覆盖时间相同 fixture、冲突状态 rollback、repository/Radar/active-backfill 部分唯一索引和锁影响；
- Local commands：focused Vitest、`pnpm db:generate`、迁移 rehearsal、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、Harness validate/doctor。

## Exit Criteria

- acceptance 的每个分支都有测试或 PostgreSQL/生产证据；
- 显式迁移、备份和恢复路径经过独立 review；
- 生产所有可解析正式仓库均写入稳定 ID，unresolved/conflicts 在 job result 中可定位且未被猜测；
- 生产 Radar 不再有非空同 ID 重复，用户状态和时间证据保持；
- 没有把后续原子替换、技术栈实体或公开多用户工作顺带并入；
- 独立 closeout approved 后才允许 Harness `mark-done`。

## Production Cutover

### Stage 1: Compatibility

- 迁移前备份并记录仓库、关注、分组、Radar 与 job 基线；
- 应用 nullable ID、部分唯一索引和 compatibility code；
- compatibility 模式允许按现有 `fullName` 更新/附加 ID，也允许更新已经存在的 stable ID 行，但当 ID 与 fullName 都未命中时拒绝创建新正式仓库，返回明确的 `REPOSITORY_IDENTITY_BACKFILL_REQUIRED`；
- 回滚点：恢复上一镜像；nullable schema 可保留，因为旧代码忽略该列。若迁移自身失败，数据库事务回滚且不部署新应用。

### Stage 2: One-shot Backfill

- 暂停正式仓库采集入口；Radar 发现与只读查询可以继续；
- 手动触发先尝试创建新的版本化 job 行；若已有 active identity backfill，数据库级 singleton 使创建 no-op，并返回现有 active job；不复用或清空任何旧终态行；
- active singleton 是全局而非按用户，因为 `repositories` 是当前共享正式实体表；使用 `jobs.type` 上只覆盖 identity backfill active 状态的部分唯一索引，不影响其他 job 类型；
- Worker 在事务外完成全部 GitHub 请求与规范化，生成 `updated`、`unresolved`、`conflicts` 候选；若 conflicts 非空，不更新 repository，但仍在持有有效 lease 的最终事务中写入 `outcome: blocked`；
- 若无 conflicts，最终事务锁定 job 行并校验 `running`、当前 `leaseOwner` 和 `leaseExpiresAt > now`，随后更新 repositories/冗余关注名称并把 `outcome: applied` result 与 job 终态一起提交；失去 lease 时整个事务回滚；
- unresolved 行保持 null 与 fullName 兼容路径。它们不会被猜测或自动跨改名合并；后续变为可解析时可通过新的 one-shot job 安全附加 ID。若其名称发生变化且无法证明与旧行相同，按 conflict 处理而不是自动合并。
- 回滚点：apply 前无数据库 mutation；blocked outcome 只新增审计 job result。applied 后如验收失败，使用部署前 custom-format 备份恢复。

### Stage 3: Cutover

- 只有最新 backfill outcome 为 `applied`、conflicts 为空、所有当前可解析行均已带 ID且部分唯一索引通过时，才显式启用新 stable ID 行插入；
- cutover 后恢复正式仓库采集。同一已知 ID 的 rename/transfer 更新既有内部行；缺 ID 数据源继续按规范化 fullName 回退；
- 回滚点：先重新关闭新 ID 行插入并暂停采集，再恢复上一镜像；若已写入仅新版本可识别的数据且需要回退，使用 Stage 1 备份恢复，不做临时破坏性 down migration。

## Handoff

- 若本轮未完成，下一 session 先运行 Harness session init，确认本 item 的 owner/lease 和 branch，再从本计划最后一项已有 verification 继续；不得跳过 unresolved/conflict 清单直接执行生产写入。
```

## Recent Progress Context

```md
# DevScope Harness 进展

> 更新时间：2026-08-18
> 基线：`main@647dc62`
> 部署形态：Standalone
> 当前状态：Release ID item 已关闭；Repository stable identity 已完成生产三阶段上线，等待 closeout review

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
- 独立 closeout reviewer 再次核对 Git、Actions、两份备份、在线数据库和服务证据后给出 `APPROVE`；Harness 已将 item 标记为 `done`。
- PR #29 已通过修订后的干净 CI 并合并，手动部署 workflow run 32121157975 完成生产备份、显式 `0007` 迁移和 compatibility 发布；
- 生产 Radar 重复组从 1 降为 0；one-shot job 26 以 `applied` 终态为 22 个真实 GitHub 仓库回填稳定 ID，`unresolved=0`、`conflicts=0`；
- 10 个 `tech-stack/*` reference rows 保持无 GitHub ID，正式仓库 ID、关注名称、分组成员和 Radar 不变量复核通过；
- `REPOSITORY_IDENTITY_CUTOVER=enabled` 已只在 API 生效，生产 API/Web/Worker、Nginx 访问控制及 Keychain + SSH tunnel MCP health 均验证通过。

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

- 最近完成 item：`data-correctness-1a-release-id-bigint`；
- Canonical plan：`tasks/data-correctness-1a-release-id-bigint/plan.md`；
- Verification：`tasks/data-correctness-1a-release-id-bigint/verification.md`；
- 独立 correctness/迁移 review 与生产 closeout review 均已批准，生产验收已经落盘；
- 当前 item：`data-correctness-1b-repository-identity`；
- Canonical plan：`tasks/data-correctness-1b-repository-identity/plan.md`；
- Production baseline：`tasks/data-correctness-1b-repository-identity/verification.md`；
- 生产只读预检发现 22 个真实仓库中 19 个可解析稳定 ID、3 个 unresolved；Radar 有 1 组可确定性合并的同 ID 重复；
- 两轮 continuity review 已关闭 compatibility/backfill 窗口、lease 原子授权、不可变审计、Radar 全序 tie-break 与 active singleton 风险，最终 verdict 为 `APPROVE`；
- 稳定 ID 边界、ID-first repository/Radar 写入、one-shot backfill、lease 原子 apply、`0007` 合并迁移与 compatibility/cutover 已完成；
- 首轮实现审查发现的 Radar ID 擦除、following 错误关联和终态 version 伪报问题均已修复，continuity verdict 为 `APPROVE`；
- 全仓 lint/typecheck/test/build、真实 PostgreSQL 演练与迁移再生成检查通过；PR/CI、显式迁移、one-shot backfill 与 cutover 已完成；下一步仅进行独立 closeout review、归档 receipt 与 Harness `mark-done`，不扩大到原子替换、技术栈实体迁移或公开鉴权。

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
# GitHub Repository 稳定身份计划审查

- Item：`data-correctness-1b-repository-identity`
- Reviewer：`release_id_migration_reviewer`
- Context mode：`limited-fresh`
- 日期：2026-08-18
- Verdict：`APPROVE`

Reviewer 只使用当前 canonical plan、边界文档、日期化生产基线与真实源码，未沿用 Release ID item 的结论。

## P1：compatibility 与 backfill 之间缺少防重复窗口

旧行只有 `fullName`、GitHub 已改名时，如果新代码在 backfill 前允许 ID-first 新实体插入，会产生第二个正式仓库行。计划必须拆分 compatibility、backfill、cutover；在可解析旧行完成回填前禁止新 ID 行插入，或暂停正式采集，并明确 unresolved 与各阶段回滚点。

## P1：backfill mutation 没有与 job lease/result 原子绑定

现有 Worker 先执行任务 mutation，之后才由 `completeJob` 检查 lease；失去 lease 的 Worker仍可能写数据而无法写 result。最终 apply 事务必须锁定并校验 job 的 `running`、`leaseOwner`、未过期 lease，并把 repository 更新和 structured result 原子提交。需要“apply 前失去 lease ⇒ 0 writes”测试。

## P1：restartable job 会清空审计 result

`enqueueRestartableJob` 会在重启终态任务时清空 result，失败路径也只有字符串 `lastError`。Repository identity backfill 必须使用版本化 one-shot job，保留每次结构化 `outcome: applied | blocked`、updated、unresolved、conflicts；API 应把 blocked 与成功区分。

## P2：Radar 最新证据缺少完整 tie-break

同一 ID 的候选具有相同 `lastSeenAt` 时，单按时间不能确定保留哪一行。迁移需使用 `lastSeenAt DESC, updatedAt DESC, id DESC` 全序，并增加时间相同 fixture；多个不同非默认状态继续 fail closed。

## Operator 修订响应

Canonical plan 已按最小范围修订：

- 新增 compatibility → one-shot backfill → cutover 三阶段，compatibility 默认禁止 ID/fullName 都未命中时创建正式仓库；
- 定义最终 apply 事务的 job row lock、lease owner/expiry 校验、repository mutation 与 structured result 原子提交；
- 改用版本化 one-shot idempotency key，终态行不可重置，blocked outcome 也持久保存 conflicts/unresolved；
- Radar 合并排序补齐 `lastSeenAt DESC, updatedAt DESC, id DESC` 与相同时间验证；
- 明确 unresolved 持续走 fullName 兼容路径、每阶段暂停范围与回滚点。

修订后等待同一 reviewer continuity 复核；在复核批准前不进入 RED tests。

## Continuity 复核一

Reviewer 确认原 4 项 finding 已关闭，但新增一项 P1：版本化 idempotency key 允许两个 identity backfill 同时 active，各自只锁自己的 job 行，不能互斥另一份合法 lease 与不同 GitHub 快照。

Operator 接受该 finding，并把最小修正写入 canonical plan：

- 对 `jobs.type = repository.identity.backfill` 且状态为 `queued | running | retry_wait` 建立全局部分唯一索引；
- 并发重复触发通过 insert no-op 返回同一 active job；
- 只有当前 run 进入终态后才能创建下一条版本化 one-shot 记录；
- 增加并发双触发与双 Worker 领取的 PostgreSQL/RED 用例，证明只存在一个 active run；
- 唯一约束只覆盖 identity backfill 的 active 状态，不改变其他 job 类型。

## Continuity 复核二

Reviewer 重新读取最新 canonical plan、当前审查记录、jobs claim/lease 契约与 Harness 状态，确认 active-singleton finding 已闭环：

- 全局 partial unique active singleton 与全局 `repositories` 实体边界一致；
- 不同 versioned idempotency key 的并发触发也只能得到同一个 active job；
- 只有旧 run 原子进入终态后才允许创建下一 one-shot 版本；
- singleton 不替代 lease authority，最终 apply 仍锁定并校验 job 行，并原子提交数据 mutation、structured result 与终态；
- 每个终态 job/result 保持不可变，双触发、双 Worker 与其他 job type 隔离测试边界完整。

Verdict：`APPROVE`。计划边界审查通过，允许进入 RED tests 与实现阶段。

## 独立实现审查一

Reviewer 重新读取实际 diff、迁移、snapshot/journal、测试与 PostgreSQL verification，给出 `CHANGES_REQUESTED`：

- P1：Radar 缺 ID 的同名 fallback update 会把已知 `githubRepoId` 改为 `null`，必须只在 insert 写空值，update 保留稳定 ID、状态和首次发现时间；
- P1：`getFollowing` 使用 `githubRepositoryId OR fullName` 后直接 `limit(1)`，在 ID/name 分裂时可能把关注关系写到错误实体，必须读取全部 matches 并复用 fail-closed 冲突判断；
- P2：重复使用已经终态的 one-shot version 时 DB 返回旧行，API 却无条件报告 `running/alreadyRunning`，必须明确拒绝并要求新 version，或返回真实终态。

其余 safe decimal ID、迁移合并/回滚、partial unique、active singleton、lease-atomic apply、Worker 不二次 complete 与三阶段 cutover 均通过审查。修复三项反例并补测试后请求 continuity review；在批准前不 commit/push/PR。

## Operator 修订响应

三项 finding 已按最小范围修复：

- Radar 将 insert values 与 conflict-update metadata 分离；无 ID 新行仍写 `null`，但同名 fallback update 不再包含 `githubRepoId`、`status` 或 `firstSeenAt`；
- `getFollowing` 改为读取全部 ID/name matches，通过 `resolveFollowingRepositoryMatch` 明确区分 ID 命中、legacy name fallback、同名不同 ID 和 ID/name 分裂，后两者 fail closed；
- 终态 one-shot version 冲突改为抛出 `REPOSITORY_IDENTITY_BACKFILL_VERSION_USED`，消息明确要求 new version，API 不再伪报 `running`。

新增 5 个反例回归测试；focused DB 16 tests、API 44 tests 与 API typecheck 通过。等待同一 Reviewer continuity review；批准前仍不 commit/push/PR。

## 实现 Continuity 复核

Reviewer 重新读取三项修订的最新 diff、回归测试与审查记录，确认：

- Radar 的无 ID insert 仍显式写 `null`，但 conflict update 不再覆盖 `githubRepoId`、`status` 或 `firstSeenAt`；
- `getFollowing` 读取全部 ID/name matches，并在同名不同 ID 或 ID/name 分裂时 fail closed；
- 已终态 one-shot version 抛出 `REPOSITORY_IDENTITY_BACKFILL_VERSION_USED`，API 不再把历史终态伪报为 active run。

Reviewer 独立复跑 DB focused 16 tests、API focused 44 tests、API typecheck 与 `git diff --check`，全部通过。最终 verdict：`APPROVE`，允许进入 commit、push、PR；生产部署仍按 Harness 的迁移与 closeout 门禁执行。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
