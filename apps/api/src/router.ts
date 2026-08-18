/**
 * @package @devscope/api
 * @description tRPC 路由定义
 *
 * 定义所有 API 路由和处理逻辑。
 *
 * @module router
 */

import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { createAI, BGEEmbeddingProvider } from "@devscope/ai";
import {
  semanticSearchRepoChunks,
  getRepositoryByFullName,
  createPipeline,
  parseRepoFullName,
  repositories,
  repoChunks,
  createGitHubCollector,
  getReleasesByRepoId,
  listWorkflowReportsByRepository,
  workflowExecutions,
  workflowReports,
  enqueueRestartableJob,
  HEALTH_ANALYSIS_JOB,
  healthAnalysisJobKey,
  healthAnalysisJobPayloadSchema,
  reconcileRepositoryEmbeddingStatus,
  userWatchedRepositories,
  type Db,
} from "@devscope/db";
import { desc, eq, sql, and, or } from "drizzle-orm";
import {
  repositoryAnalysisRequestSchema,
  repositoryAnalysisSchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
  repositoryDetailSchema,
  type RepositoryAnalysis,
} from "@devscope/shared";
import { groupsRouter, groupMembersRouter, groupsQueryRouter } from "./router/groups";
import { graphRouter } from "./router/graph";
import { discoveryRouter } from "./router/discovery";
import { findCurrentUserId, getOrCreateCurrentUserId } from "./current-user";
import { v4 as uuidv4 } from "uuid";

const activeRepositoryCollections = new Set<string>();

interface RepositoryIdentityMatch {
  id: number;
  githubRepositoryId: string | null;
  fullName: string;
}

export function resolveFollowingRepositoryMatch(
  matches: RepositoryIdentityMatch[],
  incoming: { githubRepositoryId: string; fullName: string },
): RepositoryIdentityMatch | null {
  const idMatch = matches.find(
    (row) => row.githubRepositoryId === incoming.githubRepositoryId,
  );
  const nameMatch = matches.find((row) => row.fullName === incoming.fullName);

  if (idMatch && nameMatch && idMatch.id !== nameMatch.id) {
    throw new Error(
      `Repository identity conflict: ${incoming.githubRepositoryId} and ${incoming.fullName} match different rows`,
    );
  }
  if (
    nameMatch?.githubRepositoryId
    && nameMatch.githubRepositoryId !== incoming.githubRepositoryId
  ) {
    throw new Error(
      `Repository identity conflict: ${incoming.fullName} belongs to ${nameMatch.githubRepositoryId}`,
    );
  }
  return idMatch ?? nameMatch ?? null;
}

function normalizeRepoKey(fullName: string): string {
  const { owner, repo } = parseRepoFullName(fullName.trim());
  return `${owner}/${repo}`.toLowerCase();
}

async function requireWatchedRepository(
  db: Db,
  userId: number,
  repoId: number,
): Promise<void> {
  const [association] = await db
    .select({ repoId: userWatchedRepositories.repoId })
    .from(userWatchedRepositories)
    .where(and(
      eq(userWatchedRepositories.userId, userId),
      eq(userWatchedRepositories.repoId, repoId),
    ))
    .limit(1);

  if (!association) {
    throw new Error(`Repository with ID ${repoId} not found`);
  }
}

async function requireWatchedRepositoryByFullName(
  db: Db,
  userId: number,
  fullName: string,
): Promise<void> {
  const [association] = await db
    .select({ repoId: userWatchedRepositories.repoId })
    .from(userWatchedRepositories)
    .innerJoin(repositories, eq(repositories.id, userWatchedRepositories.repoId))
    .where(and(
      eq(userWatchedRepositories.userId, userId),
      eq(repositories.fullName, fullName),
    ))
    .limit(1);

  if (!association) {
    throw new Error(`Repository ${fullName} not found`);
  }
}

// ============================================================================
// 初始化 AI 服务
// ============================================================================

/**
 * 创建 AI 提供者实例
 * 注意：延迟创建以确保环境变量已加载
 */
function getAI() {
  return createAI();
}

// ============================================================================
// 应用路由器
// ============================================================================

/**
 * 应用路由器
 * @description 包含所有 tRPC 路由
 */
