# 技术栈实体分离 Phase C：停止旧写入并清理伪数据

## Item

- Checklist item：`data-architecture-3c-technology-stack-legacy-cleanup`
- Target modes：`new_only` -> `legacy_cleaned`
- Priority：P1
- 前置：Phase B production closeout

## Outcome

停止 legacy graph representation 写入，在可审计、可恢复的维护窗口中删除技术栈伪 `repositories`、伪 `user_watched_repositories`、legacy stack dependency edges 和 `repositories.is_reference`，并把新表确立为唯一持久事实来源。

## Destructive Authority Boundary

本计划是高风险执行说明，不等于立即授权生产删除。Worker 可实现、测试和演练；真实 cleanup 仍必须取得用户对目标 SHA、备份、维护窗口和生产操作的明确授权。普通 deploy 或普通 `db:migrate` 不能隐式触发 cleanup。

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

- 先用源码扫描和 PostgreSQL query logging 证明运行 SQL 不再引用 `is_reference` 或 legacy stack rows；
- 在“`is_reference` 列不存在、legacy 伪数据不存在”的隔离 PostgreSQL 中运行 API、Worker、graph、list、group、collection、identity、Scheduler、Radar、CLI/MCP 关键路径；
- 停止 legacy writer，但暂不删数据；在观察窗口持续比较 new projection 与冻结的 legacy baseline；
- 独立 review approved 后才进入 cleanup preparation。

### 2. Dedicated cleanup operation

在 deploy workflow 增加默认关闭、显式 opt-in 的 `technology_stack_legacy_cleanup` 操作。固定顺序：

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
- 任何孤儿、额外引用、摘要漂移或未知 `is_reference` 用法使整个 migration fail closed；
- 删除顺序服从外键，不使用宽泛名称前缀作为唯一判据；
- 最后移除 `repositories.is_reference`、legacy compatibility code 与 dual-write branch。

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
