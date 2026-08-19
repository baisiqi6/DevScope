# 技术栈实体分离 Phase B：切换新模型读取

## Item

- Checklist item：`data-architecture-3b-technology-stack-read-cutover`
- Target mode：`new_read_dual_write`
- Priority：P1
- 前置：Phase A closeout、deps.dev cache recovery closeout、正式 PostgreSQL integration gate

## Outcome

API 与 Web 从 `technology_stacks` / `repository_technology_stacks` 读取技术栈事实，并输出 `technology_stack` graph contract（CLI/MCP 不直接解析 graph contract——经仓库列表的正向条件间接受益，无兼容改动点）；兼容期继续 dual-write legacy representation，使整个观察窗口内可确定性回退。真实仓库列表、收藏、分组、采集、Radar 与 Scheduler 不再依赖“排除伪仓库”的偶然过滤。

## Authority Boundary

本 item 只授权 consumer-first contract rollout、read cutover 和 rollback-window 验证。它不授权停止 legacy writer、删除 legacy 行、移除 `repositories.is_reference`、执行 destructive migration 或切换 AI provider。

## Required Design

### Read model

- 用户图谱先通过 `user_watched_repositories` 限定真实 source repositories，再 join `repository_technology_stacks`；
- `TECH_STACK_TOP_N` 只在查询投影层计算，不裁剪全局持久事实；**读投影的选择语义必须与 legacy 写侧/shadow `projectionKeys` 复用同一函数**（按使用仓库数降序、stack name 升序 tie-break），保证 shadow 零差异时 UI 输出也与 legacy 一致；
- 技术栈 node ID 固定为 `stack:<slug>`，kind 固定为 `technology_stack`；语言节点仍查询时合成；repo→repo 真实边来自 `repo_relationships`，**legacy 技术栈边（target 为 reference 行，即 `evidence.resolvedBy='tech-stack-catalog'`）在新读投影中排除**——repo→stack 边只从 `repository_technology_stacks` 合成，避免悬空边与双重计数；
- **真实 repository 的正向条件固定为 `github_repository_id IS NOT NULL`**（与身份回填、`repositories_github_repository_id_unique` 唯一索引和轻量行从不写入 stable ID 的写边界一致）；禁止用 `owner <> 'tech-stack'`、fullName 前缀、sbom 存在性等替代。baseline 必须核验不变量 `is_reference=false AND github_repository_id IS NULL` 为 0 行；
- 正向条件收敛的站点清单（6 处既有 `is_reference` 业务过滤：`apps/api/src/router.ts` 仓库列表、`scheduler.ts`×2、`router/groups.ts`、`packages/db/src/radar.ts`、`repository-identity.ts`；`repo-graph.ts` 内 dual-write/rebuild 机制性引用 Phase C 前保留）**加上 3 处当前未过滤的 watched-join 站点一并收敛**：`getRepository` 详情、`requireWatchedRepositoryByFullName`、embedding reconcile 列表（改为 watched + 正向条件，消除第二套偶然行为）；每个站点在 RED 清单有对应用例。

### Contract rollout

1. 先发布 consumer compatibility revision：shared schema 与 Web 2D/3D 同时接受 legacy `reference` 与新 `technology_stack`（生产 Web@916bc66 已具备双 kind 兼容；CLI/MCP 经实测不解析 graph contract，无兼容改动点，该结论记入 baseline）；
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
- 真实仓库 list/group/collection/Scheduler/Radar 不应读取 technology stack 行；3 处未过滤 watched-join 站点（`getRepository` 详情、`requireWatchedRepositoryByFullName`、embedding reconcile 列表）各自有对应用例；
- 新读投影不产生悬空边（legacy 栈边被排除）与重复 repo→stack 边（只从新表合成）；
- 读投影 top-N 与 legacy/shadow `projectionKeys` 选择语义逐 slug 一致（usage 降序 + name 升序 tie-break）；
- 正向条件恰好覆盖当前真实行、排除 reference 行（按 baseline 不变量计数）。

真实 PostgreSQL 用例至少覆盖两个用户的 disjoint/overlap watched set、同 stack 多 package evidence、成功空 relation 清理和 rebuild-vs-collection 强制交错。

### 3. Minimal implementation

- 在现有 graph query 内增加明确的 new-table projection，不引入 Repository layer、通用 graph abstraction 或第二套缓存；
- 收紧 shared graph schema 与 2D/3D kind 判断；删除对外 `isReference` 的新 contract 使用，但 compatibility consumer 在窗口内保留 legacy 解析；
- 把 repository truth 的正向条件集中到现有最接近的数据访问函数，逐个替换散落过滤；
- mode 是严格枚举且进程启动时验证；**API 与 Worker 一致性的选定机制为部署时核验**（compose 单一 `TECHNOLOGY_STACK_STORAGE_MODE` 变量同时注入两进程 + 部署后核对 revisions 与 mode），进程内各自校验支持集与启动检查，不新建 DB mode ledger 或跨进程状态；
- 启动检查与任务检查分层：mode 枚举合法、新表存在、cleaned+legacy 组合（启动时 shadow compare 得 legacyCount=0 且 newCount>0）在**进程启动**时 fail closed；shadow drift 在 **rebuild job 内**失败（既有语义）；Worker 的 shadow compare mode 门扩展到 `new_read_dual_write`（现仅 `legacy_shadow_dual_write` 分支）；
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
