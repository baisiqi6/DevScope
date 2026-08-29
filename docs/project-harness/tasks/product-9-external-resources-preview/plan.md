# 外部资源预览收藏（第一阶段）

## Item

- Checklist item：`product-9-external-resources-preview`
- Owner：`codex`
- Session：`codex-20260828-external-resources-preview`
- Mode：`high-risk`（schema migration；本阶段不触碰生产）

## Goal

在不改变 GitHub 仓库领域模型的前提下，增加文章、论文和网站的独立预览收藏能力。用户保存一个公开 URL 后，系统保存规范化 URL、资源类型、标题/描述、来源元数据、预览图和用户私有收藏状态；`preview_only` 不进入正文抓取、分块或 embedding。

## Success Criteria

1. `external_resources` 与用户资源关系、独立资源分组表具备明确 `userId` 边界和唯一约束；现有 `repositories`、`user_watched_repositories`、`repository_groups`、`group_members` 不被改成多态模型。
2. API 输入输出通过 Zod 校验，支持保存、列表、详情、更新收藏元数据、创建/列出/加入/移除外部资源分组。
3. URL 只接受 `http`/`https`；规范化后同一用户不能重复保存同一资源；服务端不执行正文抓取。
4. Client、CLI 和 MCP 只作为 API 薄适配层暴露上述能力，不直接访问数据库或外网。
5. 单元测试覆盖 URL 校验、去重、用户隔离、`preview_only` 不入采集队列、分组边界和错误响应；迁移在隔离 PostgreSQL 中可从 baseline 应用。
6. 相关包 typecheck、focused tests、lint/build 通过；不执行生产迁移、部署、push 或修改用户 dogfood 文档。

## Scope

### In scope

- Drizzle schema 与显式 migration；
- 资源类型 `article | paper | website`；采集模式先固定支持 `preview_only`，为未来 `content` 保留状态字段但不实现正文抓取；
- canonical URL、标题、描述、站点名、作者/发布者、发布时间、favicon/preview image、metadata JSON；
- 用户收藏关系：备注、标签、已读、置顶、创建/更新时间；
- 外部资源独立分组与 API/Client/CLI/MCP 契约；
- focused tests 与隔离数据库迁移验证。

### Out of scope

- HTML 正文、PDF、DOI/arXiv 解析、网页截图服务、定时刷新；
- 外部资源与 GitHub 仓库混合分组；
- 修改关系图谱、仓库语义搜索、Trending/Radar 管线；
- 生产数据库迁移、部署、域名/代理或凭据操作；
- 公开多用户鉴权。

## Implementation Phases

1. **Schema and migration**（complete）：新增外部资源、用户收藏、资源分组及成员表；生成 `0011_wakeful_lord_hawal.sql`，隔离 PostgreSQL 验证 4 张表落地。
2. **API and contracts**（complete）：增加资源 CRUD 与独立分组路由；所有输入输出 Zod 校验；`preview_only` 不创建采集任务。
3. **Client/CLI/MCP adapters**（complete）：扩展统一 Client，再映射 CLI 命令和 10 个 MCP tools；不复制业务逻辑。
4. **Verification**（complete）：首轮 review 的 P1/P2/P3 已修复，二审 reviewer 已 `APPROVED`。

## Safety and Data Rules

- 所有用户级查询显式按服务端 `userId` 过滤；
- canonical URL 去除 fragment、规范化 host/path，但不擅自改变 query 语义；
- 当前阶段只保存用户提交的 URL 和可选手工元数据，不从远端抓取内容；
- 未来启用抓取时必须另立 item，增加 SSRF 防护、超时、响应大小和 robots/许可策略；
- 迁移失败必须可回滚，禁止使用 `db:push` 代替显式 migration。

## Verification Plan

- `packages/db` schema/migration tests：约束、用户隔离、重复 URL、删除级联；
- `apps/api` router tests：保存/列表/更新/分组，以及 `preview_only` 不创建 job；
- `packages/client`、`apps/cli`、`apps/mcp` focused tests；
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- 隔离 PostgreSQL migration smoke test；不连接生产库。

## Exit Criteria

