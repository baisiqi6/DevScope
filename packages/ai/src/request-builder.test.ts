import { describe, expect, it } from "vitest";
import {
  buildChatRequestBody,
  resolveProviderCapabilities,
} from "./request-builder";

// ============================================================================
// Provider 能力解析与请求体构建：MiniMax M3 契约 vs DeepSeek 回滚兼容
// 契约依据：2026-08-19 真实 Token Plan probe（见 task verification）
//   - MiniMax 文档 schema 无 response_format（被静默忽略，不能依赖）
//   - MiniMax thinking 默认 adaptive 且把 <think> 写入 content，
//     必须 thinking:{type:"disabled"} 才能得到纯 JSON/干净 tool content
//   - MiniMax 标记 max_tokens 为 deprecated，推荐 max_completion_tokens
//   - DeepSeek 回滚路径必须保持现状行为（max_tokens + json_object）
// ============================================================================

describe("resolveProviderCapabilities", () => {
  it("MiniMax-M3：切换到 max_completion_tokens、注入 thinking disabled、不发 response_format", () => {
    const caps = resolveProviderCapabilities("MiniMax-M3");
    expect(caps.maxTokensParam).toBe("max_completion_tokens");
    expect(caps.disableThinking).toBe(true);
    expect(caps.sendResponseFormatJsonObject).toBe(false);
  });

  it("MiniMax 前缀大小写不敏感（MiniMax-m3 等）", () => {
    expect(resolveProviderCapabilities("MiniMax-m3").disableThinking).toBe(true);
    expect(resolveProviderCapabilities("minimax-m3.5").disableThinking).toBe(true);
  });

  it("DeepSeek 回滚：保持 max_tokens、不注入 thinking、保留 json_object", () => {
    const caps = resolveProviderCapabilities("deepseek-chat");
    expect(caps.maxTokensParam).toBe("max_tokens");
    expect(caps.disableThinking).toBe(false);
    expect(caps.sendResponseFormatJsonObject).toBe(true);
  });

  it("其他未知 provider 按 DeepSeek 兼容处理（保守回滚）", () => {
    const caps = resolveProviderCapabilities("qwen-max");
    expect(caps.maxTokensParam).toBe("max_tokens");
    expect(caps.disableThinking).toBe(false);
  });
});

describe("buildChatRequestBody", () => {
  const base = {
    model: "test-model",
    messages: [{ role: "user" as const, content: "hi" }],
    maxTokens: 1000,
    temperature: 0.2,
  };

  it("MiniMax：body 含 max_completion_tokens 与 thinking disabled，不含 max_tokens/response_format", () => {
    const caps = resolveProviderCapabilities("MiniMax-M3");
    const body = buildChatRequestBody({ ...base, model: "MiniMax-M3" }, caps) as Record<string, any>;
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toBeUndefined();
    expect(body.model).toBe("MiniMax-M3");
    expect(body.messages).toEqual(base.messages);
    expect(body.temperature).toBe(0.2);
  });

  it("DeepSeek structured：body 含 max_tokens 与 response_format json_object，不含 thinking/max_completion_tokens", () => {
    const caps = resolveProviderCapabilities("deepseek-chat");
    const body = buildChatRequestBody({ ...base, model: "deepseek-chat", structured: true }, caps) as Record<string, any>;
    expect(body.max_tokens).toBe(1000);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("structured 请求：MiniMax 不发 response_format（未声明参数），由 thinking disabled 保证纯 JSON", () => {
    const caps = resolveProviderCapabilities("MiniMax-M3");
    const body = buildChatRequestBody(
      { ...base, model: "MiniMax-M3", structured: true },
      caps,
    ) as Record<string, any>;
    expect(body.response_format).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("structured 请求：DeepSeek 保留 json_object（回滚行为与现状一致）", () => {
    const caps = resolveProviderCapabilities("deepseek-chat");
    const body = buildChatRequestBody(
      { ...base, model: "deepseek-chat", structured: true },
      caps,
    ) as Record<string, any>;
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("stream 标记与额外字段透传（tools 等）", () => {
    const caps = resolveProviderCapabilities("MiniMax-M3");
    const tools = [{ type: "function", function: { name: "f", parameters: {} } }];
    const body = buildChatRequestBody(
      { ...base, model: "MiniMax-M3", stream: true, tools },
      caps,
    ) as Record<string, any>;
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual(tools);
    // 工具调用同样注入 thinking disabled（probe 证明 content 干净且调用可靠）
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("maxTokens 缺省时使用默认值", () => {
    const caps = resolveProviderCapabilities("MiniMax-M3");
    const body = buildChatRequestBody(
      { model: "MiniMax-M3", messages: base.messages, maxTokens: undefined, defaultMaxTokens: 4096 },
      caps,
    ) as Record<string, any>;
    expect(body.max_completion_tokens).toBe(4096);
  });
});
