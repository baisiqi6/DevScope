# GitHub Repository 稳定身份审查记录

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

## Production Closeout Review

Reviewer 以 `limited-fresh production closeout` 重新读取 canonical plan、verification、当前审查记录、checklist、真实 Git/CI 与生产状态，没有把实现审查结论代替生产验收。

核对结果：

- PR #29、clean CI、deploy workflow 与生产 checkout/镜像均对应 `main@647dc6251bd1fe9234dd5df56a4387ed49470101`；
- custom-format 数据库备份和 cutover 前环境备份均存在、权限为 `600`，数据库备份通过 `pg_restore --list`；
- migration rows 为 8，三个目标 partial unique indexes 存在；22 个真实 GitHub 仓库均带唯一稳定 ID，10 个 `tech-stack/*` reference rows 按 non-goal 保持空 ID；
- Radar 118 行且无重复，job 26 为 `applied`、updated 22、unresolved 0、conflicts 0，无 active identity job；
- watched rows、冗余名称与 group member 不变量保持，cutover 已只在 API 启用，服务、Nginx 访问控制、认证 MCP health 与 repository list 均通过。

额外发现 `groups.list` 的 PostgreSQL `count` 在运行时返回 string，与 `repoCount: number` 契约不一致。该代码早于本 PR，在线 `group_members=16` 未变化，与 identity 数据迁移无因果关系；Reviewer 将其列为独立 P2 follow-up，不阻塞本 item，并要求在独立 correctness item 中显式数值转换和增加回归测试。

最终 verdict：`APPROVE`。允许 Operator 按 Harness 协议归档本审查记录并执行 `mark-done`。
