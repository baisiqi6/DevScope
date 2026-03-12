/**
 * @package @devscope/ai
 * @description AIProvider 单元测试
 *
 * 测试 AIProvider 类的功能，包括：
 * - 基础方法（complete, stream）
 * - 结构化输出（structuredComplete）
 * - Zod Schema 到 JSON Schema 的转换
 *
 * @module index.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AIProvider, TextChunker } from "./index";
import type { MessageCreateParams } from "@anthropic-ai/sdk";

// ============================================================================
// Mock Anthropic SDK
// ============================================================================

/**
 * 模拟的 messages.create 函数
 */
const mockCreate = vi.fn();

/**
 * Mock Anthropic 模块
 */
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

// ============================================================================
// 测试套件
// ============================================================================

describe("AIProvider", () => {
  let ai: AIProvider;

  beforeEach(() => {
    // 重置所有 mock
    vi.clearAllMocks();

    // 创建 AIProvider 实例
    ai = new AIProvider({
      apiKey: "test-api-key",
      defaultModel: "claude-3-5-sonnet-20241022",
      maxTokens: 4096,
    });
  });

  // ========================================================================
  // 基础功能测试
  // ========================================================================

  describe("complete", () => {
    it("应该成功调用 Claude API 并返回文本", async () => {
      // Mock API 响应
      mockCreate.mockResolvedValue({
        content: [{ type: "text" as const, text: "Hello, World!" }],
      } as any);

      const result = await ai.complete("Say hello");

      expect(result).toBe("Hello, World!");
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 4096,
          messages: [{ role: "user", content: "Say hello" }],
        })
      );
    });

    it("应该支持自定义模型和参数", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text" as const, text: "Response" }],
      } as any);

      await ai.complete("Test", {
        model: "claude-3-opus-20240229",
        maxTokens: 1000,
        temperature: 0.5,
        system: "You are a helpful assistant.",
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-opus-20240229",
          max_tokens: 1000,
          temperature: 0.5,
          system: "You are a helpful assistant.",
        })
      );
    });

    it("应该在收到非文本响应时抛出错误", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "image" as const }],
      } as any);

      await expect(ai.complete("Test")).rejects.toThrow(
        "Unexpected response type from Anthropic API"
      );
    });
  });

  // ========================================================================
  // 结构化输出测试
  // ========================================================================

  describe("structuredComplete", () => {
    it("应该成功返回符合 Zod Schema 的结构化数据", async () => {
      const schema = z.object({
        score: z.number().min(0).max(100),
        category: z.enum(["high", "medium", "low"]),
        tags: z.array(z.string()),
      });

      // Mock 工具调用响应
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use" as const,
            name: "test_tool",
            input: {
              score: 85,
              category: "high",
              tags: ["awesome", "test"],
            },
          },
        ],
      } as any);

      const result = await ai.structuredComplete(
        "Generate structured output",
        {
          schema,
          toolName: "test_tool",
          toolDescription: "Test tool",
        }
      );

      expect(result).toEqual({
        score: 85,
        category: "high",
        tags: ["awesome", "test"],
      });

      // 验证 API 调用
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-5-sonnet-20241022",
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "test_tool",
              description: "Test tool",
              input_schema: expect.any(Object),
            }),
          ]),
          tool_choice: {
            type: "tool",
            name: "test_tool",
          },
        })
      );
    });

    it("应该验证返回数据符合 Schema 约束", async () => {
      const schema = z.object({
        healthScore: z.number().min(0).max(100),
        activityLevel: z.enum(["high", "medium", "low", "dead"]),
      });

      // Mock 返回无效数据（超出范围）
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use" as const,
            name: "analysis",
            input: {
              healthScore: 150, // 超出范围
              activityLevel: "high",
            },
          },
        ],
      } as any);

      await expect(
        ai.structuredComplete("Analyze", { schema })
      ).rejects.toThrow();
    });

    it("应该支持嵌套对象 Schema", async () => {
      const schema = z.object({
        repository: z.object({
          name: z.string(),
          stars: z.number(),
        }),
        metrics: z.object({
          healthScore: z.number().min(0).max(100),
          activityLevel: z.enum(["high", "medium", "low", "dead"]),
        }),
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use" as const,
            name: "repo_analysis",
            input: {
              repository: {
                name: "next.js",
                stars: 120000,
              },
              metrics: {
                healthScore: 92,
                activityLevel: "high",
              },
            },
          },
        ],
      } as any);

      const result = await ai.structuredComplete("Analyze repository", {
        schema,
        toolName: "repo_analysis",
      });

      expect(result).toEqual({
        repository: {
          name: "next.js",
          stars: 120000,
        },
        metrics: {
          healthScore: 92,
          activityLevel: "high",
        },
      });
    });

    it("应该支持数组 Schema", async () => {
      const schema = z.object({
        items: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            value: z.number().min(0).max(10),
          })
        ),
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use" as const,
            name: "list_tool",
            input: {
              items: [
                { id: 1, name: "Item 1", value: 8 },
                { id: 2, name: "Item 2", value: 5 },
              ],
            },
          },
        ],
      } as any);

      const result = await ai.structuredComplete("List items", {
        schema,
        toolName: "list_tool",
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({ id: 1, name: "Item 1", value: 8 });
    });
  });

  // ========================================================================
  // Zod 到 JSON Schema 转换测试
  // ========================================================================

  describe("zodToJsonSchema", () => {
    it("应该正确转换基础类型", async () => {
      const schema = z.object({
        str: z.string(),
        num: z.number().min(0).max(100),
        bool: z.boolean(),
        arr: z.array(z.string()),
        enum: z.enum(["a", "b", "c"]),
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use" as const,
            name: "test",
            input: { str: "test", num: 50, bool: true, arr: ["x"], enum: "a" },
          },
        ],
      } as any);

      await ai.structuredComplete("Test", { schema, toolName: "test" });

      const callArgs = mockCreate.mock.calls[0][0];
      const toolSchema = callArgs.tools[0].input_schema;

      // 验证转换后的 JSON Schema（基本类型转换）
      expect(toolSchema.type).toBe("object");
      expect(toolSchema.properties.str.type).toBe("string");
      expect(toolSchema.properties.num.type).toBe("number");
      expect(toolSchema.properties.bool.type).toBe("boolean");
      expect(toolSchema.properties.arr.type).toBe("array");
      expect(toolSchema.properties.arr.items.type).toBe("string");
      expect(toolSchema.properties.enum.type).toBe("string");
      expect(toolSchema.properties.enum.enum).toEqual(["a", "b", "c"]);
    });

    it("应该正确处理可选字段", async () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use" as const,
            name: "test",
            input: { required: "value" },
          },
        ],
      } as any);

      await ai.structuredComplete("Test", { schema, toolName: "test" });

      const callArgs = mockCreate.mock.calls[0][0];
      const toolSchema = callArgs.tools[0].input_schema;

      // 验证 required 字段列表
      expect(toolSchema.required).toEqual(["required"]);
    });
  });

  // ========================================================================
  // 错误处理测试
  // ========================================================================

  describe("错误处理", () => {
    it("应该在 API 返回非工具使用时抛出错误", async () => {
      const schema = z.object({ test: z.string() });

      mockCreate.mockResolvedValue({
        content: [{ type: "text" as const, text: "Some text" }],
      } as any);

      await expect(
        ai.structuredComplete("Test", { schema })
      ).rejects.toThrow("Unexpected response from Anthropic API: expected tool_use");
    });

    it("应该在工具名称不匹配时抛出错误", async () => {
      const schema = z.object({ test: z.string() });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use" as const,
            name: "wrong_tool", // 工具名称不匹配
            input: { test: "value" },
          },
        ],
      } as any);

      await expect(
        ai.structuredComplete("Test", {
          schema,
          toolName: "correct_tool",
        })
      ).rejects.toThrow("Unexpected response from Anthropic API: expected tool_use");
    });
  });

  // ========================================================================
  // embed 方法测试
  // ========================================================================

  describe("embed", () => {
    it("应该抛出不支持错误", async () => {
      await expect(ai.embed("test text")).rejects.toThrow(
        "Embeddings not supported - use a different provider"
      );
    });
  });
});

