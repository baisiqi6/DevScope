# 使采集子数据整体原子替换

## Item

- Checklist item：`data-correctness-2-atomic-replacement`
- Owner：`codex`
- Session：`codex-20260818-atomic-replacement`
- Updated at：2026-08-18

## Goal

将仓库采集生成的 `repo_chunks`、`hackernews_items` 与 `releases` 作为经过验证的来源快照，在同一个短 PostgreSQL 事务中按来源整体替换；成功空结果清除旧数据，来源失败保留旧快照，并阻止并发采集或后台 embedding 把较旧版本覆盖到较新版本之上。

## Confirmed Root Causes

1. 当前三类数据均只在 `items.length > 0` 时执行删除和插入，`success([])` 会错误保留旧数据；
2. 当前删除与插入是两个独立提交，插入失败会留下空集；
3. `GitHubCollector.getReleases` 与 `fetchHackerNews` 把网络失败吞成 `[]`，调用方无法区分真空结果与失败；
4. API 的 `activeRepositoryCollections` 只保护单进程请求，Scheduler 与其他 API 实例不受保护；
5. 后台 embedding 再次独立删除、插入 chunks，存在空窗、部分结果丢失和同版本重复执行的问题；
6. `repositories.updated_at` 可以复用为已提交采集快照的版本令牌，但当前流程在分块前先 upsert，失败轮次也会推进它；必须把 metadata upsert、token 分配与子快照提交合并到最终事务，且由 PostgreSQL 分配严格单调、可由 JavaScript `Date` 无损往返的毫秒值；
7. Scheduler pooling、API `syncEmbeddingStatus`、独立 `sync-embedding-status.ts` 与图重建 backfill 都能写 repository embedding 或状态，必须全部纳入版本护栏。

## Design

### 来源结果语义

- chunks 来源属于主 GitHub 采集：GitHub 拉取或分块失败使整个采集失败，不执行任何子数据替换；合法空 chunks 是 `success([])`；
- Hacker News 与 Releases 是可选来源：正常 HTTP 响应在事务外通过 Zod 与 Release ID 边界校验后映射为 `success(items)`，其中空数组仍是成功；请求、响应解析或字段校验失败映射为 `failure(error)`；配置明确禁用的来源映射为 `skipped`，不写数据也不产生告警；
- SBOM 同样使用 `success(packages) | failure(error) | skipped`：成功空包列表清除旧 SBOM，失败或禁用保留旧值；
- optional source failure 不删除其上一份成功快照，并写入结构化日志及 `CollectionResult.warning`；本 item 不增加通用采集运行表。若后续把采集迁入现有 `jobs`，由 job receipt 承担持久运行记录。
- SBOM 的 404 映射为 `success([])`；合法 envelope 映射为 `success(parsed packages)`；malformed 200、网络或解析错误映射为 `failure(error)`；
- 多个 optional failure 按固定来源顺序（Hacker News、Releases、SBOM）聚合为一个兼容现有 API 的 warning string；API 原样返回，Scheduler 逐来源写结构化日志。

### 严格单调的已提交采集版本

- GitHub repository、HN、Releases、SBOM 的网络读取、runtime validation 与文本分块全部先在事务外完成；此阶段不得修改 repository row 或 embedding authority；
- 最终事务先用 GitHub stable ID 派生 PostgreSQL advisory key，因此新仓库还没有 `repoId` 时也能跨进程串行；随后在同一事务中完成 repository identity/metadata upsert、子数据替换与 embedding 初态；
- 对已有仓库，在当前仓库行锁内用 PostgreSQL 表达式写入 `GREATEST(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', updated_at) + interval '1 millisecond') RETURNING updated_at`；
- 该值精确到毫秒，数据库内严格大于上一版本，并可由 node-postgres `Date` 无损往返；不得继续使用应用侧 `new Date()` 作为采集版本；
- 新仓库 INSERT 不依赖 `defaultNow()`，显式写入 `date_trunc('milliseconds', clock_timestamp()::timestamp)` 并以实际 `RETURNING updated_at` 作为首个 token，保证数据库没有 node-postgres `Date` 无法往返的微秒余数；并发创建仍由现有唯一约束 fail closed；
- 只有最终快照事务成功才推进 token；准备失败或事务回滚不会使上一快照及其 embedding 失去 authority；
- 版本 token 只表示仓库采集快照代际。embedding progress、终态、pooling、状态修复、SBOM backfill 和已完成的 identity backfill 均不得推进或回退它。技术栈 reference rows 不参与真实仓库采集 token；
- 审计并移除真实仓库非采集 writer 对 `updatedAt` 的赋值：当前 SBOM backfill 与 one-shot identity backfill 不再写该字段；reference row 自身的 `updatedAt` 不属于此 token 边界。

