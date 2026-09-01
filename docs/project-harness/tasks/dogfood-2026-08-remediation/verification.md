# Dogfood 五项问题整改验证记录

## 结论

- 本地实现已通过独立 Reviewer 最终只读复核，结论 `APPROVED`，无 P0–P2 阻断。
- 五条 observation 已更新为 `fixed_pending_verification`；本记录不表示生产已部署或验证。
- 未执行 commit、push、生产迁移、生产部署或真实数据删除。

## 已验证能力

- 分组成员与后代聚合仅返回受控仓库摘要；分组计数仅统计当前用户的非归档关注仓库。
- HN Algolia 使用 `hitsPerPage`，limit 有边界；空结果与 `parameter_error`、`transient_failure`、`unknown` 可区分。
- CLI/MCP 已暴露分组 update/delete，并对删除要求显式确认；权威 Agent 接口文档同步完成。
- 仓库支持 archive/unarchive、删除影响预检和显式确认永久删除；共享仓库删除使用事务级 advisory lock，双 watcher 并发删除不会遗留孤儿事实。
- 删除影响包含分组、chunks、Releases、HN、relationships、technology stacks 与其他 watchers。
- 许可证分类使用标准 SPDX allow-list；未知或自定义标识 fail-closed 为 `unknown`，支持常见 `LICENSE*`、`COPYING*` 文件回退和 source-available 文本识别。

## 门禁

- `pnpm lint`：通过，0 errors；18 条既有 Web warning。
- `pnpm typecheck`：通过。
- `pnpm test`：通过；DB 单元测试 14 files / 241 tests，API 12 files / 109 tests，其余 workspace 与 root pipeline 均通过。
- `pnpm build`：通过。
- 隔离 `pgvector/pgvector:pg16`：从全部迁移重放后，11 个 integration test 文件、62 项测试通过；包含分组跨用户/归档边界及双 watcher 并发删除。
- `git diff --check`：通过。

## 独立审查

Reviewer 首轮提出分组计数边界、未知 SPDX 误判、删除并发竞态、预检字段、HN 错误语义和 observation 回写问题；二轮提出 CLI 文档缺口。Worker 修复后，Reviewer 最终确认上述问题全部闭环，并给出 `APPROVED`。

## 生产后复查

生产动作需要独立授权。部署后至少验证：迁移 journal、容器健康、MCP/CLI 分组更新与删除确认、仓库 archive/unarchive、双 watcher/共享事实边界、许可证样本分类和 HN enrichment；随后再逐条将 observation 从 `fixed_pending_verification` 更新为 `closed` 或继续保留。
