# Closeout Packet

## Subject

- Checklist item: `data-correctness-2-atomic-replacement`
- Reviewer: `release_id_migration_reviewer`
- Updated at: `2026-08-18`
- Canonical plan path: `docs/project-harness/tasks/data-correctness-2-atomic-replacement/plan.md`

## Item Snapshot

- Title: 使采集子数据整体原子替换
- Status: doing
- Workflow status: closeout_requested
- Priority: p0
- Owner: codex
- Session: codex-20260818-atomic-replacement
- Dependencies: data-correctness-1b-repository-identity

## Acceptance

chunks、Hacker News 与 Releases 明确区分 success([]) 和 failure；短事务整体替换，失败保留旧快照，并发采集不产生空集、半份快照或交叉覆盖。

## Verification



## Handoff

复用现有 jobs 或最小 PostgreSQL 锁，不新增第二套队列。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
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
```

## Recent Progress Context

```md
# DevScope Harness 进展

> 更新时间：2026-08-18
> 基线：`main@647dc62`
> 部署形态：Standalone
> 当前状态：Release ID、Repository stable identity 与 group count contract items 已关闭；下一步进入采集子数据原子替换整改

## 已完成

- 完成项目、文档、源码、测试和生产数据库的只读基线审计；
- 将项目范围、架构、数据模型、运行手册、任务状态和 task plan 拆成唯一事实来源；
- 建立高风险数据整改 checklist 和第一个 Release ID 任务计划；
- 保持 Agent/MCP 接口指南为独立接口文档，通过 Harness 单向引用。
- 完成 `releases.id` 的 Drizzle `bigint` 映射、无损采集边界、十进制字符串 API 契约和显式迁移；
- 删除 tag hash 伪 Release 降级，在本地 PostgreSQL 完成 188 条历史 fixture 升级与大 ID 往返演练；
- focused tests、全仓 lint/typecheck/test/build 与迁移再生成检查全部通过。
- 独立 reviewer 首轮提出 JavaScript safe integer 与迁移锁门禁问题；修订后 continuity 复核为 `APPROVE`。
- PR #27 已通过 CI 并合并，手动部署 workflow run 32112032164 已完成生产备份、显式迁移和应用发布；
- 生产 `releases.id` 已变为 `bigint`，迁移前备份与在线库 191 条有序 `(id, repo_id)` 行集哈希一致；
- 生产 API/Web/Worker/PostgreSQL/Nginx 健康，未认证访问为 401，Keychain + SSH tunnel 的认证 health 为 `ok`。
- 独立 closeout reviewer 再次核对 Git、Actions、两份备份、在线数据库和服务证据后给出 `APPROVE`；Harness 已将 item 标记为 `done`。
- PR #29 已通过修订后的干净 CI 并合并，手动部署 workflow run 32121157975 完成生产备份、显式 `0007` 迁移和 compatibility 发布；
- 生产 Radar 重复组从 1 降为 0；one-shot job 26 以 `applied` 终态为 22 个真实 GitHub 仓库回填稳定 ID，`unresolved=0`、`conflicts=0`；
- 10 个 `tech-stack/*` reference rows 保持无 GitHub ID，正式仓库 ID、关注名称、分组成员和 Radar 不变量复核通过；
- `REPOSITORY_IDENTITY_CUTOVER=enabled` 已只在 API 生效，生产 API/Web/Worker、Nginx 访问控制及 Keychain + SSH tunnel MCP health 均验证通过。
- Repository stable identity 的独立 production closeout review 为 `APPROVE`，Harness 已将 `data-correctness-1b-repository-identity` 标记为 `done`；
- 认证 MCP dogfood 暴露 `groups.list` 的 `repoCount` string/number 类型漂移，已确认是早于本次迁移的独立 P2 correctness follow-up。

## 当前小项

