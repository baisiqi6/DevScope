# DevScope

DevScope 是一个面向技术投资人和独立开发者的开源生态智能分析平台。它把 GitHub 数据采集、项目健康度分析、趋势检索、报告生成和语义搜索集中到一个单用户私有工作台中。

> 当前状态：项目仍在使用，现阶段按“单用户私有版”维护。公开多用户能力尚未完成，不能把现有接口直接暴露为公共服务。

## 已实现能力

- GitHub 仓库采集、关注列表、分组与笔记
- 仓库健康度、竞争格局和趋势分析
- OSS Insight 数据检索
- DeepSeek / OpenAI-compatible AI 调用
- BGE-M3 向量嵌入与语义搜索
- Agent 流式健康分析、PostgreSQL 报告历史与报告重开
- `repo-fetch`、`repo-analyze`、`report-generate` 三个 CLI Skills

健康分析报告已使用 PostgreSQL 持久化，容器内文件只作为可选导出缓存。
调度器和其他报告链路仍属于实验能力，不应视为稳定的公开 API。后续工作流接入应通过独立适配边界实现。

## 技术栈

| 层级 | 技术                                           |
| ---- | ---------------------------------------------- |
| Web  | Next.js 15、React、Tailwind CSS、shadcn/ui     |
| API  | Fastify 5、tRPC、Zod                           |
| 数据 | PostgreSQL 16、pgvector、Drizzle ORM           |
| AI   | OpenAI-compatible、DeepSeek、BGE-M3            |
| 工程 | TypeScript、pnpm、Turborepo、Vitest            |

## 本地启动

环境要求：Node.js 20+、pnpm 9+、Docker。

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:push
pnpm dev
```

默认地址：

- Web：`http://localhost:3000`
- API：`http://localhost:3100`
- PostgreSQL：`localhost:5432`

`pnpm db:push` 只用于本地开发。生产环境必须使用经过审查的迁移，不允许在部署脚本中隐式推送 schema。

完整配置和排障说明见 [本地开发指南](docs/DEVELOPMENT.md)。

## 常用命令

```bash
pnpm dev          # 启动所有开发服务
pnpm lint         # ESLint 检查
pnpm typecheck    # TypeScript 与 Skills 类型检查
pnpm test         # 全量测试
pnpm build        # 全量构建
pnpm db:generate  # 生成 Drizzle 迁移
pnpm db:push      # 仅本地开发环境同步 schema
pnpm db:studio    # 打开 Drizzle Studio
```

## 项目结构

```text
apps/
  web/                    Next.js 前端
  api/                    Fastify + tRPC 后端
packages/
  ai/                     OpenAI-compatible AI 能力
  db/                     Drizzle、GitHub 数据与分析管道
  shared/                 Zod schema、共享类型与 GitHub 客户端
skills/
  repo-fetch/             仓库数据采集 CLI
  repo-analyze/           AI 健康度分析 CLI
  report-generate/        报告生成 CLI
docs/
  DEVELOPMENT.md          本地开发与验证
  PRODUCTION_RUNBOOK.md   生产部署与安全操作
```

详细边界和数据流见 [架构说明](ARCHITECTURE.md)。协作约束见 [AGENTS.md](AGENTS.md)。

## 当前边界与下一阶段

现有 API 使用 `publicProcedure`，部分数据路径仍依赖默认用户或首个用户语义。因此，下一阶段从私有版扩展到公开多用户版之前，至少需要完成：

1. 登录、会话与统一身份模型；
2. 所有查询和写入的租户隔离；
3. 数据库约束与正式迁移基线；
4. API 限流、审计、配额和密钥管理；
5. 多用户授权测试与生产可观测性。

生产环境当前必须由反向代理访问控制保护。操作方法见 [生产运行手册](docs/PRODUCTION_RUNBOOK.md)。

## 贡献与提交

提交信息采用 Conventional Commits，例如：

```text
feat(api): 添加仓库分析接口
fix(web): 修复报告加载状态
docs: 更新中文开发文档
```

提交前至少运行：

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
