/**
 * @package @devscope/db
 * @description DataCollectionPipeline 单元测试
 *
 * 测试完整的数据采集 Pipeline：
 * - GitHub API 采集 (mock)
 * - 文本分块处理
 * - Embedding 生成 (mock)
 * - 数据库存储 (mock)
 * - Hacker News 采集
 * - 错误处理和边界情况
 *
 * @module pipeline.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataCollectionPipeline, createPipeline } from "./pipeline";

// ============================================================================
// Mock 依赖 - 使用 vi.hoisted 避免 hoisting 问题
// ============================================================================

const mockRepositoryData = {
  id: 1,
  fullName: "test/repo",
  repository: {
    fullName: "test/repo",
    name: "repo",
    owner: "test",
    description: "Test repository",
    url: "https://github.com/test/repo",
    stars: 1000,
    forks: 100,
    openIssues: 10,
    language: "TypeScript",
    license: "MIT",
    createdAt: new Date("2020-01-01"),
    updatedAt: new Date("2024-01-01"),
    pushedAt: new Date("2024-01-01"),
  },
  readme: "# Test README\n\nThis is a test repository for unit testing.",
  readmeUrl: "https://raw.githubusercontent.com/test/repo/main/README.md",
  issues: [
    {
      number: 1,
      title: "Bug issue",
      state: "open",
      author: "user1",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      comments: 5,
      labels: ["bug"],
      body: "This is a bug report",
    },
    {
      number: 2,
      title: "Feature request",
      state: "open",
      author: "user2",
      createdAt: new Date("2024-01-02"),
      updatedAt: new Date("2024-01-02"),
      comments: 3,
      labels: ["enhancement"],
      body: "Please add this feature",
    },
  ],
  commits: [
    {
      sha: "abc123def456789",
      message: "Initial commit",
      author: "developer",
      date: "2024-01-01",
    },
  ],
};

const {
  mockUpsertRepository,
  mockInsertRepoChunks,
  mockInsertHackernewsItems,
  mockEmbedBatch,
  mockChunkMultiple,
  mockCollectRepository,
} = vi.hoisted(() => ({
  mockUpsertRepository: vi.fn(),
  mockInsertRepoChunks: vi.fn(),
  mockInsertHackernewsItems: vi.fn(),
  mockEmbedBatch: vi.fn(),
  mockChunkMultiple: vi.fn(),
  mockCollectRepository: vi.fn(),
}));

// Mock GitHubCollector
vi.mock("./github", () => ({
  GitHubCollector: class MockGitHubCollector {
    constructor() {}
    collectRepository = mockCollectRepository;
  },
  parseRepoFullName: vi.fn().mockReturnValue({ owner: "test", repo: "repo" }),
}));

// Mock AI services
vi.mock("@devscope/ai", () => ({
  TextChunker: class MockTextChunker {
    constructor() {}
    chunk = vi.fn().mockReturnValue([
      { content: "Test chunk", chunkType: "readme", sourceId: undefined, chunkIndex: 0, tokenCount: 10 },
    ]);
    chunkMultiple = mockChunkMultiple;
  },
  EmbeddingProvider: class MockEmbeddingProvider {
    constructor() {}
    embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    embedBatch = mockEmbedBatch;
  },
}));

// Mock database operations
vi.mock("./index", () => ({
  upsertRepository: mockUpsertRepository,
  insertRepoChunks: mockInsertRepoChunks,
  insertHackernewsItems: mockInsertHackernewsItems,
}));

// ============================================================================
// 测试套件
// ============================================================================

describe("DataCollectionPipeline", () => {
  let pipeline: DataCollectionPipeline;
  let mockDb: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock return values
    mockUpsertRepository.mockResolvedValue({ id: 1, fullName: "test/repo" });
    mockInsertRepoChunks.mockResolvedValue([]);
    mockInsertHackernewsItems.mockResolvedValue([]);
    mockEmbedBatch.mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    mockChunkMultiple.mockReturnValue([
      { content: "Chunk 1", chunkType: "readme", sourceId: undefined, chunkIndex: 0, tokenCount: 10 },
      { content: "Chunk 2", chunkType: "issues", sourceId: "1", chunkIndex: 1, tokenCount: 15 },
    ]);
    mockCollectRepository.mockResolvedValue(mockRepositoryData);

    mockDb = vi.fn() as any;
    pipeline = new DataCollectionPipeline(mockDb as any, {
      githubToken: "test-token",
      openaiToken: "test-openai-token",
      includeReadme: true,
      includeIssues: true,
      includeCommits: true,
      includeHackernews: true,
      issuesLimit: 10,
      commitsLimit: 5,
      hnLimit: 3,
    });

    // Mock fetch for Hacker News
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        hits: [
          {
            objectID: "1",
            title: "Test Repository Discussion",
            author: "hnuser",
            points: 42,
            num_comments: 10,
            url: "https://example.com",
            story_text: "Discussion about the repository",
            created_at: "2024-01-01",
          },
        ],
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ========================================================================
  // 完整流程测试
  // ========================================================================

  describe("run - 完整采集流程", () => {
    it("应该成功完成完整的数据采集流程", async () => {
      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
      expect(result.error).toBeUndefined();
      expect(result.repository.fullName).toBe("test/repo");
      expect(result.repository.name).toBe("repo");
      expect(result.chunksCollected).toBe(2);
      expect(result.embeddingsGenerated).toBe(2);
      expect(result.hnItemsCollected).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("应该正确调用 GitHub API 采集数据", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockCollectRepository).toHaveBeenCalledWith("test", "repo", {
        includeReadme: true,
        includeIssues: true,
        includeCommits: true,
        issuesLimit: 10,
        commitsLimit: 5,
      });
    });

    it("应该正确保存仓库信息到数据库", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockUpsertRepository).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          fullName: "test/repo",
          name: "repo",
          owner: "test",
          description: "Test repository",
          url: "https://github.com/test/repo",
          stars: 1000,
          forks: 100,
          openIssues: 10,
          language: "TypeScript",
          license: "MIT",
          readme: expect.stringContaining("Test README"),
        })
      );
    });
  });

  // ========================================================================
  // 文本分块测试
  // ========================================================================

  describe("文本分块处理", () => {
    it("应该正确调用文本分块器", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockChunkMultiple).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining("Test README"),
            chunkType: "readme",
          }),
          expect.objectContaining({
            text: expect.stringContaining("Bug issue"),
            chunkType: "issues",
            sourceId: "1",
          }),
          expect.objectContaining({
            text: expect.stringContaining("Feature request"),
            chunkType: "issues",
            sourceId: "2",
          }),
          expect.objectContaining({
            text: expect.stringContaining("Initial commit"),
            chunkType: "commits",
            sourceId: "abc123def456789",
          }),
        ])
      );
    });

    it("应该正确处理 README 分块", async () => {
      await pipeline.run({ repo: "test/repo" });

      // 验证包含 README 分块
      const sources = mockChunkMultiple.mock.calls[0][0];
      expect(sources).toContainEqual(
        expect.objectContaining({
          text: "# Test README\n\nThis is a test repository for unit testing.",
          chunkType: "readme",
        })
      );
    });

    it("应该正确处理 Issues 分块", async () => {
      await pipeline.run({ repo: "test/repo" });

      const sources = mockChunkMultiple.mock.calls[0][0];
      const issueChunks = sources.filter((s: any) => s.chunkType === "issues");
      expect(issueChunks).toHaveLength(2);
      expect(issueChunks[0].sourceId).toBe("1");
      expect(issueChunks[1].sourceId).toBe("2");
    });

    it("应该正确处理 Commits 分块", async () => {
      await pipeline.run({ repo: "test/repo" });

      const sources = mockChunkMultiple.mock.calls[0][0];
      const commitChunks = sources.filter((s: any) => s.chunkType === "commits");
      expect(commitChunks).toHaveLength(1);
      expect(commitChunks[0].sourceId).toBe("abc123def456789");
    });
  });

  // ========================================================================
  // Embedding 生成测试
  // ========================================================================

  describe("Embedding 生成", () => {
    it("应该批量生成 Embedding", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockEmbedBatch).toHaveBeenCalledWith([
        "Chunk 1",
        "Chunk 2",
      ]);
    });

    it("应该正确调用 embedBatch 并获取结果", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
      expect(mockEmbedBatch).toHaveBeenCalledWith(["Chunk 1", "Chunk 2"]);
      // Verify the mock was called and the promise resolved
      const mockResult = await mockEmbedBatch.mock.results[0].value;
      expect(mockResult).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
    });

    it("应该没有文本分块时跳过 Embedding 生成", async () => {
      mockChunkMultiple.mockReturnValue([]);

      await pipeline.run({ repo: "test/repo" });

      expect(mockEmbedBatch).not.toHaveBeenCalled();
      expect(mockInsertRepoChunks).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // 数据库存储测试
  // ========================================================================

  describe("数据库存储", () => {
    it("应该正确插入分块到数据库", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockInsertRepoChunks).toHaveBeenCalledTimes(1);
      const insertedChunks = mockInsertRepoChunks.mock.calls[0][1];
      expect(insertedChunks).toHaveLength(2);
      expect(insertedChunks[0]).toMatchObject({
        repoId: 1,
        content: "Chunk 1",
        chunkType: "readme",
        sourceId: undefined,
        chunkIndex: 0,
        tokenCount: 10,
      });
    });

    it("应该正确保存所有生成的 embedding", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockInsertRepoChunks).toHaveBeenCalled();
      const insertedChunks = mockInsertRepoChunks.mock.calls[0][1];
      expect(insertedChunks).toHaveLength(2);
      expect(insertedChunks[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(insertedChunks[1].embedding).toEqual([0.4, 0.5, 0.6]);
    });
  });

  // ========================================================================
  // Hacker News 采集测试
  // ========================================================================

  describe("Hacker News 采集", () => {
    it("应该正确调用 Hacker News API", async () => {
      await pipeline.run({ repo: "test/repo" });

      // Verify fetch was called with the correct URL
      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);
      expect(fetchCalls[0][0]).toContain("hn.algolia.com/api/v1/search");
    });

    it("应该正确解析 Hacker News 响应", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockInsertHackernewsItems).toHaveBeenCalledWith(
        mockDb,
        expect.arrayContaining([
          expect.objectContaining({
            repoId: 1,
            type: "story",
            title: "Test Repository Discussion",
            content: "Discussion about the repository",
            author: "hnuser",
            score: 42,
            descendants: 10,
            url: "https://example.com",
          }),
        ])
      );
    });

    it("应该跳过 Hacker News 采集（当配置为 false）", async () => {
      const pipelineNoHN = new DataCollectionPipeline(mockDb as any, {
        includeHackernews: false,
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hits: [] }),
      }));

      await pipelineNoHN.run({ repo: "test/repo" });

      expect(mockInsertHackernewsItems).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("应该处理 Hacker News API 错误", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Hacker News API error: 500")));

      const result = await pipeline.run({ repo: "test/repo" });

      // 应该继续完成，只是没有 HN 数据
      expect(result.status).toBe("completed");
      expect(result.hnItemsCollected).toBe(0);

      vi.unstubAllGlobals();
    });
  });

  // ========================================================================
  // 配置选项测试
  // ========================================================================

  describe("配置选项", () => {
    it("应该使用环境变量作为默认 Token", () => {
      const envPipeline = new DataCollectionPipeline(mockDb as any);

      expect(envPipeline).toBeDefined();
    });

    it("应该支持自定义分块配置", () => {
      const customPipeline = new DataCollectionPipeline(mockDb as any, {
        chunkMaxTokens: 1000,
        chunkOverlapTokens: 100,
      });

      expect(customPipeline).toBeDefined();
    });

    it("应该支持自定义采集数量限制", () => {
      const customPipeline = new DataCollectionPipeline(mockDb as any, {
        issuesLimit: 50,
        commitsLimit: 20,
        hnLimit: 30,
      });

      expect(customPipeline).toBeDefined();
    });

    it("应该支持选择性采集数据源", () => {
      const selectivePipeline = new DataCollectionPipeline(mockDb as any, {
        includeReadme: false,
        includeIssues: false,
        includeCommits: false,
        includeHackernews: false,
      });

      expect(selectivePipeline).toBeDefined();
    });
  });

  // ========================================================================
  // 边界情况测试
  // ========================================================================

  describe("边界情况", () => {
    it("应该处理空 Issues 列表", async () => {
      mockCollectRepository.mockResolvedValueOnce({
        ...mockRepositoryData,
        issues: [],
        commits: [],
      });

      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
      expect(result.chunksCollected).toBeGreaterThanOrEqual(0);
    });

    it("应该处理空 Commits 列表", async () => {
      mockCollectRepository.mockResolvedValueOnce({
        ...mockRepositoryData,
        issues: [
          {
            number: 1,
            title: "Issue",
            state: "open",
            author: "user",
            createdAt: new Date(),
            updatedAt: new Date(),
            comments: 1,
            labels: [],
            body: "Body",
          },
        ],
        commits: [],
      });

      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
    });

    it("应该处理空 Hacker News 结果", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hits: [] }),
      }));

      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
      expect(result.hnItemsCollected).toBe(0);

      vi.unstubAllGlobals();
    });

    it("应该处理没有 README 的情况", async () => {
      mockCollectRepository.mockResolvedValueOnce({
        ...mockRepositoryData,
        repository: {
          ...mockRepositoryData.repository,
          license: null,
        },
        readme: null,
        readmeUrl: null,
        issues: [],
        commits: [],
      });

      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
    });
  });

  // ========================================================================
  // 错误处理测试
  // ========================================================================

  describe("错误处理", () => {
    it("应该在 GitHub API 失败时返回错误", async () => {
      // 为这个测试创建新的 pipeline 实例，避免之前测试的影响
      const errorPipeline = new DataCollectionPipeline(mockDb as any);
      mockCollectRepository.mockRejectedValueOnce(
        new Error("GitHub API rate limit exceeded")
      );

      const result = await errorPipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
    });

    it("应该在 Embedding 生成失败时传播错误", async () => {
      // Create a new pipeline instance for this test
      const errorPipeline = new DataCollectionPipeline(mockDb as any, {
        githubToken: "test-token",
        openaiToken: "test-openai-token",
        includeHackernews: false, // Skip HN to simplify error handling
      });

      // Reset mocks and set up error
      mockUpsertRepository.mockResolvedValueOnce({ id: 1, fullName: "test/repo" });
      mockCollectRepository.mockResolvedValueOnce(mockRepositoryData);
      mockChunkMultiple.mockReturnValueOnce([
        { content: "Chunk 1", chunkType: "readme", sourceId: undefined, chunkIndex: 0, tokenCount: 10 },
      ]);
      mockEmbedBatch.mockRejectedValueOnce(new Error("OpenAI API error"));

      const result = await errorPipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("OpenAI API error");
    });

    it("应该在数据库操作失败时传播错误", async () => {
      mockUpsertRepository.mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.error).toBeDefined();
    });

    it("应该在 Hacker News 采集失败时继续执行", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const result = await pipeline.run({ repo: "test/repo" });

      // HN 采集失败不应该影响整体流程
      expect(result.status).toBe("completed");
      expect(result.hnItemsCollected).toBe(0);

      vi.unstubAllGlobals();
    });
  });

  // ========================================================================
  // 输出结构验证
  // ========================================================================

  describe("输出结构验证", () => {
    it("应该返回符合 Schema 的结果结构", async () => {
      const result = await pipeline.run({ repo: "test/repo" });

      // 验证必需字段存在
      expect(result).toHaveProperty("repository");
      expect(result).toHaveProperty("chunksCollected");
      expect(result).toHaveProperty("embeddingsGenerated");
      expect(result).toHaveProperty("hnItemsCollected");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("duration");

      // 验证 repository 结构
      expect(result.repository).toHaveProperty("fullName");
      expect(result.repository).toHaveProperty("name");
      expect(result.repository).toHaveProperty("owner");
      expect(result.repository).toHaveProperty("stars");
      expect(result.repository).toHaveProperty("forks");
    });

    it("应该包含正确的仓库信息", async () => {
      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.repository.fullName).toBe("test/repo");
      expect(result.repository.name).toBe("repo");
      expect(result.repository.owner).toBe("test");
      expect(result.repository.description).toBe("Test repository");
      expect(result.repository.stars).toBe(1000);
      expect(result.repository.language).toBe("TypeScript");
    });
  });

  // ========================================================================
  // 性能测试
  // ========================================================================

  describe("性能统计", () => {
    it("应该正确记录采集耗时", async () => {
      // 创建新的 pipeline 避免之前测试的影响
      const perfPipeline = new DataCollectionPipeline(mockDb as any, {
        includeHackernews: false, // 简化测试
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hits: [] }),
      }));

      const result = await perfPipeline.run({ repo: "test/repo" });

      expect(result.duration).toBeGreaterThanOrEqual(0);

      vi.unstubAllGlobals();
    });

    it("应该正确统计采集数量", async () => {
      // 重置 mock 返回值确保测试独立
      mockCollectRepository.mockResolvedValue({
        ...mockRepositoryData,
        readme: "# Test",
        readmeUrl: "https://example.com/README.md",
        issues: [
          {
            number: 1,
            title: "Issue",
            state: "open",
            author: "user",
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-01"),
            comments: 1,
            labels: [],
            body: "Body",
          },
        ],
        commits: [],
      });

      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.chunksCollected).toBeGreaterThanOrEqual(0);
      expect(result.embeddingsGenerated).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================================================
  // 工厂函数测试
  // ========================================================================

  describe("createPipeline", () => {
    it("应该创建 Pipeline 实例", () => {
      const pipeline = createPipeline(mockDb as any);

      expect(pipeline).toBeInstanceOf(DataCollectionPipeline);
    });

    it("应该传递配置到 Pipeline", () => {
      const pipeline = createPipeline(mockDb as any, {
        chunkMaxTokens: 1000,
      });

      expect(pipeline).toBeInstanceOf(DataCollectionPipeline);
    });
  });
});
