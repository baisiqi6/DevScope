/**
 * @package @devscope/db
 * @description 数据采集 Pipeline
 *
 * 整合 GitHub 数据采集、文本分块、Embedding 生成和存储的完整流程。
 *
 * @module pipeline
 */

import {
  applyRepositoryEmbeddingSnapshot,
  claimRepositoryEmbeddingSnapshot,
  commitRepositoryCollectionSnapshot,
  markEmbeddingFailedForVersion,
  normalizeGitHubReleaseId,
  updateEmbeddingProgressForVersion,
  type EmbeddingApplyResult,
  type SourceSnapshot,
} from "./index";
import { GitHubCollector, parseRepoFullName } from "./github";
import { TextChunker, BGEEmbeddingProvider } from "@devscope/ai";
import { GitHubClient } from "@devscope/shared";
import { parseSbomPackages, type SbomPackage } from "./repo-graph";
import type { Db } from "./index";
import { z } from "zod";

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
  /** SBOM 中解析出的 npm 包列表 */
  sbomPackages?: SbomPackage[];
  /** 原子提交返回的采集版本，仅供同进程 embedding 启动使用 */
  collectionVersion?: Date;
}

type PreparedHackerNewsItem = {
  type: string;
  title: string | null;
  content: string | null;
  author: string | null;
  score: number | null;
  descendants: number | null;
  url: string | null;
  rawJson: Record<string, unknown>;
};

const hackerNewsResponseSchema = z.object({
  hits: z.array(z.object({
    title: z.string().nullable(),
    story_text: z.string().nullable(),
    author: z.string().nullable(),
    points: z.number().int().nullable(),
    num_comments: z.number().int().nonnegative().nullable(),
    url: z.string().nullable(),
  }).passthrough()),
});

const githubReleaseSchema = z.object({
  id: z.union([z.string(), z.number(), z.bigint()]),
  tagName: z.string(),
  name: z.string(),
  body: z.string().nullable(),
  author: z.string(),
  createdAt: z.date(),
  publishedAt: z.date().nullable(),
  url: z.string(),
  htmlUrl: z.string(),
  zipUrl: z.string().nullable(),
  tarUrl: z.string().nullable(),
  assets: z.array(z.object({
    name: z.string(),
    size: z.number().nonnegative(),
    downloadCount: z.number().int().nonnegative(),
    url: z.string(),
    browserDownloadUrl: z.string(),
  })),
  isPrerelease: z.boolean(),
});

const sbomPackageSchema = z.object({
  name: z.string().min(1),
  versionInfo: z.string().min(1).optional(),
  externalRefs: z.array(z.object({
    referenceType: z.string().min(1),
    referenceLocator: z.string().min(1),
  }).passthrough()).optional(),
}).passthrough();

