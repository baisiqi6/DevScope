/**
 * @package @devscope/db
 * @description OSSInsight API 客户端
 *
 * 使用 OSSInsight API 获取 GitHub 仓库的深度分析和洞察数据。
 * API 文档: https://ossinsight.io/docs/api/
 *
 * @module ossinsight
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 趋势仓库数据
 */
export interface TrendingRepo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  starsSince: number;
  contributors: number;
  pullRequests: number;
}

/**
 * 仓库事件类型
 */
export type EventType =
  | "fork"
  | "star"
  | "issues"
  | "pull_request"
  | "commit"
  | "watch";

/**
 * 仓库事件统计
 */
export interface RepoEvent {
  id: number;
  eventType: EventType;
  count: number;
  date: string; // ISO 8601 format
}

/**
 * 贡献者统计
 */
export interface ContributorStats {
  login: string;
  name: string | null;
  avatar: string;
  commits: number;
  additions: number;
  deletions: number;
  prsCreated: number;
  prsMerged: number;
  issuesCreated: number;
  issuesCommented: number;
}

/**
 * PR/Issue 创建者统计
 */
export interface CreatorStats {
  login: string;
  name: string | null;
  avatar: string;
  count: number;
  averageTime: number | null; // 平均响应时间（小时）
}

/**
 * 仓库统计数据
 */
export interface RepoStats {
  starsHistory: RepoEvent[];
  forksHistory: RepoEvent[];
  issuesHistory: RepoEvent[];
  prHistory: RepoEvent[];
  commitHistory: RepoEvent[];
  contributors: ContributorStats[];
  topIssueCreators: CreatorStats[];
  topPRCreators: CreatorStats[];
}

/**
 * OSSInsight 集合统计
 */
export interface CollectionStats {
  totalCount: number;
  repositories: TrendingRepo[];
  updatedSince: string;
}

// ============================================================================
// OSSInsight 客户端
// ============================================================================

/**
 * OSSInsight API 客户端
 * 提供访问 GitHub 深度分析数据的能力
 */
export class OSSInsightClient {
  private baseUrl: string;

  constructor(baseUrl: string = "https://api.ossinsight.io/v1") {
    this.baseUrl = baseUrl;
  }

  /**
   * 获取趋势仓库列表
   *
   * @param limit - 返回数量限制 (默认 10)
   * @param period - 时间周期: 24h, 7d, 30d (默认 7d)
   * @param language - 编程语言过滤 (可选)
   */
  async getTrendingRepos(
    limit: number = 10,
    period: "24h" | "7d" | "30d" = "7d",
    language?: string
  ): Promise<TrendingRepo[]> {
    const params = new URLSearchParams({
      limit: String(limit),
      period,
    });

    if (language) {
      params.append("language", language);
    }

    const response = await this.fetch(
      `/trending-repos/?${params.toString()}`
    );

    return this.parseResponse(response);
  }

  /**
   * 获取指定语言的趋势仓库
   *
   * @param language - 编程语言
   * @param limit - 返回数量限制
   */
  async getTrendingByLanguage(
    language: string,
    limit: number = 10
  ): Promise<TrendingRepo[]> {
    return this.getTrendingRepos(limit, "7d", language);
  }

  /**
   * 获取仓库统计数据
   *
   * @param owner - 仓库所有者
   * @param repo - 仓库名称
   * @param days - 历史天数 (默认 30)
   */
  async getRepoStats(
    owner: string,
    repo: string,
    days: number = 30
  ): Promise<RepoStats> {
    const params = new URLSearchParams({
      days: String(days),
    });

    const response = await this.fetch(
      `/repos/${owner}/${repo}/stats/timeline?${params.toString()}`
    );

    return this.parseResponse(response);
  }

  /**
   * 获取仓库贡献者排名
   *
   * @param owner - 仓库所有者
   * @param repo - 仓库名称
   * @param limit - 返回数量限制 (默认 10)
   */
  async getTopContributors(
    owner: string,
    repo: string,
    limit: number = 10
  ): Promise<ContributorStats[]> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    const response = await this.fetch(
      `/repos/${owner}/${repo}/contributors?${params.toString()}`
    );

