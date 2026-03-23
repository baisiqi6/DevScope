/**
 * @package @devscope/db
 * @description GitHub 数据采集 - Octokit 客户端
 *
 * 使用 Octokit 获取 GitHub 仓库数据，包括：
 * - 仓库基础信息
 * - README 内容
 * - Issues 数据
 * - Commits 数据
 * - Pull Requests 数据
 * - 贡献者数据
 * - 分支与标签数据
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
  closedAt: Date | null;
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
 * Pull Request 数据
 */
export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  author: string;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  additions: number;
  deletions: number;
  comments: number;
  reviewComments: number;
  labels: string[];
}

/**
 * 贡献者数据
 */
export interface GitHubContributor {
  login: string;
  contributions: number;
  type: string;
}

/**
 * 分支数据
 */
export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

/**
 * 标签数据
 */
export interface GitHubTag {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  zipballUrl: string;
  tarballUrl: string;
  node_id: string;
}

/**
 * 仓库内容文件
 */
export interface GitHubContentFile {
  name: string;
  path: string;
  type: string;
  size: number;
  url: string;
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

/**
 * 仓库详细统计数据
 */
export interface GitHubRepoStats {
  // 基础信息
  repository: GitHubRepoInfo;

  // 代码活跃度
  commitFrequency: {
    lastCommitDate: Date;
    commitsLast7Days: number;
    commitsLast30Days: number;
    commitsLast90Days: number;
    totalBranches: number;
    totalTags: number;
    defaultBranch: string;
  };

  // Issues 统计
  issuesStats: {
    openIssues: number;
    closedIssues: number;
    totalIssues: number;
    avgResolutionTime: number; // 小时
    openIssuesLast7Days: number;
    closedIssuesLast7Days: number;
    issuesWithNoAssignee: number;
    issuesStaleOver30Days: number;
  };

  // Pull Requests 统计
  prStats: {
    openPRs: number;
    mergedPRs: number;
    closedPRs: number;
    totalPRs: number;
    avgMergeTime: number; // 小时
    openPRsLast7Days: number;
    mergedPRsLast7Days: number;
    prsWithNoReview: number;
    prsStaleOver30Days: number;
  };

  // 贡献者统计
  contributorsStats: {
    totalContributors: number;
    topContributors: Array<{ login: string; contributions: number }>;
    newContributorsLast30Days: number;
  };

  // 社区文件
  communityFiles: {
    hasContributing: boolean;
    hasCodeOfConduct: boolean;
    hasSecurity: boolean;
    hasSupport: boolean;
    hasLicense: boolean;
    hasReadme: boolean;
  };
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
   * 获取 Pull Requests
   */
  async getPullRequests(
    owner: string,
    repo: string,
    options: {
      state?: "open" | "closed" | "all";
      limit?: number;
      sort?: "created" | "updated" | "popularity" | "long-running";
    } = {}
  ): Promise<GitHubPullRequest[]> {
    const { state = "all", limit = 100, sort = "created" } = options;

    const { data } = await this.octokit.rest.pulls.list({
      owner,
      repo,
      state,
      per_page: limit,
      sort,
      direction: "desc",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      author: item.user?.login || "unknown",
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
      mergedAt: item.merged_at ? new Date(item.merged_at) : null,
      closedAt: item.closed_at ? new Date(item.closed_at) : null,
      additions: item.additions || 0,
      deletions: item.deletions || 0,
      comments: item.comments || 0,
      reviewComments: item.review_comments || 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labels: item.labels.map((l: any) => (typeof l === "string" ? l : l.name)),
    }));
  }

