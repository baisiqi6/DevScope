# Closeout Packet

## Subject

- Checklist item: `platform-ai-7-minimax-m3-default`
- Reviewer: `reviewer-closeout-mm`
- Updated at: `2026-08-19`
- Canonical plan path: `docs/project-harness/tasks/platform-ai-7-minimax-m3-default/plan.md`

## Item Snapshot

- Title: 将分析模型默认切换到 MiniMax M3
- Status: doing
- Workflow status: closeout_requested
- Priority: p1
- Owner: codex
- Session: codex-20260819-minimax
- Dependencies: None

## Acceptance

通过现有 OpenAI-compatible seam 将 API/Worker 切到 MiniMax-M3；complete/stream/structured/tool/cancel 真实探针和自动测试通过，secret 不落盘，DeepSeek rollback 可用，BGE-M3 embedding 不变。

## Verification



## Handoff

可与数据库整改并行；先用 Token Plan key 做脱敏 contract probe，再做最小兼容修复与 canary，不能只改环境变量直接全量生产切换。

## Review Inputs

- Scope: `docs/project-harness/scope.md`
- Architecture: `docs/project-harness/architecture.md`
- Domain model: `docs/project-harness/domain-model.md`
- Progress: `docs/project-harness/progress.md`
- Review output target: `docs/project-harness/current/review.md`

## Canonical Plan Content

```md
# 将分析模型默认切换到 MiniMax M3

## Item

- Checklist item：`platform-ai-7-minimax-m3-default`
- Priority：P1
- 可与数据整改并行，不阻断 Phase A/B/C

## Outcome

复用现有 OpenAI-compatible seam，把 DevScope 的文本补全、流式输出、结构化分析和 Agent tool calling 从当前 DeepSeek 生产配置切到用户的 MiniMax Token Plan，模型为 `MiniMax-M3`。BGE-M3 embedding 保持不变；本 item 不改向量维度、embedding endpoint 或数据库 schema。

## Confirmed Provider Contract

截至 2026-08-18，MiniMax 官方文档确认：

- OpenAI-compatible endpoint：国际站 `https://api.minimax.io/v1`，中国大陆站对应 `https://api.minimaxi.com/v1`；必须使用签发 Token Plan key 的同站 endpoint，不能混用；
- model ID：`MiniMax-M3`；
- `/v1/chat/completions` 支持 non-stream、stream 与 function tools；
- 推荐参数为 `max_completion_tokens`，`max_tokens` 已标记 deprecated；
- M3 默认 adaptive thinking，可能把 thinking 放入 `content`，也支持 `reasoning_split`；
- 官方当前 OpenAI-compatible reference 未声明 `response_format: {type: "json_object"}`。

因此不能把“OpenAI-compatible”理解成所有扩展参数完全等价。实现前必须用用户 Token Plan key 运行脱敏 contract probe；token 只进入本地/生产 secret store，不写 Git、Harness、日志或命令历史。

官方参考：

