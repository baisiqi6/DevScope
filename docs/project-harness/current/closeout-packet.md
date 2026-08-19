# Closeout Packet

## Subject

- Checklist item: `data-architecture-3-technology-stack-entities`
- Reviewer: `reviewer-phase-a`
- Updated at: `2026-08-19`
- Canonical plan path: `docs/project-harness/tasks/data-architecture-3-technology-stack-entities/plan.md`

## Item Snapshot

- Title: 技术栈实体分离 Phase A 生产收口
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: codex
- Session: codex-20260819-phase-a-closeout
- Dependencies: data-correctness-2-atomic-replacement, data-correctness-4-deps-cache-recovery

## Acceptance

expand/backfill/dual-write/shadow compatibility 的生产证据经独立 closeout 复核；new/legacy 投影保持零差异，系统仍处于 legacy_shadow_dual_write，未提前进入 Phase B。

## Verification



## Handoff

先完成 data-correctness-4-deps-cache-recovery，再做 Phase A 独立 production closeout；批准后进入正式 PostgreSQL 门禁，不得直接切 Phase B。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
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
```

## Recent Progress Context

```md
### 上一 handoff（1b 已并入 main，存档）



- 最近完成 item：`data-correctness-1a-release-id-bigint`；
- Canonical plan：`tasks/data-correctness-1a-release-id-bigint/plan.md`；
- Verification：`tasks/data-correctness-1a-release-id-bigint/verification.md`；
- 独立 correctness/迁移 review 与生产 closeout review 均已批准，生产验收已经落盘；
- 最近完成 item：`data-correctness-1b-repository-identity`；
- Canonical plan：`tasks/data-correctness-1b-repository-identity/plan.md`；
- Production baseline：`tasks/data-correctness-1b-repository-identity/verification.md`；
- 生产只读预检发现 22 个真实仓库中 19 个可解析稳定 ID、3 个 unresolved；Radar 有 1 组可确定性合并的同 ID 重复；
- 两轮 continuity review 已关闭 compatibility/backfill 窗口、lease 原子授权、不可变审计、Radar 全序 tie-break 与 active singleton 风险，最终 verdict 为 `APPROVE`；
- 稳定 ID 边界、ID-first repository/Radar 写入、one-shot backfill、lease 原子 apply、`0007` 合并迁移与 compatibility/cutover 已完成；
- 首轮实现审查发现的 Radar ID 擦除、following 错误关联和终态 version 伪报问题均已修复，continuity verdict 为 `APPROVE`；
- 全仓 lint/typecheck/test/build、真实 PostgreSQL 演练与迁移再生成检查通过；PR/CI、显式迁移、one-shot backfill、cutover 与独立 closeout 已完成；下一步先用独立小 item 修复 dogfood 暴露的 group count 契约，再进入 `data-correctness-2-atomic-replacement`。
- 最近完成 item：`data-correctness-2-atomic-replacement`；
- Canonical plan：`tasks/data-correctness-2-atomic-replacement/plan.md`；
- Verification：`tasks/data-correctness-2-atomic-replacement/verification.md`；
- 原子快照、版本安全 embedding、PR/CI、无迁移部署、生产 MCP dogfood 与独立 closeout 均已完成；下一 item 为 `data-architecture-3-technology-stack-entities`。
- 当前 item：`data-architecture-3-technology-stack-entities`；
- Canonical plan：`tasks/data-architecture-3-technology-stack-entities/plan.md`；
- Verification：`tasks/data-architecture-3-technology-stack-entities/verification.md`；
- Phase A expand、precision fix、versioned backfill、shadow zero-diff 与生产 MCP/health/auth 证据均已完成；独立 production closeout 尚未执行。下一步先完成 `data-correctness-4-deps-cache-recovery` 的恢复语义和外呼预算，再由 Reviewer 复核，不能提前进入 Phase B 或标记 done。
- 可并行 item：`platform-ai-7-minimax-m3-default`；其 provider 迁移与数据整改使用独立 PR、部署和 closeout。
- 后续串行 item：Phase A closeout -> `data-quality-5-postgres-integration-gates` -> Phase B -> Phase C。

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
# 当前审查

`data-architecture-3-technology-stack-entities` 的 Phase A expand、precision fix、versioned backfill、生产 shadow zero-diff 与 MCP/health/auth 已完成；证据见 [任务验证记录](../tasks/data-architecture-3-technology-stack-entities/verification.md)。生产 graph rebuild 虽正确成功，但 70 分 44 秒的冷缓存路径暴露外呼 timeout/budget/freshness/progress P1，唯一后续方案为 [依赖解析缓存恢复与外呼预算计划](../tasks/data-correctness-4-deps-cache-recovery/plan.md)。当前暂停在 Phase A production closeout 前；Reviewer 批准 item 4 和 Phase A closeout 前不得进入 Phase B/C 或标记整个 item 完成。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
