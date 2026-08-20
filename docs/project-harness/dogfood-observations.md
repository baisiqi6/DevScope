# DevScope Dogfood Observations

本文是 DevScope 持久 dogfood 会话中产品观察、缺陷与操作摩擦的唯一登记册。处理流程、证据要求和权限边界以 [运行手册](runbook.md#dogfood-反馈闭环) 为准；工程任务状态仍以 [Harness checklist](harness-checklist.json) 为准。

## 使用规则

- 新问题使用稳定 ID `DF-YYYYMMDD-NNN`，先记录用户意图、预期、实际结果和最小复现，再做归因。
- 状态只使用 `open`、`triaged`、`planned`、`fixing`、`fixed_pending_verification`、`closed`、`accepted`。
- 优先级只使用 `p0`、`p1`、`p2`；`p0` 表示核心路径不可用或存在高风险错误，不能只因体验不佳使用。
- 原始 observation 不因后续判断而删除；状态变化、修复和生产复查追加到 `Timeline`。
- 只有可复现、有生产证据或有清晰失败条件的问题，才关联 GitHub Issue 或 checklist item。关联后这里只保存 locator 和用户侧事实，不复制任务计划。
- 不记录密码、Token、Basic Auth 值、完整私有数据或未经脱敏的日志。
- 本文记录问题不等于授权修复、部署、数据库写入、删除或关闭 observation。

## 当前观察

| ID                | 标题                                              | 状态       | 优先级 | 类型     | 影响                      |
| ----------------- | ------------------------------------------------- | ---------- | ------ | -------- | ------------------------- |
| `DF-20260818-001` | MCP 分组列表因 `repoCount` 类型不一致失败         | `closed`   | `p1`   | 产品缺陷 | blocked                   |
| `DF-20260818-002` | MCP 分组成员接口返回完整重对象                    | `triaged`  | `p1`   | 产品缺陷 | performance               |
| `DF-20260818-003` | 许可证字段不能区分开源、source-available 与未识别 | `open`     | `p2`   | 能力缺口 | wrong data / confusing UX |
| `DF-20260818-004` | 分组不支持父子层级                                | `accepted` | `p2`   | 能力缺口 | confusing UX              |
| `DF-20260818-005` | 已采集仓库没有删除或归档入口                      | `triaged`  | `p2`   | 能力缺口 | stale data / confusing UX |
| `DF-20260818-006` | MCP/CLI 未暴露已有分组编辑与原子移动能力          | `triaged`  | `p2`   | 操作摩擦 | confusing UX              |

## Observations

### DF-20260818-001：MCP 分组列表因 `repoCount` 类型不一致失败

- Status: `closed`
- Priority: `p1`
- Time: 2026-08-18
- Entry point: MCP `devscope_list_groups`
- User intent: 在云端读取现有仓库分组，为多 Agent 项目规划分组和成员调整。
- Expected: 返回当前用户的全部分组及数值类型的 `repoCount`。
- Actual: MCP 返回 Zod `invalid_type`；三个分组的 `repoCount` 均为字符串，而 schema 要求 number，整个列表不可用。
- Reproduction: 在已认证且 `devscope_health` 为 `ok` 的会话调用 `devscope_list_groups`，无需参数即可稳定复现。
- Evidence: 错误路径为 `[0, "repoCount"]`、`[1, "repoCount"]`、`[2, "repoCount"]`，均为 `Expected number, received string`。API 在 [`apps/api/src/router/groups.ts`](../../apps/api/src/router/groups.ts) 使用 `sql<number>\`count(...)\``；该泛型不改变 PostgreSQL `count()` 的运行时字符串值，而 [`repositoryGroupSchema`](../../packages/shared/src/index.ts) 要求 `z.number()`。
- Impact: blocked。无法通过标准 MCP 列出分组，妨碍后续安全的“读取 → 添加 → 验证”流程。
- Frequency: reproducible
- Workaround: 已知分组 ID 时调用 `devscope_get_group_members`；否则改用 Web。该 workaround 不替代修复。
- Classification: 产品缺陷；API 运行时输出与共享契约不一致。
- Related issue/checklist: `data-correctness-1c-group-count-contract`; [verification](tasks/data-correctness-1c-group-count-contract/verification.md)
- Timeline:
  - 2026-08-18: 在真实云端 dogfood 会话首次观察并通过源码确认根因；未修改代码。
  - 2026-08-18: API 边界增加严格 runtime normalization，PR #31 合并并完成无迁移生产部署。
  - 2026-08-18: 认证 MCP 复查 7 个分组的 `repoCount` 均为 number 且与在线成员数一致，独立 closeout APPROVE，状态关闭。

### DF-20260818-002：MCP 分组成员接口返回完整重对象

- Status: `triaged`
- Priority: `p1`
- Time: 2026-08-18
- Entry point: MCP `devscope_get_group_members`
- User intent: 读取分组名称、成员仓库 ID、`fullName` 和必要摘要，以决定项目去留及分组调整。
- Expected: 返回轻量分组信息和 repository summary，输出大小随成员数量线性、可控增长。
- Actual: 每个成员都携带完整 repository 行，包括 README、SBOM 列表和 embedding 向量；读取一个仅含 6 个仓库的分组产生约 66 万 tokens 的工具输出。
- Reproduction: 调用 `devscope_get_group_members({ groupId: 2 })`。其他包含已向量化仓库的分组也具备相同失败条件。
- Evidence: [`groups.getWithMembers`](../../apps/api/src/router/groups.ts) 在仓库查询中使用无字段约束的 `.select().from(repositories)`；[`groupWithMembersSchema`](../../packages/client/src/contracts.ts) 将 `repository` 定义为 `z.unknown()`，因此重字段被完整透传。
- Impact: performance。会快速耗尽 Agent 上下文、增加 MCP 序列化和传输成本，并让本应简单的分组操作难以可靠完成。
- Frequency: reproducible
- Workaround: 优先使用 `devscope_list_repositories` 获取轻量列表；调用分组成员接口时在客户端只保留 `id`、`fullName`、`stars` 等摘要。调用端丢弃字段仍无法避免传输和上下文成本。
- Classification: 产品缺陷；查询与 MCP 输出契约过度返回。
- Related issue/checklist: none
- Timeline:
  - 2026-08-18: 在真实云端 dogfood 会话首次观察；确认数据库查询与 client schema 的直接原因，未修改代码。

### DF-20260818-003：许可证字段不能区分开源、source-available 与未识别

- Status: `open`
- Priority: `p2`
- Time: 2026-08-18
- Entry point: MCP `devscope_list_repositories` + GitHub 仓库核验
- User intent: 从多 Agent 项目中筛选真正有长期研究与复用价值的开源项目。
- Expected: 明确区分 OSI-compatible license、source-available/custom license、无许可证和未识别状态，并支持据此筛选或提示。
- Actual: 自定义许可证通常只显示 `NOASSERTION` 或空值，无法判断项目是无许可证、解析失败还是具有限制性 source-available 条款。
- Reproduction: DevScope 中 `golutra/golutra` 显示 `NOASSERTION`，但其 `LICENSE` 是 Business Source License 1.1；GitHub 对 `multica-ai/multica` 的自定义限制性许可证也无法给出标准 SPDX 分类。
- Evidence: [`golutra/golutra LICENSE`](https://github.com/golutra/golutra/blob/master/LICENSE) 限制生产使用并设置未来变更许可证；[`multica-ai/multica LICENSE`](https://github.com/multica-ai/multica/blob/main/LICENSE) 限制第三方托管和商业嵌入。
- Impact: wrong data / confusing UX。用户可能把 source-available 项目误当成标准开源项目，影响技术选型、分组和 Star 决策。
- Frequency: reproducible
- Workaround: 对 `NOASSERTION` 和空许可证手工读取仓库根目录 `LICENSE`，并在 DevScope note 中临时记录限制。
- Classification: 当前未支持能力；需要许可证语义分类，而不是简单把未知值强制映射成某个 SPDX 标识。
- Related issue/checklist: none
- Timeline:
  - 2026-08-18: 在多 Agent 生态筛选中首次观察；已确认两个真实仓库样本，尚未完成产品与数据模型归因。

### DF-20260818-004：分组不支持父子层级

- Status: `accepted`
- Priority: `p2`
- Time: 2026-08-18
- Entry point: MCP 分组规划 + 数据模型核验
- User intent: 在一个“多 Agent 编排工具”大分组下创建四个子分组，并让筛选后的仓库按层级归类。
- Expected: 大分组可以包含子分组；仓库在子分组中的成员关系能够通过父级汇总查看。
- Actual: DevScope 只有扁平分组和仓库到分组的多对多成员关系，没有 `parentId`、层级查询或父级汇总语义。当前 workaround 只能创建一个 umbrella 分组和四个平行分组，并重复关联仓库。
- Reproduction: 检查 `repository_groups` schema、分组 API/MCP 输入输出和 Web 分组页面；均没有父分组字段或子分组操作。
- Evidence: [`repositoryGroups`](../../packages/db/src/schema/index.ts) 只包含用户、名称、样式、描述、顺序和时间字段；[`groupMembers`](../../packages/db/src/schema/index.ts) 只表达分组与仓库的多对多关系。
- Impact: confusing UX。用户自然理解的“大类 → 子类”与产品实际能力不一致，也会造成 umbrella 与平行分组之间的成员重复维护。
- Frequency: reproducible
- Workaround: 保留 `多agent编排工具` 作为 umbrella，再创建四个平行分组；每次变更按“添加 → 验证 → 必要时移除”维护重复成员关系，并明确这不是原生层级。
- Classification: 当前未支持能力；需要产品决策是增加层级分组，还是明确采用扁平标签式多分组模型。
- Related issue/checklist: none
- Timeline:
  - 2026-08-18: 在确认多 Agent 项目采集状态时发现用户心智模型与当前分组数据模型不一致；通过源码确认，未修改产品实现。
  - 2026-08-18: 用户接受当前扁平 workaround，未来再评估树状或图状分组；已保留 `多agent编排工具` umbrella，并创建 group `5`–`8` 四个平行分组，最终成员数分别为 27、9、9、8、3。

### DF-20260818-005：已采集仓库没有删除或归档入口

- Status: `triaged`
- Priority: `p2`
- Time: 2026-08-18
- Entry point: MCP/CLI 能力核验 + API/Web 源码核验
- User intent: 在生态筛选后清理已经失去活跃价值、重复或不再希望保留的已采集仓库。
- Expected: 提供安全的 archive 或 delete 操作；删除前展示关联分组、chunks、embedding、分析记录等影响，并要求明确确认。
- Actual: MCP、CLI、当前 API 和 Web 都没有仓库 archive/delete 入口；只能移除分组成员关系。DB 包存在内部 `deleteRepository()` helper，但没有形成经过权限、影响检查和验证的产品能力。
- Reproduction: 查看 Agent 接口工具表和 CLI 命令，不存在 repository delete/archive；检索 API router 与 Web 操作也没有对应入口。
- Evidence: [`packages/db/src/collection.ts`](../../packages/db/src/collection.ts) 有内部 `deleteRepository()`；MCP/CLI 只暴露 collect、get、list、note、embedding status 和 group membership 操作。
- Impact: stale data / confusing UX。失去价值的仓库仍占用正式仓库列表、chunks 和 embedding 存储，也会影响仓库总数和用户对收藏集合的理解。
- Frequency: reproducible
- Workaround: 从所有活跃分组移除，并用 note 标记为历史、已停更或待清理；该操作不会删除仓库数据，也不会释放存储。
- Classification: 当前未支持能力；产品需要决定优先实现可恢复 archive，还是带依赖预览和确认门禁的永久 delete。
- Related issue/checklist: none
- Timeline:
  - 2026-08-18: 在清理原始多 Agent 项目集合时确认能力缺口；完成接口与源码核验，未直接操作 PostgreSQL。

### DF-20260818-006：MCP/CLI 未暴露已有分组编辑与原子移动能力

- Status: `triaged`
- Priority: `p2`
- Time: 2026-08-18
- Entry point: MCP/CLI 分组操作 + API 源码核验
- User intent: 在 dogfood 会话中重新归类仓库，并按需要修改分组名称、说明和顺序。
- Expected: Operator 能调用产品已有的分组更新、删除、排序及成员移动能力，并在写入后读取验证。
- Actual: API 已实现 `groups.update`、`groups.delete`、`groups.reorder`、`groupMembers.move` 和 `groupMembers.reorder`；MCP/CLI 仅开放 create、list、members、add、remove。仓库归属仍能通过 add/remove 调整，但无法通过 Operator 原子移动，也不能编辑或排序分组本身。
- Reproduction: 查看 `docs/AGENT_INTERFACES.md` 的 CLI 命令和 MCP 工具表，再与 `apps/api/src/router/groups.ts` 的分组 router 对照。
- Evidence: [`groupsRouter`](../../apps/api/src/router/groups.ts) 包含 update/delete/reorder；[`groupMembersRouter`](../../apps/api/src/router/groups.ts) 包含 move/reorder；[`Agent 接口说明`](../AGENT_INTERFACES.md) 未列出对应 CLI 命令或 MCP 工具。
- Impact: confusing UX。产品能力与 Agent 操作面不一致；复杂调整需要多次写入，且用户难以判断“改分组”究竟支持到哪一层。
- Frequency: reproducible
- Workaround: 调整仓库归属时先添加到目标分组并验证，再从来源分组移除并二次验证；分组名称、说明、顺序和删除需改用已有 Web/API 入口，当前 DevScope Operator 不直接执行。
- Classification: 操作器摩擦；底层产品能力已经存在，但 MCP/CLI 覆盖不完整。
- Related issue/checklist: none
- Timeline:
  - 2026-08-18: 用户询问原九个项目是否进入细分组及能否改分组；实时核对成员关系并确认 MCP/CLI 与 API 的能力差异，未修改产品实现。

## 新条目模板

```markdown
### DF-YYYYMMDD-NNN：<short title>

- Status: `open`
- Priority: `p0 | p1 | p2`
- Time:
- Entry point: MCP | CLI | Web
- User intent:
- Expected:
- Actual:
- Reproduction:
- Evidence: request/job/execution/repository identifiers, source locators and redacted logs
- Impact: blocked | wrong data | stale data | confusing UX | performance
- Frequency: once | intermittent | reproducible
- Workaround:
- Classification: 产品缺陷 | 数据一致性 | 操作器摩擦 | 当前未支持能力 | 待归因
- Related issue/checklist: none
- Timeline:
  - YYYY-MM-DD: observation created
```
