/**
 * @package skills/repo-fetch
 * @description GitHub 仓库数据获取工具
 *
 * 从 GitHub 获取仓库数据，支持：
 * - 基础仓库信息
 * - Issues 数据
 * - Commits 数据
 * - Stars/Forks 统计
 *
 * 支持管道模式（stdin 输入）
 *
 * @example
 * # 直接使用
 * ./repo-fetch/index.ts vercel/next.js
 *
 * # 管道组合
 * cat repos.txt | ./repo-fetch/index.ts --batch
 */

import { z } from "zod";
import { GitHubClient, RepositoryInfo, Issue, Commit } from "@devscope/shared";

// ============================================================================
// 输入验证
// ============================================================================

/**
 * 仓库标识符格式验证
 * 支持: owner/repo, owner/repo.name, owner/repo-name 等
 */
const repoIdentifierRegex = /^[\w.-]+\/[\w.-]+$/;

/**
 * 单个仓库输入 Schema
 */
export const RepoFetchInputSchema = z.object({
  /** 仓库标识符 (owner/repo) */
  repo: z.string().regex(repoIdentifierRegex, "格式应为 owner/repo"),
  /** 是否包含 Issues 数据 */
  includeIssues: z.boolean().default(false),
  /** 是否包含 Commits 数据 */
  includeCommits: z.boolean().default(false),
  /** Issues 数量限制 */
  issuesLimit: z.number().min(1).max(100).default(10),
  /** Commits 数量限制 */
  commitsLimit: z.number().min(1).max(100).default(10),
});

/**
 * 批量输入 Schema
 */
export const RepoFetchBatchInputSchema = z.array(RepoFetchInputSchema);

/**
 * 完整仓库数据
 */
export interface RepoData {
  repository: RepositoryInfo;
  issues?: Issue[];
  commits?: Commit[];
  fetchedAt: string;
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 获取仓库数据
 */
export async function fetchRepository(input: z.infer<typeof RepoFetchInputSchema>): Promise<RepoData> {
  const [owner, repo] = input.repo.split("/");
  const client = new GitHubClient();

  const [repository, issues, commits] = await Promise.all([
    client.getRepository(owner, repo),
    input.includeIssues ? client.getIssues(owner, repo, input.issuesLimit) : Promise.resolve([]),
    input.includeCommits ? client.getCommits(owner, repo, input.commitsLimit) : Promise.resolve([]),
  ]);

  return {
    repository,
    ...(input.includeIssues && { issues }),
    ...(input.includeCommits && { commits }),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 批量获取仓库数据
 */
export async function fetchRepositories(
  inputs: z.infer<typeof RepoFetchBatchInputSchema>
): Promise<RepoData[]> {
  return Promise.all(inputs.map((input) => fetchRepository(input)));
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
  let batch = false;
  let includeIssues = false;
  let includeCommits = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch") {
      batch = true;
    } else if (arg === "--include-issues") {
      includeIssues = true;
    } else if (arg === "--include-commits") {
      includeCommits = true;
    } else if (!arg.startsWith("-") && !repo) {
      repo = arg;
    }
  }

  // 检查输入来源：管道 stdin 或命令行参数
  let inputs: z.infer<typeof RepoFetchBatchInputSchema>;

  // 判断是否为管道模式：显式指定 --batch 或 stdin 不是 TTY
  const isPipeMode = batch || process.stdin.isTTY === false;

  if (isPipeMode && !repo) {
    // 从 stdin 读取（管道模式）
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
      includeIssues,
      includeCommits,
      issuesLimit: 10,
      commitsLimit: 10,
    }));
  } else if (repo) {
    // 命令行参数模式
    inputs = [
      {
        repo,
        includeIssues,
        includeCommits,
        issuesLimit: 10,
        commitsLimit: 10,
      },
    ];
  } else {
    console.error(JSON.stringify({
      error: "请提供仓库标识符 (owner/repo) 或使用 --batch 从 stdin 读取",
      usage: "repo-fetch <owner/repo> [--include-issues] [--include-commits]",
      example: "echo 'vercel/next.js' | repo-fetch --batch",
    }));
    process.exit(1);
  }

  try {
    // 验证输入
    const validatedInputs = RepoFetchBatchInputSchema.parse(inputs);

    // 获取数据
    const results = await fetchRepositories(validatedInputs);

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

// 导出类型
export type { z };

// 执行入口
main(process.argv.slice(2));
