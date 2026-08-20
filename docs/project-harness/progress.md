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
