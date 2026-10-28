# Issue #79 whole-branch 发布前独立审查

## Verdict

**APPROVE — 当前分支代码和操作方案可合并；完成 required checks、合并及发布前条件后，可由持有既有授权的 Operator 进入 Task 2 受控步骤。**

本 verdict 不是部署授权，也不是 Issue #79 最终 closeout：真实 ACME、公网可信 TLS/认证、服务器续期与 timer、原五容器及共享路径不变量尚未验收。不得据此标记全局 done 或声称 HTTPS 已上线。

- Reviewer：`https-final-reviewer`；日期：2026-10-28。
- Context mode：`limited-fresh`；以用户目标、canonical plan、真实全分支 diff、当前源码和必要原始日志独立判断，不沿用历史 Reviewer 的 APPROVE 作为证明。
- Base：`7cd6c1caa5de1240d9e0a4342c8d37be47e7aeee`。
- Head：`e251d3b03c75a595a2057e11592264c729f9cbb6`；4 commits，27 个变更文件。
- Canonical plan：`docs/project-harness/tasks/issue-79/plan.md`。
- 实际阅读 packet：`docs/project-harness/current/review-packet.md`；exact bytes SHA-256：`26da7200607e52b25f559135a429c98c7b3aec01008f8b4da90c4701b24ccbac`。
- 独立核对 review package 去掉说明头后的 diff 与 `git diff --unified=10 BASE..HEAD` 相同，SHA-256 均为 `07ae745ea1deaa9ff390a883cbc138f4fbb992d25b9c1c251ab42a9d30b898ca`。开始和报告写入前工作树均 clean，HEAD 未变。

## 实质 findings

无 P0、P1、P2 或 P3 finding；没有需要阻塞本轮代码合并的最小反例与修正项。未把尚待生产执行的验收项目误报为产品缺陷，也未把既有共享站点 502、既有 lint warnings 或既有 integration skip 归因为本次新增回归。

## 判断依据

### Correctness 与安全边界

- `docker-compose.https.yml:4` 的独立 edge 只发布 443，加入显式 existing external network；不包含原业务/数据库/共享 HTTP 服务或 `depends_on`。Certbot 为 profile-gated one-shot，不加入业务网络、不挂 Docker socket；必需变量和 bind 源缺失失败，完整 `/etc/letsencrypt` 目录挂载覆盖 live→archive 轮换。
- `nginx/conf.d/default.conf:15` 至公共 `devscope-locations.inc` 的提取保留原四类代理行为。TLS main 精确加载现有认证片段，缺失不能因 wildcard 空匹配而匿名开放；未知 SNI 拒绝，目标域名启用 TLS 1.2/1.3，无 HSTS 锁定。SSE、WebSocket 和真实 `$scheme` 转发保持原边界。
- `nginx/https/acme-location.conf:3` 只开放专用 webroot 内单段 token，拒绝编码/多级路径与 symlink；并非公开 conf.d。`http-domain.conf:2` 的精确域名 server 同时保留 shared routes 和 `client_max_body_size 10m`，只有 DevScope fallback 308；旧 IP/loopback/tunnel 的默认 HTTP server 不强制跳转。
- `.github/workflows/deploy.yml:330` 在原共享 Nginx 校验/reload 后调用定向 TLS helper，所在远程脚本有 `set -euo pipefail`。`scripts/https-reload-if-present.sh:15` 只有成功查询后确实不存在才 skip；停止、查询/inspect、配置检查或 reload 失败均非零，且不会创建/启停/recreate 代理。正常 API/Web 发布不依赖下一次每日续期才恢复静态 upstream。
- `scripts/https-renew.sh:16` 显式固定 project/file/env 并清理 Compose/TLS 环境覆盖；renew 失败不继续，dry-run 不 reload，普通路径先 `nginx -t` 再 reload。两个 systemd units 将任务放在服务器而非本机登录会话，timeout/失败日志/残留 one-shot 诊断和有效旧证书保留路径有明确说明。

