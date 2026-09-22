# DF-20260822-001：Hacker News 可选字段兼容

## Item

- Checklist item：`df-20260822-001-hn-optional-fields`
- 关联 observation：`DF-20260822-001`
- 风险模式：本地代码修复为 ordinary；发布与生产重新采集另需显式授权并升级为 high-risk
- 分支：`codex/df-20260822-001-hn-optional-fields`
- 当前阶段：本地实现、独立复审与完整门禁通过，等待发布授权与生产复采

## 目标

修复 HN Algolia 合法响应因 `story_text`、`url` 等可选字段缺失而被 Zod 判为非法的问题，使缺失值规范化为 `null`，同时保留对错误类型 payload 的失败语义。

## 范围

- 调整 `packages/db/src/pipeline.ts` 的 HN 响应边界 schema。
- 增加缺失可选字段的最小回归测试。
- 更新 `DF-20260822-001` 的修复进度，但在生产重新采集成功前不关闭 observation。

## 非目标

- 不改变 HN 查询策略、limit、错误分类、存储表或原子提交语义。
- 不放宽 `points`、`num_comments` 等字段出现错误类型时的校验。
- 本 item 不自行 push、合并、部署或触发生产仓库采集。

## 已确认根因

- 2026-09-21 对 HN Algolia 查询 `agency-agents` 的实时只读样本包含 9 条结果，其中 6 条缺少 `story_text`，1 条缺少 `url`。
- 当前 schema 使用 `.nullable()`，只接受显式 `null`，不接受字段缺失产生的 `undefined`。
- 生产 dogfood 已在 `DietrichGebert/ponytail`、`msitarzewski/agency-agents` 与 System One 三个仓库样本中稳定复现。

## 验收标准

- 合法缺失的 HN 字段被规范化为 `null`，采集快照为 `success`。
- 错误类型 payload 仍返回 `failure` 并保留旧来源。
- `packages/db` focused test 与 typecheck 通过；完整门禁在交付前执行。
- 独立 Reviewer 确认改动未扩大到其他采集边界。
- 只有发布并用新的生产采集样本验证 HN enrichment 后，才可将 `DF-20260822-001` 标为 `closed`。

## 当前 Handoff

Worker 已完成 schema 与回归测试的最小修复；首轮 Reviewer 指出并推动修正 `rawJson` 原始语义问题，最终独立复审 `APPROVED`。本地实现可收口；生产发布与重新采集不在当前授权内。

## 本地验证

- HN 边界 schema 对六个可空字段接受缺失值并规范化为 `null`，仍拒绝错误类型。
- 首轮 Reviewer 指出 `rawJson` 不应包含 schema transform 人为补出的 key；现已改为标准列读取 normalized hit，`rawJson` 保留上游原始 hit。
- `corepack pnpm --filter @devscope/db test -- src/pipeline.test.ts`：51/51 通过。
- `corepack pnpm --filter @devscope/db typecheck`：通过。
- 最终 diff 的全仓库 `corepack pnpm lint`、`typecheck`、`test`、`build` 全部通过；lint/build 仅保留既有 18 条 Web warning 与 browserslist 提示。
- `git diff --check`：通过。
- 独立 Reviewer 最终 `APPROVED`，无 P0–P2；生产复采尚未执行，因此 observation 继续保持 `fixing`。
