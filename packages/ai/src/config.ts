export interface OpenAICompatibleConfigInput {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  defaultModel?: string;
}

export interface ResolvedOpenAICompatibleConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * AIProvider 与 DevScopeAgent 共用的环境变量解析边界。
 * 通用 OpenAI-compatible 配置优先，DeepSeek 变量作为向后兼容回退。
 */
export function resolveOpenAICompatibleConfig(
  config: OpenAICompatibleConfigInput = {},
): ResolvedOpenAICompatibleConfig {
  const apiKey = config.apiKey
    || process.env.OPENAI_COMPATIBLE_API_KEY
    || process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error(
      "API Key is required. Set OPENAI_COMPATIBLE_API_KEY or DEEPSEEK_API_KEY environment variable.",
    );
  }

  return {
    apiKey,
    baseURL: config.baseURL
      || process.env.OPENAI_COMPATIBLE_BASE_URL
      || process.env.DEEPSEEK_BASE_URL
      || "https://api.deepseek.com",
    model: config.model
      || config.defaultModel
      || process.env.OPENAI_COMPATIBLE_MODEL
      || process.env.DEEPSEEK_MODEL
      || "deepseek-chat",
  };
}
