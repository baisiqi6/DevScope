# Issue #79 独立生产 closeout 审查

- Verdict：**APPROVE**；无 P0–P3 阻塞 finding。
- Reviewer：`https-production-reviewer`；审查日期：2026-10-28 UTC。
- Context：`limited-fresh`，新 Reviewer 从当前 canonical plan、exact packet、真实 diff 与生产事实判断，不沿用旧 APPROVE。
- 目标：PR #80 配置发布 `e577c1e9eb9045ed74a1ed725516d1f19564a810`；范围仅本次独立 HTTPS、原访问保护、自动续期与隔离不变量。
- 实际完整阅读的 packet：`docs/project-harness/current/closeout-packet.md`，SHA-256 `5d40ca9c41f3281f8ff82eaf7d834deb7695a9c760ffe67fc428e27684ba6587`。
- Canonical plan SHA-256：`2d6e11a63f08d0f3a24073c9b9d6acf475486ea80e2be88ae0847a44226ac586`，与 packet freshness metadata 一致。按 installed `long-running-project-harness` 的 events-and-packets / reviewer-strategy 执行；本 verdict 不代替 Operator mark-done。

## 独立核验的现场事实

本轮通过有界只读 SSH、匿名 HTTP/HTTPS 与白名单日志提取核验；未读取 Keychain、发送认证、读取密钥/账户/认证文件正文，也未执行生产 mutation。

1. 2026-10-28T18:42:19Z 起的服务器核验：HEAD 为目标提交，`git status --porcelain` 为空。原 `nginx/api/web/worker/postgres` 的 `.Id/.Image/.State.StartedAt` 与本轮备份 `containers.txt` 逐字 `cmp` 成功；五者 running，PostgreSQL healthy。七项 `protected-files.sha256` 检查全部 OK，覆盖原 `.env`、Nginx main、shared routes、auth conf、htpasswd 和两个原 Compose，未输出敏感内容。
2. 独立 TLS 容器仍为 `b679c7a2e9a0831319b567ecae2dc754e40cb3129b0c4373fefed8080dcf8bb4`，StartedAt `2026-10-28T18:19:17.920730966Z`，running、restart=0，只发布 TCP 443；三个配置/证书 bind 均只读，没有 Docker socket。Nginx 与 Certbot 镜像均为计划批准的 amd64 内容 ID，任务专属版本 tag 存在。
3. 对 root/www 分别独立建立系统可信 CA 校验的 TLSv1.3 连接（未关闭校验），issuer 为 Let's Encrypt YE2，SAN 同时包含两域名；线上与磁盘公开证书指纹一致：`52:90:1E:C0:AF:6C:6F:3E:57:F5:BA:9D:48:F0:27:ED:7F:3E:10:F9:79:CE:96:DA:CC:9E:C3:A9:0C:97:16:6A`。有效期至 `2027-01-26T17:17:17Z`。
4. 两域名各五类匿名请求（首页、静态资源路径、`/api/trpc/health`、`/trpc/health`、`/api/agent/`）均 401。各域名 HTTP 首页、带 query 的 tRPC 与 SSE 路径均 308，Location 精确保留同域/path/query；缺失 ACME token 返回 404。旧本机 SSH tunnel `127.0.0.1:18080` 匿名仍为 401，不跳转。最初 Reviewer 探针误把端口拼进 Node hostname，已用正确 URL 的 curl 独立复核；该本地探针错误不是生产故障。
5. 四种 HTTP Host（loopback、原 IP、root、www）× 两共享路径的八组结果与备份逐字 `cmp` 成功；外部两域名共享路径同为既有 502、无 Location。结合共享配置摘要不变及新域名片段与已审代码 `cmp` 相同，证明本次未改变其路由归属；**不证明两个旧站点健康**。
6. 独立读取服务器 Certbot `letsencrypt.log.1` 的白名单行：18:21:30.139 记录随机延迟 360.520 秒，18:27:32.919 开始模拟 root/www 续期，18:27:46.396 明确 `all simulated renewals succeeded`。这是真实 ACME dry-run 证据，不是 wrapper mock 或未来实际换证。
7. systemd 当前 `Result=success`、`ExecMainStatus=0`，执行用户/组为 devscope、附加 Docker 组、超时20分钟；timer 为 enabled/active/waiting、Persistent=yes、每日00/12时加最多1小时随机延迟，下一次 `2026-10-29T04:27:15Z`。两个已安装 unit 与仓库文件 `cmp` 相同。当前 `show` 的主进程 timestamps 为空，因此没有单凭默认 success/status0 推断执行：另独立读取 journal 时间和白名单 MESSAGE，确认 18:29:31.936Z 启动、18:29:36.582Z `No renewals were attempted`、18:29:37.146Z nginx 配置检查成功、18:29:37.334Z Finished。**证书尚未到期，本次没有实际换证。**
8. runtime 配置目录和正式/staging state 根目录均700，runtime env为600，私钥 target为600/root:root（只做 stat）。服务器专属 ACME/HTTP-domain 片段与仓库模板 `cmp` 相同。TLS 容器 ID/StartedAt 与提供的定向 helper 执行前后回执一致；本 Reviewer 未再调用 helper 或 reload。

