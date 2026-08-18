# Active Task Plan Pointer

## Current Item

- Checklist item: `data-correctness-1a-release-id-bigint`
- Title: `将 GitHub Release ID 迁移为无损 bigint`
- Owner: `codex`
- Session: `codex-20260817-release-id-bigint`
- Status: `doing`
- Workflow: `review_approved`
- Updated at: `2026-08-18`

## Canonical Plan

- Active plan path: `docs/project-harness/tasks/data-correctness-1a-release-id-bigint/plan.md`

## Goal Summary

消除 `releases.id` 的 signed `int4` 容量风险，使 GitHub Release ID 从采集、转换、数据库、查询到 API 输出全链路无损，同时保持现有数据和调用方兼容。

## In Scope Summary

- 核对 Drizzle schema、迁移历史、GitHub Release 转换和 API/shared schema 中的 ID 类型；
- 先增加超过 `2147483647` 的失败复现和回归测试；
- 生成并审查显式 PostgreSQL 迁移，将目标列扩大为 `bigint`；
- 删除会截断、哈希或静默改变合法 GitHub ID 的降级逻辑；

## Current Step Hints

- 重新检查工作树、schema、迁移、转换函数、共享/API schema 和相关测试，记录当前 ID 类型链路。
- 增加 int4 上限以上的 RED 测试，覆盖采集转换、数据库往返和 API 序列化边界。
- 选择最小的无损 Drizzle/TypeScript 表示并更新 schema 与转换逻辑。
- 运行 `pnpm db:generate`，逐行审查生成的迁移，确认只扩大目标列且无隐式重建或数据丢失。

## Exit Criteria Summary

- 所有 acceptance 均有可定位证据；
- 显式迁移和回滚策略经过 review；
- checklist 只在 review approved 且验证落盘后标记 `done`；
- 没有把其他整改项顺带并入本任务。

## Notes

- Canonical plan lives at `docs/project-harness/tasks/data-correctness-1a-release-id-bigint/plan.md`
- This file is a pointer/summary, not the full plan
- Re-run sync after significant canonical plan changes
