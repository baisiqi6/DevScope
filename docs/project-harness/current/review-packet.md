# Review Packet

## Subject

- Checklist item: `data-correctness-4-deps-cache-recovery`
- Reviewer: `reviewer-plan`
- Updated at: `2026-08-19`
- Canonical plan path: `docs/project-harness/tasks/data-correctness-4-deps-cache-recovery/plan.md`

## Item Snapshot

- Title: 使依赖解析缓存可恢复且具备外呼预算
- Status: doing
- Workflow status: running
- Priority: p1
- Owner: codex
- Session: codex-20260818-deps-cache-recovery
- Dependencies: data-correctness-2-atomic-replacement

## Acceptance

resolved、not_found、error 与 TTL/retry_after 可验证；deps.dev/GitHub 外呼具备 timeout、有界并发和单次预算；warm rebuild 不重复大规模外呼，graph 原子写与 shadow zero-diff 保持不变。

## Verification



## Handoff

按 canonical plan 完成独立 plan/implementation/production review；Reviewer 批准前不得恢复技术栈 Phase B。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 依赖解析缓存恢复与外呼预算计划

> Item：`data-correctness-4-deps-cache-recovery`
> Priority：P1
> 状态：待领取、待独立 plan review
> 前置：`data-correctness-2-atomic-replacement`
> 阻断：`data-architecture-3-technology-stack-entities` 的 Phase B

## Outcome

让 graph rebuild 的 deps.dev 映射与 GitHub repository canonicalization 同时满足：临时失败可恢复、真阴性可缓存、单次外呼有超时/并发/总量预算、长任务有可观测进度、最终 graph 写入继续 fail closed。修复后不得改变技术栈目录、top-N、edge evidence、repository identity 或 Phase A 新旧投影语义。

## 生产触发证据

2026-08-18 的 Phase A graph job #9 从 `14:20:25.255Z` 运行到 `15:31:09.406Z`，总计约 70 分 44 秒，最终成功：

- 40 个真实仓库包含 19007 个唯一 SBOM package/version；首次运行补齐约 6000 个 deps.dev cache miss；
- 3053 个外部 GitHub target 达到当前 `CANONICALIZATION_MIN_INDEGREE=2` 门槛，逐个串行 canonicalize；
- `resolveViaDepsDev` 使用无显式 timeout 的原生 `fetch`；`getCanonicalFullName` 也没有 timeout；
- deps.dev 网络错误与权威无映射都可能落为 `source_repo=null`，无法按失败类型恢复；
- GitHub canonicalization 没有持久 freshness，warm rebuild 仍会重复外呼；
- job lease 持续健康、数据库没有长事务，证明瓶颈位于事务外网络阶段；但 status API 只有 running/terminal，没有 stage/total/completed。

以上数字是日期化生产基线，不得硬编码为长期产品常量。

## Authority And Sequencing

下一位 Worker 按以下顺序执行；不得跳过独立 review、直接进入 Phase B，或顺手重做 graph UI：

1. 只读复核最新 `main`、本计划、当前生产 migration/job/cache 基线；
2. 请求独立 plan review，关闭 correctness、rate-limit、lease、migration 和 rollback finding；
3. 以 RED tests 固化失败分类、TTL、timeout、并发、预算、进度和 warm-run 行为；
4. 做最小实现与显式 migration，完成隔离 PostgreSQL 和全仓门禁；
5. 请求独立 implementation review，修完全部 P0–P3；
6. PR/CI 通过后合并；生产备份并显式迁移，部署兼容 revision；
7. 运行一次受预算约束的 rebuild，再运行一次 warm-cache rebuild，核对新旧技术栈投影和业务不变量；
8. 只记录证据，不切 `new_read_dual_write`；交回 Reviewer 做 production closeout。

本计划不授权删除 legacy reference/watches/edges、切换 graph read contract、执行 Phase C cleanup 或修改同机其他站点。

## Required Semantics

### deps.dev resolution state

