/**
 * @package @devscope/ai/agent.test
 * @description OpenAI-compatible DevScopeAgent 单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { repositoryAnalysisSchema } from "../../shared/src/index.js";

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

import {
  DevScopeAgent,
  RepoAnalyzeToolInputSchema,
  RepoFetchToolInputSchema,
  ReportGenerateToolInputSchema,
  createAgent,
} from "./agent.js";

describe("DevScopeAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEEPSEEK_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("使用默认 DeepSeek 配置创建实例", () => {
    expect(createAgent()).toBeInstanceOf(DevScopeAgent);
  });

  it("MiniMax 模型：Agent 循环请求注入 thinking disabled 与 max_completion_tokens", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "test-api-key");
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "https://api.minimaxi.com/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_MODEL", "MiniMax-M3");
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "ok", tool_calls: undefined } }],
    });

    await createAgent().run("test");

    const body = mockCreate.mock.calls[0][0];
    expect(body.model).toBe("MiniMax-M3");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_completion_tokens).toBeDefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("Agent 与 AIProvider 使用相同的模型环境变量优先级", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_MODEL", "compatible-model");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-model");
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "ok", tool_calls: undefined } }],
    });

    await createAgent().run("test");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "compatible-model" }),
      undefined,
    );
  });

  it("返回无工具调用的文本响应", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "你好！", tool_calls: undefined } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });

    const result = await createAgent().run("你好");

    expect(result.output).toBe("你好！");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("执行 OpenAI-compatible 工具调用并继续对话", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "custom_tool", arguments: JSON.stringify({ value: 2 }) },
            }],
          },
        }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "结果是 4", tool_calls: undefined } }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      });

    const agent = createAgent();
    agent.registerTool({
      name: "custom_tool",
      description: "将输入乘以二",
      inputSchema: z.object({ value: z.number() }),
      handler: async (input: unknown) => ({ result: (input as { value: number }).value * 2 }),
    });

    const result = await agent.run("计算");

    expect(result.output).toBe("结果是 4");
    expect(result.toolCalls).toEqual([{ tool: "custom_tool", input: { value: 2 }, output: { result: 4 } }]);
  });

  it("达到工具轮次上限后停止", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_loop",
            type: "function",
            function: { name: "loop_tool", arguments: JSON.stringify({}) },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const agent = createAgent({ maxToolRounds: 2 });
    agent.registerTool({
      name: "loop_tool",
      description: "始终要求继续调用的测试工具",
      inputSchema: z.object({}),
      handler: async () => ({ ok: true }),
    });

    await expect(agent.run("循环")).rejects.toThrow("exceeded 2 tool rounds");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("将 AbortSignal 传给模型请求", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(createAgent().run("取消", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("Agent 输入与输出契约", () => {
  it("校验工具输入", () => {
    expect(RepoFetchToolInputSchema.safeParse({ repo: "vercel/next.js" }).success).toBe(true);
    expect(RepoFetchToolInputSchema.safeParse({ repo: "invalid" }).success).toBe(false);
    expect(RepoAnalyzeToolInputSchema.safeParse({ repo: "facebook/react" }).success).toBe(true);
    expect(ReportGenerateToolInputSchema.safeParse({ title: "报告" }).success).toBe(true);
  });

  it("report_generate 只接受带仓库标识的完整分析对象", () => {
    const analysis = {
      repo: "vercel/next.js",
      healthScore: 92,
      activityLevel: "high",
      keyMetrics: {
        starsGrowthRate: 85,
        issueResolutionRate: 72,
        contributorDiversityScore: 90,
      },
      riskFactors: [],
      opportunities: [],
      recommendation: "invest",
      summary: "项目状态良好。",
    };

    expect(ReportGenerateToolInputSchema.safeParse({
      title: "报告",
      analyses: [analysis],
    }).success).toBe(true);
    expect(ReportGenerateToolInputSchema.safeParse({
      title: "报告",
      analyses: ["vercel/next.js"],
    }).success).toBe(false);
  });

  it.each(["Issue Management", "Stability"])(
    "风险类别拒绝最终报告不支持的标签：%s",
    (invalidCategory) => {
      const base = {
        healthScore: 80,
        activityLevel: "high",
        keyMetrics: {
          starsGrowthRate: 1,
          issueResolutionRate: 80,
          contributorDiversityScore: 70,
        },
        opportunities: [],
        recommendation: "invest",
        summary: "项目状态良好。",
      };

      expect(repositoryAnalysisSchema.safeParse({
        ...base,
        riskFactors: [{ category: "technical", description: "测试风险", severity: 20 }],
      }).success).toBe(true);
      expect(repositoryAnalysisSchema.safeParse({
        ...base,
        riskFactors: [{ category: invalidCategory, description: "测试风险", severity: 20 }],
      }).success).toBe(false);
    }
  );
});
