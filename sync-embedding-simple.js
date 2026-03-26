/**
 * 同步向量化状态脚本 (简化版)
 * 运行方式: node sync-embedding-simple.js
 */

const postgres = require('postgres');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/devscope';
const sql = postgres(connectionString);

async function syncAll() {
  try {
    console.log('开始同步向量化状态...\n');

    // 获取所有仓库及其向量化状态
    const repos = await sql`
      SELECT
        id,
        full_name,
        embedding_status,
        embedding_progress,
        embedding_total_chunks,
        embedding_completed_chunks
      FROM repositories
      ORDER BY id
    `;

    console.log(`找到 ${repos.length} 个仓库\n`);

    let updatedCount = 0;
    let completedCount = 0;
    let partialCount = 0;
    let alreadyCompletedCount = 0;

    for (const repo of repos) {
      // 统计该仓库的 chunks
      const chunksResult = await sql`
        SELECT
          COUNT(*) as total_chunks,
          COUNT(embedding) as with_embedding
        FROM repo_chunks
        WHERE repo_id = ${repo.id}
      `;

      const { total_chunks, with_embedding } = chunksResult[0];

      if (total_chunks == 0) {
        console.log(`○ ${repo.full_name}: 没有 chunks 数据`);
        continue;
      }

      const progress = Math.floor((with_embedding / total_chunks) * 100);

      // 判断是否需要更新
      if (with_embedding == total_chunks && repo.embedding_status !== 'completed') {
        // 全部完成 - 更新为 completed
        await sql`
          UPDATE repositories
          SET
            embedding_status = 'completed',
            embedding_progress = 100,
            embedding_total_chunks = ${total_chunks},
            embedding_completed_chunks = ${with_embedding},
            embedding_completed_at = NOW(),
            embedding_error = NULL
          WHERE id = ${repo.id}
        `;

        console.log(`✓ ${repo.full_name}: 已完成 (${with_embedding}/${total_chunks} chunks)`);
        updatedCount++;
        completedCount++;

      } else if (with_embedding > 0 && repo.embedding_status === 'pending') {
        // 有部分数据 - 更新为 processing
        await sql`
          UPDATE repositories
          SET
            embedding_status = 'processing',
            embedding_progress = ${progress},
            embedding_total_chunks = ${total_chunks},
            embedding_completed_chunks = ${with_embedding}
          WHERE id = ${repo.id}
        `;

        console.log(`⚠ ${repo.full_name}: 部分完成 ${progress}% (${with_embedding}/${total_chunks} chunks)`);
        updatedCount++;
        partialCount++;

      } else if (repo.embedding_status === 'completed') {
        console.log(`- ${repo.full_name}: 已是完成状态 (${with_embedding}/${total_chunks} chunks)`);
        alreadyCompletedCount++;

      } else {
        console.log(`○ ${repo.full_name}: ${repo.embedding_status} (${with_embedding}/${total_chunks} chunks)`);
      }
    }

    console.log(`\n=== 总结 ===`);
    console.log(`总仓库数: ${repos.length}`);
    console.log(`更新数量: ${updatedCount}`);
    console.log(`  - 新完成: ${completedCount}`);
    console.log(`  - 部分完成: ${partialCount}`);
    console.log(`已完成状态: ${alreadyCompletedCount}`);

  } catch (error) {
    console.error('错误:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

syncAll().then(() => process.exit(0));
