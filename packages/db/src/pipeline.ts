/**
 * @package @devscope/db
 * @description 数据采集 Pipeline
 *
 * 整合 GitHub 数据采集、文本分块、Embedding 生成和存储的完整流程。
 *
 * @module pipeline
 */

import { upsertRepository, insertRepoChunks, insertHackernewsItems } from "./index";
import { GitHubCollector, parseRepoFullName } from "./github";
import { TextChunker, EmbeddingProvider } from "@devscope/ai";
import type { Db } from "./index";
import type { CollectionResult, CollectionStatus } from "@devscope/shared";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Pipeline 配置
 */
export interface PipelineConfig {
  /** GitHub Token（可选） */
  githubToken?: string;
  /** OpenAI Token（用于 embedding） */
  openaiToken?: string;
  /** 数据库连接字符串 */
  dbUrl?: string;
  /** 分块最大 token 数 */
  chunkMaxTokens?: number;
  /** 分块重叠 token 数 */
  chunkOverlapTokens?: number;
  /** 是否采集 README */
  includeReadme?: boolean;
  /** 是否采集 Issues */
  includeIssues?: boolean;
  /** 是否采集 Commits */
  includeCommits?: boolean;
  /** Issues 采集数量 */
  issuesLimit?: number;
  /** Commits 采集数量 */
  commitsLimit?: number;
  /** 是否采集 Hacker News */
  includeHackernews?: boolean;
  /** Hacker News 采集数量 */
  hnLimit?: number;
}

/**
 * Pipeline 输入
 */
export interface PipelineInput {
  /** 仓库标识符 (owner/repo) */
  repo: string;
  /** 可选的额外配置 */
  config?: Partial<PipelineConfig>;
}

// ============================================================================
// 采集 Pipeline
// ============================================================================

/**
 * 数据采集 Pipeline
 * 完整流程：GitHub 采集 -> 文本分块 -> Embedding 生成 -> 存储
 */
export class DataCollectionPipeline {
  private db: Db;
  private github: GitHubCollector;
  private chunker: TextChunker;
  private embedder: EmbeddingProvider;
  private config: Required<PipelineConfig>;

  constructor(db: Db, config: PipelineConfig = {}) {
    this.db = db;

    // 设置默认值
    this.config = {
      githubToken: config.githubToken || process.env.GITHUB_TOKEN || "",
      openaiToken: config.openaiToken || process.env.OPENAI_API_KEY || "",
      dbUrl: config.dbUrl || process.env.DATABASE_URL || "",
      chunkMaxTokens: config.chunkMaxTokens || 500,
      chunkOverlapTokens: config.chunkOverlapTokens || 50,
      includeReadme: config.includeReadme ?? true,
      includeIssues: config.includeIssues ?? true,
      includeCommits: config.includeCommits ?? false,
      issuesLimit: config.issuesLimit || 20,
      commitsLimit: config.commitsLimit || 10,
      includeHackernews: config.includeHackernews ?? true,
      hnLimit: config.hnLimit || 20,
    };

    // 初始化组件
    this.github = new GitHubCollector(this.config.githubToken);
    this.chunker = new TextChunker({
      maxTokens: this.config.chunkMaxTokens,
      overlapTokens: this.config.chunkOverlapTokens,
    });
    this.embedder = new EmbeddingProvider({ apiKey: this.config.openaiToken });
  }

