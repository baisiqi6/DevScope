# Implementation Verification：issue-54

> 记录日期：2026-08-24
> 分支：`codex/issue-54-tree-groups`（base `main@0be6f2e`）
> 状态：实现、PR/CI、生产迁移部署与运行复核完成

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

## 生产发布与回执

- PR [#55](https://github.com/baisiqi6/DevScope/pull/55) 在 `quality`、`integration` 两项 CI
  成功后合并；GitHub Issue #54 自动关闭。生产目标为 merge commit
  `63ec7c5e68c1a63fa7f6e1a918a5677db12b9cff`。
- 手动部署 run
  [32704273873](https://github.com/baisiqi6/DevScope/actions/runs/32704273873) 使用
  `apply_database_migration=true`、`technology_stack_legacy_cleanup=false`，build 与 deploy
  均成功；服务器通过 Git bundle、镜像 archive、checksum 与 fast-forward 门禁更新。
- 发布前独立备份目录：
  `/home/devscope/backups/devscope/release-issue54-20260824-080029-63ec7c5/`，包含 `.env`、
  Nginx `server-local` 与 PostgreSQL custom-format dump；三项 SHA-256 均通过，dump 已由容器内
  `pg_restore --list` 验证可读。workflow 自身备份
  `/home/devscope/backups/devscope/pre-migration-20260824-160927.dump` 亦验证可读、权限 `600`。
- 迁移前后不变量：migration journal `11 → 12`；`repository_groups = 15`、
  `group_members = 86` 保持不变；迁移后 15 个分组全部为根级，非根分组为 0。
- 数据库对象：`repository_groups_parent_user_fk`、`repository_groups_hierarchy_guard` 与
  `enforce_repository_group_hierarchy` 均存在；无超过 30 秒的长事务。
- API、Web、Worker 均运行目标 revision `63ec7c5`；rollback tags 均精确指向发布前
  `4772098`；PostgreSQL 健康、Nginx 配置校验成功、服务器工作树干净。
- 生产读取：health 200、Web 200；`groups.getTree` 返回 15 个根组和聚合总数 86；分组 3 的
  direct/aggregate/members 均为 27，membership 来源完整；近 10 分钟错误/5xx 扫描为空。
- 访问控制：服务器 Nginx 与 SSH tunnel 未认证均返回 401；经 Keychain 注入的 MCP health 和
  `list_groups` 成功。公网 `http://devscope.cn` 由阿里云返回 `403 Non-compliance ICP Filing`，
  因而当前仍以 SSH tunnel 为生产使用入口；这不是本次应用部署故障。
