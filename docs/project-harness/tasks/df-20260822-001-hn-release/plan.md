# DF-20260822-001：Hacker News 可选字段修复发布

## Item

- Checklist item：`df-20260822-001-hn-release`
- 依赖：`df-20260822-001-hn-optional-fields`
- 关联 observation：`DF-20260822-001`
- 风险模式：high-risk（PR 合并、生产部署、云端仓库重新采集）
- 分支：`codex/df-20260822-001-hn-release`
- 当前阶段：生产部署、受控复采与独立 closeout 全部完成，item 已关闭

## 目标

将已独立审查通过的 HN Algolia 可选字段兼容修复通过 PR/CI 发布到生产，并用一个已知复现样本完成云端重新采集，确认 HN enrichment 恢复后关闭 `DF-20260822-001`。

## 发布范围

- 提交并 push 当前已审查的代码、测试与 Harness 记录。
- 创建 PR，等待 required `quality` 与 `integration` checks，通过后合并。
- 合并后立即核对 GitHub `main` head 与 PR merge SHA 完全一致；只在未漂移时对 `main` 手动触发 `Build and Deploy`，固定 `technology_stack_legacy_cleanup=false`、`apply_database_migration=false`，并要求 run `headSha` 等于该 merge SHA。若 `main` 已漂移则停止并重新审查目标。
- 部署后验证精确 revision、容器健康、未认证 `401`、认证 health/home `200`、近期 API/Worker 日志。
- 通过生产 DevScope CLI/MCP 重新采集 `msitarzewski/agency-agents`：采集前记录现有 embedding `startedAt`/`completedAt`/总数，记录请求起始时间；采集后要求本次返回的 repository ID 仍为既有目标、`hnItemsCollected > 0` 且无 HN warning，并要求 `--wait` 返回的新 embedding 状态为 `completed / 100%`、`startedAt` 不早于本次请求且不同于旧值、`completedChunks = totalChunks = collection.chunksCollected`。

## 安全与回滚

- 本次无 schema 或迁移文件变化，不执行 `db:push` 或数据库 migration。
- 普通无迁移 workflow 不自动备份 `.env`、Nginx 或数据库。部署前由 Operator 在生产主机创建本次独立备份目录（mode `700`），显式复制 `.env` 与 DevScope Nginx/server-local 配置并设为 mode `600`；同时创建 PostgreSQL custom-format dump、设为 mode `600` 并用 `pg_restore --list` 验证可读。只记录脱敏路径、权限与可读性，不输出内容。
- 生产工作树必须 clean，只允许 fast-forward；部署 run 必须绑定并回读精确 merge SHA。
- 只重建 DevScope API/Web/Worker，不修改 DNS、证书、凭据或同机其他站点配置。
- 部署失败恢复 workflow 保留的上一组 `rollback` 镜像；业务复采失败不绕过 HN/Zod/事务边界，保留 observation 并回滚或继续诊断。
- 如部署或复采需要整体数据回退，使用本次 Operator 创建并验证过的 custom-format dump；不得用删表、手工补行或重新抓取代替恢复。
- 重新采集走公开 CLI/MCP 边界，不直接修改 PostgreSQL。

## 验收标准

- PR 的 `quality` 与 `integration` required checks 成功，合并提交 SHA 明确。
- deploy workflow 成功，生产 API/Web/Worker revision 与合并 SHA 一致。
- 生产访问控制、容器健康、Nginx 及同机站点未退化。
- `msitarzewski/agency-agents` 主采集完成，repository ID 与目标一致，HN enrichment 不再返回 `invalid_type` warning，`hnItemsCollected > 0`；本次新 embedding 通过请求时间、变化后的 `startedAt` 与 chunk 计数绑定，并到达 `completed / 100%`。
- 生产验证证据写入本计划、`progress.md` 与 `dogfood-observations.md`；只有上述业务验收通过后将 `DF-20260822-001` 置为 `closed`。
- 独立 closeout Reviewer 核验 GitHub、部署与生产业务证据后方可关闭本 item。

## 当前 Handoff

生产发布与 `agency-agents` 受控复采已完成，所有业务验收通过；独立 Reviewer 已核验 GitHub、部署、备份、访问控制和本次复采证据并 `APPROVED`，release item 与 `DF-20260822-001` 均已关闭。

## Review 修正

- 已纠正备份事实：`.env`、Nginx 与无迁移数据库备份为 Operator 显式前置，不冒充 workflow 自动能力。
- 已将 embedding 验收绑定到本次复采：保存旧时间戳与计数，要求新 `startedAt`、请求时间和本次 `chunksCollected` 一致。
- 已增加 dispatch head gate：`main` 与 merge SHA 不一致时停止，workflow run `headSha` 必须精确匹配。

## Production Verification

- PR #70：`quality` 与 `integration` 成功；merge SHA `791ebab9fd68f0e6866631d6450edec78134e660`。
- 部署前显式备份目录：`/home/devscope/backups/devscope/pre-hn-release-20260922T033900Z-791ebab9`；目录 mode `700`，`.env`、Nginx archive 与 custom-format dump 均为 mode `600`，`pg_restore --list` 验证可读。
- Deploy run：`35684007072`；`headSha` 精确等于 merge SHA，`technology_stack_legacy_cleanup=false`、`apply_database_migration=false`，build/deploy 成功、cleanup skipped。
- 生产服务器 HEAD 与 API/Web/Worker 三镜像 revision 均为 `791ebab9fd68f0e6866631d6450edec78134e660`；工作树 clean，PostgreSQL healthy，内部 API/Web health、`nginx -t` 通过，近期 API/Worker 无目标错误模式。
- SSH tunnel 未认证 health 返回 `401`，Keychain 认证 health 返回 `ok`；部署前后 `.env` 与 Nginx 配置一致。
- 复采前 repo ID `1289` 的 embedding 为 250/250、旧 `startedAt=2026-09-21T18:30:23.830Z`。本次请求开始于 `2026-09-22T03:52:35Z`；复采仍返回 repo ID `1289`，主采集 `completed`、`chunksCollected=250`、`hnItemsCollected=9`、无 warning。
- 本次新 embedding 为 `startedAt=2026-09-22T03:52:38.421Z`、`completedAt=2026-09-22T03:52:46.371Z`、250/250、`completed / 100%`；API 日志记录 outcome `applied`，且没有 `invalid_type`、`Hacker News:` 或 `Expected string, received undefined`。
- `DF-20260822-001` 已依据上述生产业务证据置为 `closed`。
- 独立 high-risk closeout Reviewer 最终 `APPROVED`，无 P0–P2；Harness item 已 `done / closed`。
- 透明记录：Reviewer 首次复核 dump 时误尝试拉取本机缺失的 `postgres:16` 镜像，拉取因 EOF 失败，未创建容器或改变生产服务；随后使用现有 PostgreSQL 容器完成只读验证。可能存在未清理的临时 Docker 下载缓存，不影响运行服务。