## 已审回执与证据边界

- 完整阅读 [verification.md](verification.md)、当前 runbook（含离线平台 ID、SSH stdin、随机延迟和目录权限恢复）及配置/脚本真实 diff；本地产品文件与上述合并目标无差异。独立项目仅含 TLS edge 与 profile-gated Certbot，原 location 提取保持代理行为；正常应用发布已接入固定目标 reload helper，避免新业务容器地址变动后 TLS 保留旧 upstream。
- `.planning/live-https-final.log` SHA-256 为 `4bf3371ee8b15b0d4f2f39efbe990fd53fd55e176ba3807aecc4d7f721988b8c`，已完整读取其脱敏 JSON。两个域名均记录认证首页200、client health=ok、前端同源 API=ok、认证只读列表schema验证成功且非空、各17个实际页面引用资源200。它们是 **Operator 提供的已执行认证读取回执**，本 Reviewer 不获取凭据、不声称独立重跑认证业务读取；公开证书/401/跳转/隔离元数据则已独立验证。
- 四项工程门禁、真实 PostgreSQL required CI 与先前实现审查属于已留存工程证据，本轮没有重跑，也没有用它们替代生产检查。无业务镜像变更由容器 image/StartedAt 比对支持；未执行数据库或 DNS 变更由本轮 scope、发布 diff 和操作回执支持，本轮不扩展为数据库内容或 DNS 历史审计。
- packet 中旧 graph-3d-release review 指针及其他任务历史只是上下文，不构成 Issue #79 审批；本报告与 exact-packet verdict 才是本轮生产审查。

## 恢复偏差判断

- 离线 load 后 registry/index 名称缺失：实际运行仍固定批准的 amd64 内容，且专属 tag 防止普通 dangling-image prune 清除 one-shot 镜像。未换用 latest，恢复合理；现场 ID/tag 已核对。
- www 首次 CAA SERVFAIL：回执表明先核对权威及两公共递归解析 NOERROR，再做一次有界重试，未改 DNS 或降低校验；当前正式可信链已独立验证，不将此前失败当作当前故障。
- SSH stdin 消耗：前置检查 exit0 不等于 up 执行；Operator 用外部 ECONNRESET/无 listener 发现，并改为脚本文件及 stdin/devnull 执行。当前真实容器、监听映射与公网 TLS 支持恢复完成，runbook 已记录。
- 两 state 根目录初为755：已定点收紧700，私钥600且未读取内容；本轮现场权限确认支持修复完成。未对无关目录递归变更。

## 结论与保留范围

本次目标、运行事实、回执与隔离边界一致，无需阻塞修正，可以由有权 Operator 按 exact-packet gate 收口。APPROVE 不授予新生产权限，也不批准其他项目、原五容器重建或新增发布。

备案号 `粤ICP备2026167321号` 的页脚公示需独立 Web 发布；已登录浏览器 GUI 回归未做，不能以 HTML/API 结果替代全站 GUI 验收。旧共享 HTTP 安全维护、两既有502站点、未来真实到期换证和外部告警均不由本次成功证明，继续保持独立范围。
