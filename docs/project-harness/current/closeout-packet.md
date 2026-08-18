# Closeout Packet

## Subject

- Checklist item: `data-correctness-1c-group-count-contract`
- Reviewer: `release_id_migration_reviewer`
- Updated at: `2026-08-18`
- Canonical plan path: `docs/project-harness/tasks/data-correctness-1c-group-count-contract/plan.md`

## Item Snapshot

- Title: 修复分组仓库计数的运行时契约
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: codex
- Session: codex-20260818-group-count
- Dependencies: data-correctness-1b-repository-identity

## Acceptance

groups.list 在 PostgreSQL 真实 count 返回 string 时仍输出安全 number，CLI/MCP 分组列表可用且不改变分组数据。

## Verification

PR #31 and CI passed; no-migration deploy run 32124923912 succeeded; migration rows stayed 8; authenticated MCP returned seven numeric repoCount values summing to 63 concurrent dogfood memberships.

## Handoff

Independent closeout reviewer must distinguish concurrent dogfood group writes from the read-only output-contract fix, then approve mark-done.

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
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
```

## Recent Progress Context

```md
# DevScope Harness 进展

> 更新时间：2026-08-18
> 基线：`main@647dc62`
> 部署形态：Standalone
> 当前状态：Release ID 与 Repository stable identity items 已关闭；group count 契约已修复上线，等待 closeout review

## 已完成

- 完成项目、文档、源码、测试和生产数据库的只读基线审计；
- 将项目范围、架构、数据模型、运行手册、任务状态和 task plan 拆成唯一事实来源；
- 建立高风险数据整改 checklist 和第一个 Release ID 任务计划；
- 保持 Agent/MCP 接口指南为独立接口文档，通过 Harness 单向引用。
- 完成 `releases.id` 的 Drizzle `bigint` 映射、无损采集边界、十进制字符串 API 契约和显式迁移；
- 删除 tag hash 伪 Release 降级，在本地 PostgreSQL 完成 188 条历史 fixture 升级与大 ID 往返演练；
- focused tests、全仓 lint/typecheck/test/build 与迁移再生成检查全部通过。
- 独立 reviewer 首轮提出 JavaScript safe integer 与迁移锁门禁问题；修订后 continuity 复核为 `APPROVE`。
- PR #27 已通过 CI 并合并，手动部署 workflow run 32112032164 已完成生产备份、显式迁移和应用发布；
- 生产 `releases.id` 已变为 `bigint`，迁移前备份与在线库 191 条有序 `(id, repo_id)` 行集哈希一致；
- 生产 API/Web/Worker/PostgreSQL/Nginx 健康，未认证访问为 401，Keychain + SSH tunnel 的认证 health 为 `ok`。
- 独立 closeout reviewer 再次核对 Git、Actions、两份备份、在线数据库和服务证据后给出 `APPROVE`；Harness 已将 item 标记为 `done`。
- PR #29 已通过修订后的干净 CI 并合并，手动部署 workflow run 32121157975 完成生产备份、显式 `0007` 迁移和 compatibility 发布；
- 生产 Radar 重复组从 1 降为 0；one-shot job 26 以 `applied` 终态为 22 个真实 GitHub 仓库回填稳定 ID，`unresolved=0`、`conflicts=0`；
- 10 个 `tech-stack/*` reference rows 保持无 GitHub ID，正式仓库 ID、关注名称、分组成员和 Radar 不变量复核通过；
- `REPOSITORY_IDENTITY_CUTOVER=enabled` 已只在 API 生效，生产 API/Web/Worker、Nginx 访问控制及 Keychain + SSH tunnel MCP health 均验证通过。
- Repository stable identity 的独立 production closeout review 为 `APPROVE`，Harness 已将 `data-correctness-1b-repository-identity` 标记为 `done`；
- 认证 MCP dogfood 暴露 `groups.list` 的 `repoCount` string/number 类型漂移，已确认是早于本次迁移的独立 P2 correctness follow-up。

## 当前小项

