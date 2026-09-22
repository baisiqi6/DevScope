# Closeout Packet

## Subject

- Checklist item: `df-20260822-001-hn-release`
- Reviewer: `dogfood_remediation_reviewer`
- Updated at: `2026-09-22`
- Canonical plan path: `docs/project-harness/tasks/df-20260822-001-hn-release/plan.md`

## Item Snapshot

- Title: 发布 Hacker News 可选字段修复
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: codex
- Session: codex-20260922-df-hn-release
- Dependencies: df-20260822-001-hn-optional-fields

## Acceptance

PR required checks 通过并合并；生产无迁移部署成功且 revision 精确；访问控制与容器健康；agency-agents 云端复采 HN 无 warning 且 hnItemsCollected>0、embedding terminal success；独立 closeout 后关闭 DF。

## Verification

PR #70 required checks 通过并合并为 791ebab9；显式备份可读；deploy 35684007072 无迁移/cleanup 成功；服务器与三镜像 revision 精确一致，健康/认证/Nginx/日志通过；agency-agents repo 1289 复采 HN=9 无 warning，新 embedding 250/250 completed/100% 且 outcome applied；DF 已关闭。

## Handoff

生产验证完成，等待独立 closeout Reviewer 核验后 mark-done；无需再次部署。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# DF-20260822-001：Hacker News 可选字段修复发布

## Item

- Checklist item：`df-20260822-001-hn-release`
- 依赖：`df-20260822-001-hn-optional-fields`
- 关联 observation：`DF-20260822-001`
- 风险模式：high-risk（PR 合并、生产部署、云端仓库重新采集）
- 分支：`codex/df-20260822-001-hn-release`
- 当前阶段：生产部署与受控复采完成，等待独立 closeout

## 目标

将已独立审查通过的 HN Algolia 可选字段兼容修复通过 PR/CI 发布到生产，并用一个已知复现样本完成云端重新采集，确认 HN enrichment 恢复后关闭 `DF-20260822-001`。

## 发布范围

- 提交并 push 当前已审查的代码、测试与 Harness 记录。
- 创建 PR，等待 required `quality` 与 `integration` checks，通过后合并。
- 合并后立即核对 GitHub `main` head 与 PR merge SHA 完全一致；只在未漂移时对 `main` 手动触发 `Build and Deploy`，固定 `technology_stack_legacy_cleanup=false`、`apply_database_migration=false`，并要求 run `headSha` 等于该 merge SHA。若 `main` 已漂移则停止并重新审查目标。
- 部署后验证精确 revision、容器健康、未认证 `401`、认证 health/home `200`、近期 API/Worker 日志。
- 通过生产 DevScope CLI/MCP 重新采集 `msitarzewski/agency-agents`：采集前记录现有 embedding `startedAt`/`completedAt`/总数，记录请求起始时间；采集后要求本次返回的 repository ID 仍为既有目标、`hnItemsCollected > 0` 且无 HN warning，并要求 `--wait` 返回的新 embedding 状态为 `completed / 100%`、`startedAt` 不早于本次请求且不同于旧值、`completedChunks = totalChunks = collection.chunksCollected`。

## 安全与回滚

- 本次无 schema 或迁移文件变化，不执行 `db:push` 或数据库 migration。
- 普通无迁移 workflow 不自动备份 `.env`、Nginx 或数据库。部署前由 Operator 在生产主机创建本次独立备份目录（mode `700`），显式复制 `.env` 与 DevScope Nginx/server-local 配置并设为 mode `600`；同时创建 PostgreSQL custom-format dump、设为 mode `600` 并用 `pg_restore --list` 验证可读。只记录脱敏路径、权限与可读性，不输出内容。
- 生产工作树必须 clean，只允许 fast-forward；部署 run 必须绑定并回读精确 merge SHA。
- 只重建 DevScope API/Web/Worker，不修改 DNS、证书、凭据或同机其他站点配置。
- 部署失败恢复 workflow 保留的上一组 `rollback` 镜像；业务复采失败不绕过 HN/Zod/事务边界，保留 observation 并回滚或继续诊断。
- 如部署或复采需要整体数据回退，使用本次 Operator 创建并验证过的 custom-format dump；不得用删表、手工补行或重新抓取代替恢复。
- 重新采集走公开 CLI/MCP 边界，不直接修改 PostgreSQL。

