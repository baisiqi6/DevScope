# 采集子数据原子替换验证

## 实现边界

- GitHub 主数据、文本分块、Hacker News、Releases 与 SBOM 均在事务外完成网络读取和 runtime validation；
- repository metadata、严格单调毫秒 token、chunks、成功的 optional source 快照、repository mean 清理及 embedding 初态由一个 stable-ID advisory lock 保护的短事务提交；
- `success([])` 删除上一快照，`failure` 与 `skipped` 保留上一快照；任意事务内失败整体回滚；
- embedding 入口只接受 `repoId + expectedVersion`，claim、token/status CAS 与 chunks 读取位于同一锁定事务；旧 token 的 progress、final、failure、pooling、reconcile 与 SBOM backfill 均不能污染新快照；
- API 与 Scheduler 仅在 collection `completed` 后产生关注或 embedding 副作用，Scheduler 仅把 embedding `applied` 计为成功。

## 定向单元测试

- DB pipeline、GitHub、repo graph 与 Release normalization：97 tests 通过；
- API router 与 Scheduler outcome guards：40 tests 通过；
- 覆盖 optional source 的空集/失败语义、固定 warning 顺序、Release API 抛错、内部 claim 绑定、stale token 零模型调用、部分 embedding 保留全部文本，以及调用方失败零副作用。

## 真实 PostgreSQL

在本地 PostgreSQL 16 + pgvector 的显式临时数据库 `devscope_atomic_replacement_test_20260818` 上应用 `0000`–`0007` 后，`collection.integration.test.ts` 10/10 通过：

1. 新仓库 token 无微秒余数，可经 node-postgres `Date` 无损 claim；成功空集清除旧快照；
2. optional source failure 保留旧快照；
3. insert 失败回滚 metadata、token 与 chunks；
4. 两连接同 stable ID 并发提交保持完整快照且 token 严格递增；
5. claim 绑定当前 chunks，旧 token final 只能返回 `stale`；
6. 旧 SBOM baseline CAS 不能覆盖新采集；
7. pooling 等待同一锁、锁后读取稳定 chunks；reconcile 能纠正状态相同但计数漂移的数据；
8. 活跃 `processing` claim 不被 reconcile 撤销，第二次 claim 被拒绝，原 final 可提交；partial `failed` 不被改成无人持有的 `processing`；
9. 新 token 持锁提交时，旧 progress、failure 与 final writer 均等待并在锁释放后零写入；
10. embedding final 的非法 vector 写入整体回滚，完整文本快照保持不变，再由当前 token 条件记录 `failed`。

临时数据库已在验证后显式删除，不修改开发或生产数据。该 item 没有 schema 变化，也没有新增 migration。

## 全仓门禁

- `pnpm lint`：通过，仅保留 16 个既有 Web warnings；
- `pnpm typecheck`：通过；
- `pnpm test`：通过；
- `pnpm build`：通过，Next.js 14 pages 成功生成，仅保留同一组既有 warnings；
- `git diff --check` 与 Harness validator：通过。

## 待完成

- PR、CI 与无迁移部署；
- 生产正常采集 dogfood、版本/子快照/embedding 不变量复核与独立 closeout review。

## Implementation Review

首轮审查发现 reconcile authority、malformed SBOM 与并发证据缺口；修订后 continuity review 独立复跑 focused tests、typecheck、diff check 与 Harness 校验，确认未发现剩余 P0–P3 finding，最终 verdict 为 `APPROVE`。完整过程见 [审查记录](review.md)。
