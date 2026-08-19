/**
 * @package @devscope/ai
 * @description OpenAI-compatible AIProvider 与 TextChunker 单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

import { AIProvider, TextChunker } from "./index";

describe("AIProvider", () => {
  let ai: AIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    ai = new AIProvider({
      provider: "openai-compatible",
      apiKey: "test-api-key",
      baseURL: "https://api.example.com",
      defaultModel: "deepseek-chat",
      maxTokens: 4096,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("调用 OpenAI-compatible API 返回文本", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "你好" } }],
    });

    await expect(ai.complete("打个招呼", { system: "使用中文" })).resolves.toBe("你好");
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "deepseek-chat",
      max_tokens: 4096,
      messages: [
        { role: "system", content: "使用中文" },
        { role: "user", content: "打个招呼" },
      ],
    }));
  });

  it("通用 OpenAI-compatible 模型配置优先于 DeepSeek 回退", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_MODEL", "compatible-model");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-model");
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
    });

    const configured = new AIProvider({ apiKey: "test-api-key" });
    await configured.complete("test");

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "compatible-model",
    }));
  });

  it("流式转发文本片段", async () => {
    async function* chunks() {
      yield { choices: [{ delta: { content: "你" } }] };
      yield { choices: [{ delta: { content: "好" } }] };
    }
    mockCreate.mockResolvedValueOnce(chunks());
    const received: string[] = [];

    await ai.stream("打个招呼", (text) => received.push(text));

    expect(received).toEqual(["你", "好"]);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
  });

  it("对结构化输出执行 JSON 解析和 Zod 校验", async () => {
    const schema = z.object({
      score: z.number().min(0).max(100),
      category: z.enum(["high", "medium", "low"]),
    });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ score: 85, category: "high" }) } }],
    });

    await expect(ai.structuredComplete("分析项目", { schema })).resolves.toEqual({
      score: 85,
      category: "high",
    });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      response_format: { type: "json_object" },
    }));
  });

  it("MiniMax 模型：complete 注入 thinking disabled 并使用 max_completion_tokens", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "你好" } }],
    });
    const minimax = new AIProvider({
      provider: "openai-compatible",
      apiKey: "test-api-key",
      baseURL: "https://api.minimaxi.com/v1",
      defaultModel: "MiniMax-M3",
      maxTokens: 2048,
    });

    await minimax.complete("打个招呼");
    const body = mockCreate.mock.calls[0][0];
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toBeUndefined();
  });

  it("MiniMax 结构化输出：不发 response_format，thinking disabled 保证纯 JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ score: 88 }) } }],
    });
    const minimax = new AIProvider({
      provider: "openai-compatible",
      apiKey: "test-api-key",
      baseURL: "https://api.minimaxi.com/v1",
      defaultModel: "MiniMax-M3",
      maxTokens: 2048,
    });

    const result = await minimax.structuredComplete("分析", { schema: z.object({ score: z.number() }) });
    expect(result.score).toBe(88);
    const body = mockCreate.mock.calls[0][0];
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toBeUndefined();
  });

  it("content 被 thinking 污染时结构化输出 fail closed（不做标签剥离）", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '<think>推理过程……</think>{"score": 88}' } }],
    });
    const minimax = new AIProvider({
      provider: "openai-compatible",
      apiKey: "test-api-key",
      baseURL: "https://api.minimaxi.com/v1",
      defaultModel: "MiniMax-M3",
      maxTokens: 2048,
    });

    await expect(
      minimax.structuredComplete("分析", { schema: z.object({ score: z.number() }) }),
    ).rejects.toThrow();
  });

  it("拒绝不符合 Schema 的结构化输出", async () => {
    const schema = z.object({ score: z.number().max(100) });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ score: 150 }) } }],
    });

    await expect(ai.structuredComplete("分析项目", { schema })).rejects.toThrow();
  });

  it("缺少 API Key 时明确失败", () => {
    const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
    const previousCompatibleKey = process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;

    try {
      expect(() => new AIProvider()).toThrow("API Key is required");
    } finally {
      if (previousDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
      if (previousCompatibleKey === undefined) delete process.env.OPENAI_COMPATIBLE_API_KEY;
      else process.env.OPENAI_COMPATIBLE_API_KEY = previousCompatibleKey;
    }
  });
});

describe("TextChunker", () => {
  it("空文本返回空数组", () => {
    expect(new TextChunker().chunk("   ")).toEqual([]);
  });

  it("保留分块来源元数据", () => {
    const chunks = new TextChunker({ maxTokens: 20, overlapTokens: 2 }).chunk(
      "这是用于测试的较长文本。".repeat(20),
      "repo/readme",
      "readme"
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toEqual(expect.objectContaining({
      sourceId: "repo/readme",
      chunkType: "readme",
    }));
  });
});
