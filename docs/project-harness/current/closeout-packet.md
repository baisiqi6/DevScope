# Closeout Packet

## Subject

- Checklist item: `product-10-external-resources-workspace`
- Reviewer: `external-resources-reviewer`
- Updated at: `2026-08-29`
- Canonical plan path: `docs/project-harness/tasks/product-10-external-resources-workspace/plan.md`

## Item Snapshot

- Title: 外部资源 Web 工作区与数据库打磨
- Status: done
- Workflow status: closeout_requested
- Priority: p1
- Owner: None
- Session: None
- Dependencies: product-9-external-resources-preview

## Acceptance

Web 端可管理 article/paper/website 预览卡片，支持筛选、排序、搜索、已读/置顶、备注/标签编辑、删除确认和独立资源分组；数据库约束、索引、迁移与隔离 PostgreSQL 测试通过；不进入正文抓取，不触碰生产。

## Verification

pnpm lint; pnpm typecheck; pnpm test; pnpm build; isolated PostgreSQL integration 9 files/54 tests; independent review approved

## Handoff



## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 外部资源 Web 工作区与数据库打磨

## Item

- Checklist item：`product-10-external-resources-workspace`
- 当前状态：`done`
- 风险模式：`high-risk`（涉及 schema/migration 与持久化用户数据）
- 依赖：`product-9-external-resources-preview`

## 目标

在既有 `article | paper | website`、`preview_only` API/Client/CLI/MCP 能力之上，补齐 Web 端可用的外部资源工作区，并对数据库约束、索引、删除级联和迁移验证做一次针对性打磨。文章、论文和网站仍与 GitHub 仓库分别管理；本 item 不进入正文抓取、PDF/DOI 解析、embedding 或多用户鉴权实现。

## 成功标准

