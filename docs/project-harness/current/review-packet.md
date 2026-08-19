# Review Packet

## Subject

- Checklist item: `platform-ai-7-minimax-m3-default`
- Reviewer: `reviewer-impl`
- Updated at: `2026-08-19`
- Canonical plan path: `docs/project-harness/tasks/platform-ai-7-minimax-m3-default/plan.md`

## Item Snapshot

- Title: 将分析模型默认切换到 MiniMax M3
- Status: doing
- Workflow status: running
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

## Review Focus

1. 当前计划或结果是否覆盖 acceptance
2. 是否越过 scope non-goals
3. 是否越过 architecture 模块边界
4. 是否偷偷吸收了未来 checklist item 的工作
5. 当前验证方式是否足以支持结束本轮

