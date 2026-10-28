# Closeout Packet

## Freshness Metadata

- generated_at: `2026-10-28T18:40:18Z`
- source_plan_sha256: `2d6e11a63f08d0f3a24073c9b9d6acf475486ea80e2be88ae0847a44226ac586`
- canonical_plan_path: `docs/project-harness/tasks/issue-79/plan.md`
- checklist_item: `issue-79`
## Subject

- Checklist item: `issue-79`
- Reviewer: `https-production-reviewer`
- Updated at: `2026-10-28T18:40:18Z`
- Workflow mode: `high-risk`
- Canonical plan path: `docs/project-harness/tasks/issue-79/plan.md`

## Item Snapshot

- Title: devscope.cn 独立 HTTPS 与自动续期
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: https-operator
- Session: devscope-https-20261028
- Dependencies: None

## Acceptance

两域名可信 TLS、域名 HTTP 308、业务 Basic Auth 与旧 tunnel 保留、自动续期 dry-run 和 timer 可验证；原五容器/共享路由不重建不回归；独立审查与生产证据齐全

## Verification

PR80/CI40740514866双绿；生产配置e577c1e9，可信TLS/root+www/HTTP308/401与安全认证首页API同源API17静态资源均通过；renew真实dry-run成功、systemd service成功且timer enabled active，原五容器/原配置/共享路由不变量通过。等待独立生产closeout。

## Self-test Evidence

Operator已亲自运行全四门禁及11项TLS矩阵；生产CA正式签发/外部TLS/10类401/安全注入认证home API前端API17静态资源/308/真实dry-run/systemd timer/原五容器和保护文件与8组共享请求cmp全部验证。详细verification与脱敏live-https-final.log；没有业务镜像重建、数据库迁移、DNS修改或公网HTTP凭据。

## Handoff

已完成生产操作；最终Reviewer只读复核运行证据并绑定closeout packet，审批后Operator mark-done。后续仅文档PR，不重建应用。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# devscope.cn 独立 HTTPS 入口实施计划

> For agentic workers: 使用 `subagent-driven-development` 分工实施；本文件是 Issue #79 唯一 canonical plan，不另建项目计划。Operator 管生产与发布，Worker 只改本地代码，Reviewer 独立审查。

**Goal:** 备案通过后，让现有单用户 DevScope 通过可信 HTTPS 域名访问，并具备可验证的证书自动续期和独立回滚路径。

**Architecture:** 增加独立 Nginx TLS Compose project，仅发布 443，加入现有 DevScope Docker network，直接代理 API/Web。HTTP 与 HTTPS 复用同一份 DevScope location 配置和现有 Basic Auth 哈希。现有共享 Nginx 只校验后 reload，不重建；通过 HTTP-01 webroot 签发，无 DNS AccessKey。

**Tech Stack:** Nginx、Docker Compose、Certbot 5.8.0、Let's Encrypt、systemd timer、shell/Python 标准库测试；不改应用或数据库。

## Global Constraints

- 用户已于 2026-10-28 明确批准独立 HTTPS 入口、免费证书、自动续期和保留登录保护的方案；这不授权任何付费购买、主体资料修改、凭据轮换、多用户发布或其他站点修复。
- 目标域名仅 `devscope.cn`、`www.devscope.cn`；DevScope HTTP 业务路径在 HTTPS 验证后跳转到 HTTPS；ACME path 不鉴权，DevScope 业务路径必须继续 Basic Auth。既有其他项目的 shared locations 在两个域名 HTTP 下同样原样保留，不将它们重定向到 TLS Web；本轮不新增其他项目的 HTTPS。
- 不 restart/recreate 原有 `devscope-nginx`、`api`、`web`、`worker`、`postgres`；不得覆盖 `shared-routes.conf`、`devscope-auth.conf` 或 `.devscope.htpasswd`。
- 只有 `nginx -t` 通过才允许 reload。共享 location 提取必须行为等价，SSE、WebSocket 和 `X-Forwarded-Proto` 保持正确。
- 证书私钥、ACME account、生产配置/备份、Basic Auth 明文或哈希不进入 Git，不打印；认证请求只走 SSH loopback 或已验证证书的 HTTPS。
- HTTP-01 challenge 使用现有 readonly conf.d bind mount 可读的独立 webroot；证书配置、work/logs 在服务器持久路径，Certbot 只 `certonly`/`renew`，不得使用会修改共享 Nginx 的 installer。
- 独立 TLS project 不含业务服务、数据库、共享 Nginx或 `depends_on`；不把 Docker socket 挂入容器。新 TLS edge 使用已核验的 stable Nginx 1.30.6 immutable digest；旧共享 HTTP Nginx 1.29.8 仅保留并验证兼容，不重建或升级。
- 不设置 HSTS preload、includeSubDomains 或长时 HSTS，保留安全回滚窗口；不关闭 TLS 校验或降低到 TLS 1.0/1.1。
- stable docs 各保留一份：架构在 architecture.md，操作在 runbook.md，接口在 AGENT_INTERFACES.md，本任务过程在本目录。
- 当前主工作树三处 Harness 未提交修改属于用户/他人，保持原样；所有本次写入都在 `/Users/Admin/projects/WorkTrees/DevScope-https`。
- 仓库实例 Harness 旧版缺少 exact-packet freshness 参数，本轮在 git-ignored `.planning/harness-runtime` 用已安装 EXharness 模板实例化调用，不改通用协议，不依赖主树未提交修改；唯一 checklist/plan/event authority 仍是本 worktree 的现有 harness root。

