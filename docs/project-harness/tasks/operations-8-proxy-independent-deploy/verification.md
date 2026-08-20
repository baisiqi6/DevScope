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
- PR #50：GitHub CI `quality` 与真实 PostgreSQL `integration` required checks 均通过，合并为 `f0571d5`；
- 首次新链路 run `32346776308`：build、bundle/archive 生成和 217 MB SSH transfer 成功；deploy 在解释脚本时因旧 `script_stop: true` 对 `case ... ;;` 的逐行重写而语法失败，未执行 checksum 之后的任何逻辑；生产保持 `ce7ff16`、工作树 clean、三个运行 image revision 不变、migration journal 仍为 11；
- follow-up：删除 `script_stop`，改由脚本首行 `set -euo pipefail` 提供 Bash 原生 fail-fast 与 pipeline 失败传播；
- PR #51：follow-up 的 `quality` 与真实 PostgreSQL `integration` required checks 均通过，合并为 `4772098`；生产 Bash 同环境只读前导 probe 通过；
- 成功 run [`32348360956`](https://github.com/baisiqi6/DevScope/actions/runs/32348360956)：目标 `4772098bb204912c21a823e6cf036f19531848bc`，显式 `apply_database_migration=false`、`technology_stack_legacy_cleanup=false`；build/bundle/archive/SCP 5m50s，deploy 1m17s，cleanup skipped，workflow conclusion `success`；
- 生产 Git HEAD=`4772098bb204912c21a823e6cf036f19531848bc`、tracked worktree clean；API/Web/Worker 均 running 且 OCI revision 精确等于目标 SHA，PostgreSQL healthy；
- migration journal 部署前后均为 11；`repositories=40`、`pseudo_repositories=0`、`pseudo_watched=0`、`repository_technology_stacks=79`、`cleanup_receipts=1`、`is_reference_columns=0`、`active_jobs=0`；
- `TECHNOLOGY_STACK_STORAGE_MODE=legacy_cleaned`，分析端点仍为 MiniMax 大陆站、模型 `MiniMax-M3`；未读取或输出 API key；
- 图谱 API 独立返回 62 nodes / 249 edges（40 repo、9 language、13 technology_stack）；loopback tunnel 无凭据返回 401，Keychain-backed MCP `devscope_health` 返回 `status=ok`；
- 三个 `rollback` tag 均精确指向部署前 `ce7ff16` 镜像；成功 run staging 已自动删除；失败 run `32346776308` 的 217,053,981-byte staging 在诊断与成功复验后按精确 SHA/run ID 删除，可由 Actions run 重建。

## 结论

- Exit condition 已满足：生产服务器在 GitHub/GHCR 仍不可用的条件下完成无迁移自动部署，业务、访问控制与数据不变量保持；
- PR #50/#51 的 `quality` + 真实 PostgreSQL `integration` required checks、两次 fail-closed 证据与成功生产 canary 构成本 item 的等价审查门禁；当前单 Agent 收口未伪造独立 reviewer identity。
