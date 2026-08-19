# Review Packet

## Subject

- Checklist item: `data-correctness-4-deps-cache-recovery`
- Reviewer: `reviewer-impl`
- Updated at: `2026-08-19`
- Canonical plan path: `docs/project-harness/tasks/data-correctness-4-deps-cache-recovery/plan.md`

## Item Snapshot

- Title: 使依赖解析缓存可恢复且具备外呼预算
- Status: doing
- Workflow status: review_approved
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
> 状态：已领取；plan review 两轮完成，第一轮 `changes_requested` 已修订，第二轮 `approved`
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
- `retry_after` 记录下一次允许外呼的时间：`error` 为短退避，`not_found` 为长 TTL 复查点，`resolved` 为其长 TTL 复查点；未到期不得重复外呼；
- 不得把 transient failure 写成永久 `null`，不引入第四状态。

`resolved` 的复查语义（对齐 domain-model「只在到期或规范名称校正时更新」）：

- TTL 内的 warm rebuild 对该行零 deps.dev 外呼，直接使用缓存 `source_repo`；
- 只在 TTL 到期或 canonical rename 校正涉及该目标时复查；复查失败降级为 `error` + 短 `retry_after`，并把旧值搬入 `last_resolved_repo` 保留 resolution evidence，不清空语义也不伪造权威；
- cache 读取规则统一为：`resolved`（TTL 内）按缓存值使用；`not_found`（复查点前）与 `error`（`retry_after` 前）不外呼、按无映射参与本次图计算；到期后按可重试 miss 处理；`error` 行的 `last_resolved_repo` 只是证据，不得当作权威映射使用。

迁移语义（已拍板，不留实现期决策）：

- 非空 `source_repo` 历史行 → `resolution_status='resolved'`；
- 历史 `source_repo=null` 行（日期化基线约 302 行）→ `resolution_status='error'` + 以迁移执行时间为基准的短 `retry_after`；禁止解释为 `not_found`；
- `resolution_status` 列 DEFAULT 固定为 `'error'`：回滚窗口内旧镜像写入的新 `source_repo=null` 行不会被新代码误读为权威结论，代价仅是重查一次；
- 历史行用确定性条件 UPDATE 回填，不让 `db:generate` 的朴素 DEFAULT 解释存量数据；重复执行迁移不改变已回填行的状态；
- CHECK 约束：`resolution_status='resolved'` 当且仅当 `source_repo IS NOT NULL`（降级证据只存在于 `last_resolved_repo`，不污染该约束）。

### External request budget

- deps.dev 与 GitHub 请求均使用显式 AbortSignal timeout；timeout 必须有默认值和严格范围校验；`getCanonicalFullName` 同步补上 timeout；
- 预算口径覆盖一次 graph attempt 内的全部外部 HTTP：deps.dev resolution、GitHub canonicalization 和 SBOM backfill 阶段的 GitHub 请求都计入预算并进入进度计数，不允许阶段外游离请求；
- 预算按 provider 分列（deps.dev 上限、GitHub 上限），任一耗尽即在 graph 原子提交前 fail closed；已写入的独立 cache receipt 可供下一次重试复用；
- 默认预算必须让日期化冷启动基线（约 6000 deps.dev miss + 3053 canonicalization + SBOM 请求）在单次 attempt 内收敛并留 headroom；若未来数据规模增长导致预算内无法完成，`failJob` 重试与终态重启（`enqueueRestartableJob`）是设计内恢复路径，须在 runbook 记录操作步骤；
- 对 package key 和 target fullName 先去重，再使用小型 bounded worker pool；默认并发为保守个位数，且在并发之外保留最小请求间隔 pacing，避免 GitHub secondary rate limit；禁止无界 `Promise.all`；
- 429/rate-limit 必须保留 retry evidence，尊重响应 `Retry-After` 暂停对应 provider 的后续请求并写可解释 receipt，不得继续打满配额；GitHub core 必须保留运维 headroom；
- 配置项只覆盖 timeout、concurrency、pacing、request budget 和 TTL/backoff；解析语义不允许由环境变量切换；非法配置启动时 fail closed；
- 网络等待始终位于业务 graph transaction 之外，最终提交继续复核 stable ID、collection token、SBOM baseline 与 lease authority。

默认值由实现者基于生产 19007/约 6000/3053 基线提出并经 review 确认；不得为了让测试变快而采用生产不可用的极端值。

### Canonicalization freshness

