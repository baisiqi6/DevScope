# Active Task Plan Pointer

## Current Item

- Checklist item: `data-quality-5-postgres-integration-gates`
- Title: `建立真实 PostgreSQL 迁移、事务与并发门禁`
- Owner: `codex`
- Session: `codex-20260819-pg-gates`
- Status: `doing`
- Workflow: `running`
- Updated at: `2026-08-19`

## Canonical Plan

- Active plan path: `docs/project-harness/tasks/data-quality-5-postgres-integration-gates/plan.md`

## Goal Summary

(from canonical plan)

## In Scope Summary

- (from canonical plan)

## Current Step Hints

- (from canonical plan)

## Exit Criteria Summary

- root `pnpm test:integration` 在本地隔离库和 CI PostgreSQL service 行为一致；
- migration、transaction、并发、lease 和恢复矩阵真实通过；
- 危险连接与不安全 cleanup fail closed；
- PR 必需检查包含独立 integration job，且现有 quick tests 保持快速；

## Notes

- Canonical plan lives at `docs/project-harness/tasks/data-quality-5-postgres-integration-gates/plan.md`
- This file is a pointer/summary, not the full plan
- Re-run sync after significant canonical plan changes
