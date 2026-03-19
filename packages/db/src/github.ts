/**
 * @package @devscope/db
 * @description GitHub 数据采集 - Octokit 客户端
 *
 * 使用 Octokit 获取 GitHub 仓库数据，包括：
 * - 仓库基础信息
 * - README 内容
 * - Issues 数据
 * - Commits 数据
 *
 * @module github
 */

import { Octokit } from "octokit";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * GitHub 仓库信息
 */
export interface GitHubRepoInfo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string | null;
  createdAt: Date;
  updatedAt: Date;
  pushedAt: Date;
}

/**
 * Issue 数据
 */
export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  author: string;
  createdAt: Date;
  updatedAt: Date;
  comments: number;
  labels: string[];
  body: string | null;
}

/**
 * Commit 数据
 */
export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: Date;
}

/**
 * 用户关注的仓库
 */
export interface GitHubFollowingRepo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  updatedAt: Date;
}

// ============================================================================
// GitHub 客户端
// ============================================================================

/**
 * GitHub 数据采集客户端
 */
export class GitHubCollector {
  private octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit({
      auth: token || process.env.GITHUB_TOKEN,
    });
  }

  /**
   * 获取仓库基础信息
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepoInfo> {
    const { data } = await this.octokit.rest.repos.get({
      owner,
      repo,
    });

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
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      pushedAt: new Date(data.pushed_at),
    };
  }

  /**
   * 获取 README 内容
   *
   * @param owner - 仓库所有者
   * @param repo - 仓库名
   * @returns README 内容（markdown）和 raw URL
   */
  async getReadme(owner: string, repo: string): Promise<{
    content: string;
    url: string;
  } | null> {
    try {
      const { data } = await this.octokit.rest.repos.getReadme({
        owner,
        repo,
        mediaType: {
          format: "raw",
        },
      });

      // 获取 raw URL
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;

      return {
        content: data as unknown as string,
        url,
      };
    } catch (error: unknown) {
      const err = error as { status?: number };
      if (err.status === 404) {
        // README 不存在
        return null;
      }
      throw error;
    }
  }

  /**
   * 获取 Issues
   */
  async getIssues(
    owner: string,
    repo: string,
    limit: number = 20
  ): Promise<GitHubIssue[]> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      per_page: limit,
      sort: "updated",
      direction: "desc",
    });

    // 过滤掉 pull requests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const issues = data.filter((item: any) => !item.pull_request);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return issues.map((item: any) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      author: item.user?.login || "unknown",
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
      comments: item.comments,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labels: item.labels.map((l: any) => (typeof l === "string" ? l : l.name)),
      body: item.body,
    }));
  }

  /**
   * 获取 Commits
   */
  async getCommits(
    owner: string,
    repo: string,
    limit: number = 10
  ): Promise<GitHubCommit[]> {
    const { data } = await this.octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: limit,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) => ({
      sha: item.sha,
      message: item.commit.message,
      author: item.commit.author?.name || "unknown",
      date: new Date(item.commit.author?.date || ""),
    }));
  }

  /**
   * 获取用户关注的仓库列表
   *
   * @param username - GitHub 用户名（不传则获取认证用户的关注列表）
   * @param limit - 返回数量限制，默认 100
   * @returns 用户关注的仓库列表
   */
  async getFollowing(username?: string, limit: number = 100): Promise<GitHubFollowingRepo[]> {
    const repos: GitHubFollowingRepo[] = [];
    let page = 1;
    const perPage = 100;

    while (repos.length < limit) {
      // 使用 Octokit 的 watch.list（获取用户订阅的仓库）或 users.listFollowingForUser
      // 这里使用 users.listFollowingForUser 获取用户关注的仓库
      const endpoint = username
        ? this.octokit.rest.activity.listReposStarredByUser
        : this.octokit.rest.activity.listReposStarredByAuthenticatedUser;

      const { data } = await endpoint({
        username: username || "",
        per_page: perPage,
        page,
      });

      if (data.length === 0) break;

      for (const item of data) {
        if (repos.length >= limit) break;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const repo = (item as any).repo || item;

        repos.push({
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
          description: repo.description,
          url: repo.html_url,
          stars: repo.stargazers_count,
          language: repo.language,
          updatedAt: new Date(repo.updated_at),
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    return repos;
  }

  /**
   * 完整采集仓库数据
   */
  async collectRepository(
    owner: string,
    repo: string,
    options: {
      includeReadme?: boolean;
      includeIssues?: boolean;
      includeCommits?: boolean;
      issuesLimit?: number;
      commitsLimit?: number;
    } = {}
  ): Promise<{
    repository: GitHubRepoInfo;
    readme: string | null;
    readmeUrl: string | null;
    issues: GitHubIssue[];
    commits: GitHubCommit[];
  }> {
    const {
      includeReadme = true,
      includeIssues = true,
      includeCommits = false,
      issuesLimit = 20,
      commitsLimit = 10,
    } = options;

    const [repository, readmeData, issues, commits] = await Promise.all([
      this.getRepository(owner, repo),
      includeReadme ? this.getReadme(owner, repo) : Promise.resolve(null),
      includeIssues
        ? this.getIssues(owner, repo, issuesLimit)
        : Promise.resolve([]),
      includeCommits
        ? this.getCommits(owner, repo, commitsLimit)
        : Promise.resolve([]),
    ]);

    return {
      repository,
      readme: readmeData?.content || null,
      readmeUrl: readmeData?.url || null,
      issues,
      commits,
    };
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建默认的 GitHub 采集客户端
 */
export function createGitHubCollector(token?: string): GitHubCollector {
  return new GitHubCollector(token);
}

/**
 * 从仓库全名解析 owner 和 repo
 */
export function parseRepoFullName(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository full name: ${fullName}`);
  }
  return { owner, repo };
}
