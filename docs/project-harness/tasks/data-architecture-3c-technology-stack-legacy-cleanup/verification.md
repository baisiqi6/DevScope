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