以 [domain-model.md](../../domain-model.md) 为唯一领域定义，为 `package_repo_mappings` 增加最小状态：

- `resolved`：权威响应含 `SOURCE_REPO`；保存 canonical package key 与 source repository；
- `not_found`：只有权威 404 或成功响应明确无 `SOURCE_REPO` 才能进入；使用长 TTL；
- `error`：timeout、DNS/TLS/network、429、5xx、非法响应等；保存脱敏短错误和短 `retry_after`；
- 到达 `retry_after` 的 `error` 可重试并原子转为 `resolved/not_found`；未到期不得重复外呼；
- `not_found` 到达长 TTL 后允许复查；不得把 transient failure 写成永久 `null`。

迁移必须确定性解释现有 `source_repo`：非空行可标为 `resolved`；历史 `null` 缺少权威证据，不能无条件宣称 `not_found`，需选择保守 `error/retry_after` 或显式 unknown-compatible 策略并由 reviewer 批准。

### External request budget

- deps.dev 与 GitHub 请求均使用显式 AbortSignal timeout；timeout 必须有默认值和严格范围校验；
- 对 package key 和 target fullName 先去重，再使用小型 bounded worker pool；禁止无界 `Promise.all`；
- 每次 graph attempt 有显式最大请求数。预算不足时在 graph 原子提交前 fail closed，已写入的独立 cache receipt 可供下一次重试复用；
- 429/rate-limit 必须保留 retry evidence，不得继续打满配额；GitHub core 必须保留运维 headroom；
- 配置项只覆盖 timeout、concurrency、request budget 和 TTL/backoff；解析语义不允许由环境变量切换；非法配置启动时 fail closed；
- 网络等待始终位于业务 graph transaction 之外，最终提交继续复核 stable ID、collection token、SBOM baseline 与 lease authority。

默认值由实现者基于生产 19007/约 6000/3053 基线提出并经 review 确认；不得为了让测试变快而采用生产不可用的极端值。

### Canonicalization freshness

- GitHub fullName canonicalization 必须有持久 freshness，避免每次 warm rebuild 重复 3000+ 请求；
- 优先扩展现有 `package_repo_mappings` 或其紧邻数据边界，不新建通用第二套 cache/service；
- 同一 target 在一次 rebuild 最多请求一次；重命名结果批量、确定性回写相关映射；
- timeout/error 使用原 fullName 维持既有 best-effort graph 行为，但必须留下可重试状态；
- freshness 到期后允许复查，且 rename 不得擦除 package resolution evidence。

### Progress And Receipts

`graph.getRebuildGraphStatus` 增加向后兼容的 optional progress，至少包含：

- `stage`：`embedding | sbom | deps_resolution | github_canonicalization | atomic_commit | shadow_compare`；
- 当前 stage 的 `completed/total`；
- `cacheHits/cacheMisses/externalRequests/timeouts/retryableErrors` 的脱敏计数；
- terminal result 保留现有字段，并增加各 stage duration 与预算消耗摘要。

进度更新不能成为业务事实来源；lost lease 后旧 Worker 不得继续刷新进度或提交 graph。

## Test-Driven Implementation

### RED tests

1. deps.dev 200+SOURCE_REPO → `resolved`；200 无 SOURCE_REPO/权威 404 → `not_found`；429/5xx/network/timeout/malformed → `error`；
2. `error.retry_after` 前不请求，到期后重试并转 `resolved`；`not_found` 长 TTL 内不请求，到期后可复查；
3. 历史 non-null/null migration fixture 的状态转换无伪造权威结论；重复 migration 不漂移；
4. fake HTTP server 强制并发交错，观测到的最大并发不超过配置；单请求超时后 job 可恢复，无永久 pending Promise；
5. request budget 耗尽时 graph relation/legacy edges/shadow receipt 零写入，cache progress 可复用；下一 attempt 从 cache 继续；
6. 同一 package key/target 在一次运行只外呼一次；canonical freshness 未到期的第二次 warm rebuild 为零或接近零 GitHub canonicalization 请求；
7. 429/rate-limit 停止继续消耗预算并产生可解释 retry receipt；日志与 API 不泄露 token、URL credential 或响应敏感内容；
8. progress 单调、stage 合法、旧 consumer 可忽略新增字段；lost lease 的旧 Worker 无进度/终态写入；
9. 真实 PostgreSQL 验证 migration、TTL 转移、并发 upsert、reclaim、budget fail/retry 与最终 shadow zero-diff；
10. 技术栈投影、repo-to-repo edges、repository/watch/group/MCP 列表回归不变。

