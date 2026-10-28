# Issue #79 Task 1 独立实现审查

## 当前结论（Fix round 2 continuity 复审，2026-10-28）

- Spec Compliance：`APPROVE`。原请求体 P2 与发布 upstream P1 均 `ADDRESSED`。
- Code Quality / 总体 verdict：`APPROVE`；没有未解决的 P0–P3，也未发现本轮修复引入新的实质性问题。此结论只批准 Task 1 本地实现，不是生产上线或全局 closeout approval。
- 本轮范围：`6a7813cccd32d7165aadf85962bd7dd4dcf6e4f0..d295c2fb7c32bcbd9ee2e83e1798cd972369ff3f`；本人读取最新 canonical plan（包含 Step 5a、workflow/helper allowlist 与新 TLS 1.30.6 选择）、fix diff、追加报告及对应证据。
- 当前 exact review packet SHA-256：`ea919a18ffe7143c9392260520e3e1327abdfd290bcae74c6e75daf16386c8c2`；canonical plan SHA-256：`c8ac65a88f55b9af719bbee3976af98fe62ffc5ac68b778bb4201ec97a249e27`。

### P1：ADDRESSED 的代码与验证依据

- `scripts/https-reload-if-present.sh:3-30`：固定唯一名称 `devscope-https`，拒绝可变目标参数；成功查询所有状态且确实无目标才跳过。停止或查询/inspect 失败不能冒充未安装；每条 Docker 调用有30秒边界，先 `nginx -t` 再 `nginx -s reload`，错误非零传播。无创建、启动、重建、Compose 混用或 Certbot 调用，满足当前最小兼容范围。
- `.github/workflows/deploy.yml:333-334`：实际调用位于原共享 Nginx check/reload 之后、清理与完成宣告之前；额外只读核对同一脚本入口 `:173` 的 `set -euo pipefail`，helper 非零会阻断发布完成。未安装 TLS 时保留旧部署路径，已安装但不运行时显式失败。
- `scripts/test-https.py:120-194`：直接执行真实 helper、逐参数比对固定目标与顺序，覆盖 absent/running/stopped/daemon-error/inspect-error/check-error/reload-error；抽取实际 workflow reload 区块执行，验证正常/未安装可完成、检查/reload 失败不可到达完成标记。没有用静态字符串存在替代调用行为验证。
- `scripts/test-https.py:491-538`：真实创建不同 IP 的 upstream B，从 A 移除 API/Web aliases，实际 DNS 断言两个名只解析 B；A 退役后已认证主页/tRPC 先502，真实 helper 后两者200，edge ID不变。测试 CLI shim 只把固定生产名映射为随机隔离目标，不把真实 nginx 检查/reload 替换成成功 mock。该测试直接回答此前 P1 的最小反例。
- 已读 `.planning/https-fix2-red.log`：4 tests / 10 subtest failures，helper缺失及workflow未接线的失败与报告相符；已读两个完整最终日志：新1.30.6为11/11、17.004s，旧1.29.8兼容为11/11、15.176s，均OK。Reviewer 未重复运行这些已覆盖的测试；实际 GNU timeout 时钟及生产 SSH workflow仍留给Task 2，不作已执行声明。

### 镜像、文档与边界

