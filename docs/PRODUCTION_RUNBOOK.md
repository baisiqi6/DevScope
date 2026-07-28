# 生产运行手册

本文适用于当前单用户私有版。所有操作都应可审计、可回滚，并避免影响同机运行的其他站点。

## 安全基线

1. Nginx 是唯一公网入口；
2. Web、API、PostgreSQL 仅绑定 `127.0.0.1`；
3. 应用级鉴权完成前，DevScope 路由必须启用反向代理访问控制；
4. `.env`、认证文件和备份不进入 Git；
5. 数据库使用独立强密码，定期轮换；
6. 不在部署阶段隐式执行 `db:push`；
7. 不覆盖或重启同一 Nginx 中与 DevScope 无关的站点。

## 部署前检查

本地：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git status --short
```

服务器：

```bash
cd /home/devscope/DevScope
git status --short
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

服务器工作树必须干净。若发现本地修改，先备份并确认归属，禁止直接覆盖。

## 部署流程

自动部署工作流目前只允许手动触发。推荐过程：

1. 确认目标提交和镜像已通过 CI；
2. 备份生产 `.env`、Nginx 配置和必要数据；
3. 使用 `git pull --ff-only` 更新，不在服务器直接合并；
4. 拉取固定版本镜像，避免不可追溯的临时构建；
5. 只重建 DevScope 的 `web`、`api`、`worker` 等目标服务；
6. 如有数据库迁移，单独审查、备份、执行和验证；
7. 使用 `nginx -t` 验证配置后执行 reload，不随意 restart 共享 Nginx。

生产 API 容器默认使用 `SCHEDULER_TIMEZONE=Asia/Shanghai` 解释 cron 时间，不依赖容器自身的 UTC 时区。

首次上线 Worker 前必须应用 `packages/db/drizzle` 中已审查的迁移。手动部署工作流的
`apply_database_migration` 默认为 `false`；只有在确认迁移内容、备份空间和回滚窗口后才设为
`true`。工作流会先把 PostgreSQL custom-format 备份写入
`/home/devscope/backups/devscope/`，再显式执行 `db:migrate`。未应用迁移时，Worker schema
检查会阻止部署继续。

## 访问控制

当前 API 的 tRPC procedure 尚未实现应用级身份认证。外层访问控制至少覆盖：

- `/`
- `/api/`
- `/trpc/`

同机其他站点的 location 必须显式保持原有行为。认证密码只保存在服务器哈希文件与操作者的安全凭据存储中，不写进仓库或聊天记录。

应用鉴权和租户隔离完成后，再评估是否移除外层保护。

### 服务器专属 Nginx 片段

仓库内的 `nginx/conf.d/default.conf` 只维护 DevScope 通用代理，并通过通配符加载以下服务器专属片段：

- `nginx/conf.d/server-local/shared-routes*.conf`：同机其他应用的 location 和 upstream；
- `nginx/conf.d/server-local/devscope-auth*.conf`：DevScope location 共用的访问控制；
- `nginx/conf.d/server-local/.devscope.htpasswd`：Basic Auth 密码哈希。

`server-local/` 已被 Git 忽略，但仍会被现有 Nginx 目录挂载读取。生产主机负责备份这些文件；部署不得删除、覆盖或提交它们。修改后只允许先执行 `nginx -t`，成功后再 reload。

## 数据库密码轮换

轮换时应在同一维护窗口内完成：

1. 备份 `.env`；
2. 生成新的随机强密码；
3. 在 PostgreSQL 中更新角色密码；
4. 原子更新 `.env` 中的 `POSTGRES_PASSWORD` / `DATABASE_URL`；
5. 重建 API 服务并验证连接；
6. 失败时恢复旧角色密码、旧环境文件和原服务；
7. 确认备份权限为 `600`，完成后按保留策略清理。

任何命令输出都不得打印新旧密码。

## 验证清单

服务器内部：

```bash
curl --fail http://127.0.0.1:3100/trpc/health
curl --fail http://127.0.0.1:3000/
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=50 worker
```

公网侧应验证：

- 未认证访问 DevScope 返回 `401`；
- 使用有效凭据访问首页和 health 返回 `200`；
- 同机其他站点状态与变更前一致；
- API、Web、Worker、PostgreSQL 容器健康；
- 日志中没有持续的数据库认证、代理或 5xx 错误。

## 回滚

按变更的逆序回滚：

1. 恢复 Nginx 配置备份并 `nginx -t`；
2. reload Nginx；
3. 恢复环境文件和数据库角色密码；
4. 恢复上一个已验证镜像或提交；
5. 再次执行内部与公网验证。

如果迁移需要回滚，先停止 Worker，再使用本次部署前生成的 custom-format 备份恢复数据库，
然后恢复上一个 API/Worker 镜像。不得只删除 `jobs` 或 `radar_candidates` 表来代替完整回滚，
也不得在未确认备份可读前执行恢复。

回滚不能依赖未记录的手工状态。每次生产变更都应记录时间、目标提交、备份位置和验证结果，但不得记录密钥明文。
