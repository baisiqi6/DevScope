/**
 * @package @devscope/api
 * @description 定时数据采集调度器
 *
 * 在 API 服务内部集成，共享数据库连接和 Pipeline 代码。
 * 通过环境变量 ENABLE_SCHEDULER=true 启用。
 */

import cron from "node-cron";
import {
  createDb,
  createPipeline,
  createOSSInsightClient,
  repositories,
  repoChunks,
} from "@devscope/db";
import { lt, eq, or, isNull } from "drizzle-orm";

// ============================================================================
// 调度器
// ============================================================================

let db: ReturnType<typeof createDb>;

function getDb() {
  if (!db) {
    db = createDb(process.env.DATABASE_URL);
  }
  return db;
}

/**
 * 刷新已关注仓库（超过 24h 未更新的）
 * 调度：每天凌晨 2:00
 */
async function refreshStaleRepositories() {
  console.log("[Scheduler] 🔄 开始刷新过期仓库...");

  try {
    const database = getDb();
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 查询超过 24h 未更新的仓库
    const staleRepos = await database
      .select({ id: repositories.id, fullName: repositories.fullName })
      .from(repositories)
      .where(
        or(
          lt(repositories.lastFetchedAt, staleThreshold),
          isNull(repositories.lastFetchedAt)
        )
      );

    if (staleRepos.length === 0) {
      console.log("[Scheduler] ✅ 没有需要刷新的仓库");
      return;
    }

    console.log(`[Scheduler] 发现 ${staleRepos.length} 个过期仓库，开始刷新...`);

    const pipeline = createPipeline(database, {
      githubToken: process.env.GITHUB_TOKEN,
      skipEmbeddings: true, // 先快速采集，向量化单独处理
    });

    let success = 0;
    let failed = 0;

    for (const repo of staleRepos) {
      try {
        await pipeline.runQuick({ repo: repo.fullName });
        // 刷新后将 embeddingStatus 重置为 pending，让 processPendingEmbeddings 重新向量化
        await database
          .update(repositories)
          .set({ embeddingStatus: "pending" })
          .where(eq(repositories.id, repo.id));
        success++;
        console.log(`[Scheduler] ✅ 刷新成功: ${repo.fullName}`);
      } catch (err: any) {
        failed++;
        console.error(`[Scheduler] ❌ 刷新失败: ${repo.fullName} - ${err.message}`);
      }

      // 请求间隔，避免 GitHub API 限流
      await sleep(2000);
    }

    console.log(`[Scheduler] 🔄 刷新完成: 成功 ${success}, 失败 ${failed}`);
  } catch (err: any) {
    console.error("[Scheduler] ❌ refreshStaleRepositories 失败:", err.message);
  }
}

/**
 * 发现趋势项目（从 OSSInsight）
 * 调度：每天早上 6:00
 */
async function discoverTrendingRepos() {
  console.log("[Scheduler] 🔍 开始发现趋势项目...");

  try {
    const database = getDb();
    const ossinsight = createOSSInsightClient();

    const trending = await ossinsight.getTrendingRepos(20, "7d");

    if (!trending || trending.length === 0) {
      console.log("[Scheduler] ⚠️ 未获取到趋势项目");
      return;
    }

    const pipeline = createPipeline(database, {
      githubToken: process.env.GITHUB_TOKEN,
      skipEmbeddings: true,
    });

    let newCount = 0;

    for (const repo of trending) {
      const fullName = repo.fullName;
      if (!fullName || !fullName.includes("/")) continue;

      // 检查是否已存在
      const existing = await database
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.fullName, fullName))
        .limit(1);

      if (existing.length > 0) continue;

      try {
        await pipeline.runQuick({ repo: fullName });
        newCount++;
        console.log(`[Scheduler] 🆕 新趋势项目入库: ${fullName}`);
      } catch (err: any) {
        console.error(`[Scheduler] ❌ 趋势项目采集失败: ${fullName} - ${err.message}`);
      }

      await sleep(2000);
    }

    console.log(`[Scheduler] 🔍 趋势发现完成: 新增 ${newCount} 个项目`);
  } catch (err: any) {
    console.error("[Scheduler] ❌ discoverTrendingRepos 失败:", err.message);
  }
}