    return this.parseResponse(response);
  }

  /**
   * 获取 Issue 创建者排名
   *
   * @param owner - 仓库所有者
   * @param repo - 仓库名称
   * @param limit - 返回数量限制 (默认 10)
   */
  async getTopIssueCreators(
    owner: string,
    repo: string,
    limit: number = 10
  ): Promise<CreatorStats[]> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    const response = await this.fetch(
      `/repos/${owner}/${repo}/issue-creators?${params.toString()}`
    );

    return this.parseResponse(response);
  }

  /**
   * 获取 PR 创建者排名
   *
   * @param owner - 仓库所有者
   * @param repo - 仓库名称
   * @param limit - 返回数量限制 (默认 10)
   */
  async getTopPRCreators(
    owner: string,
    repo: string,
    limit: number = 10
  ): Promise<CreatorStats[]> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    const response = await this.fetch(
      `/repos/${owner}/${repo}/pr-creators?${params.toString()}`
    );

    return this.parseResponse(response);
  }

  /**
   * 获取 Stargazers 排名
   *
   * @param owner - 仓库所有者
   * @param repo - 仓库名称
   * @param limit - 返回数量限制 (默认 10)
   */
  async getTopStargazers(
    owner: string,
    repo: string,
    limit: number = 10
  ): Promise<
    Array<{
      login: string;
      name: string | null;
      avatar: string;
      starredAt: string;
    }>
  > {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    const response = await this.fetch(
      `/repos/${owner}/${repo}/stargazers?${params.toString()}`
    );

    const data = await this.parseResponse<
      Array<{
        login: string;
        name: string | null;
        avatar: string;
        starred_at: string;
      }>
    >(response);

    // 转换字段名以保持一致性
    return data.map((item) => ({
      login: item.login,
      name: item.name,
      avatar: item.avatar,
      starredAt: item.starred_at,
    }));
  }

  /**
   * 获取集合统计
   * OSSInsight 预定义的优质项目集合
   *
   * @param collectionId - 集合 ID (如: 'aigc', 'web3', 'developer-tools')
   */
  async getCollection(collectionId: string): Promise<CollectionStats> {
    const response = await this.fetch(
      `/collections/${collectionId}`
    );

    return this.parseResponse(response);
  }

  /**
   * 搜索仓库
   *
   * @param query - 搜索关键词
   * @param limit - 返回数量限制
   */
  async searchRepos(
    query: string,
    limit: number = 10
  ): Promise<TrendingRepo[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });

    const response = await this.fetch(
      `/search/repos?${params.toString()}`
    );

    return this.parseResponse(response);
  }

  /**
   * 获取仓库的综合洞察
   * 一次性获取多个维度的数据
   *
   * @param owner - 仓库所有者
   * @param repo - 仓库名称
   */
  async getRepoInsights(owner: string, repo: string): Promise<{
    stats: RepoStats;
    topContributors: ContributorStats[];
    topIssueCreators: CreatorStats[];
    topPRCreators: CreatorStats[];
  }> {
    const [stats, topContributors, topIssueCreators, topPRCreators] =
      await Promise.all([
        this.getRepoStats(owner, repo),
        this.getTopContributors(owner, repo),
        this.getTopIssueCreators(owner, repo),
        this.getTopPRCreators(owner, repo),
      ]);

    return {
      stats,
      topContributors,
      topIssueCreators,
      topPRCreators,
    };
  }

  // ========================================================================
  // 私有方法
  // ========================================================================

  /**
   * 执行 API 请求
   */
  private async fetch(endpoint: string): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        // OSSInsight API 在 beta 版本不需要认证
        // 如果未来需要认证，可以在这里添加 API Key
        // "Authorization": `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response
        .text()
        .then((text) => text || response.statusText);
      throw new Error(`OSSInsight API error (${response.status}): ${error}`);
    }

    return response;
  }

  /**
   * 解析响应数据
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      const data: unknown = await response.json();

      // OSSInsight API 返回格式: { data: {...}, error: null }
      if (typeof data === "object" && data !== null && "data" in data) {
        return (data as { data: T }).data;
      }

      return data as T;
    }

    throw new Error(`Unsupported content type: ${contentType}`);
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建默认的 OSSInsight 客户端
 */
export function createOSSInsightClient(
  baseUrl?: string
): OSSInsightClient {
  return new OSSInsightClient(baseUrl);
}