export const appRouter = router({
  // 仓库分组相关路由
  groups: groupsRouter,
  groupMembers: groupMembersRouter,
  groupsQuery: groupsQueryRouter,

  // 仓库关系图谱
  graph: graphRouter,

  // GitHub Trending 与 DevScope 发现榜
  discovery: discoveryRouter,

  /**
   * 获取用户关注的仓库列表
   * @description 从 GitHub API 获取认证用户关注的仓库列表
   */
  getFollowing: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(30),
    }).optional())
    .query(async ({ ctx, input }) => {
      console.log("[getFollowing] Fetching following repos...");
      const github = createGitHubCollector();
      const limit = input?.limit ?? 30;

      try {
        const repos = await github.getFollowing(undefined, limit);
        console.log("[getFollowing] Found repos:", repos.length);
        const db = ctx.db;
        const userId = await getOrCreateCurrentUserId(db);

        // 关注时间属于用户关联，不写入全局 GitHub 仓库实体。
        try {
          for (const repo of repos) {
            const starredAt = (repo as { starredAt?: Date }).starredAt;
            if (starredAt) {
              const storedRepos = await db
                .select({
                  id: repositories.id,
                  githubRepositoryId: repositories.githubRepositoryId,
                  fullName: repositories.fullName,
                })
                .from(repositories)
                .where(or(
                  eq(repositories.githubRepositoryId, repo.githubRepositoryId),
                  eq(repositories.fullName, repo.fullName),
                ));
              const storedRepo = resolveFollowingRepositoryMatch(storedRepos, repo);
              if (!storedRepo) continue;
              await db
                .insert(userWatchedRepositories)
                .values({
                  userId,
                  repoId: storedRepo.id,
                  repoFullName: repo.fullName,
                  starredAt,
                })
                .onConflictDoUpdate({
                  target: [userWatchedRepositories.userId, userWatchedRepositories.repoId],
                  set: { starredAt, repoFullName: repo.fullName, updatedAt: new Date() },
                });
            }
          }
        } catch (e) {
          console.warn("[getFollowing] Failed to update starredAt:", e);
        }

        return repos;
      } catch (err) {
        console.error("[getFollowing] Error:", err);
        throw err;
      }
    }),

  /**
   * 获取仓库详细统计数据
   * @description 获取代码活跃度、Issues、PRs、贡献者和社区文件统计
   */
  getRepositoryStats: publicProcedure
    .input(z.object({
      repo: z.string().regex(/^[^/]+\/[^/]+$/, "Invalid repository format. Expected: owner/repo"),
    }))
    .query(async ({ input }) => {
      const github = createGitHubCollector();
      const [owner, name] = input.repo.split("/");
      const stats = await github.getRepositoryStats(owner, name);

      return {
        repository: {
          ...stats.repository,
          createdAt: stats.repository.createdAt.toISOString(),
          updatedAt: stats.repository.updatedAt.toISOString(),
          pushedAt: stats.repository.pushedAt.toISOString(),
        },
        commitFrequency: {
          ...stats.commitFrequency,
          lastCommitDate: stats.commitFrequency.lastCommitDate.toISOString(),
        },
        issuesStats: stats.issuesStats,
        prStats: stats.prStats,
        contributorsStats: stats.contributorsStats,
        communityFiles: stats.communityFiles,
      };
    }),

  /**
   * 获取仓库列表
   * @description 获取已采集的仓库列表
   */
  getRepositories: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).default({}))
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

      const repos = await db
        .select({
          id: repositories.id,
          fullName: repositories.fullName,
          name: repositories.name,
          owner: repositories.owner,
          description: repositories.description,
          url: repositories.url,
          stars: repositories.stars,
          forks: repositories.forks,
          openIssues: repositories.openIssues,
          language: repositories.language,
          license: repositories.license,
          lastFetchedAt: repositories.lastFetchedAt,
          starredAt: userWatchedRepositories.starredAt,
          note: userWatchedRepositories.notes,
        })
        .from(repositories)
        .innerJoin(
          userWatchedRepositories,
          and(
            eq(userWatchedRepositories.repoId, repositories.id),
            eq(userWatchedRepositories.userId, userId),
          ),
        )
        .where(eq(repositories.isReference, false))
        .orderBy(desc(repositories.stars))
        .limit(input.limit)
        .offset(input.offset);

      return repos.map((repo) => ({
        ...repo,
        lastFetchedAt: repo.lastFetchedAt?.toISOString(),
        starredAt: repo.starredAt?.toISOString() ?? null,
      }));
    }),

  /**
   * 获取仓库详情
   * @description 根据 ID 获取单个仓库的详细信息
   */
  getRepository: publicProcedure
    .input(z.object({
      id: z.number(),
    }))
    .output(repositoryDetailSchema)
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

      const repoList = await db
        .select({
          repository: repositories,
          note: userWatchedRepositories.notes,
        })
        .from(repositories)
        .innerJoin(
          userWatchedRepositories,
          and(
            eq(userWatchedRepositories.repoId, repositories.id),
            eq(userWatchedRepositories.userId, userId),
          ),
        )
        .where(eq(repositories.id, input.id))
        .limit(1);

      if (repoList.length === 0) {
        throw new Error(`Repository with ID ${input.id} not found`);
      }

      const { repository: repo, note } = repoList[0];

      // 分块统计 - SQL 聚合，不加载向量数据
      const chunkStatsRows = await db
        .select({
          chunkType: repoChunks.chunkType,
          count: sql<number>`count(*)`,
        })
        .from(repoChunks)
        .where(eq(repoChunks.repoId, input.id))
        .groupBy(repoChunks.chunkType);

      const chunkStats = {
        total: chunkStatsRows.reduce((sum, r) => sum + Number(r.count), 0),
        readme: Number(chunkStatsRows.find((r) => r.chunkType === "readme")?.count ?? 0),
        issues: Number(chunkStatsRows.find((r) => r.chunkType === "issues")?.count ?? 0),
        commits: Number(chunkStatsRows.find((r) => r.chunkType === "commits")?.count ?? 0),
      };

      return {
        id: repo.id,
        fullName: repo.fullName,
        name: repo.name,
        owner: repo.owner,
        description: repo.description,
        note,
        url: repo.url,
        stars: repo.stars,
        forks: repo.forks,
        openIssues: repo.openIssues,
        language: repo.language,
        license: repo.license,
        readme: repo.readme,
        readmeUrl: repo.readmeUrl,
        lastFetchedAt: repo.lastFetchedAt?.toISOString(),
        createdAt: repo.createdAt.toISOString(),
        chunkStats,
      };
    }),

  /**
   * 获取仓库健康分析报告历史
   * @description 按当前用户和仓库隔离，最新报告优先
   */
  getRepositoryHealthReports: publicProcedure
    .input(z.object({
      repoFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "格式应为 owner/repo"),
    }))
    .output(z.array(z.object({
      reportId: z.string(),
      executionId: z.string(),
      summary: z.string().nullable(),
      createdAt: z.string(),
    })))
    .query(async ({ ctx, input }) => {
      const userId = await findCurrentUserId(ctx.db);
      if (userId === null) {
        return [];
      }
      const reports = await listWorkflowReportsByRepository(
        ctx.db,
        input.repoFullName,
        userId
      );

      return reports.map((report) => ({
        ...report,
        createdAt: report.createdAt.toISOString(),
      }));
    }),

  /**
   * 获取仓库 Releases
   * @description 根据 ID 获取仓库的 Release 版本列表
   */
  getReleases: publicProcedure
    .input(z.object({
      repoId: z.number(),
      limit: z.number().min(1).max(50).default(10),
    }))
    .output(z.array(z.object({
      id: z.string().regex(/^[1-9]\d*$/),
      tagName: z.string(),
      name: z.string(),
      body: z.string().nullable(),
      author: z.string(),
      createdAt: z.string(),
      publishedAt: z.string().nullable(),
      htmlUrl: z.string(),
      zipUrl: z.string().nullable(),
      tarUrl: z.string().nullable(),
      assets: z.array(z.object({
        name: z.string(),
        size: z.number(),
        downloadCount: z.number(),
        url: z.string(),
        browserDownloadUrl: z.string(),
      })),
      isPrerelease: z.boolean(),
    })))
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireWatchedRepository(db, userId, input.repoId);
      const releases = await getReleasesByRepoId(db, input.repoId, input.limit);

      return releases.map((r) => ({
        id: r.id.toString(),
        tagName: r.tagName,
        name: r.name,
        body: r.body,
        author: r.author,
        createdAt: r.createdAt.toISOString(),
        publishedAt: r.publishedAt?.toISOString() || null,
        htmlUrl: r.htmlUrl,
        zipUrl: r.zipUrl,
        tarUrl: r.tarUrl,
        assets: r.assets,
        isPrerelease: r.isPrerelease,
      }));
    }),

  /**
   * 采集仓库数据
   * @description 触发数据采集流程，拉取 GitHub 数据并存储到数据库
   */
  collectRepository: publicProcedure
    .input(z.object({
      repo: z.string().min(1), // 格式: owner/repo
      skipEmbeddings: z.boolean().optional(), // 是否跳过向量化（快速采集模式）
    }))
    .mutation(async ({ ctx, input }) => {
      const repoKey = normalizeRepoKey(input.repo);
      if (activeRepositoryCollections.has(repoKey)) {
        throw new Error("该仓库正在采集或向量化中，请稍后再试");
      }

      activeRepositoryCollections.add(repoKey);

      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      const pipeline = createPipeline(db);
      let backgroundTaskOwnsLock = false;

      console.log("[collectRepository] Starting collection for:", input.repo, "skipEmbeddings:", input.skipEmbeddings);

      try {
        // 始终执行快速采集
        const result = await pipeline.run({
          repo: input.repo,
          config: { skipEmbeddings: true }, // 始终先快速采集
        });
        console.log("[collectRepository] Quick collection result:", result);

        if (result.status !== "completed" || !result.repository || !result.collectionVersion) {
          throw new Error(result.error || "仓库采集未提交有效快照");
        }

        await db
          .insert(userWatchedRepositories)
          .values({
            userId,
            repoId: result.repository.id,
            repoFullName: result.repository.fullName,
          })
          .onConflictDoUpdate({
            target: [userWatchedRepositories.userId, userWatchedRepositories.repoId],
            set: { repoFullName: result.repository.fullName, updatedAt: new Date() },
          });

        // 如果用户没有选择跳过向量化，启动后台向量化任务
        if (!input.skipEmbeddings && result.chunksCollected > 0) {
          console.log("[collectRepository] Starting background embedding for repo:", result.repository.id);
          backgroundTaskOwnsLock = true;
          pipeline.runEmbeddingsInBackground(result.repository.id, result.collectionVersion).then((outcome) => {
            console.log("[collectRepository] Background embedding outcome:", outcome);
          }).catch((err) => {
            console.error("[collectRepository] Background embedding failed:", err);
          }).finally(() => {
            activeRepositoryCollections.delete(repoKey);
          });
          result.embeddingInBackground = true;
        }

        const { collectionVersion: _collectionVersion, ...publicResult } = result;
        return publicResult;
      } catch (err) {
        console.error("[collectRepository] Error:", err);
        throw err;
      } finally {
        if (!backgroundTaskOwnsLock) {
          activeRepositoryCollections.delete(repoKey);
        }
      }
    }),

  // 更新仓库备注
  updateRepoNote: publicProcedure
    .input(z.object({
      repoId: z.number(),
      note: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireWatchedRepository(db, userId, input.repoId);
      await db
        .update(userWatchedRepositories)
        .set({ notes: input.note || null, updatedAt: new Date() })
        .where(and(
          eq(userWatchedRepositories.userId, userId),
          eq(userWatchedRepositories.repoId, input.repoId),
        ));
      return { success: true };
    }),

  /**
   * 启动可恢复的健康度分析
   * @description 在同一事务中创建持久任务和 execution，立即返回 executionId
   */
  startHealthAnalysis: publicProcedure
    .input(z.object({
      repoFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "格式应为 owner/repo"),
    }))
    .output(z.object({
      executionId: z.string(),
      deduplicated: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireWatchedRepositoryByFullName(db, userId, input.repoFullName);

      const executionId = uuidv4();
      const idempotencyKey = healthAnalysisJobKey(input.repoFullName);

      return db.transaction(async (tx) => {
        const { job, enqueued } = await enqueueRestartableJob(tx, {
          userId,
          type: HEALTH_ANALYSIS_JOB,
          idempotencyKey,
          payload: { executionId, repoFullName: input.repoFullName },
          priority: 5,
          maxAttempts: 3,
        });

        if (!enqueued) {
          const existingPayload = healthAnalysisJobPayloadSchema.parse(job.payload);
          return { executionId: existingPayload.executionId, deduplicated: true };
        }

        await tx.insert(workflowExecutions).values({
          executionId,
          userId,
          workflowId: "agent_health_analysis",
          workflowType: "health_report",
          status: "pending",
          input: {
            repos: [input.repoFullName],
            analysisType: "health_report",
          },
          currentNode: "queued",
        });

        return { executionId, deduplicated: false };
      });
    }),

  /**
   * 查询分析执行状态
   */
  getAnalysisStatus: publicProcedure
    .input(z.object({
      executionId: z.string().min(1),
    }))
    .output(z.object({
      executionId: z.string(),
      status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
      progressPercent: z.number().nullable(),
      currentNode: z.string().nullable(),
      error: z.string().nullable(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
    }))
    .query(async ({ ctx, input }) => {
      const userId = await findCurrentUserId(ctx.db);
      if (userId === null) {
        throw new Error("执行记录不存在");
      }

      const [row] = await ctx.db
        .select({
          executionId: workflowExecutions.executionId,
          status: workflowExecutions.status,
          progressPercent: workflowExecutions.progressPercent,
          currentNode: workflowExecutions.currentNode,
          error: workflowExecutions.error,
          startedAt: workflowExecutions.startedAt,
          completedAt: workflowExecutions.completedAt,
        })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.executionId, input.executionId),
            eq(workflowExecutions.userId, userId),
          )
        )
        .limit(1);

      if (!row) {
        throw new Error("执行记录不存在");
      }

      return {
        executionId: row.executionId,
        status: row.status,
        progressPercent: row.progressPercent,
        currentNode: row.currentNode,
        error: row.error,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
      };
    }),

  /**
   * 获取健康度报告
   */
  getHealthReport: publicProcedure
    .input(z.object({
      executionId: z.string().min(1),
    }))
    .output(z.object({
      reportId: z.string(),
      reportType: z.string(),
      reportData: z.unknown(),
      summary: z.string().nullable(),
      createdAt: z.string(),
    }).nullable())
    .query(async ({ ctx, input }) => {
      const userId = await findCurrentUserId(ctx.db);
      if (userId === null) {
        return null;
      }

      const [row] = await ctx.db
        .select({
          reportId: workflowReports.reportId,
          reportType: workflowReports.reportType,
          reportData: workflowReports.reportData,
          summary: workflowReports.summary,
          createdAt: workflowReports.createdAt,
        })
        .from(workflowReports)
        .where(
          and(
            eq(workflowReports.executionId, input.executionId),
            eq(workflowReports.userId, userId),
          )
        )
        .limit(1);

      if (!row) {
        return null;
      }

      return {
        reportId: row.reportId,
        reportType: row.reportType,
        reportData: row.reportData,
        summary: row.summary,
        createdAt: row.createdAt.toISOString(),
      };
    }),

  /**
   * 获取仓库向量化状态
   * @description 查询仓库的向量化进度和状态
   */
  getEmbeddingStatus: publicProcedure
    .input(z.object({
      repoId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);
      await requireWatchedRepository(db, userId, input.repoId);

      const repoList = await db
        .select({
          id: repositories.id,
          embeddingStatus: repositories.embeddingStatus,
          embeddingProgress: repositories.embeddingProgress,
          embeddingTotalChunks: repositories.embeddingTotalChunks,
          embeddingCompletedChunks: repositories.embeddingCompletedChunks,
          embeddingStartedAt: repositories.embeddingStartedAt,
          embeddingCompletedAt: repositories.embeddingCompletedAt,
          embeddingError: repositories.embeddingError,
        })
        .from(repositories)
        .where(eq(repositories.id, input.repoId))
        .limit(1);

      if (repoList.length === 0) {
        throw new Error(`Repository with ID ${input.repoId} not found`);
      }

      const repo = repoList[0];

      return {
        repoId: repo.id,
        status: repo.embeddingStatus || 'pending',
        progress: repo.embeddingProgress || 0,
        totalChunks: repo.embeddingTotalChunks || 0,
        completedChunks: repo.embeddingCompletedChunks || 0,
        startedAt: repo.embeddingStartedAt?.toISOString() || null,
        completedAt: repo.embeddingCompletedAt?.toISOString() || null,
        error: repo.embeddingError || null,
      };
    }),

  /**
   * 同步仓库向量化状态
   * @description 检查 repo_chunks 表中的 embedding 数据，更新 repositories 表的状态
   */
  syncEmbeddingStatus: publicProcedure
    .input(z.object({
      repoId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const userId = await getOrCreateCurrentUserId(db);

      if (input.repoId !== undefined) {
        await requireWatchedRepository(db, userId, input.repoId);
      }

      // 只同步当前用户关联的仓库；repositories 仍是可共享的 GitHub 实体。
      const whereClause = input.repoId
        ? eq(repositories.id, input.repoId)
        : undefined;

      const repoList = await db
        .select({
          id: repositories.id,
          fullName: repositories.fullName,
        })
        .from(repositories)
        .innerJoin(
          userWatchedRepositories,
          and(
            eq(userWatchedRepositories.repoId, repositories.id),
            eq(userWatchedRepositories.userId, userId),
          ),
        )
        .where(whereClause);

      const results = [];

      for (const repo of repoList) {
        const reconciled = await reconcileRepositoryEmbeddingStatus(db, repo.id);
        results.push({
          repoId: repo.id,
          fullName: repo.fullName,
          status: reconciled.status === "no_chunks"
            ? "no_chunks"
            : reconciled.changed
              ? `updated_to_${reconciled.status}`
              : "no_change",
          message: `${reconciled.status} (${reconciled.completedChunks}/${reconciled.totalChunks})`,
        });
      }

      return {
        total: repoList.length,
        results,
      };
    }),

  /**
   * 健康检查接口
   * @description 用于检查服务是否正常运行
   */
  health: publicProcedure.query(() => ({
    /** 服务状态 */
    status: "ok",
    /** 当前时间戳 */
    timestamp: new Date().toISOString(),
  })),

  /**
   * 问候接口
   * @description 接收名字并返回问候消息
   */
  greet: publicProcedure
    /** 输入验证：名字必须是非空字符串 */
    .input(z.object({ name: z.string() }))
    .query(({ input }) => ({
      /** 返回问候消息 */
      message: `Hello, ${input.name}!`,
    })),

  /**
   * 仓库健康度分析接口
   * @description 对 GitHub 仓库进行全面分析，返回结构化的健康度报告
   */
  analyzeRepository: publicProcedure
    /** 输入验证：使用 shared 包中定义的请求 Schema */
    .input(repositoryAnalysisRequestSchema)
    /** 输出验证：使用 shared 包中定义的分析结果 Schema */
    .output(repositoryAnalysisSchema)
    .mutation(async ({ ctx, input }) => {
      const { owner, repo, context } = input;

      // 构建分析提示词
      const prompt = buildAnalysisPrompt(owner, repo, context);

      // 使用 AI 的结构化输出功能
      const ai = getAI();
      const result = await ai.structuredComplete<RepositoryAnalysis>(prompt, {
        schema: repositoryAnalysisSchema,
        toolName: "repository_analysis",
        toolDescription: "生成 GitHub 仓库健康度分析报告",
        system: `你是一个专业的开源项目分析师。你需要对给定的 GitHub 仓库进行全面评估，并返回结构化的分析结果。

评估维度：
1. 健康度评分（0-100）：综合考虑代码质量、文档完整性、社区活跃度等
2. 活动级别：high/medium/low/dead
3. 关键指标：Stars 增长率、Issue 解决率、贡献者多样性
4. 风险因素：识别项目面临的潜在风险
5. 机会因素：识别项目的发展机会
6. 推荐级别：invest/watch/avoid

请基于 GitHub 仓库 ${owner}/${repo} 的实际情况进行分析。`,
        temperature: 0.3, // 使用较低温度以获得更一致的结果
      });

      return result;
    }),

  /**
   * 语义搜索接口
   * @description 对已采集的仓库内容进行语义搜索，返回相关分块和 AI 生成的综合回答
   */
  semanticSearch: publicProcedure
    /** 输入验证：使用 shared 包中定义的搜索请求 Schema */
    .input(semanticSearchRequestSchema)
    /** 输出验证：使用 shared 包中定义的搜索响应 Schema */
    .output(semanticSearchResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      const db = ctx.db;

      // 1. 解析仓库名称并验证格式
      const parts = input.repo.split("/");
      if (parts.length !== 2) {
        throw new Error(`Invalid repository format: ${input.repo}. Expected format: owner/repo`);
      }
      const [owner, repoName] = parts;
      const fullName = `${owner}/${repoName}`;

      // 2. 获取仓库信息
      const repository = await getRepositoryByFullName(db, fullName);
      if (!repository) {
        throw new Error(
          `Repository ${fullName} not found. Please collect the repository data first using the data collection pipeline.`
        );
      }
      const userId = await getOrCreateCurrentUserId(db);
      await requireWatchedRepository(db, userId, repository.id);

      // 3. 生成查询的 embedding 向量
      const embedder = new BGEEmbeddingProvider();
      const queryEmbedding = await embedder.embed(input.query);

      // 4. 使用 pgvector 进行语义搜索
      const chunks = await semanticSearchRepoChunks(
        db,
        repository.id,
        queryEmbedding,
        input.limit
      );

      // 5. 生成 AI 综合回答（可选）
      let answer: string | undefined;
      if (input.generateAnswer && chunks.length > 0) {
        // 构建上下文文本
        const contextText = chunks
          .map((c, i) => `[来源 ${i + 1}]: ${c.content}`)
          .join("\n\n");

        const prompt = `你是一个技术助手。基于以下从仓库 ${fullName} 中搜索到的相关内容，回答用户的问题。

用户问题："${input.query}"

搜索结果：
${contextText}

请提供一个简洁、准确的回答。如果搜索结果不足以回答问题，请明确说明。`;

        const ai = getAI();
        answer = await ai.complete(prompt, {
          maxTokens: 500,
          temperature: 0.5,
        });
      }

      const duration = Date.now() - startTime;

      // 6. 返回结果
      return {
        repository: {
          id: repository.id,
          fullName: repository.fullName,
          name: repository.name,
          owner: repository.owner,
          description: repository.description || undefined,
        },
        chunks: chunks.map((c) => ({
          id: c.id,
          content: c.content,
          chunkType: c.chunkType as any,
          sourceId: c.sourceId || undefined,
          chunkIndex: c.chunkIndex,
          tokenCount: c.tokenCount || undefined,
        })),
        answer,
        duration,
      };
    }),
});

/**
 * 构建仓库分析提示词
 * @description 根据输入参数构建详细的分析提示词
 *
 * @param owner - 仓库所有者
 * @param repo - 仓库名称
 * @param context - 额外的上下文信息
 * @returns 完整的分析提示词
 */
function buildAnalysisPrompt(owner: string, repo: string, context?: string): string {
  const repoInfo = `GitHub 仓库: ${owner}/${repo}`;

  if (context) {
    return `${repoInfo}\n\n额外上下文:\n${context}\n\n请基于以上信息，对这个仓库进行全面分析并返回结构化的健康度报告。`;
  }

  return `${repoInfo}\n\n请分析这个 GitHub 仓库的健康状况，并返回结构化的健康度报告。请重点关注以下方面：\n\n` +
    `1. 代码质量和架构\n` +
    `2. 文档完整性\n` +
    `3. 社区活跃度（stars、forks、contributors）\n` +
    `4. Issue 和 PR 处理情况\n` +
    `5. 最近提交频率\n` +
    `6. 潜在风险和发展机会`;
}

/**
 * 导出路由器类型
 * @description 用于前端类型推断
 */
export type AppRouter = typeof appRouter;
