# DevScope Harness 进展

> 更新时间：2026-08-18
> 基线：`main@b64d6a0`
> 部署形态：Standalone
> 当前状态：首个数据 Correctness item 已通过独立 review，等待单独授权的生产验收

## 已完成

- 完成项目、文档、源码、测试和生产数据库的只读基线审计；
- 将项目范围、架构、数据模型、运行手册、任务状态和 task plan 拆成唯一事实来源；
- 建立高风险数据整改 checklist 和第一个 Release ID 任务计划；
- 保持 Agent/MCP 接口指南为独立接口文档，通过 Harness 单向引用。
- 完成 `releases.id` 的 Drizzle `bigint` 映射、无损采集边界、十进制字符串 API 契约和显式迁移；
- 删除 tag hash 伪 Release 降级，在本地 PostgreSQL 完成 188 条历史 fixture 升级与大 ID 往返演练；
- focused tests、全仓 lint/typecheck/test/build 与迁移再生成检查全部通过。
- 独立 reviewer 首轮提出 JavaScript safe integer 与迁移锁门禁问题；修订后 continuity 复核为 `APPROVE`。

## 已验证基线

2026-08-17 对 `main@b64d6a0` 与生产 PostgreSQL 完成只读检查：

- PostgreSQL 16.13，`vector` 0.8.2；
- `0000`–`0005` 六条迁移的 SHA-256 与生产迁移历史逐条一致；
- 1 个用户、20 个真实仓库、10 个技术栈 reference rows；
- 19173 个 chunks 全部含有 1024 维 embedding；
- 未发现重复 chunk key、workflow 用户错配、图自环、非法计数或 Trending 数量错配；
- DB 包 8 个测试文件、101 个单元测试通过，typecheck 通过；
- 现有持久化测试主要 mock Drizzle query builder，尚无真实 PostgreSQL 集成测试。

这些是日期化证据，不是永久不变的产品声明。需要依赖生产现状时必须重新验证。

## 当前 handoff

- 当前 item：`data-correctness-1a-release-id-bigint`；
- Canonical plan：`tasks/data-correctness-1a-release-id-bigint/plan.md`；
- Verification：`tasks/data-correctness-1a-release-id-bigint/verification.md`；
- 独立 correctness/迁移 review 已批准；在生产验收完成前不得标记 `done`；
- 尚未授权生产迁移或部署，生产状态保持 `UNVERIFIED`。

## Harness 初始化验证

- EXharness checklist semantic validator：通过，0 warnings；
- `harness-checklist.json` 与 `harness-config.json` JSON 解析：通过；
- 10 个 Markdown 文件的本地链接目标检查：通过；
- 旧文档路径残留检查与 `git diff --check`：通过；
- `pnpm lint`：通过，保留 16 个既有前端 warnings；
- `pnpm typecheck`、`pnpm test`、`pnpm build`：通过。

## 未关闭风险

风险定义与目标设计见 [domain-model.md](domain-model.md)，当前状态和依赖见 [harness-checklist.json](harness-checklist.json)。本文件不重复维护风险表。

## 更新规则

- 只记录日期化验证摘要、完成结果和下一 handoff；
- 稳定设计变化写入对应规范，不在此复制；
- item 状态只通过 checklist 更新；
- 详细执行轨迹、review 和 receipt 写入对应 task 目录；
- 历史细节由 Git 保存，不把本文件写成逐命令流水账。
