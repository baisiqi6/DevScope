/**
 * @package @devscope/ai/agent
 * @description Claude Agent SDK 集成模块
 *
 * 将 DevScope Skills 包装为 Claude 可调用的 Tools，
 * 实现 Agent 自主决策和多工具协作。
 *
 * @module agent
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Agent Tool 定义
 */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入 Schema (Zod) */
  inputSchema: z.ZodType<TInput>;
  /** 执行函数 */
  handler: (input: TInput) => Promise<TOutput>;
}

/**
 * Agent 配置
 */
export interface DevScopeAgentConfig {
  /** Anthropic API Key (默认从环境变量读取) */
  apiKey?: string;
  /** 使用的模型 (默认: claude-sonnet-4-6) */
  model?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 启用的工具列表 (默认全部启用) */
  enabledTools?: string[];
}

/**
 * Agent 执行结果
 */
export interface AgentResult<T = unknown> {
  /** 最终输出 */
  output: T;
  /** 执行的工具调用记录 */
  toolCalls: Array<{
    tool: string;
    input: unknown;
    output: unknown;
  }>;
  /** Token 使用统计 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * 流式输出的回调
 */
export interface StreamCallbacks {
  /** 收到文本块时调用 */
  onText?: (text: string) => void;
  /** 开始工具调用时调用 */
  onToolUse?: (name: string, input: unknown) => void;
  /** 工具调用完成时调用 */
  onToolResult?: (name: string, result: unknown) => void;
  /** 思考过程中调用 */
  onThinking?: (thinking: string) => void;
}

// ============================================================================
// 内置 Tools
// ============================================================================

/**
 * repo-fetch 工具输入 Schema
 */
export const RepoFetchToolInputSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "格式应为 owner/repo"),
  includeIssues: z.boolean().default(false),
  includeCommits: z.boolean().default(false),
  issuesLimit: z.number().min(1).max(100).default(10),
  commitsLimit: z.number().min(1).max(100).default(10),
});

/**
 * repo-analyze 工具输入 Schema
 */
export const RepoAnalyzeToolInputSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "格式应为 owner/repo"),
  context: z.string().optional(),
});

/**
 * report-generate 工具输入 Schema
 */
export const ReportGenerateToolInputSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["summary", "detailed", "comparison"]).default("summary"),
  analyses: z.array(z.any()).optional(),
  format: z.enum(["json", "markdown", "html"]).default("markdown"),
});

// ============================================================================
// GitHub Client (复用自 skills/repo-fetch)
// ============================================================================

/**
 * GitHub API 客户端
 */
class GitHubClient {
  private token: string | undefined;
  private baseUrl = "https://api.github.com";

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getRepository(owner: string, repo: string) {
    const data = await this.fetch<any>(`/repos/${owner}/${repo}`);
    return {
      fullName: data.full_name,
      name: data.name,
      owner: data.owner.login,
      description: data.description,
      url: data.html_url,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      language: data.language,
      license: data.license?.spdx_id || null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      pushedAt: data.pushed_at,
    };
  }

  async getIssues(owner: string, repo: string, limit: number) {
    const data = await this.fetch<any[]>(
      `/repos/${owner}/${repo}/issues?state=open&per_page=${limit}`
    );
    return data.map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: issue.user.login,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      comments: issue.comments,
      labels: issue.labels.map((l: any) => l.name),
    }));
  }

  async getCommits(owner: string, repo: string, limit: number) {
    const data = await this.fetch<any[]>(
      `/repos/${owner}/${repo}/commits?per_page=${limit}`
    );
    return data.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
    }));
  }
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * repo-fetch 工具处理器
 */
