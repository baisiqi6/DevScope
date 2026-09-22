# Closeout Packet

## Subject

- Checklist item: `df-20260822-001-hn-optional-fields`
- Reviewer: `dogfood_remediation_reviewer`
- Updated at: `2026-09-22`
- Canonical plan path: `docs/project-harness/tasks/df-20260822-001-hn-optional-fields/plan.md`

## Item Snapshot

- Title: 修复 Hacker News 可选字段解析失败
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: dogfood_remediation_worker
- Session: codex-20260921-df-hn
- Dependencies: None

## Acceptance

HN Algolia 合法缺失字段被规范化为 null，错误类型 payload 仍失败；focused tests、typecheck、全仓库门禁与独立审查通过；生产重新采集前 observation 不关闭。

## Verification

最终本地修复：HN 合法缺失字段规范化为 null，rawJson 保留原始 hit，错误类型仍 fail closed；focused 51/51、全仓库 lint/typecheck/test/build、diff-check 通过；独立 Reviewer APPROVED，无 P0-P2；生产复采未执行，DF 保持 fixing。

## Handoff

本地实现可收口；未 commit/push/部署/生产采集。后续取得发布授权后走 PR/CI/部署并用新生产样本复采，成功后关闭 DF-20260822-001。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# DF-20260822-001：Hacker News 可选字段兼容

## Item

- Checklist item：`df-20260822-001-hn-optional-fields`
- 关联 observation：`DF-20260822-001`
- 风险模式：本地代码修复为 ordinary；发布与生产重新采集另需显式授权并升级为 high-risk
- 分支：`codex/df-20260822-001-hn-optional-fields`
- 当前阶段：本地实现、独立复审与完整门禁通过，等待发布授权与生产复采

## 目标

修复 HN Algolia 合法响应因 `story_text`、`url` 等可选字段缺失而被 Zod 判为非法的问题，使缺失值规范化为 `null`，同时保留对错误类型 payload 的失败语义。

## 范围

- 调整 `packages/db/src/pipeline.ts` 的 HN 响应边界 schema。
- 增加缺失可选字段的最小回归测试。
- 更新 `DF-20260822-001` 的修复进度，但在生产重新采集成功前不关闭 observation。

## 非目标

- 不改变 HN 查询策略、limit、错误分类、存储表或原子提交语义。
- 不放宽 `points`、`num_comments` 等字段出现错误类型时的校验。
- 本 item 不自行 push、合并、部署或触发生产仓库采集。

## 已确认根因

- 2026-09-21 对 HN Algolia 查询 `agency-agents` 的实时只读样本包含 9 条结果，其中 6 条缺少 `story_text`，1 条缺少 `url`。
- 当前 schema 使用 `.nullable()`，只接受显式 `null`，不接受字段缺失产生的 `undefined`。
- 生产 dogfood 已在 `DietrichGebert/ponytail`、`msitarzewski/agency-agents` 与 System One 三个仓库样本中稳定复现。

## 验收标准

- 合法缺失的 HN 字段被规范化为 `null`，采集快照为 `success`。
- 错误类型 payload 仍返回 `failure` 并保留旧来源。
- `packages/db` focused test 与 typecheck 通过；完整门禁在交付前执行。
- 独立 Reviewer 确认改动未扩大到其他采集边界。
- 只有发布并用新的生产采集样本验证 HN enrichment 后，才可将 `DF-20260822-001` 标为 `closed`。

## 当前 Handoff

Worker 已完成 schema 与回归测试的最小修复；首轮 Reviewer 指出并推动修正 `rawJson` 原始语义问题，最终独立复审 `APPROVED`。本地实现可收口；生产发布与重新采集不在当前授权内。

## 本地验证

- HN 边界 schema 对六个可空字段接受缺失值并规范化为 `null`，仍拒绝错误类型。
- 首轮 Reviewer 指出 `rawJson` 不应包含 schema transform 人为补出的 key；现已改为标准列读取 normalized hit，`rawJson` 保留上游原始 hit。
- `corepack pnpm --filter @devscope/db test -- src/pipeline.test.ts`：51/51 通过。
- `corepack pnpm --filter @devscope/db typecheck`：通过。
- 最终 diff 的全仓库 `corepack pnpm lint`、`typecheck`、`test`、`build` 全部通过；lint/build 仅保留既有 18 条 Web warning 与 browserslist 提示。
- `git diff --check`：通过。
- 独立 Reviewer 最终 `APPROVED`，无 P0–P2；生产复采尚未执行，因此 observation 继续保持 `fixing`。
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
