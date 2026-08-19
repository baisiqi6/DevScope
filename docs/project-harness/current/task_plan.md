# Active Task Plan Pointer

## Current Item

- Checklist item: `data-architecture-3c-technology-stack-legacy-cleanup`
- Title: `技术栈实体分离 Phase C：停止旧写入并清理伪数据`
- Owner: `codex`
- Session: `codex-20260819-phase-c`
- Status: `doing`
- Workflow: `running`
- Updated at: `2026-08-19`

## Canonical Plan

- Active plan path: `docs/project-harness/tasks/data-architecture-3c-technology-stack-legacy-cleanup/plan.md`

## Goal Summary

(from canonical plan)

## In Scope Summary

- (from canonical plan)

## Current Step Hints

- (from canonical plan)

## Exit Criteria Summary

- 新表是技术栈唯一持久事实来源；
- legacy writer、compatibility read、`reference/isReference` contract 和 `is_reference` 列均删除；
- 伪仓库、伪收藏、legacy stack edges 清零，真实业务数据与图谱语义保持一致；
- cleanup 和 rollback 均完成真实 PostgreSQL 演练，生产 receipt 与独立 closeout approved。

## Notes

- Canonical plan lives at `docs/project-harness/tasks/data-architecture-3c-technology-stack-legacy-cleanup/plan.md`
- This file is a pointer/summary, not the full plan
- Re-run sync after significant canonical plan changes