## 当前事实与协作

- Issue: https://github.com/baisiqi6/DevScope/issues/79；已搜索全部相关 Issue/open PR，无重叠，认领已读回。
- Branch: `codex/devscope-https`；base `7cd6c1caa5de1240d9e0a4342c8d37be47e7aeee`。
- 生产代码PR #80已合并，配置发布目标 `e577c1e9eb9045ed74a1ed725516d1f19564a810`；发布后文档/receipt收口分支为 `codex/devscope-https-closeout`，不再次部署应用。
- 2026-10-28：两条 A 记录均为现有服务器，域名 HTTP 返回 DevScope `401`，不再返回备案拦截；TLS 尚不存在。
- 生产 HEAD 和三应用仍为 `791ebab9fd68f0e6866631d6450edec78134e660`；原五个容器 ID、image、StartedAt 作为不重建基线留存。
- 共享 `/supplier-search/` 与 `/billmapper/` 在本次变更前均为 `502`；本任务要求不新增回归，不将其原有失败写成健康或顺手修复。
- Nginx immutable image 已有 `nginx@sha256:8aa63af009a39ecd6c28d61da578a5447378c10bb097a069e3a3e0fb42bb6b19`。
- 新 TLS edge 选用官网当前 stable `nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951`，amd64 manifest `sha256:84ed8c0dd296c188bfc24ed506f46589e9285fb0b11cf3a04d91d524d3067e11`（官方镜像创建于 2026-10-21）。官网已有覆盖旧支线的安全修复公告，不能把“旧镜像可启动”当新入口版本选择；不在本轮顺手升级共享 HTTP 服务，也不声称已判断其具体可利用性。
- 离线导入实测只保留平台manifest ID，因此实际runtime env使用该同一批准内容的 `sha256:84ed8c...` / Certbot `sha256:398c472...`，并添加本任务版本tag防one-shot镜像被常规prune；不是更换镜像内容或使用latest。具体完整值与恢复流程只维护runbook，运行证据见verification。
- Certbot 官方文档当前为 5.8.0；manifest list `certbot/certbot:v5.8.0@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20`，amd64 manifest `sha256:398c47284a6d6782825be71685f677ef3a1e65b8b5c278a8b1e99f6da84b4eb9`。

## Task 1: 本地配置、续期与隔离验收（Worker）

**Files:**

