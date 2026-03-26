// 补充缺失的 embedding - 支持失败后重试
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../.env') });
const { Pool } = require('pg');

// 创建数据库连接
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
    const RATE_LIMIT_DELAY = 3000;

    if (texts.length <= BATCH_SIZE) {
      const response = await this.client.embeddings.create({
        model: this.defaultModel,
        input: texts,
      });
      return response.data.sort((a, b) => a.index - b.index).map((data) => data.embedding);
    }

    const results = new Array(texts.length).fill(null);

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
          const response = await this.client.embeddings.create({
            model: this.defaultModel,
            input: batch,
          });

          for (const data of response.data) {
            results[i + data.index] = data.embedding;
          }
          break;
        } catch (error) {
          retryCount++;
          const isRetryable = error.status === 429 || error.status === 400;

          if (isRetryable && retryCount < maxRetries) {
            const waitTime = retryCount * 5000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
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
  const embedder = new BGEEmbeddingProvider();
  const failedIds = new Set(); // 记录失败的 chunk ID

  console.log('=== 查找缺失的 embeddings ===');

  // 使用 pg 客户端直接查询
  const { rows: missing } = await pool.query(
    'SELECT * FROM repo_chunks WHERE embedding IS NULL'
  );

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

  // 第一轮：处理所有缺失的 embeddings
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
              await pool.query(
                'UPDATE repo_chunks SET embedding = $1::vector(1024) WHERE id = $2',
                [embeddingStr, chunk.id]
              );
              successCount++;
            } else {
              // 记录失败的 ID
              failedIds.add(chunk.id);
              errorCount++;
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
            // 批次完全失败，记录所有 ID
            for (const chunk of batchChunks) {
              failedIds.add(chunk.id);
            }
            errorCount += batchChunks.length;
            console.warn(`  [仓库 ${repoId}] 批次 ${batchIndex} 永久失败: ${error.message}`);
            break;
          }
        }
      }

      // 每 5 批显示一次进度
      if (batchIndex % 5 === 0 || batchIndex === totalBatches) {
        const processed = i + batchChunks.length;
        console.log(`>>> 进度: ${processed}/${texts.length} (${successCount} 成功, ${errorCount} 失败)`);
      }
    }

    console.log(`[仓库 ${repoId}] 完成: ${successCount} 成功, ${errorCount} 失败`);
  }

  // 第二轮：重试失败的记录
  if (failedIds.size > 0) {
    console.log(`\n=== 开始重试失败的 ${failedIds.size} 条记录 ===`);

    // 获取失败记录的详细信息
    const { rows: failedChunks } = await pool.query(
      'SELECT * FROM repo_chunks WHERE id = ANY($1)',
      [Array.from(failedIds)]
    );

    console.log(`准备重试 ${failedChunks.length} 条记录...`);

    // 按 repo_id 重新分组
    const failedByRepo = new Map();
    for (const chunk of failedChunks) {
      if (!failedByRepo.has(chunk.repo_id)) {
        failedByRepo.set(chunk.repo_id, []);
      }
      failedByRepo.get(chunk.repo_id).push(chunk);
    }

    let totalRetrySuccess = 0;
    let totalRetryFailed = 0;

    for (const [repoId, chunks] of failedByRepo.entries()) {
      console.log(`\n重试仓库 ${repoId}，共 ${chunks.length} 个失败的 chunk...`);

      const texts = chunks.map(c => c.content);
      const BATCH_SIZE = 10;
      const RATE_LIMIT_DELAY = 5000; // 重试时使用更长延迟

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(texts.length / BATCH_SIZE);
        const batchChunks = chunks.slice(i, i + BATCH_SIZE);
        const batchTexts = texts.slice(i, i + BATCH_SIZE);

        if (batchIndex > 1) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }

        try {
          console.log(`  [重试] 仓库 ${repoId} 批次 ${batchIndex}/${totalBatches}...`);

          const embeddings = await embedder.embedBatch(batchTexts);

          for (let j = 0; j < batchChunks.length; j++) {
            const chunk = batchChunks[j];
            const embedding = embeddings[j];

            if (embedding) {
              const embeddingStr = JSON.stringify(embedding);
              await pool.query(
                'UPDATE repo_chunks SET embedding = $1::vector(1024) WHERE id = $2',
                [embeddingStr, chunk.id]
              );
              totalRetrySuccess++;
            } else {
              totalRetryFailed++;
            }
          }

          console.log(`  [重试] 仓库 ${repoId} 批次 ${batchIndex} 成功`);
        } catch (error) {
          console.warn(`  [重试] 仓库 ${repoId} 批次 ${batchIndex} 失败: ${error.message}`);
          totalRetryFailed += batchChunks.length;
        }
      }
    }

    console.log(`\n=== 重试完成: ${totalRetrySuccess} 成功, ${totalRetryFailed} 仍然失败 ===`);
  }

  console.log('\n=== 全部完成 ===');
  await pool.end();
  process.exit(0);
}

fixEmbeddings().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