/**
 * 处理待向量化数据
 * 调度：每 30 分钟
 */
async function processPendingEmbeddings() {
  console.log("[Scheduler] 🧠 开始处理待向量化数据...");

  try {
    const database = getDb();

    // 查询 embeddingStatus = 'pending' 的仓库
    const pendingRepos = await database
      .select({ id: repositories.id, fullName: repositories.fullName })
      .from(repositories)
      .where(eq(repositories.embeddingStatus, "pending"))
      .limit(10); // 每次最多处理 10 个

    if (pendingRepos.length === 0) {
      console.log("[Scheduler] ✅ 没有待向量化的仓库");
      return;
    }

    console.log(`[Scheduler] 发现 ${pendingRepos.length} 个待向量化仓库...`);

    const pipeline = createPipeline(database, {
      githubToken: process.env.GITHUB_TOKEN,
    });

    let success = 0;
    let failed = 0;

    for (const repo of pendingRepos) {
      try {
        // 读取该仓库已存储的 chunks
        const chunks = await database
          .select({ content: repoChunks.content, chunkType: repoChunks.chunkType, sourceId: repoChunks.sourceId, chunkIndex: repoChunks.chunkIndex, tokenCount: repoChunks.tokenCount })
          .from(repoChunks)
          .where(eq(repoChunks.repoId, repo.id));

        if (chunks.length === 0) {
          console.log(`[Scheduler] ⏭️ ${repo.fullName} 没有 chunks，跳过`);
          continue;
        }

        const [repoRecord] = await database
          .select({ updatedAt: repositories.updatedAt })
          .from(repositories)
          .where(eq(repositories.id, repo.id))
          .limit(1);

        if (!repoRecord) {
          console.log(`[Scheduler] ⏭️ ${repo.fullName} 仓库记录不存在，跳过`);
          continue;
        }

        // 调用后台向量化流程
        await pipeline.runEmbeddingsInBackground(repo.id, chunks.map(c => ({
          content: c.content,
          chunkType: c.chunkType || "description",
          sourceId: c.sourceId || undefined,
          chunkIndex: c.chunkIndex,
          tokenCount: c.tokenCount || 0,
        })), undefined, repoRecord.updatedAt);
        success++;
        console.log(`[Scheduler] ✅ 向量化完成: ${repo.fullName}`);
      } catch (err: any) {
        failed++;
        console.error(`[Scheduler] ❌ 向量化失败: ${repo.fullName} - ${err.message}`);
      }

      await sleep(1000);
    }

    console.log(`[Scheduler] 🧠 向量化处理完成: 成功 ${success}, 失败 ${failed}`);
  } catch (err: any) {
    console.error("[Scheduler] ❌ processPendingEmbeddings 失败:", err.message);
  }
}

// ============================================================================
// 启动调度器
// ============================================================================

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startScheduler() {
  console.log("[Scheduler] 🚀 调度器启动");

  // 每天凌晨 2:00 刷新过期仓库
  cron.schedule("0 2 * * *", () => {
    refreshStaleRepositories();
  });
  console.log("[Scheduler] ⏰ 已注册: 刷新过期仓库 (每天 02:00)");

  // 每天早上 6:00 发现趋势项目
  cron.schedule("0 6 * * *", () => {
    discoverTrendingRepos();
  });
  console.log("[Scheduler] ⏰ 已注册: 发现趋势项目 (每天 06:00)");

  // 每 30 分钟处理待向量化数据
  cron.schedule("*/30 * * * *", () => {
    processPendingEmbeddings();
  });
  console.log("[Scheduler] ⏰ 已注册: 处理待向量化数据 (每 30 分钟)");
}
