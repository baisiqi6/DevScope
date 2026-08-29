# 外部资源 Web 工作区与数据库打磨

## Item

- Checklist item：`product-10-external-resources-workspace`
- 当前状态：`done`
- 风险模式：`high-risk`（涉及 schema/migration 与持久化用户数据）
- 依赖：`product-9-external-resources-preview`

## 目标

在既有 `article | paper | website`、`preview_only` API/Client/CLI/MCP 能力之上，补齐 Web 端可用的外部资源工作区，并对数据库约束、索引、删除级联和迁移验证做一次针对性打磨。文章、论文和网站仍与 GitHub 仓库分别管理；本 item 不进入正文抓取、PDF/DOI 解析、embedding 或多用户鉴权实现。

## 成功标准

1. Web 导航提供“外部资源”入口，页面支持列表/卡片两种密度、类型筛选、已读/未读、置顶和关键词过滤，并提供 loading/empty/error 状态。
2. 预览卡片展示资源类型、站点/作者、标题、描述、标签、已读/置顶状态和安全的外链打开行为；支持编辑备注、标签、阅读状态、置顶和删除确认。
3. Web 能创建/列出/查看/编辑/删除外部资源，并管理独立外部资源分组；所有交互复用现有 tRPC contract，不在 Web 直连数据库。
4. 数据库审查外部资源表的 user 边界、复合外键、唯一键、索引、metadata 大小和删除级联；需要 schema 变化时生成显式迁移，不使用 `db:push`。
5. 增加 Web 组件/页面测试与数据库约束测试；`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过，并在隔离 PostgreSQL 验证迁移。
6. 不执行生产迁移、部署、push 或公开多用户改造；完成后交独立 reviewer 复核。

## 实施阶段

### Phase 0：现状核对与设计冻结

- 确认 API 返回字段、排序/筛选能力和当前数据库索引；如 API 不足，先补最小 contract。
- 沿用现有 DevScope command-surface/token、字体、颜色和 Motion 微交互规范，不引入第二套 UI 框架。
- 冻结页面信息架构：顶部标题/统计、工具栏筛选、分组侧栏或下拉、资源卡片网格/列表、编辑对话框。

### Phase 1：Web 工作区

- 新增 `/resources` 页面与导航项；实现查询、过滤、排序、刷新和分页/加载更多。
- 添加外部资源卡片、类型徽标、站点 favicon/预览图 fallback、标签、状态按钮、备注编辑和删除确认。
- 添加保存资源与创建/管理分组的入口；所有 mutation 成功后精确失效相关 query。
- 处理窄屏、键盘焦点、外链 `noopener noreferrer`、图片加载失败和 reduced-motion。

### Phase 2：数据库打磨

- 审查并补齐 canonical URL 唯一约束、用户复合外键、外部资源/分组索引、metadata 字段约束和级联删除。
- 如需新增列/索引，运行 `pnpm db:generate`，审查 SQL 顺序、锁影响和回滚步骤。
- 在隔离 PostgreSQL 从 baseline 重放迁移，覆盖重复保存、跨用户分组成员、删除级联和查询索引。

### Phase 3：验证与 review

- 运行 focused Web/API/DB tests，再运行完整 lint/typecheck/test/build。
- 对 UI 做手动或 Playwright smoke：创建、筛选、编辑、分组、删除、外链打开、空/错/加载态。
- 交独立 reviewer；review 通过后生成 closeout，不自动生产部署。

## 本轮实现与验证记录

- 已完成 `/resources` Web 工作区：卡片/列表密度切换、关键词/类型/阅读状态筛选、置顶优先/最近更新排序、分组筛选、加载更多、创建/编辑/删除、已读/置顶操作、预览图与 favicon fallback、错误/空/加载状态和安全外链。
- 已补齐共享外部资源类型别名、导航入口，以及 `metadata` 20KB 和收藏 `tags` 最多 30 项的数据库约束；生成迁移 `0013`、`0014`。
- 已通过：`pnpm lint`（0 errors，18 warnings）、`pnpm typecheck`、`pnpm test`、`pnpm build`；Web 页面/组件 SSR smoke 与筛选测试共 21 项；共享 metadata UTF-8 字节边界测试通过；状态 mutation pending 防重复提交；隔离 `pgvector/pgvector:pg16` 重放全部迁移并通过 9 个 integration test 文件、54 项测试。
- 独立 reviewer 已只读复核通过；本 item 不包含生产迁移、部署、push 或多用户鉴权。

## 数据边界

- `external_resources`、`external_resource_saves`、`external_resource_groups`、`external_resource_group_members` 继续独立于 GitHub 仓库域。
- 资源正文仍不抓取；`ingestionMode` 固定为 `preview_only`。
- 所有资源与分组操作继续由服务端单用户边界过滤；本 item 不把当前 `publicProcedure` 改造成多用户鉴权。

## 未授权动作

- 生产数据库迁移、生产部署、域名/证书/代理改动、公开多用户鉴权、正文抓取和外部资源内容索引均不在本 item 授权范围内。
