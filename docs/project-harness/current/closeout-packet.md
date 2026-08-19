# Closeout Packet

## Subject

- Checklist item: `data-architecture-3b-technology-stack-read-cutover`
- Reviewer: `reviewer-pb-closeout`
- Updated at: `2026-08-19`
- Canonical plan path: `docs/project-harness/tasks/data-architecture-3b-technology-stack-read-cutover/plan.md`

## Item Snapshot

- Title: 技术栈实体分离 Phase B：切换新模型读取
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: codex
- Session: codex-20260819-phase-b
- Dependencies: data-architecture-3-technology-stack-entities, data-correctness-4-deps-cache-recovery, data-quality-5-postgres-integration-gates

## Acceptance

API/Web/CLI/MCP 使用 technology_stack contract 和新表读取；legacy dual-write 在明确 rollback window 内保持零差异，真实仓库业务路径不依赖伪仓库过滤。

## Verification



## Handoff

三个前置 item 全部 closeout 后领取；只做 consumer-first read cutover，不停止旧写入、不清理 legacy 数据。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
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
```

## Recent Progress Context

```md
### 上一 handoff（1b 已并入 main，存档）



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
- 最近完成 item：`data-correctness-2-atomic-replacement`；
- Canonical plan：`tasks/data-correctness-2-atomic-replacement/plan.md`；
- Verification：`tasks/data-correctness-2-atomic-replacement/verification.md`；
- 原子快照、版本安全 embedding、PR/CI、无迁移部署、生产 MCP dogfood 与独立 closeout 均已完成；下一 item 为 `data-architecture-3-technology-stack-entities`。
- 当前 item：`data-architecture-3-technology-stack-entities`；
- Canonical plan：`tasks/data-architecture-3-technology-stack-entities/plan.md`；
- Verification：`tasks/data-architecture-3-technology-stack-entities/verification.md`；
- Phase A expand、precision fix、versioned backfill、shadow zero-diff 与生产 MCP/health/auth 证据均已完成；独立 production closeout 尚未执行。下一步先完成 `data-correctness-4-deps-cache-recovery` 的恢复语义和外呼预算，再由 Reviewer 复核，不能提前进入 Phase B 或标记 done。
- 可并行 item：`platform-ai-7-minimax-m3-default`；其 provider 迁移与数据整改使用独立 PR、部署和 closeout。
- 后续串行 item：Phase A closeout -> `data-quality-5-postgres-integration-gates` -> Phase B -> Phase C。

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
# 当前审查

`data-architecture-3-technology-stack-entities` 的 Phase A expand、precision fix、versioned backfill、生产 shadow zero-diff 与 MCP/health/auth 已完成；证据见 [任务验证记录](../tasks/data-architecture-3-technology-stack-entities/verification.md)。生产 graph rebuild 虽正确成功，但 70 分 44 秒的冷缓存路径暴露外呼 timeout/budget/freshness/progress P1，唯一后续方案为 [依赖解析缓存恢复与外呼预算计划](../tasks/data-correctness-4-deps-cache-recovery/plan.md)。当前暂停在 Phase A production closeout 前；Reviewer 批准 item 4 和 Phase A closeout 前不得进入 Phase B/C 或标记整个 item 完成。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
