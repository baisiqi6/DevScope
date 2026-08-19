# 技术栈实体分离 Phase C：停止旧写入并清理伪数据

## Item

- Checklist item：`data-architecture-3c-technology-stack-legacy-cleanup`
- Target modes：`new_only` -> `legacy_cleaned`
- Priority：P1
- 前置：Phase B production closeout

## Outcome

停止 legacy graph representation 写入，在可审计、可恢复的维护窗口中删除技术栈伪 `repositories`、伪 `user_watched_repositories`、legacy stack dependency edges 和 `repositories.is_reference`，并把新表确立为唯一持久事实来源。

## Destructive Authority Boundary

本计划是高风险执行说明，不等于立即授权生产删除。Worker 可实现、测试和演练；真实 cleanup 仍必须取得用户对目标 SHA、备份、维护窗口和生产操作的明确授权。

**cleanup 的执行载体与 journal 调和**：破坏性操作（DELETE + `DROP COLUMN`）由 opt-in workflow 调用的独立脚本执行（单事务：写 receipt + 执行删除）。schema 中的 `is_reference` 列定义随 new_only revision 移除，`db:generate` 产出的 journal migration 中的 `DROP COLUMN` 语句**改写为 receipt 守卫的 `DO` block**——存在 cleanup receipt 行（且 `to_regclass` 守卫 receipt 表存在，兼容全新环境重放）才执行 `DROP COLUMN`，否则 no-op 跳过。receipt 表本身声明进 schema（CREATE TABLE 非破坏性，journal 化无妨）。由此：常规 migrate 结构上跳过破坏性部分、fresh DB 重放安全、drizzle snapshot 与 schema 保持一致。**互斥**：cleanup 输入与 `apply_database_migration=true` 同时为 true 时 workflow 首步即 fail。

**cleaned marker = `is_reference` 列存在性**（`information_schema.columns` 检查，与 `to_regclass` 同风格）：

- 列存在：`legacy_shadow_dual_write | new_read_dual_write | new_only` 放行（保留现有子检查），`legacy_cleaned` → 启动 fail；
- 列不存在：仅 `legacy_cleaned` 放行，其余任何 mode（含缺省回落值）→ 启动 fail。

**分 revision supported set**（与启动矩阵共同生效）：

- new_only revision：仅支持 `new_only`（legacy writer/旧 compare 已删，不能声称 dual-write）；部署与 `.env` mode 翻转为 `new_only` **同批**（compose 重启窗口内完成）；
- cleanup revision：支持 `{new_only, legacy_cleaned}`；
- 终态 revision：仅 `legacy_cleaned`，`.env` 固定该值；`getRepoGraphData` 中 new_only/legacy_cleaned 的显式 throw 替换为新表读路径（读语义与 new_read 相同）。

**保留代码的谓词改写清单**（这些站点显式改写，不是"自动满足"）：收窄删除判据只用自包含的 `evidence->>'resolvedBy' = 'tech-stack-catalog'`（不读 is_reference；legacy 数据中指向 reference 行的边必然如此标记）；启动检查 counts SQL 的 `is_reference = true` 改写为 `github_repository_id IS NULL AND full_name LIKE 'tech-stack/%'`；`repo-graph.ts` 内部 6-7 处 `isReference` 读写站点（L184/222/365-375/513/699/1165 一带）换 `isRealGitHubRepository` 或删除。

## Required State Machine

```text
new_read_dual_write
  -> new_only
  -> legacy_cleaned
```

- 进入 `new_only` 前再次要求 shadow zero-diff，并明确冻结“直接切回旧镜像”的承诺；
- `new_only` 后、cleanup 前若必须回退，先从 new tables 确定性 materialize legacy 并验证零差异；
- `legacy_cleaned` 后只能通过恢复 cleanup 前数据库备份 + 上一兼容 revision 回滚；
- cleaned marker 与任何 legacy/shadow mode 组合必须 fail at startup。

## Execution Plan

### 1. New-only compatibility revision

**legacy writer 停写与冻结基线保持（P0 语义）**：

- `recomputeDependencyEdges` 的 dependency 边全量替换必须收窄到**非 legacy 栈边**（`WHERE` 排除 target 为 reference 行 / `evidence.resolvedBy='tech-stack-catalog'` 的边）——否则 new_only 首次 rebuild 会清空冻结的 legacy 栈边；
- 事务尾部两个 GC DELETE（无边引用的 reference watched、无人引用的 reference repositories）在 new_only+ 模式下**不执行**（mode 门或随 legacy writer 一同移除）；
- RED 固化：new_only 下执行完整 rebuild 后，legacy 栈边行数、伪 watched 行数、伪 repositories 行数**逐项不变**。

**冻结基线快照与比较语义**：

- 进入 new_only 前，最后一次 dual-write rebuild 通过 shadow zero-diff；随后持久化 legacy baseline 快照：full-set 的 `(githubRepositoryId, slug)` 存在性 key + packages digest（**不做 top-N 裁剪**），存独立 **receipt 表**（窗口比较器跑在 Worker 内，文件不可用）；
- 观察窗口比较改为**单向包含**：baseline key ⊆ new 全集；missing 的裁定路径 = 复核该仓库 SBOM 重采集（relation 合法消失则更新快照 receipt 并记录，禁止手工 SQL），无解释的 missing 才 fail；digest 只对 `repository_technology_stacks.updatedAt` 不晚于冻结时间的行要求一致（窗口内合法重采集导致的 digest 漂移记数不 fail）；
- 既有 `compareTechnologyStackProjection`（双向 + is_reference 读取）随 legacy writer 一同退役；新比较不读 `is_reference`。

