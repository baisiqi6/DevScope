# Issue #79 Task 1 本地实现与验证

- Worker: `https-worker`；session: `devscope-https-worker-20261028`。
- 日期：2026-10-28。worktree：`/Users/Admin/projects/WorkTrees/DevScope-https`。
- 分支：`codex/devscope-https`；实现基线：`7cd6c1caa5de1240d9e0a4342c8d37be47e7aeee`。
- 范围：仅 Task 1 产品配置、续期脚本、隔离测试与文档；没有连接生产、签发真实证书、push、merge 或 deploy。
- 入口已本人执行 installed Harness `accept issue-79 https-worker devscope-https-worker-20261028 --branch codex/devscope-https`、`sync issue-79`、`state`；accept 记录 active lease 至 `2026-10-28T19:02:24Z`。首次误用不带 item 的 `sync` 只返回 Usage，随后使用正确命令成功，没有改通用脚本。

## 交付范围

1. `nginx/conf.d/default.conf`：原四类 DevScope locations 原样提取为 `devscope-locations.inc`，原 auth wildcard、SSE、WebSocket、Host/IP/forwarded headers 不变；添加两个可选服务器 include。
2. `nginx/https/nginx.conf`：独立 TLS main，直接代理既有 API/Web，精确必需 auth include；拒绝未知 SNI/Host，仅 TLS 1.2/1.3，无 HSTS；不加载共享其他应用 routes。
3. `nginx/https/acme-location.conf`：bootstrap HTTP token-only webroot，raw URI 限制、目录/缺失/多级路径 404、禁止 symlink，不公开整个 conf.d 或证书目录。
4. `nginx/https/http-domain.conf`：在 TLS 公网验收后才安装；精确两个目标域名，仅 DevScope fallback 308，复用原 shared routes 和 ACME 片段。
5. `docker-compose.https.yml`：独立 project/container `devscope-https`，仅 443，explicit external network；profile-gated Certbot，无业务服务/数据库/depends_on/Docker socket。TLS env 与业务 `.env` 隔离，完整证书目录 readonly，缺 bind 源不自动造空目录。
6. `scripts/https-renew.sh` 与两个 systemd units：固定 project/file/env；清除调用者 Compose/TLS 覆盖；Certbot renew 非零失败传播，成功后 `nginx -t` 再 reload 独立 TLS；dry-run 不 reload。GNU timeout 限定 15min/30s/30s，service 总 20min；timer 每日两次、随机延迟、Persistent，以服务器 `devscope` 执行，不依赖 Mac。
7. `scripts/test-https.py`：标准库 + Docker/OpenSSL，真实 Nginx 请求矩阵与证书轮换、受控 subprocess double 的续期流程验证，无新增包依赖。
8. 唯一 architecture/runbook/AGENT_INTERFACES 同步；没有改宿主机 MCP 配置。runbook 含 preflight、备份/镜像校验传输、bootstrap、独立 staging state、正式签发、TLS 验收后 redirect、续期/timer、诊断与精确回滚。

Operator 在实现过程中澄清：最终精确域名 HTTP server 也必须保留 `shared-routes*.conf`，不能靠“旧消费者可能不用域名”作假设。实现采用该最小保留策略，ACME 独立文件在每个 server 中只 include 一次，不重复 location。canonical plan 由 Operator 管理，Worker 未改写。

## RED / GREEN 与排查证据

首次 RED（实现文件尚不存在）：

```bash
python3 scripts/test-https.py
```

实际 exit `1`：续期场景 5 failures，原因均为 `https-renew.sh: No such file or directory`；Docker setup 的断言为 `HTTPS implementation missing: nginx/https/nginx.conf`，报告 1 error；没有访问生产。随后增加实现，并逐项让真实请求与续期契约通过。

过程中发现并修正的测试/环境问题（非隐藏）：