### 原子快照提交

在 `packages/db/src/collection.ts` 增加一个直接领域函数，接收全部已验证的事务外准备结果：

- GitHub stable identity、repository metadata、可选 SBOM outcome；
- 必定成功准备完成的 chunks；
- HN/Releases 的 `success(items) | failure(error) | skipped` 结果；
- 本轮 embedding 初始状态。函数返回已提交 repository 与严格单调 token；事务前不存在本轮 token。

函数只做数据库工作，并在一个短事务中：

1. 获取固定 namespace + GitHub stable ID hash 的 `pg_advisory_xact_lock`；
2. 按 stable ID 优先、fullName 回退执行现有 identity conflict 检查与 repository upsert，在行锁内分配并返回新 token；
3. 只替换 `success` 来源；空数组执行 delete 且不 insert；`failure`/`skipped` 来源不触碰旧行；
4. chunks 的替换、repository mean 清空和 embedding 状态重置在同一事务中完成；
5. 非空 chunks写 `pending/0/N`，并清理 started/completed/error；空 chunks 写非 claim 终态 `completed/0/0`，清理 started/error、记录本次 completed time；两者均同步设置 `repositories.embedding=null`；
6. 任意 repository upsert、delete、insert 或状态更新失败时整体回滚，旧 metadata、token、子数据、mean 与 embedding authority 全部不变。

事务内不执行 GitHub、HN、模型 embedding、SBOM 或其他网络请求，也不做文本分块；版本安全 pooling 允许在锁内使用 PostgreSQL vector aggregate 读取并聚合同一稳定快照。

### 并发与后台 embedding

- 最终事务返回的严格单调 `updatedAt` 是已提交快照版本；PostgreSQL advisory transaction lock 使多个进程的同仓库提交串行化，每轮都整体提交并取得不同 token，不能出现三类表各自来自不同并发提交的交叉快照；
- 后台 embedding 入口只接收 `repoId + expectedToken`，不得接收调用方可任意组合的 chunks；claim 在同一个短事务中取得 stable-ID advisory lock 与 repository row lock，严格校验 token、CAS `pending → processing`，并读取返回该 token 对应的完整 chunks；未 claim 到的重复或旧版本执行直接退出；
- API 使用 collection final transaction 返回的 token 启动 embedding；Scheduler 必须先读取候选 repository token，再调用 claim，不能在外部预读 chunks 或采用“先读 chunks、后重读 token”的顺序；模型网络计算只使用 claim 返回的不可混配快照；
- embedding 方法返回 `applied | stale | not_claimed | failed` 的结构化 outcome。API/Scheduler 只有在采集 `completed` 且原子快照已提交时才能启动 embedding；Scheduler 只有 `applied` 才计成功，不再在方法返回后执行无条件 pooling；
- embedding 网络计算和 repository mean 计算继续在事务外；mean 只使用成功生成且 chunkType 为 `readme | description` 的向量。最终 chunks、repository mean 与 embedding 终态复用同一仓库锁和版本令牌，在同一事务中写入；单个 embedding 失败保留对应 chunk 且 embedding 为 `null`，不再丢失文本；
- embedding 最终写失败时事务回滚，保留快速采集产生的完整无向量 chunks，并以条件状态更新记录 `failed`；旧版本 embedding 的进度和终态更新均不得修改新版本状态。
- `poolRepoEmbedding`/图重建 backfill 必须先取得相同 advisory lock 与 repository row lock，只在锁内重新确认 `embeddingStatus=completed` 后读取稳定 chunks、用 PostgreSQL vector aggregate 计算 mean 并写回；不得保留锁外 read-compute-write；
- API 与独立脚本统一复用版本安全的 status reconcile 领域函数：先取得相同锁与 row lock，再在事务内统计 chunks、CAS 更新状态；不得保留只按 `repoId` 的无条件写者。
- SBOM backfill 在网络前捕获非空 stable ID、token 与待回填 JSON baseline；网络后取得相同 stable-ID advisory lock 与 row lock，只有 token 未变、字段仍与 baseline `IS NOT DISTINCT FROM` 且仍满足 missing/legacy 条件时才写入，否则返回 `stale | no_op`。它不推进 token，不得只按 `repoId` 更新。