**兼容代码删除时序**：`getRepoGraphDataLegacy`、dual-write legacy 分支、Phase A 一次性 backfill 机制、旧 compare 实现随 new_only revision 删除（隔离 PG 无列测试强制这一点）；shared `repoGraphNodeSchema` 的 `reference` kind/`isReference` 字段与 Web 双 kind 兼容随 cleanup revision 删除。

**验证**：源码扫描证明运行 SQL 不再引用 `is_reference` 或 legacy stack rows（比较/启动检查改用 marker 矩阵后自动满足）；在“`is_reference` 列不存在、legacy 伪数据不存在”的隔离 PostgreSQL 中运行 API、Worker、graph、list、group、collection、identity、Scheduler、Radar、CLI/MCP 关键路径；独立 review approved 后才进入 cleanup preparation。

### 2. Dedicated cleanup operation

在 deploy workflow 增加默认关闭、显式 opt-in 的 `technology_stack_legacy_cleanup` 操作（独立 job；workflow 顶层 `concurrency: production` 防与普通 deploy 并发；SSH `command_timeout` 按维护窗口放大；producer block 用有界机制阻止 Scheduler/API 创建新的 rebuild/backfill job；每步等待均有界，超时即退出而非无限等待）。固定顺序：

1. 校验 target SHA、API/Worker revisions、`new_only` mode 和 approved Phase B receipt；
2. 阻止 Scheduler/API 创建新的 `graph.rebuild` 或 technology-stack backfill；
3. 排空并复核相关 `queued/running/retry_wait` jobs，不重置 terminal history；
4. 停止 DevScope API/Worker；Web 可显示维护态，PostgreSQL、Nginx 和同机其他站点不重启；
5. 检查旧/长事务、advisory-lock writer 和非预期连接；
6. 创建可读取、校验过的即时备份，并记录真实仓库、watched、groups、repo edges、stack relations/evidence 的有序摘要；
7. 以有限 `lock_timeout` 与 `statement_timeout` 执行显式 cleanup migration；
8. 启动已知 new-only/cleaned revision；
9. 验证 health、401、认证 MCP、repository/watch/group/graph 以及 migration/摘要不变量；
10. 写入不可变 cleanup receipt，再解除 producer block。

任一 gate 失败必须在 destructive migration 前退出；不得通过无限等待锁或临时关闭校验继续。

### 3. Cleanup migration semantics

- 只删除能与新表一一映射且 packages evidence 摘要一致的 legacy stack edges；
- 只删除能证明属于技术栈 representation、且没有真实 group/collection 语义的伪 watched/reference rows；
- 删除前显式断言为 0（fail closed，不依赖 FK 碰巧拒绝或 cascade）：`repo_chunks`/`hackernews_items`/`releases` 对伪仓库的引用（NO ACTION 外键），以及 **`group_members` 对伪仓库的引用（cascade 外键，必须显式检查防静默级联）**；`repository_technology_stacks` 只挂真实仓库不受影响但同样断言；
- 任何孤儿、额外引用、摘要漂移或未知 `is_reference` 用法使整个 migration fail closed；
- 删除顺序服从外键，不使用宽泛名称前缀作为唯一判据；
- 最后由脚本执行数据删除与 `repositories.is_reference` 列移除（代码层面的 legacy compatibility 与 dual-write branch 删除发生在 new_only revision，不属脚本职责）。

### 4. RED and integration tests

- cleanup 保留所有真实 repositories、真实 watched/group 关系和 repo-to-repo edges；
- nonterminal job、旧 revision、旧/长事务、摘要不一致、备份不可读时拒绝 cleanup；
- migration 中途失败整体回滚，不留下半清理 schema；
- cleanup 后关键路径在真实 PostgreSQL 16 + pgvector 运行，旧 SQL 会明确失败；
- backup restore + 上一 revision + 配置恢复的完整 rollback rehearsal 通过；
- deploy workflow 的默认路径绝不运行 cleanup，只有精确 opt-in 输入可进入。

### 5. Review and production closeout

- focused tests、`pnpm test:integration` 与全仓四项门禁；
- 独立 implementation/security/operations review；
- PR/CI 合并后先 dry-run 与隔离环境演练；
- 用户明确授权维护窗口后才执行生产 cleanup；
- 独立 Reviewer 核对备份可恢复性、receipt、数据摘要、服务和 auth 后给出 production closeout。

## Rollback

cleanup 后固定执行：停止新 API/Worker -> 恢复 cleanup 前数据库备份 -> 恢复 Phase B compatibility image 与 mode -> 启动 -> 复核 legacy/new 摘要与业务不变量。不得靠重新抓取 GitHub、重新生成伪仓库或手工补行恢复。

## Exit Criteria

- 新表是技术栈唯一持久事实来源；
- legacy writer、compatibility read、`reference/isReference` contract 和 `is_reference` 列均删除；
- 伪仓库、伪收藏、legacy stack edges 清零，真实业务数据与图谱语义保持一致；
- cleanup 和 rollback 均完成真实 PostgreSQL 演练，生产 receipt 与独立 closeout approved。
