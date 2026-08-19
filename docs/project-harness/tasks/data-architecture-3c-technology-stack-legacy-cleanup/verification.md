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

## 待 plan review 结论后填写实现记录
