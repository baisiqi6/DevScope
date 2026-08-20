# DevScope 项目范围与 Harness 导航

本文是 DevScope 长期目标、当前范围、非目标和文档权威边界的唯一事实来源。新会话先读本文件，再按任务需要渐进读取其他文件。

## 项目目标

DevScope 是仍在使用的单用户私有开源生态分析平台，面向技术投资人和独立开发者，集中处理 GitHub 仓库采集、关注与分组、健康分析、趋势发现、关系图谱和语义搜索。

当前目标是先保持单用户私有版可靠运行，修复已经由源码与生产证据确认的数据正确性风险，再逐步评估公开多用户产品。规划能力不得描述为已经实现。

## 当前范围

- 维护现有 Web、API、Worker、CLI、MCP 和 CLI Skills；
- 保持 GitHub Trending 与 DevScope 发现榜两条独立管线；
- 完成数据身份、Release ID、采集原子性、技术栈实体、deps.dev 缓存和 PostgreSQL 集成测试整改；
- 通过 DevScope MCP 持续 dogfood 仓库采集、分组、备注、搜索和分析；
- 为未来多用户隔离保留明确 `userId` 边界。

## 非目标

- 当前不把 `publicProcedure` 解释为公共匿名访问或完整鉴权；
- 当前不开放公共多用户服务；
- 不引入 CQRS、事件溯源、图数据库、第二套任务队列、通用 Repository 框架或插件系统；
- 不因为建立 Harness 就接入 Coordinate、MultiNexus executor 或 Discord/KOOK bridge；
- 不让 dogfood 会话绕过 API/MCP 直接修改 PostgreSQL；
- 不在没有独立授权时执行生产迁移、部署、删除、push 或公开发布。

## 部署形态

- Harness profile：`standalone`；
- 风险模式：数据整改任务使用 `high-risk`；普通小修仍按 `ordinary` 处理；
- EXharness skill 是协议与通用运行逻辑的唯一实现；本目录只保存 DevScope 实例状态，不复制第二套通用脚本；
- 当前只有一个代码写入主线，不启用跨主机 coordinator；
- `events.jsonl` 只保存本地关键事件，不是可靠消息总线；
- 当出现 durable job/lease/receipt、多个并行写入者或跨主机托管执行需求时，再评估 Coordinate 和 MultiNexus。

## 文档权威映射

| 文件 | 唯一职责 | 不负责 |
|---|---|---|
| `scope.md` | 长期目标、范围、非目标、authority 和文档导航 | 组件实现、执行进度 |
| `architecture.md` | 当前已实现架构、目录职责、依赖和数据流 | 计划状态、操作步骤 |
| `domain-model.md` | 数据实体、约束、已确认风险和目标设计 | 当前进度、部署操作 |
| `harness-checklist.json` | 粗粒度 item 状态、依赖、owner、acceptance、verification | 详细设计和逐步计划 |
| `tasks/<item-id>/plan.md` | 单个 item 的唯一执行计划 | 项目总范围、其他 item 状态 |
| `progress.md` | 日期化基线证据、已完成摘要、当前 handoff | 稳定设计规范 |
| `runbook.md` | 本地开发、验证、生产部署、回滚和 dogfood 操作 | 架构设计、任务状态 |
| `dogfood-observations.md` | 持久 dogfood 会话中的产品观察、证据、状态与关联 locator | 修复计划、checklist 状态、操作步骤 |
| `../AGENT_INTERFACES.md` | CLI/MCP 命令、工具契约和连接方式 | 应用业务逻辑、生产部署 |
| `../../README.md` | 面向使用者的项目概览和最短启动入口 | 详细架构与工程状态 |
| `../../AGENTS.md` | Agent 必须先读取的约束与路由 | 重复维护上述规范正文 |

同一事实只允许一个权威正文。其他文件需要该事实时使用链接或极短摘要，不复制可独立演化的表格、步骤、状态或验收条件。若源码、运行状态与文档冲突，先以源码和实测为准，再在同一批次修正对应权威文件。

## 渐进读取顺序

1. 所有任务：`scope.md` → `harness-state.json`（若存在）→ `progress.md` → `current/task_plan.md`；
2. 编码与架构任务：再读 `architecture.md`；
3. 数据库任务：再读 `domain-model.md` 和当前 item plan；
4. 本地、迁移、部署或 dogfood：再读 `runbook.md`；涉及 dogfood 产品反馈时同时读取并更新 `dogfood-observations.md`；
5. CLI/MCP 操作：只在需要时读 `../AGENT_INTERFACES.md`。

不要为了“了解项目”一次性加载全部历史证据；以当前 item 的 acceptance 和 artifact locator 为边界。

## Authority 边界

- 文档和 checklist 不授予生产写入、部署、删除、commit、push 或公开发布权限；
- Worker 可以在明确的本地代码范围内实现，不能自行扩大到生产；
- Reviewer 的 verdict 是质量证据，不是 mutation authority；
- 生产迁移必须逐批取得明确授权并遵循 `runbook.md` 的备份、演练、验证和回滚门禁；
- 凭据、生产备份、原始 provider 日志和私有数据不得进入 Git。
