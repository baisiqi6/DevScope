# Closeout Packet

## Subject

- Checklist item: `dogfood-2026-08-remediation`
- Reviewer: `dogfood_remediation_reviewer`
- Updated at: `2026-09-01`
- Canonical plan path: `docs/project-harness/tasks/dogfood-2026-08-remediation/plan.md`

## Item Snapshot

- Title: 修复 dogfood 暴露的五项产品问题
- Status: done
- Workflow status: closed
- Priority: p1
- Owner: None
- Session: None
- Dependencies: None

## Acceptance

分组成员与聚合接口只返回受控仓库摘要；Hacker News 采集请求契约正确且空结果与临时失败可区分；CLI/MCP 可安全更新和删除分组；仓库支持带影响预检的 archive/delete 生命周期；许可证可区分标准开源、source-available/custom、无许可证和未识别；全量门禁与隔离 PostgreSQL 验证通过。

## Verification

最终独立 Reviewer APPROVED；pnpm lint/typecheck/test/build 全部通过；隔离 pgvector/pgvector:pg16 重放全部迁移并通过 11 integration files/62 tests；五条 observation 为 fixed_pending_verification，生产部署/迁移未授权。

## Handoff

本批次只做本地实现与验证；生产部署需独立授权，完成后用 dogfood-observations.md 逐条回写证据。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# Dogfood 五项问题整改

## Item

- Checklist item：`dogfood-2026-08-remediation`
- 风险模式：`high-risk`（涉及 API 契约、仓库生命周期、schema/migration 与外部请求）
- 当前阶段：本地实现与验证；生产部署不在本轮默认授权内

## 目标

处理 `dogfood-observations.md` 中尚未关闭的五条观察：成员输出过大、Hacker News 400、Agent 分组操作面不完整、仓库缺少归档/删除、许可证语义不足。

## 实施阶段

1. 收紧 `groups.getWithMembers` 与聚合成员输出为稳定仓库摘要，补 API/Client/MCP 回归测试。
2. 修正 Hacker News 请求参数与 URL 编码/limit 边界，区分成功空结果、上游临时失败和参数错误，补 fixture 测试。
3. 沿用现有 groups router，在 Client/CLI/MCP 增加 update/delete 分组能力；删除前保留所有权校验和明确 destructive 标记。
4. 为 repositories 增加可恢复 `isArchived` 生命周期；提供 archive/unarchive 和带影响预检的 delete API，级联清理现有关联数据，补迁移与集成测试。
5. 增加许可证语义枚举/派生字段，保留原始 SPDX/NOASSERTION；对标准 SPDX、source-available/custom、无许可证、未识别给出可复算分类与 API/CLI/MCP 输出。
6. 跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和隔离 PostgreSQL 集成；独立 review 后更新 dogfood observation Timeline。

## 边界

- 不抓取文章正文，不启动公开多用户，不改变 HTTPS/域名配置。
- 不执行生产迁移、部署或删除；生产动作另行取得授权。
- 不复制第二套数据模型；新增字段必须服务现有 repositories 与 API 边界。

## 验收

- 五条 observation 均有明确 `closed`、`fixed_pending_verification` 或保留理由，不以单元测试代替生产复查。
- 输出体积、HN 失败语义、生命周期破坏性操作和许可证分类均有可重复测试。
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
| Dogfood 五项整改 | 分组摘要、许可证语义、仓库生命周期、Agent 分组操作面与 HN enrichment 已完成本地修复；待生产验证 | [verification](tasks/dogfood-2026-08-remediation/verification.md) |

## 当前生产基线

2026-08-29 UTC 07:50 后完成部署回读：

- DevScope MCP health 为 `ok`，SSH tunnel 未认证返回 `401`；公网域名因未完成 ICP 备案由阿里云
  拦截并返回 `403`，当前不作为可用入口；
- API、Web、Worker 均运行 `67fc629`，PostgreSQL 16 + pgvector 容器健康，服务器工作树干净；
- migration `0012` 已成功应用（保留分组树 `0011`）；分组树组合外键、cycle trigger/function 均存在；15 个现有分组全部为
  根级，86 条 membership 不变；
- 正式仓库 40、伪仓库 0、伪收藏 0；`is_reference` 列已删除；
- 图谱为 40 个 repository + 9 个 language + 13 个 technology stack 节点，共 249 条边；
- 新表保存 13 个技术栈和 79 条 repository-to-stack 关系；cleanup receipt 与 baseline receipt 均在位；
- `package_repo_mappings` 中 9 条历史 `error` 行均对应当前 SBOM 已不再使用的旧 package version，不是活跃解析失败；
- GitHub Ruleset `main-required-checks` 已要求 `quality` 与 `integration`，最新 `main` 两项均通过。

这些是日期化运行证据，不替代 [architecture.md](architecture.md)、[domain-model.md](domain-model.md) 或各 task verification 的稳定事实。

## 当前 handoff

- Dogfood 五项整改已通过完整门禁和独立 Reviewer `APPROVED` 并完成 Harness closeout；五条 observation 均为
  `fixed_pending_verification`，尚未授权 commit、push、生产迁移或部署；
- Issue #54 已完成，当前没有 `doing` item；后续 dogfood 可通过树状分组 UI/API/CLI/MCP 验证真实
  创建、移动、聚合与排序体验；
- 外部资源工作区已完成 PR/CI、隔离 PostgreSQL 验证与生产 `0012` 迁移部署；文章、论文和网站仍与 GitHub 仓库分别管理；
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

## Dogfood 五项问题整改

- Checklist item：`dogfood-2026-08-remediation`
- Reviewer：`dogfood_remediation_reviewer`，独立只读复核。
- 最终结论：`APPROVED`；无 P0–P2 阻断。
- 审查范围：分组成员摘要与 active watched 计数、许可证 fail-closed 分类、仓库归档/删除与并发安全、HN 请求与失败语义、CLI/MCP 契约及文档一致性。
- Reviewer 未修改文件、未提交、未 push、未部署或执行生产迁移；全量门禁与隔离 PostgreSQL 验证由 Operator 执行。
- 完整实现与验证证据见 [verification](../tasks/dogfood-2026-08-remediation/verification.md)。

本结论只批准当前本地实现。五条 observation 保持 `fixed_pending_verification`，必须在获得独立生产授权并完成迁移、部署和真实 dogfood 复查后，才能改为 `closed`。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