### Pipeline 与调用方 outcome

- `completed`：原子快照已经提交；可以附带 optional source warning。只有该状态允许 API 创建 watched relation、读取本轮 chunks 并尝试启动 embedding，Scheduler 才计本轮采集成功；
- `failed`：主 GitHub 拉取、分块、数据库或验证失败；不得创建 watched relation、启动旧 chunks embedding、重置状态或计成功；
- collection 不再在事务前预留 token。并发轮次由 final transaction 串行整体提交，因此正常 collection outcome 只需 `completed | failed`；embedding 与其他派生写者仍用 `stale` 表示 token 已被更新快照取代；
- embedding outcome 与 collection outcome 分开，不用 `embeddingInBackground` 伪装已完成；后台任务是否真正 applied 由结构化日志和最终状态反映。

## Test-Driven Implementation

### RED tests

1. 真实事务 helper：非空替换、三来源成功空集、optional failure/skipped 保留、非法 optional payload 隔离、repository/insert/status 任一步失败整体回滚且 token 不推进；
2. 并发：强制两个提交使用同一应用时间，数据库仍分配严格递增 token；新仓库首个 token 没有微秒余数且经 node-postgres `Date` 回传可 claim；用两个独立连接验证 stable-ID lock 串行，每轮结果整体提交且最终结果不交叉；
3. Pipeline：HN/Releases 网络或字段校验失败不再伪装成空结果，多个 warning 顺序确定且旧快照保留；
4. API/Scheduler：collection `failed` 不创建 watched relation、不启动 embedding、不重置状态且不计成功；
5. embedding：入口只允许 `repoId + token`，claim 与 chunks 读取同一锁定事务；在旧 chunks 读取与 claim 之间提交新 collection 时，旧调用只能 `stale | not_claimed`，不得形成“旧 chunks + 新 token”；另覆盖单一 claim、版本失效退出、最终原子替换、部分 embedding 失败不删除 chunk，以及 progress/final/failure catch 前的新采集零写入；
6. 同一 token 派生写竞争：两个连接强制 final-vs-pooling 与 final-vs-reconcile 交错；pooling/status 必须等待锁并读取 final 后的稳定 chunks，不能写回锁外旧统计；pending 窗口和空 chunks 均不得暴露旧 repository mean；
7. SBOM：404 清空、合法 envelope 更新、malformed/network failure 保留；两个连接强制 collection-final-vs-SBOM-backfill 交错，旧 baseline 回填只能 `stale | no_op`；
8. Scheduler：只把 embedding `applied` 计成功，不再在返回后无条件 pooling；API 与独立脚本的状态修复复用同一个版本安全函数。