## 验收标准

- PR 的 `quality` 与 `integration` required checks 成功，合并提交 SHA 明确。
- deploy workflow 成功，生产 API/Web/Worker revision 与合并 SHA 一致。
- 生产访问控制、容器健康、Nginx 及同机站点未退化。
- `msitarzewski/agency-agents` 主采集完成，repository ID 与目标一致，HN enrichment 不再返回 `invalid_type` warning，`hnItemsCollected > 0`；本次新 embedding 通过请求时间、变化后的 `startedAt` 与 chunk 计数绑定，并到达 `completed / 100%`。
- 生产验证证据写入本计划、`progress.md` 与 `dogfood-observations.md`；只有上述业务验收通过后将 `DF-20260822-001` 置为 `closed`。
- 独立 closeout Reviewer 核验 GitHub、部署与生产业务证据后方可关闭本 item。

## 当前 Handoff

生产发布与 `agency-agents` 受控复采已完成，所有业务验收通过；等待独立 Reviewer 核验 GitHub、部署、备份、访问控制和本次复采证据后关闭 release item。

## Review 修正

- 已纠正备份事实：`.env`、Nginx 与无迁移数据库备份为 Operator 显式前置，不冒充 workflow 自动能力。
- 已将 embedding 验收绑定到本次复采：保存旧时间戳与计数，要求新 `startedAt`、请求时间和本次 `chunksCollected` 一致。
- 已增加 dispatch head gate：`main` 与 merge SHA 不一致时停止，workflow run `headSha` 必须精确匹配。

## Production Verification

- PR #70：`quality` 与 `integration` 成功；merge SHA `791ebab9fd68f0e6866631d6450edec78134e660`。
- 部署前显式备份目录：`/home/devscope/backups/devscope/pre-hn-release-20260922T033900Z-791ebab9`；目录 mode `700`，`.env`、Nginx archive 与 custom-format dump 均为 mode `600`，`pg_restore --list` 验证可读。
- Deploy run：`35684007072`；`headSha` 精确等于 merge SHA，`technology_stack_legacy_cleanup=false`、`apply_database_migration=false`，build/deploy 成功、cleanup skipped。
- 生产服务器 HEAD 与 API/Web/Worker 三镜像 revision 均为 `791ebab9fd68f0e6866631d6450edec78134e660`；工作树 clean，PostgreSQL healthy，内部 API/Web health、`nginx -t` 通过，近期 API/Worker 无目标错误模式。
- SSH tunnel 未认证 health 返回 `401`，Keychain 认证 health 返回 `ok`；部署前后 `.env` 与 Nginx 配置一致。
- 复采前 repo ID `1289` 的 embedding 为 250/250、旧 `startedAt=2026-09-21T18:30:23.830Z`。本次请求开始于 `2026-09-22T03:52:35Z`；复采仍返回 repo ID `1289`，主采集 `completed`、`chunksCollected=250`、`hnItemsCollected=9`、无 warning。
- 本次新 embedding 为 `startedAt=2026-09-22T03:52:38.421Z`、`completedAt=2026-09-22T03:52:46.371Z`、250/250、`completed / 100%`；API 日志记录 outcome `applied`，且没有 `invalid_type`、`Hacker News:` 或 `Expected string, received undefined`。
- `DF-20260822-001` 已依据上述生产业务证据置为 `closed`。
```

## Recent Progress Context

```md
### Issue #54 生产 closeout

- 隔离分支 `codex/issue-54-tree-groups` 已实现单父级邻接树、组合外键、循环 trigger、按用户
  advisory lock、直接/聚合计数与真实 membership 来源；