- Modify: `nginx/conf.d/default.conf`（仅提取 DevScope locations 及增加服务器专属 domain-server include）。
- Create: `nginx/conf.d/devscope-locations.inc`（唯一公共代理路由，保留四类路径、认证、SSE/WebSocket）。
- Create: `nginx/https/nginx.conf`（独立 TLS main，复用公共 locations，不加载 shared-routes）。
- Create: `nginx/https/acme-location.conf`（复制到 server-local 的 bootstrap HTTP challenge location）。
- Create: `nginx/https/http-domain.conf`（复制到 server-local 的最终域名 HTTP server，保留 ACME path，其他路径 308）。
- Create: `docker-compose.https.yml`（独立 TLS edge 与 profile-gated one-shot Certbot，显式外部网络、配置/证书/webroot mounts）。
- Create: `scripts/https-renew.sh`、`scripts/systemd/devscope-https-renew.service`、`scripts/systemd/devscope-https-renew.timer`（有界、失败非零、只 reload TLS edge）。
- Modify: `.github/workflows/deploy.yml`；Create: `scripts/https-reload-if-present.sh`（正常应用发布后仅刷新已安装的独立 TLS edge，不在发布时续期/创建/重启任何代理）。
- Create: `scripts/test-https.py` 或等价零新增依赖的聚焦测试（包括实际 Docker/Nginx 集成，不止 grep 配置）。
- Modify: `docs/project-harness/runbook.md`、`architecture.md`、必要的 `docs/AGENT_INTERFACES.md`（HTTPS 优先、旧 tunnel 保留；不改用户宿主机 MCP 配置）。
- Evidence: 本目录 `implementation.md`；不要替 Operator 写成已部署。

**Interfaces:** TLS project 名 `devscope-https`、container `devscope-https`，仅暴露 TCP 443。TLS runtime env 显式与业务 `.env` 隔离，提供 immutable Nginx/Certbot image、持久 state dir 与现有 network 名；生产 `devscope_devscope-network`。renew wrapper 接受显式 runtime env file，timer 以 `devscope` 运行 Docker，无需登录会话或本地电脑在线。

- [x] Step 1: 建立失败测试。用 mock API/Web 上游、临时 htpasswd/测试证书、隔离 Docker network，验证配置缺失时明确失败；实际请求矩阵包括无认证 `/`、`/api/`、`/trpc/`、SSE，认证主页/health、TLS forwarded proto、ACME 200/缺失 404、域名 308、其他 host/共享 location 不变。
- [x] Step 2: 将 existing locations 逐行提取为 `.inc`，保留旧路径行为。TLS listener 只使用 TLS 1.2/1.3 和两个目标域名；证书路径固定，完整目录 readonly bind 保证续期后 symlink 目标可见；认证配置缺失必须 fail closed，不能因 wildcard 空匹配开放 HTTPS。
- [x] Step 3: 实现两个阶段 HTTP 配置：先把 ACME location 放进现有 server-local include，其他路径不变；证书签发、TLS 验证通过后才增加精确 server_name 的重定向 server。该 server 同样 include 既有 shared routes（ACME location 只能定义一次），只有 DevScope 业务请求落到 308；两个目标域名下既有其他项目的共享路径维持原路由。原 IP/loopback 仍落默认 server，不强制 TLS，保留已有 MCP tunnel。
- [x] Step 4: 实现 Certbot webroot 签发命令与 renew wrapper；`renew` 失败不伪装成功，不 reload 未校验配置；dry-run 不替换真实证书。timer 每日两次检查，随机延迟并 Persistent；检查/日志/备份和续期失败后的定位命令写进 runbook。
- [x] Step 5: 实际 Docker 集成请求覆盖上述矩阵；加 renewal wrapper 测试：失败传播、正确 project/service、`nginx -t` 先于 reload、无共享服务重建、无私钥输出。测试资源用 task-specific 名字，清理只针对本测试资源。
- [x] Step 5a: 补齐正常应用发布兼容。API/Web force-recreate 后会改变静态 upstream DNS 解析结果，现有 workflow 只 reload 共享 HTTP Nginx，必须在该步骤后调用最小的定向 TLS reload helper。未安装 edge 时兼容跳过；已安装但停止、Docker 查询失败、`nginx -t` 或 reload 失败必须非零并阻断“Deployment completed”，不得隐式启停/创建 edge 或触发 certbot。测试覆盖缺失/运行/停止/daemon错误/检查失败/reload失败，检查先校验后 reload、只选固定 `devscope-https`，以及 workflow 真实接线位置。
- [x] Step 6: `pnpm install --frozen-lockfile`（如 worktree 无依赖），运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，必要集成门禁由现有 CI 承担；记录真实结果和环境限制，不跳过类型/测试。
- [x] Step 7: 更新唯一 runbook：先检查干净 worktree/备案/DNS/端口、备份现有配置、镜像离线传输校验、bootstrap challenge、staging cert、正式 cert、TLS edge、外部验收后 redirect、renew dry-run/timer、精确回滚。自审后只提交本 Task 文件，Conventional Commit，不 push/merge/deploy。

## Task 2: 独立审查、发布与生产接入（Operator）

