# 自动部署去代理单点：Verification

## 基线与失败复现

- 生产在 `ce7ff16` 健康运行，服务器工作树 clean，API/Web/Worker/PostgreSQL 与访问控制均正常；
- workflow run `32344426947`（`main@5e06c8f`，migration=false，cleanup=false）build 三镜像成功，deploy 在任何生产 mutation 前失败；
- 失败为服务器 `git pull` 三次 `gnutls_handshake() failed`，与 run `32337214423` 相同；
- repo-local `http.proxy=127.0.0.1:7890`；直连 GitHub 超时；Mihomo config test 与 service restart 成功但不能恢复；
- controller delay test：91 个真实 VMess/SSR 节点全部失败（90×503、1×504），HTTP proxy 对普通 HTTP 返回 502、TLS 返回 EOF/SSL_ERROR_SYSCALL；
- 结论：生产应用无故障，服务器公网代理是 release path 的外部单点；没有新订阅 authority 时不修改共享代理配置。

## 实现边界

- deploy workflow 为三个镜像增加 full SHA tag；
- GitHub runner 生成 full-history Git bundle、精确 SHA Docker archive 与 SHA-256 清单；
- 固定 `appleboy/scp-action` v1.0.0 commit `ff85246acaad7bdce478db94a363cd2bf7c90345`，复用现有 SSH secrets 传输到 `SHA-run_id` staging；
- 服务器验证 checksum、bundle、target SHA、fast-forward ancestry、Worker schema、磁盘空间与 image revision；
- checksum、bundle、schema 与磁盘 gate 通过后才执行 `docker load`；三个 image revision 必须全部通过后，才保存单一 rollback tag、更新 `latest`、fast-forward 并重建 API/Web/Worker；
- 不修改 Mihomo、数据库 schema/data、共享 Nginx 配置或同机其他站点。

## 验证记录

- `git diff --check`：通过；
- Ruby YAML parse：通过；build package script 与 deploy remote script 经 GitHub expression 占位替换后 `bash -n` 通过；
- `actionlint v1.7.12`（官方 release checksum 校验后执行）：通过；
- Git bundle gate 临时仓库演练：bundle 为 complete history，fetch `HEAD` 后 target SHA 精确匹配，ancestor gate 通过；
- Harness `state/validate/doctor`：通过，0 warning，active pointer 指向本 item；
- `pnpm lint`：13/13 tasks 通过，保留 16 个既有 Web warnings；
- `pnpm typecheck`：14/14 tasks 通过；
- `pnpm test`：11/11 workspace tasks + Skills pipeline 21/21 通过（DB unit 232/232）；
- `pnpm build`：9/9 tasks 通过；
- GitHub CI required checks：待 PR；
- 无迁移生产 workflow：待 CI 后执行；
- 生产独立复核：待 workflow 成功后执行。
