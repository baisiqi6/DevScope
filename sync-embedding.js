/**
 * 同步向量化状态脚本
 * 运行方式: node sync-embedding.js
 */

const { createClient } = require('@anthropic-ai/sdk');
const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');

// 从编译后的模块导入
const { repositories, repoChunks } = require('./packages/db/dist/index.mjs');

// Drizzle eq 函数需要手动导入或使用内联
function eq(column, value) {
  return { column, value, op: 'eq' };
}

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/devscope');
const db = drizzle(sql);

async function syncAll() {
  try {
    console.log('开始同步向量化状态...\n');

    // 获取所有仓库
    const allRepos = await db.select({
      id: repositories.id,
      fullName: repositories.fullName,
      embeddingStatus: repositories.embeddingStatus,
      embeddingProgress: repositories.embeddingProgress,
    }).from(repositories);

    console.log(`找到 ${allRepos.length} 个仓库\n`);

    let updatedCount = 0;
    let completedCount = 0;
    let partialCount = 0;

    for (const repo of allRepos) {
      // 统计该仓库的 chunks
      const allChunks = await db
        .select({ embedding: repoChunks.embedding })
        .from(repoChunks)
        .where(eq(repoChunks.repoId, repo.id));

      const totalChunks = allChunks.length;
      const withEmbedding = allChunks.filter((c) => c.embedding !== null && c.embedding !== undefined).length;

      if (totalChunks === 0) continue;

      const progress = Math.floor((withEmbedding / totalChunks) * 100);

      // 判断是否需要更新
      if (withEmbedding === totalChunks && repo.embeddingStatus !== 'completed') {
        // 全部完成
        await db.update(repositories)
          .set({
            embeddingStatus: 'completed',
            embeddingProgress: 100,
            embeddingTotalChunks: totalChunks,
            embeddingCompletedChunks: totalChunks,
            embeddingCompletedAt: new Date(),
            embeddingError: null,
          })
          .where(eq(repositories.id, repo.id));

        console.log(`✓ ${repo.fullName}: 已完成 (${withEmbedding}/${totalChunks} chunks)`);
        updatedCount++;
        completedCount++;

      } else if (withEmbedding > 0 && repo.embeddingStatus === 'pending') {
        // 有部分数据
        await db.update(repositories)
          .set({
            embeddingStatus: 'processing',
            embeddingProgress: progress,
            embeddingTotalChunks: totalChunks,
            embeddingCompletedChunks: withEmbedding,
          })
          .where(eq(repositories.id, repo.id));

        console.log(`⚠ ${repo.fullName}: 部分完成 ${progress}% (${withEmbedding}/${totalChunks} chunks)`);
        updatedCount++;
        partialCount++;

      } else if (repo.embeddingStatus === 'completed') {
        console.log(`- ${repo.fullName}: 已是完成状态`);

      } else {
        console.log(`○ ${repo.fullName}: ${repo.embeddingStatus} (${withEmbedding}/${totalChunks} chunks)`);
      }
    }

    console.log(`\n=== 总结 ===`);
    console.log(`总仓库数: ${allRepos.length}`);
    console.log(`更新数量: ${updatedCount}`);
    console.log(`完成数量: ${completedCount}`);
    console.log(`部分完成: ${partialCount}`);

  } catch (error) {
    console.error('错误:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

syncAll().then(() => process.exit(0));
