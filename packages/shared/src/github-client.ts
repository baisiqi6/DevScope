/**
 * @package @devscope/shared/github-client
 * @description 统一的 GitHub API 客户端，供 Agent SDK 和 Skills 使用
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * GitHub 仓库信息
 */
export interface RepositoryInfo {
  /** 完整仓库名 (owner/repo) */
  fullName: string;
  /** 仓库名 */
  name: string;
  /** 所有者 */
  owner: string;
  /** 描述 */
  description: string | null;
  /** URL */
  url: string;
  /** Stars 数 */
  stars: number;
  /** Forks 数 */
  forks: number;
  /** Open Issues 数 */
  openIssues: number;
  /** 主要语言 */
  language: string | null;
  /** 许可证 */
  license: string | null;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 最后推送时间 */
  pushedAt: string;
}

/**
 * GitHub Issue
 */
export interface Issue {
  /** Issue 编号 */
  number: number;
  /** 标题 */
  title: string;
  /** 状态 */
  state: string;
  /** 作者 */
  author: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 评论数 */
  comments: number;
  /** 标签 */
  labels: string[];
}

/**
 * GitHub Commit
 */
export interface Commit {
  /** SHA */
  sha: string;
  /** 提交信息 */
  message: string;
  /** 作者 */
  author: string;
  /** 日期 */
  date: string;
}

// ============================================================================
// GitHubClient 类
// ============================================================================

/**
 * GitHub API 客户端类
 * @description 提供 GitHub API 的封装方法
 */
export class GitHubClient {
  private token: string | undefined;
  private baseUrl = "https://api.github.com";

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN;
  }

  /**
   * 发送 API 请求（带超时和重试）
   */
  private async fetch<T>(endpoint: string, retries = 3): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // 增加超时时间到 30 秒
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        return response.json() as Promise<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 如果是最后一次尝试，抛出错误
        if (attempt === retries - 1) {
          throw lastError;
        }

        // 等待一段时间后重试（指数退避）
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error("Unknown error");
  }

  /**
   * 获取仓库信息
   */
  async getRepository(owner: string, repo: string): Promise<RepositoryInfo> {
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

  /**
   * 获取 Issues
   */
  async getIssues(owner: string, repo: string, limit: number): Promise<Issue[]> {
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

  /**
   * 获取 Commits
   */
  async getCommits(owner: string, repo: string, limit: number): Promise<Commit[]> {
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
