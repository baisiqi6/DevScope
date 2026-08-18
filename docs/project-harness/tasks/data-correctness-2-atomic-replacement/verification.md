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

## PR、CI 与生产部署

- 产品提交 `c8647fd8f35b19d8fca846c900245e6218b0f7a7` 经 PR #33 合并为 `main@de3b91722d0b9b120bd6ae7308bbf92af5dc0bdf`；
- CI run `32136772754` 的 `quality` job 通过；
- 手动部署 run `32137164791` 明确使用 `apply_database_migration=false`。首次尝试仅在 GHCR 登录阶段收到瞬时 `denied`，deploy job 未启动，生产未变化；同一 run 的 attempt 2 构建并推送 API/Web/Worker 后成功部署；
- 服务器 `/home/devscope/DevScope` 工作树干净且 HEAD 为 `de3b917...`，三个应用容器的 `org.opencontainers.image.revision` 均为同一 SHA；
- `REPOSITORY_IDENTITY_CUTOVER=enabled`，API `/trpc/health` 与 Web 内部访问为 `200`，公网未认证首页与 tRPC 均为 `401`；Nginx 与 PostgreSQL 未重建；
- `drizzle.__drizzle_migrations` 仍为 8 条，本 item 没有执行或隐式引入迁移。

## 生产 MCP dogfood

通过 macOS Keychain 注入 Basic Auth、SSH tunnel 和 `devscope-operator` MCP launcher 对已关注仓库 `deepseek-ai/deepseek-harness` 执行正常完整采集：

- 采集前 token 为 `2026-08-18 09:30:18.325`，采集提交后的 token 为 `2026-08-18 12:39:04.922`，严格前进；
- MCP quick result 为 `status=completed`、`chunksCollected=1`、`embeddingInBackground=true`；后台 embedding 在 `12:39:04.964` 开始、`12:39:05.219` 完成，最终 `1/1`、`100%`、`error=null`；
- chunk 有序摘要保持 `d7fd95d2a58579df5da1907072711384`，1 个 chunk 的 embedding 非空；Release 有序摘要保持 `547b7d24fba0b660e231f2d7ce59e927`；HN 仍为合法空快照；
- SBOM 从旧 `NULL` 规范化为本次成功返回的 `[]`，验证 `success([])` 的清空语义；
- Hacker News 外部 API 返回 400，产品将其报告为可选源 warning，并保留既有空 HN 快照；主采集、Release、SBOM 与 embedding 均未被连带判失败；
- 全库复核为 40 个真实仓库全部 `embedding_status=completed`，重复 chunk natural key 为 0，Release ID 跨仓库冲突为 0，真实仓库缺失 GitHub stable ID 为 0，migration rows 仍为 8。

以上 dogfood 仅通过公开 MCP 产品路径触发采集；生产 SQL 检查全部只读，没有故障注入或直接数据修复。

## Closeout

独立 production closeout review 核对 GitHub、部署、生产运行态、认证 MCP dogfood 与全库不变量后给出 `APPROVE`。Reviewer 指出的唯一 P3 是 Harness 派生材料尚未同步；已通过显式 verification、`mark-done`、state refresh、validator 与 doctor 收口。item 状态现为 `done`，无需再次部署。

## Implementation Review

首轮审查发现 reconcile authority、malformed SBOM 与并发证据缺口；修订后 continuity review 独立复跑 focused tests、typecheck、diff check 与 Harness 校验，确认未发现剩余 P0–P3 finding，最终 verdict 为 `APPROVE`。完整过程见 [审查记录](review.md)。
