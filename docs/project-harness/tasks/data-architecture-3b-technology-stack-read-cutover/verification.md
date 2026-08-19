# Implementation Verification：data-architecture-3b-technology-stack-read-cutover

> 记录日期：2026-08-19（UTC）
> 分支：`codex/phase-b-read-cutover`（base `main@59066cd`）
> 状态：baseline 已记录，plan review 进行中

## Baseline（plan step 1）

**前置确认**（checklist + events）：

- `data-correctness-4-deps-cache-recovery` done（production closeout APPROVE，2026-08-19）；
- `data-architecture-3-technology-stack-entities`（Phase A）done（closeout APPROVE，投影零差异独立重算）；
- `data-quality-5-postgres-integration-gates` done（PR #40，CI 双 job 通过，closeout approved）。

**生产基线**（Phase A closeout 时实测，日期化证据）：

- mode：`legacy_shadow_dual_write`（宿主未设，compose fallback 注入）；
- 迁移账本 10 条（0000-0009）；
- 真实仓库 40 / reference 13 / watched 53 / dependency 边 93 / similarity 边 40 / `repository_technology_stacks` 79 / `technology_stacks` 13 / chunks 34599；
- new/legacy 投影 sorted 签名双向零差异（79 行、379 packages evidence、25 sources）；
- 生产容器 revision：**916bc66 旧镜像运行中**（2026-08-19 网络故障期间未完成镜像更新；服务器代码 worktree 已 ff 到 59066cd，镜像待 ghcr 恢复后重试 `deploy.yml`——见 MiniMax item 的 infra blocker 记录）。Phase B 的 compatibility revision 部署将携带这次镜像更新。

**consumer 现状盘点**（2026-08-19 逐项核对源码）：

- graph contract：shared `repoGraphSchema` 的 node kind **已含 `technology_stack`**（`packages/shared/src/index.ts` 的 Phase A compatibility 扩展）；legacy `reference` kind 与 `isReference` 字段在窗口内保留；
- Web 2D/3D：已统一走 `isTechnologyStackGraphNode`（`apps/web/src/lib/repo-graph-node.ts`，canvas/canvas-3d 共 11 处调用点）双 kind 兼容；node ID 变化（`"41"` → `stack:react`）对布局缓存（按 key 容错）与详情路由（仅 repo kind 出链接）无影响；生产 Web@916bc66 已具备双 kind 兼容——**rollout step 1-3 的 consumer 兼容已由 Phase A 提前部署**；
- CLI/MCP：实测不解析 graph contract（`apps/cli/src/cli.ts`、`apps/mcp/src/server.ts` 无 graph 端点调用；`packages/client` 不含 graph API）——无兼容改动点，仅间接受仓库列表正向条件影响；
- `isReference`/`is_reference` 散落（源码口径，不含 dist 产物）：约 48 处 / 11 个源文件；业务过滤站点 6 处 + 未过滤 watched-join 站点 3 处（见 plan 收敛清单）；
- mode：`parseTechnologyStackStorageMode` 接受全部四值枚举（`legacy_shadow_dual_write | new_read_dual_write | new_only | legacy_cleaned`），fail closed 收紧发生在 API/Worker 两处进程入口的 supported-set assert（当前仅接受 `legacy_shadow_dual_write`）。

**正向条件不变量核验**（2026-08-19 生产实测）：

- `is_reference=false AND github_repository_id IS NULL` = **0 行**；
- `is_reference=true AND github_repository_id IS NOT NULL` = **0 行**（反向）；
- 正向条件 `github_repository_id IS NOT NULL` 恰好覆盖 40 个真实仓库行、排除 13 个 reference 行——谓词在生产成立。

## 待 plan review 结论后继续

RED tests 与实现设计（watched source join 读模型、`stack:<slug>` node、top-N 投影层计算、mode 一致性校验、正向条件收敛）将按 review 后的 plan 执行。

## 实现进展（2026-08-19，第一批）

已完成（typecheck/门禁全绿）：

1. **新读路径** `getRepoGraphDataFromNewTables`（repo-graph.ts）：mode 分流（`new_read_dual_write` → 新表投影）；真实仓库 = watched join + 正向条件；`stack:<slug>` 节点（kind=technology_stack、fullName=tech-stack/<slug>）；repo→stack 边只从新表合成；legacy 栈边（resolvedBy=tech-stack-catalog）投影层排除 + 悬空边防护（两端必须在投影节点集）；语言节点/written_in 即时合成不变；
2. **top-N 复用**：`selectTopTechnologyStackSlugs` 从 shadow `projectionKeys` 提取为共享导出（usage 降序 + name 升序 tie-break，单一实现）；
3. **正向条件收敛 9 站点**：谓词 `isRealGitHubRepository`（= `isNotNull(repositories.githubRepositoryId)`，repository-identity.ts 导出）替换 6 处既有 `isReference=false` 过滤（api router.ts 仓库列表、scheduler×2、groups、db radar、repository-identity）+ 3 处未过滤 watched-join 站点补齐（getRepository 详情、requireWatchedRepositoryByFullName、embedding reconcile whereClause）；
4. **mode 门**：API/Worker supported set 扩展为 {legacy_shadow_dual_write, new_read_dual_write}；Worker shadow compare 门扩展到两 mode（读切换期 drift 即任务失败）；
5. **单测**：repo-graph.test.ts 新增 4 用例（新读节点/边、悬空边排除与单重计数、legacy 分流回归、top-N 选择语义）——55/55。

待续（第二批）：integration 用例（两用户 disjoint/overlap watched set、同 stack 多 package evidence、成功空 relation、rebuild-vs-collection 交错）；启动检查（新表存在、cleaned+legacy 启动 shadow compare）；未知 mode fail-closed 用例；implementation review 与 PR；生产三阶段 rollout（compat 已就绪→mode 切换→观察窗口）。
