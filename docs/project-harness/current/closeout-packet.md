# Closeout Packet

## Subject

- Checklist item: `product-11-external-resource-content-ingestion`
- Reviewer: `reviewer`
- Updated at: `2026-09-03`
- Canonical plan path: `docs/project-harness/tasks/product-11-external-resource-content-ingestion/plan.md`

## Item Snapshot

- Title: 外部资源正文采集模块
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: codex
- Session: codex-20260902-external-resource-content-ingestion
- Dependencies: product-10-external-resources-workspace

## Acceptance

article/paper/website 在显式触发下可安全抓取并持久化正文状态；preview_only 默认行为不变；SSRF、超时、响应大小、内容类型、重定向、解析失败与重试语义有测试；API/Client/CLI/MCP/Web 状态入口、迁移和真实 PostgreSQL 集成门禁通过；未授权前不执行生产迁移或部署。

## Verification

全仓库 corepack pnpm lint/typecheck/test/build 通过（仅既有 warning）；隔离 pgvector PostgreSQL 重放 0000..latest，DB 集成62项与 Worker lease-expiry/stale takeover 1项通过；API111、Client20、CLI23、MCP10、Web24 focused tests通过；Phase0-4独立 Reviewer product11_external_resource_reviewer APPROVED；生产迁移、部署、真实外部资源抓取未执行。

## Handoff

高风险外部网络抓取：必须显式触发、默认 preview_only、拒绝私网/metadata/凭据 URL；生产部署需独立授权与备份回滚。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 外部资源正文采集模块

## Item

- Checklist item：`product-11-external-resource-content-ingestion`
- 风险模式：`high-risk`（外部网络抓取、SSRF、持久化状态、Worker 任务与 schema 变更）
- 依赖：`product-10-external-resources-workspace`
- 当前阶段：Phase 0/1/2/3/4 已通过独立复审，模块本地实现完成；生产迁移/部署不在默认授权内

## 目标

在不改变现有 `preview_only` 默认路径的前提下，为 `article`、`paper`、`website` 增加显式触发的正文采集最小闭环：安全请求、HTML/PDF 解析、持久化状态、幂等任务、失败语义和 API/Client/CLI/MCP/Web 状态入口。

## 产品边界

- 保存外部资源仍默认为 `preview_only`；正文抓取必须显式操作。
- 正文资源继续独立于 GitHub 仓库，不进入仓库采集、Trending、Radar 或关系图谱管线。
- 本阶段先完成采集与状态可观测性；全文语义搜索、跨类型混合分组、定时刷新和多用户鉴权另立范围。
- 生产迁移、生产部署、DNS/证书/Nginx/凭据变更另行授权。

## 安全要求

- 只允许 `http`/`https`；拒绝 URL 用户名/密码、loopback、私网、link-local、云 metadata、IPv6 mapped private 地址。
- DNS 解析和每次重定向都重新校验地址，拒绝解析后地址漂移；限制重定向次数。
- 请求连接/整体超时、响应头、压缩展开、响应体字节数、HTML/PDF 页数和解析 CPU/内存均有界。
- 仅接受明确允许的 HTML/PDF content type；不执行脚本、不上传 cookies/Authorization、不跟随页面内资源。
- 记录脱敏错误类别和状态，不记录正文外的敏感请求头；失败必须可重试且不覆盖已有成功内容。

## 实施阶段

1. **Phase 0：现状与威胁模型**（complete）
   - 复用现有 `external_resources` 状态字段和 Worker 任务边界，确认依赖/锁版本。
   - 冻结 SSRF、超时、大小、类型、重定向和许可证/robots 策略；补测试 fixture 契约。
2. **Phase 1：抓取与解析核心**（complete，独立 Reviewer `APPROVED`）
   - 实现 URL 安全校验、受限 HTTP client、HTML 正文提取和 PDF 解析适配器。
   - 统一 `parameter_error`、`security_rejected`、`transient_failure`、`unsupported_type`、`parse_failure`、`unknown` 语义。
3. **Phase 2：持久化与 Worker**（complete，独立 Reviewer `APPROVED`）
   - 设计独立正文/分块表或等价最小模型；状态转换 `not_requested → pending → processing → completed/failed`。
   - 已落地 `external_resource_contents`、`0014`–`0016` migrations/rollback、稳定 job key、lease-authoritative claim、stale takeover、条件写回和错误脱敏。
   - 隔离 pgvector PostgreSQL 重放 `0000..latest`：DB 集成 62 项、Worker stale takeover 集成 1 项；DB/Worker typecheck 与 diff check 通过。
4. **Phase 3：API/Client/CLI/MCP/Web**（complete，独立 Reviewer `APPROVED`）
   - 增加显式 request-content、status、retry/read-only 查询；保留 preview-only save 契约。
   - Web 先显示状态和失败原因，避免自动触发外部抓取；所有输出经 shared Zod schema。
   - 已接入 API/Client/CLI/MCP/Web；Web 仅按钮显式触发，正文查看展示前截断至 50,000 字符；列表不携带正文。
   - API111、Client20、CLI23、MCP10、Web24 测试及相关 typecheck/build 通过；独立 Reviewer `APPROVED`。
5. **Phase 4：门禁与 review**（complete，独立 Reviewer `APPROVED`）
   - 单元/HTTP fixture/SSRF 回归、真实 PostgreSQL、全量 lint/typecheck/test/build。
   - 独立 Reviewer 只读复核；通过后才评估生产迁移和部署。

## Verification

- 全仓库 `corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build` 通过；lint/build 仅有既有 warning，无 error。
- 隔离 `pgvector/pgvector:pg16` 重放 `0000..latest` 迁移通过；DB 集成 62 项，Worker lease-expiry/stale takeover 集成 1 项通过。
- Phase 0/1、Phase 2、Phase 3、Phase 4 均经独立 Reviewer `product11_external_resource_reviewer` 审批。
- 生产数据库迁移、部署、真实外部资源抓取均未执行，仍需单独授权。

## Follow-up

- `readContent` 当前服务端最多返回约 1MB，Web 端展示前截断至 50,000 字符；未来可按需要增加分页，不阻断本模块收口。
- 全文检索、chunks、embedding、定时刷新和多用户鉴权不属于本模块。

## 验收标准

- preview-only 回归不变，显式 content 请求能观察完整状态机。
- SSRF、DNS/重定向、超时、响应大小、类型、压缩和解析边界均有可重复测试。
- HTML/PDF fixture 能提取受限正文；空内容、乱码、损坏文件和不支持类型有明确失败语义。
- 同一资源并发触发不会重复写入或状态倒退；重试不覆盖旧成功正文。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和隔离 PostgreSQL 集成通过。
- 生产未授权前不执行 migration/deploy；生产后复核包含 SSRF 拒绝、状态、日志脱敏和资源预算。

## 未授权动作

- 生产数据库迁移、生产部署、真实外部资源大规模抓取、正文全文索引、DNS/HTTPS/Nginx/凭据修改。
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
