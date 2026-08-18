# Active Task Plan Pointer

## Current Item

- Checklist item: `data-correctness-1b-repository-identity`
- Title: `以 GitHub 稳定 ID 统一仓库身份`
- Owner: `codex`
- Session: `codex-20260818-repository-identity`
- Status: `doing`
- Workflow: `review_approved`
- Updated at: `2026-08-18`

## Canonical Plan

- Active plan path: `docs/project-harness/tasks/data-correctness-1b-repository-identity/plan.md`

## Goal Summary

同一 GitHub repository ID 在改名或转移前后只对应一个仓库实体和一个用户候选状态；回填与冲突合并可审计，无法确认时 fail closed。

## In Scope Summary

- 为正式 `repositories` 增加可空的 GitHub repository ID，并对非空值建立全局部分唯一索引；
- 将 GitHub repository ID 作为正十进制字符串从采集边界传入，拒绝 unsafe `number`、非正整数和静默截断；
- 将正式仓库 upsert 改为分阶段的 ID 优先、规范化 `fullName` 回退：compatibility 阶段只允许给同名行附加 ID 或更新已知 ID 行，禁止创建新的 ID 行；cutover 后同一 ID 改名时更新原实体和冗余关注名称，不创建第二行；
- 将 Radar 候选 upsert 改为非空 ID 优先、缺失 ID 时按 `(userId, fullName)` 回退，并保留用户已选择的状态；

## Current Step Hints

- 固化生产只读基线：正式仓库/候选数量、重复 ID、当前 GitHub 可解析和 unresolved 集合、关联表范围。
- 先增加 RED tests：unsafe repository ID、正式仓库 attach/rename/conflict、Radar 同 ID 改名与状态保持、backfill 全量校验后写入和冲突零写入。
- 更新 schema、GitHub collector/shared client、compatibility 写路径和 one-shot Worker job contract；compatibility 默认关闭“全新 stable ID 行插入”，生成并逐行审查显式迁移。
- 在隔离 PostgreSQL 中应用 `0000` 至最新迁移，覆盖已知 Radar 重复、冲突状态 fail closed、部分唯一约束、compatibility 防重复窗口、正式仓库 rename 和 backfill fixture。

## Exit Criteria Summary

- acceptance 的每个分支都有测试或 PostgreSQL/生产证据；
- 显式迁移、备份和恢复路径经过独立 review；
- 生产所有可解析正式仓库均写入稳定 ID，unresolved/conflicts 在 job result 中可定位且未被猜测；
- 生产 Radar 不再有非空同 ID 重复，用户状态和时间证据保持；

## Notes

- Canonical plan lives at `docs/project-harness/tasks/data-correctness-1b-repository-identity/plan.md`
- This file is a pointer/summary, not the full plan
- Re-run sync after significant canonical plan changes
