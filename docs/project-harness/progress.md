# DevScope Harness 进展

> 更新时间：2026-08-18
> 基线：`main@a5824cf`
> 部署形态：Standalone
> 当前状态：技术栈实体分离 Phase A 已完成生产 backfill/shadow 验证，等待 deps.dev cache recovery 后独立收口；Phase B/C、PostgreSQL 持续门禁与 MiniMax M3 迁移均已形成可独立交接的 canonical plan

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
- PR #33 与 CI 已通过并合并为 `main@de3b917`；无迁移 deploy run `32137164791` 的 attempt 2 成功，API/Web/Worker 镜像 revision 一致，migration rows 保持 8，服务与公网 401 访问控制正常。
- 通过 Keychain + SSH tunnel 的认证 MCP 对 `deepseek-ai/deepseek-harness` 完成正常采集 dogfood：token 严格前进，chunk/Release/HN 快照一致，成功空 SBOM 规范化为 `[]`，后台 embedding 完成 `1/1`；全库 40 个真实仓库均为 `completed`，三类一致性冲突为 0。
- Hacker News 外部 API 本次返回 400，按 optional source warning 降级并保留旧快照，未破坏主采集；下一步仅进行独立 production closeout review 与 Harness 关闭。
- 独立 production closeout review 最终 verdict 为 `APPROVE`；显式 verification、Harness `mark-done`、state refresh、validator 与 doctor 均通过，`data-correctness-2-atomic-replacement` 已关闭。
- `data-architecture-3-technology-stack-entities` 已领取并完成源码/生产只读基线：10 个技术栈伪仓库、10 条伪收藏、34 条 stack dependency edges 与 203 条 packages evidence；已形成 expand、shadow validation、read cutover、legacy cleanup 的分阶段 canonical plan，等待独立 plan review。
- 技术栈实体计划首轮独立 review 要求补齐全局 per-source writer/token 护栏、严格 evidence 折叠、可兑现的 rollback 状态机与 consumer-first contract rollout；计划已按四项 finding 修订，等待 continuity review。
- continuity plan review 确认首轮四项基本闭环，但要求把 one-shot backfill 收紧为 lease-authoritative versioned singleton job，并把 cleanup 门禁真正实现到 deploy workflow/runbook；第二版计划已补齐专用 job 事务 authority 和显式 stop/drain/backup/migrate/restart 路径，等待再次复核。
- 第三次 continuity plan review 未发现剩余 P0–P3 finding，最终 verdict 为 `APPROVE`；第三项允许进入 RED tests，后续每个 phase 仍分别接受实现 review、真实 PostgreSQL 与生产门禁。
- 技术栈实体分离 Phase A 已完成纯 expand migration、versioned lease-authoritative backfill、全量 catalog dual-write、shadow compare 和 Web 2D/3D contract compatibility；API 仍保持 legacy read/output。
- 实现审查发现并关闭 stale lease、graph/backfill 双提交窗口、legacy evidence race/multiplicity、空库 terminal lease 与 SQL `NULL`/JSONB `null` 问题；真实 PostgreSQL 13/13 强制交错和全仓 lint/typecheck/test/build 通过。
- Phase A continuity implementation review 最终 verdict 为 `APPROVE`；当前尚未提交实现 PR，也未执行生产 `0008`、one-shot backfill 或 shadow rebuild，整个 item 仍为 `doing`。
- Phase A PR #35 与 CI 已通过并合并为 `main@eae3127`；deploy run `32144833809` 已完成可恢复备份、显式 `0008` expand migration 和 shadow dual-write 服务发布，revision、health、401 access control 与认证 MCP health 均通过。
- 首次生产 backfill version `phase-a-eae3127-v1` 在第一个 source 后 fail closed：历史 PostgreSQL 微秒 `updated_at` 无法与 JavaScript 毫秒 token 严格等值，job 27 重试后 `dead` 并保留 `1/40` checkpoint，没有伪成功或旧读路径破坏。
- 最小 precision fix 只把数据库 token 比较规范为毫秒，保留 stable-ID/SBOM/lease/evidence 护栏；隔离 PostgreSQL 14/14、全仓门禁与独立 review 已通过。下一步提交修复 PR、无迁移部署，并用新 version 重跑 backfill 与 shadow rebuild。
- precision fix PR #36 与 CI 已通过并合并为 `main@3fa0d9c`；无迁移 deploy run `32146784184` 成功，生产三类 image revision 一致，migration rows 保持 9，mode/health/auth/MCP 正常。
- backfill job #28、version `phase-a-token-ms-v2` 已以 `succeeded 40/40` 完成；graph job #9 attempt 1 成功，new/legacy 技术栈投影均为 79 relations、25 sources、379 packages，认证 MCP 只列出 40 个真实仓库。
- graph job #9 的冷缓存生产运行耗时约 70 分 44 秒，暴露约 6000 个 deps.dev miss、3053 个串行 GitHub canonicalization、缺少外呼 timeout/budget/freshness/progress 的 P1；已把现有 item 4 前置并形成唯一 canonical plan，Phase B 在该 P1 closeout 前暂停。
- 已把原技术栈大 item 拆为 Phase A production closeout、Phase B `new_read_dual_write` 与 Phase C `new_only -> legacy_cleaned` 三个独立 checklist item；每阶段有唯一 plan、独立 review 和明确 rollback/生产权限边界。
- 已为 `data-quality-5-postgres-integration-gates` 补齐 canonical plan：统一现有真实 PostgreSQL tests 为 root `test:integration`，接入 PostgreSQL 16 + pgvector CI service，并要求真实双连接强制交错和危险数据库 fail closed。
- 已登记 `platform-ai-7-minimax-m3-default`。计划复用 `OPENAI_COMPATIBLE_*`，先验证 Token Plan endpoint、`MiniMax-M3` 的 stream/tool/structured/cancel 契约，再做最小参数兼容、canary 和 DeepSeek rollback；BGE-M3 embedding 不变。

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

