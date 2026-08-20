# Implementation Verification：data-architecture-3c-technology-stack-legacy-cleanup

> 记录日期：2026-08-19（UTC）
> 分支：`codex/phase-c-cleanup`（base `main@52706ec`）
> 状态：已领取；plan review 进行中；本文件先落盘源码扫描与基线

## 源码扫描（plan 第 1 步准备）

`is_reference`/`isReference` 残余引用面（源码口径，不含测试）：

| 文件 | 处数 | 性质 |
|---|---|---|
| packages/db/src/repo-graph.ts | 24 | dual-write/rebuild 机制（Phase C 停写与清理目标）+ legacy 读投影 |
| packages/db/src/technology-stack-entities.ts | 8 | shadow compare legacy 侧 + 启动检查计数 |
| apps/web/src/app/graph/page.tsx | 3 | 兼容期 reference kind 渲染残留 |
| packages/db/src/schema/index.ts | 2 | 列定义（cleanup migration 移除） |
| packages/shared/src/index.ts | 1 | reference kind 兼容（观察窗口后删） |
| packages/db/src/pipeline.ts | 1 | 待核对 |

业务读路径（仓库列表/详情/分组/收藏/Radar/Scheduler/embedding）经 Phase B 正向条件收敛后**已不引用** `is_reference`——9 站点全部使用 `githubRepositoryId IS NOT NULL`。

## 生产基线（Phase B closeout 后即时状态，2026-08-19T13:55Z）

- mode `new_read_dual_write`；40 真实 / 13 reference / 53 watched / 13 stacks / 79 rts；
- 新读 40+9+13 零悬空、rebuild succeeded ext=5、shadow legacy=79 new=79；
- 服务器 HEAD 8cd17c3（与 main 差 docs-only）；镜像同源构建。

## Plan review（两轮，approved）

第一轮 changes_requested（P0 冻结基线被普通 rebuild 摧毁 + 3 P1 拍板）→ 修订；第二轮 continuity 收窄（N1 journal 调和 receipt 守卫 DO block、N2 分 revision supported set、N3 谓词改写清单、N4 workflow 正文标注、N5 裁定路径/表载体/脚本职责）→ 全部写入后 approved（evt-20260819T141844Z）。

## 实现第一批：new_only 核心语义（2026-08-19）

- **P0 冻结基线保持**（repo-graph.ts）：`legacyWriterActive`（legacy_shadow/new_read）门控 legacy writer（reference upsert/伪 watch/legacy 栈边构造）与两个 GC DELETE；dependency 全量替换在 new_only+ 收窄为排除 `resolvedBy='tech-stack-catalog'` 的边；
- **冻结基线单向包含**（baseline-compare.ts 新增）：`snapshotLegacyTechnologyStackBaseline`（full-set key+digest 存 receipt 表，slug 自 target fullName 推导不读 is_reference）与 `compareBaselineToCurrent`（baseline ⊆ new，missing 才 fail；digest 仅约束 updatedAt<=冻结时间的行，重采集豁免）；比较内嵌在 recomputeDependencyEdges 提交后，new_only 下 drift 即任务失败；
- **读语义统一**：getRepoGraphData 对 new_read/new_only/legacy_cleaned 一律走新表投影（legacy 读仅 legacy mode 保留）；
- **marker 矩阵**：assertStorageModeStartupConsistency 增加 is_reference 列存在性判定（列不在：仅 legacy_cleaned 放行；列在：legacy_cleaned fail）；counts SQL 谓词改写为 github_repository_id IS NULL + full_name LIKE（不读列）；new_only 走完整检查链；
- **mode 门**：API/Worker supported 扩至三读模式（legacy_cleaned 随 cleanup revision）；worker 旧 shadow 门仅 dual-write 模式执行（new_only 由 baseline 比较守护）；
- 测试：phase-c-newonly.integration 3 例（P0 行数不变/单向包含 pass+missing fail/digest 豁免）+ marker 矩阵 3 新例（13/13）+ 既有全量回归——unit 全绿、integration **54/54**、全仓四门禁通过。

