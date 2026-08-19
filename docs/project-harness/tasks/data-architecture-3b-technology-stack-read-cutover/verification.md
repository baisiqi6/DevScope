# Implementation Verification：data-architecture-3b-technology-stack-read-cutover

> 记录日期：2026-08-19（UTC）
> 分支：`codex/phase-b-read-cutover`（base `main@59066cd`）
> 状态：baseline 已记录，plan review 进行中

## Baseline（plan step 1）

**前置确认**（checklist + events）：

- `data-correctness-4-deps-cache-recovery` done（production closeout APPROVE，2026-08-19）；
- `data-architecture-3-technology-stack-entities`（Phase A）done（closeout APPROVE，投影零差异独立重算）；
- `data-quality-5-postgres-integration-gates` done（PR #40，CI integration job 运行中）。

**生产基线**（Phase A closeout 时实测，日期化证据）：

- mode：`legacy_shadow_dual_write`（宿主未设，compose fallback 注入）；
- 迁移账本 10 条（0000-0009）；
- 真实仓库 40 / reference 13 / watched 53 / dependency 边 93 / similarity 边 40 / `repository_technology_stacks` 79 / `technology_stacks` 13 / chunks 34599；
- new/legacy 投影 sorted 签名双向零差异（79 行、379 packages evidence、25 sources）；
- 生产容器 revision：**916bc66 旧镜像运行中**（2026-08-19 网络故障期间未完成镜像更新；服务器代码 worktree 已 ff 到 59066cd，镜像待 ghcr 恢复后重试 `deploy.yml`——见 MiniMax item 的 infra blocker 记录）。Phase B 的 compatibility revision 部署将携带这次镜像更新。

**consumer 现状盘点**：

- graph contract：shared `repoGraphSchema` 的 node kind 为 `repo | reference | language`，`isReference` 字段对外暴露；Web 2D/3D 渲染按 `reference` 判断（`apps/web/src/app/graph/page.tsx`）；web 有独立 `graph-contract.test.ts`；
- `isReference`/`is_reference` 散落：12 个源文件（web graph 页面、api router.ts/scheduler.ts/groups.ts、shared schema、db pipeline/radar/repository-identity/technology-stack-entities 等），`isReference` 引用约 85 处——正向条件收敛的主要工作量所在；
- CLI/MCP 经 `packages/client` 的 `repoGraphSchema` 消费同一 contract；
- mode 枚举：`parseTechnologyStackStorageMode` 当前只接受 `legacy_shadow_dual_write`（fail closed 已就位，Phase B 加入 `new_read_dual_write`）。

## 待 plan review 结论后继续

RED tests 与实现设计（watched source join 读模型、`stack:<slug>` node、top-N 投影层计算、mode 一致性校验、正向条件收敛）将按 review 后的 plan 执行。