- [x] 配置审查在生产 mutation 前完成：Reviewer 读取真实 diff、测试、runbook 和当前 exact packet；无阻塞 finding 才进入发布。
- [x] 刷新远端语义重叠、main/rules/checks；push task branch、关联 PR `Refs #79`，跑 required `quality` 和真实 PostgreSQL `integration`；遵循允许 merge method，attach PR。工程合并不等于生产验收，Issue 在最终生产 closeout 后单独关闭。
- [x] 生产 preflight 再核对容器、HEAD、干净 worktree、未占用 443、磁盘、共享 routes/auth 哈希和两条现有共享 path 状态；仅记录哈希/身份元数据，不输出 hash 文件内容。
- [x] 在 `/home/devscope/backups/devscope/` 创建 mode 700 本轮配置备份，文件 mode 600；不触及业务库，本轮没有 DB mutation，不做多余恢复/迁移。备份 .env、nginx 配置和必要的当前 TLS/runtime/timer 状态，验证 archive 可读且不打印私钥。
- [x] 用 bundle/checksum 将精确已合并提交 fast-forward 到 server；本轮只配置变更，不运行会重建三应用的常规应用 deploy workflow，不将 server HEAD 前进等同于三应用镜像变更。
- [x] 新 TLS Nginx 1.30.6 与 Certbot 镜像通过本地/runner pull amd64 → docker save → SSH → checksum → docker load，避免服务器代理/GitHub/GHCR 依赖；无 checksum 则停止。共享 HTTP Nginx 镜像保持原样。
- [x] bootstrap 仅添加指定 ACME server-local 文件；`nginx -t` 后 reload。两域名独立随机 token 均公开 HTTP 200，缺失 token 404，受保护路径仍 401，其他 path 与 baseline 一致。
- [x] staging ACME 演练使用单独 cert state，不能把测试 CA 证书部署公网；再正式签发，读取公开证书 SAN/issuer/dates 验证，不输出 key/account。
- [x] 仅创建独立 TLS project，确认公网受信任证书，两域名认证/未认证路径正确；如 443 云侧阻塞，只读确认后处理明确的 DevScope 443 规则，不开放其他端口。需要云账号重新登录时向用户明确报告，不获取聊天凭据。
- [x] TLS 已能从公网访问后再启用域名 HTTP redirect，校验后 reload；保留旧 IP/loopback/tunnel。检查 API/Web/Worker/DB 和共享 Nginx 的 container ID、image 和 StartedAt 与前值完全一致。
- [x] 正式证书 `renew --dry-run` 成功；安装并启用 scoped systemd timer，验证 service 成功退出、timer 下一次时间、失败诊断入口；不虚报真正未来续期已发生。
- [x] 仅通过验证过证书的 HTTPS 或 loopback 安全注入现有 Keychain 认证，验证首页、17 类当前静态资源（按页面实际引用提取）、health 和只读仓库列表；不触发采集或数据库写入。
- [x] 可选已登录浏览器GUI回归本轮未执行（无UI改动），不冒称全站UI验收；实际验证同源`/api/trpc`、公开TLS/认证、HTML/17静态资源及真实只读业务。未向公网HTTP发送凭据，凭据不出现在截图/日志/URL。

最终收口门禁（状态只由Harness维护，不在plan重复维护审批状态）：独立 Reviewer 审查实际生产receipt（证书、TLS/redirect/认证、renew、timer、容器不变量和共享路径），通过exact-packet gate记录verdict；Operator之后才可mark-done。生产结果在verification/progress，稳定操作在runbook。

## 回滚与退出条件

- 任一阶段失败：不重启原共享 Nginx或业务容器；恢复本轮新增的域名 redirect/bootstrap 片段及必要 tracked config，`nginx -t` 后 reload；只停止独立 `devscope-https` service 和本轮 timer。保留私钥/ACME state 和备份诊断，不执行大范围 prune。
- HTTPS 切换后如只续期失败，已有有效证书保持可用，日志非零并及时人工处理；不回退为公网带密码 HTTP。
- done 需要独立 Reviewer 对实际发布和运行证据 APPROVE；只有本地测试/CI 通过或证书签发成功均不足。
- 外部依赖/缺少账号 authority 阻塞时保留具体阶段、已执行 mutation、回滚状态和剩余动作，不将未完成内容标 done。