待第二批：legacy 物理删除面（getRepoGraphDataLegacy/旧 compare/backfill 机制）、cleanup 独立脚本+receipt 守卫 journal、deploy workflow opt-in job、rollback rehearsal、implementation review。

## 实现第二批：cleanup 操作与 workflow（2026-08-19）

- **cleanup 独立脚本**（technology-stack-cleanup.ts）：只读前置校验（mode=new_only、active job 排空、基线单向包含、FK 断言清单——chunks/hn/releases/**group_members（cascade 显式拦截）**/rts 对伪仓库引用为 0、legacy 栈边 (gid, slug) 一一映射核验）→ 单事务删除（legacy 栈边→伪 watched→伪 repositories 顺序服从外键，写 cleanup receipt 表）→ 事务后 receipt 守卫 DROP COLUMN is_reference。任何 gate 失败在破坏性操作前退出。
- **受控 CLI**（cleanup-cli.ts，构建为 dist/cleanup-cli.mjs）：`--validate`（preflight 只读）/`--execute`（维护窗口），mode 从环境读取并要求 new_only；由 deploy workflow 显式调用，不经 journal。
- **deploy workflow opt-in job**（technology-stack-cleanup）：`technology_stack_legacy_cleanup` 输入默认 false；与 `apply_database_migration` 互斥首步 fail；`concurrency: production`；四步（preflight 校验→pg_dump 备份可读验证→停 api/worker 执行+切 mode legacy_cleaned+重启→health/401 验证）；全部 command_timeout 有界。
- **集成 6 例**（phase-c-cleanup.integration）：gate×4（mode/active job/group_members cascade/基线 missing）+ 执行语义（伪数据清零、真实数据保持、列移除、receipt 落盘）+ 回滚 rehearsal（语义可恢复性：列+伪形态+边重建后真实数据未动）。
- 全套 integration **60/60**、全仓四门禁通过。

待第三批（生产执行前完成）：schema 列删除+journal receipt 守卫 DO block+大删除面（getRepoGraphDataLegacy/旧 compare/backfill 机制/共享 reference kind）、implementation review、PR/CI、用户维护窗口授权。

## 实现第三批：new_only revision 兼容代码删除（2026-08-19）

- **schema/journal**：`repositories.is_reference` 列定义移除；`technology_stack_baseline_receipts` / `technology_stack_cleanup_receipts` 声明进 schema（0010_thin_the_fury：CREATE IF NOT EXISTS + 约束命名与运行期 DDL 对齐；DROP COLUMN 改写为 cleanup receipt 守卫 DO block——`to_regclass` 收据表存在且含行且列仍在才执行，常规 migrate 与 fresh 重放结构 no-op）。migration matrix 集成用例（0004 baseline→latest）通过证明重放安全。
- **大删除面**（随 new_only revision，plan 兼容代码删除时序）：`getRepoGraphDataLegacy` 与 mode 分流（读统一新表投影）；`recomputeDependencyEdges` 的 reference upsert/伪 watch/legacy 栈边构造/两个 GC DELETE 整体删除；dependency 全量替换无条件收窄（排除 `resolvedBy='tech-stack-catalog'`）；冻结基线单向包含比较无条件执行；Phase A 一次性 backfill 机制全链删除（db 实现/jobs 入队与类型常量/worker handler/API 两个 procedure——jobs 表部分唯一索引保留以约束历史行，并发测试改字面量验证）；旧 `compareTechnologyStackProjection(Rows)` 随 dual-write 退役。
- **谓词改写**（plan N3 清单）：repo-graph 内部 6 处 `isReference` 站点（collectedRepos 过滤、repoByFullName、in-degree 跳过、edge 目标、backfillRepoEmbeddings/recomputeSimilarityEdges/backfillSbomPackages 范围）改为正向条件 `githubRepositoryId IS NOT NULL`（collectedRepos 用 JS 侧 null 判断）。
- **supported set 收紧**：API/Worker 仅 `["new_only"]`（注释固定 legacy_cleaned 随 cleanup revision 加入）；部署本 revision 必须与 `.env` mode 翻转同批（compose 重启窗口）——deploy workflow 为手动 workflow_dispatch，无自动触发风险。
- **时序澄清**：shared `repoGraphNodeSchema` 的 reference kind/`isReference` 字段与 Web 双 kind 兼容按 plan 第 62 行随 **cleanup revision**（下一批）删除，不在本批；本批 API 已不再产出 reference kind。
- **测试**：unit 231/231（删除 backfill/shadow/legacy 断言类用例，rebuild mock 增加基线比较 execute 空表恒过）；integration **48/48×2**（含新增无列环境 RED：cleanup 执行后列已 drop 时 getRepoGraphData 关键路径正常、stack 节点来自新表、reference kind 消失）；全仓 lint/typecheck/test/build 通过。
- 残余 `is_reference` 站点扫描：仅 marker 矩阵 information_schema 查询、cleanup 脚本自身 DROP、0010 守卫块、cleanup revision 待删的 contract 字段——全部为 plan 保留项。

