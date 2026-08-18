# 独立审查结论

- Item：`data-correctness-1a-release-id-bigint`
- Reviewer：`release_id_migration_reviewer`
- Context mode：`limited-fresh`
- 日期：2026-08-18
- 首轮 Verdict：`CHANGES_REQUESTED`

## P1：采集边界仍先把 Release ID 收窄为 JavaScript `number`

### Evidence

- `GitHubRelease.id` 和 Octokit response 当前仍使用 `number`；
- JSON 中的 `9007199254740993` 会被 Node 解析为 `9007199254740992`，但同一响应的 Release API URL 仍保留精确十进制 ID；
- pipeline 当前在 `insertReleases()` 校验 ID 之前删除旧 Releases。

### Impact

PostgreSQL `bigint` 范围内但超过 `Number.MAX_SAFE_INTEGER` 的合法 ID 无法全链路无损；转换失败时还可能在后续原子替换整改完成前留下空数据。

### Minimal correction

- 从正式 Release API URL 严格提取十进制 ID，使 `GitHubRelease.id` 保持 `string`；
- 在删除旧 Releases 之前完成全部 ID 范围校验；
- 增加超过 safe integer、PostgreSQL bigint 上限和越界不删除旧数据的回归测试。

## P2：迁移演练缺少锁影响、执行时间和失败回滚证据

### Evidence

`integer → bigint` 的 `ALTER COLUMN TYPE` 需要表重写和 `ACCESS EXCLUSIVE` lock。当前验证记录没有冲突事务、`lock_timeout`、实际耗时或失败回滚结果；部署流程会在旧应用仍运行时执行迁移。

### Impact

持有冲突锁的长事务可能令迁移无限等待，并让后续 Releases 请求排队。现有证据不足以证明生产迁移行为有界。

### Minimal correction

- 在隔离 PostgreSQL 中持有冲突事务，记录有界失败、释放后的成功耗时和事务回滚；
- 为生产迁移增加明确 `lock_timeout` 和 fail-closed 操作说明，或在迁移窗口暂停相关应用连接；
- 同步更新 runbook 与 verification。

## 已独立核验

- focused DB tests：2 files / 15 tests 通过；
- API router tests：1 file / 34 tests 通过；
- `pnpm lint` 与 `pnpm typecheck` 通过；
- migration snapshot 只包含 `releases.id: integer → bigint`，journal 链接正确；
- tRPC ID 字符串契约与当前 Web 调用方兼容；
- tag hash fallback 已移除；成功空结果清理和整体原子替换仍属于后续 item；
- 未连接生产、未编辑文件、未 commit、未 push、未部署。

## Context mode 说明

采用 `limited-fresh`：reviewer 只读取完成判断所需的目标、canonical plan、non-goals、真实 diff 和证据，不继承此前自我判断或旧 verdict。

## Operator 修订响应

2026-08-18 已完成两项最小修正：

- P1：Release ID 改由 API URL 提取为十进制字符串，pipeline 在删除旧数据前完成 `bigint` 转换；增加 safe integer、bigint 上限和不删除旧数据测试；
- P2：部署迁移进程增加 `5s lock_timeout`；隔离 PostgreSQL 已验证锁冲突在 0.34 秒内失败且完整回滚，释放锁后迁移在 0.11 秒内成功。

修订证据已追加到 `tasks/data-correctness-1a-release-id-bigint/verification.md`，等待同一 reviewer 以 continuity 模式复核；此处保留首轮 verdict，不由 Operator 自行改写为批准。

## Continuity 复核

- Reviewer：`release_id_migration_reviewer`
- 日期：2026-08-18
- Final verdict：`APPROVE`

Reviewer 重新读取当前代码、diff 和证据后确认：

- P1 已关闭：URL 十进制 ID、`number|string|bigint` 边界与删除前校验一致，3 files / 53 focused tests 及 DB/API typecheck 通过；
- P2 已关闭：生产迁移具备 `5s lock_timeout`，锁冲突 fail-closed、失败回滚、成功耗时和 bigint 最大值往返证据齐全；
- 未发现新的阻塞问题；
- 生产仍为 `UNVERIFIED`，批准不授予迁移或部署权限。

采用 continuity 是因为本轮仅验证同一 reviewer 上轮两个明确 finding 的局部修订，同时仍重新核对了最新事实。
