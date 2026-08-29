# 公开多用户产品加固

## Item

- Checklist item：`product-6-public-multi-user-hardening`
- 当前状态：`doing`（Phase 0：范围与威胁模型）
- 风险模式：`high-risk`
- 依赖：`data-quality-5-postgres-integration-gates`、`data-architecture-3c-technology-stack-legacy-cleanup`

## 当前结论

DevScope 当前仍是单用户私有服务。`publicProcedure` 不是鉴权；当前用户解析器、Nginx Basic Auth、HTTP 隧道和回环绑定只能作为私有访问保护，不能直接升级为公开多用户方案。

在开始任何 schema、路由或部署修改前，必须由产品负责人明确确认公开运营边界（数据处理者/运营主体、HTTPS 证书/域名/备案、配额与更长法定留存要求）。邀请制、GitHub OAuth 身份、无计费、会话/PAT 方案和本计划的数据生命周期默认值已经冻结，不能在 Phase 1 实现时临时改写。

在 Phase 0 完成并通过独立 review 前，仍不开放公网、不执行生产迁移、不改现有 `publicProcedure` 语义。

## 已确认产品决策（2026-08-29）

- 首个公开版本采用**邀请制**，暂不开放自由注册。
- GitHub 访问令牌采用**用户级 GitHub OAuth**，不继续共用服务器级 GitHub 账号。
- 当前**不做用户计费**；配额用于资源保护和公平使用，不作为收费系统。
- 应用登录和 GitHub API 授权统一采用 **GitHub OAuth**：邀请表按 GitHub stable user ID 绑定，服务端建立自己的会话；不引入密码系统和第二个身份源。GitHub OAuth access token 仍不应进入浏览器或审计日志。
- 邀请由管理员手动发放，采用一次性 token，默认 7 天过期，并支持立即撤销；v1 选择“token 先不绑定账号，首次接受时绑定 GitHub stable user ID”，而不是允许任意账号重复使用。邀请接受后才允许建立 DevScope 会话。

### 建议的数据生命周期默认值

这是适合当前早期邀请制产品的工程默认值，不替代针对具体业务的法律意见；如运营或合规要求不同，应在 Phase 0 决策记录中覆盖它：

- **账户与用户内容**：账户存续期间保留；用户完成身份校验并请求删除后，应用主库在 7 天内删除账户、GitHub 授权令牌、仓库关联、备注、外部资源、向量、报告和任务数据。
- **备份**：采用 30 天滚动备份；删除请求不回填历史备份，备份自然轮换到期后不再包含该用户数据。发生安全事件或法定留置时，只保留必要范围并记录原因。
- **数据导出**：用户可随时发起导出；导出包使用一次性链接，默认 24 小时过期，生成的临时文件最多保留 7 天并自动清理。
- **产品审计日志**：默认保留 12 个月，仅保存主体、时间、动作、结果和关联 ID，不保存密码、OAuth token、完整请求体或资源正文。
- **安全/网络日志**：默认保留 6 个月；若适用的网络安全或监管要求更长，则按更长期限执行。安全事件、争议或法定留置期间可冻结必要日志，解除后回到常规生命周期。
- **删除凭证**：删除完成后只保留不可逆的删除 receipt/tombstone 30 天，用于幂等重试和审计核对，之后清除。

