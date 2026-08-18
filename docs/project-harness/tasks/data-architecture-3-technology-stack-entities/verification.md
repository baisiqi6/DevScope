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

## 尚未验证

- PR 与 GitHub CI；
- 生产备份和显式 `0008` migration；
- 生产 versioned one-shot backfill receipt；
- 生产 graph rebuild 的 shadow zero-diff；
- 认证 MCP/UI dogfood、服务 revision/health/auth 和独立 production closeout。

Phase B `new_read_dual_write` 与 Phase C `new_only → legacy_cleaned` 不属于本次批准范围，整个 item 仍保持 `doing`。
