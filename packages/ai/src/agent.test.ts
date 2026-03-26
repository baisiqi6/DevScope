/**
 * @package @devscope/ai/agent.test
 * @description DevScopeAgent 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
      stream: mockStream,
    };
  },
}));

// Mock fetch for GitHub API
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import { DevScopeAgent, createAgent } from "./agent.js";

describe("DevScopeAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("应该使用默认配置创建实例", () => {
      const agent = createAgent();
      expect(agent).toBeInstanceOf(DevScopeAgent);
    });

    it("应该接受自定义配置", () => {
      const agent = createAgent({
        model: "claude-opus-4-6",
        maxTokens: 8192,
      });
      expect(agent).toBeInstanceOf(DevScopeAgent);
    });
  });

  describe("run", () => {
    it("应该返回文本响应（无工具调用）", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "你好！我是 DevScope 分析助手。" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const agent = createAgent();
      const result = await agent.run("你好");

      expect(result.output).toBe("你好！我是 DevScope 分析助手。");
      expect(result.toolCalls).toHaveLength(0);
    });

    it("应该调用 repo_fetch 工具并返回结果", async () => {
      // Mock GitHub API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            full_name: "vercel/next.js",
            name: "next.js",
            owner: { login: "vercel" },
            description: "The React Framework",
            html_url: "https://github.com/vercel/next.js",
            stargazers_count: 100000,
            forks_count: 20000,
            open_issues_count: 1000,
            language: "TypeScript",
            license: { spdx_id: "MIT" },
            created_at: "2016-10-05T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            pushed_at: "2024-01-01T00:00:00Z",
          }),
      });

      // 第一次调用：返回工具调用
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "repo_fetch",
            input: { repo: "vercel/next.js" },
          },
        ],
        usage: { input_tokens: 50, output_tokens: 30 },
      });

      // 第二次调用：返回最终文本
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: "Next.js 是一个非常活跃的项目，拥有 100k stars。",
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const agent = createAgent();
      const result = await agent.run("获取 vercel/next.js 的信息");

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("repo_fetch");
    });
  });

  describe("registerTool", () => {
    it("应该允许注册自定义工具", async () => {
      const agent = createAgent();

      agent.registerTool({
        name: "custom_tool",
        description: "自定义工具",
        inputSchema: { parse: vi.fn().mockReturnValue({ value: 1 }) } as any,
        handler: vi.fn().mockResolvedValue({ result: "ok" }),
      });

      // Agent 应该包含自定义工具
      // 这里我们只是验证注册不会报错
      expect(agent).toBeInstanceOf(DevScopeAgent);
    });
  });
});

describe("Tool Schemas", () => {
  it("RepoFetchToolInputSchema 应该验证正确的输入", async () => {
    const { RepoFetchToolInputSchema } = await import("./agent.js");

    const validInput = {
      repo: "vercel/next.js",
      includeIssues: true,
      includeCommits: false,
    };

    const result = RepoFetchToolInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("RepoFetchToolInputSchema 应该拒绝错误的 repo 格式", async () => {
    const { RepoFetchToolInputSchema } = await import("./agent.js");

    const invalidInput = {
      repo: "invalid-format",
    };

    const result = RepoFetchToolInputSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it("RepoAnalyzeToolInputSchema 应该验证正确的输入", async () => {
    const { RepoAnalyzeToolInputSchema } = await import("./agent.js");

    const validInput = {
      repo: "facebook/react",
      context: "这是一个流行的 UI 库",
    };

    const result = RepoAnalyzeToolInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("ReportGenerateToolInputSchema 应该验证正确的输入", async () => {
    const { ReportGenerateToolInputSchema } = await import("./agent.js");

    const validInput = {
      title: "分析报告",
      type: "summary",
      analyses: [],
      format: "markdown",
    };

    const result = ReportGenerateToolInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });
});
