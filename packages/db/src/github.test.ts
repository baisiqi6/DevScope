/**
 * @package @devscope/db
 * @description GitHubCollector 单元测试 (TDD)
 *
 * 测试 Octokit 采集功能：
 * - 获取仓库基础信息
 * - 获取 README 内容
 * - 获取 Issues
 * - 获取 Commits
 *
 * @module github.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubCollector } from "./github";

// ============================================================================
// Mock Octokit
// ============================================================================

/**
 * Mock Octokit rest API
 */
const mockRest = {
  repos: {
    get: vi.fn(),
    getReadme: vi.fn(),
    listCommits: vi.fn(),
  },
  issues: {
    listForRepo: vi.fn(),
  },
};

/**
 * Mock Octokit 类
 */
vi.mock("octokit", () => ({
  Octokit: class MockOctokit {
    rest = mockRest;
  },
}));

// ============================================================================
// 测试套件
// ============================================================================

describe("GitHubCollector", () => {
  let collector: GitHubCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = new GitHubCollector("test-token");
  });

  // ========================================================================
  // getRepository 测试
  // ========================================================================

  describe("getRepository", () => {
    it("应该成功获取仓库基础信息", async () => {
      // Arrange - Mock API 响应
      const mockRepoData = {
        full_name: "owner/repo",
        name: "repo",
        owner: { login: "owner" },
        description: "A test repository",
        html_url: "https://github.com/owner/repo",
        stargazers_count: 1000,
        forks_count: 100,
        open_issues_count: 10,
        language: "TypeScript",
        license: { spdx_id: "MIT" },
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        pushed_at: "2024-01-02T00:00:00Z",
      };

      mockRest.repos.get.mockResolvedValue({ data: mockRepoData });

      // Act
      const result = await collector.getRepository("owner", "repo");

      // Assert
      expect(result.fullName).toBe("owner/repo");
      expect(result.name).toBe("repo");
      expect(result.owner).toBe("owner");
      expect(result.description).toBe("A test repository");
      expect(result.url).toBe("https://github.com/owner/repo");
      expect(result.stars).toBe(1000);
      expect(result.forks).toBe(100);
      expect(result.openIssues).toBe(10);
      expect(result.language).toBe("TypeScript");
      expect(result.license).toBe("MIT");
    });

    it("应该在仓库不存在时抛出错误", async () => {
      mockRest.repos.get.mockRejectedValue({ status: 404 });

      await expect(collector.getRepository("owner", "nonexistent")).rejects.toThrow();
    });
  });

  // ========================================================================
  // getReadme 测试
  // ========================================================================

  describe("getReadme", () => {
    it("应该成功获取 README 内容", async () => {
      const mockReadmeContent = "# Hello World";
      mockRest.repos.getReadme.mockResolvedValue({ data: mockReadmeContent as unknown as string });

      const result = await collector.getReadme("owner", "repo");

      expect(result).not.toBeNull();
      expect(result?.content).toBe("# Hello World");
      expect(result?.url).toBe("https://raw.githubusercontent.com/owner/repo/HEAD/README.md");
    });

    it("应该在 README 不存在时返回 null", async () => {
      mockRest.repos.getReadme.mockRejectedValue({ status: 404 });

      const result = await collector.getReadme("owner", "repo");

      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // getIssues 测试
  // ========================================================================

  describe("getIssues", () => {
    it("应该成功获取 Issues 列表", async () => {
      const mockIssues = [
        {
          number: 1,
          title: "Bug: Fix error",
          state: "open",
          user: { login: "user1" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          comments: 5,
          labels: [{ name: "bug" }, { name: "priority" }],
          body: "This is a bug",
          pull_request: undefined,
        },
        {
          number: 2,
          title: "Feature: Add new feature",
          state: "open",
          user: { login: "user2" },
          created_at: "2024-01-03T00:00:00Z",
          updated_at: "2024-01-04T00:00:00Z",
          comments: 2,
          labels: ["enhancement"],
          body: null,
          pull_request: undefined,
        },
      ];

      mockRest.issues.listForRepo.mockResolvedValue({ data: mockIssues as never });

      const result = await collector.getIssues("owner", "repo", 10);

      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(1);
      expect(result[0].title).toBe("Bug: Fix error");
      expect(result[0].labels).toEqual(["bug", "priority"]);
      expect(result[1].labels).toEqual(["enhancement"]);
    });

    it("应该过滤掉 Pull Requests", async () => {
      const mockData = [
        { number: 1, title: "Issue 1", state: "open", user: { login: "u" }, created_at: "2024-01-01", updated_at: "2024-01-01", comments: 0, labels: [], body: "" },
        { number: 2, title: "PR #2", state: "open", user: { login: "u" }, created_at: "2024-01-01", updated_at: "2024-01-01", comments: 0, labels: [], body: "", pull_request: { url: "..." } },
      ];

      mockRest.issues.listForRepo.mockResolvedValue({ data: mockData as never });

      const result = await collector.getIssues("owner", "repo");

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
    });
  });

  // ========================================================================
  // getCommits 测试
  // ========================================================================

  describe("getCommits", () => {
    it("应该成功获取 Commits 列表", async () => {
      const mockCommits = [
        {
          sha: "abc123",
          commit: { message: "First commit", author: { name: "Developer", date: "2024-01-01T00:00:00Z" } },
        },
        {
          sha: "def456",
          commit: { message: "Second commit", author: { name: "Developer", date: "2024-01-02T00:00:00Z" } },
        },
      ];

      mockRest.repos.listCommits.mockResolvedValue({ data: mockCommits as never });

      const result = await collector.getCommits("owner", "repo", 10);

      expect(result).toHaveLength(2);
      expect(result[0].sha).toBe("abc123");
      expect(result[0].message).toBe("First commit");
      expect(result[0].author).toBe("Developer");
    });
  });

  // ========================================================================
  // collectRepository 测试
  // ========================================================================

  describe("collectRepository", () => {
    it("应该完整采集仓库数据", async () => {
      // Mock 各 API 响应
      mockRest.repos.get.mockResolvedValue({
        data: {
          full_name: "owner/repo",
          name: "repo",
          owner: { login: "owner" },
          description: "Test",
          html_url: "https://github.com/owner/repo",
          stargazers_count: 100,
          forks_count: 10,
          open_issues_count: 5,
          language: "TypeScript",
          license: { spdx_id: "MIT" },
          created_at: "2020-01-01",
          updated_at: "2024-01-01",
          pushed_at: "2024-01-01",
        },
      });

      mockRest.repos.getReadme.mockResolvedValue({ data: "# README" as unknown as string });
      mockRest.issues.listForRepo.mockResolvedValue({ data: [] });
      mockRest.repos.listCommits.mockResolvedValue({ data: [] });

      const result = await collector.collectRepository("owner", "repo", {
        includeReadme: true,
        includeIssues: true,
        includeCommits: true,
      });

      expect(result.repository.fullName).toBe("owner/repo");
      expect(result.readme).toBe("# README");
      expect(result.issues).toEqual([]);
      expect(result.commits).toEqual([]);
    });

    it("应该根据选项跳过部分数据采集", async () => {
      mockRest.repos.get.mockResolvedValue({
        data: {
          full_name: "owner/repo", name: "repo", owner: { login: "owner" },
          description: "Test", html_url: "https://github.com/owner/repo",
          stargazers_count: 100, forks_count: 10, open_issues_count: 5,
          language: "TypeScript", license: { spdx_id: "MIT" },
          created_at: "2020-01-01", updated_at: "2024-01-01", pushed_at: "2024-01-01",
        },
      });

      mockRest.repos.getReadme.mockResolvedValue({ data: "# README" as unknown as string });
      mockRest.issues.listForRepo.mockResolvedValue({ data: [] });
      mockRest.repos.listCommits.mockResolvedValue({ data: [] });

      const result = await collector.collectRepository("owner", "repo", {
        includeReadme: false,
        includeIssues: false,
        includeCommits: false,
      });

      expect(result.readme).toBeNull();
      expect(mockRest.issues.listForRepo).not.toHaveBeenCalled();
      expect(mockRest.repos.listCommits).not.toHaveBeenCalled();
    });
  });
});
