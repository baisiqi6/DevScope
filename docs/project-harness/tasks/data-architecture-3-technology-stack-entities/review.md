# 技术栈实体分离审查记录

- Item：`data-architecture-3-technology-stack-entities`
- Reviewer：`release_id_migration_reviewer`
- 日期：2026-08-18

## Plan Review 1

Verdict：`CHANGES_REQUESTED`。

Reviewer 认可两张直接领域表、repository-stack 全局无 `user_id`、用户隔离位于 watched source join，以及 `stack:<slug>` 稳定 ID 的方向；计划没有提前吞并 deps.dev cache item。但进入 RED tests 前必须关闭四项边界：

1. 全局 relation 缺少 per-source writer ownership、collection token/SBOM baseline 护栏；user-specific top-N 不能决定全局事实；
2. Phase B 停止 legacy 写却仍承诺直接回滚旧镜像，Phase C 又缺少 revision、配置、graph jobs 与事务门禁；
3. evidence backfill 只检查 array 不足以保证每个 package 无损，多用户副本冲突不能 last-write-wins；
4. `reference → technology_stack` 是破坏性 graph contract，必须先发布 consumer compatibility，再协调 API 输出切换。

计划已修订为严格状态机 `legacy_shadow_dual_write → new_read_dual_write → new_only → legacy_cleaned`；新增 per-source stable-ID/token/SBOM lock、all-detection persistence/query-only top-N、严格 one-shot evidence backfill、混合版本 contract 测试，以及 cleanup 前强制 drain/stop/backup 门禁。等待 continuity plan review。

## Plan Review 2

Verdict：`CHANGES_REQUESTED`。

Reviewer 确认首轮的 per-source writer/token、query-only top-N、严格 evidence fold、状态机 rollback 语义和 consumer-first contract rollout 已基本闭环，但仍有两个 P1：

1. one-shot backfill 只写“复用 durable jobs”，没有专用 version、global active singleton、terminal version 禁止复用，以及 lease-authoritative relation/checkpoint/receipt 同事务；当前通用 Worker 在 heartbeat 丢失后仍可能继续执行；
2. Phase C 的 drain/stop/backup 门禁没有落到当前先 migrate 后 recreate 的真实 deploy workflow，Files In Scope 也遗漏 workflow、runbook 和 Worker/job gate。

计划已补充专用 `technology_stack.entities.backfill` job：prepare 零写、每个 source apply 同时锁 job/repository 并验证未过期 lease、stable ID/token/SBOM，原子写 relation/checkpoint/result，lost lease 零写入且 Worker 不二次 complete。cleanup 改为默认关闭的专用 workflow 操作，固定执行 revision/config 校验、producer block、job drain、API/Worker stop、事务检查、backup、timeout-bounded migration、restart 与业务验证，并纳入实际文件范围和容器演练。等待下一次 continuity review。

## Plan Review 3

Verdict：`APPROVE`。

Reviewer 重新核对最新计划与当前 jobs/Worker/deploy 路径，确认上轮两个 P1 均已关闭：专用 versioned singleton backfill 的 lease authority、per-source relation/checkpoint/receipt 原子提交和 lost-lease 零写入均可在现有 jobs 架构内实现；cleanup 已落实为默认关闭的专用 workflow 操作，具备 producer fence、job drain、服务停止、事务/锁检查、备份、超时迁移、固定 revision 重启、业务验收和完整回滚顺序。

首轮四类边界全部闭环，未发现剩余 P0–P3 finding。允许进入 RED tests；各 phase 的实现、迁移和生产操作仍需分别审查与验证。