// ============================================================================
// TextChunker 测试
// ============================================================================

describe("TextChunker", () => {
  let chunker: TextChunker;

  beforeEach(() => {
    chunker = new TextChunker({
      maxTokens: 500,
      overlapTokens: 50,
    });
  });

  describe("estimateTokens", () => {
    it("应该正确估算英文文本的 token 数量", () => {
      const text = "Hello, World! This is a test.";
      // 约 28 字符 / 4 = 7 tokens (使用 ceil 可能得到 7 或 8)
      const tokens = chunker.estimateTokens(text);
      expect(tokens).toBeGreaterThanOrEqual(7);
      expect(tokens).toBeLessThanOrEqual(8);
    });

    it("应该正确估算中文文本的 token 数量", () => {
      const text = "你好世界";
      // 4 字符 / 4 = 1 token
      const tokens = chunker.estimateTokens(text);
      expect(tokens).toBe(1);
    });
  });

  describe("chunk", () => {
    it("应该对空文本返回空数组", () => {
      const result = chunker.chunk("");
      expect(result).toEqual([]);
    });

    it("应该对空白文本返回空数组", () => {
      const result = chunker.chunk("   ");
      expect(result).toEqual([]);
    });

    it("应该正确分块短文本", () => {
      const text = "This is a short text.";
      const result = chunker.chunk(text, "source-1", "readme");

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("This is a short text.");
      expect(result[0].chunkType).toBe("readme");
      expect(result[0].sourceId).toBe("source-1");
      expect(result[0].chunkIndex).toBe(0);
    });

    it("应该正确分块长文本", () => {
      // 创建一个超过 500 token 的长文本
      const text = Array(100)
        .fill("This is a test sentence. ")
        .join("");

      const result = chunker.chunk(text, "source-1", "readme");

      expect(result.length).toBeGreaterThan(1);
      // 验证分块有正确的属性
      for (const chunk of result) {
        expect(chunk.chunkType).toBe("readme");
        expect(chunk.sourceId).toBe("source-1");
        expect(chunk.tokenCount).toBeGreaterThan(0);
      }
    });

    it("应该使用默认 chunkType 当未指定时", () => {
      const text = "Short text";
      const result = chunker.chunk(text);

      expect(result[0].chunkType).toBe("description");
    });

    it("应该在分块时保持正确的索引顺序", () => {
      const text = Array(50)
        .fill("Sentence. ")
        .join("");

      const result = chunker.chunk(text, "test", "issues");

      for (let i = 0; i < result.length; i++) {
        expect(result[i].chunkIndex).toBe(i);
      }
    });
  });

  describe("chunkMultiple", () => {
    it("应该正确合并多个文本源", () => {
      const sources = [
        { text: "First document", sourceId: "doc-1", chunkType: "readme" },
        { text: "Second document", sourceId: "doc-2", chunkType: "issues" },
      ];

      const result = chunker.chunkMultiple(sources);

      expect(result.length).toBe(2);
      expect(result[0].content).toBe("First document");
      expect(result[0].chunkType).toBe("readme");
      expect(result[0].sourceId).toBe("doc-1");
      expect(result[1].content).toBe("Second document");
      expect(result[1].chunkType).toBe("issues");
      expect(result[1].sourceId).toBe("doc-2");
    });

    it("应该处理空源数组", () => {
      const result = chunker.chunkMultiple([]);
      expect(result).toEqual([]);
    });

    it("应该处理包含空文本的源", () => {
      const sources = [
        { text: "", sourceId: "empty", chunkType: "readme" },
        { text: "Valid text", sourceId: "valid", chunkType: "issues" },
      ];

      const result = chunker.chunkMultiple(sources);

      // 空文本应该被忽略
      expect(result.length).toBe(1);
      expect(result[0].sourceId).toBe("valid");
    });
  });
});
