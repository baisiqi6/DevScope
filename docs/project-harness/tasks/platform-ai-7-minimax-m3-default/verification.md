# Implementation Verification：platform-ai-7-minimax-m3-default

> 记录日期：2026-08-19（UTC）
> 分支：`codex/minimax-m3-default`（base `main@b9db721`）
> 状态：代码与 probe 完成，待独立 implementation review 与 PR/CI；生产 canary 与切换需用户单独授权

## Contract Probe（真实 Token Plan，2026-08-19）

Endpoint：`https://api.minimaxi.com/v1`（大陆站）。预检 `GET /v1/models` HTTP 200，key 可见 `MiniMax-M3`（另有 M2.7/M2.5/M2.1 系列）。

第一轮（默认配置）：

| 探针 | 结果 |
|---|---|
| non-stream 补全 | ✓ 2.9s，finish=stop，usage 完整（prompt/completion/reasoning tokens 分列） |
| stream | ✓ chunk 拼接正常、finish=stop；**默认 content 以 `<think>` 开头**；stream 无 usage（不崩溃） |
| max_completion_tokens=8 | ✓ 精确尊重（completion_tokens=8, finish=length）；reasoning 计入上限 |
| 单 tool call | ✓ call id（`call_b…`）、arguments 合法 JSON |
| 多 tool round | ✓ round1 双调用、tool role 回填后 round2 正常、id 保持 |
| response_format=json_object | **被接受但无效**（未声明参数，输出仍被 thinking 污染，JSON.parse 失败） |
| 严格 prompt 压制 thinking | **失败**（content 首字符非 `{`，含 `<think>`） |
| AbortSignal 5ms | ✓ 6ms 中止 |
| 假 key | ✓ HTTP 401 |
| 不存在模型 | ✓ HTTP 400 |

第二轮（官方参数定向，依据官方文档 `thinking.type: disabled|adaptive`、`reasoning_split`）：

| 探针 | 结果 |
|---|---|
| thinking=disabled + 严格 prompt | ✓ 纯 JSON（`{"score":87,…}` 29 字符）、first_brace=true、reasoning_tokens=0 |
| thinking=disabled + response_format | ✓ 纯 JSON（但 response_format 本身无效，不依赖） |
| reasoning_split=true | ✓ content 干净、`reasoning_content` 单独字段 |
| thinking=disabled + stream | ✓ 纯 JSON |
| tools × 四种组合 | 全部正确调用 get_weather 且 args 正确；**disabled 组合 content 长度 0（完全干净）**、adaptive 组合 content 含 `<think>` |

结论（实现依据）：**统一 `thinking: {type:"disabled"}`**——结构化输出与工具调用的 content 都干净且可靠；`response_format` 从 MiniMax 路径移除（未声明参数）；token 上限参数用 `max_completion_tokens`。429/5xx 未主动触发（无注入手段，记录为未验证）。

## 实现范围

- `packages/ai/src/request-builder.ts`（新）：`resolveProviderCapabilities(model)`（`/^minimax-/i` → max_completion_tokens + thinking disabled + 不发 response_format；其余按 DeepSeek 兼容 = 迁移前行为）与 `buildChatRequestBody`（纯函数，provider 差异唯一收口点）。
- 四个调用点改造：`AIProvider.complete/stream/structuredComplete` + `DevScopeAgent` 循环请求。SDK 类型边界处显式 cast（builder 含 SDK 未覆盖的扩展键），流式返回类型显式还原。
- **fail closed 保留**：thinking 污染的 content 在 `JSON.parse` 处抛错，不做 `<think>` 正则剥离（plan 明令禁止）；预防在请求层（disabled）。
- 文档：`.env.example`（provider-neutral + MiniMax 三行示例 + 站点匹配警告）、`runbook.md`（provider 差异与回滚说明）、`architecture.md`（生产默认 MiniMax M3、embedding 不变）。
- compose 透传核对：`docker-compose.prod.yml` api/worker 均透传 `OPENAI_COMPATIBLE_*`（6 处）✓，无新增变量。
- 生产 `.env`（服务器侧）未改动——canary 阶段单独处理。