- `data-correctness-1c-group-count-contract` 已独立登记并通过 plan review；
- RED tests 已复现 PostgreSQL `count` string 泄漏到 API 输出，最小实现改为严格 runtime normalization；
- 未修改 schema、migration 或分组数据；focused API tests 与 typecheck 已通过，下一步为全仓门禁与独立 implementation review。
- 全仓四项门禁与独立 implementation review 已通过，PR #31 合并为 `main@7245b5d`；
- 无迁移 deploy run 32124923912 成功，migration rows 保持 8；认证 MCP 分组列表已恢复，7 个 `repoCount` 均为 number；
- 部署期间并行 dogfood 会话把 group members 从 16 增至 63，本修复无 group mutation，保留全部业务写入；下一步仅做独立 closeout。
- 独立 production closeout review 确认上述并发写入早于部署、线上数值计数与 63 条关系一致，最终 verdict 为 `APPROVE`；Harness 已将 1C 标记为 `done`。
- `data-correctness-2-atomic-replacement` 已完成源码与生产只读基线核验：三类来源均存在空结果不清旧数据，delete/insert 分离，且 HN/Releases 把失败吞成空数组；后台 embedding 还存在第二个 chunks 替换窗口。
- 2026-08-18 生产当前有 50 个仓库行（40 个真实仓库）、35815 chunks、0 HN items、362 releases；40 个真实仓库 embedding 均为 `completed`，未发现重复 chunk natural key、Release ID 跨仓库冲突、active collection-like job 或长事务。
- 已形成 `tasks/data-correctness-2-atomic-replacement/plan.md`，下一步进行独立 plan review 后进入 RED tests。
- 原子替换计划经过五轮独立 continuity review 后获 `APPROVE`；已实现 stable-ID 锁、数据库严格单调毫秒 token、三来源 structured outcome、单事务快照提交与版本安全 embedding/SBOM 派生写入。
- 定向 DB/API 单元测试、真实 PostgreSQL 10 个事务与双连接竞争场景、全仓 lint/typecheck/test/build 均通过；未新增 migration，下一步进行独立 implementation review。
- 独立 implementation review 首轮发现 reconcile 撤销活跃 claim、malformed SBOM 误清空与并发证据不足；已完成最小修复并把真实 PostgreSQL 定向场景扩展为 10 个，等待 continuity 复核。
- continuity implementation review 确认四项 finding 均已关闭，未发现剩余 P0–P3 finding，最终 verdict 为 `APPROVE`；下一步提交 PR 并等待 CI。
- PR #33 与 CI 已通过并合并为 `main@de3b917`；无迁移 deploy run `32137164791` 的 attempt 2 成功，API/Web/Worker 镜像 revision 一致，migration rows 保持 8，服务与公网 401 访问控制正常。
- 通过 Keychain + SSH tunnel 的认证 MCP 对 `deepseek-ai/deepseek-harness` 完成正常采集 dogfood：token 严格前进，chunk/Release/HN 快照一致，成功空 SBOM 规范化为 `[]`，后台 embedding 完成 `1/1`；全库 40 个真实仓库均为 `completed`，三类一致性冲突为 0。
- Hacker News 外部 API 本次返回 400，按 optional source warning 降级并保留旧快照，未破坏主采集；下一步仅进行独立 production closeout review 与 Harness 关闭。

## 已验证基线

2026-08-17 对 `main@b64d6a0` 与生产 PostgreSQL 完成只读检查：

- PostgreSQL 16.13，`vector` 0.8.2；
- `0000`–`0005` 六条迁移的 SHA-256 与生产迁移历史逐条一致；
- 1 个用户、20 个真实仓库、10 个技术栈 reference rows；
- 19173 个 chunks 全部含有 1024 维 embedding；
- 未发现重复 chunk key、workflow 用户错配、图自环、非法计数或 Trending 数量错配；
- DB 包 8 个测试文件、101 个单元测试通过，typecheck 通过；
- 现有持久化测试主要 mock Drizzle query builder，尚无真实 PostgreSQL 集成测试。

这些是日期化证据，不是永久不变的产品声明。需要依赖生产现状时必须重新验证。

## 当前 handoff

- 最近完成 item：`data-correctness-1a-release-id-bigint`；
- Canonical plan：`tasks/data-correctness-1a-release-id-bigint/plan.md`；
- Verification：`tasks/data-correctness-1a-release-id-bigint/verification.md`；
- 独立 correctness/迁移 review 与生产 closeout review 均已批准，生产验收已经落盘；
- 最近完成 item：`data-correctness-1b-repository-identity`；
- Canonical plan：`tasks/data-correctness-1b-repository-identity/plan.md`；
- Production baseline：`tasks/data-correctness-1b-repository-identity/verification.md`；
- 生产只读预检发现 22 个真实仓库中 19 个可解析稳定 ID、3 个 unresolved；Radar 有 1 组可确定性合并的同 ID 重复；
- 两轮 continuity review 已关闭 compatibility/backfill 窗口、lease 原子授权、不可变审计、Radar 全序 tie-break 与 active singleton 风险，最终 verdict 为 `APPROVE`；
- 稳定 ID 边界、ID-first repository/Radar 写入、one-shot backfill、lease 原子 apply、`0007` 合并迁移与 compatibility/cutover 已完成；
- 首轮实现审查发现的 Radar ID 擦除、following 错误关联和终态 version 伪报问题均已修复，continuity verdict 为 `APPROVE`；
- 全仓 lint/typecheck/test/build、真实 PostgreSQL 演练与迁移再生成检查通过；PR/CI、显式迁移、one-shot backfill、cutover 与独立 closeout 已完成；下一步先用独立小 item 修复 dogfood 暴露的 group count 契约，再进入 `data-correctness-2-atomic-replacement`。

## Harness 初始化验证

- EXharness checklist semantic validator：通过，0 warnings；
- `harness-checklist.json` 与 `harness-config.json` JSON 解析：通过；
- 10 个 Markdown 文件的本地链接目标检查：通过；
- 旧文档路径残留检查与 `git diff --check`：通过；
- `pnpm lint`：通过，保留 16 个既有前端 warnings；
- `pnpm typecheck`、`pnpm test`、`pnpm build`：通过。

## 未关闭风险

风险定义与目标设计见 [domain-model.md](domain-model.md)，当前状态和依赖见 [harness-checklist.json](harness-checklist.json)。本文件不重复维护风险表。

## 更新规则

- 只记录日期化验证摘要、完成结果和下一 handoff；
- 稳定设计变化写入对应规范，不在此复制；
- item 状态只通过 checklist 更新；
- 详细执行轨迹、review 和 receipt 写入对应 task 目录；
- 历史细节由 Git 保存，不把本文件写成逐命令流水账。
```

## Current Review Content

```md
# 当前审查

`data-correctness-1c-group-count-contract` 已完成独立 closeout review，完整记录归档于 [任务审查记录](../tasks/data-correctness-1c-group-count-contract/review.md)。下一个 item 开始审查时，由 Harness 重新生成本文件。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