## 官方参考

- https://eff-certbot.readthedocs.io/en/stable/install.html#running-with-docker
- https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates
- https://letsencrypt.org/docs/challenge-types/
- https://nginx.org/en/docs/http/ngx_http_ssl_module.html
- https://nginx.org/en/download.html
- https://nginx.org/en/security_advisories.html
```

## Recent Progress Context

```md
### Issue #54 生产 closeout

- 隔离分支 `codex/issue-54-tree-groups` 已实现单父级邻接树、组合外键、循环 trigger、按用户
  advisory lock、直接/聚合计数与真实 membership 来源；
- Shared、API、Client、CLI、MCP、首页和 `/groups` 已贯通树读取、聚合成员、创建子组、移动与
  完整同级重排，并保留旧扁平读取、直接成员与 `repoCount` 语义；
- 真实 PostgreSQL 16 + pgvector 集成门禁已连续两轮通过，每轮 9 个测试文件、57 项测试；
- 最终版本的 `lint/typecheck/test/build` 已全部通过；静态审查发现并修复一处 API 删除预检位置
  错误及聚合可见性 fallback，并补齐回归测试；Kimi K3 `thinking=max` 独立终审 `APPROVE`，
  无 P0–P3。完整证据见 [verification](tasks/issue-54/verification.md)。该本地验证记录本身不表示
  生产已具备 `0011` schema。
- PR #55 在 `quality` 与 `integration` 成功后合并，Issue #54 已关闭；生产 migration journal
  从 11 增至 12，15 个旧分组全部保持根级，86 条 membership 不变；组合外键、cycle trigger/function
  均存在；
- 发布前独立备份与 workflow 备份均验证可读；运行镜像为 `63ec7c5`，rollback 镜像为 `4772098`；
  API/Web、树读取、聚合读取、MCP 隧道认证、Nginx 与近期错误日志复核通过；详细回执见
  [verification](tasks/issue-54/verification.md)。

## 已完成整改

| 领域            | 已完成结果                                                                        | 详细证据                                                                                   |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Release ID      | GitHub Release ID 无损迁移为 `bigint`，生产迁移、回滚与大 ID 往返已验证           | [verification](tasks/data-correctness-1a-release-id-bigint/verification.md)                |
| 仓库身份        | 正式仓库统一使用 GitHub stable ID，rename、Radar 去重与 production cutover 已关闭 | [verification](tasks/data-correctness-1b-repository-identity/verification.md)              |
| 分组计数        | `repoCount` 已在 API 边界归一为 number，生产 MCP 复查通过                         | [verification](tasks/data-correctness-1c-group-count-contract/verification.md)             |
| 采集一致性      | chunks、Releases、HN、SBOM 与 embedding 改为版本安全的原子替换                    | [verification](tasks/data-correctness-2-atomic-replacement/verification.md)                |
| 技术栈 Phase A  | 独立实体、新表、backfill、dual-write 与 shadow zero-diff 完成                     | [verification](tasks/data-architecture-3-technology-stack-entities/verification.md)        |
| deps.dev 缓存   | `resolved/not_found/error` 恢复语义、timeout、有界并发、预算与冷暖 rebuild 完成   | [verification](tasks/data-correctness-4-deps-cache-recovery/verification.md)               |
| PostgreSQL 门禁 | 真实 PostgreSQL 16 + pgvector 的迁移、事务、锁与并发矩阵进入 CI required checks   | [verification](tasks/data-quality-5-postgres-integration-gates/verification.md)            |
| 技术栈 Phase B  | 图谱读取切换到新实体模型，分阶段生产切换与 closeout 完成                          | [verification](tasks/data-architecture-3b-technology-stack-read-cutover/verification.md)   |
| 技术栈 Phase C  | 停止旧写入，清理 79 条旧栈边、13 个伪仓库、13 个伪收藏和 `is_reference`           | [verification](tasks/data-architecture-3c-technology-stack-legacy-cleanup/verification.md) |
| AI Provider     | 默认分析模型切换为 MiniMax M3，durable/SSE canary 与 DeepSeek 回滚演练完成        | [verification](tasks/platform-ai-7-minimax-m3-default/verification.md)                     |
| 外部资源工作区 | Web 外部资源工作区、独立分组、分页/密度切换与正文异步采集/状态读取已部署；全文检索、embedding 和多用户仍未进入范围 | [product-11 plan](tasks/product-11-external-resource-content-ingestion/plan.md) |
| Dogfood 五项整改 | 分组摘要、许可证语义、仓库生命周期、Agent 分组操作面与 HN enrichment 已部署并完成只读复核；等待真实写入/采集样本 | [verification](tasks/dogfood-2026-08-remediation/verification.md) |

