/**
 * @package @devscope/db
 * @description 数据采集 Pipeline
 *
 * 整合 GitHub 数据采集、文本分块、Embedding 生成和存储的完整流程。
 *
 * @module pipeline
 */

import { upsertRepository, insertRepoChunks, insertHackernewsItems, deleteRepoChunksByRepoId, deleteHackernewsItemsByRepoId, repositories } from "./index";
import { GitHubCollector, parseRepoFullName } from "./github";
import { TextChunker, BGEEmbeddingProvider } from "@devscope/ai";
import type { Db } from "./index";
import { eq } from "drizzle-orm";

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
  /** 向量化是否在后台进行 */
  embeddingInBackground?: boolean;
}

/**
 * 向量化进度回调
 */
export interface EmbeddingProgressCallback {
  (progress: {
    current: number;
    total: number;
    percent: number;
    status: 'processing' | 'completed' | 'failed';
    error?: string;
  }): void | Promise<void>;
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
    console.log("[Pipeline] Initializing components...");
    try {
      this.github = new GitHubCollector(this.config.githubToken);
      console.log("[Pipeline] GitHubCollector initialized");
    } catch (err) {
      console.error("[Pipeline] Failed to initialize GitHubCollector:", err);
      throw new Error(`Failed to initialize GitHubCollector: ${err}`);
    }

    try {
      this.chunker = new TextChunker({
        maxTokens: this.config.chunkMaxTokens,
        overlapTokens: this.config.chunkOverlapTokens,
      });
      console.log("[Pipeline] TextChunker initialized");
    } catch (err) {
      console.error("[Pipeline] Failed to initialize TextChunker:", err);
      throw new Error(`Failed to initialize TextChunker: ${err}`);
    }

