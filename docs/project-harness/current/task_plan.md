# Active Task Plan Pointer

## Current Item

- Checklist item: `data-architecture-3b-technology-stack-read-cutover`
- Title: `技术栈实体分离 Phase B：切换新模型读取`
- Owner: `codex`
- Session: `codex-20260819-phase-b`
- Status: `doing`
- Workflow: `running`
- Updated at: `2026-08-19`

## Canonical Plan

- Active plan path: `docs/project-harness/tasks/data-architecture-3b-technology-stack-read-cutover/plan.md`

## Goal Summary

(from canonical plan)

## In Scope Summary

- (from canonical plan)

## Current Step Hints

- (from canonical plan)

## Exit Criteria Summary

- 所有支持的 consumer 使用 `technology_stack` contract，node ID 稳定且无悬空边；
- API 从新表读取，dual-write 仍维持 legacy projection 零差异；
- repository/watch/group/collection/Radar/Scheduler 只表达真实 GitHub repository；
- mixed revision、跨用户、top-N、并发和 rollback 演练通过；

## Notes

- Canonical plan lives at `docs/project-harness/tasks/data-architecture-3b-technology-stack-read-cutover/plan.md`
- This file is a pointer/summary, not the full plan
- Re-run sync after significant canonical plan changes
