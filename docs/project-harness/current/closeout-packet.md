# Closeout Packet

## Subject

- Checklist item: `product-11a-external-resource-content-enable`
- Reviewer: `reviewer`
- Updated at: `2026-09-03`
- Canonical plan path: `docs/project-harness/tasks/product-11a-external-resource-content-enable/plan.md`

## Item Snapshot

- Title: 外部资源正文采集显式启用入口
- Status: done
- Workflow status: closed
- Priority: p1
- Owner: None
- Session: None
- Dependencies: product-11-external-resource-content-ingestion

## Acceptance

已保存的 preview_only 外部资源可通过显式且单向的 enable-content 入口切换为 content，再请求正文采集；API/Client/CLI/MCP/Web 契约一致；已开始或完成采集的资源不得降级；用户隔离、幂等、回归与生产只读验证通过。

## Verification

本地/CI全仓库 lint/typecheck/test/build通过；独立 Reviewer APPROVED；PR #64 合并，deploy run 33727039540 成功；生产认证 health/home 200、未认证401。资源ID2 受控 content-enable 成功切换为 content+not_requested；content-request 入队返回 pending，Worker 最终按安全策略 failed（security_rejected: DNS解析结果包含受限地址），未写入正文；DF-20260902-001 已关闭。

## Handoff

生产受控验证已完成；资源 ID 2 已启用并按安全策略失败。后续若要验证成功正文，应另选允许的公开 URL，不绕过 API 或 SSRF 防线。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 外部资源正文采集显式启用入口

## Item

- Checklist item：`product-11a-external-resource-content-enable`
- 关联 dogfood observation：`DF-20260902-001`
- 风险模式：`high-risk`（持久数据状态、用户可见性、API/CLI/MCP/Web 写入口与生产部署）
- 依赖：`product-11-external-resource-content-ingestion`
- 当前阶段：生产受控验证已完成，item 可关闭

## 目标

让已保存的 `preview_only` 外部资源可以通过显式、单向且可审计的入口启用正文采集，修复
`DF-20260902-001`。启用后仍由既有异步 Worker 抓取，不能在请求线程联网。

## 边界

- 只允许 `preview_only → content`；不允许 `content → preview_only`。
- 已进入 `pending`、`processing`、`completed` 或 `failed` 的资源不能通过启用入口回退或重置状态。
- 保存资源默认仍为 `preview_only`，不自动抓取。
- 不新增第二套正文状态模型，不实现全文检索、chunks、embedding 或定时刷新。
- 生产部署、真实正文抓取和 observation 关闭必须在独立验证后执行。

## 实施阶段

1. **Phase 0：现状与契约**（complete）
   - 核对 shared/API/Client/CLI/MCP/Web 现有契约与单向状态规则。
2. **Phase 1：实现入口**（complete）
   - 增加 `enableContent` API/Client/CLI/MCP/Web；所有输出经 Zod 校验。
   - 用条件更新保证 owner/save 隔离与不可回退；保持 request-content 异步。
3. **Phase 2：验证与 review**（complete，独立 Reviewer `APPROVED`）
   - 补 API/Client/CLI/MCP/Web focused tests、生产资源只读与受控启用测试。
   - API 12、Client 14、CLI 23、MCP 11、Web 3 focused tests 与相关 typecheck 通过；启用入口不入队、不联网。
   - 全仓库门禁与独立 Reviewer 通过；生产受控验证已完成并记录如下。

## 实现记录

- `enableContent` 已接入 shared/API/Client/CLI/MCP/Web；保存仍固定为 `preview_only`。
- API 使用 `ingestionMode=preview_only AND contentStatus=not_requested` 条件更新，确保并发下只有一个请求执行转换。
- 对已是 `content + not_requested` 的重复调用返回同一成功结果；其他已开始采集状态和异常组合均稳定拒绝。
- 启用动作只更新模式，不入队、不联网；后续仍复用既有 `requestContent` Worker 任务。

## 验收标准

- 资源 ID `2` 这类现有 `preview_only` 收藏可显式启用为 `content`。
- API/Client/CLI/MCP/Web 都能调用启用入口，并明确显示当前模式/状态。
- 非收藏、跨用户、已开始采集或已完成资源的非法转换被拒绝。
- 启用动作本身不联网；只有后续显式 request-content 才入队抓取。
- `DF-20260902-001` 只有在生产受控验证确认启用入口、异步状态链路和安全失败语义后才可关闭；正文抓取是否成功取决于所选 URL 的安全策略与上游可达性。

## 未授权动作

- 未通过独立 review 前不提交、部署或修改生产。
- 未经单独确认不触发真实正文抓取样本。

## 当前 Handoff

- 生产受控验证已完成；资源 ID `2` 已启用并按安全策略失败，后续若要验证成功正文应另选允许的公开 URL，不绕过 API 或 SSRF 防线。

## Verification

- 独立 Reviewer `product11a_external_resource_reviewer` 已 `APPROVED`：启用条件、幂等、用户隔离和 Web/CLI/MCP/API 契约均通过审查。
- 本地 focused：API 12、Client 14、CLI 23、MCP 11、Web 3；相关 typecheck 通过。
- 全仓库 `corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build` 通过，仅有既有 lint/build warning。
- 生产受控验证已完成：ID `2` 成功 `content-enable` 为 `content + not_requested`；显式 `content-request` 入队后安全失败并保持脱敏错误 `security_rejected: DNS 解析结果包含受限地址`，未写入正文。该 URL 的失败属于安全策略结果，不绕过 SSRF 防线。

## Production Verification

- Deploy run：`33727039540`；生产 revision：`ac62db42b32632002fd341eb294e152c0424e6b4`。
- 认证 health/home 返回 `200`，未认证 health 返回 `401`。
- CLI `resource content-enable 2` 返回 `ingestionMode=content`、`status=not_requested`；随后 `resource content-request 2` 返回 `pending`。
- Worker 最终将资源置为 `failed`，错误为 `security_rejected: DNS 解析结果包含受限地址`；没有正文行写入。该结果验证了入口、异步任务和失败语义均可用。
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
