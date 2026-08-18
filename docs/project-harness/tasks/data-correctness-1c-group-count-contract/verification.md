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

## Production Closeout Review

独立 Reviewer 复核 PR/CI/deploy SHA、无迁移输入与 migration rows、容器/访问控制、业务写入时间线和认证 MCP 返回，最终给出 `APPROVE`。Reviewer 确认 16→63 的 membership 增长发生在新代码部署前，属于合法并行 dogfood 写入；当前 7 个数值计数之和与 63 条关系一致，比冻结旧快照更能证明接口正确。Harness 已将本 item 标记为 `done`，完整结论见 [审查记录](review.md)。

## Implementation Review

独立 Reviewer 复跑 focused 25 tests、API typecheck、`git diff --check` 与 Harness validator，确认严格运行时边界、router 实际调用、mock 链和 no-migration 范围均正确，未发现 P0–P2 finding，最终 verdict 为 `APPROVE`。

## PR、部署与生产验收

- PR [#31](https://github.com/baisiqi6/DevScope/pull/31) 的 clean CI `quality` 通过，以 squash merge 合入 `main@7245b5d6ca025aefe6ea16a0d0d40998f177a2eb`；
- 手动 deploy run `32124923912` 使用 `apply_database_migration=false`，build 与 deploy 均成功；
- 生产 checkout 与 API/Web/Worker image revision 均为 `7245b5d6ca025aefe6ea16a0d0d40998f177a2eb`，服务健康，未认证入口仍为 `401`，repository identity cutover 仍为 enabled；
- Drizzle migration rows 部署前后均为 8，证明没有执行隐式迁移；
- 认证 MCP `devscope_list_groups` 成功返回 7 个分组，全部 `repoCount` 均为 JSON number：`6, 27, 1, 9, 9, 8, 3`，原来的 Zod string/number 错误已消失。

部署前只读快照为 7 groups、16 group members；部署后为 7 groups、63 group members。该增长不是本修复写入：四个新分组创建于 `2026-08-18T10:03:17Z`，并行 dogfood 会话随后在镜像构建期间添加成员；本 PR 的产品 diff 没有任何 group mutation。没有回滚或删除这些用户业务写入，端到端返回的 repo counts 与当前 63 条关联总数一致。
