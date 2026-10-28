# Issue #79 独立计划审查

- Verdict: **APPROVE**
- Reviewer: `https-plan-reviewer`
- 日期: 2026-10-28
- Context mode: `limited-fresh`。以目标、授权边界、canonical plan、exact packet 和当前配置为输入，未沿用此前 verdict。
- 审查范围: 计划边界、安全性和可实施性；不是实现审查、发布批准或生产验收。
- Plan SHA-256: `e6b96ef88eef9a035f535f868766423fe656211969740eccaf0b619d8fdc1495`
- 实际读取的 `current/review-packet.md` SHA-256: `fa959ba837f05679b1b0b36a292fa03ee21e92837d2801188a538d09c656f5e3`

## 结论与 findings

无阻塞性 P0–P3 finding。计划对独立 HTTPS、保留 Basic Auth、免费证书与自动续期给出直接方案，未吸收多用户鉴权、业务升级、数据库迁移或其他站点修复。允许进入本地实现；生产 mutation 仍须经过计划要求的真实 diff/测试审查、备份和运行前置检查。

## 独立核对

- 已读取本 worktree 的 `AGENTS.md`、scope、progress、current/task_plan、architecture、runbook、canonical plan、exact review packet、当前 checklist，以及既有 Nginx/Compose 配置。HEAD 确认为 `7cd6c1caa5de1240d9e0a4342c8d37be47e7aeee`。
- 实际 Compose 已整目录 readonly 挂载 `nginx/conf.d`，因此新增 challenge webroot/片段和公共 `.inc` 可通过共享 Nginx reload 生效，无需为新增 mount 重建共享容器。
- 现有四类业务 location 使用 wildcard auth include；计划明确要求新 TLS 入口在认证配置缺失时 fail closed，不能把现有 wildcard 空匹配语义原样当成安全保证。
- 独立 TLS project 只发布 443、复用现有 Docker network，不含共享 Nginx、业务服务、数据库或 `depends_on`；续期 wrapper 只校验并 reload TLS edge。该边界与不重建原五容器的约束一致。
- HTTP-01 bootstrap、隔离 staging state、正式签发、验证 TLS、最后启用精确域名 redirect 的顺序合理；IP/loopback 和原 tunnel 保留，认证请求限制为安全传输。
- 证书完整目录 readonly mount 可保留 `live` 到 `archive` 的 symlink 可见性；失败传播、dry-run、timer 独立运行、失败后保留有效证书，以及仅撤销本轮新增入口的回滚均已纳入计划。
- `harness-state.json` 和 progress 含旧快照，未作为当前 item authority。当前 checklist 为 `issue-79 / review_requested`；packet 的生成前 Item Snapshot 中 `running` 不替代 checklist phase。实际 plan hash 与 packet metadata 一致。

## 实现与发布审查的核对项

以下细化现有 acceptance，不是要求另起范围或额外架构。

1. **ACME 例外必须只服务 token 文件。** 用专用 webroot 限定 `/.well-known/acme-challenge/`；不可把整个 `conf.d`、认证文件或证书 state 作为公开静态根目录，不应 proxy fallback 到应用。除正常 200/缺失 404，还应检查相邻 `.well-known` 路径、目录浏览及编码路径不能读取配置或绕过业务认证。HTTP-01 的公开入口固定在 80，计划所选 webroot 方式符合官方机制。[Let's Encrypt 文档](https://letsencrypt.org/docs/challenge-types/)
2. **认证负向测试要真实触发。** 分别移除 auth include、缺失 htpasswd、使用错误凭据，验证新 TLS 不能匿名到达 Web/API；四类路由以及静态资源都受保护。共享 HTTP 的提取行为、SSE 与 WebSocket 不得被改变。空 wildcard 本身不是 fail-closed 证据。
3. **续期成功与证书更换分开记录。** `renew` 返回 0 也可能只是未到续期时间，`--dry-run` 默认不执行 deploy hook；因此测试必须单独证明 reload 路径和失败传播，并核对磁盘证书与实际 TLS 呈现证书，不把 service exit 0 写成已发生真实续期。[Certbot 文档](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)
4. **共享路由验收保留原 URL/Host 和路由归属。** 输入材料记载 `/supplier-search/` 与 `/billmapper/` 均已是 502；本 Reviewer 未连接生产复测，这属于 Operator 提供的基线，不是独立 runtime 事实。生产 preflight 应保存原请求的 scheme/Host/path、共享配置文件摘要和路由命中依据，之后按相同请求比较；相同 502 不能单独证明未改路由。若现有消费者实际使用两个目标域名上的共享路径，应在 redirect 前澄清该路径是否属于本轮切换范围，不可默默改投 TLS Web 上游。

## 未验证与权限边界

- 本轮未执行 Docker 集成测试或 `pnpm lint/typecheck/test/build`：尚无实现 diff，相关验证属于后续 Worker 与实现 Reviewer 门禁。
- 未验证当前生产 DNS/备案状态、443 可达性、镜像 digest、容器身份或两条共享路由；计划中的现况仍须按生产 preflight 刷新。
- 未执行 SSH、证书签发、生产配置更改、commit、push、merge 或 deploy。
- 唯一写入为本审查文档和获准的 installed Harness `review-result`；verdict 不授予任何新增生产 authority。
