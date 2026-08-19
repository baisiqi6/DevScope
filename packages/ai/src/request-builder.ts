// ============================================================================
// OpenAI-compatible 请求体构建边界
//
// 2026-08-19 MiniMax M3 真实 Token Plan probe 确认的契约差异（唯一事实来源：
// task platform-ai-7 的 verification）：
//   1. MiniMax 的 thinking 默认 adaptive 且把 <think> 写入 content，
//      必须显式 thinking:{type:"disabled"} 才能获得纯 JSON / 干净工具输出；
//   2. MiniMax 请求 schema 未声明 response_format（被静默忽略，不能依赖）；
//   3. MiniMax 将 max_tokens 标记 deprecated，推荐 max_completion_tokens。
// DeepSeek 回滚路径保持现状行为：max_tokens + response_format json_object。
// provider 差异只允许出现在本模块，调用点不得散落 provider 判断。
// ============================================================================

export interface ProviderCapabilities {
  /** token 上限参数名：MiniMax 用 max_completion_tokens，其余按 OpenAI 传统 max_tokens */
  maxTokensParam: "max_completion_tokens" | "max_tokens";
  /** 注入 thinking:{type:"disabled"}（MiniMax M 系列；关闭 <think> 污染 content） */
  disableThinking: boolean;
  /** 发送 response_format json_object（仅对声明支持该参数的 provider；MiniMax 不发） */
  sendResponseFormatJsonObject: boolean;
}

const MINIMAX_MODEL_RE = /^minimax-/i;

export function resolveProviderCapabilities(model: string): ProviderCapabilities {
  if (MINIMAX_MODEL_RE.test(model)) {
    return {
      maxTokensParam: "max_completion_tokens",
      disableThinking: true,
      sendResponseFormatJsonObject: false,
    };
  }
  // 未知 provider 按 DeepSeek 兼容处理，保证回滚路径行为与迁移前一致
  return {
    maxTokensParam: "max_tokens",
    disableThinking: false,
    sendResponseFormatJsonObject: true,
  };
}

export interface ChatRequestBodyInput {
  model: string;
  messages: Array<Record<string, unknown>>;
  maxTokens?: number;
  defaultMaxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: Array<Record<string, unknown>>;
  /** structuredComplete 场景：对支持方发送 json_object；MiniMax 不发送 */
  structured?: boolean;
}

export type ChatRequestBody = Record<string, unknown>;

export function buildChatRequestBody(
  input: ChatRequestBodyInput,
  capabilities: ProviderCapabilities,
): ChatRequestBody {
  const body: ChatRequestBody = {
    model: input.model,
    messages: input.messages,
    [capabilities.maxTokensParam]: input.maxTokens ?? input.defaultMaxTokens,
  };
  if (input.temperature !== undefined) {
    body.temperature = input.temperature;
  }
  if (input.stream) {
    body.stream = true;
  }
  if (input.tools) {
    body.tools = input.tools;
  }
  if (capabilities.disableThinking) {
    body.thinking = { type: "disabled" };
  }
  if (input.structured && capabilities.sendResponseFormatJsonObject) {
    body.response_format = { type: "json_object" };
  }
  return body;
}
