# 自动部署去除服务器公网代理单点

## Item

- Checklist item：`operations-8-proxy-independent-deploy`
- Priority：P1
- Risk mode：high-risk
- Branch：`codex/operations-closeout`

## Outcome

DevScope 的常规无迁移部署不再要求生产服务器主动访问 GitHub 或 GHCR。GitHub Actions 在受控 runner 上构建并校验镜像与 Git bundle，通过现有 SSH 通道传入服务器；服务器只执行校验、fast-forward、`docker load`、目标服务重建与健康检查。

## Failure Evidence

- workflow run `32337214423` 与复验 run `32344426947` 都在镜像成功构建后失败于服务器 `git pull`，错误为 `gnutls_handshake() failed`；失败发生在 `docker pull` 和服务重建之前，生产未受影响；
- 生产仓库的 repo-local `http.proxy` 指向 `127.0.0.1:7890`；直连 GitHub 超时；
- Mihomo 配置校验通过且服务重启成功，但 91 个 VMess/SSR 节点的 delay test 全部失败，规则源刷新持续 EOF；当前没有获准且可用的新订阅配置。

## Scope

1. `actions/checkout` 使用完整历史，以目标 `github.sha` 生成可验证 Git bundle；
2. 三个镜像增加 full SHA tag；runner 拉取这三个精确 tag，打包为单个压缩 Docker archive；
3. 对 bundle 与 image archive 生成 SHA-256 清单，并用固定版本的 `appleboy/scp-action` 传到按 SHA 隔离的服务器 staging 目录；
4. deploy job 在任何运行中服务 mutation 前验证 checksum、bundle、目标 SHA、服务器工作树 clean、磁盘空间和 Worker schema；
5. 从 bundle 获取临时 ref，要求目标等于 `github.sha` 且当前 HEAD 是其 ancestor，再 `merge --ff-only`；
6. `docker load` 后核对三个 image 的 `org.opencontainers.image.revision`，再把精确 SHA tag更新为 compose 使用的 `latest`；
7. 只 force-recreate `api/web/worker`，随后执行 API/Web/Worker、Nginx 和访问控制复核；
8. 成功后删除本次 staging；失败时保留 staging 和现有生产容器状态用于诊断。

## Non-goals

- 不修改 Mihomo 订阅、节点、规则或其他站点的代理策略；
- 不执行数据库迁移、cleanup、DNS、HTTPS 或应用业务变更；
- 不把镜像归档、Git bundle、SSH key、Token 或生产配置提交到 Git；
- 不把 GitHub Actions artifact 当作新的长期发布仓库。

## Safety And Rollback

- workflow 继续使用 `concurrency: production` 串行生产操作；cleanup 输入与常规 deploy 仍互斥；
- 传输目录以 target SHA 隔离；checksum/bundle 在载入镜像前验证，三个 image revision 在改动 tag、Git HEAD 或运行中服务前统一验证；
- 迁移输入保持 `false` 时不创建数据库备份也不运行 `db:migrate`；已有显式迁移流程仍保留，但使用同一已校验镜像归档；
- 服务重建前记录当前三个运行 image ID，并保留为单一 `rollback` tag；健康检查失败时按 runbook 使用这些 tag 恢复；
- 不执行 `git reset --hard`，只允许 clean worktree 上的 fast-forward；失败后若 Git 已前进而 runtime 回滚，必须明确报告 revision/runtime 不一致并人工调和；
- 不修改或重启共享 Nginx，只允许 `nginx -t` 后 graceful reload。

## Verification

1. YAML 解析、`actionlint`（若可用）、`git diff --check`；
2. 本地用临时仓库验证 bundle 的 SHA/ancestor/fast-forward gate；
3. CI `quality` + `integration` required checks 通过；
4. 手动触发 `apply_database_migration=false`、`technology_stack_legacy_cleanup=false` 的完整 workflow；
5. Actions build、transfer、deploy 全部成功，cleanup job skipped；
6. 生产独立复核：服务器 HEAD、三个 image revision、容器、内部 health、外部 401、认证 MCP、图谱 62 nodes/249 edges、伪数据 0、migration journal 行数不变；
7. 把 run ID、目标 SHA、Mihomo 诊断边界和生产复核写入 verification/progress。

## Exit Condition

- 无迁移自动部署在服务器 GitHub/GHCR 仍不可用的条件下完整成功；
- 生产业务与数据不变量保持；
- 默认工作区切回最新 `main`，safety branch 继续保留为恢复锚点；
- 独立审查或等价的 PR/CI gate 未发现未关闭 P0-P2 finding。
