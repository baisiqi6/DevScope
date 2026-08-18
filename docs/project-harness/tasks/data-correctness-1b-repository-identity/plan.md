# 以 GitHub 稳定 ID 统一仓库身份

## Item

- Checklist item: `data-correctness-1b-repository-identity`
- Owner: `codex`
- Session: `codex-20260818-repository-identity`
- Updated at: `2026-08-18`

## Goal

同一 GitHub repository ID 在改名或转移前后只对应一个仓库实体和一个用户候选状态；回填与冲突合并可审计，无法确认时 fail closed。

## In Scope

- 为正式 `repositories` 增加可空的 GitHub repository ID，并对非空值建立全局部分唯一索引；
- 将 GitHub repository ID 作为正十进制字符串从采集边界传入，拒绝 unsafe `number`、非正整数和静默截断；
- 将正式仓库 upsert 改为分阶段的 ID 优先、规范化 `fullName` 回退：compatibility 阶段只允许给同名行附加 ID 或更新已知 ID 行，禁止创建新的 ID 行；cutover 后同一 ID 改名时更新原实体和冗余关注名称，不创建第二行；
- 将 Radar 候选 upsert 改为非空 ID 优先、缺失 ID 时按 `(userId, fullName)` 回退，并保留用户已选择的状态；
- 在显式迁移中确定性合并现有 Radar 同 ID 重复：保留最早 `firstSeenAt`、最新 GitHub 名称/证据和唯一非默认用户状态，并把合并来源写入 evidence；存在多个互相冲突的非默认状态时迁移 fail closed；
- 复用现有持久 `jobs` 增加版本化 one-shot repository identity backfill：每次已获准的新运行使用新的 idempotency key，终态行不重置；数据库部分唯一约束保证全局最多一个 active identity backfill，重复触发返回同一 active job；先从 GitHub API 收集并完整校验全部结果，再在同一个短事务中锁定/校验 job lease、写入 repository 更新并保存结构化终态 result；
- 对多个正式仓库行解析为同一 GitHub ID、规范名称已被其他身份占用或并发唯一约束冲突的情况，在任何回填写入前 fail closed，不自动猜测关联数据合并策略；
- 增加本地 PostgreSQL 迁移/历史数据演练、focused tests、全仓门禁、独立 review 和生产备份/迁移/验收。

## Out Of Scope

- 不在本 item 中整改 chunks、Hacker News、Releases 的整体原子替换；
- 不迁移 `tech-stack/*` reference 行为独立技术栈实体，该工作属于 `data-architecture-3-technology-stack-entities`；
- 不重写 workflow report、历史 job payload 或 package mapping 中作为历史证据保存的旧 `fullName`；
- 不为无法从当前 GitHub 权限解析的仓库猜测 ID，也不在 SQL migration 中访问 GitHub；
- 不引入第二套队列、分布式锁或通用 identity framework；
- 不实现公开多用户鉴权。

## Acceptance Mapping

- Current item acceptance: "同一 GitHub repository ID 在改名或转移前后只对应一个仓库实体和一个用户候选状态；回填与冲突合并可审计，无法确认时 fail closed。"
- This plan satisfies it by:
  - 正式仓库和 Radar 都以非空 GitHub ID 为第一身份，`fullName` 只作兼容回退；
  - old-name/new-name 回归测试证明同一 ID 只更新同一行，并保留 Radar 用户状态；
  - 不可重置的 one-shot backfill job result 与 Radar merge evidence 提供审计证据；
  - 所有有歧义的正式仓库冲突在事务写入前停止并报告，不做破坏性自动合并。

## Boundary Review

