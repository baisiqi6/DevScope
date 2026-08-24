# Closeout Packet

> 本文件保留发起 closeout 时的快照；最终状态以 [task pointer](task_plan.md)、
> [review](review.md) 与 [verification](../tasks/issue-54/verification.md) 为准。

## Subject

- Checklist item: `issue-54`
- Reviewer: `kimi-k3-01a0328f`
- Updated at: `2026-08-24`
- Canonical plan path: `docs/project-harness/tasks/issue-54/plan.md`

## Item Snapshot

- Title: 支持单父级树状分组与后代仓库汇总
- Status: doing
- Workflow status: closeout_requested
- Priority: p2
- Owner: codex
- Session: codex-20260823-issue54
- Dependencies: data-quality-5-postgres-integration-gates

## Acceptance

现有分组无损迁移为根级；数据库拒绝跨用户父级、循环和删除含子组；父级聚合仓库去重并保留真实 membership 来源；同级排序事务化；旧 repoCount/扁平接口兼容；Web/API/Client/CLI/MCP 契约一致；PostgreSQL 迁移与并发测试及完整门禁通过

## Verification

最终 `pnpm lint/typecheck/test/build` 全通过；PostgreSQL 16 + pgvector integration 连续两轮各
9 files / 57 tests 通过且无残留库；`db:generate` 无漂移；独立终审 `APPROVE`，无 P0–P3。

## Handoff

实现与门禁完成；请独立审查 0011 迁移/回滚、advisory lock+cycle trigger、旧接口兼容、聚合 membership 来源和 Web 移除目标。禁止修改、提交、push、部署或生产迁移。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

````md
# 单父级树状分组与后代仓库汇总

## Item

