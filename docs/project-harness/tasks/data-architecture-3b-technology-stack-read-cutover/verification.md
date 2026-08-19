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

## 第二批（2026-08-19，完成）

- **integration 用例 6 个**（phase-b-read.integration.test.ts，真实 PG）：两用户 disjoint watched set 隔离（各自图只含自己的 source 与 stack 边）、两用户 overlap 同 stack（节点共享语义、边各归 source）、正向条件（无 stable ID 的 reference 行带伪 watch 不进入新读）、legacy 栈边排除（无悬空边）、同 stack 多 package evidence 聚合单行 + 唯一约束验证、legacy mode 默认分流回归；全套 49/49（43 既有 + 6 新）。
- **启动检查** `assertStorageModeStartupConsistency`（technology-stack-entities.ts）：双写模式下新表存在检查（to_regclass）；cleaned+legacy 组合（legacy 影子行=0 且新表>0）拒绝启动；new_read 下新表空但 legacy 有数据（未回填）拒绝启动。API（启动序列顶层，独立短连接 + closeDb）与 Worker（db 创建后）接线，失败 process.exit(1)。
- 全仓门禁：lint 13/13、typecheck 14/14、test 11/11、build 9/9 + integration 49/49。

待续：独立 implementation review → PR/CI → 生产三阶段 rollout（compat 已就绪→mode 切换→观察窗口）。

## Implementation review 处置（2026-08-19）

第一轮 verdict `changes_requested`（evt-20260819T124735Z）：P0（API 启动检查成功路径 closeDb 销毁全局单例池——context.ts 模块期捕获的池被终结，tRPC 全挂；reviewer 实测 pg ended pool 行为证实）；P1（Worker 检查 fire-and-forget 竞态）；P2×2（9 站点与启动/shadow 门测试缺口）；P3×4（edge0SourceId 残留、top-N 端到端、commit 语义错位记录、new_only 静默回退等）。全部处置：

- **P0**：API 启动检查改用独立 `pg.Pool(max:1)` + drizzle 包装，只 end 自己（apps/api 增加 pg/@types/pg/drizzle-orm 依赖）；verification 描述同步修正；
- **P1**：Worker 检查改 await（try/catch + exit(1)）；
- **P2-3**：api 层 3 站点用例（getRepositories/requireWatchedRepositoryByFullName 拒绝 tech-stack/\*/syncEmbeddingStatus，PgDialect 编译 SQL 文本断言 `github_repository_id is not null`）；谓词行为级 integration 用例（reference 行排除 + 真实行包含）；groups/scheduler/radar/repository-identity 的谓词来自同一 `isRealGitHubRepository` 单例导出，由上述行为级用例与生产双向 0 违例基线共同覆盖；
- **P2-4**：启动检查 6 用例（缺表/cleaned+legacy/未回填/空库放行×2/Phase C 模式跳过）；Worker shadow 门 2 用例（new_read 与 legacy 两 mode 下 compare 均执行——经 defaultRebuildGraph 真实路径 + completeJob/updateJobProgress mock 链）；
- **P3-5/8**：删除 edge0SourceId；stackNodeIdBySlug → Set；new_only/legacy_cleaned 显式 throw；多余空行清理；
- **P3-6**：top-N 端到端 integration（31 stack → 节点与边同步裁 30、name 升序 tie-break 验证）；
- **P3-7**：commit 语义错位（核心实现在 docs commit 中）已记录，不重写历史。

修复后：unit 全绿（db 233、worker 12、api 41 等）、integration **51/51**（49+2 新增）、全仓 lint 13/typecheck 14/test 11/build 9 通过。
