# 外部资源正文采集显式启用入口

## Item

- Checklist item：`product-11a-external-resource-content-enable`
- 关联 dogfood observation：`DF-20260902-001`
- 风险模式：`high-risk`（持久数据状态、用户可见性、API/CLI/MCP/Web 写入口与生产部署）
- 依赖：`product-11-external-resource-content-ingestion`
- 当前阶段：本地实现与独立 review 已完成，等待生产受控验证

## 目标

让已保存的 `preview_only` 外部资源可以通过显式、单向且可审计的入口启用正文采集，修复
`DF-20260902-001`。启用后仍由既有异步 Worker 抓取，不能在请求线程联网。

## 边界

- 只允许 `preview_only → content`；不允许 `content → preview_only`。
- 已进入 `pending`、`processing`、`completed` 或 `failed` 的资源不能通过启用入口回退或重置状态。
- 保存资源默认仍为 `preview_only`，不自动抓取。
- 不新增第二套正文状态模型，不实现全文检索、chunks、embedding 或定时刷新。
- 生产部署、真实正文抓取和 observation 关闭必须在独立验证后执行。

## 实施阶段

1. **Phase 0：现状与契约**（complete）
   - 核对 shared/API/Client/CLI/MCP/Web 现有契约与单向状态规则。
2. **Phase 1：实现入口**（complete）
   - 增加 `enableContent` API/Client/CLI/MCP/Web；所有输出经 Zod 校验。
   - 用条件更新保证 owner/save 隔离与不可回退；保持 request-content 异步。
3. **Phase 2：验证与 review**（complete，独立 Reviewer `APPROVED`）
   - 补 API/Client/CLI/MCP/Web focused tests、生产资源只读与受控启用测试。
   - API 12、Client 14、CLI 23、MCP 11、Web 3 focused tests 与相关 typecheck 通过；启用入口不入队、不联网。
   - 全仓库门禁与独立 Reviewer 通过；生产受控验证尚未执行。

## 实现记录

- `enableContent` 已接入 shared/API/Client/CLI/MCP/Web；保存仍固定为 `preview_only`。
- API 使用 `ingestionMode=preview_only AND contentStatus=not_requested` 条件更新，确保并发下只有一个请求执行转换。
- 对已是 `content + not_requested` 的重复调用返回同一成功结果；其他已开始采集状态和异常组合均稳定拒绝。
- 启用动作只更新模式，不入队、不联网；后续仍复用既有 `requestContent` Worker 任务。

## 验收标准

- 资源 ID `2` 这类现有 `preview_only` 收藏可显式启用为 `content`。
- API/Client/CLI/MCP/Web 都能调用启用入口，并明确显示当前模式/状态。
- 非收藏、跨用户、已开始采集或已完成资源的非法转换被拒绝。
- 启用动作本身不联网；只有后续显式 request-content 才入队抓取。
- `DF-20260902-001` 只有在生产受控验证成功后才可关闭。

## 未授权动作

- 未通过独立 review 前不提交、部署或修改生产。
- 未经单独确认不触发真实正文抓取样本。

## 当前 Handoff

- 下一步需在获得生产授权后，通过隧道对资源 ID `2` 执行 `content-enable`，复查 `content` + `not_requested`；再决定是否显式 `content-request`。不绕过 API 修改数据库。

## Verification

- 独立 Reviewer `product11a_external_resource_reviewer` 已 `APPROVED`：启用条件、幂等、用户隔离和 Web/CLI/MCP/API 契约均通过审查。
- 本地 focused：API 12、Client 14、CLI 23、MCP 11、Web 3；相关 typecheck 通过。
- 全仓库 `corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build` 通过，仅有既有 lint/build warning。
- 生产资源 ID `2` 尚未执行 mutation；需获得单独授权后再做受控生产验证，并据此关闭 `DF-20260902-001`。
