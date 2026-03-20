/**
 * @package @devscope/ai
 * @description AI 服务包 - Anthropic Claude SDK 封装
 *
 * 本包封装了 Anthropic Claude API，提供统一的 AI 服务接口。
 * 支持文本补全、流式输出和结构化输出。
 *
 * @module index
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * AI 提供者类型
 */
export type AIProviderType = "anthropic" | "openai-compatible";

/**
 * AI 提供者配置选项
 */
export interface AIConfig {
  /** AI 提供者类型（默认：anthropic） */
  provider?: AIProviderType;
  /** API Key（根据 provider 类型从不同环境变量读取） */
  apiKey?: string;
  /** 自定义 API 基础 URL（用于 openai-compatible 模式） */
  baseURL?: string;
  /** 默认模型名称 */
  defaultModel?: string;
  /** 默认最大 token 数（默认：4096） */
  maxTokens?: number;
}

/**
 * 补全选项
 */
interface CompletionOptions {
  /** 使用的模型名称 */
  model?: string;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 系统提示词 */
  system?: string;
  /** 温度参数（0-1） */
  temperature?: number;
}

/**
 * 结构化输出选项
 */
interface StructuredOutputOptions<T> {
  /** 使用的模型名称 */
  model?: string;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 系统提示词 */
  system?: string;
  /** 温度参数（0-1） */
  temperature?: number;
  /** Zod Schema 用于定义输出结构 */
  schema: z.ZodType<T>;
  /** 工具名称（默认：analysis） */
  toolName?: string;
  /** 工具描述（默认从 schema 推断） */
  toolDescription?: string;
}

// ============================================================================
// AIProvider 类
// ============================================================================

/**
 * AI 提供者类
 * @description 支持多种 AI 提供商的统一接口
 *
 * @example
 * ```typescript
 * // 使用 Anthropic Claude
 * const ai = new AIProvider({ provider: "anthropic" });
 *
 * // 使用 DeepSeek (OpenAI 兼容)
 * const ai = new AIProvider({
 *   provider: "openai-compatible",
 *   baseURL: "https://api.deepseek.com",
 *   apiKey: "sk-xxx",
 *   defaultModel: "deepseek-chat"
 * });
 *
 * const response = await ai.complete("你好，请介绍一下自己");
 * console.log(response);
 * ```
 */
export class AIProvider {
  /** AI 提供者类型 */
  private providerType: AIProviderType;
  /** Anthropic SDK 客户端实例 */
  private anthropicClient: Anthropic | null;
  /** OpenAI SDK 客户端实例（用于兼容 API） */
  private openaiClient: OpenAI | null;
  /** 默认使用的模型 */
  private defaultModel: string;
  /** 默认最大 token 数 */
  private maxTokens: number;

  /**
   * 创建 AIProvider 实例
   * @param config 配置选项
   */
  constructor(config: AIConfig = {}) {
    this.providerType = config.provider || this.detectProviderFromEnv();
    this.maxTokens = config.maxTokens || 4096;

    // 根据提供商类型初始化客户端
    if (this.providerType === "anthropic") {
      this.anthropicClient = new Anthropic({
        apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
        baseURL: config.baseURL,
      });
      this.openaiClient = null;
      this.defaultModel = config.defaultModel || "claude-3-5-sonnet-20241022";
    } else {
      // OpenAI 兼容模式（DeepSeek、通义千问等）
      const apiKey = config.apiKey || process.env.OPENAI_COMPATIBLE_API_KEY || process.env.DEEPSEEK_API_KEY;
      const baseURL = config.baseURL || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

      if (!apiKey) {
        throw new Error("API Key is required for openai-compatible provider. Set OPENAI_COMPATIBLE_API_KEY or DEEPSEEK_API_KEY environment variable.");
      }

      this.openaiClient = new OpenAI({
        apiKey,
        baseURL,
      });
      this.anthropicClient = null;
      this.defaultModel = config.defaultModel || "deepseek-chat";
    }

    // 打印初始化信息（开发模式）
    if (process.env.NODE_ENV === "development") {
      console.log(`[AIProvider] Initialized with provider: ${this.providerType}, model: ${this.defaultModel}`);
    }
  }