- Shared、API、Client、CLI、MCP、首页和 `/groups` 已贯通树读取、聚合成员、创建子组、移动与
  完整同级重排，并保留旧扁平读取、直接成员与 `repoCount` 语义；
- 真实 PostgreSQL 16 + pgvector 集成门禁已连续两轮通过，每轮 9 个测试文件、57 项测试；
- 最终版本的 `lint/typecheck/test/build` 已全部通过；静态审查发现并修复一处 API 删除预检位置
  错误及聚合可见性 fallback，并补齐回归测试；Kimi K3 `thinking=max` 独立终审 `APPROVE`，
  无 P0–P3。完整证据见 [verification](tasks/issue-54/verification.md)。该本地验证记录本身不表示
  生产已具备 `0011` schema。
- PR #55 在 `quality` 与 `integration` 成功后合并，Issue #54 已关闭；生产 migration journal
  从 11 增至 12，15 个旧分组全部保持根级，86 条 membership 不变；组合外键、cycle trigger/function
  均存在；
- 发布前独立备份与 workflow 备份均验证可读；运行镜像为 `63ec7c5`，rollback 镜像为 `4772098`；
  API/Web、树读取、聚合读取、MCP 隧道认证、Nginx 与近期错误日志复核通过；详细回执见
  [verification](tasks/issue-54/verification.md)。

## 已完成整改

| 领域            | 已完成结果                                                                        | 详细证据                                                                                   |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Release ID      | GitHub Release ID 无损迁移为 `bigint`，生产迁移、回滚与大 ID 往返已验证           | [verification](tasks/data-correctness-1a-release-id-bigint/verification.md)                |
| 仓库身份        | 正式仓库统一使用 GitHub stable ID，rename、Radar 去重与 production cutover 已关闭 | [verification](tasks/data-correctness-1b-repository-identity/verification.md)              |
| 分组计数        | `repoCount` 已在 API 边界归一为 number，生产 MCP 复查通过                         | [verification](tasks/data-correctness-1c-group-count-contract/verification.md)             |
| 采集一致性      | chunks、Releases、HN、SBOM 与 embedding 改为版本安全的原子替换                    | [verification](tasks/data-correctness-2-atomic-replacement/verification.md)                |
| 技术栈 Phase A  | 独立实体、新表、backfill、dual-write 与 shadow zero-diff 完成                     | [verification](tasks/data-architecture-3-technology-stack-entities/verification.md)        |
| deps.dev 缓存   | `resolved/not_found/error` 恢复语义、timeout、有界并发、预算与冷暖 rebuild 完成   | [verification](tasks/data-correctness-4-deps-cache-recovery/verification.md)               |
| PostgreSQL 门禁 | 真实 PostgreSQL 16 + pgvector 的迁移、事务、锁与并发矩阵进入 CI required checks   | [verification](tasks/data-quality-5-postgres-integration-gates/verification.md)            |
| 技术栈 Phase B  | 图谱读取切换到新实体模型，分阶段生产切换与 closeout 完成                          | [verification](tasks/data-architecture-3b-technology-stack-read-cutover/verification.md)   |
| 技术栈 Phase C  | 停止旧写入，清理 79 条旧栈边、13 个伪仓库、13 个伪收藏和 `is_reference`           | [verification](tasks/data-architecture-3c-technology-stack-legacy-cleanup/verification.md) |
| AI Provider     | 默认分析模型切换为 MiniMax M3，durable/SSE canary 与 DeepSeek 回滚演练完成        | [verification](tasks/platform-ai-7-minimax-m3-default/verification.md)                     |
| 外部资源工作区 | Web 外部资源工作区、独立分组、分页/密度切换与正文异步采集/状态读取已部署；全文检索、embedding 和多用户仍未进入范围 | [product-11 plan](tasks/product-11-external-resource-content-ingestion/plan.md) |
| Dogfood 五项整改 | 分组摘要、许可证语义、仓库生命周期、Agent 分组操作面与 HN enrichment 已部署并完成只读复核；等待真实写入/采集样本 | [verification](tasks/dogfood-2026-08-remediation/verification.md) |