- 第一阶段 API/CLI/MCP 可以保存并管理外部资源预览卡片；
- GitHub 现有行为和表结构无回归；
- 所有 focused/full checks 结果已记录，migration、review 和 rollback 证据齐全；
- 生产保持未迁移状态，后续部署需单独授权。

## Verification Log

- `pnpm lint`：通过（既有 Web lint warning 未新增）；
- `pnpm typecheck`：通过；
- `pnpm test`：通过（API 107、DB 232、CLI 19、MCP 6、Client 17 及其余 workspace 测试）；
- `pnpm build`：通过；
- 隔离 `pgvector/pgvector:pg16`：显式迁移成功，真实 PostgreSQL integration 53/53 通过；覆盖跨用户复合外键与资源删除级联；
- 独立 reviewer 二审：`APPROVED`；本地 reviewer 环境未配置 `TEST_DATABASE_URL`，因此其 integration 命令按门禁设计跳过，隔离数据库证据由主会话提供。
- 本轮未执行生产迁移、部署、push 或 dogfood 数据写入。

## Review Repair Log (2026-08-28)

- shared/API/CLI/MCP 已贯通 `metadata`、站点名、作者、发布时间、favicon 与预览图；API 新增所有资源/分组 procedure 的 `.output()` 契约。
- `external_resource_saves` 与 `external_resource_group_members` 增加 `userId` 复合外键；分组计数和成员查询显式过滤资源归属；成员写入带服务端 `userId`。
- save 改为唯一键冲突安全的 `onConflictDoNothing` + 事务内回读，重复保存保持 `{ created: false }` 幂等语义。
- 新增 `0012_nice_ben_grimm.sql`，对已存在的成员行先按资源回填 `user_id` 并检查跨用户/孤儿数据，再建立约束；索引先于复合外键创建。
- 新增外部资源 PostgreSQL 集成约束/级联测试、CLI 元数据解析测试、MCP 转发测试与 metadata 大小契约测试。

## Review Findings (2026-08-28)

独立 reviewer verdict：`CHANGES_REQUESTED`。

1. P1：`metadata` 仅有数据库列，shared/API/CLI/MCP 保存链路未实现；
2. P1：收藏关系和分组成员缺少数据库级同用户约束，分组计数也未过滤资源归属；
3. P2：API 缺少完整 `.output()` 契约，MCP URL schema 未复用 HTTP(S)/无凭据约束；
4. P2：CLI/MCP 未暴露全部预览元数据字段；
5. P2：缺少 CRUD、重复、用户隔离、级联和适配器转发测试；
6. P3：save 的先查后插在并发下可能以唯一键错误失败，未保持幂等返回。

修复顺序：先补字段和数据库约束，再补稳定输出契约与适配器参数，最后补真实 PostgreSQL/路由/转发测试并重新请求 review。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `activate_item.py: unrecognized arguments: --branch` | 1 | `start` 兼容入口不接受 branch；改用 `assign --branch` 后再 `accept`。 |
| `@devscope/db typecheck` 缺少 `GraphRebuildProgress` 等 shared 导出 | 1 | 先重建 `@devscope/shared` 产物，再重新运行受影响包 typecheck；该错误来自 stale workspace declaration。 |
| API typecheck 使用 stale `@devscope/db` dist，缺少本次 schema 与既有导出 | 1 | 先构建 `@devscope/db` 产物，再复跑 API/CLI/MCP typecheck；同时保留真实编译错误继续修复。 |
| CLI typecheck 使用 stale `@devscope/client` declaration，且 workspace 未链接 `@devscope/shared` | 1 | 先构建 shared/client 产物后复跑；该问题属于 workspace 构建顺序/依赖链接，不改变资源实现。 |
| 一次性迁移烟雾测试脚本使用 zsh 保留变量 `status` | 1 | 集成测试本身 51/51 通过；清理脚本在退出前触发变量错误，随后改用非保留变量并显式清理容器。 |
| 首次应用 `0012` 时复合外键先于父表复合唯一索引创建 | 1 | 调整迁移顺序，先创建 `(id,user_id)` 唯一索引，再建立复合外键；隔离迁移与 53/53 集成测试通过。 |
