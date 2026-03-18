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
import { TextChunker, BGEEmbeddingProvider } from "@devscope/ai";
import type { Db } from "./index";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 采集状态
 */
type CollectionStatus = "pending" | "processing" | "completed" | "failed" | "success";

/**
 * 文本分块结果（本地定义，避免导入问题）
 */
interface TextChunk {
  content: string;
  sourceId?: string;
  chunkType?: string;
  chunkIndex: number;
  tokenCount?: number;
}

/**
 * 采集结果
 */
interface CollectionResult {
  status: CollectionStatus;
  error?: string;
  warning?: string;
  repository?: {
    id: number;
    fullName: string;
    name: string;
    owner: string;
    stars: number;
    forks: number;
    openIssues: number;
    language?: string;
    description?: string;
    url: string;
  };
  chunksCollected: number;
  embeddingsGenerated: number;
  hnItemsCollected: number;
  duration: number;
}

/**
 * Pipeline 配置
 */
export interface PipelineConfig {
  /** GitHub Token（可选） */
  githubToken?: string;
  /** BGE-M3 API 基础 URL（默认：http://localhost:9999/v1） */
  bgeApiUrl?: string;
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
  /** 是否跳过 Embedding 生成（当 embedding 服务不可用时） */
  skipEmbeddings?: boolean;
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
  private chunker: InstanceType<typeof TextChunker>;
  private embedder: InstanceType<typeof BGEEmbeddingProvider>;
  private config: Required<PipelineConfig>;

  constructor(db: Db, config: PipelineConfig = {}) {
    this.db = db;

    // 设置默认值
    this.config = {
      githubToken: config.githubToken || process.env.GITHUB_TOKEN || "",
      bgeApiUrl: config.bgeApiUrl || process.env.BGE_API_URL || "http://localhost:9999/v1",
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
      skipEmbeddings: config.skipEmbeddings ?? false,
    };

    // 初始化组件
    this.github = new GitHubCollector(this.config.githubToken);
    this.chunker = new TextChunker({
      maxTokens: this.config.chunkMaxTokens,
      overlapTokens: this.config.chunkOverlapTokens,
    });
    this.embedder = new BGEEmbeddingProvider({ baseURL: this.config.bgeApiUrl });
  }