- GitHub fullName canonicalization 的持久 freshness 落在紧邻新表（如 `github_repo_name_canonicalizations`：小写 `full_name` 唯一键、`canonical_full_name`、`resolution_status`、`retry_after`、`last_error`、`checked_at`）；404 归一为 `not_found` + 长 TTL（沿用原名），网络失败为 `error` + 短退避。不把 fullName 键过载进 `package_repo_mappings` 的 `(system, name, version)` 唯一键，也不新建通用第二套 cache/service；
- 同一 target 在一次 rebuild 最多请求一次；freshness 未到期的行直接使用持久 `canonical_full_name`，到期后允许复查；
- rename 结果批量、确定性回写相关 `package_repo_mappings.source_repo`（只改命名，不改 resolution 状态），不得擦除 package resolution evidence；rename 复查失败保持原 fullName 维持既有 best-effort graph 行为，但必须留下可重试状态；
- `resolved` 的 canonicalization 行复查失败按 deps.dev 同款语义降级 `error` 并保留旧值证据。

### Progress And Receipts

`graph.getRebuildGraphStatus` 增加向后兼容的 optional progress，至少包含：

- `stage`：`embedding | similarity | sbom | deps_resolution | github_canonicalization | atomic_commit | shadow_compare`；
- 当前 stage 的 `completed/total`；
- `cacheHits/cacheMisses/externalRequests/timeouts/retryableErrors` 的脱敏计数；
- terminal result 保留现有字段，并增加各 stage duration 与预算消耗摘要。

进度存储载体固定为 `jobs` 表新增 nullable `progress` 列（显式迁移），与 `result` 分离；写入只能由当前 lease owner 通过 `WHERE id = … AND lease_owner = … AND lease_expires_at > now()` 的条件 UPDATE 完成（参照 technology-stack-entities 的 lease-authoritative 先例）。进度更新不能成为业务事实来源；lost lease 后旧 Worker 不得继续刷新进度或提交 graph——原子提交路径必须复核 lease authority，lost lease 的提交尝试被拒绝。

## Test-Driven Implementation

### RED tests

1. deps.dev 200+SOURCE_REPO → `resolved`；200 无 SOURCE_REPO/权威 404 → `not_found`；429/5xx/network/timeout/malformed → `error`；
2. `error.retry_after` 前不请求，到期后重试并转 `resolved`；`not_found` 长 TTL 内不请求，到期后可复查；`resolved` TTL 内零外呼，到期复查成功刷新值；
3. 历史 non-null/null migration fixture 的状态转换无伪造权威结论（null → `error`+短 `retry_after`，非 null → `resolved`）；重复 migration 不漂移；DEFAULT `'error'` 与 CHECK 约束生效；
4. fake HTTP server 强制并发交错，观测到的最大并发不超过配置且保留 pacing；单请求超时后 job 可恢复，无永久 pending Promise；
5. request budget 耗尽时 graph relation/legacy edges/shadow receipt 零写入，cache progress 可复用；下一 attempt 从 cache 继续；SBOM 阶段请求同样计入预算与进度；
6. 同一 package key/target 在一次运行只外呼一次；freshness 未到期的第二次 warm rebuild 对 GitHub canonicalization 恰好 0 次请求、对 TTL 内 `resolved` 行 0 次 deps.dev 请求，所有剩余请求可逐条解释；
7. 429/rate-limit 停止继续消耗预算、尊重 `Retry-After`，并产生可解释 retry receipt；日志与 API 不泄露 token、URL credential 或响应敏感内容；
8. progress 单调、stage 合法（含 `similarity`）、旧 consumer 可忽略新增字段；lost lease 的旧 Worker 无进度/终态写入，且其 graph 原子提交被 lease authority 复核拒绝；
9. `resolved` 复查失败降级为 `error`：`last_resolved_repo` 保留旧值证据，本轮按无映射参与图计算，`retry_after` 到期后重试恢复；
10. canonical rename 批量回写相关 `package_repo_mappings.source_repo` 且不擦除 resolution evidence；rename 复查失败保持原 fullName 并留下可重试状态；
11. 真实 PostgreSQL 验证 migration、TTL 转移、并发 upsert、reclaim、budget fail/retry、jobs `progress` 的 lease-authoritative 写入与最终 shadow zero-diff；
12. 技术栈投影、repo-to-repo edges、repository/watch/group/MCP 列表回归不变。

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
- 显式 Drizzle migration 与 metadata：`package_repo_mappings` 状态列（含 `last_resolved_repo` 证据列）+ CHECK + DEFAULT `'error'` 回填、`github_repo_name_canonicalizations` 新表（不套用同款 CHECK，降级证据保留在 `canonical_full_name` 本身）、`jobs.progress` 列；
- `.env.example`、[runbook.md](../../runbook.md) 中新增配置（timeout/concurrency/pacing/budget/TTL）和终态重启操作步骤；
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