### Maintainability、范围和操作方案

- 没有引入第二套代理路由、数据库模型、鉴权系统、调度器或业务 API 改动；核心产品变更是小规模配置与两个定向脚本，测试和中文操作文档承担其余体量。
- `runbook.md` 的 HTTPS 专节明确区分 bootstrap、独立 staging state、正式证书、外部 TLS 验收后 redirect，以及续期和精确回滚。备份、镜像 checksum/离线传输、原五容器身份、共享配置摘要、同 Host/path 对照和不带凭据公网 HTTP 的约束齐全。
- 常规应用发布与本次只新增 TLS 的首装流程被明确区分；首装不触发会重建应用的常规 deploy。未来 main 单文件 bind 的 inode 替换需单独授权并只重建 TLS 的限制已写入手册，没有把普通 reload 误说成可更新该挂载。
- 新 edge 使用指定 immutable Nginx 1.30.6，旧 HTTP 1.29.8 仅保留兼容、不升级。本轮核对的是代码/记录中的固定版本与测试证据；未自行重新判定上游最新版本或旧共享实例的漏洞适用性。
- Harness checklist 当前 `issue-79` 为 `doing`、authoritative workflow 为 `review_requested`；plan 的 Task 2 仍未勾选。packet/pointer 内生成时快照的旧 workflow 字样不替代 checklist authority。过程报告中的阶段性历史结论不作为本次批准依据。
- 已检查 SDD ledger，无被隐去的开放产品 finding。备案号 `粤ICP备2026167321号` 仅按用户提供原文记录；页脚公示明确留待另一 Web 发布，本轮未声称已公示。

### Testing 与证据等级

- 本人阅读全部 `scripts/test-https.py`：真实 Docker/Nginx 请求覆盖认证失败/成功、上游 scheme、SSE 首包、WS 101、ACME 200/404 和越界拒绝、两域名 redirect、共享路径切换前后真实 2 MiB POST 及超过 10 MiB 的 413、缺认证/证书 fail-closed、磁盘 symlink 轮换与实际 served certificate 区分、TLS 版本，以及 upstream A→B 后真实 502→helper→200 且 edge ID 不变。
- wrapper 和 workflow 测试是受控 Docker/timeout doubles 的实际执行与参数/退出断言；不将它们混同真实 ACME、真实 GNU timeout 到时或 systemd 运行证据。真实 edge reload 和 DNS/IP 变化由独立 Docker 用例验证。
- 有界回读 `.planning/operator-{lint,typecheck,test,build,https}.log` 与 `.planning/https-fix2-compat-1298.log`：四门禁成功摘要、新镜像 11/11（15.675s）、旧镜像 11/11（15.176s）与提交中的 claims 相符。四门禁包任务使用缓存；18 warnings、1 既有 skip、实时 pipeline 21/21 的边界保留，不描述为全量冷跑。
- 本 Reviewer 新执行 `bash -n scripts/https-renew.sh scripts/https-reload-if-present.sh`、`git diff --check BASE..HEAD`、HEAD/clean-tree 核验及 diff 内容哈希核对，均通过；未重复跑已覆盖的整套测试、未访问生产、未签发证书。

## 必须保留的后续门禁

Operator 仍须按 canonical plan 完成 PR/required `quality` 与真实 PostgreSQL `integration`、合并及精确提交传输；生产重新 preflight/备份后才逐阶段执行。两域名公网可信证书与认证读取、ACME dry-run、systemd service/timer、容器 ID/image/StartedAt、共享路由配置和同 Host/path 请求、旧 tunnel 均需真实 receipt。云 443 受阻或账号权限不足时按计划暂停，不从本 verdict 推导新增权限。

最终必须再对实际生产证据进行独立 closeout。生产 revision 仍为 `791ebab9fd68f0e6866631d6450edec78134e660`、尚无 production mutation 是本轮 Operator 预检记录；本 Reviewer 未重新远程验证，不将其升级为亲自实测事实。