- 最近完成 item：`data-correctness-4-deps-cache-recovery`（**已 done**：PR #39 + 生产迁移 0009 + 冷/暖 rebuild + production closeout APPROVE，全链路闭环）；
- `data-architecture-3-technology-stack-entities` Phase A **已 done**（2026-08-19 closeout APPROVE：投影零差异保 multiplicity 语义独立重算、backfill/graph receipts 在位、legacy 数据未被触碰、mode 未切换）；
- `data-quality-5-postgres-integration-gates` **已 done**（PR #40：统一 test:integration 门禁、隔离契约 fail closed、自管迁移+drift 校验、43 例矩阵、CI integration job 首跑 56s 全绿；两轮 plan + 两轮 implementation review approved）；
- `data-architecture-3b-technology-stack-read-cutover` **已 done**（2026-08-19：PR #42 + 三阶段 rollout + 切换后 rebuild 零差异 ext=5 + production closeout APPROVE 16 项实测一致）。生产现运行 `new_read_dual_write`；回退 = 删 env 行 + 重启（观察窗口至 Phase C 启动前，启动前需复核 mode/计数/日志）；
- 当前 item：`data-architecture-3c-technology-stack-legacy-cleanup`（已领取，branch codex/phase-c-cleanup）：new_only 兼容 revision（停 legacy writer）→ 显式 opt-in cleanup workflow → 删除伪 repositories/伪 watched/legacy 栈边/is_reference 列与 compatibility 代码。**真实生产删除需用户对目标 SHA/备份/维护窗口的明确授权**（plan Destructive Authority Boundary）；
- `platform-ai-7-minimax-m3-default` 代码阶段完成（PR #41，approved）；生产切换已获用户授权并于 2026-08-19 执行，但遇**基础设施 blocker**：生产网络对 github.com（git pull，TLS 持续失败）与 ghcr.io（docker daemon pull EOF）同时不可达。切换于同日完成：镜像经本地 amd64 构建 + save/scp/load 绕开 ghcr EOF（构建源为 main@59066cd 干净 archive；第一次误用旧代码目录构建被 canary 的 <think> 污染当场拦截并回滚），MiniMax 三行 env 生效，durable 与 SSE 两路 canary 全过（job succeeded、完整事件流、usage 正常），两次真实 DeepSeek 回滚演练。**生产现运行 MiniMax-M3**；回滚 = 删三行 env + 重启（备份在）。
- PR #39 已通过 CI 并合并到 main（merge commit 见 Git 历史）；
- Canonical plan：`tasks/data-correctness-4-deps-cache-recovery/plan.md`；两轮 plan review approved；
- Implementation review 第一轮 changes_requested（P1 canonicalization 降级证据擦除等 10 条）已全部修复，continuity 复核 approved（evt-20260819T025237Z-c836a215）；
- 验证：db 单测 101、worker 18、api 全套、真实 HTTP 层 9、隔离 PostgreSQL 16+pgvector 串行 34（含 in-tx FOR UPDATE 租约用例）；全仓 lint/typecheck/test/build 与迁移再生成通过；
- 生产验收：冷 rebuild 588s（3061 外呼、预算 3054/6000+7/10000 单次收敛）、warm rebuild 88s（721 外呼全部可解释，598 个历史 null 行重试后 589 转权威 not_found）；服务/401/认证路径/真实仓库列表全部验证；独立 closeout review APPROVE（evt-20260819T040120Z-3daf6fbd）。

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
