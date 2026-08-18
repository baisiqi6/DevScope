# DevScope 协作说明

本文是仓库内 AI 编码代理和维护者的工作约束。说明以中文为主，代码标识、命令和文件路径保留英文。

## 项目定位

DevScope 是仍在使用的单用户私有开源生态分析平台。当前目标是先恢复可靠基线，再逐步演进到公开多用户产品。

不要把规划能力描述为已经完成，也不要把当前 `publicProcedure` 误认为可公开访问的鉴权设计。

## 渐进读取

项目事实从 [Harness 导航](docs/project-harness/scope.md) 开始读取：

1. 所有任务先读 `scope.md`、`progress.md` 和 `current/task_plan.md`；
2. 编码任务按需读 `architecture.md`；
3. 数据任务再读 `domain-model.md` 与对应 task plan；
4. 本地、迁移、部署和 dogfood 操作再读 `runbook.md`；
5. CLI/MCP 任务只在需要时读 `docs/AGENT_INTERFACES.md`。

架构、数据设计、任务状态、运行步骤和接口说明分别只有上述一个事实来源。`README.md` 与本文只提供入口和强制约束，不复制可独立演进的正文。

涉及 checklist、owner/lease、handoff、review、closeout 或跨会话恢复时，必须使用已安装的 `long-running-project-harness` skill 解释和更新协议状态，不另写一套 Harness 语义。

## 技术、目录与开发入口

当前技术栈、组件职责、依赖方向和端口只维护在 [architecture.md](docs/project-harness/architecture.md)；本地安装、启动、环境变量和命令只维护在 [runbook.md](docs/project-harness/runbook.md)。如果文档与源码、配置或运行状态冲突，以当前源码和实测结果为准，并在同一批次修正对应权威文件。

新增功能应放在架构文档定义的现有职责中，避免新建重复抽象或第二套数据模型。

## 修改原则

1. 先确认当前行为和失败条件，再做最小范围修改。
2. 修复根因，不通过关闭类型检查、跳过测试或扩大 `any` 掩盖问题。
3. API 输入输出使用 Zod；跨包类型优先放在 `packages/shared`。
4. 数据访问必须为未来租户隔离预留清晰的 `userId` 边界。
5. AI 结构化输出必须经过 schema 验证，不直接信任模型文本。
6. 后续外部工作流系统必须通过独立适配边界接入，不得破坏稳定核心路径。
7. 不提交 `.env`、令牌、密码、生产备份或生成的认证文件。

## 数据库规则

- 修改 schema 后运行 `pnpm db:generate` 并审查迁移；
- `pnpm db:push` 只允许用于本地开发；
- 生产变更必须有显式迁移、备份和回滚步骤；
- 公开多用户版前必须复核外键、唯一约束和所有按用户过滤的查询。

## 文档规则

- 项目文档以中文为主，不维护全英文版本；
- 只保留能指导当前开发、架构或生产操作的文档；
- 历史提案、已完成迁移记录和包级重复 README 应删除或交由 Git 历史保存；
- 命令、环境变量、类型名、接口路径等精确技术标识保留英文；
- 代码或配置变更影响使用方式时，同一批次更新相应文档。

## 验证门禁

提交前运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

如果某项因环境限制无法运行，必须明确说明未验证项和原因。测试通过不代表生产可用；涉及部署时还要验证容器健康、反向代理、访问控制和外部请求。

## Git 与部署

提交信息使用 Conventional Commits：

```text
feat(api): 添加分析接口
fix(web): 修复页面状态
docs: 更新中文运行手册
chore: 整理工程基线
```

生产部署遵循 [运行手册](docs/project-harness/runbook.md)：工作树必须干净，只允许 fast-forward 更新，不自动执行 `db:push`，不得因 DevScope 部署重启或覆盖同机的其他站点配置。
