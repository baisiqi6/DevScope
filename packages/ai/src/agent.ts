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
import OpenAI from "openai";
import { z } from "zod";
import { GitHubClient, repositoryAnalysisSchema } from "@devscope/shared";

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
  inputSchema: z.ZodTypeAny;
  /** 执行函数 */
  handler: (input: TInput) => Promise<TOutput>;
}

/**
 * Agent 提供者类型
 */
type AgentProviderType = "anthropic" | "openai-compatible";

/**
 * Agent 配置
 */
export interface DevScopeAgentConfig {
  /** AI 提供者类型 (默认自动检测) */
  provider?: AgentProviderType;
  /** API Key (默认从环境变量读取) */
  apiKey?: string;
  /** API Base URL (用于 openai-compatible 模式) */
  baseURL?: string;
  /** 使用的模型 (默认: claude-sonnet-4-6 或 deepseek-chat) */
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
    const [owner, repoName] = input.repo.split("/");
    const currentDate = new Date().toISOString().split('T')[0]; // 当前日期 YYYY-MM-DD

    // 内部自动调用 GitHub API 获取数据
    const { GitHubClient } = await import("@devscope/shared");
    const client = new GitHubClient();

    let prompt = `请分析 GitHub 仓库 ${owner}/${repoName} 的健康度。`;
    prompt += `\n\n**当前日期**: ${currentDate}（请在分析时参考此日期判断项目活跃度）`;

