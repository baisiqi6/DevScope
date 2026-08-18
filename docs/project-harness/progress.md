# DevScope Harness 进展

> 更新时间：2026-08-18
> 基线：`main@647dc62`
> 部署形态：Standalone
> 当前状态：Release ID、Repository stable identity 与 group count contract items 已关闭；下一步进入采集子数据原子替换整改

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
- 独立 production closeout review 确认上述并发写入早于部署、线上数值计数与 63 条关系一致，最终 verdict 为 `APPROVE`；Harness 已将 1C 标记为 `done`。
- `data-correctness-2-atomic-replacement` 已完成源码与生产只读基线核验：三类来源均存在空结果不清旧数据，delete/insert 分离，且 HN/Releases 把失败吞成空数组；后台 embedding 还存在第二个 chunks 替换窗口。
- 2026-08-18 生产当前有 50 个仓库行（40 个真实仓库）、35815 chunks、0 HN items、362 releases；40 个真实仓库 embedding 均为 `completed`，未发现重复 chunk natural key、Release ID 跨仓库冲突、active collection-like job 或长事务。
- 已形成 `tasks/data-correctness-2-atomic-replacement/plan.md`，下一步进行独立 plan review 后进入 RED tests。
- 原子替换计划经过五轮独立 continuity review 后获 `APPROVE`；已实现 stable-ID 锁、数据库严格单调毫秒 token、三来源 structured outcome、单事务快照提交与版本安全 embedding/SBOM 派生写入。
- 定向 DB/API 单元测试、真实 PostgreSQL 10 个事务与双连接竞争场景、全仓 lint/typecheck/test/build 均通过；未新增 migration，下一步进行独立 implementation review。
- 独立 implementation review 首轮发现 reconcile 撤销活跃 claim、malformed SBOM 误清空与并发证据不足；已完成最小修复并把真实 PostgreSQL 定向场景扩展为 10 个，等待 continuity 复核。
- continuity implementation review 确认四项 finding 均已关闭，未发现剩余 P0–P3 finding，最终 verdict 为 `APPROVE`；下一步提交 PR 并等待 CI。

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
