# 分组仓库计数运行时契约审查记录

- Item：`data-correctness-1c-group-count-contract`
- Reviewer：`release_id_migration_reviewer`
- Verdict：`APPROVE`
- 日期：2026-08-18

Reviewer 确认 `sql<number>` 只影响 TypeScript，PostgreSQL `COUNT` 的 `int8` 运行时 string 才是根因。修复应保留数据库准确值，并在 API runtime 输出边界严格 normalize；不使用会缩窄范围的 SQL cast，也不使用会静默接受指数、小数或 unsafe 值的宽松 `Number(value)`。

合法边界为非负 safe integer number，或规范非负十进制 string 且转换后不超过 `Number.MAX_SAFE_INTEGER`。空白、空串、符号、指数、小数、`null`、`NaN`、`Infinity` 与 unsafe 值必须 fail closed。API router RED tests 覆盖合法与非法矩阵，生产部署明确 `apply_database_migration=false` 并复核 migration rows 与 group data 不变量。

Verdict：`APPROVE`，允许进入 RED tests。

## Implementation Review

Reviewer 重新读取产品 diff、测试、plan 与 verification，确认：

- normalize 只接受非负 safe integer number 或无符号、无前导零的规范十进制 string；
- SQL projection 使用 `sql<unknown>`，不再用 TypeScript 泛型伪装运行时类型；
- `groups.getAll` 的真实返回路径逐行 normalize，router mock 完整经过两次 select 与 JOIN/GROUP BY 链；
- 25 tests 覆盖合法边界、宽松 coercion 反例和 string→number 路由集成，API typecheck 通过；
- 产品 diff 仅包含 `groups.ts` 与测试，没有 schema 或 Drizzle metadata 变化。

Reviewer 独立复跑 focused tests、API typecheck、`git diff --check` 与 Harness validator，全部通过。Verdict：`APPROVE`，允许 commit、push、PR；生产必须使用 `apply_database_migration=false`。

## Production Closeout Review

Reviewer 独立核对 PR #31、quality/main CI、deploy run、生产 Git/镜像、migration rows、服务、访问控制与认证 MCP，确认全部对应 `main@7245b5d6ca025aefe6ea16a0d0d40998f177a2eb`。部署明确使用 `apply_database_migration=false`，migration rows 保持 8；认证 `devscope_list_groups` 返回 7 个 JSON number 计数 `[6,27,1,9,9,8,3]`，总和与当前 63 条 group memberships 一致。

部署前快照 16→部署后 63 不构成回归：四个新组在 PR merge 前创建，新增 membership 在 deploy job 与生产 `git pull` 前写入；产品 diff 只有只读输出 normalization，没有 group mutation。旧数字是日期化快照，不应为了满足它而删除合法 dogfood 数据。

最终 verdict：`APPROVE`。1C acceptance 与 exit criteria 已满足，允许 Harness `mark-done`。