  /**
   * 获取 Issues
   */
  async getIssues(
    owner: string,
    repo: string,
    options: {
      state?: "open" | "closed" | "all";
      limit?: number;
      sort?: "created" | "updated" | "comments";
    } = {}
  ): Promise<GitHubIssue[]> {
    const { state = "all", limit = 100, sort = "created" } = options;

    const { data } = await this.octokit.rest.issues.listForRepo({
      owner,
      repo,
      state,
      per_page: limit,
      sort,
      direction: "desc",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      author: item.user?.login || "unknown",
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
      closedAt: item.closed_at ? new Date(item.closed_at) : null,
      comments: item.comments || 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labels: item.labels.map((l: any) => (typeof l === "string" ? l : l.name)),
      body: item.body || null,
    }));
  }

  /**
   * 获取贡献者列表
   */
  async getContributors(
    owner: string,
    repo: string,
    limit: number = 100
  ): Promise<GitHubContributor[]> {
    const { data } = await this.octokit.rest.repos.listContributors({
      owner,
      repo,
      per_page: limit,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) => ({
      login: item.login,
      contributions: item.contributions,
      type: item.type,
    }));
  }

  /**
   * 获取分支列表
   */
  async getBranches(
    owner: string,
    repo: string,
    limit: number = 100
  ): Promise<GitHubBranch[]> {
    const { data } = await this.octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: limit,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) => ({
      name: item.name,
      commit: {
        sha: item.commit.sha,
        url: item.commit.url,
      },
      protected: item.protected || false,
    }));
  }

  /**
   * 获取标签列表
   */
  async getTags(
    owner: string,
    repo: string,
    limit: number = 100
  ): Promise<GitHubTag[]> {
    const { data } = await this.octokit.rest.repos.listTags({
      owner,
      repo,
      per_page: limit,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) => ({
      name: item.name,
      commit: {
        sha: item.commit.sha,
        url: item.commit.url,
      },
      zipballUrl: item.zipball_url,
      tarballUrl: item.tarball_url,
      node_id: item.node_id,
    }));
  }

  /**
   * 获取指定时间范围内的提交统计
   */
  async getCommitStats(
    owner: string,
    repo: string,
    days: number = 90
  ): Promise<{
    last7Days: number;
    last30Days: number;
    last90Days: number;
    lastCommitDate: Date;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { data: commits } = await this.octokit.rest.repos.listCommits({
      owner,
      repo,
      since: since.toISOString(),
      per_page: 100,
    });

    const now = Date.now();
    const last7Days = commits.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => now - new Date(c.commit.author?.date || 0).getTime() <= 7 * 24 * 60 * 60 * 1000
    ).length;
    const last30Days = commits.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => now - new Date(c.commit.author?.date || 0).getTime() <= 30 * 24 * 60 * 60 * 1000
    ).length;

    return {
      last7Days,
      last30Days,
      last90Days: commits.length,
      lastCommitDate: commits.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new Date(commits[0].commit.author?.date || 0)
        : new Date(0),
    };
  }

  /**
   * 检查社区文件是否存在
   */
  async checkCommunityFiles(
    owner: string,
    repo: string
  ): Promise<{
    hasContributing: boolean;
    hasCodeOfConduct: boolean;
    hasSecurity: boolean;
    hasSupport: boolean;
    hasLicense: boolean;
    hasReadme: boolean;
  }> {
    const results = {
      hasContributing: false,
      hasCodeOfConduct: false,
      hasSecurity: false,
      hasSupport: false,
      hasLicense: false,
      hasReadme: false,
    };

    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: "",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const files = Array.isArray(data) ? data : [];

      for (const file of files) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const name = (file as any).name?.toUpperCase() || "";
        if (name.includes("CONTRIBUTING")) results.hasContributing = true;
        if (name.includes("CODE_OF_CONDUCT")) results.hasCodeOfConduct = true;
        if (name.includes("SECURITY")) results.hasSecurity = true;
        if (name.includes("SUPPORT")) results.hasSupport = true;
        if (name.includes("LICENSE")) results.hasLicense = true;
        if (name.includes("README")) results.hasReadme = true;
      }
    } catch (error) {
      // 忽略错误，使用默认值
    }

    return results;
  }

  /**
   * 获取仓库详细统计数据（完整分析）
   */
  async getRepositoryStats(owner: string, repo: string): Promise<GitHubRepoStats> {
    // 并行获取所有数据
    const [
      repository,
      branches,
      tags,
      contributors,
      openIssues,
      closedIssues,
      allPRs,
      commitStats,
      communityFiles,
    ] = await Promise.all([
      this.getRepository(owner, repo),
      this.getBranches(owner, repo),
      this.getTags(owner, repo),
      this.getContributors(owner, repo),
      this.getIssues(owner, repo, { state: "open", limit: 100 }),
      this.getIssues(owner, repo, { state: "closed", limit: 100 }),
      this.getPullRequests(owner, repo, { state: "all", limit: 100 }),
      this.getCommitStats(owner, repo),
      this.checkCommunityFiles(owner, repo),
    ]);

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // 计算 Issues 统计
    const issuesStats = {
      openIssues: openIssues.length,
      closedIssues: closedIssues.length,
      totalIssues: openIssues.length + closedIssues.length,
      avgResolutionTime: 0,
      openIssuesLast7Days: openIssues.filter((i) => i.createdAt.getTime() > sevenDaysAgo).length,
      closedIssuesLast7Days: closedIssues.filter((i) => i.closedAt && i.closedAt.getTime() > sevenDaysAgo).length,
      issuesWithNoAssignee: 0, // 需要额外的 API 调用
      issuesStaleOver30Days: openIssues.filter(
        (i) => now - i.updatedAt.getTime() > 30 * 24 * 60 * 60 * 1000
      ).length,
    };

    // 计算平均解决时间
    const resolvedIssues = closedIssues.filter((i) => i.closedAt);
    if (resolvedIssues.length > 0) {
      const totalHours = resolvedIssues.reduce(
        (sum, i) => sum + (i.closedAt!.getTime() - i.createdAt.getTime()) / (1000 * 60 * 60),
        0
      );
      issuesStats.avgResolutionTime = totalHours / resolvedIssues.length;
    }

    // 计算 PR 统计
    const openPRs = allPRs.filter((pr) => pr.state === "open");
    const mergedPRs = allPRs.filter((pr) => pr.mergedAt);
    const closedPRs = allPRs.filter((pr) => pr.state === "closed" && !pr.mergedAt);

    const prStats = {
      openPRs: openPRs.length,
      mergedPRs: mergedPRs.length,
      closedPRs: closedPRs.length,
      totalPRs: allPRs.length,
      avgMergeTime: 0,
      openPRsLast7Days: openPRs.filter((pr) => pr.createdAt.getTime() > sevenDaysAgo).length,
      mergedPRsLast7Days: mergedPRs.filter((pr) => pr.mergedAt && pr.mergedAt.getTime() > sevenDaysAgo).length,
      prsWithNoReview: 0, // 需要额外的 API 调用
      prsStaleOver30Days: openPRs.filter(
        (pr) => now - pr.updatedAt.getTime() > 30 * 24 * 60 * 60 * 1000
      ).length,
    };

    // 计算平均合并时间
    if (mergedPRs.length > 0) {
      const totalHours = mergedPRs.reduce(
        (sum, pr) => sum + (pr.mergedAt!.getTime() - pr.createdAt.getTime()) / (1000 * 60 * 60),
        0
      );
      prStats.avgMergeTime = totalHours / mergedPRs.length;
    }

    // 计算贡献者统计
    // 简化的新贡献者检测（实际需要更复杂的逻辑）
    const contributorsStats = {
      totalContributors: contributors.length,
      topContributors: contributors.slice(0, 10).map((c) => ({
        login: c.login,
        contributions: c.contributions,
      })),
      newContributorsLast30Days: 0, // 需要额外的 API 调用来确定
    };

    return {
      repository,
      commitFrequency: {
        lastCommitDate: commitStats.lastCommitDate,
        commitsLast7Days: commitStats.last7Days,
        commitsLast30Days: commitStats.last30Days,
        commitsLast90Days: commitStats.last90Days,
        totalBranches: branches.length,
        totalTags: tags.length,
        defaultBranch: repository.name,
      },
      issuesStats,
      prStats,
      contributorsStats,
      communityFiles,
    };
  }

  /**
   * 完整采集仓库数据（旧方法，保持兼容性）
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
        ? this.getIssues(owner, repo, { limit: issuesLimit })
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
