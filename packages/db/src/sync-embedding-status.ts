/**
 * @package @devscope/db
 * @description 同步向量化状态
 *
 * 检查 repo_chunks 表中已有的 embedding 数据，更新 repositories 表的状态字段
 */

import { createDb, repositories, repoChunks } from "./index";
import { eq } from "drizzle-orm";

/**
 * 同步指定仓库的向量化状态
 * 根据 repo_chunks 表中已有的 embedding 数据更新 repositories 表
 */
export async function syncEmbeddingStatus(repoId: number) {
  const db = createDb();

  // 查询仓库信息
  const repoList = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      embeddingStatus: repositories.embeddingStatus,
      embeddingProgress: repositories.embeddingProgress,
      embeddingTotalChunks: repositories.embeddingTotalChunks,
    })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);

  const repo = repoList[0];
  if (!repo) {
    console.log(`Repository ${repoId} not found`);
    return;
  }

  console.log(`\n=== Checking repository: ${repo.fullName} (ID: ${repoId}) ===`);
  console.log(`Current status: ${repo.embeddingStatus}, progress: ${repo.embeddingProgress}%`);

  // 统计该仓库的 chunks 数量
  const chunksStats = await db
    .select({
      totalChunks: { count: repoChunks.id },
      withEmbedding: { count: repoChunks.embedding }, // 会有 null，需要过滤
    })
    .from(repoChunks)
    .where(eq(repoChunks.repoId, repoId));

  const totalChunks = Number(chunksStats[0]?.totalChunks || 0);

  // 统计有 embedding 的 chunks 数量
  const chunksWithEmbedding = await db
    .select({ count: repoChunks.id })
    .from(repoChunks)
    .where(eq(repoChunks.repoId, repoId));

  // 简单方式：查询所有 chunks，然后在内存中过滤
  const allChunks = await db
    .select({ embedding: repoChunks.embedding })
    .from(repoChunks)
    .where(eq(repoChunks.repoId, repoId));

  const withEmbedding = allChunks.filter((c) => c.embedding !== null && c.embedding !== undefined).length;
  const withoutEmbedding = totalChunks - withEmbedding;

  console.log(`Total chunks: ${totalChunks}`);
  console.log(`With embedding: ${withEmbedding}`);
  console.log(`Without embedding: ${withoutEmbedding}`);

  // 判断是否需要更新状态
  if (totalChunks === 0) {
    console.log(`No chunks found, skipping...`);
    return;
  }

  if (withEmbedding === totalChunks) {
    // 所有 chunks 都有 embedding，标记为完成
    console.log(`✓ All chunks have embeddings, marking as completed...`);
    await db
      .update(repositories)
      .set({
        embeddingStatus: "completed",
        embeddingProgress: 100,
        embeddingTotalChunks: totalChunks,
        embeddingCompletedChunks: totalChunks,
        embeddingCompletedAt: new Date(),
        embeddingError: null,
      })
      .where(eq(repositories.id, repoId));
    console.log(`✓ Updated to completed`);
  } else if (withEmbedding > 0) {
    // 部分有 embedding
    const progress = Math.floor((withEmbedding / totalChunks) * 100);
    console.log(`⚠ Partial embeddings (${progress}%), updating progress...`);
    await db
      .update(repositories)
      .set({
        embeddingStatus: "processing",
        embeddingProgress: progress,
        embeddingTotalChunks: totalChunks,
        embeddingCompletedChunks: withEmbedding,
      })
      .where(eq(repositories.id, repoId));
    console.log(`✓ Updated progress to ${progress}%`);
  } else {
    // 没有 embedding
    console.log(`⚠ No embeddings found, status remains pending`);
  }
}

/**
 * 同步所有仓库的向量化状态
 */
export async function syncAllEmbeddingStatus() {
  const db = createDb();

  // 获取所有仓库
  const allRepos = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      embeddingStatus: repositories.embeddingStatus,
      embeddingProgress: repositories.embeddingProgress,
    })
    .from(repositories);

  console.log(`Found ${allRepos.length} repositories\n`);

  let updatedCount = 0;
  let completedCount = 0;

  for (const repo of allRepos) {
    // 统计该仓库的 chunks
    const allChunks = await db
      .select({ embedding: repoChunks.embedding })
      .from(repoChunks)
      .where(eq(repoChunks.repoId, repo.id));

    const totalChunks = allChunks.length;
    const withEmbedding = allChunks.filter((c) => c.embedding !== null && c.embedding !== undefined).length;

    if (totalChunks === 0) continue;

    let shouldUpdate = false;
    const updateData: any = {};

    if (withEmbedding === totalChunks && repo.embeddingStatus !== "completed") {
      // 全部完成
      updateData.embeddingStatus = "completed";
      updateData.embeddingProgress = 100;
      updateData.embeddingTotalChunks = totalChunks;
      updateData.embeddingCompletedChunks = totalChunks;
      updateData.embeddingCompletedAt = new Date();
      updateData.embeddingError = null;
      shouldUpdate = true;
      completedCount++;
    } else if (withEmbedding > 0 && repo.embeddingStatus === "pending") {
      // 有部分数据，更新为 processing
      const progress = Math.floor((withEmbedding / totalChunks) * 100);
      updateData.embeddingStatus = "processing";
      updateData.embeddingProgress = progress;
      updateData.embeddingTotalChunks = totalChunks;
      updateData.embeddingCompletedChunks = withEmbedding;
      shouldUpdate = true;
    } else if (withEmbedding === 0 && repo.embeddingStatus === "pending") {
      // 没有 embedding，如果 chunks 存在则说明可能需要处理
      updateData.embeddingTotalChunks = totalChunks;
      shouldUpdate = true;
    }

    if (shouldUpdate) {
      await db
        .update(repositories)
        .set(updateData)
        .where(eq(repositories.id, repo.id));
      updatedCount++;

      const status = updateData.embeddingStatus || repo.embeddingStatus;
      const progress = updateData.embeddingProgress || repo.embeddingProgress;
      console.log(`✓ ${repo.fullName}: ${status} (${progress}%)`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total repositories: ${allRepos.length}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Completed: ${completedCount}`);
}

// CLI 运行
if (require.main === module) {
  const args = process.argv.slice(2);
  const repoId = args[0] ? parseInt(args[0], 10) : null;

  (async () => {
    if (repoId) {
      await syncEmbeddingStatus(repoId);
    } else {
      await syncAllEmbeddingStatus();
    }
    process.exit(0);
  })();
}
