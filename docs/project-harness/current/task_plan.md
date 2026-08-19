# Active Task Plan Pointer

## Current Item

- Checklist item: `platform-ai-7-minimax-m3-default`
- Title: `将分析模型默认切换到 MiniMax M3`
- Owner: `codex`
- Session: `codex-20260819-minimax`
- Status: `doing`
- Workflow: `running`
- Updated at: `2026-08-19`

## Canonical Plan

- Active plan path: `docs/project-harness/tasks/platform-ai-7-minimax-m3-default/plan.md`

## Goal Summary

(from canonical plan)

## In Scope Summary

- (from canonical plan)

## Current Step Hints

- (from canonical plan)

## Exit Criteria Summary

- 生产 API/Worker 的 generic config 指向正确站点的 `MiniMax-M3`；
- complete、stream、structured output、tool calling、cancel/error paths 均通过真实 probe 与自动测试；
- structured result 继续 `JSON.parse` + Zod fail closed，thinking 不污染结果；
- secrets 未进入 Git/日志/artifact，DeepSeek rollback 已演练；

## Notes

- Canonical plan lives at `docs/project-harness/tasks/platform-ai-7-minimax-m3-default/plan.md`
- This file is a pointer/summary, not the full plan
- Re-run sync after significant canonical plan changes