  /**
   * 从环境变量自动检测提供商类型
   */
  private detectProviderFromEnv(): AIProviderType {
    if (process.env.OPENAI_COMPATIBLE_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL) {
      return "openai-compatible";
    }
    return "anthropic";
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 生成文本补全（非流式）
   *
   * @param prompt - 用户输入的提示词
   * @param options - 可选的补全参数
   * @returns AI 生成的文本内容
   *
   * @example
   * ```typescript
   * const text = await ai.complete("写一首关于春天的诗");
   * console.log(text);
   * ```
   */
  async complete(
    prompt: string,
    options: CompletionOptions = {}
  ): Promise<string> {
    if (this.providerType === "anthropic" && this.anthropicClient) {
      // 调用 Anthropic Messages API
      const response = await this.anthropicClient.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens || this.maxTokens,
        system: options.system,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature,
      });

      // 提取返回的文本内容
      const block = response.content[0];
      if (block.type === "text") {
        return block.text;
      }
      throw new Error("Unexpected response type from Anthropic API");
    } else if (this.providerType === "openai-compatible" && this.openaiClient) {
      // 调用 OpenAI 兼容 API（DeepSeek、通义千问等）
      type Message = { role: "system" | "user" | "assistant"; content: string };
      const messages: Message[] = [];

      // 如果有 system 消息，添加到开头
      if (options.system) {
        messages.push({ role: "system", content: options.system });
      }

      messages.push({ role: "user", content: prompt });

      const response = await this.openaiClient.chat.completions.create({
        model: options.model || this.defaultModel,
        messages: messages as any,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature,
      });

      return response.choices[0]?.message?.content || "";
    }