1. Web 导航提供“外部资源”入口，页面支持列表/卡片两种密度、类型筛选、已读/未读、置顶和关键词过滤，并提供 loading/empty/error 状态。
2. 预览卡片展示资源类型、站点/作者、标题、描述、标签、已读/置顶状态和安全的外链打开行为；支持编辑备注、标签、阅读状态、置顶和删除确认。
3. Web 能创建/列出/查看/编辑/删除外部资源，并管理独立外部资源分组；所有交互复用现有 tRPC contract，不在 Web 直连数据库。
4. 数据库审查外部资源表的 user 边界、复合外键、唯一键、索引、metadata 大小和删除级联；需要 schema 变化时生成显式迁移，不使用 `db:push`。
5. 增加 Web 组件/页面测试与数据库约束测试；`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过，并在隔离 PostgreSQL 验证迁移。
6. 不执行生产迁移、部署、push 或公开多用户改造；完成后交独立 reviewer 复核。

## 实施阶段

### Phase 0：现状核对与设计冻结

- 确认 API 返回字段、排序/筛选能力和当前数据库索引；如 API 不足，先补最小 contract。
- 沿用现有 DevScope command-surface/token、字体、颜色和 Motion 微交互规范，不引入第二套 UI 框架。
- 冻结页面信息架构：顶部标题/统计、工具栏筛选、分组侧栏或下拉、资源卡片网格/列表、编辑对话框。

### Phase 1：Web 工作区

- 新增 `/resources` 页面与导航项；实现查询、过滤、排序、刷新和分页/加载更多。
- 添加外部资源卡片、类型徽标、站点 favicon/预览图 fallback、标签、状态按钮、备注编辑和删除确认。
- 添加保存资源与创建/管理分组的入口；所有 mutation 成功后精确失效相关 query。
- 处理窄屏、键盘焦点、外链 `noopener noreferrer`、图片加载失败和 reduced-motion。

### Phase 2：数据库打磨

- 审查并补齐 canonical URL 唯一约束、用户复合外键、外部资源/分组索引、metadata 字段约束和级联删除。
- 如需新增列/索引，运行 `pnpm db:generate`，审查 SQL 顺序、锁影响和回滚步骤。
- 在隔离 PostgreSQL 从 baseline 重放迁移，覆盖重复保存、跨用户分组成员、删除级联和查询索引。

### Phase 3：验证与 review

- 运行 focused Web/API/DB tests，再运行完整 lint/typecheck/test/build。
- 对 UI 做手动或 Playwright smoke：创建、筛选、编辑、分组、删除、外链打开、空/错/加载态。
- 交独立 reviewer；review 通过后生成 closeout，不自动生产部署。

## 本轮实现与验证记录

- 已完成 `/resources` Web 工作区：卡片/列表密度切换、关键词/类型/阅读状态筛选、置顶优先/最近更新排序、分组筛选、加载更多、创建/编辑/删除、已读/置顶操作、预览图与 favicon fallback、错误/空/加载状态和安全外链。
- 已补齐共享外部资源类型别名、导航入口，以及 `metadata` 20KB 和收藏 `tags` 最多 30 项的数据库约束；生成迁移 `0013`、`0014`。
- 已通过：`pnpm lint`（0 errors，18 warnings）、`pnpm typecheck`、`pnpm test`、`pnpm build`；Web 页面/组件 SSR smoke 与筛选测试共 21 项；共享 metadata UTF-8 字节边界测试通过；状态 mutation pending 防重复提交；隔离 `pgvector/pgvector:pg16` 重放全部迁移并通过 9 个 integration test 文件、54 项测试。
- 独立 reviewer 已只读复核通过；本 item 不包含生产迁移、部署、push 或多用户鉴权。

## 数据边界

- `external_resources`、`external_resource_saves`、`external_resource_groups`、`external_resource_group_members` 继续独立于 GitHub 仓库域。
- 资源正文仍不抓取；`ingestionMode` 固定为 `preview_only`。
- 所有资源与分组操作继续由服务端单用户边界过滤；本 item 不把当前 `publicProcedure` 改造成多用户鉴权。

## 未授权动作

- 生产数据库迁移、生产部署、域名/证书/代理改动、公开多用户鉴权、正文抓取和外部资源内容索引均不在本 item 授权范围内。
```

## Recent Progress Context