- Docker 29 的 internal network 没有提供测试所需宿主映射，改成唯一命名独立 bridge，端口仍只绑定 `127.0.0.1`，没有加入现有网络。
- 本机 Python 3.14 严格验证要求测试 CA 有 critical key usage，已补齐 CA/leaf 扩展，未关闭证书校验。
- 缺 htpasswd 时真实 Nginx 对带凭据请求返回 `403`，不是初始假设的 `500`；期望调整为实际 fail-closed 状态，未放宽为任意状态。
- Compose config 默认正确隐藏 profile-gated Certbot；测试先验证只含 edge，再显式激活 profile 验证完整配置。
- 在运行中从宿主快速 rename 证书 symlink 的缺证书用例出现 bind 可见性时序差异；改成全新空证书 bind 的冷启动 `nginx -t`，明确得到 `cannot load certificate`。轮换测试仍保留真实 symlink 替换与实际 served cert 比对，没有靠静态 grep 替代。

最终 GREEN（生产相同 immutable Nginx，amd64 在本机 arm64 上执行）：

```bash
HTTPS_TEST_NGINX_IMAGE=nginx@sha256:8aa63af009a39ecd6c28d61da578a5447378c10bb097a069e3a3e0fb42bb6b19 python3 scripts/test-https.py
bash -n scripts/https-renew.sh
git diff --check
```

实际：`Ran 8 tests in 10.780s / OK`，exit `0`；shell syntax 与 diff whitespace 检查 exit `0`。
完整最终聚焦输出：`.planning/https-docker-amd64.log`。此前 arm64 `nginx:1.30.0-alpine` 的当时 7 项矩阵也通过；最终扩充到 8 项的是 amd64 digest 运行。

### 实际请求与状态

| 边界 | 实际断言 |
|---|---|
| HTTP/TLS 未认证或错误密码 | `/`、`/_next/static/test.js`、`/api/health`、`/trpc/health`、`/api/agent/stream` 都 401 |
| 两个 TLS 域名正确认证 | 主页/静态路由到 Web:3000，API/tRPC 到 API:3100，200；上游 Host 正确，spoofed forwarded proto 被真实 `https` 覆盖 |
| 原 HTTP forwarded proto | 认证 tRPC 上游得到 `http` |
| HTTP/TLS SSE | 首个 data 行在 1.5s 内到达，2s 后尾块可读；未缓冲整条流 |
| HTTP/TLS WebSocket | Upgrade 请求得到 101 |
| HTTP ACME | 两域名 token 200 且正文精确；带 query 仍 200；missing/目录/多级/token 含点/编码 token 404 |
| ACME 公开范围 | 邻近路径、明文/编码穿越都仍 401；webroot 中指向 auth config 的 symlink 404；TLS 上同一 token path 401 |
| 两阶段域名 HTTP | bootstrap 仍保留原业务认证；安装域名片段并 `nginx -t → reload` 后 `/api/health?x=1` 为同域同 path/query 的 308，ACME 200/404 |
| 共享路径 | 两目标域名切换前后 `/supplier-search/` 202/相同正文、`/billmapper/` 203/相同正文；IP、loopback、other Host 仍保留相同共享路由，主页 401 不跳转 |
| 缺配置/证书 | 删除精确 auth include 后 `nginx -t` 非零；缺 htpasswd 时匿名 401、正确凭据 403，未 proxy；空证书 bind 冷启动检查非零 |
| 证书 reload | live→archive symlink 更换后仅磁盘变更时 served cert 不变；真实 `nginx -t` 与 reload 后 served cert 与新 DER 精确一致，仍通过测试 CA 验证 |
| TLS 版本/未知 SNI | TLS 1.2 与 1.3 成功；1.0/1.1 拒绝；未知 SNI 拒绝 |

续期 wrapper 使用受控 Docker/timeout doubles 检查**实际脚本调用与退出行为**：普通 renew、dry-run、renew exit17、nginx -t exit18、reload exit19、缺 env 文件；逐参数核对固定 project/file/env、`run --rm --no-deps certbot renew --non-interactive --cert-name devscope.cn`，失败分支不会继续，配置检查始终在 reload 前，dry-run 没有检查/reload，不输出私钥。该部分没有假称真实 ACME renew 已成功；真实 reload 由上述 Docker 证书用例单独证明。GNU timeout 的真实时钟触发与 systemd 执行留待服务器验收，本机验证的是有界调用参数和缺工具 fail-closed 路径设计。

