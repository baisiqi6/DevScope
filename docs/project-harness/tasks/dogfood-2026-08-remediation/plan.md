# Dogfood 五项问题整改

## Item

- Checklist item：`dogfood-2026-08-remediation`
- 风险模式：`high-risk`（涉及 API 契约、仓库生命周期、schema/migration 与外部请求）
- 当前阶段：本地实现与验证；生产部署不在本轮默认授权内

## 目标

处理 `dogfood-observations.md` 中尚未关闭的五条观察：成员输出过大、Hacker News 400、Agent 分组操作面不完整、仓库缺少归档/删除、许可证语义不足。

## 实施阶段

1. 收紧 `groups.getWithMembers` 与聚合成员输出为稳定仓库摘要，补 API/Client/MCP 回归测试。
2. 修正 Hacker News 请求参数与 URL 编码/limit 边界，区分成功空结果、上游临时失败和参数错误，补 fixture 测试。
3. 沿用现有 groups router，在 Client/CLI/MCP 增加 update/delete 分组能力；删除前保留所有权校验和明确 destructive 标记。
4. 为 repositories 增加可恢复 `isArchived` 生命周期；提供 archive/unarchive 和带影响预检的 delete API，级联清理现有关联数据，补迁移与集成测试。
5. 增加许可证语义枚举/派生字段，保留原始 SPDX/NOASSERTION；对标准 SPDX、source-available/custom、无许可证、未识别给出可复算分类与 API/CLI/MCP 输出。
6. 跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和隔离 PostgreSQL 集成；独立 review 后更新 dogfood observation Timeline。

## 边界

- 不抓取文章正文，不启动公开多用户，不改变 HTTPS/域名配置。
- 不执行生产迁移、部署或删除；生产动作另行取得授权。
- 不复制第二套数据模型；新增字段必须服务现有 repositories 与 API 边界。

## 验收

- 五条 observation 均有明确 `closed`、`fixed_pending_verification` 或保留理由，不以单元测试代替生产复查。
- 输出体积、HN 失败语义、生命周期破坏性操作和许可证分类均有可重复测试。
