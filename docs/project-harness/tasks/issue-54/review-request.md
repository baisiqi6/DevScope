# Issue #54 独立审查请求

## 角色与上下文模式

- 角色：independent Reviewer，只读；不是 Worker，也不代表 Operator。
- Context mode：`limited-fresh`。这是 high-risk schema/并发任务的最终 closeout 审查；只提供底层目标、
  canonical plan、当前代码/diff、non-goals 与验证摘要，不提供此前 Reviewer verdict。
- cwd：`/Users/Admin/projects/WorkTrees/DevScope-issue-54`
- baseline：`main` 的 `0be6f2e`；本分支改动尚未 commit，必须同时检查 tracked diff 与 untracked 文件。

## 产品目标

DevScope 的仓库分组从扁平模型演进为同一用户内的单父级树。父分组展示自身及全部后代仓库的
去重合集，但 `group_members` 仍只保存真实直接归属。旧扁平调用方不得因新能力静默改变
`repoCount` 或直接成员语义。

## 权威输入

1. `docs/project-harness/tasks/issue-54/plan.md`
2. `docs/project-harness/scope.md`
3. `docs/project-harness/architecture.md`
4. `docs/project-harness/domain-model.md`
5. `docs/project-harness/current/review-packet.md`
6. 当前 `git status`、tracked diff、untracked implementation/test/migration files

请不要相信实现者的完成声明；以当前磁盘、Git diff、schema/migration、测试代码和可重复只读检查为准。

## 必审重点

1. `0011_violet_hammerhead.sql` 与 rollback：既有数据无损、组合外键顺序、跨用户保护、
   `ON DELETE RESTRICT`、trigger/function 生命周期和只在空层级下回滚。
2. `pg_advisory_xact_lock + recursive CTE trigger` 是否足以阻止两个连接形成循环；锁 key 是否在
   app helper 与 trigger 一致；是否存在未覆盖的 INSERT/UPDATE failure mode。
3. `listRepositoryGroupTree`、`getAggregateRepositoryGroupView` 的直接/聚合计数、仓库去重、
   用户可见性、membership 来源及稳定排序。
4. create/move/reorder/delete 的事务、完整同级集合、租户边界、竞态兜底和错误语义。
5. 旧 `groups.getAll`、`groups.getWithMembers`、`repoCount`、CLI/MCP 既有行为是否兼容。
6. Shared/API/Client/CLI/MCP 是否真正共享同一契约，是否出现第二套业务逻辑或不一致 Zod schema。
7. 首页与 `/groups` 是否正确消费聚合视图；从父级视图移除仓库时是否作用于真实
   `membership.groupId`；树展开、移动、同级排序、删除与错误恢复是否有明显 correctness/a11y 问题。
8. 测试是否真正证明迁移、并发、约束、兼容与前端 helper，而非只证明 mock；是否存在关键漏测。
9. 是否引入 closure table、`ltree`、CQRS、Repository framework 等 non-goal，或存在可以删除的
   不必要复杂性。

## 已有验证声明（必须独立判断其充分性）

- `pnpm db:generate`：无 schema drift。
- 最终 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`：通过；保留 16 条既有 Web warning。
- 真实 PostgreSQL 16 + pgvector integration：连续两轮各 9 files / 57 tests 通过，无残留测试库。

Reviewer 可以运行严格只读的 `git status`、`git diff`、`rg`、`sed`、`git show` 等命令；不要运行会
写缓存、数据库或生成文件的测试/构建/格式化/迁移命令。

## 权限与 hard stop

- 允许修改：无。
- 禁止 `edit/write/apply_patch`、格式化、测试/构建、数据库写入、删除、`git add/commit/reset/clean`、
  push、merge、PR/Issue mutation、SSH、deploy、生产访问或调用其他 Agent。
- 如果完成判断需要上述权限，输出 `BLOCKED` 并说明缺失事实；不要自行扩大权限。

## 输出契约

中文为主体，精确 identifier/path 保留英文。只在 stdout 输出：

1. `Context mode: limited-fresh`
2. Findings，按 P0→P3 排序。每项必须包含 Evidence（文件和紧凑行号）、Impact、Minimal
   counterexample、Minimal correction；没有实质 finding 就明确写“无阻塞 finding”。
3. 非阻塞观察（仅确有价值时）。
4. `Verdict: APPROVE | CHANGES_REQUESTED | BLOCKED`
5. 一段说明 verdict 覆盖的范围与仍未验证事实。

不要为了显示严格而制造 finding；但任何 correctness、数据完整性、租户边界、兼容或关键测试缺口
都必须阻止 `APPROVE`。