    try {
      this.embedder = new BGEEmbeddingProvider({ baseURL: this.config.bgeApiUrl });
      console.log("[Pipeline] BGEEmbeddingProvider initialized");
    } catch (err) {
      console.error("[Pipeline] Failed to initialize BGEEmbeddingProvider:", err);
      throw new Error(`Failed to initialize BGEEmbeddingProvider: ${err}`);
    }
  }

  /**
   * 更新仓库的向量化状态
   */
  private async updateEmbeddingStatus(
    repoId: number,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    progress: { current: number; total: number },
    error?: string
  ): Promise<void> {
    const updateData: any = {
      embeddingStatus: status,
      embeddingProgress: progress.total > 0 ? Math.floor((progress.current / progress.total) * 100) : 0,
      embeddingCompletedChunks: progress.current,
      embeddingTotalChunks: progress.total,
    };

    if (status === 'processing' && !updateData.embeddingStartedAt) {
      updateData.embeddingStartedAt = new Date();
    }

    if (status === 'completed') {
      updateData.embeddingCompletedAt = new Date();
      updateData.embeddingProgress = 100;
    }

    if (status === 'failed' && error) {
      updateData.embeddingError = error;
    }

    await this.db
      .update(repositories)
      .set(updateData)
      .where(eq(repositories.id, repoId));

    console.log(`[Pipeline] Updated embedding status: ${status}, progress: ${progress.current}/${progress.total}`);
  }

  /**
   * 执行快速采集（不包含向量化）
   */
  async runQuick(input: PipelineInput): Promise<CollectionResult> {
    return await this.run({
      ...input,
      config: { ...input.config, skipEmbeddings: true },
    });
  }

  /**
   * 后台执行向量化
   * @param repoId 仓库 ID
   * @param chunks 文本分块数组
   * @param onProgress 进度回调
   */
  async runEmbeddingsInBackground(
    repoId: number,
    chunks: TextChunk[],
    onProgress?: EmbeddingProgressCallback
  ): Promise<void> {
    const totalChunks = chunks.length;
    console.log(`[Pipeline] Starting background embedding for ${totalChunks} chunks...`);

    try {
      await this.updateEmbeddingStatus(repoId, 'processing', { current: 0, total: totalChunks });

      const texts = chunks.map((c: TextChunk) => c.content);

      // 自定义 embedBatch，支持进度回调
      const BATCH_SIZE = 10;
      const results: (number[] | null)[] = new Array(texts.length).fill(null);
      let successCount = 0;

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batchIndex = Math.floor(i / BATCH_SIZE);
        const batch = texts.slice(i, i + BATCH_SIZE);

        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
          try {
            const response = await (this.embedder as any).client.embeddings.create({
              model: (this.embedder as any).defaultModel,
              input: batch,
            });

            for (const data of response.data) {
              results[i + data.index] = data.embedding;
              successCount++;
            }

            break;
          } catch (error: any) {
            retryCount++;
            const isRetryable = error.status === 429 || error.status === 400;

            if (isRetryable && retryCount < maxRetries) {
              const waitTime = retryCount * 5000;
              console.warn(`[Pipeline] Batch ${batchIndex} failed (attempt ${retryCount}/${maxRetries}), retrying after ${waitTime}ms...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
              console.warn(`[Pipeline] Batch ${batchIndex} permanently failed: ${error.message || error}`);
              for (let j = 0; j < batch.length; j++) {
                results[i + j] = null;
              }
              break;
            }
          }
        }

        // 更新进度
        const completed = Math.min(i + BATCH_SIZE, texts.length);
        const progress = {
          current: completed,
          total: totalChunks,
          percent: Math.floor((completed / totalChunks) * 100),
          status: 'processing' as const,
        };

        await this.updateEmbeddingStatus(repoId, 'processing', { current: completed, total: totalChunks });

        if (onProgress) {
          await onProgress(progress);
        }

        // 添加延迟避免 API 限流
        if (i + BATCH_SIZE < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // 删除旧的 chunks 并插入新的带 embedding 的 chunks
      console.log(`[Pipeline] Deleting old chunks for repository: ${repoId}`);
      await deleteRepoChunksByRepoId(this.db, repoId);

      // 只插入成功的 chunks
      const validChunks = chunks.filter((_, i) => results[i] !== null);
      const dbChunks = validChunks.map((chunk) => {
        const resultIndex = chunks.indexOf(chunk);
        return {
          repoId: repoId,
          content: chunk.content,
          chunkType: chunk.chunkType || "description",
          sourceId: chunk.sourceId || null,
          chunkIndex: chunk.chunkIndex,
          embedding: results[resultIndex] as number[],
          tokenCount: chunk.tokenCount,
        };
      });

      await insertRepoChunks(this.db, dbChunks);

      const failedCount = totalChunks - successCount;
      if (failedCount > 0) {
        console.warn(`[Pipeline] Completed with ${failedCount} failed embeddings`);
      }

      await this.updateEmbeddingStatus(repoId, 'completed', { current: totalChunks, total: totalChunks });

      if (onProgress) {
        await onProgress({
          current: totalChunks,
          total: totalChunks,
          percent: 100,
          status: 'completed',
        });
      }

      console.log(`[Pipeline] Background embedding completed: ${successCount}/${totalChunks} chunks`);
    } catch (err) {
      console.error(`[Pipeline] Background embedding failed:`, err);
      await this.updateEmbeddingStatus(repoId, 'failed', { current: 0, total: totalChunks }, err instanceof Error ? err.message : String(err));

      if (onProgress) {
        await onProgress({
          current: 0,
          total: totalChunks,
          percent: 0,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * 执行完整的数据采集流程
   */
  async run(input: PipelineInput): Promise<CollectionResult> {
    const startTime = Date.now();
    const { owner, repo } = parseRepoFullName(input.repo);

    // 合并配置：input.config 优先于构造时的 this.config
    const effectiveConfig = {
      ...this.config,
      ...input.config,
    };

    console.log("[Pipeline] ======= PIPELINE START =======");
    console.log("[Pipeline] Input repo:", input.repo);
    console.log("[Pipeline] Parsed owner:", owner, "repo:", repo);
    console.log("[Pipeline] Config:", JSON.stringify({
      githubToken: effectiveConfig.githubToken ? "***" : "not set",
      bgeApiUrl: effectiveConfig.bgeApiUrl,
      dbUrl: effectiveConfig.dbUrl ? "***" : "not set",
      includeReadme: effectiveConfig.includeReadme,
      includeIssues: effectiveConfig.includeIssues,
      includeHackernews: effectiveConfig.includeHackernews,
      skipEmbeddings: effectiveConfig.skipEmbeddings,
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
        includeReadme: effectiveConfig.includeReadme,
        includeIssues: effectiveConfig.includeIssues,
        includeCommits: effectiveConfig.includeCommits,
        issuesLimit: effectiveConfig.issuesLimit,
        commitsLimit: effectiveConfig.commitsLimit,
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
        // 先删除该仓库的旧 chunks（避免重复数据）
        console.log("[Pipeline] Deleting old chunks for repository:", savedRepo.id);
        await deleteRepoChunksByRepoId(this.db, savedRepo.id);
        console.log("[Pipeline] Old chunks deleted, inserting new chunks...");

        // 新模式：始终先快速存储（不带 embedding），然后根据配置决定是否后台向量化
        console.log("[Pipeline] Storing chunks without embeddings (quick mode)...");
        const dbChunks = chunks.map((chunk: TextChunk) => ({
          repoId: savedRepo.id,
          content: chunk.content,
          chunkType: chunk.chunkType || "description",
          sourceId: chunk.sourceId || null,
          chunkIndex: chunk.chunkIndex,
          embedding: null, // 先存储为 null
          tokenCount: chunk.tokenCount,
        }));
        await insertRepoChunks(this.db, dbChunks);
        chunksCollected = dbChunks.length;
        console.log("[Pipeline] Step 4 complete: Stored", chunksCollected, "chunks (without embeddings)");

        // 如果不跳过向量化，更新状态为 pending（将在后台处理）
        if (!effectiveConfig.skipEmbeddings) {
          await this.updateEmbeddingStatus(savedRepo.id, 'pending', { current: 0, total: chunksCollected });
          console.log("[Pipeline] Embeddings will be processed in background");
        }
      } else {
        console.log("[Pipeline] Step 4 skipped: No chunks to process");
      }

      // 6. 采集 Hacker News 数据
      console.log("[Pipeline] Step 5: Fetching Hacker News data...");
      if (effectiveConfig.includeHackernews) {
        const hnItems = await this.fetchHackerNews(repo, effectiveConfig.hnLimit);
        hnItemsCollected = hnItems.length;
        console.log("[Pipeline] Hacker News items fetched:", hnItemsCollected);

        if (hnItems.length > 0) {
          // 先删除该仓库的旧 HackerNews items（避免重复数据）
          console.log("[Pipeline] Deleting old HackerNews items for repository:", savedRepo.id);
          await deleteHackernewsItemsByRepoId(this.db, savedRepo.id);
          console.log("[Pipeline] Old HackerNews items deleted, inserting new items...");

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
