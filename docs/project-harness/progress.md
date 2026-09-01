# DevScope Harness 进展

> 更新时间：2026-09-01
> 生产运行基线：`05aa9e1`（完整 SHA 见发布回执）；`main` 已通过 PR #59 合并并完成本 item 生产部署
> 部署形态：Standalone
> 当前状态：dogfood 五项整改已完成本地实现、独立审查、生产迁移、部署与只读复核；五条 observation 保持 `fixed_pending_verification` 以等待真实写入/采集样本

## 当前状态

- [Harness checklist](harness-checklist.json)：dogfood 五项整改已完成 `done` closeout，最终独立审查为 `APPROVED`；
- [Current task pointer](current/task_plan.md)：已由 Harness 清空，没有正在执行的 canonical plan；
- 生产 API、Web、Worker 当前运行 revision `05aa9e192a5ca95cb49ffc628617afc0e36af83d`，技术栈模式仍为 `legacy_cleaned`，分析模型仍为 `MiniMax-M3`；
- 本批次生产部署 run `33475333993` 已通过 Git bundle + 精确 SHA 镜像归档 + SSH 链路完成，并显式执行
  migration `0013`；服务器无需访问 GitHub/GHCR，数据库备份、迁移与业务服务健康检查均通过。

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
| 外部资源工作区 | Web 外部资源工作区、独立分组、分页/密度切换与数据库边界约束完成；未进入正文抓取或多用户 | [closeout](current/closeout-packet.md) |
| Dogfood 五项整改 | 分组摘要、许可证语义、仓库生命周期、Agent 分组操作面与 HN enrichment 已部署并完成只读复核；等待真实写入/采集样本 | [verification](tasks/dogfood-2026-08-remediation/verification.md) |

## 当前生产基线

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
- 外部资源工作区的 PR/CI、隔离 PostgreSQL 验证与生产 `0012` 迁移部署属于历史快照；文章、论文和网站仍与 GitHub 仓库分别管理；
- `product-6-public-multi-user-hardening` 仍为 `todo`，不与 Issue #54 并行启动；
- 持久 dogfood 产品反馈统一进入 [dogfood-observations.md](dogfood-observations.md)，修复计划和 checklist 状态不得在该登记册重复维护；
- 自动部署的成功证据与回滚 revision 已写入 [operations-8 verification](tasks/operations-8-proxy-independent-deploy/verification.md)；后续性能优化不得恢复服务器侧 `git pull/docker pull`。

## 更新规则

- 只保留当前状态、日期化验证摘要、完成结果与下一 handoff；
- 稳定设计写入对应规范，详细 review/receipt 写入 task verification，历史过程由 Git 保存；
- item 状态只通过 checklist 和 `harnessctl` 更新；
- `harness-state.json` 只由 Harness runtime 派生，不手写成第二来源。
