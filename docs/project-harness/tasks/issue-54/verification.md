# Implementation Verification：issue-54

> 记录日期：2026-08-24
> 分支：`codex/issue-54-tree-groups`（base `main@0be6f2e`）
> 状态：本地实现与独立审查完成；未提交、push、合并、迁移、部署或关闭 GitHub Issue

## 实现范围

- 数据库：`repository_groups.parent_id` 单父级邻接树、同用户组合外键、`ON DELETE RESTRICT`、
  循环 trigger、按用户 transaction advisory lock、同级事务重排与受保护回滚脚本。
- 数据语义：旧 `repoCount` 与扁平接口继续表示直接成员；新增 `directRepoCount`、
  `aggregateRepoCount`、树读取和后代仓库去重聚合，并保留每个仓库的真实 membership 来源。
- 接口：Shared、API、Client、CLI、MCP 贯通创建子组、移动、树读取、聚合读取和完整同级重排；
  旧接口保持兼容。
- Web：首页与 `/groups` 共用树导航；聚合视图按真实 membership 移除，不制造派生关系；MVP 不引入拖拽库。
- 文档：数据模型、架构、Agent 接口与运行手册已同步；生产迁移明确使用 `pnpm db:migrate`，
  `db:push` 不可替代包含手写 function/trigger 的正式迁移。

## 验证证据

- `pnpm db:generate`：schema 与 `0011` snapshot 一致，无额外迁移漂移。
- `pnpm lint`：通过；仅保留既有 16 条 Web warning，无 error。
- `pnpm typecheck`：串行运行通过。一次与 `pnpm build` 并行时因 `.next/types` 被构建清理而出现
  `TS6053`，待 build 完成后独立重跑通过，确认是门禁资源竞争而非源码错误。
- `pnpm test`：通过；DB unit 为 14 files / 232 tests，skills pipeline 为 21 tests。
- `pnpm build`：通过；9 个任务全部成功。
- 真实 PostgreSQL 16 + pgvector 集成门禁连续两轮通过：每轮 9 files / 57 tests；每轮唯一测试库
  自动删除，最终无残留测试库，临时容器已删除。
- `git diff --check`：通过。

## 关键回归覆盖

- 现有扁平分组无损升级为根级；空层级数据可回滚；存在非空 `parent_id` 时回滚明确拒绝且约束保持。
- PostgreSQL 拒绝跨用户 parent、自循环、后代循环和删除含子组；并发反向移动不会形成循环。
- 三层树内重复仓库按后代去重，聚合成员保留全部真实 membership 来源。
- 聚合计数与成员列表共同受当前用户 watch 可见性约束；即使节点直接成员数为 1，全部不可见时
  `aggregateRepoCount` 仍为 0，回归测试可识别错误 fallback。
- 同级重排拒绝缺失、额外与重复 ID；旧 `groups.reorder` 的完整根集合语义已明确记录。
- API 删除预检只作用于删除路径；父组仍可更新，含子组删除会得到稳定错误。

## 独立审查

- Reviewer：Kimi K3，`thinking=max`，只读 native session
  `01a0328f-de2f-7452-b66a-2c56146bf4a1`。
- 首轮及复核发现均已修正；最终终审结论 `APPROVE`，无 P0–P3、无未决阻塞项。
- Reviewer 只读核验代码与测试钉住逻辑；门禁结果由 Operator 执行并记录，Reviewer 未修改工作树。

## 未执行项

- 未 commit、push、创建或合并 PR、关闭 GitHub Issue。
- 未迁移或部署生产；生产仍运行旧 schema 与旧版本。后续发布必须重新核对生产备份、迁移、
  回滚、容器健康、反向代理、访问控制和外部请求。