const sbomEnvelopeSchema = z.object({
  sbom: z.object({
    packages: z.array(sbomPackageSchema),
  }).passthrough(),
}).passthrough();

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
  /** 是否采集 SBOM（默认开启） */
  includeSbom?: boolean;
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
  private chunker: import("@devscope/ai").TextChunker;
  private embedder: import("@devscope/ai").BGEEmbeddingProvider;
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
      includeSbom: config.includeSbom ?? true,
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

  private getEmbeddingBatchSize(): number {
    const configured = Number.parseInt(process.env.EMBEDDING_BATCH_SIZE || "", 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 10;
  }

  private getEmbeddingBatchDelayMs(): number {
    const configured = Number.parseInt(process.env.EMBEDDING_BATCH_DELAY_MS || "", 10);
    if (Number.isFinite(configured) && configured >= 0) {
      return configured;
    }

    return this.config.bgeApiUrl.includes("siliconflow.cn") ? 0 : 3000;
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
   * 后台执行向量化。chunks 必须由版本绑定的 claim 事务读取，调用方不能传入。
   */
  async runEmbeddingsInBackground(
    repoId: number,
    expectedUpdatedAt: Date,
    onProgress?: EmbeddingProgressCallback,
  ): Promise<EmbeddingApplyResult> {
    const claim = await claimRepositoryEmbeddingSnapshot(this.db, repoId, expectedUpdatedAt);
    if (claim.status !== "claimed") {
      return { status: claim.status };
    }

    const chunks = claim.chunks;
    const totalChunks = chunks.length;
    console.log(`[Pipeline] Starting background embedding for repository ${repoId}, ${totalChunks} chunks...`);

    try {
      const texts = chunks.map((chunk) => chunk.content);
      const BATCH_SIZE = this.getEmbeddingBatchSize();
      const batchDelayMs = this.getEmbeddingBatchDelayMs();
      const results: (number[] | null)[] = new Array(texts.length).fill(null);

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const batchResults = await this.embedder.embedBatch(batch) as Array<number[] | null>;
        for (let j = 0; j < batch.length; j++) {
          results[i + j] = batchResults[j] ?? null;
        }

        const completed = Math.min(i + BATCH_SIZE, texts.length);
        const progress = {
          current: completed,
          total: totalChunks,
          percent: Math.floor((completed / totalChunks) * 100),
          status: 'processing' as const,
        };
        const current = await updateEmbeddingProgressForVersion(
          this.db,
          repoId,
          expectedUpdatedAt,
          completed,
          totalChunks,
        );
        if (!current) return { status: "stale" };

        if (onProgress) {
          await onProgress(progress);
        }

        if (batchDelayMs > 0 && i + BATCH_SIZE < texts.length) {
          await new Promise(resolve => setTimeout(resolve, batchDelayMs));
        }
      }

      const dbChunks = chunks.map((chunk, index) => ({
          content: chunk.content,
          chunkType: chunk.chunkType || "description",
          sourceId: chunk.sourceId || null,
          chunkIndex: chunk.chunkIndex,
          embedding: results[index],
          tokenCount: chunk.tokenCount,
      }));
      const pooled = results.flatMap((embedding, index) =>
        embedding !== null
          && (chunks[index].chunkType === "readme" || chunks[index].chunkType === "description")
          ? [embedding]
          : []
      );
      const repositoryEmbedding = pooled.length > 0
        ? pooled[0].map((_, dimension) =>
            pooled.reduce((sum, embedding) => sum + embedding[dimension], 0) / pooled.length)
        : null;
      const failedCount = results.filter((embedding) => embedding === null).length;
      const applied = await applyRepositoryEmbeddingSnapshot(this.db, {
        repoId,
        expectedVersion: expectedUpdatedAt,
        chunks: dbChunks,
        repositoryEmbedding,
        error: failedCount > 0 ? `${failedCount} chunks 向量化失败` : undefined,
      });
      if (applied.status !== "applied") return applied;

      if (onProgress) {
        await onProgress({
          current: totalChunks,
          total: totalChunks,
          percent: 100,
          status: 'completed',
        });
      }

      console.log(`[Pipeline] Background embedding completed: ${totalChunks}/${totalChunks} chunks`);
      return applied;
    } catch (err) {
      console.error(`[Pipeline] Background embedding failed:`, err);
      const message = err instanceof Error ? err.message : String(err);
      const recorded = await markEmbeddingFailedForVersion(this.db, repoId, expectedUpdatedAt, message);

      if (onProgress) {
        await onProgress({
          current: 0,
          total: totalChunks,
          percent: 0,
          status: 'failed',
          error: message,
        });
      }
      return recorded
        ? { status: "failed", completedChunks: 0, totalChunks, error: message }
        : { status: "stale" };
    }
  }

  private async prepareHackerNewsSnapshot(
    query: string,
    limit: number,
    enabled: boolean,
  ): Promise<SourceSnapshot<PreparedHackerNewsItem>> {
    if (!enabled) return { status: "skipped" };
    try {
      const response = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hits_per_page=${limit}`,
      );
      if (!response.ok) {
        throw new Error(`Hacker News API error: ${response.status}`);
      }
      const data = hackerNewsResponseSchema.parse(await response.json());
      return {
        status: "success",
        items: data.hits.map((hit) => ({
          type: "story",
          title: hit.title,
          content: hit.story_text,
          author: hit.author,
          score: hit.points,
          descendants: hit.num_comments,
          url: hit.url,
          rawJson: hit,
        })),
      };
    } catch (err) {
      return { status: "failure", error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async prepareReleaseSnapshot(
    owner: string,
    repo: string,
  ): Promise<SourceSnapshot<ReturnType<typeof this.toStoredRelease>>> {
    try {
      const githubReleases = z.array(githubReleaseSchema).parse(
        await this.github.getReleases(owner, repo, 10),
      );
      return {
        status: "success",
        items: githubReleases.map((release) => this.toStoredRelease(release)),
      };
    } catch (err) {
      return { status: "failure", error: err instanceof Error ? err.message : String(err) };
    }
  }

  private toStoredRelease(release: z.infer<typeof githubReleaseSchema>) {
    return {
      ...release,
      id: normalizeGitHubReleaseId(release.id),
    };
  }

  private async prepareSbomSnapshot(
    fullName: string,
    enabled: boolean,
    githubToken: string,
  ): Promise<
    | { status: "success"; packages: SbomPackage[] }
    | { status: "failure"; error: string }
    | { status: "skipped" }
  > {
    if (!enabled) return { status: "skipped" };
    try {
      const ghClient = new GitHubClient(githubToken || undefined);
      const raw = await ghClient.getSbom(fullName);
      if (raw === null) return { status: "success", packages: [] };
      const envelope = sbomEnvelopeSchema.parse(raw);
      return { status: "success", packages: parseSbomPackages(envelope) };
    } catch (err) {
      return { status: "failure", error: err instanceof Error ? err.message : String(err) };
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
    let sbomPackages: SbomPackage[] | undefined;
    let collectionVersion: Date | undefined;

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

      // 2. 在事务外准备文本分块；任何失败都不会推进 repository version。
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

      console.log("[Pipeline] Step 2: Chunking text sources, count:", textSources.length);
      const chunks: TextChunk[] = this.chunker.chunkMultiple(textSources);
      chunksCollected = chunks.length;
      console.log("[Pipeline] Step 2 complete: Chunks created:", chunksCollected);
      const dbChunks = chunks.map((chunk: TextChunk) => ({
          content: chunk.content,
          chunkType: chunk.chunkType || "description",
          sourceId: chunk.sourceId || null,
          chunkIndex: chunk.chunkIndex,
          embedding: null,
          tokenCount: chunk.tokenCount,
        }));

      // 3. 在事务外准备可选来源，并保留 success([]) / failure / skipped。
      const [hackernews, releases, sbom] = await Promise.all([
        this.prepareHackerNewsSnapshot(repo, effectiveConfig.hnLimit, effectiveConfig.includeHackernews),
        this.prepareReleaseSnapshot(owner, repo),
        this.prepareSbomSnapshot(
          githubData.repository.fullName,
          effectiveConfig.includeSbom,
          effectiveConfig.githubToken,
        ),
      ]);
      hnItemsCollected = hackernews.status === "success" ? hackernews.items.length : 0;
      sbomPackages = sbom.status === "success" ? sbom.packages : undefined;

      const warnings = [
        hackernews.status === "failure" ? `Hacker News: ${hackernews.error}` : null,
        releases.status === "failure" ? `Releases: ${releases.error}` : null,
        sbom.status === "failure" ? `SBOM: ${sbom.error}` : null,
      ].filter((item): item is string => item !== null);
      warning = warnings.length > 0 ? warnings.join("; ") : undefined;

      // 4. repository metadata、版本、三类子快照与 embedding 初态一次提交。
      const committed = await commitRepositoryCollectionSnapshot(this.db, {
        repository: {
          githubRepositoryId: githubData.repository.githubRepositoryId,
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
          isReference: false,
        },
        chunks: dbChunks,
        hackernews,
        releases,
        sbom,
        allowNewStableIdentity: process.env.REPOSITORY_IDENTITY_CUTOVER === "enabled",
      });

      repository = {
        id: committed.repository.id,
        fullName: committed.repository.fullName,
        name: committed.repository.name,
        owner: committed.repository.owner,
        description: committed.repository.description || undefined,
        url: committed.repository.url,
        stars: committed.repository.stars ?? 0,
        forks: committed.repository.forks ?? 0,
        openIssues: committed.repository.openIssues ?? 0,
        language: committed.repository.language || undefined,
      };
      console.log("[Pipeline] Step 4: Atomic snapshot committed, repository ID:", committed.repository.id);

      status = "completed";
      collectionVersion = committed.version;
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
      sbomPackages,
      collectionVersion,
    };
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