### Implementation constraints

- 不以 `any`、关闭 schema validation、延长 Worker lease 或取消 retry 掩盖根因；
- 不在 transaction 内执行外部 HTTP；
- 不引入 Redis、第二套 job queue、图数据库、通用 Repository layer 或新微服务；
- 不把 2026-08-18 的生产计数写死进代码或测试；
- 不把 GitHub canonicalization failure 误当技术栈 detection failure；
- 不删除 job #27 的 dead receipt 或 job #9 的 succeeded receipt。

## Files In Scope

- `packages/db/src/repo-graph.ts`、`packages/db/src/schema/index.ts`、相邻 cache/job helpers 和 tests；
- `packages/shared/src/github-client.ts`、graph status schema 与 tests；
- `apps/worker/src/worker.ts`、`apps/api/src/router/graph.ts` 及 tests；
- 显式 Drizzle migration 与 metadata；
- `.env.example`、[runbook.md](../../runbook.md) 中新增配置和生产步骤；
- 本 item 的 plan/review/verification 与日期化 progress。

## Local Gates

```bash
pnpm db:generate
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

另需隔离 PostgreSQL 16 + pgvector 从 `0000` 应用全部 migration，并运行本计划的真实 HTTP/DB interleaving。测试不得连接生产数据库。

## Production Gates

1. preflight：目标 SHA、干净 worktree、无 active graph/backfill job、当前 mode 仍为 `legacy_shadow_dual_write`、备份空间和长事务检查；
2. 有 migration 时创建可读 `pg_restore --list` 的即时备份，再显式迁移；禁止 `db:push`；
3. 部署后 API/Web/Worker revision 一致，migration row 只增加预期数量，mode 不变；
4. 运行受预算 rebuild，记录 stage receipt、external request counts、timeouts/errors、duration 和 shadow compare；
5. 再运行 warm-cache rebuild，要求不重复大规模 deps.dev/GitHub 外呼，且耗时显著下降；不设置依赖外网偶然性的脆弱秒级 SLA，但必须解释所有剩余请求；
6. 动态核对 real/reference repository、watched、new/legacy stack relations、source count、packages evidence 摘要、repo-to-repo edges；不使用固定 79/25/379 作为永久常量；
7. API/Web health 200、未认证入口 401、Keychain + SSH tunnel MCP health `ok`，MCP repository list 只含真实仓库；
8. 独立 production closeout review 批准后才能把本 item 标记 done，并恢复 `data-architecture-3-technology-stack-entities` Phase B。

## Handoff To Reviewer

Worker 完成后只提交以下证据包，不自行宣布 Phase B 可开始：

- PR、merge SHA、CI run、deploy run、backup/migration receipt；
- focused/全仓/隔离 PostgreSQL 命令及结果；
- 冷/暖两次 rebuild 的 immutable job IDs、stage receipts、duration、预算与外呼计数；
- 新旧投影结构化比较、repository/watch/group/MCP 不变量；
- 当前生产 revision/config/migration/health/auth；
- 所有已知失败、降级和未验证项。

Reviewer 将独立复核代码、Git、Actions、生产 DB/jobs/services 与 MCP；批准前不得切换 `new_read_dual_write`。
```

## Review Focus

1. 当前计划或结果是否覆盖 acceptance
2. 是否越过 scope non-goals
3. 是否越过 architecture 模块边界
4. 是否偷偷吸收了未来 checklist item 的工作
5. 当前验证方式是否足以支持结束本轮