  /**
   * 执行完整的数据采集流程
   */
  async run(input: PipelineInput): Promise<CollectionResult> {
    const startTime = Date.now();
    const { owner, repo } = parseRepoFullName(input.repo);

    let status: CollectionStatus = "processing";
    let error: string | undefined;
    let repository: CollectionResult["repository"];
    let chunksCollected = 0;
    let embeddingsGenerated = 0;
    let hnItemsCollected = 0;

    try {
      // 1. 采集 GitHub 数据
      const githubData = await this.github.collectRepository(owner, repo, {
        includeReadme: this.config.includeReadme,
        includeIssues: this.config.includeIssues,
        includeCommits: this.config.includeCommits,
        issuesLimit: this.config.issuesLimit,
        commitsLimit: this.config.commitsLimit,
      });

      // 2. 保存仓库信息到数据库
      const savedRepo = await upsertRepository(this.db, {
        fullName: githubData.repository.fullName,
        name: githubData.repository.name,
        owner: githubData.repository.owner,
        description: githubData.repository.description,
        url: githubData.repository.url,
        stars: githubData.repository.stars,
        forks: githubData.repository.forks,
        openIssues: githubData.repository.openIssues,
        language: githubData.repository.language,
        license: githubData.repository.license,
        readme: githubData.readme,
        readmeUrl: githubData.readmeUrl,
        lastFetchedAt: new Date(),
      });

      repository = {
        fullName: githubData.repository.fullName,
        name: githubData.repository.name,
        owner: githubData.repository.owner,
        description: githubData.repository.description || undefined,
        stars: githubData.repository.stars,
        forks: githubData.repository.forks,
        language: githubData.repository.language || undefined,
      };

      // 3. 准备文本分块
      const textSources: Array<{ text: string; sourceId?: string; chunkType: string }> = [];

      // 添加 README 分块
      if (githubData.readme) {
        textSources.push({
          text: githubData.readme,
          chunkType: "readme",
        });
      }

      // 添加 Issues 分块
      if (githubData.issues.length > 0) {
        for (const issue of githubData.issues) {
          const issueText = `Issue #${issue.number}: ${issue.title}\n\n${issue.body || ""}`;
          textSources.push({
            text: issueText,
            sourceId: String(issue.number),
            chunkType: "issues",
          });
        }
      }

      // 添加 Commits 分块
      if (githubData.commits.length > 0) {
        for (const commit of githubData.commits) {
          const commitText = `Commit ${commit.sha.slice(0, 7)}: ${commit.message}`;
          textSources.push({
            text: commitText,
            sourceId: commit.sha,
            chunkType: "commits",
          });
        }
      }

      // 4. 执行文本分块
      const chunks = this.chunker.chunkMultiple(textSources);
      chunksCollected = chunks.length;

      // 5. 生成 Embedding 并存储
      if (chunks.length > 0) {
        // 批量生成 embedding
        const texts = chunks.map((c) => c.content);
        const embeddings = await this.embedder.embedBatch(texts);

        // 准备数据库插入数据
        const dbChunks = chunks.map((chunk, index) => ({
          repoId: savedRepo.id,
          content: chunk.content,
          chunkType: chunk.chunkType,
          sourceId: chunk.sourceId,
          chunkIndex: chunk.chunkIndex,
          embedding: embeddings[index],
          tokenCount: chunk.tokenCount,
        }));

        await insertRepoChunks(this.db, dbChunks);
        embeddingsGenerated = dbChunks.length;
      }

      // 6. 采集 Hacker News 数据
      if (this.config.includeHackernews) {
        const hnItems = await this.fetchHackerNews(repo, this.config.hnLimit);
        hnItemsCollected = hnItems.length;

        if (hnItems.length > 0) {
          const dbHnItems = hnItems.map((item) => ({
            repoId: savedRepo.id,
            type: item.type,
            title: item.title,
            content: item.content,
            author: item.author,
            score: item.score,
            descendants: item.descendants,
            url: item.url,
            rawJson: item.rawJson,
          }));

          await insertHackernewsItems(this.db, dbHnItems);
        }
      }

      status = "completed";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    }

    const duration = Date.now() - startTime;

    return {
      repository: repository!,
      chunksCollected,
      embeddingsGenerated,
      hnItemsCollected,
      status,
      error,
      duration,
    };
  }

  /**
   * 采集 Hacker News 数据
   * 使用 HN Search API (https://hn.algolia.com/api/v1/search)
   */
  private async fetchHackerNews(
    query: string,
    limit: number
  ): Promise<
    Array<{
      type: string;
      title: string | null;
      content: string | null;
      author: string | null;
      score: number | null;
      descendants: number | null;
      url: string | null;
      rawJson: object;
    }>
  > {
    try {
      const response = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hits_per_page=${limit}`
      );

      if (!response.ok) {
        throw new Error(`Hacker News API error: ${response.status}`);
      }

      const data = await response.json() as { hits: Array<Record<string, unknown>> };

      return data.hits.map((hit) => ({
        type: "story",
        title: hit.title as string | null,
        content: hit.story_text as string | null,
        author: hit.author as string | null,
        score: hit.points as number | null,
        descendants: hit.num_comments as number | null,
        url: hit.url as string | null,
        rawJson: hit,
      }));
    } catch (err) {
      console.error("Failed to fetch Hacker News:", err);
      return [];
    }
  }
}

/**
 * 创建数据采集 Pipeline 实例
 */
export function createPipeline(
  db: Db,
  config?: PipelineConfig
): DataCollectionPipeline {
  return new DataCollectionPipeline(db, config);
}
