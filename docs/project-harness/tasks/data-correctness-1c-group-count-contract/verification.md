# 分组仓库计数运行时契约验证

## 生产复现

2026-08-18 通过 Keychain 注入的认证 DevScope MCP 调用 `devscope_list_groups`，client Zod 明确报告三条分组的 `repoCount` 均为 `Expected number, received string`。同一连接的 health 与 repository list 正常，生产 `group_members=16`，确认是 `groups.list` 单一路径的输出类型漂移，不是数据损坏。

## RED/GREEN

- RED：API router test 证明 PostgreSQL string count 原样返回，并覆盖合法/非法运行时矩阵；修复前 25 tests 中 23 个按预期失败；
- GREEN：`normalizeRepositoryGroupCount` 只接受非负 safe integer number，或规范非负十进制 string 且转换后为 safe integer；
- 空白、空串、符号、前导零、指数、小数、负值、`null`、非有限值与 unsafe 值均 fail closed；
- `groups.getAll` 在 API 输出边界逐行 normalize，不修改 SQL、schema 或分组数据；
- focused API 25 tests 与 API typecheck 通过。

## Plan Review

独立 Reviewer 给出 `APPROVE`：确认 root cause、runtime boundary normalization、严格合法边界、no-migration 发布与生产不变量验收均正确；不建议用 32-bit SQL cast 或无检查的 `Number` 转换。

## 全仓门禁

- `pnpm lint`：通过，仅保留 16 个既有 Web warnings；
- `pnpm typecheck`：通过；
- `pnpm test`：通过，API 10 files/95 tests、DB 10/139、Worker 3/14、Skill pipeline 21 tests 及其他 workspace tests 全部通过；
- `pnpm build`：通过，Next.js 14 pages 成功生成，仅保留同一组既有 warnings；
- 没有新增或修改 Drizzle migration、journal 或 snapshot。

## 待验证

- PR/CI；
- `apply_database_migration=false` 生产发布，migration rows 保持 8、`group_members` 保持 16，认证 MCP `devscope_list_groups` 返回数值 `repoCount`。

## Implementation Review

独立 Reviewer 复跑 focused 25 tests、API typecheck、`git diff --check` 与 Harness validator，确认严格运行时边界、router 实际调用、mock 链和 no-migration 范围均正确，未发现 P0–P2 finding，最终 verdict 为 `APPROVE`。
