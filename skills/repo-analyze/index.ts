/**
 * @package skills/repo-analyze
 * @description GitHub 仓库分析工具
 *
 * 使用 AI 分析 GitHub 仓库的健康度，包括：
 * - 活跃度分析
 * - 社区健康度
 * - 技术债务评估
 * - 投资建议
 *
 * 支持管道模式（stdin 输入）
 *
 * @example
 * # 直接使用
 * ./repo-analyze/index.ts vercel/next.js
 *
 * # 管道组合
 * cat repos.txt | ./repo-analyze/index.ts --batch
 */

import { z } from "zod";
import { createAI } from "@devscope/ai";
import { repositoryAnalysisSchema } from "@devscope/shared";

// ============================================================================
// 输入验证
// ============================================================================

/**
 * 单个仓库分析输入 Schema
 */
export const RepoAnalyzeInputSchema = z.object({
  /** 仓库标识符 (owner/repo) */
  repo: z.string().regex(/^[\w-]+\/[\w-]+$/, "格式应为 owner/repo"),
  /** 可选的额外上下文 */
  context: z.string().optional(),
});

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 仓库分析结果
 */
export type AnalysisResult = z.infer<typeof repositoryAnalysisSchema>;

// ============================================================================
// 分析函数
// ============================================================================

/**
 * 构建分析提示词
 */
function buildAnalysisPrompt(owner: string, repo: string, context?: string): string {
  let prompt = `请分析 GitHub 仓库 ${owner}/${repo} 的健康度。`;

  if (context) {
    prompt += `\n\n额外上下文：${context}`;
  }

  prompt += `\n\n请从以下维度进行分析：
1. 活跃度评估 (high/medium/low/dead)
2. 健康度评分 (0-100)
3. 关键指标
4. 风险因素
5. 机会因素
6. 投资建议 (invest/watch/avoid)
7. 总结`;

  return prompt;
}

/**
 * 分析单个仓库
 */
export async function analyzeRepository(
  input: z.infer<typeof RepoAnalyzeInputSchema>
): Promise<AnalysisResult> {
  const [owner, repo] = input.repo.split("/");
  const ai = createAI();

  const prompt = buildAnalysisPrompt(owner, repo, input.context);

  return ai.structuredComplete(prompt, {
    schema: repositoryAnalysisSchema,
    toolName: "repository_analysis",
    toolDescription: "生成 GitHub 仓库健康度分析报告",
    system: `你是一个专业的开源项目分析师。请根据公开信息分析仓库的健康度，并返回结构化的分析结果。`,
    temperature: 0.3,
  });
}

/**
 * 批量分析仓库
 */
export async function analyzeRepositories(
  inputs: z.infer<typeof RepoAnalyzeInputSchema>[]
): Promise<AnalysisResult[]> {
  return Promise.all(inputs.map((input) => analyzeRepository(input)));
}

// ============================================================================
// CLI 入口
// ============================================================================

/**
 * CLI 入口函数
 */
export async function main(args: string[]): Promise<void> {
  // 解析命令行参数
  let repo: string | undefined;
  let context: string | undefined;
  let batch = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch") {
      batch = true;
    } else if (arg === "--context" && args[i + 1]) {
      context = args[i + 1];
      i++;
    } else if (!arg.startsWith("-") && !repo) {
      repo = arg;
    }
  }

  // 检查输入来源
  let inputs: z.infer<typeof RepoAnalyzeInputSchema>[];

  if (batch || !process.stdin.isTTY) {
    // 从 stdin 读取
    let inputText = "";
    for await (const chunk of process.stdin) {
      inputText += chunk;
    }

    const repos = inputText
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    inputs = repos.map((r) => ({
      repo: r,
      context,
    }));
  } else if (repo) {
    inputs = [{ repo, context }];
  } else {
    console.error(
      JSON.stringify({
        error: "请提供仓库标识符 (owner/repo) 或使用 --batch 从 stdin 读取",
        usage: "repo-analyze <owner/repo> [--context <上下文>] [--batch]",
        example: "echo 'vercel/next.js' | repo-analyze --batch",
      })
    );
    process.exit(1);
  }

  try {
    // 验证输入
    const validatedInputs = inputs.map((input) =>
      RepoAnalyzeInputSchema.parse(input)
    );

    // 分析仓库
    const results = await analyzeRepositories(validatedInputs);

    // 输出 JSON
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "未知错误",
        details: error,
      })
    );
    process.exit(1);
  }
}