## 当前生产基线

当前基线以本文顶端最近日期化记录为准；下列内容仅为历史快照。

### 2026-09-01 历史快照

2026-09-01（deploy run `33475333993`）完成 dogfood 五项整改的生产部署与只读回读：

- 目标为 PR #59 合并提交 `05aa9e192a5ca95cb49ffc628617afc0e36af83d`；`technology_stack_legacy_cleanup=false`，仅显式应用 migration `0013`，workflow 成功；
- migration `0013` 文件 SHA-256 为 `fe17db6ecf5eebdc06c77756c93b1173efb4973a90f5fac2a0ba8f8d795574ed`，与生产 journal 一致；迁移前 custom-format 备份权限为 mode `600`，`pg_restore --list` 可读；
- API、Web、Worker 均运行目标 revision，服务器工作树 clean；PostgreSQL 16 + pgvector healthy；
- SSH tunnel 未认证请求返回 `401`，Keychain 注入认证后的 health/home 只读请求返回 `200`；MCP 工具清单为 35 项，`technologyStacks` 删除影响预检可读；
- 本次未执行真实仓库 `archive`/`delete` mutation，也未重新采集仓库，因此五条 dogfood observation 继续保持 `fixed_pending_verification`；
- 未修改 DNS、证书、Nginx、凭据或同机其他站点。

历史快照（不作为当前运行基线）：2026-08-29 的 `67fc629` + migration `0012` 记录了外部资源工作区部署；更早的分组树/技术栈数据不变量仍见对应 task verification。以上均为日期化运行证据，不替代 [architecture.md](architecture.md)、[domain-model.md](domain-model.md) 或各 task verification 的稳定事实。

## 当前 handoff

- Issue #79 等待最终独立生产closeout；后续备案号公示需要单独Web发布，不在本轮偷偷重建业务服务。

- 图谱视觉升级 PR #67 已部署并完成独立发布收口；DF-20260905-001 等待用户视觉反馈。

- Dogfood 五项整改已通过完整门禁和独立 Reviewer `APPROVED` 并完成 Harness closeout；五条 observation 均为
  `fixed_pending_verification`；PR #59、migration `0013`、deploy run `33475333993` 已完成，未执行真实仓库删除或重新采集；
- Issue #54 已完成；后续 dogfood 可通过树状分组 UI/API/CLI/MCP 验证真实
  创建、移动、聚合与排序体验；
- 外部资源工作区与正文采集模块已通过 PR/CI、隔离 PostgreSQL 验证和生产 `0014`–`0016` 迁移部署；文章、论文和网站仍与 GitHub 仓库分别管理；
- `product-6-public-multi-user-hardening` 仍为 `todo`，不与 Issue #54 并行启动；
- 持久 dogfood 产品反馈自 2026-09-29 起直接创建带 `dogfood` label 的 GitHub Issue（未关闭项见 #72–#76）；[dogfood-observations.md](dogfood-observations.md) 已归档停用，仅保留历史证据；
- 自动部署的成功证据与回滚 revision 已写入 [operations-8 verification](tasks/operations-8-proxy-independent-deploy/verification.md)；后续性能优化不得恢复服务器侧 `git pull/docker pull`。

## 更新规则

- 只保留当前状态、日期化验证摘要、完成结果与下一 handoff；
- 稳定设计写入对应规范，详细 review/receipt 写入 task verification，历史过程由 Git 保存；
- item 状态只通过 checklist 和 `harnessctl` 更新；
- `harness-state.json` 只由 Harness runtime 派生，不手写成第二来源。
```

## Current Review Content

```md
# 最新发布审查指针

- Task: graph-3d-release
- Decision: APPROVE（2026-09-06 UTC）
- 唯一正文：[生产 closeout 审查](../tasks/graph-3d-release/closeout-review.md)
- 发布回执：[verification.md](../tasks/graph-3d-release/verification.md)

本文件仅为导航；生产发布关闭不表示用户已认可最终审美或已验证稳定 60 FPS。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