## 工程四门禁

所有命令在此 worktree 执行，完整输出保留 `.planning/https-{lint,typecheck,test,build}.log`：

| 命令 | 实际结果 | 既有噪音/边界 |
|---|---|---|
| `pnpm lint` | exit0；13/13 tasks（13 cached） | 原有前端 18 warnings、0 errors：`@next/next/no-img-element` 与 `node` unused；未顺手整改 |
| `pnpm typecheck` | exit0；14/14 tasks（14 cached），后续 skills tsc 成功 | Turbo 回放日志中可能显示主工作树路径；不是当前进程跑到主树，明确缓存事实 |
| `pnpm test` | exit0；11/11 Turbo tasks（11 cached），pipeline 本次 21/21 | 原 Worker integration test 1 skipped，数据库负向测试预期 stderr 等噪音已存在；不等同 CI 的真实 PostgreSQL required integration |
| `pnpm build` | exit0；9/9 tasks（9 cached） | 使用缓存，不声称冷构建；未改应用代码/依赖/schema |

`pnpm install --frozen-lockfile` 已由 Operator 在派发前完成；本次没有新增 dependency 或锁文件变更。真实 PostgreSQL integration 本轮未重跑（无数据库改动），required CI 仍由发布 Operator 承担，不能从四门禁推导生产可用。

## 镜像与官方对照

- 本地允许拉取的生产 Nginx immutable digest 已成功 pull，`nginx -v` 实际 `nginx/1.29.8`。初始本机已有 arm64 `nginx:1.30.0-alpine`；两者区分记录，没有将本机 tag 当生产镜像。
- 既有 Certbot immutable image 本地 `--network none --version` 输出 `certbot 5.8.0`。`--help all` 确认 renew/cert-name/dry-run 等参数；隐藏无邮箱参数仍由该镜像 `_determine_account` 的 `register_unsafely_without_email` 分支支持，未连接 ACME、未创建真实账户。
- [Certbot 5.8 官方指南](https://eff-certbot.readthedocs.io/en/stable/using.html)：核对 webroot、certonly、renew/dry-run 与 state 锁；[Nginx SSL 官方模块](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)：核对 TLS 协议/default server 边界。实际配置有效性以本轮 Docker 请求为准。

## 自审、残留与下一阶段

- 自审已逐项核对 Task 1：公共路由精确提取、TLS 必需认证片段、两阶段顺序、token-only root、完整证书目录、作用域固定、失败传播/校验后 reload、无人值守 timer、中文唯一文档。未改应用、DB、同机其他站点配置、认证哈希或通用 Harness runtime。
- 产品提交只包含上述 14 个允许文件（含本报告）；父级 plan/review/current pointers/checklist/state/events 保持未提交，未 stage 整个 task 目录或 Harness root。
- 测试清理：`docker ps -a --filter name=devscope-https-test-` 与同前缀 network 查询均为空；临时测试 CA/私钥/htpasswd/token 随 temporary directory 清理。无端口 listener/业务数据残留。只保留 `.planning/` 日志、ignored brief/report 与本轮拉取的 Nginx image，便于独立审查；不 prune 本机镜像。
- 尚未验证：生产 DNS/AAAA/80/443、正式与 staging ACME、现有认证文件具体内容、生产共享路径、真实系统证书链、服务器 GNU timeout/systemd/权限/timer 与未来续期。相关门禁明确留给 Operator，未替其完成或标记全局 done。
- 已有 cache/warnings 不构成新回归，但不能包装成全量冷跑。没有外部续期告警送达机制；runbook 明示 journal/到期检查，不能承诺未验证的提醒。
- 提交后按委派执行 `handoff issue-79 https-operator --actor https-worker --reason 'Task 1本地实现完成，待独立实现审查与生产发布'`，释放 Worker lease；独立实现 Reviewer/生产 Operator 决定下一步，不 closeout 全局 item。