    throw new Error("No AI client initialized");
  }

  /**
   * 生成文本补全（流式）
   *
   * @param prompt - 用户输入的提示词
   * @param onChunk - 接收每个文本块的回调函数
   * @param options - 可选的补全参数
   *
   * @example
   * ```typescript
   * await ai.stream(
   *   "讲一个故事",
   *   (chunk) => process.stdout.write(chunk)
   * );
   * ```
   */
  async stream(
    prompt: string,
    onChunk: (text: string) => void,
    options: CompletionOptions = {}
  ): Promise<void> {
    if (this.providerType === "anthropic" && this.anthropicClient) {
      // 创建流式请求
      const stream = await this.anthropicClient.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens || this.maxTokens,
        system: options.system,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature,
        stream: true,  // 启用流式输出
      });

      // 逐块处理返回的数据
      for await (const event of stream) {
        // 当收到新的文本块时，调用回调函数
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          onChunk(event.delta.text);
        }
      }
    } else {
      throw new Error("Stream not yet supported for openai-compatible provider");
    }
  }

  /**
   * 生成文本向量嵌入
   *
   * @param _text - 输入文本
   * @returns 向量数组
   * @throws {Error} Anthropic 不支持嵌入 API
   *
   * @note Anthropic 目前不提供嵌入 API，请使用其他提供商
   * （如 OpenAI、Cohere 或本地模型）来生成向量嵌入。
   */
  async embed(_text: string): Promise<number[]> {
    throw new Error("Embeddings not supported - use a different provider");
  }

  /**
   * 生成结构化输出
   *
   * 使用 Claude 的工具调用功能，强制返回符合 Zod Schema 的结构化数据。
   * 这确保了输出类型的安全性和一致性。
   *
   * @param prompt - 用户输入的提示词
   * @param options - 结构化输出选项（包含 Zod Schema）
   * @returns 经过 Zod 验证的结构化数据
   *
   * @example
   * ```typescript
   * const schema = z.object({
   *   score: z.number().min(0).max(100),
   *   category: z.enum(["high", "medium", "low"]),
   * });
   *
   * const result = await ai.structuredComplete(
   *   "分析这个项目的健康度",
   *   { schema }
   * );
   * // result.score 是 number 类型
   * // result.category 是 "high" | "medium" | "low" 类型
   * ```
   */
  async structuredComplete<T>(
    prompt: string,
    options: StructuredOutputOptions<T>
  ): Promise<T> {
    const {
      schema,
      toolName = "generate_analysis",
      toolDescription = "Generate structured analysis output",
      ...completionOptions
    } = options;

    // 将 Zod Schema 转换为 JSON Schema 格式
    const jsonSchema = this.zodToJsonSchema(schema) as any;

    if (this.providerType === "anthropic" && this.anthropicClient) {
      // 调用 Anthropic Messages API，使用工具调用
      const response = await this.anthropicClient.messages.create({
        model: completionOptions.model || this.defaultModel,
        max_tokens: completionOptions.maxTokens || this.maxTokens,
        system: completionOptions.system,
        messages: [{ role: "user", content: prompt }],
        temperature: completionOptions.temperature,
        tools: [
          {
            name: toolName,
            description: toolDescription,
            input_schema: jsonSchema,
          },
        ],
        // 强制使用工具
        tool_choice: {
          type: "tool",
          name: toolName,
        },
      });

      // 提取工具调用结果
      const block = response.content[0];
      if (block.type === "tool_use" && block.name === toolName) {
        const rawData = block.input as Record<string, unknown>;

        // 使用 Zod 验证返回的数据
        const validatedData = schema.parse(rawData);
        return validatedData;
      }

      throw new Error("Unexpected response from Anthropic API: expected tool_use");
    } else if (this.providerType === "openai-compatible" && this.openaiClient) {
      // 使用 JSON 模式调用 OpenAI 兼容 API
      const messages: Array<{ role: string; content: string }> = [];

      if (completionOptions.system) {
        messages.push({ role: "system", content: completionOptions.system });
      }

      messages.push({
        role: "user",
        content: `${prompt}\n\n请以 JSON 格式返回结果，符合以下 schema:\n${JSON.stringify(jsonSchema)}`,
      });

      const response = await this.openaiClient.chat.completions.create({
        model: completionOptions.model || this.defaultModel,
        messages: messages as any,
        max_tokens: completionOptions.maxTokens || this.maxTokens,
        temperature: completionOptions.temperature,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    }

    throw new Error("No AI client initialized");
  }

  /**
   * 将 Zod Schema 转换为 JSON Schema
   * @description 简化版的转换函数，支持常见类型
   *
   * @param schema - Zod Schema
   * @returns JSON Schema 对象
   */
  private zodToJsonSchema(schema: z.ZodTypeAny): any {
    // 获取 Zod Schema 的描述信息
    const zodDef = (schema as z.ZodObject<any>)._def;

    if (zodDef.typeName === "ZodObject") {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      // 遍历对象的所有字段
      for (const [key, value] of Object.entries(zodDef.shape())) {
        const fieldSchema = value as z.ZodTypeAny;
        properties[key] = this.convertZodTypeToJsonSchema(fieldSchema);

        // 检查字段是否可选
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

    // 如果不是对象类型，尝试直接转换
    return this.convertZodTypeToJsonSchema(schema);
  }

  /**
   * 转换单个 Zod 类型为 JSON Schema 类型
   */
  private convertZodTypeToJsonSchema(zodType: z.ZodTypeAny): unknown {
    // 处理各种 Zod 类型
    if (zodType instanceof z.ZodString) {
      return { type: "string" };
    }
    if (zodType instanceof z.ZodNumber) {
      const constraint: Record<string, unknown> = { type: "number" };
      // 处理 min/max 约束
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
      // ZodEnum 的 values 是一个 getter，需要通过 _def 访问
      return { type: "string", enum: (zodType as any)._def.values };
    }
    if (zodType instanceof z.ZodObject) {
      return this.zodToJsonSchema(zodType);
    }
    if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodDefault) {
      // 获取包装的类型
      const innerType = (zodType as any)._def.innerType;
      return this.convertZodTypeToJsonSchema(innerType);
    }
    if (zodType instanceof z.ZodEffects) {
      return this.convertZodTypeToJsonSchema((zodType as any)._def.schema);
    }

    // 默认返回字符串类型
    return { type: "string" };
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 AIProvider 实例的工厂函数
 *
 * @param config - 配置选项
 * @returns AIProvider 实例
 *
 * @example
 * ```typescript
 * const ai = createAI({ defaultModel: "claude-3-opus-20240229" });
 * ```
 */
export function createAI(config?: AIConfig): AIProvider {
  return new AIProvider(config);
}

// ============================================================================
// EmbeddingProvider 类
// ============================================================================

/**
 * Embedding 提供者配置选项
 */
export interface EmbeddingConfig {
  /** OpenAI API Key（默认从环境变量 OPENAI_API_KEY 读取） */
  apiKey?: string;
  /** 自定义 API 基础 URL */
  baseURL?: string;
  /** 默认模型名称（默认：text-embedding-3-small） */
  defaultModel?: string;
}

/**
 * Embedding 向量配置
 */
export interface EmbeddingOptions {
  /** 使用的模型名称 */
  model?: string;
}

/**
 * Embedding 向量提供者类
 * @description 封装 OpenAI Embeddings API 的核心类
 *
 * @example
 * ```typescript
 * const embedder = new EmbeddingProvider({ apiKey: "sk-..." });
 * const vector = await embedder.embed("你好世界");
 * console.log(vector.length); // 1536 (text-embedding-3-small)
 * ```
 */
export class EmbeddingProvider {
  /** OpenAI SDK 客户端实例 */
  private client: OpenAI;
  /** 默认使用的模型 */
  private defaultModel: string;

  /**
   * 创建 EmbeddingProvider 实例
   * @param config 配置选项
   */
  constructor(config: EmbeddingConfig = {}) {
    // 初始化 OpenAI 客户端
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
    });

    // 设置默认模型
    this.defaultModel = config.defaultModel || "text-embedding-3-small";
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 生成文本向量嵌入
   *
   * @param text - 输入文本（最大约 8000 tokens）
   * @param options - 可选的嵌入参数
   * @returns 向量数组（1536 维 for text-embedding-3-small）
   *
   * @example
   * ```typescript
   * const embedder = new EmbeddingProvider();
   * const vector = await embedder.embed("Hello, World!");
   * console.log(vector); // [0.123, -0.456, ...]
   * ```
   */
  async embed(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: options.model || this.defaultModel,
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * 批量生成文本向量嵌入
   *
   * @param texts - 输入文本数组
   * @param options - 可选的嵌入参数
   * @returns 向量数组（与输入文本一一对应）
   *
   * @example
   * ```typescript
   * const embedder = new EmbeddingProvider();
   * const vectors = await embedder.embedBatch([
   *   "第一个文档",
   *   "第二个文档",
   *   "第三个文档"
   * ]);
   * console.log(vectors.length); // 3
   * ```
   */
  async embedBatch(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<number[][]> {
    // OpenAI API 限制：每次请求最多 2048 个文本
    const BATCH_SIZE = 2048;

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      const response = await this.client.embeddings.create({
        model: options.model || this.defaultModel,
        input: batch,
      });

      // 按输入顺序收集结果
      for (const data of response.data) {
        results[data.index - i] = data.embedding;
      }
    }

    return results;
  }

  /**
   * 获取向量的维度
   *
   * @param model - 模型名称（可选，默认使用实例的默认模型）
   * @returns 向量维度
   */
  getDimensions(model?: string): number {
    const embeddingModel = model || this.defaultModel;

    // 常见模型的维度
    const dimensionsMap: Record<string, number> = {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    };

    return dimensionsMap[embeddingModel] || 1536;
  }
}

// ============================================================================
// BGE-M3 Embedding Provider 类
// ============================================================================

/**
 * BGE-M3 Embedding 提供者配置选项
 */
export interface BGEEmbeddingConfig {
  /** BGE-M3 API 基础 URL（默认：从环境变量 BGE_API_URL 读取，否则使用本地 Xinference） */
  baseURL?: string;
  /** API Key（云服务需要，默认从环境变量 SILICONFLOW_API_KEY 读取） */
  apiKey?: string;
  /** 模型名称（默认：从环境变量 BGE_MODEL_NAME 读取，否则使用 bge-m3） */
  modelName?: string;
}

/**
 * BGE-M3 Embedding 向量提供者类
 * @description 支持通过本地 API 或云服务使用 BGE-M3 模型生成向量
 *
 * BGE-M3 是由 BAAI 开发的多语言、多粒度 embedding 模型：
 * - 向量维度：1024
 * - 支持多语言（中文、英文等 100+ 种语言）
 * - 最大输入长度：8192 tokens
 * - 支持三种粒度：短文本、长文本、文档
 *
 * 支持的服务提供商：
 * 1. **硅基流动（推荐）**：云服务，无需本地部署
 *    - 环境变量：`SILICONFLOW_API_KEY`
 *    - 模型：`BAAI/bge-m3`
 * 2. **Xinference（本地）**：需要在本地部署模型
 *    - 安装：`pip install xinference`
 *    - 启动：`xinference launch --model-name bge-m3 --model-type embedding`
 * 3. **其他 OpenAI 兼容服务**：LocalAI、自定义服务等
 *
 * @example
 * ```typescript
 * // 使用默认配置（自动检测环境变量）
 * const embedder = new BGEEmbeddingProvider();
 * const vector = await embedder.embed("你好世界");
 * console.log(vector.length); // 1024
 *
 * // 使用硅基流动云服务
 * const embedder = new BGEEmbeddingProvider({
 *   apiKey: "sk-xxx",
 *   baseURL: "https://api.siliconflow.cn/v1",
 *   modelName: "BAAI/bge-m3"
 * });
 *
 * // 使用本地 Xinference 服务
 * const embedder = new BGEEmbeddingProvider({
 *   baseURL: "http://localhost:9997/v1",
 *   modelName: "bge-m3"
 * });
 * ```
 */
export class BGEEmbeddingProvider {
  /** HTTP 客户端 */
  private client: OpenAI;
  /** 默认模型名称 */
  private readonly defaultModel: string;
  /** BGE-M3 向量维度 */
  public readonly DIMENSIONS = 1024;

  /**
   * 创建 BGEEmbeddingProvider 实例
   * @param config 配置选项
   */
  constructor(config: BGEEmbeddingConfig = {}) {
    // 确定使用的 API Key（优先配置，其次环境变量，最后本地服务使用 dummy-key）
    const apiKey = config.apiKey ||
                   process.env.SILICONFLOW_API_KEY ||
                   "dummy-key"; // 本地服务通常不需要 API Key

    // 确定基础 URL（优先配置，其次环境变量，最后默认本地 Xinference）
    const baseURL = config.baseURL ||
                    process.env.BGE_API_URL ||
                    "http://localhost:9997/v1";

    // 确定模型名称（优先配置，其次环境变量，最后默认 bge-m3）
    const modelName = config.modelName ||
                      process.env.BGE_MODEL_NAME ||
                      "bge-m3";

    // 使用 OpenAI SDK 作为 HTTP 客户端（兼容 OpenAI API 格式）
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });

    this.defaultModel = modelName;

    // 打印配置信息（便于调试）
    if (process.env.NODE_ENV === "development") {
      console.log(`[BGEEmbeddingProvider] Initialized with:`, {
        baseURL,
        modelName,
        hasApiKey: !!apiKey && apiKey !== "dummy-key",
      });
    }
  }

  /**
   * 生成文本向量嵌入
   *
   * @param text - 输入文本
   * @returns 1024 维向量数组
   *
   * @example
   * ```typescript
   * const embedder = new BGEEmbeddingProvider();
   * const vector = await embedder.embed("Hello, World!");
   * console.log(vector.length); // 1024
   * ```
   */
  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.defaultModel,
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * 批量生成文本向量嵌入
   *
   * @param texts - 输入文本数组
   * @returns 向量数组（与输入文本一一对应）
   *
   * @example
   * ```typescript
   * const embedder = new BGEEmbeddingProvider();
   * const vectors = await embedder.embedBatch([
   *   "第一个文档",
   *   "第二个文档"
   * ]);
   * console.log(vectors.length); // 2
   * console.log(vectors[0].length); // 1024
   * ```
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.defaultModel,
      input: texts,
    });

    // 按输入顺序排序结果
    const sortedResults = response.data
      .sort((a, b) => a.index - b.index)
      .map((data) => data.embedding);

    return sortedResults;
  }

  /**
   * 获取向量维度
   * @returns BGE-M3 的固定维度 1024
   */
  getDimensions(): number {
    return 1024;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 EmbeddingProvider 实例的工厂函数
 *
 * @param config - 配置选项
 * @returns EmbeddingProvider 实例
 *
 * @example
 * ```typescript
 * const embedder = createEmbedding();
 * const vector = await embedder.embed("Hello");
 * ```
 */
export function createEmbedding(config?: EmbeddingConfig): EmbeddingProvider {
  return new EmbeddingProvider(config);
}

/**
 * 创建 BGEEmbeddingProvider 实例的工厂函数
 *
 * @param config - 配置选项
 * @returns BGEEmbeddingProvider 实例
 *
 * @example
 * ```typescript
 * // 使用默认配置（自动检测环境变量）
 * const embedder = createBGEEmbedding();
 * const vector = await embedder.embed("你好");
 * console.log(vector.length); // 1024
 *
 * // 使用硅基流动云服务
 * const embedder = createBGEEmbedding({
 *   apiKey: "sk-xxx",
 *   baseURL: "https://api.siliconflow.cn/v1",
 *   modelName: "BAAI/bge-m3"
 * });
 * ```
 */
export function createBGEEmbedding(config?: BGEEmbeddingConfig): BGEEmbeddingProvider {
  return new BGEEmbeddingProvider(config);
}

// ============================================================================
// 文本分块器
// ============================================================================

/**
 * 文本分块配置
 */
export interface TextChunkerConfig {
  /** 每个分块的最大 token 数（默认：500） */
  maxTokens?: number;
  /** 分块之间的重叠 token 数（默认：50） */
  overlapTokens?: number;
  /** 分块类型 */
  chunkType?: "readme" | "issues" | "commits" | "description" | "hackernews";
}

/**
 * 文本分块结果
 */
export interface TextChunk {
  /** 分块内容 */
  content: string;
  /** 分块类型 */
  chunkType: string;
  /** 来源标识 */
  sourceId?: string;
  /** 分块序号 */
  chunkIndex: number;
  /** token 数量 */
  tokenCount: number;
}

/**
 * 文本分块器类
 * @description 将长文本分割成适合 embedding 的小块
 *
 * @example
 * ```typescript
 * const chunker = new TextChunker({ maxTokens: 500 });
 * const chunks = chunker.chunk("很长的文档内容...");
 * ```
 */
export class TextChunker {
  private maxTokens: number;
  private overlapTokens: number;

  constructor(config: TextChunkerConfig = {}) {
    this.maxTokens = config.maxTokens || 500;
    this.overlapTokens = config.overlapTokens || 50;
  }

  /**
   * 估算文本的 token 数量
   * 使用简单的估算：平均 1 token ≈ 4 字符
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * 将文本分割成多个分块
   */
  chunk(
    text: string,
    sourceId?: string,
    chunkType?: string
  ): TextChunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // 如果文本小于最大长度，直接返回单个分块
    const maxChars = this.maxTokens * 4;
    if (text.length <= maxChars) {
      return [{
        content: text.trim(),
        chunkType: chunkType || "description",
        sourceId,
        chunkIndex: 0,
        tokenCount: this.estimateTokens(text),
      }];
    }

    const chunks: TextChunk[] = [];
    const overlapChars = this.overlapTokens * 4;

    let currentIndex = 0;
    let chunkIndex = 0;

    while (currentIndex < text.length) {
      // 提取当前分块
      let chunkText = text.slice(currentIndex, currentIndex + maxChars);

      // 尝试在句子边界分割（更自然）
      if (currentIndex + maxChars < text.length) {
        const lastPeriod = chunkText.lastIndexOf(".");
        const lastNewline = chunkText.lastIndexOf("\n");

        // 优先在句号、换行符处分割
        let splitPos = Math.max(lastPeriod, lastNewline);

        if (splitPos > 0) {
          chunkText = chunkText.slice(0, splitPos + 1);
        }
      }

      const tokenCount = this.estimateTokens(chunkText);

      chunks.push({
        content: chunkText.trim(),
        chunkType: chunkType || "description",
        sourceId,
        chunkIndex,
        tokenCount,
      });

      // 移动到下一个分块（考虑重叠）
      const step = Math.max(1, chunkText.length - overlapChars);
      currentIndex += step;
      chunkIndex++;
    }

    return chunks;
  }

  /**
   * 将多个文本源合并后分块
   */
  chunkMultiple(
    sources: Array<{
      text: string;
      sourceId?: string;
      chunkType: string;
    }>
  ): TextChunk[] {
    const allChunks: TextChunk[] = [];

    for (const source of sources) {
      const chunks = this.chunk(source.text, source.sourceId, source.chunkType);
      allChunks.push(...chunks);
    }

    return allChunks;
  }
}

/**
 * 创建 TextChunker 实例的工厂函数
 */
export function createChunker(config?: TextChunkerConfig): TextChunker {
  return new TextChunker(config);
}

// ============================================================================
// Langtum 工作流平台导出
// ============================================================================

export {
  LangtumClient,
  createLangtumClient,
  LangtumAPIError,
  WorkflowTimeoutError,
  WebhookSignatureError,
  type LangtumConfig,
  type WorkflowTriggerInput,
  type DailyHealthReportInput,
  type QuickAssessmentInput,
  type WorkflowExecutionResponse,
  type WorkflowExecutionDetail,
  type WorkflowExecutionStatus,
  type WebhookEventType,
  type WebhookHeaders,
  type WebhookRequestBody,
} from "./langtum.js";
