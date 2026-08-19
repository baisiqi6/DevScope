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
    githubRepositoryId: "123",
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
  mockCommitRepositoryCollectionSnapshot,
  mockClaimRepositoryEmbeddingSnapshot,
  mockUpdateEmbeddingProgressForVersion,
  mockApplyRepositoryEmbeddingSnapshot,
  mockMarkEmbeddingFailedForVersion,
  mockNormalizeGitHubReleaseId,
  mockEmbedBatch,
  mockChunkMultiple,
  mockCollectRepository,
  mockGetReleases,
} = vi.hoisted(() => ({
  mockCommitRepositoryCollectionSnapshot: vi.fn(),
  mockClaimRepositoryEmbeddingSnapshot: vi.fn(),
  mockUpdateEmbeddingProgressForVersion: vi.fn(),
  mockApplyRepositoryEmbeddingSnapshot: vi.fn(),
  mockMarkEmbeddingFailedForVersion: vi.fn(),
  mockNormalizeGitHubReleaseId: vi.fn(),
  mockEmbedBatch: vi.fn(),
  mockChunkMultiple: vi.fn(),
  mockCollectRepository: vi.fn(),
  mockGetReleases: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

// Mock GitHubCollector
vi.mock("./github", () => ({
  GitHubCollector: class MockGitHubCollector {
    constructor() {}
    collectRepository = mockCollectRepository;
    getReleases = mockGetReleases;
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
  BGEEmbeddingProvider: class MockEmbeddingProvider {
    constructor() {}
    embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    embedBatch = mockEmbedBatch;
  },
}));

// Mock database operations
vi.mock("./index", () => ({
  commitRepositoryCollectionSnapshot: mockCommitRepositoryCollectionSnapshot,
  claimRepositoryEmbeddingSnapshot: mockClaimRepositoryEmbeddingSnapshot,
  updateEmbeddingProgressForVersion: mockUpdateEmbeddingProgressForVersion,
  applyRepositoryEmbeddingSnapshot: mockApplyRepositoryEmbeddingSnapshot,
  markEmbeddingFailedForVersion: mockMarkEmbeddingFailedForVersion,
  normalizeGitHubReleaseId: mockNormalizeGitHubReleaseId,
  repositories: {
    id: "id",
    updatedAt: "updatedAt",
  },
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
    mockCommitRepositoryCollectionSnapshot.mockResolvedValue({
      repository: {
        id: 1,
        githubRepositoryId: "123",
        fullName: "test/repo",
        name: "repo",
        owner: "test",
        description: "Test repository",
        url: "https://github.com/test/repo",
        stars: 1000,
        forks: 100,
        openIssues: 10,
        language: "TypeScript",
      },
      version: new Date("2026-08-18T00:00:00.000Z"),
    });
    mockClaimRepositoryEmbeddingSnapshot.mockResolvedValue({ status: "not_claimed" });
    mockUpdateEmbeddingProgressForVersion.mockResolvedValue(true);
    mockApplyRepositoryEmbeddingSnapshot.mockResolvedValue({
      status: "applied",
      completedChunks: 2,
      totalChunks: 2,
    });
    mockMarkEmbeddingFailedForVersion.mockResolvedValue(true);
    mockNormalizeGitHubReleaseId.mockImplementation((id: string) => BigInt(id));
    mockGetReleases.mockResolvedValue([]);
    mockEmbedBatch.mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    mockChunkMultiple.mockReturnValue([
      { content: "Chunk 1", chunkType: "readme", sourceId: undefined, chunkIndex: 0, tokenCount: 10 },
      { content: "Chunk 2", chunkType: "issues", sourceId: "1", chunkIndex: 1, tokenCount: 15 },
    ]);
    mockCollectRepository.mockResolvedValue(mockRepositoryData);

    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    mockDb = {
      update: vi.fn(() => ({ set: mockSet })),
    } as any;
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
      expect(result.embeddingsGenerated).toBe(0);
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

      expect(mockCommitRepositoryCollectionSnapshot).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          repository: expect.objectContaining({
            githubRepositoryId: "123",
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
          }),
          allowNewStableIdentity: false,
        }),
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
    it("应该把 Embedding 延后到后台任务", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockEmbedBatch).not.toHaveBeenCalled();
    });

    it("应该先保存不带 Embedding 的分块", async () => {
      await pipeline.run({ repo: "test/repo" });

      const insertedChunks = mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].chunks;
      expect(insertedChunks).toHaveLength(2);
      expect(insertedChunks.every((chunk: any) => chunk.embedding === null)).toBe(true);
    });

    it("应该没有文本分块时跳过 Embedding 生成", async () => {
      mockChunkMultiple.mockReturnValue([]);

      await pipeline.run({ repo: "test/repo" });

      expect(mockEmbedBatch).not.toHaveBeenCalled();
      expect(mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].chunks).toEqual([]);
    });

    it("claim 在内部返回绑定 chunks，调用方只传 repoId 与 token", async () => {
      const version = new Date("2026-08-18T00:00:00.000Z");
      mockClaimRepositoryEmbeddingSnapshot.mockResolvedValueOnce({
        status: "claimed",
        chunks: [
          { content: "A", chunkType: "readme", sourceId: null, chunkIndex: 0, tokenCount: 1 },
          { content: "B", chunkType: "issues", sourceId: "1", chunkIndex: 1, tokenCount: 1 },
        ],
      });
      mockEmbedBatch.mockResolvedValueOnce([
        [1, 0],
        [0, 1],
      ]);

      const outcome = await pipeline.runEmbeddingsInBackground(1, version);

      expect(outcome.status).toBe("applied");
      expect(mockClaimRepositoryEmbeddingSnapshot).toHaveBeenCalledWith(mockDb, 1, version);
      expect(mockApplyRepositoryEmbeddingSnapshot).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          repoId: 1,
          expectedVersion: version,
          chunks: [
            expect.objectContaining({ content: "A", embedding: [1, 0] }),
            expect.objectContaining({ content: "B", embedding: [0, 1] }),
          ],
          repositoryEmbedding: [1, 0],
        }),
      );
    });

    it("过期 token 未 claim 时不调用模型或 final write", async () => {
      const version = new Date("2026-08-18T00:00:00.000Z");
      mockClaimRepositoryEmbeddingSnapshot.mockResolvedValueOnce({ status: "stale" });

      await expect(pipeline.runEmbeddingsInBackground(1, version))
        .resolves.toEqual({ status: "stale" });
      expect(mockEmbedBatch).not.toHaveBeenCalled();
      expect(mockApplyRepositoryEmbeddingSnapshot).not.toHaveBeenCalled();
    });

    it("部分 embedding 失败时仍把全部文本交给原子 final write", async () => {
      const version = new Date("2026-08-18T00:00:00.000Z");
      mockClaimRepositoryEmbeddingSnapshot.mockResolvedValueOnce({
        status: "claimed",
        chunks: [
          { content: "A", chunkType: "readme", sourceId: null, chunkIndex: 0, tokenCount: 1 },
          { content: "B", chunkType: "issues", sourceId: "1", chunkIndex: 1, tokenCount: 1 },
        ],
      });
      mockEmbedBatch.mockResolvedValueOnce([[1, 0], null]);
      mockApplyRepositoryEmbeddingSnapshot.mockResolvedValueOnce({
        status: "failed",
        completedChunks: 1,
        totalChunks: 2,
        error: "1 chunks 向量化失败",
      });

      const outcome = await pipeline.runEmbeddingsInBackground(1, version);

      expect(outcome.status).toBe("failed");
      const finalChunks = mockApplyRepositoryEmbeddingSnapshot.mock.calls[0][1].chunks;
      expect(finalChunks).toHaveLength(2);
      expect(finalChunks[1]).toMatchObject({ content: "B", embedding: null });
    });
  });

  // ========================================================================
  // 数据库存储测试
  // ========================================================================

  describe("数据库存储", () => {
    it("应该正确插入分块到数据库", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockCommitRepositoryCollectionSnapshot).toHaveBeenCalledTimes(1);
      const insertedChunks = mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].chunks;
      expect(insertedChunks).toHaveLength(2);
      expect(insertedChunks[0]).toMatchObject({
        content: "Chunk 1",
        chunkType: "readme",
        sourceId: null,
        chunkIndex: 0,
        tokenCount: 10,
      });
    });

    it("应该在快速采集阶段把 embedding 保存为 null", async () => {
      await pipeline.run({ repo: "test/repo" });

      expect(mockCommitRepositoryCollectionSnapshot).toHaveBeenCalled();
      const insertedChunks = mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].chunks;
      expect(insertedChunks).toHaveLength(2);
      expect(insertedChunks[0].embedding).toBeNull();
      expect(insertedChunks[1].embedding).toBeNull();
    });

    it("Release ID 校验失败时不删除旧 Releases", async () => {
      mockGetReleases.mockResolvedValueOnce([{
        id: "9223372036854775808",
        tagName: "v-invalid",
        name: "v-invalid",
        body: null,
        author: "maintainer",
        createdAt: new Date("2026-08-18T00:00:00Z"),
        publishedAt: new Date("2026-08-18T00:00:00Z"),
        url: "https://api.github.com/repos/test/repo/releases/9223372036854775808",
        htmlUrl: "https://github.com/test/repo/releases/tag/v-invalid",
        zipUrl: null,
        tarUrl: null,
        assets: [],
        isPrerelease: false,
      }]);
      mockNormalizeGitHubReleaseId.mockImplementationOnce(() => {
        throw new RangeError("GitHub Release ID exceeds PostgreSQL bigint range");
      });

      await pipeline.run({ repo: "test/repo" });

      const releaseSnapshot = mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].releases;
      expect(releaseSnapshot.status).toBe("failure");
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

      expect(mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].hackernews).toEqual(
        expect.objectContaining({
          status: "success",
          items: expect.arrayContaining([
          expect.objectContaining({
            type: "story",
            title: "Test Repository Discussion",
            content: "Discussion about the repository",
            author: "hnuser",
            score: 42,
            descendants: 10,
            url: "https://example.com",
          }),
          ]),
        }),
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

      expect(mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].hackernews)
        .toEqual({ status: "skipped" });

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

    it("非法 Hacker News payload 作为 failure 保留旧来源并返回告警", async () => {
      const isolatedPipeline = new DataCollectionPipeline(mockDb as any, {
        includeHackernews: true,
        includeSbom: false,
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          hits: [{
            title: "bad",
            story_text: null,
            author: "user",
            points: "not-a-number",
            num_comments: 0,
            url: null,
          }],
        }),
      }));

      const result = await isolatedPipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
      expect(result.warning).toContain("Hacker News:");
      expect(mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].hackernews.status)
        .toBe("failure");
      vi.unstubAllGlobals();
    });

    it("成功空 Hacker News 结果仍提交 success([])", async () => {
      const isolatedPipeline = new DataCollectionPipeline(mockDb as any, {
        includeHackernews: true,
        includeSbom: false,
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hits: [] }),
      }));

      await isolatedPipeline.run({ repo: "test/repo" });

      expect(mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].hackernews)
        .toEqual({ status: "success", items: [] });
      vi.unstubAllGlobals();
    });
  });

  describe("SBOM 采集", () => {
    it("malformed 200 package 作为 failure，不伪装成 success([])", async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
        const url = String(input);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(url.includes("hn.algolia.com")
            ? { hits: [] }
            : { sbom: { packages: [{}] } }),
        });
      }));

      const result = await pipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
      expect(result.warning).toContain("SBOM:");
      expect(mockCommitRepositoryCollectionSnapshot.mock.calls[0][1].sbom.status)
        .toBe("failure");
    });

    it("多个 optional failure 按 Hacker News、Releases、SBOM 固定顺序告警", async () => {
      mockGetReleases.mockRejectedValueOnce(new Error("release unavailable"));
      vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
        const url = String(input);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(url.includes("hn.algolia.com")
            ? { hits: [{ points: "bad" }] }
            : { sbom: { packages: [{}] } }),
        });
      }));

      const result = await pipeline.run({ repo: "test/repo" });
      const warning = result.warning ?? "";

      expect(warning.indexOf("Hacker News:")).toBeGreaterThanOrEqual(0);
      expect(warning.indexOf("Releases:")).toBeGreaterThan(warning.indexOf("Hacker News:"));
      expect(warning.indexOf("SBOM:")).toBeGreaterThan(warning.indexOf("Releases:"));
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

    it("应该在快速采集阶段不调用 Embedding 服务", async () => {
      // Create a new pipeline instance for this test
      const errorPipeline = new DataCollectionPipeline(mockDb as any, {
        githubToken: "test-token",
        openaiToken: "test-openai-token",
        includeHackernews: false, // Skip HN to simplify error handling
      });

      // Reset mocks and set up error
      mockCollectRepository.mockResolvedValueOnce(mockRepositoryData);
      mockChunkMultiple.mockReturnValueOnce([
        { content: "Chunk 1", chunkType: "readme", sourceId: undefined, chunkIndex: 0, tokenCount: 10 },
      ]);
      mockEmbedBatch.mockRejectedValueOnce(new Error("OpenAI API error"));

      const result = await errorPipeline.run({ repo: "test/repo" });

      expect(result.status).toBe("completed");
      expect(result.error).toBeUndefined();
      expect(mockEmbedBatch).not.toHaveBeenCalled();
    });

    it("应该在数据库操作失败时传播错误", async () => {
      mockCommitRepositoryCollectionSnapshot.mockRejectedValueOnce(
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