## 验证证据

- `packages/ai` 单测 **31/31**（新增：request-builder 10 例能力切换 + 3 例端到端断言——MiniMax complete/structured 请求体注入、污染 content fail closed；既有 DeepSeek 断言 `max_tokens`+`json_object` 原样通过 = 回滚行为不变）。
- 全仓门禁：lint 13/13、typecheck 14/14、test 11/11、build 9/9。
- 真实 probe 证据如上两表（脱敏：未记录完整 prompt/response 与 key）。

## Implementation Review（2026-08-19）

首轮 verdict：**approved**（无 P0-P2）。5 条 P3 处置：P3-1（probe 范围仅 M3 当前代，正则对 M2.x 生效——已在此记录，若未来默认切 M2.x 需重新 probe）；P3-2（maxTokens 0 语义从静默回退收紧为显式发送，无害）；P3-3（SDK cast 由单测逐键固化，可选交叉类型留后续）；P3-5（.env.example 风格已统一）；P3-4（Agent×MiniMax 端到端请求体断言已补）。

## 未验证项

- 生产部署与 canary（API/Worker 切换、SSE Agent flow、durable Worker flow、DeepSeek 回滚演练）——按 plan 需用户显式授权后执行；
- 429/5xx 真实响应路径（无注入手段；AbortSignal/401/400 已实测）。

## 生产切换与 canary（2026-08-19，用户授权）

### 基础设施波折（记录）

- deploy workflow 两次因服务器 git（gnutls）到 github.com TLS 失败；代码经 git bundle 前进到 59066cd；
- ghcr.io 对 docker daemon 持续 EOF（curl 可达但 daemon 不通）→ 改走本地构建 + docker save/scp/load（SSH 通道正常）；
- **第一次传输的镜像有误**：amd64 构建误在主仓库旧代码目录执行（b603b6c），上线后 canary 立即暴露 `<think>` 污染（旧代码无 thinking disabled）——已回滚 DeepSeek，改用 `git archive main`（59066cd）干净源码重新构建 amd64 后成功。教训已吸收：生产镜像构建必须绑定明确的 main SHA 源；
- 期间真实执行两次完整回滚（env 恢复备份 + 重启 + 健康验证），**DeepSeek rollback 路径得到实战演练**。

### 最终状态（gate 全过）

- 镜像：main@59066cd 干净源码的本地 amd64 构建（api/web/worker 三镜像经 save/scp/load 部署；服务器 worktree 同 SHA，revision 一致）；本地镜像已打 ghcr 同名 tag，后续 ghcr 恢复后 deploy.yml 可正常覆盖；
- env：`OPENAI_COMPATIBLE_{API_KEY,BASE_URL=https://api.minimaxi.com/v1,MODEL=MiniMax-M3}`（大陆站）；DeepSeek 三行保留为回滚配置，回滚 = 删除三行 + 重启（备份 `env-pre-minimax-cutover-20260819-165336` 亦在）；
- 健康：API/Web 200、公网 401、Worker 运行、`[AIProvider] Initialized with provider: openai-compatible, model: MiniMax-M3`；
- **durable canary**：`kevinelliott/agentpipe` 健康分析 job `succeeded`，usage 正常（9249/12059 tokens），无 `<think>` 污染（thinking disabled 生效）；report 入库（可选文件缓存 EACCES 为设计内非致命）；
- **SSE canary**：`/api/agent/workflow/stream` 完整事件链 init→tool_use×2→tool_result×2→text→report→detailed→complete；
- 无迁移、无数据回滚需求；BGE-M3 embedding 与 pgvector 1024 维不变。

## Production closeout（2026-08-19）

独立 closeout reviewer 实测 15 项全部一致（PR/health/401/provider/镜像 SHA/迁移数/canary succeeded+usage/无 think 污染/report 入库/备份与回滚配置/key 零泄漏）。Verdict：APPROVE（2 条 P3 措辞：DeepSeek 回滚指 env 默认 DEEPSEEK_* 落回；SSE 逐事件为间接确认——HTTP 200 + 时长与 execution 吻合）。
