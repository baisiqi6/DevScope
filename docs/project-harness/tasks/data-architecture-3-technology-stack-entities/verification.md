# 技术栈实体分离验证

## 生产只读基线

2026-08-18 在 `main@de3b91722d0b9b120bd6ae7308bbf92af5dc0bdf` 部署后读取生产 PostgreSQL：

- 50 个 repository rows，其中 40 个真实仓库、10 个 `tech-stack/*` reference rows；
- 50 条 watched relations，其中 40 条指向真实仓库、10 条是技术栈伪收藏；
- reference group members 为 0；
- 37 条 dependency edges，其中 34 条指向技术栈 reference，3 条连接真实仓库；
- 34 条技术栈边全部为 `resolvedBy=tech-stack-catalog` 且 packages 为数组，共 203 条包/版本 evidence；
- 10 条技术栈伪收藏均有对应 dependency edge，没有 orphan reference watch。

具体节点为 Axum、Express、FastAPI、Next.js、React、React Native、Svelte、Tauri、Vite、Vue。Spring Boot 是目录支持并需要回归测试的产品语义，但当前生产 SBOM 没有形成该节点，不能伪造为迁移基线。

以上数字是本轮迁移输入的日期化证据，不是长期固定验收常量。实现、隔离 PostgreSQL 演练、PR/CI、分阶段部署和生产 closeout 尚未开始。

## Phase A 本地实现证据

2026-08-18 在 `codex/data-architecture-3-technology-stack-entities` 完成 expand/shadow 阶段实现：

- `0008_round_peter_parker.sql` 仅创建 `technology_stacks`、`repository_technology_stacks`、外键/索引和两个 backfill job 部分唯一索引；不包含业务 backfill、legacy 删除或列删除；
- `technology_stack.entities.backfill` 使用 versioned global singleton，prepare 零业务写入；每个 source 的 relation/checkpoint/receipt 由 fresh lease authority 控制，同一 version 终态不可复用；
- legacy evidence 经过 strict schema、canonical packages、原始 multiplicity 和 ordered digest 验证；SBOM `NULL` fallback 在 stable-ID lock 后重新核验，SQL `NULL` 与 JSONB `null` 明确区分；
- graph rebuild 的最终 DB-only 阶段在一个事务内全序锁定并复核全部 source snapshot，同时提交 new relations 与 legacy reference/watch/edges/cleanup；网络和 deps.dev 解析均位于事务外；
- shadow compare 以当前用户 watched real repositories 投影 top-N，对 source stable ID、stack slug 和 sorted packages 做结构化比较；不一致会让 graph job 失败；
- shared graph schema 与 Web 2D/3D consumer 已先兼容 `reference` 和 `technology_stack` 两种 contract，本阶段 API 仍输出 legacy contract；
- 当前 revision 只接受 `TECHNOLOGY_STACK_STORAGE_MODE=legacy_shadow_dual_write`，未知或未来模式 fail closed。

## 隔离 PostgreSQL 16 + pgvector 演练

使用独立临时 `pgvector/pgvector:pg16` 容器，从 `0000` 到 `0008` 逐条以单事务、`ON_ERROR_STOP=1` 应用迁移；13/13 个定向场景通过，临时容器在测试后删除。覆盖：

- per-source replace、success empty、旧 token/SBOM stale；
- relation/checkpoint/final receipt 同事务、owner/lease 丢失零写入、repository lock 等待跨 expiry；
- 多 source fresh clock、SBOM `NULL` legacy evidence 改写、duplicate → deduplicated multiplicity 变化；
- 真实 graph rebuild 与 backfill 在原 dual-write 中间点强制交错，最终 new/legacy 只出现同一原子结果；
- malformed legacy evidence fail closed、shadow package diff、空库成功 receipt 与空库 terminal expiry rollback。

## 本地质量门禁与独立审查

以下命令全部通过：

```bash
pnpm db:generate
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm db:generate` 报告无 schema drift；lint 保留 16 条既有 Web warnings、0 errors。Phase A implementation continuity review 最终为 `APPROVE`，未发现剩余 P0–P3 finding。

## Phase A 首次生产部署与 fail-closed 证据

PR #35 的 CI 通过并 squash merge 为 `main@eae3127433280831f4f30467f583e0dfe6aaaa98`；deploy workflow run `32144833809` 成功完成构建、生产备份、显式 `0008` migration 和服务发布。生产证据如下：

- 迁移前备份为 `/home/devscope/backups/devscope/pre-migration-20260818-215751.dump`，大小 133875886 bytes，`pg_restore --list` 可读取 221 个目录项；
- API、Web、Worker image revision 与服务器 HEAD 均为 `eae3127433280831f4f30467f583e0dfe6aaaa98`，API/Worker 模式均为 `legacy_shadow_dual_write`；
- migration rows 从 8 增至 9；两张新表与 6 个新索引存在；旧基线保持 40 个真实仓库、10 个 reference rows、40+10 条 watched relations、34 条技术栈边和 203 条 evidence；
- API/Web 内网 health 为 200，未认证 tunnel 请求为 401；Keychain 注入的本地 MCP launcher 返回 `status: ok`，没有读取或输出凭据。

随后启动 version `phase-a-eae3127-v1`、job 27。任务只处理第一个 source 后便把历史微秒 `updated_at` 与 JavaScript 毫秒 token 判为 stale；重试耗尽后进入 `dead`，result 保留 `1/40` checkpoint，没有成功 receipt。旧 API read path 和业务基线不受影响，因此无需回滚 expand migration；失败 job 保留为不可变审计证据。

## 微秒 collection token 修复证据

在 `codex/technology-stack-token-precision` 上将数据库侧 repository token 比较规范为 `date_trunc('milliseconds', updated_at)` 对 canonical UTC 毫秒 timestamp；stable GitHub ID、SBOM baseline、lease authority 和 evidence digest 仍分别复核。新增真实 PostgreSQL 场景直接写入 `2026-08-18 10:04:52.387753`，prepare 得到 `2026-08-18T10:04:52.387Z`，apply 成功。

隔离 PostgreSQL 场景由 13 增至 14，14/14 通过；`pnpm db:generate` 无 schema drift，`git diff --check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。独立 precision fix review verdict 为 `APPROVE`，未发现 P0–P3 finding。

## 尚未验证

- precision fix 的 PR/CI 与无迁移生产部署；
- 新 version 的生产 one-shot backfill 成功 receipt；
- 生产 graph rebuild 的 shadow zero-diff；
- backfill 后认证 MCP/UI dogfood、服务 revision/health/auth 和独立 production closeout。

Phase B `new_read_dual_write` 与 Phase C `new_only → legacy_cleaned` 不属于本次批准范围，整个 item 仍保持 `doing`。
