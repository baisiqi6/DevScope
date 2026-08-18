# GitHub Release ID bigint 验证记录

## 范围

- Item：`data-correctness-1a-release-id-bigint`
- 日期：2026-08-18
- 环境：本地工作树与本地 `devscope-postgres` 容器
- 生产：备份、迁移、部署与独立验收已完成

## RED

先增加以下失败条件，再修改实现：

- `packages/db/src/collection.test.ts`：`2147483648` 必须无损转换，unsafe `number` 与非十进制字符串必须 fail closed；旧实现因截断/哈希而失败；
- `packages/db/src/github.test.ts`：正式 Release ID 必须保持原值，空 Releases 不得用 tag hash 伪造；旧实现共有 4 项相关失败；
- `apps/api/src/router.test.ts`：数据库 `bigint` 必须经 API 返回十进制字符串；旧 output schema 因要求 `number` 而拒绝结果。

## GREEN

Focused verification：

```text
pnpm --filter @devscope/db exec vitest run src/collection.test.ts src/github.test.ts
2 files passed, 15 tests passed

pnpm --filter @devscope/api exec vitest run src/router.test.ts
1 file passed, 34 tests passed

pnpm --filter @devscope/db typecheck
passed

pnpm --filter @devscope/api typecheck
passed
```

## 迁移审查与演练

`pnpm db:generate` 生成的 `0006_release_id_bigint.sql` 只有一条目标变更：

```sql
ALTER TABLE "releases" ALTER COLUMN "id" SET DATA TYPE bigint;
```

在专用临时数据库 `devscope_release_bigint_rehearsal_20260818` 中执行：

1. 从空库依次应用 `0000`–`0005`；
2. 写入 188 条 ID 为 `2147483460`–`2147483647` 的历史 fixture；
3. 应用 `0006_release_id_bigint.sql`；
4. 双向集合比对历史行；
5. 插入 ID `2147483648` 并读取类型与仓库归属；
6. 删除该专用临时数据库，并确认同名数据库数量为 0。

结果：

| 检查 | 迁移前 | 迁移后 |
| ---- | ------ | ------ |
| `id` 类型 | `integer` | `bigint` |
| 行数 | 188 | 188 |
| 最小 ID | 2147483460 | 2147483460 |
| 最大 ID | 2147483647 | 2147483647 |
| 缺失行 | — | 0 |
| 变化行 | — | 0 |

ID `2147483648` 写入和读取成功，数据库类型为 `bigint`，`repo_id=1`。

## 独立 review 修订

首轮独立 reviewer 给出 `CHANGES_REQUESTED`，原始结论见同目录
[`review.md`](review.md)。修订遵循最小范围：

- collector 不再使用 Octokit 已解析的 `number` 作为权威 ID，而是从正式 Release API URL 严格提取十进制字符串；
- pipeline 在删除旧 Releases 之前将全部 ID 校验并转换为 `bigint`；
- 新增超过 `Number.MAX_SAFE_INTEGER`、PostgreSQL bigint 最大值、越界值和“校验失败不得删除旧数据”的回归测试；
- focused DB tests 更新为 3 files / 53 tests，通过；DB/API typecheck 通过；
- 手动部署 workflow 为数据库迁移进程设置 `5s lock_timeout`，锁超时会 fail closed。

第二个专用临时数据库 `devscope_release_bigint_lock_rehearsal_20260818` 的锁竞争演练：

1. 从 `0000`–`0005` 建立空库并写入同样的 188 条历史 fixture；
2. 另一个事务持有 `releases` 的 `ACCESS SHARE` lock；
3. 迁移事务使用 `250ms lock_timeout`，在 0.34 秒内按预期失败；
4. 失败后列类型仍为 `integer`，行数仍为 188，`min/max` 均不变，证明失败事务未留下部分变更；
5. 释放冲突事务后使用生产同等的 `5s lock_timeout`，迁移在 0.11 秒内完成；
6. 类型变为 `bigint`，188 条 fixture 的 `min/max` 不变；PostgreSQL bigint 最大值 `9223372036854775807` 写入和读取成功；
7. 删除临时数据库，并确认同名数据库数量为 0。

同一独立 reviewer 随后以 continuity 模式重新核对最新代码、diff、focused tests、类型检查和迁移证据，确认 P1/P2 均已关闭，最终 verdict 为 `APPROVE`。批准只覆盖本地实现与迁移准备，不代表生产验收完成。

