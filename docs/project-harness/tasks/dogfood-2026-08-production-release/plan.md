# Dogfood 五项整改生产发布

## Item

- Checklist item：`dogfood-2026-08-production-release`
- 风险模式：`high-risk`（commit、push、PR/merge、生产 migration 与 deploy）
- 依赖：`dogfood-2026-08-remediation`

## 目标

将已通过独立 Reviewer `APPROVED` 的五项 dogfood 整改，以可审计、可回滚的方式合入 `main` 并部署到 DevScope 生产；显式应用 migration `0013`，完成真实 API/CLI/MCP、数据库与运行环境复查。

## 发布边界

- 只发布当前 `codex/dogfood-2026-08-remediation` 中已批准的代码、migration、测试与权威文档。
- 不修改 DNS、域名、证书、Basic Auth、Nginx server-local 片段、生产凭据或同机其他站点。
- `technology_stack_legacy_cleanup=false`；只允许 `apply_database_migration=true` 应用已审查的 `0013`。
- 生产永久删除只验证门禁/只读影响预检，不删除真实仓库数据。

## 流程

1. 核对本地 diff、分支、门禁、迁移/回滚文件及生产只读基线。
2. 精确暂存本任务路径，Conventional Commit 后 push 任务分支；创建 PR，等待 `quality`、`integration` required checks。
3. 独立 Reviewer 核对 PR diff、CI 与 migration/deploy 输入；通过后合并到 `main`。
4. 手动触发 `Build and Deploy`，设置 `apply_database_migration=true`、`technology_stack_legacy_cleanup=false`；等待 workflow 完成。
5. 核对目标 SHA、备份可读性、migration journal、schema 列/枚举/索引、容器 revision/健康、Nginx 语法/访问控制和同机站点不变量。
6. 通过生产 CLI/MCP 验证只读与可恢复能力；将五条 observation 更新为 `closed` 或保留失败证据，独立 Reviewer 最终验收后 Harness closeout。

## 回滚

- workflow 失败且未完成 migration：保持旧生产容器，不手工绕过 checksum/fast-forward 门禁。
- migration 已应用后发布失败：停止 Worker，恢复本次部署前 custom-format 备份与上一 verified rollback 镜像，再复查内部/公网入口。
- 不通过临时 down migration、`db:push`、服务器 `git pull` 或 `docker pull latest` 修复。

## 验收证据

- PR、required checks、merge SHA、deploy run ID。
- 生产备份路径/权限/`pg_restore --list` 可读结果（不记录数据内容或凭据）。
- migration journal 与新增 schema 对象检查。
- 容器 revision、API/Web/Worker/PostgreSQL、401/认证 health、Nginx 与同机站点检查。
- 五条 observation 的生产 Timeline 与最终 Reviewer verdict。
