# 技术栈实体分离 Phase A 生产收口

## Item

- Checklist item：`data-architecture-3-technology-stack-entities`
- Phase：A / `legacy_shadow_dual_write`
- 状态：实现、迁移、生产 backfill 与 shadow 验证已完成；待独立 production closeout
- Canonical evidence：[verification.md](verification.md)

## Goal

只关闭 Phase A：确认 expand migration、versioned backfill、dual-write、shadow comparison、consumer compatibility 与生产不变量仍然成立，然后由独立 Reviewer 给出 closeout verdict。本文不授权切换新模型读取，也不授权删除 legacy 数据。

## Verified Baseline

日期化生产数字、PR/CI/deploy SHA、job receipts、投影摘要、MCP/health/auth 证据只维护在 [verification.md](verification.md)，本计划不复制第二份结果。

Phase A 已建立的稳定边界是：

- `technology_stacks` 与 `repository_technology_stacks` 保存技术栈事实；
- API 仍读取 legacy graph contract，new/legacy projection 只做 shadow comparison；
- writer 处于 `legacy_shadow_dual_write`，新旧 representation 同步保持新鲜；
- 仓库列表、收藏、分组和采集入口仍只面向真实 GitHub 仓库；
- graph/backfill 的 lease、stable repository ID、collection token 与 SBOM baseline 继续 fail closed。

## Closeout Procedure

1. 从最新 `main` 只读复核 Phase A PR、precision fix PR、CI 与生产 deploy revision；
2. 复核 migration history、`TECHNOLOGY_STACK_STORAGE_MODE=legacy_shadow_dual_write`、backfill terminal receipt 和最近一次成功 graph receipt；
3. 按稳定键重新计算 new/legacy 有序投影摘要，要求节点、source、relation、packages evidence 零差异；
4. 复核真实 repository/watched/group 数量、repo-to-repo edges、服务 health、外层 401 与认证 MCP repository list；
5. 确认没有 active backfill、过期 lease、未解释冲突或未记录的生产写入；
6. 独立 Reviewer 阅读 plan、verification、当前代码和生产只读证据，给出 `APPROVE` 或可执行 finding；
7. 只有 `APPROVE` 后才可通过 Harness `mark-done` 关闭本 item，并刷新 state、validator 与 progress。

## Hard Stops

- `data-correctness-4-deps-cache-recovery` 未 closeout 前，不把 API 切到 `new_read_dual_write`；
- `data-quality-5-postgres-integration-gates` 未建立正式门禁前，不执行 Phase B；
- 不复用 terminal backfill version，不重置历史 dead/succeeded job；
- 不删除 `is_reference`、伪仓库、伪收藏或 legacy dependency edge；
- 不把 Phase A closeout 与 MiniMax provider 切换合并到同一 PR 或部署。

## Phase Routing

兼容状态机仍为：

```text
legacy_shadow_dual_write
  -> new_read_dual_write
  -> new_only
  -> legacy_cleaned
```

- Phase B 的唯一执行计划：[../data-architecture-3b-technology-stack-read-cutover/plan.md](../data-architecture-3b-technology-stack-read-cutover/plan.md)
- Phase C 的唯一执行计划：[../data-architecture-3c-technology-stack-legacy-cleanup/plan.md](../data-architecture-3c-technology-stack-legacy-cleanup/plan.md)
- 稳定领域模型与跨阶段约束：[../../domain-model.md](../../domain-model.md)

## Exit Criteria

- 独立 production closeout 为 `APPROVE`；
- Phase A 生产证据可重放，new/legacy projection 仍为零差异；
- checklist、verification、progress 和派生 Harness state 一致；
- 系统仍处于 `legacy_shadow_dual_write`，Phase B 没有被隐式启动。