    try {
      // 获取仓库数据
      const [repository, issues, commits] = await Promise.all([
        client.getRepository(owner, repoName),
        client.getIssues(owner, repoName, 10),
        client.getCommits(owner, repoName, 10),
      ]);

      // 将真实数据添加到 prompt
      prompt += `\n\n## 仓库真实数据（来自 GitHub API）\n`;
      prompt += `### 基本信息\n`;
      prompt += `- 仓库名: ${repository.fullName}\n`;
      prompt += `- 描述: ${repository.description || "无"}\n`;
      prompt += `- Stars: ${repository.stars}\n`;
      prompt += `- Forks: ${repository.forks}\n`;
      prompt += `- Open Issues: ${repository.openIssues}\n`;
      prompt += `- 主要语言: ${repository.language || "未知"}\n`;
      prompt += `- 创建时间: ${repository.createdAt}\n`;
      prompt += `- 最后更新: ${repository.updatedAt}\n`;
      prompt += `- 最后推送: ${repository.pushedAt}\n`;

      if (issues && issues.length > 0) {
        prompt += `\n### 最近 Issues (${issues.length} 条)\n`;
        issues.slice(0, 5).forEach((issue, i: number) => {
          prompt += `${i + 1}. ${issue.title} (${issue.state}, ${issue.comments} 评论)\n`;
        });
      }

      if (commits && commits.length > 0) {
        prompt += `\n### 最近提交 (${commits.length} 条)\n`;
        commits.slice(0, 5).forEach((commit: any, i: number) => {
          const msg = commit.message.length > 50 ? commit.message.substring(0, 50) + "..." : commit.message;
          prompt += `${i + 1}. ${msg} (${commit.date})\n`;
        });
      }

      prompt += `\n请基于以上真实数据进行分析。`;
    } catch (error) {
      // 获取数据失败，给出警告
      const errorMsg = error instanceof Error ? error.message : String(error);
      prompt += `\n\n⚠️ 警告：无法获取该仓库的真实数据（${errorMsg}）。分析结果可能不准确。`;
    }

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
7. 总结

**重要**：所有分析内容必须使用中文输出，包括风险因素描述、机会因素描述和总结。`;

    const result = await ai.structuredComplete(prompt, {
      schema: repositoryAnalysisSchema,
      toolName: "repository_analysis",
      toolDescription: "生成 GitHub 仓库健康度分析报告",
      system: `你是一个专业的开源项目分析师。请基于提供的真实 GitHub 数据分析仓库的健康度，确保分析结果准确反映仓库当前状态。

**重要提示**：
1. 当前日期是 ${currentDate}。在判断项目活跃度时，请参考此日期来评估最后更新时间、最近提交等时间戳的合理性。不要将2025年或2026年的日期误判为"未来时间"或"数据异常"。
2. **所有分析内容必须使用中文输出**，包括风险因素描述（description）、机会因素描述（description）和总结（summary）。
3. 风险类别（category）可以使用英文标签，如 "Issue Management"、"Community Engagement" 等。
4. 但描述性文本必须是中文。`,
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
async function handleReportGenerate(input: z.infer<typeof ReportGenerateToolInputSchema>) {
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
  private providerType: AgentProviderType;
  private anthropicClient: Anthropic | null;
  private openaiClient: OpenAI | null;
  private model: string;
  private maxTokens: number;
  private systemPrompt: string;
  private enabledTools: string[] | undefined;
  private tools: Map<string, AgentTool> = new Map();

  constructor(config: DevScopeAgentConfig = {}) {
    // 检测或使用指定的 provider 类型
    this.providerType = config.provider || this.detectProviderFromEnv();

    // 根据 provider 类型初始化客户端
    if (this.providerType === "anthropic") {
      this.anthropicClient = new Anthropic({
        apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      });
      this.openaiClient = null;
      this.model = config.model || "claude-sonnet-4-6";
    } else {
      // OpenAI 兼容模式（DeepSeek、通义千问等）
      const apiKey = config.apiKey || process.env.OPENAI_COMPATIBLE_API_KEY || process.env.DEEPSEEK_API_KEY;
      const baseURL = config.baseURL || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

      if (!apiKey) {
        throw new Error("API Key is required for openai-compatible provider. Set DEEPSEEK_API_KEY or OPENAI_COMPATIBLE_API_KEY environment variable.");
      }

      this.openaiClient = new OpenAI({ apiKey, baseURL });
      this.anthropicClient = null;
      this.model = config.model || "deepseek-chat";
    }

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

    console.log(`[DevScopeAgent] Initialized with provider: ${this.providerType}, model: ${this.model}`);

    // 注册内置工具
    this.registerBuiltInTools();
  }

  /**
   * 从环境变量自动检测 provider 类型
   */
  private detectProviderFromEnv(): AgentProviderType {
    if (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY) {
      return "openai-compatible";
    }
    return "anthropic";
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
      description: "使用 AI 分析 GitHub 仓库的健康度。返回健康度评分、活跃度、风险因素、投资建议等结构化分析结果。工具会自动获取 GitHub 数据进行分析。",
      inputSchema: RepoAnalyzeToolInputSchema,
      handler: async (input: unknown) => {
        // 动态创建 handler
        const { createAI } = await import("./index");
        const ai = createAI();
        const handler = createRepoAnalyzeHandler(ai);
        return handler(input as z.infer<typeof RepoAnalyzeToolInputSchema>);
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
   * 获取所有工具定义
   */
  private getToolDefinitions() {
    const enabledTools = this.enabledTools || Array.from(this.tools.keys());
    const tools: any[] = [];

    for (const [name, tool] of this.tools) {
      if (enabledTools.includes(name)) {
        if (this.providerType === "anthropic") {
          // Anthropic 格式
          tools.push({
            name: tool.name,
            description: tool.description,
            input_schema: this.zodToJsonSchema(tool.inputSchema),
          });
        } else {
          // OpenAI 兼容格式 (DeepSeek)
          tools.push({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: this.zodToJsonSchema(tool.inputSchema),
            },
          });
        }
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
  async run(prompt: string): Promise<AgentResult<string>> {
    if (this.providerType === "anthropic") {
      return this.runAnthropic(prompt);
    } else {
      return this.runOpenAICompatible(prompt);
    }
  }

  /**
   * 使用 Anthropic SDK 运行 Agent
   */
  private async runAnthropic(prompt: string): Promise<AgentResult<string>> {
    const toolCalls: AgentResult["toolCalls"] = [];
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Agent 循环
    while (true) {
      const response = await this.anthropicClient!.messages.create({
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
   * 使用 OpenAI 兼容 API 运行 Agent (DeepSeek)
   */
  private async runOpenAICompatible(prompt: string): Promise<AgentResult<string>> {
    const toolCallsList: AgentResult["toolCalls"] = [];
    const messages: Array<{ role: string; content: string; tool_calls?: any[] }> = [
      { role: "user", content: prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    console.log(`[DevScopeAgent.runOpenAICompatible] Starting agent loop`);

    // Agent 循环
    while (true) {
      // 添加 system 消息
      const messagesWithSystem = [
        { role: "system", content: this.systemPrompt },
        ...messages,
      ];

      console.log(`[DevScopeAgent.runOpenAICompatible] Sending request to DeepSeek API...`);
      console.log(`[DevScopeAgent.runOpenAICompatible] Messages count: ${messagesWithSystem.length}`);
      console.log(`[DevScopeAgent.runOpenAICompatible] Tools count: ${this.getToolDefinitions().length}`);

      const response = await this.openaiClient!.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: messagesWithSystem as any,
        tools: this.getToolDefinitions() as any,
      });

      console.log(`[DevScopeAgent.runOpenAICompatible] Received response from DeepSeek API`);
      console.log(`[DevScopeAgent.runOpenAICompatible] Usage:`, response.usage);

      totalInputTokens += response.usage?.prompt_tokens || 0;
      totalOutputTokens += response.usage?.completion_tokens || 0;

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("No response from OpenAI-compatible API");
      }

      console.log(`[DevScopeAgent.runOpenAICompatible] Choice message:`, choice.message);

      // 检查是否需要工具调用
      const responseToolCalls = choice.message.tool_calls;

      if (!responseToolCalls || responseToolCalls.length === 0) {
        // 没有工具调用，返回最终结果
        const finalText = choice.message.content || "";
        console.log(`[DevScopeAgent.runOpenAICompatible] No tool calls, returning final text`);

        return {
          output: finalText,
          toolCalls: toolCallsList,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        };
      }

      console.log(`[DevScopeAgent.runOpenAICompatible] Tool calls detected: ${responseToolCalls.length}`);

      // 执行工具调用
      const toolMessages: any[] = [];

      for (const toolCall of responseToolCalls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log(`[DevScopeAgent.runOpenAICompatible] Executing tool: ${functionName}`);

        try {
          const result = await this.executeTool(functionName, functionArgs);
          console.log(`[DevScopeAgent.runOpenAICompatible] Tool ${functionName} succeeded`);
          toolCallsList.push({
            tool: functionName,
            input: functionArgs,
            output: result,
          });
          toolMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          console.error(`[DevScopeAgent.runOpenAICompatible] Tool ${functionName} failed:`, error);
          toolMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          });
        }
      }

      // 添加助手消息和工具结果到对话历史
      messages.push({
        role: "assistant",
        content: choice.message.content || "",
        tool_calls: responseToolCalls,
      });
      messages.push(...toolMessages);
    }
  }

  /**
   * 运行 Agent (流式)
   */
  async stream(prompt: string, callbacks: StreamCallbacks = {}): Promise<AgentResult<string>> {
    if (this.providerType === "anthropic") {
      return this.streamAnthropic(prompt, callbacks);
    } else {
      // OpenAI 兼容模式使用非流式实现（简化版）
      return this.streamOpenAICompatible(prompt, callbacks);
    }
  }

  /**
   * 使用 Anthropic SDK 流式运行 Agent
   */
  private async streamAnthropic(prompt: string, callbacks: StreamCallbacks): Promise<AgentResult<string>> {
    const toolCalls: AgentResult["toolCalls"] = [];
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (true) {
      const stream = this.anthropicClient!.messages.stream({
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

      // @ts-ignore - contentBlockStart event not in MessageStreamEvents type
      stream.on("contentBlockStart", (event: any) => {
        if (event.content_block?.type === "tool_use") {
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

  /**
   * 使用 OpenAI 兼容 API 流式运行 Agent (简化版，使用非流式 + 回调)
   */
  private async streamOpenAICompatible(prompt: string, callbacks: StreamCallbacks): Promise<AgentResult<string>> {
    console.log(`[DevScopeAgent.streamOpenAICompatible] Starting stream execution`);
    try {
      // 简化版：使用非流式实现，但仍然触发回调
      const result = await this.runOpenAICompatible(prompt);

      console.log(`[DevScopeAgent.streamOpenAICompatible] Execution completed, triggering callbacks`);

      // 触发文本回调
      if (result.output) {
        callbacks.onText?.(result.output);
      }

      // 触发工具回调
      for (const toolCall of result.toolCalls) {
        callbacks.onToolUse?.(toolCall.tool, toolCall.input);
        callbacks.onToolResult?.(toolCall.tool, toolCall.output);
      }

      return result;
    } catch (error) {
      console.error(`[DevScopeAgent.streamOpenAICompatible] Error during execution:`, error);
      throw error;
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