  /**
   * 执行完整的数据采集流程
   */
  async run(input: PipelineInput): Promise<CollectionResult> {
    const startTime = Date.now();
    const { owner, repo } = parseRepoFullName(input.repo);

    console.log("[Pipeline] ======= PIPELINE START =======");
    console.log("[Pipeline] Input repo:", input.repo);
    console.log("[Pipeline] Parsed owner:", owner, "repo:", repo);
    console.log("[Pipeline] Config:", JSON.stringify({
      githubToken: this.config.githubToken ? "***" : "not set",
      bgeApiUrl: this.config.bgeApiUrl,
      dbUrl: this.config.dbUrl ? "***" : "not set",
      includeReadme: this.config.includeReadme,
      includeIssues: this.config.includeIssues,
      includeHackernews: this.config.includeHackernews,
      skipEmbeddings: this.config.skipEmbeddings,
    }, null, 2));

    let status: CollectionStatus = "processing";
    let error: string | undefined;
    let warning: string | undefined;
    let repository: CollectionResult["repository"];
    let chunksCollected = 0;
    let embeddingsGenerated = 0;
    let hnItemsCollected = 0;

    try {
      console.log("[Pipeline] Step 1: Collecting GitHub data...");

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
        id: savedRepo.id,
        fullName: githubData.repository.fullName,
        name: githubData.repository.name,
        owner: githubData.repository.owner,
        description: githubData.repository.description || undefined,
        url: githubData.repository.url,
        stars: githubData.repository.stars,
        forks: githubData.repository.forks,
        openIssues: githubData.repository.openIssues,
        language: githubData.repository.language || undefined,
      };
      console.log("[Pipeline] Step 2: Repository saved, ID:", savedRepo.id);

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
      console.log("[Pipeline] Step 3: Chunking text sources, count:", textSources.length);
      const chunks: TextChunk[] = this.chunker.chunkMultiple(textSources);
      chunksCollected = chunks.length;
      console.log("[Pipeline] Step 3 complete: Chunks created:", chunksCollected);

      // 5. 生成 Embedding 并存储
      console.log("[Pipeline] Step 4: Generating embeddings and storing chunks...");
      if (chunks.length > 0) {
        // 检查是否跳过 embedding 生成
        if (this.config.skipEmbeddings) {
          console.log("[Pipeline] Embeddings skipped (skipEmbeddings=true)");
          // 存储不含 embedding 的分块
          const dbChunks = chunks.map((chunk: TextChunk) => ({
            repoId: savedRepo.id,
            content: chunk.content,
            chunkType: chunk.chunkType || "description",
            sourceId: chunk.sourceId || null,
            chunkIndex: chunk.chunkIndex,
            embedding: null, // 无 embedding
            tokenCount: chunk.tokenCount,
          }));
          await insertRepoChunks(this.db, dbChunks);
          chunksCollected = dbChunks.length;
          console.log("[Pipeline] Step 4 complete: Stored", chunksCollected, "chunks (without embeddings)");
        } else {
          try {
            // 批量生成 embedding
            const texts = chunks.map((c: TextChunk) => c.content);
            console.log("[Pipeline] Generating embeddings for", texts.length, "texts...");
            const embeddings = await this.embedder.embedBatch(texts);
            console.log("[Pipeline] Embeddings generated, count:", embeddings.length);

            // 准备数据库插入数据
            const dbChunks = chunks.map((chunk: TextChunk, index: number) => ({
              repoId: savedRepo.id,
              content: chunk.content,
              chunkType: chunk.chunkType || "description",
              sourceId: chunk.sourceId || null,
              chunkIndex: chunk.chunkIndex,
              embedding: embeddings[index],
              tokenCount: chunk.tokenCount,
            }));

            await insertRepoChunks(this.db, dbChunks);
            embeddingsGenerated = dbChunks.length;
            console.log("[Pipeline] Step 4 complete: Stored", embeddingsGenerated, "chunks");
          } catch (embedError) {
            // Embedding 服务不可用时的降级处理
            console.warn("[Pipeline] Embedding generation failed:", embedError);
            console.warn("[Pipeline] Falling back to storing chunks without embeddings...");
            warning = `Embedding 服务不可用，已存储文本分块但未生成向量。请检查 BGE_API_URL 配置（当前：${this.config.bgeApiUrl}）。`;

            // 存储不含 embedding 的分块
            const dbChunks = chunks.map((chunk: TextChunk) => ({
              repoId: savedRepo.id,
              content: chunk.content,
              chunkType: chunk.chunkType || "description",
              sourceId: chunk.sourceId || null,
              chunkIndex: chunk.chunkIndex,
              embedding: null, // 无 embedding
              tokenCount: chunk.tokenCount,
            }));
            await insertRepoChunks(this.db, dbChunks);
            chunksCollected = dbChunks.length;
            console.log("[Pipeline] Step 4 complete: Stored", chunksCollected, "chunks (without embeddings)");
          }
        }
      } else {
        console.log("[Pipeline] Step 4 skipped: No chunks to process");
      }

      // 6. 采集 Hacker News 数据
      console.log("[Pipeline] Step 5: Fetching Hacker News data...");
      if (this.config.includeHackernews) {
        const hnItems = await this.fetchHackerNews(repo, this.config.hnLimit);
        hnItemsCollected = hnItems.length;
        console.log("[Pipeline] Hacker News items fetched:", hnItemsCollected);

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
          console.log("[Pipeline] Hacker News items stored:", dbHnItems.length);
        }
      } else {
        console.log("[Pipeline] Step 5 skipped: includeHackernews is false");
      }

      status = "completed";
      console.log("[Pipeline] ======= PIPELINE COMPLETED SUCCESSFULLY =======");
    } catch (err) {
      status = "failed";
      console.error("[Pipeline] ======= ERROR START =======");
      console.error("[Pipeline] Error:", err);
      console.error("[Pipeline] Error type:", typeof err);
      if (err instanceof Error) {
        error = err.message || String(err);
        console.error("[Pipeline] Error message:", err.message);
        console.error("[Pipeline] Error name:", err.name);
        console.error("[Pipeline] Error stack:", err.stack);
      } else if (err && typeof err === "object") {
        // Handle objects that might not be Error instances
        error = JSON.stringify(err);
        console.error("[Pipeline] Error object:", JSON.stringify(err, null, 2));
      } else {
        error = String(err);
        console.error("[Pipeline] Error (string):", err);
      }
      console.error("[Pipeline] ======= ERROR END =======");
    }

    const duration = Date.now() - startTime;

    return {
      repository: repository!,
      chunksCollected,
      embeddingsGenerated,
      hnItemsCollected,
      status,
      error,
      warning,
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
