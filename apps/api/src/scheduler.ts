/**
 * @package @devscope/api
 * @description 定时数据采集调度器
 *
 * 在 API 服务内部集成，共享数据库连接和 Pipeline 代码。
 * 通过环境变量 ENABLE_SCHEDULER=true 启用。
 */

import cron from "node-cron";
import {
  createGithubDiscoveryJobPayload,
  createDb,
  createPipeline,
  enqueueRestartableJob,
  GITHUB_DISCOVERY_JOB,
  GITHUB_DISCOVERY_JOB_KEY,
  GITHUB_TRENDING_SYNC_JOB,
  GITHUB_TRENDING_SYNC_JOB_KEY,
  repositories,
} from "@devscope/db";
import { lt, eq, or, isNull, and } from "drizzle-orm";
import { getOrCreateCurrentUserId } from "./current-user";

// ============================================================================
// 调度器
// ============================================================================

let db: ReturnType<typeof createDb>;
const schedulerTimezone = process.env.SCHEDULER_TIMEZONE || "Asia/Shanghai";

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
export async function refreshStaleRepositories() {
  console.log("[Scheduler] 🔄 开始刷新过期仓库...");

  try {
    const database = getDb();
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 查询超过 24h 未更新的仓库
    const staleRepos = await database
      .select({ id: repositories.id, fullName: repositories.fullName })
      .from(repositories)
      .where(
        and(
          eq(repositories.isReference, false),
          or(
            lt(repositories.lastFetchedAt, staleThreshold),
            isNull(repositories.lastFetchedAt)
          )
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
        const result = await pipeline.runQuick({ repo: repo.fullName });
        if (result.status !== "completed") {
          throw new Error(result.error || "仓库刷新未提交有效快照");
        }
        if (result.warning) {
          console.warn(`[Scheduler] ⚠️ ${repo.fullName} 可选来源告警: ${result.warning}`);
        }
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
 * 创建 GitHub 新项目发现任务
 * 调度：每天早上 6:00
 */
export async function enqueueGithubDiscovery() {
  console.log("[Scheduler] 🔍 开始创建趋势发现任务...");

  try {
    const database = getDb();
    const userId = await getOrCreateCurrentUserId(database);
    const payload = createGithubDiscoveryJobPayload(new Date());
    const { job, enqueued } = await enqueueRestartableJob(database, {
      userId,
      type: GITHUB_DISCOVERY_JOB,
      idempotencyKey: GITHUB_DISCOVERY_JOB_KEY,
      payload,
      maxAttempts: 3,
    });

    console.log(
      `[Scheduler] 🔍 趋势发现任务 #${job.id} ${enqueued ? "已入队" : "正在执行"}`,
    );
  } catch (err: any) {
    console.error("[Scheduler] ❌ enqueueGithubDiscovery 失败:", err.message);
  }
}

/** 每天同步 GitHub 官方 daily / weekly / monthly Trending 快照。 */
export async function enqueueGithubTrendingSync() {
  console.log("[Scheduler] 📈 开始创建 GitHub Trending 同步任务...");

  try {
    const database = getDb();
    const userId = await getOrCreateCurrentUserId(database);
    const requestedAt = new Date();
    const { job, enqueued } = await enqueueRestartableJob(database, {
      userId,
      type: GITHUB_TRENDING_SYNC_JOB,
      idempotencyKey: GITHUB_TRENDING_SYNC_JOB_KEY,
      payload: {
        requestedAt: requestedAt.toISOString(),
        snapshotDate: requestedAt.toISOString().slice(0, 10),
        language: "all",
        periods: ["daily", "weekly", "monthly"],
      },
      maxAttempts: 3,
    });

    console.log(
      `[Scheduler] 📈 Trending 任务 #${job.id} ${enqueued ? "已入队" : "正在执行"}`,
    );
  } catch (err: any) {
    console.error("[Scheduler] ❌ enqueueGithubTrendingSync 失败:", err.message);
  }
}

/**
 * 处理待向量化数据
 * 调度：每 30 分钟
 */
export async function processPendingEmbeddings() {
  console.log("[Scheduler] 🧠 开始处理待向量化数据...");

  try {
    const database = getDb();

    // 查询 embeddingStatus = 'pending' 的仓库
    const pendingRepos = await database
      .select({
        id: repositories.id,
        fullName: repositories.fullName,
        updatedAt: repositories.updatedAt,
      })
      .from(repositories)
      .where(
        and(
          eq(repositories.isReference, false),
          eq(repositories.embeddingStatus, "pending")
        )
      )
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
        const outcome = await pipeline.runEmbeddingsInBackground(repo.id, repo.updatedAt);
        if (outcome.status === "applied") {
          success++;
          console.log(`[Scheduler] ✅ 向量化完成: ${repo.fullName}`);
        } else {
          failed++;
          console.warn(`[Scheduler] ⚠️ 向量化未应用: ${repo.fullName} (${outcome.status})`);
        }
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
  cron.schedule(
    "0 2 * * *",
    () => {
      refreshStaleRepositories();
    },
    { timezone: schedulerTimezone }
  );
  console.log(
    `[Scheduler] ⏰ 已注册: 刷新过期仓库 (每天 02:00 ${schedulerTimezone})`
  );

  cron.schedule(
    "15 6 * * *",
    () => {
      void enqueueGithubTrendingSync();
    },
    { timezone: schedulerTimezone },
  );
  console.log(
    `[Scheduler] ⏰ 已注册: GitHub Trending 同步 (每天 06:15 ${schedulerTimezone})`,
  );

  // 每天早上 6:00 发现趋势项目
  cron.schedule(
    "0 6 * * *",
    () => {
      void enqueueGithubDiscovery();
    },
    { timezone: schedulerTimezone }
  );
  console.log(
    `[Scheduler] ⏰ 已注册: 创建趋势发现任务 (每天 06:00 ${schedulerTimezone})`
  );

  // 每 30 分钟处理待向量化数据
  cron.schedule(
    "*/30 * * * *",
    () => {
      processPendingEmbeddings();
    },
    { timezone: schedulerTimezone }
  );
  console.log(
    `[Scheduler] ⏰ 已注册: 处理待向量化数据 (每 30 分钟, ${schedulerTimezone})`
  );
}
