# Closeout Packet

## Subject

- Checklist item: `operations-8-proxy-independent-deploy`
- Reviewer: `ci-equivalent-gate`
- Updated at: `2026-08-20`
- Canonical plan path: `docs/project-harness/tasks/operations-8-proxy-independent-deploy/plan.md`

## Item Snapshot

- Title: 自动部署去除服务器公网代理单点
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: root
- Session: ops-closeout-20260820-root
- Dependencies: None

## Acceptance

GitHub Actions 通过 SSH 传输精确 Git bundle 与镜像归档完成无迁移部署；服务器无需访问 GitHub/GHCR；生产健康、访问控制与数据不变量保持

## Verification

docs/project-harness/tasks/operations-8-proxy-independent-deploy/verification.md

## Handoff

已完成；后续性能优化不得恢复服务器侧 GitHub/GHCR pull 依赖

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 自动部署去除服务器公网代理单点

## Item

- Checklist item：`operations-8-proxy-independent-deploy`
- Priority：P1
- Risk mode：high-risk
- Branch：`codex/operations-closeout`

## Outcome

DevScope 的常规无迁移部署不再要求生产服务器主动访问 GitHub 或 GHCR。GitHub Actions 在受控 runner 上构建并校验镜像与 Git bundle，通过现有 SSH 通道传入服务器；服务器只执行校验、fast-forward、`docker load`、目标服务重建与健康检查。

## Failure Evidence

- workflow run `32337214423` 与复验 run `32344426947` 都在镜像成功构建后失败于服务器 `git pull`，错误为 `gnutls_handshake() failed`；失败发生在 `docker pull` 和服务重建之前，生产未受影响；
- 生产仓库的 repo-local `http.proxy` 指向 `127.0.0.1:7890`；直连 GitHub 超时；
- Mihomo 配置校验通过且服务重启成功，但 91 个 VMess/SSR 节点的 delay test 全部失败，规则源刷新持续 EOF；当前没有获准且可用的新订阅配置。

## Scope

1. `actions/checkout` 使用完整历史，以目标 `github.sha` 生成可验证 Git bundle；
2. 三个镜像增加 full SHA tag；runner 拉取这三个精确 tag，打包为单个压缩 Docker archive；
3. 对 bundle 与 image archive 生成 SHA-256 清单，并用固定版本的 `appleboy/scp-action` 传到按 SHA 隔离的服务器 staging 目录；
4. deploy job 在任何运行中服务 mutation 前验证 checksum、bundle、目标 SHA、服务器工作树 clean、磁盘空间和 Worker schema；
5. 从 bundle 获取临时 ref，要求目标等于 `github.sha` 且当前 HEAD 是其 ancestor，再 `merge --ff-only`；
6. `docker load` 后核对三个 image 的 `org.opencontainers.image.revision`，再把精确 SHA tag更新为 compose 使用的 `latest`；
7. 只 force-recreate `api/web/worker`，随后执行 API/Web/Worker、Nginx 和访问控制复核；
8. 成功后删除本次 staging；失败时保留 staging 和现有生产容器状态用于诊断。

## Non-goals

- 不修改 Mihomo 订阅、节点、规则或其他站点的代理策略；
- 不执行数据库迁移、cleanup、DNS、HTTPS 或应用业务变更；
- 不把镜像归档、Git bundle、SSH key、Token 或生产配置提交到 Git；
- 不把 GitHub Actions artifact 当作新的长期发布仓库。

## Safety And Rollback

- workflow 继续使用 `concurrency: production` 串行生产操作；cleanup 输入与常规 deploy 仍互斥；
- 传输目录以 target SHA 隔离；checksum/bundle 在载入镜像前验证，三个 image revision 在改动 tag、Git HEAD 或运行中服务前统一验证；
- 迁移输入保持 `false` 时不创建数据库备份也不运行 `db:migrate`；已有显式迁移流程仍保留，但使用同一已校验镜像归档；
- 服务重建前记录当前三个运行 image ID，并保留为单一 `rollback` tag；健康检查失败时按 runbook 使用这些 tag 恢复；
- 不执行 `git reset --hard`，只允许 clean worktree 上的 fast-forward；失败后若 Git 已前进而 runtime 回滚，必须明确报告 revision/runtime 不一致并人工调和；
- 不修改或重启共享 Nginx，只允许 `nginx -t` 后 graceful reload。

## Verification

1. YAML 解析、`actionlint`（若可用）、`git diff --check`；
2. 本地用临时仓库验证 bundle 的 SHA/ancestor/fast-forward gate；
3. CI `quality` + `integration` required checks 通过；
4. 手动触发 `apply_database_migration=false`、`technology_stack_legacy_cleanup=false` 的完整 workflow；
5. Actions build、transfer、deploy 全部成功，cleanup job skipped；
6. 生产独立复核：服务器 HEAD、三个 image revision、容器、内部 health、外部 401、认证 MCP、图谱 62 nodes/249 edges、伪数据 0、migration journal 行数不变；
7. 把 run ID、目标 SHA、Mihomo 诊断边界和生产复核写入 verification/progress。

## Exit Condition

- 无迁移自动部署在服务器 GitHub/GHCR 仍不可用的条件下完整成功；
- 生产业务与数据不变量保持；
- 默认工作区切回最新 `main`，safety branch 继续保留为恢复锚点；
- 独立审查或等价的 PR/CI gate 未发现未关闭 P0-P2 finding。
```

## Recent Progress Context

```md
# DevScope Harness 进展

> 更新时间：2026-08-20
> 代码基线：`origin/main@4772098`（与生产运行 revision 一致）
> 部署形态：Standalone
> 当前状态：可靠性整改与部署链路收口均已完成；无 active item；下一产品节点为公开多用户加固，尚未启动

## 当前状态

- [Harness checklist](harness-checklist.json)：11 个 item `done`，1 个 item `todo`，无 `doing` / `blocked`；
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
- 下一产品节点是 `product-6-public-multi-user-hardening`，仍为 `todo`。启动前必须先形成独立 canonical plan，并重新确认应用鉴权、租户隔离、HTTPS 与公开运营范围；
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