单元测试负责来源语义和编排；事务回滚、锁与竞争必须在真实 PostgreSQL 上验证。真实 PostgreSQL 的通用 CI 门禁仍由后续 `data-correctness-6-postgres-integration` 完整建设，本 item 至少提供可重复的定向演练或测试脚本，不用 mock 结论代替事务证据。

## Files In Scope

- `packages/db/src/collection.ts` 及其测试；
- `packages/db/src/pipeline.ts` 及其测试；
- `packages/db/src/github.ts` 的 Release 失败语义及测试；
- `packages/db/src/repo-graph.ts` 的版本安全 pooling、`packages/db/src/sync-embedding-status.ts` 的统一 status reconcile 及测试；
- `packages/shared/src/github-client.ts` 的 SBOM runtime envelope 语义及测试；
- `packages/db/src/repository-identity.ts`：移除 one-shot identity backfill 对采集 token 的写入，并更新测试；
- `apps/api/src/router.ts`、`apps/api/src/scheduler.ts` 与必要测试；
- 本 item 的 Harness plan、review、verification 与日期化 progress。

## Out Of Scope

- 不新增队列、Repository 抽象、事件溯源或采集运行通用框架；
- 不把仓库采集整体迁移到 Worker；
- 不处理技术栈独立表、deps.dev TTL 或公开多用户鉴权；
- 不删除或重写当前生产数据；
- 不修改另一会话正在维护的 dogfood 文档。

## Verification And Deployment

- focused tests 与受影响包 typecheck；
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- 在隔离 PostgreSQL 中用两个独立连接验证新仓库 token 精度、同毫秒 token、stable-ID 锁串行、insert rollback 不推进 token、三来源空集/失败、stale progress/final/catch 零写入、同 token final-vs-pooling/reconcile 必须锁后读取，以及 collection-final-vs-SBOM-backfill CAS；
- 独立 implementation review、PR 与 CI；
- 本设计不要求 schema migration，部署必须显式 `apply_database_migration=false`；
- 部署前后核对三类表总量/按仓库分布、重复键、embedding 状态、migration rows、服务健康、访问控制和认证 MCP；
- 生产只做正常采集 dogfood，不注入故障；对目标仓库记录采集前后的有序行摘要、SBOM packages 摘要、版本 token 和 embedding 终态，故障回滚证据来自隔离 PostgreSQL。

## Production Baseline

2026-08-18 部署前只读快照：50 个 repository rows，其中 40 个真实仓库；35815 chunks 覆盖 40 个仓库，单仓库 1–2736；HN 当前 0 行；362 releases 覆盖 39 个仓库，单仓库 1–10。40 个真实仓库的 embedding 状态均为 `completed`；未发现重复 chunk natural key、Release ID 跨仓库冲突、active collection-like job 或超过 30 秒的长事务。该数字是日期化证据，不是固定验收常量。

## Exit Criteria

- `success([])` 对三类来源都能清除旧数据，`failure(error)` 不清除旧数据；
- 任意插入或终态更新失败后，上一份完整快照仍可读取；
- 同仓库并发采集和 embedding 不产生空窗、半份快照、交叉覆盖或旧版本状态污染；准备或提交失败不推进 token，也不中断上一份有效快照的 embedding authority；
- 数据库为每轮已存在仓库采集分配严格递增、毫秒精度的版本 token；所有 repository embedding/status 写者受 token 与锁保护；
- embedding claim、token 校验与 chunks 读取属于同一锁定事务，调用方不能构造跨版本的 chunks/token 组合；
- collection `failed` 的 API 与 Scheduler 调用方不产生 watched、embedding 或成功计数副作用；disabled optional source 保持 `skipped`；
- quick snapshot 与空 chunks 都同步清除旧 repository mean；空 chunks 进入不可 claim 的明确完成态；
- 所有网络、文本分块和模型 embedding generation 都位于事务外；锁内只允许短数据库替换、状态统计与 vector aggregate；
- 无新增 schema migration，完整门禁、真实 PostgreSQL 定向验证、独立 review、CI、部署与生产只读复核通过。