```md
# DevScope Harness 进展

> 更新时间：2026-08-29
> 生产运行基线：`4772098`；`main` 可仅因本 item 的 closeout 文档提交而领先生产
> 部署形态：Standalone
> 当前状态：可靠性整改与部署链路收口均已完成；无 active item；下一产品节点为公开多用户加固，尚未启动

## 当前状态

- [Harness checklist](harness-checklist.json)：12 个 item `done`，1 个 item `todo`，无 `doing` / `blocked`；
- [Current task pointer](current/task_plan.md)：已清空，没有正在执行的 canonical plan；
- 生产当前运行 revision `4772098`，技术栈模式为 `legacy_cleaned`，分析模型为 `MiniMax-M3`；
- 无迁移、无 cleanup 的自动部署 run `32348360956` 已通过 Git bundle + 精确 SHA 镜像归档 + SSH 链路完成；服务器无需访问 GitHub/GHCR，迁移记录和业务数据不变量保持。

## 已完成整改

| 领域 | 已完成结果 | 详细证据 |
|---|---|---|
| Release ID | GitHub Release ID 无损迁移为 `bigint`，生产迁移、回滚与大 ID 往返已验证 | [verification](tasks/data-correctness-1a-release-id-bigint/verification.md) |
| 仓库身份 | 正式仓库统一使用 GitHub stable ID，rename、Radar 去重与 production cutover 已关闭 | [verification](tasks/data-correctness-1b-repository-identity/verification.md) |
| 分组计数 | `repoCount` 已在 API 边界归一为 number，生产 MCP 复查通过 | [verification](tasks/data-correctness-1c-group-count-contract/verification.md) |
| 采集一致性 | chunks、Releases、HN、SBOM 与 embedding 改为版本安全的原子替换 | [verification](tasks/data-correctness-2-atomic-replacement/verification.md) |
| 技术栈 Phase A | 独立实体、新表、backfill、dual-write 与 shadow zero-diff 完成 | [verification](tasks/data-architecture-3-technology-stack-entities/verification.md) |
| deps.dev 缓存 | `resolved/not_found/error` 恢复语义、timeout、有界并发、预算与冷暖 rebuild 完成 | [verification](tasks/data-correctness-4-deps-cache-recovery/verification.md) |
| PostgreSQL 门禁 | 真实 PostgreSQL 16 + pgvector 的迁移、事务、锁与并发矩阵进入 CI required checks | [verification](tasks/data-quality-5-postgres-integration-gates/verification.md) |
| 技术栈 Phase B | 图谱读取切换到新实体模型，分阶段生产切换与 closeout 完成 | [verification](tasks/data-architecture-3b-technology-stack-read-cutover/verification.md) |
| 技术栈 Phase C | 停止旧写入，清理 79 条旧栈边、13 个伪仓库、13 个伪收藏和 `is_reference` | [verification](tasks/data-architecture-3c-technology-stack-legacy-cleanup/verification.md) |
| AI Provider | 默认分析模型切换为 MiniMax M3，durable/SSE canary 与 DeepSeek 回滚演练完成 | [verification](tasks/platform-ai-7-minimax-m3-default/verification.md) |
| 外部资源工作区 | Web 外部资源工作区、独立分组、分页/密度切换与数据库边界约束完成；未进入正文抓取或多用户 | [closeout](current/closeout-packet.md) |

## 当前生产基线

2026-08-20 UTC 07:03 后完成只读复核：

- DevScope MCP health 为 `ok`，未认证公网入口返回 `401`；
- API、Web、Worker 均运行 `ce7ff16`，PostgreSQL 16 + pgvector 容器健康，服务器工作树干净；
- 正式仓库 40、伪仓库 0、伪收藏 0；`is_reference` 列已删除；
- 图谱为 40 个 repository + 9 个 language + 13 个 technology stack 节点，共 249 条边；
- 新表保存 13 个技术栈和 79 条 repository-to-stack 关系；cleanup receipt 与 baseline receipt 均在位；
- `package_repo_mappings` 中 9 条历史 `error` 行均对应当前 SBOM 已不再使用的旧 package version，不是活跃解析失败；
- GitHub Ruleset `main-required-checks` 已要求 `quality` 与 `integration`，最新 `main` 两项均通过。

这些是日期化运行证据，不替代 [architecture.md](architecture.md)、[domain-model.md](domain-model.md) 或各 task verification 的稳定事实。

## 当前 handoff

- 当前没有未完成的可靠性或运维整改 item；不要继续沿用 Phase A/B/C 与部署链路的历史 handoff；
- 下一产品节点是 `product-6-public-multi-user-hardening`，仍为 `todo`。已形成唯一 canonical plan（[plan](tasks/product-6-public-multi-user-hardening/plan.md)），启动前仍必须重新确认应用鉴权、租户隔离、HTTPS 与公开运营范围；
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

`data-architecture-3-technology-stack-entities` 的 Phase A expand、precision fix、versioned backfill、生产 shadow zero-diff 与 MCP/health/auth 已完成；证据见 [任务验证记录](../tasks/data-architecture-3-technology-stack-entities/verification.md)。生产 graph rebuild 虽正确成功，但 70 分 44 秒的冷缓存路径暴露外呼 timeout/budget/freshness/progress P1，唯一后续方案为 [依赖解析缓存恢复与外呼预算计划](../tasks/data-correctness-4-deps-cache-recovery/plan.md)。当前暂停在 Phase A production closeout 前；Reviewer 批准 item 4 和 Phase A closeout 前不得进入 Phase B/C 或标记整个 item 完成。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