- 新 TLS 的 runbook runtime env 示例和测试默认值都使用 plan 指定的 `nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951`；没有修改旧共享 HTTP image 或触发升级。本人本轮核对 [Nginx 官方下载页](https://nginx.org/en/download.html) 的 stable 1.30.6 与 [安全公告](https://nginx.org/en/security_advisories.html)，版本选择有当前来源；未据此推导旧生产配置的具体漏洞可利用性。
- `docs/project-harness/runbook.md:551-561` 清楚区分常规应用发布仅刷新 upstream 与未来单文件 bind 配置更新需单独授权、校验新挂载后只重建独立 TLS；没有把未来维护说明变成本轮共享代理重建许可。
- 已核对本轮四门禁保存日志：lint13/13、typecheck14/14、test11/11、build9/9均cached；pipeline本次21项，18既有warnings与1既有skip仍明确，不包装成冷跑或无噪音结果。
- 原 P2 保持 `ADDRESSED`，本轮未重新派发；两个独立镜像矩阵继续包含共享请求体、认证、ACME、SSE/WS及证书轮换测试。
- 无生产访问、ACME签发、发布、index/HEAD/分支变化。只更新本审查文档与exact-packet review receipt。Task 2仍需真实证书、外部TLS/认证、renew dry-run、systemd/timer、共享路径及原五容器不变量证据，并另做生产closeout审查。

## 上轮结论（Fix round 1 continuity，历史，P1 现已修复）

- Spec Compliance：原请求体 P2 `ADDRESSED`；补充发布兼容风险 `CONFIRMED`。
- Code Quality / 总体 verdict：`CHANGES_REQUESTED`，当前仅一个 P1 阻塞项：正常业务发布没有刷新独立 TLS edge 的静态 upstream 地址。
- Fix round 1 范围：`45e8a4a582eb4e6a554dcca682c5da40b8c9be54..6a7813cccd32d7165aadf85962bd7dd4dcf6e4f0`。本轮延续原 finding，并应 Operator 明确委派只补查 `.github/workflows/deploy.yml` 的 API/Web recreate → 代理 reload 链；未漫游或修改产品代码。
- 本轮实际读取的 exact review packet SHA-256：`edc477baa842242ba9d5def049c04077a5019eb3409103549e2762bbc8101271`；canonical plan SHA-256 仍为 `8a823e52489e54f5031221e6beb8f7cacb0dc324eac82f78e36dc752513dc0cb`。

### 原 P2：ADDRESSED

- `nginx/https/http-domain.conf:5` 已最小补回 `client_max_body_size 10m;`。
- `scripts/test-https.py:177` 的共享 fixture 已改为真实 proxy；`scripts/test-https.py:277-291`、`:319` 对两域名、两共享路径、切换前后完整发送 2 MiB，并校验上游端口/path/接收字节数/SHA-256；使用超限 Content-Length 验证原 10 MiB 边界。新增 helper 的默认 GET 行为不变，未发现 fix 引入其他阻塞问题。
- 已读取 `.planning/https-fix1-red.log`：切换后实际 `413 != 200`，8 tests / 1 failure；`.planning/https-fix1-green.log`：8 tests / OK，10.332s。原报告与实际保存日志相符；Reviewer 没有重跑已被回答的矩阵。
- 本轮四门禁保存日志仍明确为缓存：lint 13/13、typecheck 14/14、test 11/11、build 9/9；18 既有 warnings、1 既有 skip 和本次 pipeline 21 tests 均与报告一致。未把缓存结果写成冷跑。

### P1 — 正常发布重建应用后，独立 TLS upstream 仍可能指向旧容器 IP

- Evidence：新增 `nginx/https/nginx.conf:18-19` 使用静态 `server api:3100` / `server web:3000`，没有动态 resolve；`docker-compose.https.yml:3-31` 将该入口放在独立 project/service。现有 `.github/workflows/deploy.yml:301` 每次正常部署 `--force-recreate api web worker`，`:330-331` 仅对旧业务 Compose 的 `nginx` 做配置检查及 reload，整个 workflow 没有 `devscope-https` reload。`:310-319` 的检查直接访问宿主 loopback API/Web，不能发现 TLS 使用旧 upstream。
- Semantic check：Docker 官方说明容器更新后 service 名保持不变、IP 可改变，客户端须重新解析；Nginx 官方说明 upstream 的 `resolve` 参数用于监控 DNS 变化并更新配置，本入口没有该机制。见 [Docker Compose 网络更新](https://docs.docker.com/compose/how-tos/networking/#updating-containers-on-the-network)、[Nginx upstream server](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server)。这些语义与当前配置、workflow 的组合构成代码级风险，不是根据 Operator 的猜测直接判定。
- Impact：HTTPS 接入后，后续正常 Web/API 发布可能造成持续 502/504；HTTP 业务请求又已重定向至 HTTPS。发布可在 API/Web loopback 健康且共享 Nginx reload 成功时宣告完成，但用户的 HTTPS 主入口不可用。每日两次的证书任务偶尔 reload 不能替代发布门禁，也不能允许依赖等待数小时恢复。
- Minimal counterexample：TLS master 启动时解析 API 为 IP A；正常 workflow 重建 API 后其地址变为 IP B，旧 A 不再提供端口 3100；loopback API health 检查通过，旧 HTTP Nginx reload 后用 B，而 TLS 继续向 A 建连。已认证 HTTPS `/trpc/health` 失败，未认证 401 仍可能正常。本轮未为复现访问生产，也不声称已观察生产故障。
- Minimal correction：在正常业务发布的应用健康检查完成后，保留原共享 Nginx check/reload，并对已安装的独立 TLS edge 执行有界、定向 `nginx -t` → graceful reload；使用确切容器或显式 TLS Compose project/file/env，确认目标身份，任何检查/reload 失败必须让发布失败。未部署 TLS 时保持原 workflow 路径；已安装但停止/异常时不能悄悄当作未安装跳过。不要在这里执行 Certbot、重建 edge、合并两个 Compose 或更改共享路由。用最小 helper 或局部 workflow 兼容均可，无需为此重做 DNS 架构。
- Minimum verification：隔离真实 Nginx 测试使 API/Web alias 确实切换至不同 IP，先证明旧解析仍失败，再调用发布刷新路径确认已认证 TLS 恢复且 edge container ID 未变；对未安装 TLS 的兼容分支、配置检查失败不得 reload、reload 非零导致发布失败做聚焦调用测试。
- Authority / plan：这是新增入口与既有稳定发布链的集成缺口，不要求 Worker 擅自执行生产。原 Worker 文件清单未包含 workflow；应由 Operator 先把最小兼容范围和验证补入 canonical plan，再派发实现并重新生成 review packet，本轮不以审查自行扩大写权限。

### 本轮退出边界

- 原 P2 已关闭，不应再次派发同一问题。当前唯一待修是上述发布兼容 P1。
- 未重跑整套测试、未访问生产、未改产品/index/HEAD/分支、未 commit/push/merge/deploy；仅更新本审查文档并按 exact-packet gate 写入 verdict。
- 生产 ACME、systemd/timer、外部 TLS、共享路径和原五容器身份仍须 Task 2 验收；这与本轮可从代码确认的发布兼容缺口分开。

## 首轮审查摘要与证据（历史，原 P2 现已修复）

### Spec Compliance

- Verdict：`CHANGES_REQUESTED`。一个 P2：新域名 HTTP server 未保留共享路径原有请求体上限，违反 shared locations 行为等价约束。
- Code Quality：`Needs fixes`；除下述有界修正外，没有发现需要阻塞 Task 1 的其他实现问题。
- Reviewer：`https-code-reviewer`；日期：2026-10-28；context mode：`limited-fresh`。依据底层目标、当前 canonical plan、exact review packet 和真实 diff 独立判断，不沿用旧 verdict。
- 审查范围：`7cd6c1caa5de1240d9e0a4342c8d37be47e7aeee..45e8a4a582eb4e6a554dcca682c5da40b8c9be54`，Task 1 本地配置、脚本、测试与操作文档；不包含尚未执行的 Task 2 生产验收。
- 已本人完整读取 `current/review-packet.md` 并计算 exact bytes SHA-256：`df58c36c4a3f3d2f340f0007188bcb1c83974768d3f792a1d2e7a883d7de70b3`。canonical plan 为 `tasks/issue-79/plan.md`。

## Strengths / 已核对边界

- `nginx/https/nginx.conf:22-42`：未知 SNI 的默认 server 拒绝握手；目标域名显式证书路径、TLS 1.2/1.3、必需认证 include，未引入 HSTS 或其他项目 HTTPS。缺 include 是配置错误，不能因 wildcard 空匹配静默匿名代理。
- `nginx/conf.d/devscope-locations.inc:1-49`：对照删除 hunk，四类旧代理路径原样提取，保留 Host、真实 `$scheme`、SSE 关闭缓冲和 WebSocket Upgrade；没有应用/数据库改动。
- `nginx/https/acme-location.conf:3-16`：公开路径限单段 base64url token，raw URI 再验证；独立 webroot、缺失文件 404、禁目录索引与 symlink。相邻/编码/穿越路径不映射配置目录；TLS 不加载此例外。
- `docker-compose.https.yml:3-64`：只有独立 HTTPS service 与 profile-gated Certbot；443、显式 external network、无业务依赖或 Docker socket；完整 letsencrypt 目录只读绑定保持 live/archive symlink 目标可见，缺 bind 源不自动造目录。
- `scripts/https-renew.sh:3-35`：显式 env/file/project，清除已使用的 Compose/TLS 环境覆盖；renew 失败非零终止，成功后先检查再仅 reload 独立 edge，dry-run 不 reload；没有重建共享服务命令。`scripts/systemd/devscope-https-renew.service:7-16` 与 `.timer:4-11` 给出服务器用户、时间上限、每日两次与 Persistent 调度。
- `docs/project-harness/runbook.md:420-600`：区分 bootstrap、独立 staging state、正式签发、可信 TLS 验收、再启用 308；明确备份、离线镜像校验、容器不变量、原认证文件不覆盖、只撤本轮内容、先撤 redirect 再停 edge 的回滚顺序。没有将本地完成写成生产完成。

## Findings

### P2 — 新域名 HTTP server 将共享请求体上限从 10m 降为 1m

- Evidence：`nginx/https/http-domain.conf:3-7` 新增 server 只设置 `listen`、`server_name` 并 include shared routes，缺少旧 `nginx/conf.d/default.conf:14` 的 `client_max_body_size 10m`。为排除上层继承，额外只读检查了未变更的 `nginx/nginx.conf:7-27`：http 层没有该设置。Nginx 的默认值是 `1m`，超限请求返回 413（[官方 core module 文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)）。Operator 补充的本轮生产只读结构证据确认 `/supplier-search/`、`/billmapper/` 的 location 内也没有覆盖此值；这属于 Operator 提供的证据，不冒称 Reviewer 本人访问生产。
- Impact：两个目标域名命中新 server 后，原共享 location 即便逐字保留，原先可代理的 1–10 MiB 请求也会被提前拒绝；旧 IP/loopback 仍是 10m，形成按 Host 才出现的共享应用回归。不能用共享上游当前 502 或空体 GET 返回相同来证明行为等价。
- Minimal counterexample：在任一共享 location 没有局部 body-size override 时，以 `Host: devscope.cn`（另测 `www.devscope.cn`）向 `/billmapper/` 下的 POST 入口发送 2 MiB 请求体。启用新域名 server 前该请求可进入共享代理；启用后 Nginx 因默认 1m 返回 413。此反例由配置及官方语义推导，本轮未向生产发送请求。
- Minimal correction：在新域名 server 层保留 `client_max_body_size 10m;`，不要修改服务器 shared-routes 文件；扩展现有隔离测试，使共享 mock 真正接收 POST 请求体，对两域名验证切换前后 2 MiB 可进入同一上游，超过 10 MiB 仍保持原拒绝边界。
- Coverage gap：当前 `scripts/test-https.py` 的 `shared-routes.conf` fixture 使用固定 `return 202/203`，`test_03_acme_and_staged_redirect` 只做空体 GET，因此其绿色结果不能覆盖共享代理的请求体继承语义。这是上述同一个 finding 的验证缺口，不另计问题。

## 验证证据与未验证边界

- 已读保存的 `.planning/https-docker-amd64.log:1-13`：Worker 运行记录为 8 tests / OK，10.780s；diff 中对应测试确实包含真实 Docker HTTP/TLS 请求、认证负向、SSE/WS、ACME 隔离、证书 symlink/reload 和协议版本。续期脚本顺序/失败传播由 subprocess doubles 验证，不能冒充真实 ACME。
- 已核对四门禁日志摘要：lint 13/13 cached 且 18 warnings；typecheck 14/14 cached；test 11/11 cached、既有 Worker integration 1 skipped，pipeline 本次 21 tests；build 9/9 cached。与 Worker 报告一致，不称冷构建或 pristine 输出；本 diff 没改警告涉及的应用代码，不把既有 warnings/skip 制造为本次 P0–P3。
- Reviewer 没有重跑整套测试，未访问生产、签发证书或执行 deploy。额外检查仅为上述具体继承风险读取未变更的 HTTP main、核对官方默认值，以及只读核对提供的运行日志。
- 生产真实 ACME、外部受信任 TLS、现有 auth 文件语义、GNU timeout/systemd 权限与 timer、共享生产请求和原五容器身份仍为 `UNVERIFIED`，必须由 Task 2 按 runbook 留证；它们不是 Worker 未获授权生产操作的 Task 1 缺陷。
- 总体：修复唯一 P2 并增加对应聚焦请求体回归后可复审；当前不能批准 Task 1，也不能据本审查标记整个 Issue 已完成。