- Scope non-goals checked：保持当前单用户私有版，不引入公开身份系统；
- Architecture boundaries checked：schema、identity reconciliation 和 job contract 放在 `packages/db`，GitHub 数据获取沿用现有 client/collector，持久执行复用 `apps/worker` 与 `jobs`，API 只提供版本化 one-shot 手动启动/最新状态入口；
- Domain-model decisions checked：遵循 [domain-model.md 的 1B 设计](../../domain-model.md#1b-github-repository-id)，使用 nullable ID、部分唯一索引、双读兼容、外部回填和 fail-closed 冲突策略；
- Potential overlap with other items：Radar 去重只处理稳定身份；正式仓库关联数据的原子替换、技术栈 reference 行和最终 PostgreSQL integration suite 分别留给后续 item；
- Simplicity check：不创建新 audit 表；回填审计复用不可变的 job result，Radar SQL 合并证据复用候选 `evidence`。

## Steps

1. 固化生产只读基线：正式仓库/候选数量、重复 ID、当前 GitHub 可解析和 unresolved 集合、关联表范围。
2. 先增加 RED tests：unsafe repository ID、正式仓库 attach/rename/conflict、Radar 同 ID 改名与状态保持、backfill 全量校验后写入和冲突零写入。
3. 更新 schema、GitHub collector/shared client、compatibility 写路径和 one-shot Worker job contract；compatibility 默认关闭“全新 stable ID 行插入”，生成并逐行审查显式迁移。
4. 在隔离 PostgreSQL 中应用 `0000` 至最新迁移，覆盖已知 Radar 重复、冲突状态 fail closed、部分唯一约束、compatibility 防重复窗口、正式仓库 rename 和 backfill fixture。
5. 运行 focused tests、DB/API/Worker typecheck，再运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
6. 生成 review packet，由独立 reviewer 审查 ID 精度、冲突规则、迁移锁/回滚、job 审计和范围边界；修复所有阻塞 finding。
7. PR/CI 通过并合并后按三个阶段发布：先备份并部署 compatibility/schema；暂停正式仓库采集入口后执行 one-shot backfill；验收所有可解析行与 structured result 后才启用 cutover，并恢复采集。
8. 生产验收 schema/index、仓库/候选行集、用户关注/分组、job result、服务健康和认证边界；每阶段都有独立回滚点，closeout review 批准后由 Harness 标记 `done`。

## Verification

- Repository ID：只接受正十进制字符串或安全正整数，跨 JSON 继续使用 string；
- Repository upsert：同 ID 的旧名/新名同步后保持同一内部 `id`，用户关注关系不丢失且 `repoFullName` 更新；不同 ID 占用同一名称或两个正式行解析为同一 ID时 fail closed；
- Radar：同一 `(userId, githubRepoId)` 改名后只有一个候选，保留用户状态与最早发现时间；缺 ID 时仍按规范化 fullName 工作；
- Backfill：先完成全部 GitHub 读取/校验再写；unresolved 不填假值；conflict 时 0 repository writes，并保存 `outcome: blocked`、updated/unresolved/conflicts；成功保存 `outcome: applied`；
- Job authority：最终 apply 事务必须 `FOR UPDATE` 锁定 job 行，验证 `status=running`、`leaseOwner` 与未过期 lease，再原子写入 repositories 和终态 structured result；apply 前失去 lease 必须 0 writes；
- Job audit：每次运行使用版本化 one-shot idempotency key，既有终态行和 result 不得被后续运行清空或覆盖；API 明确区分 `applied`、`blocked` 与执行失败；
- Job singleton：`jobs.type = repository.identity.backfill` 且状态为 `queued | running | retry_wait` 时，以数据库部分唯一索引保证全局最多一条；并发重复触发只创建/领取一个 active run，返回同一 job；只有前一 run 进入终态后才能显式创建下一版本；
- Migration：历史重复按 `lastSeenAt DESC, updatedAt DESC, id DESC` 选择最新名称/证据；覆盖时间相同 fixture、冲突状态 rollback、repository/Radar/active-backfill 部分唯一索引和锁影响；
- Local commands：focused Vitest、`pnpm db:generate`、迁移 rehearsal、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、Harness validate/doctor。

## Exit Criteria

- acceptance 的每个分支都有测试或 PostgreSQL/生产证据；
- 显式迁移、备份和恢复路径经过独立 review；
- 生产所有可解析正式仓库均写入稳定 ID，unresolved/conflicts 在 job result 中可定位且未被猜测；
- 生产 Radar 不再有非空同 ID 重复，用户状态和时间证据保持；
- 没有把后续原子替换、技术栈实体或公开多用户工作顺带并入；
- 独立 closeout approved 后才允许 Harness `mark-done`。

## Production Cutover

### Stage 1: Compatibility

- 迁移前备份并记录仓库、关注、分组、Radar 与 job 基线；
- 应用 nullable ID、部分唯一索引和 compatibility code；
- compatibility 模式允许按现有 `fullName` 更新/附加 ID，也允许更新已经存在的 stable ID 行，但当 ID 与 fullName 都未命中时拒绝创建新正式仓库，返回明确的 `REPOSITORY_IDENTITY_BACKFILL_REQUIRED`；
- 回滚点：恢复上一镜像；nullable schema 可保留，因为旧代码忽略该列。若迁移自身失败，数据库事务回滚且不部署新应用。

### Stage 2: One-shot Backfill

- 暂停正式仓库采集入口；Radar 发现与只读查询可以继续；
- 手动触发先尝试创建新的版本化 job 行；若已有 active identity backfill，数据库级 singleton 使创建 no-op，并返回现有 active job；不复用或清空任何旧终态行；
- active singleton 是全局而非按用户，因为 `repositories` 是当前共享正式实体表；使用 `jobs.type` 上只覆盖 identity backfill active 状态的部分唯一索引，不影响其他 job 类型；
- Worker 在事务外完成全部 GitHub 请求与规范化，生成 `updated`、`unresolved`、`conflicts` 候选；若 conflicts 非空，不更新 repository，但仍在持有有效 lease 的最终事务中写入 `outcome: blocked`；
- 若无 conflicts，最终事务锁定 job 行并校验 `running`、当前 `leaseOwner` 和 `leaseExpiresAt > now`，随后更新 repositories/冗余关注名称并把 `outcome: applied` result 与 job 终态一起提交；失去 lease 时整个事务回滚；
- unresolved 行保持 null 与 fullName 兼容路径。它们不会被猜测或自动跨改名合并；后续变为可解析时可通过新的 one-shot job 安全附加 ID。若其名称发生变化且无法证明与旧行相同，按 conflict 处理而不是自动合并。
- 回滚点：apply 前无数据库 mutation；blocked outcome 只新增审计 job result。applied 后如验收失败，使用部署前 custom-format 备份恢复。

### Stage 3: Cutover

- 只有最新 backfill outcome 为 `applied`、conflicts 为空、所有当前可解析行均已带 ID且部分唯一索引通过时，才显式启用新 stable ID 行插入；
- cutover 后恢复正式仓库采集。同一已知 ID 的 rename/transfer 更新既有内部行；缺 ID 数据源继续按规范化 fullName 回退；
- 回滚点：先重新关闭新 ID 行插入并暂停采集，再恢复上一镜像；若已写入仅新版本可识别的数据且需要回退，使用 Stage 1 备份恢复，不做临时破坏性 down migration。

## Handoff

- 若本轮未完成，下一 session 先运行 Harness session init，确认本 item 的 owner/lease 和 branch，再从本计划最后一项已有 verification 继续；不得跳过 unresolved/conflict 清单直接执行生产写入。