- [MiniMax OpenAI Chat Completions API](https://platform.minimax.io/docs/api-reference/text-chat-openai)
- [MiniMax M3 model](https://www.minimax.io/models/text/m3)
- [MiniMax model list API（中国大陆站）](https://platform.minimaxi.com/docs/api-reference/models/openai/list-models)

## Architecture Decision

保留 `OPENAI_COMPATIBLE_API_KEY`、`OPENAI_COMPATIBLE_BASE_URL`、`OPENAI_COMPATIBLE_MODEL` 为唯一优先配置边界；`DEEPSEEK_*` 暂作显式 rollback compatibility，不新增 `MINIMAX_*` 变量、Provider registry、Strategy hierarchy 或第二套 AI client。

仅在 live probe 证明参数差异时，给现有 client 增加最小 capability 配置/适配：

- generation length 统一发 `max_completion_tokens`；若需兼容旧 provider，在内部做一个可测试的 request builder，而不是在调用点散落 provider name 判断；
- M3 structured output 优先选择官方支持且 probe 成功的方式。若 `response_format` 不被接受，则移除该未声明参数，使用严格 JSON prompt + thinking separation/disable + `JSON.parse` + 现有 Zod validation；禁止用正则剥离 `<think>` 后假装结构化成功；
- tool calling 必须保留 tool call ID、arguments、multi-round history 与 AbortSignal；不为 M3 另写 Agent loop；
- reasoning 内容不得进入 JSON parser、用户最终报告或日志中的敏感上下文。

## Execution Plan

### 1. Secret and endpoint preflight

由用户在 MiniMax Token Plan 控制台生成/取得 key，并通过现有生产 secret 安装流程写入：

```text
OPENAI_COMPATIBLE_API_KEY=<secret>
OPENAI_COMPATIBLE_BASE_URL=https://api.minimax.io/v1
OPENAI_COMPATIBLE_MODEL=MiniMax-M3
```

如果 key 来自中国大陆站，Base URL 改为 `https://api.minimaxi.com/v1`。在不打印 key 的前提下调用 `GET /v1/models`，确认同一 key 可见 `MiniMax-M3`。禁止把真实值写入 `.env.example`、PR、CI artifact 或聊天记录。

### 2. Live compatibility probe

使用最小、无业务数据的请求依次验证：

1. non-stream 文本补全；
2. stream chunk 拼接与正常终止；
3. `max_completion_tokens`；
4. 单 tool call、多 tool round、tool arguments JSON；
5. structured JSON：分别验证官方支持参数与严格 prompt 路径，确认 thinking 不污染 JSON；
6. AbortSignal、timeout、401、429、5xx 和 malformed response；
7. usage 的 prompt/completion token 统计缺失时不崩溃。

probe 结果只记录状态、延迟、HTTP/error class 和脱敏 schema outcome，不保存完整 prompt/response。

### 3. RED tests and minimal code changes

- 为 request builder 固化 `max_completion_tokens`，防止各调用点继续发送 deprecated 参数；
- 构造带 thinking 的 structured response，证明旧 `JSON.parse(content)` 失败，再实现不依赖 tag stripping 的兼容路径；
- tool calling 测试覆盖工具定义、arguments validation、多个 round、取消和 max round；
- 保持 `resolveOpenAICompatibleConfig` 的优先级与 DeepSeek rollback tests；
- `.env.example` 改为 provider-neutral 示例，并在注释中给出 MiniMax M3 非秘密值；
- `docker-compose.yml` 继续透传 generic vars，DeepSeek fallback 是否保留由 compatibility test 决定；
- 更新 architecture/runbook：生产默认改为 MiniMax M3，embedding 仍为 BGE-M3 1024。

### 4. Quality and dogfood gates

- focused `packages/ai` tests 与受影响 API/Worker tests；
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- 独立 implementation review，重点检查 structured output fail closed、secret leakage、provider coupling 和 rollback；
- staging/local 真实 Token Plan dogfood：至少一次 repository health analysis、一次 SSE Agent tool flow、一次 durable `analysis.health` Worker flow；
- 输出必须经过现有 Zod schema，数据库只提交完整 workflow report，失败不能伪装 completed。

### 5. Production canary and rollback

1. 记录当前 DeepSeek 配置键名、镜像 revision、成功报告基线和回滚值，不记录 secret；
2. 安装 MiniMax secret，先只重启/切换单一可控 consumer 做 canary，确认 API/Worker 不出现 revision/config split；
3. 验证 health、外层 401、认证 MCP、一次非流式分析、一次流式 Agent、一次 Worker job；
4. 观察 error rate、latency、empty output、Zod failure、tool-loop exhaustion 与 token usage；
5. canary 通过后再把 API/Worker 都切到 `MiniMax-M3`；
6. 任一 gate 失败，恢复上一组 `OPENAI_COMPATIBLE_*`/`DEEPSEEK_*` 值并重启受影响服务；数据库无 migration，无需数据回滚；
7. 独立 production closeout approved 后更新 production verification。

## Non-Goals

- 不替换 BGE-M3 embedding，不改 pgvector 1024 维；
- 不引入多 provider 动态路由、自动 fallback、模型 A/B 平台或计费系统；
- 不把 MiniMax Token Plan key 交给浏览器或前端；
- 不在本 item 调整 prompts 的业务内容或重做分析产品 UX；
- 不与技术栈 schema migration 或 cleanup 同批部署。

## Exit Criteria

- 生产 API/Worker 的 generic config 指向正确站点的 `MiniMax-M3`；
- complete、stream、structured output、tool calling、cancel/error paths 均通过真实 probe 与自动测试；
- structured result 继续 `JSON.parse` + Zod fail closed，thinking 不污染结果；
- secrets 未进入 Git/日志/artifact，DeepSeek rollback 已演练；
- BGE-M3 embedding 与数据库向量契约完全不变，独立 production closeout approved。
```

## Recent Progress Context

```md
### 上一 handoff（1b 已并入 main，存档）



- 最近完成 item：`data-correctness-1a-release-id-bigint`；
- Canonical plan：`tasks/data-correctness-1a-release-id-bigint/plan.md`；
- Verification：`tasks/data-correctness-1a-release-id-bigint/verification.md`；
- 独立 correctness/迁移 review 与生产 closeout review 均已批准，生产验收已经落盘；
- 最近完成 item：`data-correctness-1b-repository-identity`；
- Canonical plan：`tasks/data-correctness-1b-repository-identity/plan.md`；
- Production baseline：`tasks/data-correctness-1b-repository-identity/verification.md`；
- 生产只读预检发现 22 个真实仓库中 19 个可解析稳定 ID、3 个 unresolved；Radar 有 1 组可确定性合并的同 ID 重复；
- 两轮 continuity review 已关闭 compatibility/backfill 窗口、lease 原子授权、不可变审计、Radar 全序 tie-break 与 active singleton 风险，最终 verdict 为 `APPROVE`；
- 稳定 ID 边界、ID-first repository/Radar 写入、one-shot backfill、lease 原子 apply、`0007` 合并迁移与 compatibility/cutover 已完成；
- 首轮实现审查发现的 Radar ID 擦除、following 错误关联和终态 version 伪报问题均已修复，continuity verdict 为 `APPROVE`；
- 全仓 lint/typecheck/test/build、真实 PostgreSQL 演练与迁移再生成检查通过；PR/CI、显式迁移、one-shot backfill、cutover 与独立 closeout 已完成；下一步先用独立小 item 修复 dogfood 暴露的 group count 契约，再进入 `data-correctness-2-atomic-replacement`。
- 最近完成 item：`data-correctness-2-atomic-replacement`；
- Canonical plan：`tasks/data-correctness-2-atomic-replacement/plan.md`；
- Verification：`tasks/data-correctness-2-atomic-replacement/verification.md`；
- 原子快照、版本安全 embedding、PR/CI、无迁移部署、生产 MCP dogfood 与独立 closeout 均已完成；下一 item 为 `data-architecture-3-technology-stack-entities`。
- 当前 item：`data-architecture-3-technology-stack-entities`；
- Canonical plan：`tasks/data-architecture-3-technology-stack-entities/plan.md`；
- Verification：`tasks/data-architecture-3-technology-stack-entities/verification.md`；
- Phase A expand、precision fix、versioned backfill、shadow zero-diff 与生产 MCP/health/auth 证据均已完成；独立 production closeout 尚未执行。下一步先完成 `data-correctness-4-deps-cache-recovery` 的恢复语义和外呼预算，再由 Reviewer 复核，不能提前进入 Phase B 或标记 done。
- 可并行 item：`platform-ai-7-minimax-m3-default`；其 provider 迁移与数据整改使用独立 PR、部署和 closeout。
- 后续串行 item：Phase A closeout -> `data-quality-5-postgres-integration-gates` -> Phase B -> Phase C。

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
```

## Current Review Content

```md
# 当前审查

`data-architecture-3-technology-stack-entities` 的 Phase A expand、precision fix、versioned backfill、生产 shadow zero-diff 与 MCP/health/auth 已完成；证据见 [任务验证记录](../tasks/data-architecture-3-technology-stack-entities/verification.md)。生产 graph rebuild 虽正确成功，但 70 分 44 秒的冷缓存路径暴露外呼 timeout/budget/freshness/progress P1，唯一后续方案为 [依赖解析缓存恢复与外呼预算计划](../tasks/data-correctness-4-deps-cache-recovery/plan.md)。当前暂停在 Phase A production closeout 前；Reviewer 批准 item 4 和 Phase A closeout 前不得进入 Phase B/C 或标记整个 item 完成。
```

## Closeout Questions

1. 当前实现是否已经覆盖 acceptance
2. verification 是否足以支持从 `doing` 进入 `done`
3. 还有没有阻止 closeout 的高优先级问题
4. 如果不能 done，最关键的剩余工作是什么
