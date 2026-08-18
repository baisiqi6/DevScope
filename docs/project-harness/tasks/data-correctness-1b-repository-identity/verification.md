# GitHub Repository 稳定身份验证记录

## 范围

- Item：`data-correctness-1b-repository-identity`
- 日期：2026-08-18
- 当前阶段：实现与 PostgreSQL 迁移演练完成，准备全量门禁与独立实现审查
- 生产 mutation：尚未执行

## 生产只读基线

在任何 schema 或数据写入前读取生产即时状态：

| 检查 | 结果 |
| ---- | ---- |
| `repositories` 总行数 | 32 |
| 真实 GitHub 仓库 | 22 |
| `tech-stack/*` reference 行 | 10 |
| 每个真实仓库的用户关注关系 | 1 |
| Radar 候选总数 | 119 |
| 已带 `github_repo_id` 的 Radar 候选 | 119 |
| 非空 `(user_id, github_repo_id)` 重复组 | 1 |

唯一重复组为用户 1、GitHub repository ID `1319855210`：

- candidate 172：`accio-lab/realreplicabench`，`discovered`，只在 2026-08-05 观察到；
- candidate 192：`accio-org/realreplicabench`，`discovered`，2026-08-06 首次、2026-08-09 最近观察到。

两行没有互相冲突的非默认用户状态，可以确定性保留最早 `firstSeenAt`，采用最近观察到的规范名称、来源证据与时间，并记录被合并 ID/名称。迁移仍必须用通用冲突检查保护其他环境；若同组出现多个不同的非默认状态，必须在删除前 fail closed。

## GitHub 可解析性预检

使用当前已认证 GitHub CLI 对 22 个真实仓库逐一读取官方 repository ID 与当前 `full_name`：

- 19 个成功解析，当前没有两个可解析生产行得到同一 ID；
- 3 个当前权限下返回 unresolved：`smtg-ai/claude-squad`、`manaflow-ai/cmux`、`BloopAI/vibe-kanban`；
- unresolved 行必须保持 `github_repository_id = null` 并继续使用规范化 `fullName` 兼容路径，不得从名称哈希或其他非权威数据猜测 ID。

以上结果是日期化预检。正式 backfill 必须由 Worker 重新请求 GitHub、完整校验全部响应后再进入短事务，并把 updated/unresolved/conflicts 写入持久 job result。

## RED/GREEN 与 focused verification

- 首轮 RED 明确复现：正式采集结果没有 repository ID，Search 将 unsafe `number` 静默 `String()`；
- 新增正十进制字符串规范化边界，拒绝非正值、非十进制字符串和 unsafe number；
- 正式仓库覆盖同 ID rename、ID/fullName 分裂冲突与 compatibility 阶段禁止全新 stable-ID 行；
- Radar 覆盖同 ID rename，更新 GitHub 元数据时不覆盖用户状态和最早发现时间；
- backfill plan 覆盖 unresolved、重复 GitHub ID、规范名称占用与全局冲突零 update；
- atomic apply 覆盖失去 lease 时零写入、冲突时只写 `blocked` result；
- job/API/Worker 覆盖 active singleton、worker lease authority 与 `applied | blocked | failed` 状态区分；
- focused DB tests：5 files、57 tests 通过；Worker `worker.test.ts` 6 tests 通过；API `discovery.test.ts` 6 tests 通过；DB/API/Worker typecheck 通过。

## 显式迁移与真实 PostgreSQL 演练

迁移 `0007_square_arclight.sql` 已生成并逐行补齐历史 Radar 合并逻辑。使用三个隔离 PostgreSQL 16 数据库验证：

1. Drizzle migrator 从空库执行 `0000`–`0007` 成功；
2. 同 ID Radar fixture 在 `lastSeenAt`、`updatedAt` 相同时按较大 `id` 选择 keeper，保留最早 `firstSeenAt`、唯一非默认 `watching` 状态，并把 `[10, 11]` 与旧/新名称写入 merge evidence；
3. 两个不同非默认状态 `shortlisted`/`recommended` 触发 `RADAR_IDENTITY_STATUS_CONFLICT`，单事务回滚后两行仍在且 `repositories.github_repository_id` 列不存在，证明 schema 与数据均未部分提交；
4. 三个部分唯一索引均存在并实际拒绝重复正式 repository ID、同用户 Radar ID 与两个 active identity backfill；两个普通 `graph.rebuild` active job 可共存，证明 predicate 未扩大；
5. 两个不同 version 的并发 enqueue 返回同一 job（一个 `enqueued=true`、一个 `false`），数据库只有一条 active row；两个 Worker 并发 claim 的结果为一条 running job 和一个 `null`；
6. 真实 atomic apply 将 repository 100 从 `old-owner/repo` 更新为 `new-owner/repo`，保持内部 ID，关注冗余名称同步，并与 `outcome=applied` job result 原子落库；
7. 将另一 job lease 人工设为过期后执行 apply，得到 `RepositoryIdentityLeaseLostError`；正式仓库仍为 `new-owner/repo`，job result 仍为空，证明失租约零业务写入。

本地 `localhost:5432` 被另一 PostgreSQL 实例占用，Drizzle 演练改用 OrbStack 容器的隔离网络地址；容器内 PostgreSQL、迁移本身和应用连接路径均验证成功，不属于产品缺陷。

## 全仓门禁

- `pnpm lint`：通过；仅保留 16 个既有前端 warnings；
- `pnpm typecheck`：通过；
- `pnpm test`：首次发现 Skill pipeline fixture 缺少 GitHub `id`，补齐真实 API 字段后全量通过；审查修订后再次全量运行，DB 10 files/139 tests、API 10 files/72 tests、Worker 3 files/14 tests，以及其他 package/Skill tests 全部通过；
- `pnpm build`：通过；Next.js 14 个页面生成成功，仍只有同一组 16 个既有前端 warnings；
- `git diff --check`：通过。

## 实现审查修订

首轮独立实现审查发现并已修复三项反例：无 ID Radar fallback 不再清空稳定 ID；`getFollowing` 在同名不同 ID 或 ID/name 分裂时 fail closed；已终态的 one-shot version 明确拒绝复用而不再伪报 running。对应 focused DB 16 tests、API 44 tests、API typecheck 与 `git diff --check` 通过。Continuity reviewer 重新读取最新 diff 与反例测试后给出 `APPROVE`，允许进入 commit、push、PR。

## 待验证

- PR/CI；
- 生产备份、compatibility 部署、迁移、backfill/cutover 与业务验收。

## 计划审查

独立 Reviewer 经首轮与两次 continuity review 确认所有 P1/P2 finding 已闭环，最终 verdict 为 `APPROVE`。已授权进入 RED tests；详细 finding 与响应以 [当前审查记录](../../current/review.md) 为准，item 关闭时将审查记录归档到本目录。
