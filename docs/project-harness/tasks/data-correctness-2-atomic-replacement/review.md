# 采集子数据原子替换审查记录

- Item：`data-correctness-2-atomic-replacement`
- Reviewer：`release_id_migration_reviewer`
- 日期：2026-08-18

## Plan Review 1

Verdict：`CHANGES_REQUESTED`。

Reviewer 认可 `success([])` 清空、`failure(error)` 保留、三来源单一短事务与不新增队列的总体方向，但指出四个未闭环边界：

1. 应用侧毫秒 `new Date()` 可能碰撞，不能充当并发唯一版本；应由 PostgreSQL 在仓库行锁内分配严格单调、可由 JavaScript 无损往返的毫秒 token；
2. Scheduler pooling、API status sync、独立 sync 脚本与图重建 backfill 都是 embedding 派生写者，必须纳入 token/lock 护栏；
3. Pipeline resolved `status=failed` 后，API/Scheduler 当前仍可能创建 watched、启动旧 chunks embedding、重置状态或计成功，需要明确调用方 outcome；
4. optional source 需要独立 `skipped`，并在事务外做 runtime schema validation，避免非法 payload 使其他已验证来源一起回滚。

计划已据此修订，并增加同毫秒 token、独立连接并发、stale progress/final/pooling/status、新旧采集插入窗口及失败调用方反例。等待 continuity review。

## Plan Review 2

Verdict：`CHANGES_REQUESTED`。

首轮四项已关闭，Reviewer 进一步指出三个时序反例：

1. 若在最终快照前推进 token，后续准备或提交失败会让上一份正在运行的 embedding 永久失去 authority；
2. pooling/status reconcile 若锁外读取、提交时才检查同一 token，仍可在 embedding final 后写回陈旧统计；
3. quick snapshot 没有明确清除 repository mean，pending 窗口及合法空 chunks 会继续暴露旧向量。

计划再次修订：全部网络、校验和分块前置，repository upsert、token 分配、三来源替换、mean 清空与 embedding 初态合并为一个 stable-ID 锁保护的最终事务；pooling/reconcile 改为先锁后读；非空/空 chunks 分别定义 `pending/0/N` 与 `completed/0/0`。等待第二次 continuity review。

## Plan Review 3

Verdict：`CHANGES_REQUESTED`。

第二轮三个主体设计已关闭，Reviewer 继续指出两个边界：

1. 新仓库若依赖 `defaultNow()`，PostgreSQL 微秒会在 node-postgres `Date` 回传时丢失，首次 embedding claim 无法匹配；
2. SBOM backfill 即使不推进 token，也可能在网络返回后用旧结果覆盖刚提交的新采集 SBOM。

计划已补充：新仓库 INSERT 显式使用毫秒精度的数据库 timestamp；SBOM backfill 使用 stable ID、token 和 JSON baseline 三重 CAS，并定义 404、合法 envelope、malformed 200 与网络失败语义；同时把 identity backfill 和 shared GitHub client 加入文件范围。等待第三次 continuity review。

## Plan Review 4

Verdict：`CHANGES_REQUESTED`。

第三轮两项已关闭，Reviewer 找到最后一个并发绑定缺口：API/Scheduler 当前分别读取 chunks 与 token，可能把旧 chunks 和新 token 配对，使 stale 防线误放行并用旧文本覆盖新快照。

计划已把 embedding 方法改为结构性安全接口：入口只接收 `repoId + expectedToken`；claim、token 校验、`pending → processing` 与完整 chunks 读取处于同一个锁定事务，模型网络计算只能使用 claim 返回的快照；API 使用 collection commit 返回的 token，Scheduler 不再预读 chunks。等待第四次 continuity review。

## Plan Review 5

Verdict：`APPROVE`。

Context mode：`continuity`。本轮重新读取最新 canonical plan、审查记录与当前调用路径，确认第四轮最后一项 token/chunks 绑定风险已关闭：embedding 入口只接收 `repoId + expectedToken`；claim 在同一 stable-ID advisory lock 与 repository row lock 事务内完成 token/status CAS 并读取完整 chunks；API 使用 collection final transaction 返回的 token，Scheduler 不再预读 chunks，调用方无法构造旧 chunks 与新 token 的跨版本组合。

前三轮确认过的严格单调毫秒 token、失败不推进 token、三来源及 SBOM structured outcome、全部 embedding/status/SBOM writer 护栏、同 token 锁后读取、quick/empty chunks mean 清理与双连接反例验证均保留。计划满足 acceptance，未引入 schema migration、第二套队列，也未提前吞并后续通用 PostgreSQL integration item。

允许进入 RED tests。该 verdict 只批准计划，不授予 commit、push、deploy 或 production mutation authority。

## Implementation Review 1

Verdict：`CHANGES_REQUESTED`。

Reviewer 在完整 diff 与 focused tests 中发现四项需要关闭的缺口：

1. `reconcile` 会把活跃 `processing` 按尚未落库的 chunk vectors 改回 `pending`，从而允许同 token 的第二次 claim；部分失败又可能被改成无人持有的 `processing`；
2. SBOM envelope 只验证 package 是 object，`packages:[{}]` 会被 parser 丢弃后伪装成 `success([])` 并清除旧快照；
3. 真实 PostgreSQL 证据没有覆盖旧 progress/failure/final 与新 token 的强制交错，也没有覆盖 embedding final 写入回滚，verification 表述超过测试；
4. Harness 派生 state 尚未刷新，和 checklist 当前 doing item 不一致。

修订已完成：`processing` 与 `failed` 保留现有 authority，未完成且无人持有的状态保持 `pending`；SPDX package 至少验证非空 `name`，并严格验证可选 `versionInfo`/`externalRefs` 字段；新增 malformed SBOM、固定 warning 顺序、claim-vs-reconcile、partial-failure reconcile、三类 stale writer 双连接交错和 final rollback 的回归测试。等待 continuity implementation review。

## Implementation Review 2

Verdict：`APPROVE`。

Reviewer 重新读取最新 diff、verification 与 Harness state，确认首轮四项均已闭环，未发现剩余 P0–P3 finding。独立复跑 DB focused 97 tests、API focused 40 tests、DB/API typecheck、`git diff --check`、Harness validate/doctor 均通过；真实 PostgreSQL 10 项证据由最新测试源码与 verification 核对。允许继续 commit、push 与 PR。