这样可以把业务数据、临时导出物、审计日志和安全日志分开管理，避免用一个过长的全局保留期扩大风险。中国《个人信息保护法》要求个人信息保存期限以实现处理目的所必要的最短时间为原则；《网络安全法》对网络日志提出不少于六个月的留存要求，实际适用范围仍需结合部署和业务资质判断。[个人信息保护法](https://www.npc.gov.cn/WZWSREL25wYy9jMi9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i)；[网络安全法](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_66129f936b9b4ca188eb073fbf2f144e.html)

## 目标

在明确公开产品决策后，把当前单用户私有服务演进为可审计、可隔离、可回滚的多用户版本：每个请求绑定真实会话用户，所有读写和后台任务都遵守租户边界，外部 API 与资源消耗具备配额和限流，关键操作有审计记录，生产入口具备 HTTPS 和可观测性。

## 分阶段计划

### Phase 0：范围与威胁模型（进行中）

- 形成公开版本决策记录和数据分类：仓库元数据、用户备注、外部资源、向量、分析报告、GitHub 凭据分别定义可见性和删除语义。
- 画出请求身份、任务身份、数据库 `userId`、GitHub 账号和审计主体的映射；后台 scheduler 的全局入口固定只处理 `system` 任务，用户手动同步走独立 owner job。
- 定义失效会话、撤销授权、账号删除、导出和数据保留策略。
- 通过独立 review 后，才允许进入 Phase 1。

当前已确认邀请制、GitHub OAuth 同时用于登录和 API 授权、手动一次性邀请（7 天过期）以及不计费；以上生命周期作为 Phase 0 的工程默认值进入威胁模型。仍需确认数据处理者/运营主体，以及是否存在更长的法定留存要求。

#### 当前实现证据（只读基线）

- `apps/api/src/context.ts` 只向请求上下文注入 `db`、`req`、`res`，没有 principal/session；`apps/api/src/trpc.ts` 的 `publicProcedure` 目前覆盖全部业务路由。
- `apps/api/src/current-user.ts` 通过“首个用户”或 `default@devscope.local` 创建用户来满足单用户运行，不能识别请求来源，也不能作为多用户身份。
- API、SSE 和 Web 代理没有应用会话层；生产当前依赖 Nginx Basic Auth，API/Web/PostgreSQL 仍绑定回环或内部网络，Nginx 配置只有 HTTP `listen 80`。
- 路由按授权性质可先分为：健康/就绪检查；用户读写（仓库、分组、搜索、报告、图谱、外部资源）；用户触发的后台任务（采集、分析、图谱、Trending/Radar）；系统任务/维护接口（identity backfill、scheduler 状态）。它们不能继续共享一个无区分的 `publicProcedure`。

#### 冻结中的 v1 身份与邀请契约

1. 管理员在受保护的运维入口创建邀请；服务端生成至少 256-bit 随机 token（base64url），只保存带服务端 pepper 的 hash、`expiresAt`、`revokedAt`、`consumedAt` 和 `boundGithubUserId`。明文只在创建时显示一次，不写日志、数据库或 URL query。
2. 接受流程原子地校验 hash/过期/撤销/消费状态；首次接受把 token 绑定到回调返回的 GitHub stable user ID 并标记 `consumedAt`。已绑定邀请与其他 GitHub 账号不匹配时拒绝，不能转移；IP 和 token hash 均需限流，避免枚举和重放。
3. GitHub OAuth callback 使用固定 redirect allowlist、`state`、PKCE 和一次性 code；服务端交换 code 后只保存加密/可轮换的 provider token。scope 固定为 `read:user`、`user:email`，Following 采集按需增加 `user:follow`，不能把 token 返回浏览器。
4. Web 使用 opaque server session：至少 256-bit 随机 session ID 只保存 hash，登录、账号切换和权限变化时 rotation；绝对 TTL 30 天、idle TTL 7 天，logout/revoke 立即失效。Cookie 设 HttpOnly、Secure、SameSite=Lax；状态变更请求要求 CSRF token/Origin 校验。
5. CLI/MCP 不复用 Basic Auth，也不把 GitHub token 当 DevScope token。v1 使用用户在 Web 设置页生成的可撤销、可过期 opaque personal access token（服务端只存 hash，默认 `read`，需要写入操作时显式授予 `write`）；CLI/MCP 通过 `DEVSCOPE_TOKEN` 注入，后续再评估标准 OAuth device flow。
6. 每个请求由统一 session/token adapter 解析 `subjectId`，路由只从 context 获取当前用户，不接受 body/query/header 中的 `userId` 作为权限依据。
7. Worker job payload 保存 `ownerUserId` 或显式 `system` 主体；用户任务执行时按 `ownerUserId` 查找有效 GitHub credential，撤销/过期后进入 `blocked_auth` 或可重试终态，不继续使用旧 token。scheduler 创建全局 Trending/Radar 任务时使用 `system` 主体和独立系统 credential，不再伪装成默认用户。
8. 管理员 bootstrap 通过现有 SSH/运维入口一次性执行并写入审计 receipt，不由公开 HTTP 请求或固定环境变量自动创建；v1 单独建模 `user.role`（`member|admin`），管理员 role 不能仅由 GitHub 用户名或客户端输入决定。`system` 是不对应人类登录的后台主体，不能通过普通 session 获得。

#### 已冻结的 procedure 主体与 OAuth 权限

- `greet` 在 Phase 1 前删除或显式关闭，不进入公开业务 API；`analyzeRepository` 与 `semanticSearch` 均要求 `authenticated`，分别按当前用户的 GitHub credential、仓库可见性和向量租户边界执行，并纳入配额/审计。
- `startRadarSync`、`startTrendingSync` 及其 status procedure 只保留用户手动触发的 `authenticated + owner` 版本；定时全局同步使用独立的 `system` worker 入口和 system credential，不让 scheduler 调用用户 procedure 冒充用户。
- v1 GitHub OAuth scope 冻结为 `read:user`、`user:email`；采集 GitHub Following 时额外请求 `user:follow`。不请求 `repo`、`delete_repo` 或写权限。拒绝 `user:email` 不阻塞登录，使用 GitHub stable ID/login；拒绝 `user:follow` 允许登录但将 Following 采集标记为 `blocked_auth`，不得静默降级为服务器级 token。
- 管理员操作只通过受保护的 SSH/内部管理入口或后续 `adminProcedure`：`invite.create`、`invite.revoke`、`admin.users.list/disable`；用户自己的 `personalAccessToken.create/list/revoke/rotate` 要求 `authenticated`，每次都写审计事件并隐藏明文 token。公开 HTTP 在 Phase 1 不提供 bootstrap 管理接口。

该契约仍需在进入 Phase 1 前由独立 review 审核，尤其要确认邀请撤销、OAuth callback CSRF/state、session rotation、token 加密存储、API token scope、后台任务越权和限流测试。

#### 初版路由授权矩阵（设计基线）

| 类别 | 当前路由范围 | 目标主体 | 设计要求 |
|---|---|---|---|
| 健康检查 | `health`、未来 readiness | `anonymous`（仅最小状态） | 不返回用户、GitHub、数据库详情；生产由边缘层限制频率 |
| 登录/邀请 | OAuth start/callback、invite accept、logout | `anonymous` → `authenticated` | callback 校验 `state`/PKCE；邀请消费一次；session cookie 轮换 |
| 用户读写 | `getFollowing`、仓库列表/详情/分组、外部资源、搜索、报告、图谱 | `authenticated` | 只从 context subject 推导 `userId`；禁止输入覆盖身份 |
| 用户任务 | `collectRepository`、健康分析、图谱重建、Radar/Trending 手动同步 | `authenticated` | 任务 payload 固化 owner；配额、并发和取消策略先于开放写入 |
| 全局只读 | Trending 快照等可共享内容 | `authenticated`（默认） | 明确定义是否跨用户共享；不能因为“只读”绕过会话 |
| 系统维护 | identity backfill、迁移/cleanup、scheduler 管理 | `system/admin` | 不暴露给普通用户；使用独立凭据或内部网络入口并记录审计 |
| 示例/调试 | `greet`、未归类实验接口 | `disabled` | 公开版前删除或显式关闭，避免留下匿名业务入口 |

这张矩阵是 Phase 1 的测试清单，不改变当前路由行为；管理员角色、system 主体和 system credential 已在本 Phase 0 契约中冻结。

#### Phase 1 路由清单与外呼边界

以下清单按当前源码中的 procedure 和自定义 HTTP wrapper 展开，作为授权实现与负向测试的逐项门禁。名称以源码为准；新增 procedure 必须在同一批次补入本表。

| Router / procedure | 目标主体 | 外部副作用或敏感数据 | 必测拒绝条件 |
|---|---|---|---|
| root：`getFollowing`、`getRepositoryStats`、`getRepositories`、`getRepository`、`getRepositoryHealthReports`、`getReleases` | `authenticated` | GitHub 外呼；用户仓库关联、统计或报告读取 | 未登录、伪造 `userId`、跨用户资源 |
| root：`collectRepository`、`updateRepoNote`、`startHealthAnalysis`、`getAnalysisStatus`、`getHealthReport`、`getEmbeddingStatus`、`syncEmbeddingStatus` | `authenticated` | 写入仓库/备注/任务；GitHub、AI、embedding 外呼 | 未登录、非 owner、过期/撤销 GitHub credential、重复提交 |
| root：`health`；未来 readiness | `anonymous`（最小状态） | 只读运行状态 | 不得泄露用户、令牌、数据库详情 |
| root：`greet` | `disabled` | 示例接口 | 公开版前删除或显式关闭，不能保留匿名入口 |
| root：`analyzeRepository`、`semanticSearch` | `authenticated` | AI、GitHub、向量外呼 | 过期会话、跨用户仓库/向量、超额 |
| discovery：`startRepositoryIdentityBackfill`、`getRepositoryIdentityBackfillStatus` | `system/admin` | 批量回填和状态读取 | 普通用户、伪造 job 参数 |
| discovery：`getTrending`、`getRadar` | `authenticated`（共享只读） | 读取全局快照/用户候选 | 未登录；不得混入其他用户私有候选 |
| discovery：`startRadarSync`、`getRadarSyncStatus`、`startTrendingSync`、`getTrendingSyncStatus` | `authenticated` + owner（手动）；独立 `system` worker（定时） | GitHub/Search 外呼和任务写入 | 非 owner、重复/超额、scheduler 冒充用户 |
| graph：`getRepoGraph`、`startRebuildGraph`、`getRebuildGraphStatus` | `authenticated` | 图谱读取/重建任务 | 未登录、跨用户仓库、越权 job |
| groups：`getAll`、`getWithMembers`、`create`、`update`、`delete`、`reorder`、`add`、`remove`、`move`、`batchAdd`、`getRepoGroups`、`getUngroupedRepos`、`searchGroups` | `authenticated` | 分组与成员关系读写 | 非 owner、跨用户 repository/group、批量越权 |
| external resources：`externalResources.list/get/save/update/remove`；`externalResourceGroups.list/create/members/add/remove` | `authenticated` | 外部资源卡片、分组和用户保存关系 | 非 owner、未授权共享资源写入、重复消费 |
| 管理：`invite.create`、`invite.revoke`、`admin.users.list/disable` | `admin`（SSH/内部入口或 `adminProcedure`） | 邀请生命周期、账户禁用 | 普通用户、伪造 role、无审计；token 仅一次显示 |
| 用户凭据：`personalAccessToken.create/list/revoke/rotate` | `authenticated` + self | DevScope CLI/MCP token | 非 owner、已删除/禁用账户、token 明文回显；所有操作审计 |
| Fastify `/trpc/:path`、`/api/trpc/:path` | 继承 procedure | 批量 comma path 当前使用 `Promise.allSettled` | wrapper 不得绕过 procedure 鉴权；单项失败不能泄露其他结果 |
| SSE `/api/agent/workflow/stream` | `authenticated` + owner job | 长连接、任务事件和可能的敏感输出 | 未登录、非 owner job、断线后继续泄露；需连接数/生命周期限制 |
| `GET /api/workflow/status/:executionId` | `authenticated` + owner job | 返回 workflow execution 状态 | 过期会话、跨用户 `executionId`、伪造路径参数 |
| `GET /api/reports/:executionId` | `authenticated` + owner job | 返回分析报告结果 | 过期会话、跨用户 `executionId`、伪造路径参数 |

上述分类还需覆盖 custom Fastify error handler、batch 输入、SSE 重连和所有后台 worker 入口；不能只在 tRPC resolver 内做一次性检查。

#### 后台 scheduler / worker 主体矩阵

当前 `apps/api/src/scheduler.ts` 的全库扫描和进程级 `GITHUB_TOKEN` 必须在 Phase 1 前显式改成 `system` 主体，不能再调用 `getOrCreateCurrentUserId` 或伪装成首个用户：

| 入口 | v1 主体与 job 身份 | 凭据/数据范围 | 取消、删除与重试语义 |
|---|---|---|---|
| `refreshStaleRepositories` | `system`；独立 `repository-refresh` job type/key | 部署密钥中的 system GitHub credential；只更新共享 repository 快照，不写用户备注/关联 | system job 可重试；共享数据按独立 GC；用户删除不影响该 job，但不得读取已撤销用户 credential |
| `processPendingEmbeddings` | `system`；独立 `embedding-maintenance` job type/key | system embedding credential；仅处理共享仓库中待向量化版本 | provider 失败可退避重试并记录指标；不把失败归因给任一用户；共享快照仍受 GC/版本条件保护 |
| `enqueueGithubDiscovery` | `system`；独立 `github-discovery-scheduled` type/key，`source=scheduled` | system GitHub credential；只产出共享/去用户化 discovery 快照，不写 `radarCandidates.userId` | 与手动任务不共用 idempotency key；system 任务不因用户删除取消；provider 失败按 system retry |
| `discovery.startRadarSync`（手动） | `authenticated + ownerUserId`；`source=manual`，独立 `github-discovery-manual` type/key | 只使用该用户有效 GitHub credential；候选/任务结果按 owner 隔离 | 用户撤销/删除时在领取、外呼、提交前转 `blocked_auth`/`cancelled`，不继续重试 |
| `enqueueGithubTrendingSync` / 定时 Trending | `system`；`github-trending-scheduled` type/key | system GitHub credential；只写全局 Trending 快照 | 与手动 Trending 同样拆分 source/key；system retry 与用户生命周期无关 |

`GITHUB_DISCOVERY_JOB` 现有类型必须拆出 scheduled/manual 的 source 或独立 type，并分别建立幂等 key；共享 job 表仍保存 `ownerUserId`（用户任务）或显式 `principal=system`（定时任务）。worker 必须在领取、调用 provider 前、提交结果前校验主体和 credential 状态，禁止回退到 `current-user.ts`、服务器级 token 或默认用户。

Worker 的 discovery 分支必须按 `principalKind/source` 分流：`system:scheduler` 使用 system credential，写入共享的 trending/radar snapshot（候选记录不得伪造 `userId`）；手动 `authenticated` job 才读取该用户 interest profile、使用该用户 GitHub credential 并写入 `radarCandidates.userId=ownerUserId`。`defaultSearchRepositories` 等当前读取进程级 `GITHUB_TOKEN` 的路径需改为显式 credential provider；system provider 失败只影响 system job，用户 credential 撤销/删除只阻断该用户 job。

为使该主体模型能落到现有 `jobs.userId NOT NULL` schema，Phase 1 采用以下迁移契约：将 `jobs.userId` 迁移为可空的 `ownerUserId`，新增非空 `principalKind`（`user|system`）、非空 `principalKey`（用户为 `user:<id>`，系统为固定名称如 `system:scheduler`）和 `source`（`manual|scheduled|maintenance`）；约束为 `principalKind=user` 必须有 `ownerUserId`，`principalKind=system` 必须为空。现有行全部回填为 `user`，不创建可登录的 system user；唯一幂等键使用 `(principalKey, type, idempotencyKey)`，system/manual discovery 使用不同 `type/source/key`。所有查询按 `ownerUserId` 或精确 `principalKey` 过滤，禁止以 nullable `ownerUserId IS NULL` 作为“所有系统任务”的宽泛授权条件。

共享 discovery 的落表契约：新增 `githubDiscoverySnapshots`（`id`、`source`、`snapshotDate`、`fetchedAt`、查询/过滤摘要、`entryCount`）与 `githubDiscoveryEntries`（`snapshotId`、`rank`、`fullName`、公开元数据、证据和评分）两张 system-owned 表，唯一键至少覆盖 `(source, snapshotDate, queryFingerprint, fullName)`。scheduled system worker 只写这两张表；`radarCandidates` 继续保持 `userId NOT NULL`、唯一键 `(userId, fullName)`，只允许手动 owner job 写入。`getRadar` 返回结构上分开 `sharedSnapshot` 与 `userCandidates` 两个集合：共享榜单可按 authenticated 读取，候选必须按当前 `ownerUserId` 过滤，不能把共享条目伪装成用户候选或混用用户评分。共享 discovery snapshot 默认保留 90 天，entries 随 snapshot cascade 删除；保留期可按运营/成本调整但不受单用户删除影响。Phase 1 迁移需包含新表、外键级联、GC/索引和读取 API，禁止通过插入保留 system user ID 绕过 NOT NULL 租户约束。

#### 数据生命周期与删除/导出契约（Phase 0 基线）

删除和导出按“用户拥有的数据”与“共享事实数据”分离，避免删除一个账户误删仍被其他用户引用的 GitHub 元数据：

| 数据范围 | 归属/可见性 | 删除请求语义 | 导出语义 |
|---|---|---|---|
| `users`、`authIdentities`、`sessions`、`githubCredentials`、邀请接受关系 | 用户/认证私有 | 会话与 credential 立即撤销；主记录在 7 天内物理删除；邀请 token 立即不可用 | 导出身份基本信息和授权元数据，不导出 token、secret、session 原值 |
| 用户仓库关联、备注、分组/成员关系、外部资源保存关系、用户报告/向量、用户候选、用户任务/审计引用 | 用户拥有 | 7 天内删除；任务先取消/过期，删除流程可安全重试且幂等 | 导出用户记录及共享仓库的稳定 ID/URL 引用，不复制其他用户私有字段 |
| `repositories`、技术栈实体、全局 Trending/Radar/Discovery 快照及其他去用户化缓存 | 共享或 system-owned | 不随单个用户删除；Discovery snapshot 默认 90 天、entries cascade；其他共享缓存按独立 GC/保留策略清理；仍有用户引用时不得删除 | 仅在产品策略允许时导出公开元数据；不包含其他用户关系、备注、评分或授权信息 |
| jobs、leases、worker 运行状态 | 按 `ownerUserId` 或 `system` | 删除请求标记 `cancel_requested`；worker 在外呼前和提交结果前检查取消/主体有效性；最终转 `cancelled`/`expired`，不再重试 | 只导出该用户已完成任务的结果摘要，不导出运行凭据或内部 lease |
| 导出包与临时文件 | 用户一次性资源 | 一次性下载 token 24 小时失效；文件最多 7 天自动清理；失败/过期可重建 | 下载必须再次认证并校验一次性 token、owner 和过期时间；限制单用户并发、包大小和生成频率 |
| 产品审计日志、安全/网络日志、删除 receipt/tombstone | 运维受限、最小必要 | 默认分别 12 个月、6 个月、30 天；删除后主体去标识化；安全事件/法定留置需记录授权、范围、开始/解除时间，解除后恢复常规清理 | 默认不可由用户导出完整运维日志；可提供与本人相关的脱敏操作摘要 |

删除请求采用 `requested → processing → completed|failed` 状态机，重复请求返回同一 request/receipt；processing 期间禁止重新登录，失败必须保留可重试原因但不得恢复已撤销 credential。导出请求采用 `queued → generating → ready|failed|expired`，下载只允许 owner 或明确授权的管理员，导出包生成器需有密钥/令牌字段排除测试。审计访问仅限 admin/安全运维，支持按 legal hold 标记冻结且不能由普通用户自行解除。

#### 私有版过渡与不可绕过的发布门禁

- Phase 1 开发和隔离环境继续保留 Nginx Basic Auth、SSH 隧道和回环/内网绑定，直到真实 session、路由矩阵、撤销、删除、导出、HTTPS、Cookie/CSRF smoke test 全部通过独立 review。
- 当前 CLI/MCP 的 Basic Auth 仅是私有部署过渡保护；应用 token 方案落地后统一使用 `DEVSCOPE_TOKEN`。任何入口都不得在明文公网 HTTP 中携带 Basic 密码、GitHub token 或导出 token。
- 不得把 `publicProcedure`、`current-user.ts` 的首用户/默认邮箱解析、Nginx Basic Auth 或域名解析当成多用户应用鉴权；这些兼容路径必须在迁移门禁中显式标记并最终移除/隔离。
- OAuth app 注册、生产 DNS/证书、生产 schema migration、公开入口和部署必须分别取得明确授权；Phase 0 通过不等于获得这些外部变更权限。

#### Phase 0 拟定的持久边界（尚未建表）

- `invitations`：只保存 `tokenHash`、创建者、过期/撤销/消费时间和可选的目标 GitHub stable ID；不保存可回放的明文邀请 token。
- `authIdentities`：以 `(provider, providerSubject)` 唯一绑定 GitHub 账号和 DevScope `userId`；不再用邮箱作为唯一身份来源。
- `sessions`：只保存随机 session ID 的哈希、`userId`、创建/过期/撤销时间和最近使用时间；浏览器 cookie 不承载 GitHub access token。登录、账号切换、权限变化和 PAT rotation 均生成新 session，旧 session 立即失效。
- `githubCredentials`：按用户保存加密后的 provider token、scope 和过期信息；加密密钥只来自部署密钥系统，不能进入数据库备份或日志明文。scheduler 的 system credential 单独存于部署密钥系统，不落用户表，也不出现在 job payload。
- `personalAccessTokens`：只保存 token hash、`userId`、不可变 token 前缀/标签、scope（`read|write`）、`createdAt`、`expiresAt`、`revokedAt`、`lastUsedAt`、`rotatedFromId`；明文只在创建/轮换响应显示一次。按 hash 唯一并建立索引；create/revoke/rotate/使用失败均写审计，不能通过日志或 API 回显完整 token。
- `deletionRequests` 与 `retentionHolds`：`deletionRequests` 保存 `id`、`userId`、状态（`requested|processing|completed|failed`）、请求/处理/完成/失败时间、幂等 request key、失败代码和 receipt 引用；同一用户最多一个非终态请求。`users` 增加 `accountStatus`（`active|deletion_requested|deleting|deleted`）与 `deletionRequestedAt/deletedAt`，并以状态索引阻止回调和新任务。`retentionHolds` 仅 admin 可写，保存主体、原因、授权人、开始/解除时间；hold 未解除时删除 worker 只清理非留置字段。
- `users.email` 现有字段需要设计兼容迁移，不应直接假设 GitHub 一定返回可验证邮箱；历史默认用户必须作为一次性迁移对象处理。

现有 `packages/shared/src/github-client.ts`、`packages/db/src/github.ts`、scheduler 和采集 pipeline 都默认读取进程级 `GITHUB_TOKEN`。Phase 1 必须先引入按请求/按 job 注入 token 的边界，再逐步移除用户业务路径对全局 token 的依赖；全局 Trending/Radar、stale repository refresh、pending embedding maintenance 和 scheduled discovery 均固定为 `system` 主体并使用独立服务 credential。

删除状态的拒绝约束：OAuth callback 在 `accountStatus != active` 或存在未完成 deletion request 时拒绝建立/恢复 session；PAT create 在同样条件下拒绝；worker 在领取、外呼前、提交结果前检查 owner 状态，进入 `cancelled`/`blocked_auth` 且不再重试。重复删除请求按幂等 request key 返回原 request/receipt；物理删除完成后保留 30 天不可逆 tombstone，防止旧 callback、job 或导出链接复活账户。

### Phase 1：会话身份与授权边界

- 引入单一 `getCurrentUser`/session adapter，Web、tRPC、SSE、CLI/MCP 适配层不得各自解析身份。
- 把 `publicProcedure` 分为明确的 authenticated、system-job 和 health/readiness 边界；默认拒绝未认证业务路由。
- 建立路由授权矩阵，覆盖仓库关注/备注/分组、外部资源、搜索、报告、图谱、Trending/Radar 和管理操作。
- 为用户级查询补齐负向测试：跨用户 ID、伪造 header、过期会话、后台 job 越权。

### Phase 2：数据与迁移

- 审查所有用户拥有的数据表、复合唯一约束、外键和索引；确保查询入口都带真实用户条件。
- 设计从现有默认用户到多用户的迁移演练：备份、影子库、回填、冲突处理、回滚和重复执行语义。
- 不在生产使用 `db:push`；每个 schema 变更必须有显式迁移和隔离 PostgreSQL 演练。
- 对共享 GitHub 仓库实体与用户关联分别定义生命周期，禁止通过复制仓库行规避租户隔离。

### Phase 3：配额、限流与后台任务

- 为 GitHub、AI、embedding、Trending/Radar 和分析任务定义用户/系统级预算。
- API 层增加按主体、路由和外部 provider 的限流；Worker job 带 owner、预算、幂等键和取消/过期语义。
- 对 SSE、长任务和失败重试设置并发上限，避免单用户耗尽全局资源。
- 将配额拒绝、重试和 provider 限流写入结构化指标，不把它们伪装成业务成功。

### Phase 4：审计、可观测性与安全运营

- 审计登录、授权变更、GitHub 授权、数据导出/删除、敏感配置和管理操作；不记录令牌和密码。
- 增加 requestId、subjectId、jobId、resourceId 的关联日志和指标，敏感字段默认脱敏。
- 建立 401/403、限流、任务堆积、外部失败、数据库锁等待和备份结果的告警阈值。
- 演练会话撤销、密钥轮换、备份恢复、数据删除和异常流量响应。

### Phase 5：HTTPS、发布与回滚

- 证书、域名、反向代理、HSTS、Cookie 安全属性和 CORS/CSRF 策略先在隔离环境验证。
- 公开入口只暴露 Web/API 必要路径；PostgreSQL、Worker 和内部管理端口继续保持内网/回环绑定。
- 采用 canary 或小流量发布，迁移与应用版本分离；每次发布记录镜像 digest、迁移 receipt 和回滚 revision。
- 在未完成真实会话和授权验证前，不移除现有 Basic Auth/SSH 隧道保护。

## 验收标准

1. 未登录请求不能访问任何业务数据或业务写入；健康检查与 readiness 边界单独定义。
2. 两个测试用户之间所有仓库关联、备注、分组、外部资源、报告、任务和搜索结果均隔离。
3. 伪造用户 ID、header、cookie 或 job 参数不能越权；403 与审计事件可复核。
4. 迁移可在隔离 PostgreSQL 从 baseline 重放，具备备份恢复和失败回滚证据。
5. 配额、限流、任务并发和 provider 失败有确定性测试及可观测指标。
6. HTTPS 入口、Cookie/CORS/CSRF、证书续期和公开运维 runbook 经过独立 review。
7. 生产发布前有 canary、回滚和安全事件响应记录；在此之前继续保持私有部署。

## 明确不做

- 不在本计划中引入 CQRS、事件溯源、图数据库、通用 Repository 框架或第二套任务队列。
- 不把 Basic Auth、SSH 隧道或域名解析视为应用层多用户鉴权。
- 不在产品决策未确认时注册 OAuth 应用、改生产 DNS、上传证书、迁移生产数据库或开放公网。

## 当前下一步

下一步是完成身份/邀请/删除导出/审计的数据流和路由授权矩阵；这些只产生设计与测试计划，不改变生产配置。通过 Phase 0 独立 review 后，再进入会话身份代码实现。