- Checklist item：`issue-54`
- GitHub Issue：[#54](https://github.com/baisiqi6/DevScope/issues/54)
- Priority：P2
- 风险模式：`high-risk`（schema、迁移、递归约束和并发）
- 分支：`codex/issue-54-tree-groups`
- 状态：本地实现、门禁与独立 Reviewer 审查完成；未提交或发布

## Outcome

在不改变仓库多分组关系的前提下，为 `repository_groups` 增加单父级邻接表结构。父分组读取其自身与全部后代仓库的去重合集，数据库负责阻止跨用户父子关系、循环和删除含子组的分组；Web、API、Client、CLI 与 MCP 共用同一契约。

## 产品与兼容性契约

1. `parentId = null` 表示根分组；一个分组最多一个父级，不支持 DAG。
2. `repoCount` 在兼容接口中继续表示直接成员数量，并作为 `directRepoCount` 的兼容别名；新增 `aggregateRepoCount` 表示自身及全部后代的仓库去重数。
3. 现有 `groups.getAll` 和 `groups.getWithMembers` 保留扁平列表、直接成员与 `repoCount` 语义；树读取和聚合成员使用新接口，避免旧调用方静默改变行为。
4. 聚合成员包含仓库真正的直接分组归属。Web 在父级聚合视图中把移除操作发送到真实成员分组，不制造派生 `group_members`。
5. 同级顺序由 `(userId, parentId, orderIndex)` 解释。重排请求必须提交目标父级下完整、无重复的同级 ID 排列，并在一个事务内完成。
6. 删除含直接子分组的分组默认失败；删除叶子分组仍级联删除该组自己的 `group_members`。

## 最小设计

### 数据库

- `repository_groups.parent_id` 使用可空自引用；增加 `(id, user_id)` 唯一键和 `(parent_id, user_id) -> (id, user_id)` 组合外键，数据库直接拒绝跨用户挂载并使用 `ON DELETE RESTRICT` 保护子分组。
- 增加 `(user_id, parent_id, order_index)` 同级读取索引，不把排序唯一性做成会妨碍事务内重排的额外状态机。
- 使用一个最小 trigger + 递归 CTE 阻止自循环和后代循环。所有层级写入先取得按 `userId` 的 transaction advisory lock，避免两个连接并发形成 `A -> B`、`B -> A`。
- 迁移只增加可空列和约束，现有行自然保持为根级；回滚删除 trigger/function、外键、索引与列，不改 `group_members`。

### API 与共享契约

- 扩展 `repositoryGroupSchema`：`parentId`、`directRepoCount`、`aggregateRepoCount`；`repoCount` 保留。
- `groups.getTree` 返回同级稳定排序的嵌套树。
- `groups.getAggregateWithMembers` 返回去重仓库及每个仓库的直接 membership 来源。
- `groups.create` 接受可选 `parentId`；新增 `groups.move` 与 `groups.reorderSiblings`。API 提供友好校验，数据库约束仍为最终 authority。
- `groups.delete` 先检测子组并返回稳定业务错误；数据库外键继续兜底。

### Client、CLI 与 MCP

- Client facade 暴露 tree、aggregate-members、create-child、move 与 sibling reorder。
- CLI 增加对应 group 子命令；JSON 输出继续经 Zod 校验。
- MCP 增加等价工具，不直接访问数据库，也不复制树业务逻辑。

### Web

- 首页与 `/groups` 共用树状分组导航，支持展开/折叠并保留明确的选中状态。
- `/groups` 选中父组时展示去重聚合仓库；显示直接来源分组，移除操作作用于真正 membership。
- MVP 使用明确的父级选择/“移动到”操作，不引入拖拽库；根级与子级均可同级排序。

## 实施顺序

1. 更新 Issue 契约、Harness item 和本计划，完成边界审查。
2. 修改 Drizzle schema，运行 `pnpm db:generate`，逐行审查显式迁移并补充安全的 trigger/function SQL。
3. 增加真实 PostgreSQL migration/constraint/concurrency/aggregate integration tests；连续运行两次。
4. 扩展 Shared、API 与单元测试，保持旧接口兼容。
5. 扩展 Client、CLI、MCP 及契约测试。
6. 更新 Web 两个入口与页面测试。
7. 更新 `domain-model.md`、`architecture.md`、`AGENT_INTERFACES.md`、`runbook.md` 和 `progress.md`；不在这些文件重复本计划正文。
8. 运行完整门禁，生成 closeout packet，交由独立 Reviewer 审查后再关闭 item。

## 验收与验证

- 迁移前已有分组全部保持根级，成员数量与成员关系不变；回滚脚本在迁移演练库可执行。
- 三层树创建、移动和读取成功；自循环、后代循环、跨用户 parent、删除含子组均由 PostgreSQL 拒绝。
- 两条独立连接并发执行相反移动时不可能形成循环，测试设置 statement/test timeout。
- 同一仓库直接属于多个后代时，父级聚合列表与 `aggregateRepoCount` 均只出现一次，同时保留全部直接 membership 来源。
- 同级重排拒绝缺失、额外和重复 ID；成功重排为单事务。
- 旧 `getAll`、`getWithMembers`、`repoCount`、现有 CLI/MCP 行为保持兼容。
- 首页、`/groups`、API、Client、CLI、MCP 对树、计数和聚合语义一致。
- 通过：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:<port>/postgres \
  TEST_DATABASE_DESTRUCTIVE=1 NODE_ENV=test pnpm test:integration
```
````

- `test:integration` 连续运行两次且没有残留测试库。

## 范围边界

- 不实现多父级、跨用户共享、自动分类、AI 自动移动或级联删除。
- 不引入 closure table、`ltree`、图数据库、CQRS、Repository 框架或第二套分组模型。
- 不顺手修复现有 `groupMembers.move/reorder` 的相邻事务问题，除非新聚合交互必然调用且正确性无法隔离。
- 本 item 不包含生产迁移、部署、push、merge 或 Issue 关闭；这些动作需要后续明确授权和门禁证据。

## 回滚与退出条件

- 代码回滚：撤销本 item 变更后旧扁平接口仍可运行。
- 数据库回滚：仅在确认没有任何非空 `parent_id` 后删除树约束与列；若已有层级数据，必须先导出并人工确认降级策略，禁止静默扁平化。
- 任一数据库约束无法被真实 PostgreSQL 测试证明、兼容接口发生静默语义变化、或现有未提交改动发生冲突时停止并记录 blocker。
- 独立 Reviewer `approved`、完整门禁通过且验证摘要写入 Harness 后，才具备 closeout 条件。

## 当前验证记录

- `pnpm db:generate` 确认 schema 与 `0011` snapshot 一致，无额外迁移；
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 最终版本全部通过；lint/build
  只保留本 item 之前已有的 16 条 Web warning；
- 真实 PostgreSQL 16 + pgvector 集成门禁连续两轮通过：每轮 9 个测试文件、57 项测试；
- 最终静态审查修复了删除子组预检误置于 update 路由的问题，并增加“父组可改名、含子组不可删”
  两项 API 回归测试；Kimi K3 `thinking=max` 独立终审为 `APPROVE`，无 P0–P3；
- 聚合可见性 fallback 已修为 0，并由“直接成员数为 1、全部不可见时聚合计数为 0”的真实
  PostgreSQL 断言钉住；完整证据见 [verification.md](verification.md)；
- 生产迁移、部署、push、merge 与 Issue 关闭仍不在当前 authority 内。

````

## Recent Progress Context

```md
### Issue #54 本地验证进度

- 隔离分支 `codex/issue-54-tree-groups` 已实现单父级邻接树、组合外键、循环 trigger、按用户
  advisory lock、直接/聚合计数与真实 membership 来源；
- Shared、API、Client、CLI、MCP、首页和 `/groups` 已贯通树读取、聚合成员、创建子组、移动与
  完整同级重排，并保留旧扁平读取、直接成员与 `repoCount` 语义；
- 真实 PostgreSQL 16 + pgvector 集成门禁已连续两轮通过，每轮 9 个测试文件、57 项测试；
- 最终版本的 `lint/typecheck/test/build` 已全部通过；静态审查发现并修复一处 API 删除预检位置
  错误及聚合可见性 fallback，并补齐回归测试；Kimi K3 `thinking=max` 独立终审 `APPROVE`，
  无 P0–P3。完整证据见 [verification](tasks/issue-54/verification.md)。本记录不表示生产已具备
  `0011` schema，也不授权提交、push、合并、迁移或部署。

## 已完成整改

| 领域 | 已完成结果 | 详细证据 |
|---|---|---|
| Release ID | GitHub Release ID 无损迁移为 `bigint`，生产迁移、回滚与大 ID 往返已验证 | [verification](tasks/data-correctness-1a-release-id-bigint/verification.md) |
| 仓库身份 | 正式仓库统一使用 GitHub stable ID，rename、Radar 去重与 production cutover 已关闭 | [verification](tasks/data-correctness-1b-repository-identity/verification.md) |
| 分组计数 | `repoCount` 已在 API 边界归一为 number，生产 MCP 复查通过 | [verification](tasks/data-correctness-1c-group-count-contract/verification.md) |
| 采集一致性 | chunks、Releases、HN、SBOM 与 embedding 改为版本安全的原子替换 | [verification](tasks/data-correctness-2-atomic-replacement/verification.md) |
| 技术栈 Phase A | 独立实体、新表、backfill、dual-write 与 shadow zero-diff 完成 | [verification](tasks/data-architecture-3-technology-stack-entities/verification.md) |
| deps.dev 缓存 | `resolved/not_found/error` 恢复语义、timeout、有界并发、预算与冷暖 rebuild 完成 | [verification](tasks/data-correctness-4-deps-cache-recovery/verification.md) |
| PostgreSQL 门禁 | 真实 PostgreSQL 16 + pgvector 的迁移、事务、锁与并发矩阵进入 CI required checks | [verification](tasks/data-quality-5-postgres-integration-gates/verification.md) |
| 技术栈 Phase B | 图谱读取切换到新实体模型，分阶段生产切换与 closeout 完成 | [verification](tasks/data-architecture-3b-technology-stack-read-cutover/verification.md) |
| 技术栈 Phase C | 停止旧写入，清理 79 条旧栈边、13 个伪仓库、13 个伪收藏和 `is_reference` | [verification](tasks/data-architecture-3c-technology-stack-legacy-cleanup/verification.md) |
| AI Provider | 默认分析模型切换为 MiniMax M3，durable/SSE canary 与 DeepSeek 回滚演练完成 | [verification](tasks/platform-ai-7-minimax-m3-default/verification.md) |

## 当前生产基线

2026-08-20 UTC 07:03 后完成只读复核：

- DevScope MCP health 为 `ok`，未认证公网入口返回 `401`；
- API、Web、Worker 均运行 `ce7ff16`，PostgreSQL 16 + pgvector 容器健康，服务器工作树干净；
- 正式仓库 40、伪仓库 0、伪收藏 0；`is_reference` 列已删除；
- 图谱为 40 个 repository + 9 个 language + 13 个 technology stack 节点，共 249 条边；
- 新表保存 13 个技术栈和 79 条 repository-to-stack 关系；cleanup receipt 与 baseline receipt 均在位；
- `package_repo_mappings` 中 9 条历史 `error` 行均对应当前 SBOM 已不再使用的旧 package version，不是活跃解析失败；
- GitHub Ruleset `main-required-checks` 已要求 `quality` 与 `integration`，最新 `main` 两项均通过。

这些是日期化运行证据，不替代 [architecture.md](architecture.md)、[domain-model.md](domain-model.md) 或各 task verification 的稳定事实。

## 当前 handoff

- 当前只按 [Issue #54 canonical plan](tasks/issue-54/plan.md) 收口树状分组，不继续沿用 Phase A/B/C
  与部署链路的历史 handoff；
- `product-6-public-multi-user-hardening` 仍为 `todo`，不与 Issue #54 并行启动；
- 持久 dogfood 产品反馈统一进入 [dogfood-observations.md](dogfood-observations.md)，修复计划和 checklist 状态不得在该登记册重复维护；
- 自动部署的成功证据与回滚 revision 已写入 [operations-8 verification](tasks/operations-8-proxy-independent-deploy/verification.md)；后续性能优化不得恢复服务器侧 `git pull/docker pull`。

## 更新规则

- 只保留当前状态、日期化验证摘要、完成结果与下一 handoff；
- 稳定设计写入对应规范，详细 review/receipt 写入 task verification，历史过程由 Git 保存；
- item 状态只通过 checklist 和 `harnessctl` 更新；
- `harness-state.json` 只由 Harness runtime 派生，不手写成第二来源。
````

## Current Review Content

```md
# 当前审查

## Issue #54：支持单父级树状分组与后代仓库汇总

- Reviewer：Kimi K3，`thinking=max`，只读独立审查；native session `01a0328f-de2f-7452-b66a-2c56146bf4a1`。
- 最终结论：`APPROVE`；无 P0–P3，全部 review 发现已闭环。
- 最终复核重点：有直接 membership、但全部成员对当前用户不可见的子组必须得到
  `directRepoCount = 1`、`aggregateRepoCount = 0`；真实 PostgreSQL 回归断言已能阻止
  fallback 被改回未过滤的直接计数。
- Reviewer 未修改文件、未执行提交、push、部署或生产迁移；门禁由 Operator 执行。
- 完整证据见 [Issue #54 验证记录](../tasks/issue-54/verification.md)。

本地实现具备 Harness closeout 条件，但仍未提交、push、合并、迁移或部署；GitHub Issue 也未关闭。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
