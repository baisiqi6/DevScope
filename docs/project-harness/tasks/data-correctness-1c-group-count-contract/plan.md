# 修复分组仓库计数的运行时契约

## Item

- Checklist item：`data-correctness-1c-group-count-contract`
- Owner：`codex`
- Session：`codex-20260818-group-count`
- Updated at：2026-08-18

## Goal

`groups.list` 在 PostgreSQL 驱动把 `count` 返回为 string 时仍输出经过校验的安全 number，使 Web、CLI 与 MCP 共用的分组列表契约恢复可用，同时不改变任何分组或成员数据。

## Root Cause

`apps/api/src/router/groups.ts` 使用 `sql<number>\`count(...)\``。该泛型只影响 TypeScript 推断，不改变 PostgreSQL `bigint` aggregate 的运行时 string；API 把原值交给 client 的 `repoCount: z.number()` 后解析失败。

## In Scope

- 先增加 string count、number count 和非法值的 RED tests；
- 在 API 输出边界把 count 显式转换为非负 safe integer，非法运行时值 fail closed；
- 验证 `groups.list`、CLI/MCP client contract 和现有分组数据不变量；
- 通过 PR/CI 后无数据库迁移部署，并复测认证 MCP `devscope_list_groups`。

## Out Of Scope

- 不修改数据库 schema、分组/成员数据或 group CRUD 语义；
- 不顺带整改 repository 子数据原子替换；
- 不修改另一会话的 dogfood 文档。

## Verification

- focused API tests 与 typecheck；
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- PR/CI；
- 生产部署不执行 migration，认证 MCP 分组列表成功且 `group_members` 行数保持 16。

## Exit Criteria

- PostgreSQL count 的 string/number 两种合法运行时形态均输出 number；
- 负数、非整数、unsafe 或非数值输入被拒绝；
- 生产 `devscope_list_groups` 成功返回分组及数值 `repoCount`；
- 分组与成员数据无 mutation，独立 review 通过。
