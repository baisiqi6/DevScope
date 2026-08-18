# DevScope 后续整改交接索引

> Updated at：2026-08-18
> 本文件只负责路由，不复制 canonical plan、状态或生产证据。

## 当前可领取

### Track A：deps.dev cache recovery（最高优先）

- Item：`data-correctness-4-deps-cache-recovery`
- Plan：[../tasks/data-correctness-4-deps-cache-recovery/plan.md](../tasks/data-correctness-4-deps-cache-recovery/plan.md)
- 范围：`resolved/not_found/error`、TTL/retry_after、timeout、有界并发、单次预算、canonical freshness、stage progress、cold/warm rebuild。
- 边界：不切 Phase B，不清理 legacy 技术栈数据。

接受命令：

```bash
scripts/harness/harnessctl accept data-correctness-4-deps-cache-recovery <agent> <session-id>
```

### Track B：MiniMax M3（可与 Track A 并行）

- Item：`platform-ai-7-minimax-m3-default`
- Plan：[../tasks/platform-ai-7-minimax-m3-default/plan.md](../tasks/platform-ai-7-minimax-m3-default/plan.md)
- 范围：Token Plan contract probe、OpenAI-compatible 参数兼容、structured/tool/stream/cancel 门禁、canary 与 DeepSeek rollback。
- 边界：BGE-M3 embedding 不变；不把 secret 写入 Git/Harness/日志；不与数据迁移同批部署。

接受命令：

```bash
scripts/harness/harnessctl assign platform-ai-7-minimax-m3-default <agent> <session-id> --branch codex/minimax-m3-default
scripts/harness/harnessctl accept platform-ai-7-minimax-m3-default <agent> <session-id> --branch codex/minimax-m3-default
```

## 严格串行链

以下任务不能越级：

```text
deps.dev cache recovery closeout
  -> Phase A production closeout
  -> PostgreSQL integration gate
  -> Phase B new-read cutover
  -> Phase C new-only and legacy cleanup
  -> public multi-user hardening (仍需单独产品决策)
```

对应 canonical plans：

- Phase A：[../tasks/data-architecture-3-technology-stack-entities/plan.md](../tasks/data-architecture-3-technology-stack-entities/plan.md)
- PostgreSQL gate：[../tasks/data-quality-5-postgres-integration-gates/plan.md](../tasks/data-quality-5-postgres-integration-gates/plan.md)
- Phase B：[../tasks/data-architecture-3b-technology-stack-read-cutover/plan.md](../tasks/data-architecture-3b-technology-stack-read-cutover/plan.md)
- Phase C：[../tasks/data-architecture-3c-technology-stack-legacy-cleanup/plan.md](../tasks/data-architecture-3c-technology-stack-legacy-cleanup/plan.md)

## Shared Rules

- 状态与依赖只认 [../harness-checklist.json](../harness-checklist.json)；
- 稳定领域规则只认 [../domain-model.md](../domain-model.md)；生产操作只认 [../runbook.md](../runbook.md)；
- 每个 item 均按 plan review -> RED tests -> 最小实现 -> integration/full gates -> implementation review -> PR/CI -> 必要时 production closeout 执行；
- Phase C 的代码实现和隔离演练不构成生产删除授权；真实 cleanup 必须再次取得用户明确授权；
- Reviewer 必须是独立 session，不能由 Worker 自审通过。