async function handleRepoFetch(input: z.infer<typeof RepoFetchToolInputSchema>) {
  const [owner, repo] = input.repo.split("/");
  const client = new GitHubClient();

  const [repository, issues, commits] = await Promise.all([
    client.getRepository(owner, repo),
    input.includeIssues ? client.getIssues(owner, repo, input.issuesLimit) : Promise.resolve(undefined),
    input.includeCommits ? client.getCommits(owner, repo, input.commitsLimit) : Promise.resolve(undefined),
  ]);

  return {
    repository,
    issues,
    commits,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * repo-analyze 工具处理器
 * 需要外部注入 AI Provider
 */
function createRepoAnalyzeHandler(ai: { structuredComplete: (prompt: string, options: any) => Promise<any> }) {
  return async (input: z.infer<typeof RepoAnalyzeToolInputSchema>) => {
    const [owner, repo] = input.repo.split("/");

    let prompt = `请分析 GitHub 仓库 ${owner}/${repo} 的健康度。`;

    if (input.context) {
      prompt += `\n\n额外上下文：${input.context}`;
    }

    prompt += `\n\n请从以下维度进行分析：
1. 活跃度评估 (high/medium/low/dead)
2. 健康度评分 (0-100)
3. 关键指标
4. 风险因素
5. 机会因素
6. 投资建议 (invest/watch/avoid)
7. 总结`;

    const result = await ai.structuredComplete(prompt, {
      schema: z.object({
        healthScore: z.number().min(0).max(100),
        activityLevel: z.enum(["high", "medium", "low", "dead"]),
        keyMetrics: z.object({
          starsGrowthRate: z.number(),
          issueResolutionRate: z.number().min(0).max(100),
          contributorDiversityScore: z.number().min(0).max(100),
        }),
        riskFactors: z.array(z.object({
          category: z.string(),
          description: z.string(),
          severity: z.number().min(1).max(10),
        })),
        opportunities: z.array(z.object({
          category: z.string(),
          description: z.string(),
          potential: z.number().min(1).max(10),
        })),
        recommendation: z.enum(["invest", "watch", "avoid"]),
        summary: z.string(),
      }),
      toolName: "repository_analysis",
      toolDescription: "生成 GitHub 仓库健康度分析报告",
      system: "你是一个专业的开源项目分析师。请根据公开信息分析仓库的健康度，并返回结构化的分析结果。",
      temperature: 0.3,
    });

    return {
      ...result,
      repo: input.repo,
    };
  };
}

/**
 * report-generate 工具处理器
 */
function handleReportGenerate(input: z.infer<typeof ReportGenerateToolInputSchema>) {
  const analyses = input.analyses || [];

  if (analyses.length === 0) {
    return {
      title: input.title,
      type: input.type,
      summary: "没有可分析的数据",
      sections: [],
      generatedAt: new Date().toISOString(),
      metadata: {
        totalRepositories: 0,
        topPerformers: [],
        averageHealthScore: 0,
      },
    };
  }

  // 计算统计数据
  const healthScores = analyses
    .map((d: any) => d.healthScore)
    .filter((s): s is number => typeof s === "number");
  const avgScore = healthScores.length > 0
    ? healthScores.reduce((a: number, b: number) => a + b, 0) / healthScores.length
    : 0;

  // 找出表现最好的仓库
  const sorted = [...analyses].sort(
    (a: any, b: any) => (b.healthScore || 0) - (a.healthScore || 0)
  );
  const topPerformers = sorted.slice(0, 5).map((d: any) => d.repository?.fullName || d.repo);

  // 生成总结
  const investCount = analyses.filter((d: any) => d.recommendation === "invest").length;
  const watchCount = analyses.filter((d: any) => d.recommendation === "watch").length;
  const avoidCount = analyses.filter((d: any) => d.recommendation === "avoid").length;

  let summary = `本报告分析了 ${analyses.length} 个开源仓库。`;
  if (avgScore >= 70) {
    summary += `整体表现良好，平均健康度为 ${avgScore.toFixed(1)} 分。`;
  } else if (avgScore >= 50) {
    summary += `整体表现中等，平均健康度为 ${avgScore.toFixed(1)} 分。`;
  } else {
    summary += `整体表现有待提升，平均健康度为 ${avgScore.toFixed(1)} 分。`;
  }
  summary += `\n\n投资建议分布：`;
  summary += `\n- 建议投资: ${investCount} 个`;
  summary += `\n- 建议观望: ${watchCount} 个`;
  summary += `\n- 建议避免: ${avoidCount} 个`;

  const sections = [
    { title: "执行摘要", content: summary, level: 1 },
    { title: "总体统计", content: `总仓库数: ${analyses.length}\n平均健康度: ${avgScore.toFixed(1)}`, level: 1 },
  ];

  if (analyses.length <= 10) {
    sections.push({
      title: "仓库详情",
      content: analyses
        .map((d: any) => {
          const name = d.repository?.fullName || d.repo || "Unknown";
          const score = d.healthScore || "N/A";
          const activity = d.activityLevel || "N/A";
          const recommendation = d.recommendation || "N/A";
          return `- **${name}**: 评分 ${score}, 活跃度 ${activity}, 建议 ${recommendation}`;
        })
        .join("\n"),
      level: 1,
    });
  }

  const report = {
    title: input.title,
    type: input.type,
    summary,
    sections,
    generatedAt: new Date().toISOString(),
    metadata: {
      totalRepositories: analyses.length,
      topPerformers,
      averageHealthScore: Math.round(avgScore),
    },
  };

  // 根据格式返回
  if (input.format === "markdown") {
    let md = `# ${report.title}\n\n`;
    md += `**生成时间**: ${report.generatedAt}\n\n`;
    md += `---\n\n`;
    for (const section of report.sections) {
      const heading = "#".repeat(section.level);
      md += `${heading} ${section.title}\n\n${section.content}\n\n`;
    }
    md += `---\n\n**元数据**\n`;
    md += `- 总仓库数: ${report.metadata.totalRepositories}\n`;
    md += `- 平均健康度: ${report.metadata.averageHealthScore}\n`;
    md += `- 顶级仓库: ${report.metadata.topPerformers.join(", ")}\n`;
    return { format: "markdown", content: md };
  }

  return report;
}

// ============================================================================
// DevScopeAgent 类
// ============================================================================

/**
 * DevScope Agent
 * @description 集成 Claude Agent SDK，支持自主调用多个工具
 *
 * @example
 * ```typescript
 * const agent = new DevScopeAgent({
 *   model: "claude-sonnet-4-6",
 * });
 *
 * // 简单查询
 * const result = await agent.run("分析 vercel/next.js 的健康度");
 *
 * // 流式输出
 * await agent.stream("分析 vercel/next.js 并生成报告", {
 *   onText: (text) => console.log(text),
 *   onToolUse: (name, input) => console.log(`使用工具: ${name}`),
 * });
 * ```
 */
export class DevScopeAgent {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private systemPrompt: string;
  private enabledTools: string[] | undefined;
  private tools: Map<string, AgentTool> = new Map();

  constructor(config: DevScopeAgentConfig = {}) {
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = config.model || "claude-sonnet-4-6";
    this.maxTokens = config.maxTokens || 4096;
    this.systemPrompt = config.systemPrompt || `你是一个专业的开源项目分析师助手。

你可以使用以下工具来帮助用户分析 GitHub 项目：

1. **repo_fetch**: 获取 GitHub 仓库的基础数据（stars、forks、issues、commits 等）
2. **repo_analyze**: 使用 AI 分析仓库的健康度，返回结构化评估
3. **report_generate**: 基于分析结果生成综合报告

工作流程建议：
- 用户请求分析某个仓库时，先使用 repo_fetch 获取数据
- 然后使用 repo_analyze 进行健康度分析
- 如果需要生成报告，使用 report_generate

你可以自主决定使用哪些工具，以及调用的顺序。`;
    this.enabledTools = config.enabledTools;

    // 注册内置工具
    this.registerBuiltInTools();
  }

  /**
   * 注册内置工具
   */
  private registerBuiltInTools() {
    // repo-fetch
    this.registerTool({
      name: "repo_fetch",
      description: "获取 GitHub 仓库的基础数据，包括 stars、forks、issues、commits 等。返回仓库的详细信息。",
      inputSchema: RepoFetchToolInputSchema,
      handler: handleRepoFetch,
    });

    // repo-analyze (需要延迟初始化，因为它依赖 AI)
    // 这里先注册一个占位符，实际 handler 在运行时动态创建
    this.registerTool({
      name: "repo_analyze",
      description: "使用 AI 分析 GitHub 仓库的健康度。返回健康度评分、活跃度、风险因素、投资建议等结构化分析结果。",
      inputSchema: RepoAnalyzeToolInputSchema,
      handler: async (input) => {
        // 动态创建 handler
        const { createAI } = await import("./index.js");
        const ai = createAI();
        const handler = createRepoAnalyzeHandler(ai);
        return handler(input);
      },
    });

    // report-generate
    this.registerTool({
      name: "report_generate",
      description: "基于仓库分析结果生成综合报告。支持 summary、detailed、comparison 三种类型，可输出 JSON 或 Markdown 格式。",
      inputSchema: ReportGenerateToolInputSchema,
      handler: handleReportGenerate,
    });
  }

  /**
   * 注册自定义工具
   */
  registerTool<TInput, TOutput>(tool: AgentTool<TInput, TOutput>) {
    this.tools.set(tool.name, tool as AgentTool);
  }

  /**
   * 获取所有工具定义 (Anthropic 格式)
   */
  private getToolDefinitions() {
    const tools: Anthropic.Tool[] = [];
    const enabledTools = this.enabledTools || Array.from(this.tools.keys());

    for (const [name, tool] of this.tools) {
      if (enabledTools.includes(name)) {
        tools.push({
          name: tool.name,
          description: tool.description,
          input_schema: this.zodToJsonSchema(tool.inputSchema),
        });
      }
    }

    return tools;
  }

  /**
   * Zod Schema 转 JSON Schema
   */
  private zodToJsonSchema(schema: z.ZodTypeAny): any {
    const zodDef = (schema as z.ZodObject<any>)._def;

    if (zodDef.typeName === "ZodObject") {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(zodDef.shape())) {
        const fieldSchema = value as z.ZodTypeAny;
        properties[key] = this.convertZodTypeToJsonSchema(fieldSchema);

        const isOptional = fieldSchema.isOptional?.();
        if (!isOptional) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
      };
    }

    return this.convertZodTypeToJsonSchema(schema);
  }

  private convertZodTypeToJsonSchema(zodType: z.ZodTypeAny): unknown {
    if (zodType instanceof z.ZodString) {
      return { type: "string" };
    }
    if (zodType instanceof z.ZodNumber) {
      const constraint: Record<string, unknown> = { type: "number" };
      const min = (zodType as any)._def.minValue;
      const max = (zodType as any)._def.maxValue;
      if (min !== null && min !== undefined) {
        constraint.minimum = typeof min === "object" ? min.value : min;
      }
      if (max !== null && max !== undefined) {
        constraint.maximum = typeof max === "object" ? max.value : max;
      }
      return constraint;
    }
    if (zodType instanceof z.ZodBoolean) {
      return { type: "boolean" };
    }
    if (zodType instanceof z.ZodArray) {
      return {
        type: "array",
        items: this.convertZodTypeToJsonSchema(zodType.element),
      };
    }
    if (zodType instanceof z.ZodEnum) {
      return { type: "string", enum: (zodType as any)._def.values };
    }
    if (zodType instanceof z.ZodObject) {
      return this.zodToJsonSchema(zodType);
    }
    if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodDefault) {
      return this.convertZodTypeToJsonSchema((zodType as any)._def.innerType);
    }
    if (zodType instanceof z.ZodEffects) {
      return this.convertZodTypeToJsonSchema((zodType as any)._def.schema);
    }

    return { type: "string" };
  }

  /**
   * 执行工具调用
   */
  private async executeTool(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // 验证输入
    const validatedInput = tool.inputSchema.parse(input);
    return tool.handler(validatedInput);
  }

  /**
   * 运行 Agent (非流式)
   */
  async run(prompt: string): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Agent 循环
    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.systemPrompt,
        messages,
        tools: this.getToolDefinitions(),
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // 检查是否需要工具调用
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        // 没有工具调用，返回最终结果
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        const finalText = textBlocks.map((b) => b.text).join("");

        return {
          output: finalText,
          toolCalls,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        };
      }

      // 执行工具调用
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        try {
          const result = await this.executeTool(block.name, block.input);
          toolCalls.push({
            tool: block.name,
            input: block.input,
            output: result,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 添加助手消息和工具结果到对话历史
      messages.push({
        role: "assistant",
        content: response.content,
      });
      messages.push({
        role: "user",
        content: toolResults,
      });
    }
  }

  /**
   * 运行 Agent (流式)
   */
  async stream(prompt: string, callbacks: StreamCallbacks = {}): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (true) {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.systemPrompt,
        messages,
        tools: this.getToolDefinitions(),
      });

      let currentToolUse: { id: string; name: string; input: any } | null = null;
      let currentText = "";

      stream.on("text", (text) => {
        currentText += text;
        callbacks.onText?.(text);
      });

      stream.on("contentBlockStart", (event) => {
        if (event.content_block.type === "tool_use") {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: {},
          };
          callbacks.onToolUse?.(event.content_block.name, {});
        }
      });

      stream.on("inputJson", (_partialJson, snapshot) => {
        if (currentToolUse) {
          currentToolUse.input = snapshot;
        }
      });

      const response = await stream.finalMessage();

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // 检查工具调用
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        const finalText = textBlocks.map((b) => b.text).join("");

        return {
          output: finalText,
          toolCalls,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        };
      }

      // 执行工具调用
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        try {
          const result = await this.executeTool(block.name, block.input);
          toolCalls.push({
            tool: block.name,
            input: block.input,
            output: result,
          });
          callbacks.onToolResult?.(block.name, result);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: error instanceof Error ? error.message : String(error),
          });
        }
      }

      messages.push({
        role: "assistant",
        content: response.content,
      });
      messages.push({
        role: "user",
        content: toolResults,
      });
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 DevScopeAgent 实例
 */
export function createAgent(config?: DevScopeAgentConfig): DevScopeAgent {
  return new DevScopeAgent(config);
}
