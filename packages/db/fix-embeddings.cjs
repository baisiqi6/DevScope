// 补充缺失的 embedding - CommonJS 版本
require('dotenv/config');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const { eq, isNull, sql } = require('drizzle-orm');

// 创建数据库连接
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 手动定义 schema（避免 octokit 导入问题）
const repoChunks = {
  id: 'id',
  repoId: 'repo_id',
  content: 'content',
  chunkType: 'chunk_type',
  sourceId: 'source_id',
  chunkIndex: 'chunk_index',
  embedding: 'embedding',
  tokenCount: 'token_count',
  createdAt: 'created_at',
  tableName: 'repo_chunks'
};

// BGE Embedding Provider
class BGEEmbeddingProvider {
  constructor() {
    const { OpenAI } = require('openai');
    this.client = new OpenAI({
      baseURL: process.env.BGE_API_URL || 'https://api.siliconflow.cn/v1',
      apiKey: process.env.SILICONFLOW_API_KEY,
    });
    this.defaultModel = process.env.BGE_MODEL_NAME || 'BAAI/bge-m3';
  }

  async embedBatch(texts) {
    const BATCH_SIZE = 10;

    if (texts.length <= BATCH_SIZE) {
      const response = await this.client.embeddings.create({
        model: this.defaultModel,
        input: texts,
      });
      return response.data.sort((a, b) => a.index - b.index).map((data) => data.embedding);
    }

    // 分批处理
    const results = new Array(texts.length).fill(null);
    let successCount = 0;
    let errorCount = 0;
    const RATE_LIMIT_DELAY = 3000;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(texts.length / BATCH_SIZE);
      const batch = texts.slice(i, i + BATCH_SIZE);

      if (batchIndex > 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }

      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          console.log(`处理批次 ${batchIndex}/${totalBatches} (${batch.length} 个文本)...`);

          const response = await this.client.embeddings.create({
            model: this.defaultModel,
            input: batch,
          });

          for (const data of response.data) {
            results[i + data.index] = data.embedding;
            successCount++;
          }
          break;
        } catch (error) {
          retryCount++;
          const isRetryable = error.status === 429 || error.status === 400;

          if (isRetryable && retryCount < maxRetries) {
            const waitTime = retryCount * 5000;
            console.warn(`批次 ${batchIndex} 失败 (重试 ${retryCount}/${maxRetries})，${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            errorCount += batch.length;
            console.warn(`批次 ${batchIndex} 永久失败: ${error.message}`);
            for (let j = 0; j < batch.length; j++) {
              results[i + j] = null;
            }
            break;
          }
        }
      }
    }

    return results;
  }
}

async function fixEmbeddings() {
  const db = drizzle(pool, {});
  const embedder = new BGEEmbeddingProvider();

  console.log('=== 查找缺失的 embeddings ===');

  // 使用原始 SQL 查询
  const result = await db.execute(sql`SELECT * FROM repo_chunks WHERE embedding IS NULL`);
  const missing = result.rows;

  console.log(`找到 ${missing.length} 个缺失 embedding 的记录`);

  if (missing.length === 0) {
    console.log('没有需要修复的数据');
    await pool.end();
    process.exit(0);
  }

  // 按 repo_id 分组
  const byRepo = new Map();
  for (const chunk of missing) {
    if (!byRepo.has(chunk.repo_id)) {
      byRepo.set(chunk.repo_id, []);
    }
    byRepo.get(chunk.repo_id).push(chunk);
  }

  console.log(`涉及 ${byRepo.size} 个仓库`);

  for (const [repoId, chunks] of byRepo.entries()) {
    console.log(`\n处理仓库 ${repoId}，共 ${chunks.length} 个缺失的 chunk...`);

    const texts = chunks.map(c => c.content);
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

          // 更新数据库
          for (let j = 0; j < batchChunks.length; j++) {
            const chunk = batchChunks[j];
            const embedding = embeddings[j];

            if (embedding) {
              const embeddingStr = JSON.stringify(embedding);
              await db.execute(sql`
                UPDATE repo_chunks
                SET embedding = ${embeddingStr}::vector(1024)
                WHERE id = ${chunk.id}
              `);
              successCount++;
            }
          }

          console.log(`  [仓库 ${repoId}] 批次 ${batchIndex} 成功`);
          break;
        } catch (error) {
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
