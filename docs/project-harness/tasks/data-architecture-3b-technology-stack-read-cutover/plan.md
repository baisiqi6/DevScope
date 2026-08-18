# 技术栈实体分离 Phase B：切换新模型读取

## Item

- Checklist item：`data-architecture-3b-technology-stack-read-cutover`
- Target mode：`new_read_dual_write`
- Priority：P1
- 前置：Phase A closeout、deps.dev cache recovery closeout、正式 PostgreSQL integration gate

## Outcome

API、Web、CLI 与 MCP 从 `technology_stacks` / `repository_technology_stacks` 读取技术栈事实，并输出 `technology_stack` graph contract；兼容期继续 dual-write legacy representation，使整个观察窗口内可确定性回退。真实仓库列表、收藏、分组、采集、Radar 与 Scheduler 不再依赖“排除伪仓库”的偶然过滤。

## Authority Boundary

本 item 只授权 consumer-first contract rollout、read cutover 和 rollback-window 验证。它不授权停止 legacy writer、删除 legacy 行、移除 `repositories.is_reference`、执行 destructive migration 或切换 AI provider。

## Required Design

### Read model

- 用户图谱先通过 `user_watched_repositories` 限定真实 source repositories，再 join `repository_technology_stacks`；
- `TECH_STACK_TOP_N` 只在查询投影层计算，不裁剪全局持久事实；
- 技术栈 node ID 固定为 `stack:<slug>`，kind 固定为 `technology_stack`；语言节点仍查询时合成，真实 repository edge 仍来自 `repo_relationships`；
- 所有仓库业务查询改用“真实 GitHub repository 的正向条件”，不能继续靠散落的 `is_reference=false` 作为领域边界。

### Contract rollout

1. 先发布 consumer compatibility revision：shared schema、Web 2D/3D、CLI/MCP client 同时接受 legacy `reference` 与新 `technology_stack`；
2. 用旧 API + compatibility consumer、新 API + compatibility consumer 做混合 revision 测试；
3. 所有受支持 consumer 已部署后，API 才显式进入 `new_read_dual_write`；
4. 未知 mode、数据库已 cleaned 却配置 legacy mode、缺少新表或 shadow drift 均启动失败，不自动回退。

### Writer and rollback window

- normal graph rebuild 继续在同一 source transaction 内写 new 和 legacy representation；
- 每次 rebuild 都生成按 `(source stable ID, stack slug, sorted packages)` 比较的 shadow receipt；
- rollback window 内旧 representation 必须持续新鲜；发现 drift 时停止推进，先修复并重新达到零差异；
- 回退只允许显式切回上一兼容镜像与 `legacy_shadow_dual_write`，不得修改数据或猜测重建。

## Execution Plan

### 1. Baseline and plan review

- 核对三个前置 item 均为 `done` 且独立 review approved；
- 记录当前 mode、migration rows、真实 repository/watched/group 数、new/legacy 投影摘要和所有受支持 consumer revision；
- 请求独立 plan review，重点审查 tenant boundary、top-N、mixed-version contract、rollback 与 stale writer。

### 2. RED tests

先建立失败用例：

- new read 不经 watched source join 时会泄漏另一个用户的 stack；
- top-N 被错误写入持久层时丢失低频事实；
- 旧 consumer 无法解析 `technology_stack` 的反例；
- legacy/new source、relation、packages 任一漂移时拒绝 cutover；
- unknown mode 和 cleaned+legacy mode 启动失败；
- 真实仓库 list/group/collection/Scheduler/Radar 不应读取 technology stack 行。

真实 PostgreSQL 用例至少覆盖两个用户的 disjoint/overlap watched set、同 stack 多 package evidence、成功空 relation 清理和 rebuild-vs-collection 强制交错。

### 3. Minimal implementation

- 在现有 graph query 内增加明确的 new-table projection，不引入 Repository layer、通用 graph abstraction 或第二套缓存；
- 收紧 shared graph schema 与 2D/3D kind 判断；删除对外 `isReference` 的新 contract 使用，但 compatibility consumer 在窗口内保留 legacy 解析；
- 把 repository truth 的正向条件集中到现有最接近的数据访问函数，逐个替换散落过滤；
- mode 是严格枚举且进程启动时验证，API 与 Worker 配置必须一致；
- 添加结构化 shadow/cutover diagnostics，日志不得包含 token、密码或完整敏感 prompt。

### 4. Verification and review

- focused unit/contract tests；
- `pnpm test:integration`；
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- 独立 implementation review 关闭全部 P0-P3 finding；
- PR 与 CI 通过后才能合并。

### 5. Production rollout

1. 备份并记录 target SHA、现有 mode、容器 revisions 和投影摘要；
2. 先部署 compatibility consumers，保持 legacy read；
3. dogfood Web 2D/3D、CLI/MCP graph 与 repository/group/collection 路径；
4. 部署/配置 API 与 Worker 为 `new_read_dual_write`，要求 revisions 和 mode 一致；
5. 运行受预算约束的 graph rebuild，复核 new/legacy 零差异与真实业务不变量；
6. 保持一个明确、写入量足够的 rollback observation window，记录开始/结束条件；
7. 独立 production closeout approved 后才把 item 标记 `done`。

## Exit Criteria

- 所有支持的 consumer 使用 `technology_stack` contract，node ID 稳定且无悬空边；
- API 从新表读取，dual-write 仍维持 legacy projection 零差异；
- repository/watch/group/collection/Radar/Scheduler 只表达真实 GitHub repository；
- mixed revision、跨用户、top-N、并发和 rollback 演练通过；
- Phase C 尚未启动，legacy rows 和 `is_reference` 仍完整可回退。