## 生产只读预检

2026-08-18 在获得生产门禁授权后、任何生产 mutation 之前重新读取即时基线：

| 检查 | 结果 |
| ---- | ---- |
| `releases.id` 类型 | `integer` |
| Release 行数 | 191 |
| 最小 ID | 56476495 |
| 最大 ID | 1761925622 |
| `repo_id` 数量 | 21 |
| 超过 30 秒的事务 | 0 |
| `releases` 已授予 relation locks | 0 |
| 服务器可用空间 | 30578240 KiB |

该数字比 2026-08-17 的 188 条审计快照增加 3 条，属于运行中数据变化。因此生产验收以本次迁移前即时行集为准，不再把 188 写成永久 acceptance。此预检没有修改生产数据库。

## 生产发布与验收

2026-08-18 经显式授权完成发布：

- PR [#27](https://github.com/baisiqi6/DevScope/pull/27) 的 `quality` 检查通过，随后 squash merge 到 `main@2b18ebfb1220062524d272e90e8bace12d92cac3`；
- 手动 `Build and Deploy` workflow [run 32112032164](https://github.com/baisiqi6/DevScope/actions/runs/32112032164) 以 `apply_database_migration=true` 成功完成 build 与 deploy；
- mutation 前的人工备份为 `/home/devscope/backups/devscope/manual-pre-release-id-bigint-20260818-153326.dump`，大小 `72218486` bytes，`pg_restore --list` 校验通过；workflow 另生成 `/home/devscope/backups/devscope/pre-migration-20260818-154139.dump`，大小同为 `72218486` bytes；
- 服务器工作树干净且 HEAD 为目标提交；API、Web、Worker 正常运行，PostgreSQL 保持 healthy，既有 Nginx 容器未被重建，`nginx -t` 通过；
- 生产 `drizzle.__drizzle_migrations` 最新记录的 hash 为 `87089e28b06447bf39d1ea7f22d6d0b1563d5825485731bf957c50ef1c1e2963`，与仓库 `0006_release_id_bigint.sql` 的 SHA-256 一致；
- 内部 API/Web health 均为 HTTP 200，最近 15 分钟 Worker 日志没有匹配到 `error|fatal|panic|uncaught`；
- 公网与 SSH tunnel 的未认证请求均为 HTTP 401；通过 macOS Keychain 注入 Basic Auth 后，`devscope health` 返回 `status: ok`。

生产数据核验结果：

| 检查 | 迁移前备份 | 迁移后在线库 |
| ---- | ---------- | ------------ |
| `releases.id` 类型 | `integer` | `bigint` |
| 行数 | 191 | 191 |
| 最小 ID | 56476495 | 56476495 |
| 最大 ID | 1761925622 | 1761925622 |
| `repo_id` 数量 | 21 | 21 |
| 有序 `(id, repo_id)` MD5 | `e3fef7531cab411153a32948f8b7a5ad` | `e3fef7531cab411153a32948f8b7a5ad` |

核验时将人工备份恢复到专用临时数据库 `devscope_release_verify_20260818`，对备份与在线库分别计算有序 `(id, repo_id)` 行集哈希；两侧完全一致。核验结束后已删除临时数据库，并确认同名数据库数量为 0。在线库没有超过 30 秒的活跃事务。

## 全仓门禁

2026-08-18 本地运行结果：

- `pnpm lint`：通过，保留 16 个既有 Web warning，0 error；
- `pnpm typecheck`：通过，14 个 Turbo tasks 全部成功；
- `pnpm test`：修订后重新通过，11 个 Turbo tasks 与根目录 21 项 Skills pipeline tests 全部成功；其中 DB 110 项、API 66 项；
- `pnpm build`：通过，9 个 Turbo tasks 全部成功；Next.js 构建保留与 lint 相同的既有 warning；
- `pnpm db:generate` 复查：`No schema changes, nothing to migrate`；
- `.github/workflows/deploy.yml`：YAML 解析通过；
- `git diff --check`：通过。

## 结论

代码、迁移、本地门禁和生产 acceptance 均已满足。独立 closeout reviewer 复核 Git、Actions、两份备份、在线数据库和服务证据后给出 `APPROVE`，无阻塞 finding；Harness 已规范记录 review result 并将 item 标记为 `done`。