- `data-correctness-1c-group-count-contract` 已独立登记并通过 plan review；
- RED tests 已复现 PostgreSQL `count` string 泄漏到 API 输出，最小实现改为严格 runtime normalization；
- 未修改 schema、migration 或分组数据；focused API tests 与 typecheck 已通过，下一步为全仓门禁与独立 implementation review。
- 全仓四项门禁与独立 implementation review 已通过，PR #31 合并为 `main@7245b5d`；
- 无迁移 deploy run 32124923912 成功，migration rows 保持 8；认证 MCP 分组列表已恢复，7 个 `repoCount` 均为 number；
- 部署期间并行 dogfood 会话把 group members 从 16 增至 63，本修复无 group mutation，保留全部业务写入；下一步仅做独立 closeout。

## 已验证基线

2026-08-17 对 `main@b64d6a0` 与生产 PostgreSQL 完成只读检查：

- PostgreSQL 16.13，`vector` 0.8.2；
- `0000`–`0005` 六条迁移的 SHA-256 与生产迁移历史逐条一致；
- 1 个用户、20 个真实仓库、10 个技术栈 reference rows；
- 19173 个 chunks 全部含有 1024 维 embedding；
- 未发现重复 chunk key、workflow 用户错配、图自环、非法计数或 Trending 数量错配；
- DB 包 8 个测试文件、101 个单元测试通过，typecheck 通过；
- 现有持久化测试主要 mock Drizzle query builder，尚无真实 PostgreSQL 集成测试。

这些是日期化证据，不是永久不变的产品声明。需要依赖生产现状时必须重新验证。

## 当前 handoff

- 最近完成 item：`data-correctness-1a-release-id-bigint`；
- Canonical plan：`tasks/data-correctness-1a-release-id-bigint/plan.md`；
- Verification：`tasks/data-correctness-1a-release-id-bigint/verification.md`；
- 独立 correctness/迁移 review 与生产 closeout review 均已批准，生产验收已经落盘；
- 最近完成 item：`data-correctness-1b-repository-identity`；
- Canonical plan：`tasks/data-correctness-1b-repository-identity/plan.md`；
- Production baseline：`tasks/data-correctness-1b-repository-identity/verification.md`；
- 生产只读预检发现 22 个真实仓库中 19 个可解析稳定 ID、3 个 unresolved；Radar 有 1 组可确定性合并的同 ID 重复；
- 两轮 continuity review 已关闭 compatibility/backfill 窗口、lease 原子授权、不可变审计、Radar 全序 tie-break 与 active singleton 风险，最终 verdict 为 `APPROVE`；
- 稳定 ID 边界、ID-first repository/Radar 写入、one-shot backfill、lease 原子 apply、`0007` 合并迁移与 compatibility/cutover 已完成；
- 首轮实现审查发现的 Radar ID 擦除、following 错误关联和终态 version 伪报问题均已修复，continuity verdict 为 `APPROVE`；
- 全仓 lint/typecheck/test/build、真实 PostgreSQL 演练与迁移再生成检查通过；PR/CI、显式迁移、one-shot backfill、cutover 与独立 closeout 已完成；下一步先用独立小 item 修复 dogfood 暴露的 group count 契约，再进入 `data-correctness-2-atomic-replacement`。

## Harness 初始化验证

- EXharness checklist semantic validator：通过，0 warnings；
- `harness-checklist.json` 与 `harness-config.json` JSON 解析：通过；
- 10 个 Markdown 文件的本地链接目标检查：通过；
- 旧文档路径残留检查与 `git diff --check`：通过；
- `pnpm lint`：通过，保留 16 个既有前端 warnings；
- `pnpm typecheck`、`pnpm test`、`pnpm build`：通过。

## 未关闭风险

风险定义与目标设计见 [domain-model.md](domain-model.md)，当前状态和依赖见 [harness-checklist.json](harness-checklist.json)。本文件不重复维护风险表。

## 更新规则

- 只记录日期化验证摘要、完成结果和下一 handoff；
- 稳定设计变化写入对应规范，不在此复制；
- item 状态只通过 checklist 更新；
- 详细执行轨迹、review 和 receipt 写入对应 task 目录；
- 历史细节由 Git 保存，不把本文件写成逐命令流水账。
```

## Current Review Content

```md
# 分组仓库计数运行时契约审查

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
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
