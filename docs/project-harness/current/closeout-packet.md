# Closeout Packet

## Freshness Metadata

- generated_at: `2026-09-06T05:31:29Z`
- source_plan_sha256: `bdcdd2c5a44066d44675bf04818af314df1b8eb93137bc87cc258016ca492400`
- canonical_plan_path: `docs/project-harness/tasks/graph-3d-release/plan.md`
- checklist_item: `graph-3d-release`
## Subject

- Checklist item: `graph-3d-release`
- Reviewer: `graph_release_reviewer`
- Updated at: `2026-09-06T05:31:29Z`
- Workflow mode: `high-risk`
- Canonical plan path: `docs/project-harness/tasks/graph-3d-release/plan.md`

## Item Snapshot

- Title: 3D 图谱视觉升级生产发布
- Status: doing
- Workflow status: closeout_requested
- Priority: p2
- Owner: codex
- Session: codex-graph-release-20260906
- Dependencies: None

## Acceptance

独立审查与 CI 通过；明确备份及回滚；精确 SHA 部署成功并完成健康、认证、生产浏览器复核。

## Verification

PR #67 / deploy 34013772766 成功；生产 d2c4db1 运行镜像、回滚、认证与浏览器已核对。详见 tasks/graph-3d-release/verification.md。

## Handoff

生产已发布，等待独立 closeout；DF-20260905-001 保留用户视觉反馈。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 3D 图谱视觉升级生产发布

- Mode: high-risk
- Scope: 发布 PR #67 的图谱材质、多视角黑洞与交互改进；代码提交 17d743d。
- Authority: 用户于本会话明确要求“走正常的发布部署流程”。允许 push、PR、合并及生产部署。
- Non-goals: 不迁移数据库，不执行技术栈清理，不改其他站点或凭据；不宣称相对论模拟或稳定 60 FPS。

## 执行与验收

1. 核对代码及本地 lint/typecheck/test/build；独立 Reviewer 检查 diff、视觉和范围证据；PR quality/integration 均成功后合并。
2. 部署前确认生产 35cb69d、工作树干净、三应用健康；已有业务库备份 28 项 TABLE DATA 可读、Nginx 与 .env 受限备份；保存回滚镜像定位。
3. main 精确合并提交经手动 deploy.yml 发布，apply_database_migration=false、technology_stack_legacy_cleanup=false；等待成功。
4. 独立回读 Git 与 3 镜像 revision、API/Web、Nginx、未认证 401 与认证 200；浏览器验证生产 shader 与图谱交互。
5. verification.md 记录部署 run、SHA、备份/回滚与浏览器证据；独立 closeout 审查后关闭本发布节点。产品审美意见保留 DF-20260905-001 待用户反馈。

## 回滚

目标生产基线 35cb69d8f635675cbd735a26505816434ff09938。工作流保留三服务 :rollback 镜像；按 runbook 的回滚步骤恢复原镜像并复核健康；本次无 DB migration，常规回滚不恢复数据库。任何 CI/备份/版本/健康门禁失败均停止推进，不强制合并或修改访问控制。

## 证据

- 本地门禁及多视角验收：.planning/2026-09-05-graph-craft/verification.md（私有本地 artifact，不包含凭据）。
- PR: https://github.com/baisiqi6/DevScope/pull/67
- 备份 locator 与部署结果写入同目录 verification.md，不复制到稳定架构文档。
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
# 当前审查

## Dogfood 五项整改生产发布

- Checklist item：`dogfood-2026-08-production-release`
- Reviewer：`dogfood_remediation_reviewer`，部署后独立只读复核。
- 最终结论：`APPROVED`；无 P0–P2 发布阻断。
- 发布证据：PR #59 合并为 `05aa9e192a5ca95cb49ffc628617afc0e36af83d`；deploy run `33475333993` 成功，`technology_stack_legacy_cleanup` 跳过。
- 生产复核：服务器工作树 clean；migration `0013` 文件 SHA-256 与 journal 一致；迁移前 custom-format backup mode `600` 且 `pg_restore --list` 可读；API/Web/Worker 运行目标 revision，PostgreSQL healthy，隧道未认证 `401`、Keychain 认证 health/home `200`；MCP 35 tools 与 `technologyStacks` 删除影响预检可用；近期无持续 5xx/数据库错误。
- 安全边界：未执行真实仓库 archive/delete 或重新采集；未修改 DNS、证书、Nginx、凭据或同机其他站点。
- 完整回执见 [生产发布计划](../tasks/dogfood-2026-08-production-release/plan.md) 和 [closeout packet](closeout-packet.md)。

本结论批准的是本批次生产发布和只读复核；相关 dogfood observation 因未执行真实破坏性/采集写入，继续保持 `fixed_pending_verification`，待后续安全 dogfood 样本再逐条关闭。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