## 当前生产基线

当前为上述 2026-09-06 图谱发布；下列内容仅为历史快照。

### 2026-09-01 历史快照

2026-09-01（deploy run `33475333993`）完成 dogfood 五项整改的生产部署与只读回读：

- 目标为 PR #59 合并提交 `05aa9e192a5ca95cb49ffc628617afc0e36af83d`；`technology_stack_legacy_cleanup=false`，仅显式应用 migration `0013`，workflow 成功；
- migration `0013` 文件 SHA-256 为 `fe17db6ecf5eebdc06c77756c93b1173efb4973a90f5fac2a0ba8f8d795574ed`，与生产 journal 一致；迁移前 custom-format 备份权限为 mode `600`，`pg_restore --list` 可读；
- API、Web、Worker 均运行目标 revision，服务器工作树 clean；PostgreSQL 16 + pgvector healthy；
- SSH tunnel 未认证请求返回 `401`，Keychain 注入认证后的 health/home 只读请求返回 `200`；MCP 工具清单为 35 项，`technologyStacks` 删除影响预检可读；
- 本次未执行真实仓库 `archive`/`delete` mutation，也未重新采集仓库，因此五条 dogfood observation 继续保持 `fixed_pending_verification`；
- 未修改 DNS、证书、Nginx、凭据或同机其他站点。

历史快照（不作为当前运行基线）：2026-08-29 的 `67fc629` + migration `0012` 记录了外部资源工作区部署；更早的分组树/技术栈数据不变量仍见对应 task verification。以上均为日期化运行证据，不替代 [architecture.md](architecture.md)、[domain-model.md](domain-model.md) 或各 task verification 的稳定事实。

## 当前 handoff

- 图谱视觉升级 PR #67 已部署并完成独立发布收口；DF-20260905-001 等待用户视觉反馈。

- Dogfood 五项整改已通过完整门禁和独立 Reviewer `APPROVED` 并完成 Harness closeout；五条 observation 均为
  `fixed_pending_verification`；PR #59、migration `0013`、deploy run `33475333993` 已完成，未执行真实仓库删除或重新采集；
- Issue #54 已完成，当前没有 `doing` item；后续 dogfood 可通过树状分组 UI/API/CLI/MCP 验证真实
  创建、移动、聚合与排序体验；
- 外部资源工作区与正文采集模块已通过 PR/CI、隔离 PostgreSQL 验证和生产 `0014`–`0016` 迁移部署；文章、论文和网站仍与 GitHub 仓库分别管理；
- `product-6-public-multi-user-hardening` 仍为 `todo`，不与 Issue #54 并行启动；
- 持久 dogfood 产品反馈统一进入 [dogfood-observations.md](dogfood-observations.md)，修复计划和 checklist 状态不得在该登记册重复维护；
- 自动部署的成功证据与回滚 revision 已写入 [operations-8 verification](tasks/operations-8-proxy-independent-deploy/verification.md)；后续性能优化不得恢复服务器侧 `git pull/docker pull`。

## 更新规则

- 只保留当前状态、日期化验证摘要、完成结果与下一 handoff；
- 稳定设计写入对应规范，详细 review/receipt 写入 task verification，历史过程由 Git 保存；
- item 状态只通过 checklist 和 `harnessctl` 更新；
- `harness-state.json` 只由 Harness runtime 派生，不手写成第二来源。
```

## Current Review Content

```md
# 最新发布审查指针

- Task: graph-3d-release
- Decision: APPROVE（2026-09-06 UTC）
- 唯一正文：[生产 closeout 审查](../tasks/graph-3d-release/closeout-review.md)
- 发布回执：[verification.md](../tasks/graph-3d-release/verification.md)

本文件仅为导航；生产发布关闭不表示用户已认可最终审美或已验证稳定 60 FPS。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
