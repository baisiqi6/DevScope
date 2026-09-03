# 外部资源正文采集模块

## Item

- Checklist item：`product-11-external-resource-content-ingestion`
- 风险模式：`high-risk`（外部网络抓取、SSRF、持久化状态、Worker 任务与 schema 变更）
- 依赖：`product-10-external-resources-workspace`
- 当前阶段：Phase 0/1/2/3/4 已通过独立复审，模块本地实现完成；生产迁移/部署不在默认授权内

## 目标

在不改变现有 `preview_only` 默认路径的前提下，为 `article`、`paper`、`website` 增加显式触发的正文采集最小闭环：安全请求、HTML/PDF 解析、持久化状态、幂等任务、失败语义和 API/Client/CLI/MCP/Web 状态入口。

## 产品边界

- 保存外部资源仍默认为 `preview_only`；正文抓取必须显式操作。
- 正文资源继续独立于 GitHub 仓库，不进入仓库采集、Trending、Radar 或关系图谱管线。
- 本阶段先完成采集与状态可观测性；全文语义搜索、跨类型混合分组、定时刷新和多用户鉴权另立范围。
- 生产迁移、生产部署、DNS/证书/Nginx/凭据变更另行授权。

## 安全要求

- 只允许 `http`/`https`；拒绝 URL 用户名/密码、loopback、私网、link-local、云 metadata、IPv6 mapped private 地址。
- DNS 解析和每次重定向都重新校验地址，拒绝解析后地址漂移；限制重定向次数。
- 请求连接/整体超时、响应头、压缩展开、响应体字节数、HTML/PDF 页数和解析 CPU/内存均有界。
- 仅接受明确允许的 HTML/PDF content type；不执行脚本、不上传 cookies/Authorization、不跟随页面内资源。
- 记录脱敏错误类别和状态，不记录正文外的敏感请求头；失败必须可重试且不覆盖已有成功内容。

## 实施阶段

1. **Phase 0：现状与威胁模型**（complete）
   - 复用现有 `external_resources` 状态字段和 Worker 任务边界，确认依赖/锁版本。
   - 冻结 SSRF、超时、大小、类型、重定向和许可证/robots 策略；补测试 fixture 契约。
2. **Phase 1：抓取与解析核心**（complete，独立 Reviewer `APPROVED`）
   - 实现 URL 安全校验、受限 HTTP client、HTML 正文提取和 PDF 解析适配器。
   - 统一 `parameter_error`、`security_rejected`、`transient_failure`、`unsupported_type`、`parse_failure`、`unknown` 语义。
3. **Phase 2：持久化与 Worker**（complete，独立 Reviewer `APPROVED`）
   - 设计独立正文/分块表或等价最小模型；状态转换 `not_requested → pending → processing → completed/failed`。
   - 已落地 `external_resource_contents`、`0014`–`0016` migrations/rollback、稳定 job key、lease-authoritative claim、stale takeover、条件写回和错误脱敏。
   - 隔离 pgvector PostgreSQL 重放 `0000..latest`：DB 集成 62 项、Worker stale takeover 集成 1 项；DB/Worker typecheck 与 diff check 通过。
4. **Phase 3：API/Client/CLI/MCP/Web**（complete，独立 Reviewer `APPROVED`）
   - 增加显式 request-content、status、retry/read-only 查询；保留 preview-only save 契约。
   - Web 先显示状态和失败原因，避免自动触发外部抓取；所有输出经 shared Zod schema。
   - 已接入 API/Client/CLI/MCP/Web；Web 仅按钮显式触发，正文查看展示前截断至 50,000 字符；列表不携带正文。
   - API111、Client20、CLI23、MCP10、Web24 测试及相关 typecheck/build 通过；独立 Reviewer `APPROVED`。
5. **Phase 4：门禁与 review**（complete，独立 Reviewer `APPROVED`）
   - 单元/HTTP fixture/SSRF 回归、真实 PostgreSQL、全量 lint/typecheck/test/build。
   - 独立 Reviewer 只读复核；通过后才评估生产迁移和部署。

## Verification

- 全仓库 `corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build` 通过；lint/build 仅有既有 warning，无 error。
- 隔离 `pgvector/pgvector:pg16` 重放 `0000..latest` 迁移通过；DB 集成 62 项，Worker lease-expiry/stale takeover 集成 1 项通过。
- Phase 0/1、Phase 2、Phase 3、Phase 4 均经独立 Reviewer `product11_external_resource_reviewer` 审批。
- 生产部署已执行：PR #62 合并提交 `15d8abf7a26257bc08d7680c7fa9cdadb9c58101`，部署 run `33722303660`，工作流显式启用 `apply_database_migration=true`；备份、`0014`–`0016` 迁移、三服务重建和 Nginx 校验均成功。
- 生产只读复核：服务器 HEAD 与三服务镜像 revision 均为目标 SHA；迁移 journal 含最新三批 hash，`external_resource_contents`、processing claim 列、用户 FK/类型/大小约束存在；隧道未认证 `401`、认证 health/home `200`，API/Worker 近期日志无错误。尚未触发真实外部资源正文抓取。

## Follow-up

- `readContent` 当前服务端最多返回约 1MB，Web 端展示前截断至 50,000 字符；未来可按需要增加分页，不阻断本模块收口。
- 全文检索、chunks、embedding、定时刷新和多用户鉴权不属于本模块。

## 验收标准

- preview-only 回归不变，显式 content 请求能观察完整状态机。
- SSRF、DNS/重定向、超时、响应大小、类型、压缩和解析边界均有可重复测试。
- HTML/PDF fixture 能提取受限正文；空内容、乱码、损坏文件和不支持类型有明确失败语义。
- 同一资源并发触发不会重复写入或状态倒退；重试不覆盖旧成功正文。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和隔离 PostgreSQL 集成通过。
- 生产未授权前不执行 migration/deploy；生产后复核包含 SSRF 拒绝、状态、日志脱敏和资源预算。

## 未授权动作

- 生产数据库迁移、生产部署、真实外部资源大规模抓取、正文全文索引、DNS/HTTPS/Nginx/凭据修改。
