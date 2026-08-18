# Handoff Packet

## Subject

- Checklist item：`data-correctness-4-deps-cache-recovery`
- From：`codex`
- To：`next-agent`
- Updated at：2026-08-18
- Status：`handoff_requested`

## Authority Pointers

- 唯一执行计划：[依赖解析缓存恢复与外呼预算计划](../tasks/data-correctness-4-deps-cache-recovery/plan.md)
- 领域语义：[domain-model.md](../domain-model.md)
- 生产操作：[runbook.md](../runbook.md)
- Phase A 生产证据：[技术栈实体分离验证](../tasks/data-architecture-3-technology-stack-entities/verification.md)
- 当前状态与依赖：[harness-checklist.json](../harness-checklist.json)

本 packet 只负责路由和交接，不复制 canonical plan。发生冲突时以上文件按其职责分别为唯一事实来源。

## Why This Is Next

Phase A 已部署到 `main@3fa0d9cde6443b3b39d494489c14a206e84cfef6`；backfill job #28 为 `succeeded 40/40`，graph job #9 attempt 1 成功，新旧技术栈投影均为 79 relations、25 sources、379 packages，MCP/health/auth 正常。

但 job #9 耗时约 70 分 44 秒。生产观察到 19007 个唯一 package/version、约 6000 个 deps.dev miss、3053 个串行 GitHub canonicalization target，并确认 timeout、request budget、canonical freshness 和 stage progress 边界不足。该 P1 已前置为技术栈 Phase B 的依赖。

## Required Next Action

1. 用独立 session 接受本 item：

   ```bash
   scripts/harness/harnessctl accept data-correctness-4-deps-cache-recovery next-agent <session-id>
   ```

2. 完整阅读 canonical plan，并先请求独立 plan review；
3. 按 RED tests → 最小实现 → PostgreSQL/全仓门禁 → implementation review → PR/CI → 生产备份/迁移/部署 → cold/warm rebuild dogfood 的顺序执行；
4. 不切换 `new_read_dual_write`，不删除 legacy reference/watches/edges，不执行 Phase C cleanup；
5. 完成后提交 plan 要求的证据包并 handoff 给 Reviewer，不自行宣布 Phase B 可开始。

## Current Blocker

`data-architecture-3-technology-stack-entities` 已显式依赖本 item。本 item 未完成独立 production closeout 前不得恢复 Phase B。

## Decline Or Block

若无法接受，应使用 Harness `decline` 或 `blocker` 留下明确原因；不要静默修改 checklist 状态、重置生产 job #27/#9，或复用已有 terminal version。