待第四批（cleanup revision）：supported `{new_only, legacy_cleaned}`、shared reference kind/`isReference` 字段与 Web 双 kind 删除；随后 implementation review 汇总 → PR/CI → 生产执行（需用户维护窗口授权）。

## Implementation review 修复（2026-08-19，独立 reviewer CHANGES_REQUESTED 后）

- **P1-1（cleanup 死锁防护）**：`TECHNOLOGY_STACK_SUPPORTED_MODES` 常量成为 API/Worker 启动断言与 cleanup 前置 gate 的单一来源；`cleanup-cli --validate` 校验执行 revision 支持集含 `legacy_cleaned`，否则在破坏性步骤前拒绝（当前 new_only revision 即被拒）。集成测试以 `supportedModes` 显式模拟 cleanup revision，另有一例断言本 revision 默认支持集触发拒绝。
- **P1-2（marker 终态语义矛盾）**：marker 矩阵扩展——列存在 + 伪仓库计数为 0 时放行 `legacy_cleaned`（覆盖 DROP COLUMN 前中断的补删窗口与 fresh 重放库）；journal 0010 fresh 重放保留列的行为由 migration matrix 新断言钉住（第 8 项）；plan 权威文本同步修订。
- **P3-3（幂等补删）**：validate 识别"数据已删+receipt 已落盘+列仍在"的补删完成路径（`alreadyCleaned`）；execute 该路径不再触碰数据、不写第二条 receipt；`droppedColumn` 返回 information_schema 实测值。
- **P2-1**：runbook 新增 `TECHNOLOGY_STACK_STORAGE_MODE` 环境变量说明与"技术栈 new_only 切换与 cleanup 维护窗口"完整流程（同批翻转、前置条件、回滚、补删）。
- **P2-2**：deploy workflow 顶层 `concurrency: production`（deploy 与 cleanup run 互斥排队）。
- **P2-4/P2-5**：回滚 rehearsal 改为真实调用 getRepoGraphData 断言业务路径（伪形态恢复后 reference kind 不重现）；新增端到端用例——基线 missing 时 rebuild 提交后抛错且冻结形态不被触碰。
- **P3**：marker 查询加 `table_schema='public'`；0010 撤销手工内联约束（回归生成形态，消除冗余同名索引）；jobs.test/concurrency.test 死 import 清理；phase-c-cleanup fixture `sortOrder`→`orderIndex`。
- **P2-3（preflight SHA/revision/长事务 gate）**：revision 支持集已结构性覆盖最危险项；SHA/长事务核对写入 runbook 维护窗口前置条件清单，随 cleanup revision 批次的 workflow 终稿一并落地。
- **P3-6（identity 缺失真实仓库静默跳过）**：生产前提（identity backfill applied）下无差异，记录为已知等价前提，不单独处理。
- 回归：unit 232/232、integration **51/51×2**、lint/typecheck/test/build 全绿。

## Implementation review 终审（2026-08-19）：APPROVE

