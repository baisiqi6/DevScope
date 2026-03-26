// 补充缺失的 embedding - 使用已构建的包
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, isNull } from 'drizzle-orm';

// 直接导入 schema 定义
import { repoChunks } from './packages/db/dist/index.mjs';
import { BGEEmbeddingProvider } from './packages/ai/dist/index.mjs';

async function fixEmbeddings() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema: { repoChunks } });
  const embedder = new BGEEmbeddingProvider();

  console.log('=== 查找缺失的 embeddings ===');

  const missing = await db
    .select()
    .from(repoChunks)
    .where(isNull(repoChunks.embedding));

  console.log(`找到 ${missing.length} 个缺失 embedding 的记录`);

  if (missing.length === 0) {
    console.log('没有需要修复的数据');
    await pool.end();
    process.exit(0);
  }

  const byRepo = new Map();
  for (const chunk of missing) {
    if (!byRepo.has(chunk.repoId)) {
      byRepo.set(chunk.repoId, []);
    }
    byRepo.get(chunk.repoId).push(chunk);
  }

  console.log(`涉及 ${byRepo.size} 个仓库`);

  for (const [repoId, chunks] of byRepo.entries()) {
    console.log(`\n处理仓库 ${repoId}，共 ${chunks.length} 个缺失的 chunk...`);

    const texts = chunks.map((c: any) => c.content);
    const BATCH_SIZE = 10;
    const RATE_LIMIT_DELAY = 3000;

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(texts.length / BATCH_SIZE);
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);
      const batchTexts = texts.slice(i, i + BATCH_SIZE);

      if (batchIndex > 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }

      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          console.log(`  [仓库 ${repoId}] 批次 ${batchIndex}/${totalBatches} (${batchTexts.length} 个文本)...`);

          const embeddings = await embedder.embedBatch(batchTexts);

          for (let j = 0; j < batchChunks.length; j++) {
            const chunk = batchChunks[j];
            const embedding = embeddings[j];

            await db
              .update(repoChunks)
              .set({ embedding: JSON.stringify(embedding) })
              .where(eq(repoChunks.id, chunk.id));
          }

          successCount += batchChunks.length;
          console.log(`  [仓库 ${repoId}] 批次 ${batchIndex} 成功: ${batchChunks.length} 个 embedding`);
          break;
        } catch (error: any) {
          retryCount++;
          const isRetryable = error.status === 429 || error.status === 400;

          if (isRetryable && retryCount < maxRetries) {
            const waitTime = retryCount * 5000;
            console.warn(`  [仓库 ${repoId}] 批次 ${batchIndex} 失败 (重试 ${retryCount}/${maxRetries})，${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            errorCount += batchChunks.length;
            console.warn(`  [仓库 ${repoId}] 批次 ${batchIndex} 永久失败: ${error.message}`);
            break;
          }
        }
      }
    }

    console.log(`[仓库 ${repoId}] 完成: ${successCount} 成功, ${errorCount} 失败`);
  }

  console.log('\n=== 完成 ===');
  await pool.end();
  process.exit(0);
}

fixEmbeddings().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
