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
import { createAI, EmbeddingProvider } from "@devscope/ai";
import {
  createDb,
  semanticSearchRepoChunks,
  getRepositoryByFullName,
  createPipeline,
  repositories,
  repoChunks,
} from "@devscope/db";
import { eq } from "drizzle-orm";
import {
  repositoryAnalysisRequestSchema,
  repositoryAnalysisSchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
  type RepositoryAnalysis,
  type CollectionResult,
} from "@devscope/shared";
import { workflowRouter } from "./router/workflow";

// ============================================================================
// 初始化 AI 服务
// ============================================================================

/** 创建 AI 提供者实例 */
const ai = createAI();

// ============================================================================
// 应用路由器
// ============================================================================

/**
 * 应用路由器
 * @description 包含所有 tRPC 路由
 */
export const appRouter = router({
  // 工作流相关路由
  workflow: workflowRouter,

  /**
   * 获取仓库列表
   * @description 获取已采集的仓库列表
   */
  getRepositories: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = createDb();
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const repos = await db
        .select()
        .from(repositories)
        .orderBy(repositories.stars)
        .limit(limit)
        .offset(offset);

      return repos.map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
        name: repo.name,
        owner: repo.owner,
        description: repo.description,
        url: repo.url,
        stars: repo.stars,
        forks: repo.forks,
        openIssues: repo.openIssues,
        language: repo.language,
        license: repo.license,
        lastFetchedAt: repo.lastFetchedAt?.toISOString(),
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
    .query(async ({ input }) => {
      const db = createDb();

      const repoList = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, input.id))
        .limit(1);

      if (repoList.length === 0) {
        throw new Error(`Repository with ID ${input.id} not found`);
      }

      const repo = repoList[0];

      // 获取分块统计
      const chunks = await db
        .select()
        .from(repoChunks)
        .where(eq(repoChunks.repoId, input.id));

      const chunkStats = {
        total: chunks.length,
        readme: chunks.filter((c) => c.chunkType === "readme").length,
        issues: chunks.filter((c) => c.chunkType === "issues").length,
        commits: chunks.filter((c) => c.chunkType === "commits").length,
      };

      return {
        id: repo.id,
        fullName: repo.fullName,
        name: repo.name,
        owner: repo.owner,
        description: repo.description,
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
   * 采集仓库数据
   * @description 触发数据采集流程，拉取 GitHub 数据并存储到数据库
   */
  collectRepository: publicProcedure
    .input(z.object({
      repo: z.string().min(1), // 格式: owner/repo
    }))
    .mutation(async ({ input }) => {
      const db = createDb();
      const pipeline = createPipeline(db);

      const result: CollectionResult = await pipeline.run({ repo: input.repo });

      return result;
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
    .mutation(async ({ input }) => {
      const { owner, repo, context } = input;

      // 构建分析提示词
      const prompt = buildAnalysisPrompt(owner, repo, context);

      // 使用 AI 的结构化输出功能
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
    .mutation(async ({ input }) => {
      const startTime = Date.now();
      const db = createDb();
      const embedder = new EmbeddingProvider();

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

      // 3. 生成查询的 embedding 向量
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