独立 reviewer 对修复提交 79bc405 全量 diff 复核 + 本地实证（phase-c 15/15、单测抽查），对 marker 改写与补删路径做对抗性场景枚举后给出 APPROVE：P1-1/P1-2 以"代码 gate + 集成测试 + 权威文档"三层关闭，P2 全部处置，P3 仅余两项书面记录的后续批处置（P2-3 的 lock_timeout、P3-6 等价前提）。

**带入 cleanup revision 批次（第四批）的待办**（reviewer 备注）：
1. execute 的 DELETE 增加 `lock_timeout`/`statement_timeout`（plan 第 76 行）；
2. runbook 补本地开发 mode 指引（db:push 建库无列，new_only revision 下仅 legacy_cleaned 可启动）；
3. cleanup job 的 job 级 concurrency 组与顶层组冗余可清理；
4. baseline-compare 运行期 DDL 与 0010 命名形态差异（错序窗口双唯一索引，冗余无害）；
5. P2-3 workflow 终稿：target SHA/容器 digest 核对步骤代码化。

## 实现第四批：cleanup revision（2026-08-19）

- **supported set**：`TECHNOLOGY_STACK_SUPPORTED_MODES = {new_only, legacy_cleaned}`（维护窗口前 new_only、cleanup 后 legacy_cleaned 同 revision 重启）；API/Worker 注释同步。
- **contract 删除**（plan 第 62 行 cleanup revision 时序）：shared `repoGraphNodeSchema` 删除 `reference` kind 与 `isReference` 字段（fail closed）；Web `isTechnologyStackGraphNode` 收敛单 kind；graph 页 mock 数据改用 `stack:<slug>` + `technology_stack`；`RepoGraphDataNode` 同步收敛。
- **reviewer 待办关闭**：
  - execute 删除事务 `SET LOCAL lock_timeout=10s / statement_timeout=120s`，DROP COLUMN 独立短事务 `10s/30s`（plan 第 76 行）；
  - baseline-compare 运行期 DDL 拆出命名 `create unique index if not exists`（与 journal 0010 同名，错序窗口无双索引）；
  - cleanup workflow 撤冗余 job 级 concurrency（顶层 `production` 组统一互斥）；
  - preflight 增加 revision 对账（服务器工作树 HEAD == 本 run SHA + api/worker 运行容器镜像 == 当前镜像，P2-3 代码化）；
  - runbook 补本地开发 mode 指引（db:push 库无列 → `legacy_cleaned`；迁移库 → `new_only`）。
- **测试**：contract fail-closed 用例（reference kind 解析抛错）；revision gate 用例改为显式模拟不支持集 + 默认集对照；unit 232/232、integration **51/51×2**、四门禁全绿。

待生产执行（需用户授权）：new_only 切换窗口（部署本 revision + .env 同批翻转 + 基线快照固化）→ 观察窗口 → cleanup 维护窗口（workflow opt-in）→ 终态 revision（仅 legacy_cleaned）。

## Implementation review（第四批）：APPROVE + 收尾修复（2026-08-19）

独立 reviewer 终审 APPROVE（supported set 三层组合无矛盾、contract 删除面干净且 zod 剥离行为在原子部署前提下成立、SET LOCAL 用法正确、DDL 命名三方一致、测试真实锁定语义）。随批修复其 P2/P3：

- P2-1：cleanup run 中 deploy job 以 `if: technology_stack_legacy_cleanup != 'true'` 跳过，消除 force-recreate 与 cleanup 停服/删除链的并行交错窗口；
- P2-2：runbook 首段 revision 描述同步为 cleanup revision（{new_only, legacy_cleaned}）；
- P3-1：集成测试锁定 `TECHNOLOGY_STACK_SUPPORTED_MODES` 编译期常量含 legacy_cleaned 并行使默认分支（常量被误改回时立即失败）；
- P3-2：repo-graph.test 三处缩进漂移修正；
- P3-3：runbook 补删段写明 `.env` 已切 legacy_cleaned 后的触发方式（人工 SSH 执行 cleanup-cli）。

回归：integration 51/51、四门禁全绿。
