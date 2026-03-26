// 补充缺失的 embedding - 优化版
// 基于调查结果：
// - BGE-M3 单条最大 8192 tokens（我们的数据最大约 667，安全）
// - 硅基流动 API 速率限制 2000-10000 RPM（充值后）
// - 400 错误可能是批次大小限制，尝试减小批次
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../.env') });
const { Pool } = require('pg');

// 创建数据库连接
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// BGE Embedding Provider - 优化版
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
    // 减小批次大小以避免可能的 API 限制
    const BATCH_SIZE = 5;  // 从 10 降到 5
    const RATE_LIMIT_DELAY = 1000;  // 从 3000ms 降到 1000ms

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
          const isRetryable = error.status === 429 || error.status === 400 || error.status === 413;

          if (isRetryable && retryCount < maxRetries) {
            const waitTime = retryCount * 3000;  // 3s, 6s, 9s
            console.warn(`批次 ${batchIndex}/${totalBatches} 失败 (重试 ${retryCount}/${maxRetries}): ${error.message}，${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            console.warn(`批次 ${batchIndex}/${totalBatches} 永久失败: ${error.message}`);
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
  const failedIds = new Set();

  console.log('=== 查找缺失的 embeddings ===');

  const { rows: missing } = await pool.query(
    'SELECT * FROM repo_chunks WHERE embedding IS NULL ORDER BY repo_id, id'
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
  console.log(`配置: BATCH_SIZE=5, DELAY=1000ms\n`);

  const startTime = Date.now();
  let totalSuccess = 0;
  let totalFailed = 0;

  // 第一轮：处理所有缺失的 embeddings
  for (const [repoId, chunks] of byRepo.entries()) {
    console.log(`\n[${new Date().toLocaleTimeString()}] 处理仓库 ${repoId}，共 ${chunks.length} 个缺失的 chunk...`);

    const texts = chunks.map(c => c.content);
    const BATCH_SIZE = 5;
    const RATE_LIMIT_DELAY = 1000;

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
              failedIds.add(chunk.id);
              errorCount++;
            }
          }

          break;
        } catch (error) {
          retryCount++;
          const isRetryable = error.status === 429 || error.status === 400 || error.status === 413;

          if (isRetryable && retryCount < maxRetries) {
            const waitTime = retryCount * 3000;
            console.warn(`  [仓库 ${repoId}] 批次 ${batchIndex} 失败 (重试 ${retryCount}/${maxRetries})，${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            for (const chunk of batchChunks) {
              failedIds.add(chunk.id);
            }
            errorCount += batchChunks.length;
            console.warn(`  [仓库 ${repoId}] 批次 ${batchIndex} 永久失败: ${error.message}`);
            break;
          }
        }
      }

      // 每 10 批显示一次进度
      if (batchIndex % 10 === 0 || batchIndex === totalBatches) {
        const processed = i + batchChunks.length;
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        const rate = (totalSuccess / elapsed).toFixed(1);
        console.log(`  >>> 仓库 ${repoId} 进度: ${processed}/${texts.length} (本次: ${successCount} 成功, ${errorCount} 失败) | 全局: ${totalSuccess + successCount} 成功, ${totalFailed + errorCount} 失败 | 速率: ${rate} 条/分钟`);
      }
    }

    totalSuccess += successCount;
    totalFailed += errorCount;
    console.log(`[仓库 ${repoId}] 完成: ${successCount} 成功, ${errorCount} 失败`);
  }

  // 第二轮：重试失败的记录
  if (failedIds.size > 0) {
    console.log(`\n=== 开始重试失败的 ${failedIds.size} 条记录 ===`);

    const { rows: failedChunks } = await pool.query(
      'SELECT * FROM repo_chunks WHERE id = ANY($1)',
      [Array.from(failedIds)]
    );

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
      const BATCH_SIZE = 3;  // 重试时使用更小的批次
      const RATE_LIMIT_DELAY = 2000;

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + BATCH_SIZE);
        const batchTexts = texts.slice(i, i + BATCH_SIZE);

        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }

        try {
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
        } catch (error) {
          console.warn(`  [重试] 仓库 ${repoId} 批次失败: ${error.message}`);
          totalRetryFailed += batchChunks.length;
        }
      }
    }

    console.log(`\n=== 重试完成: ${totalRetrySuccess} 成功, ${totalRetryFailed} 仍然失败 ===`);
  }

  const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n=== 全部完成 ===`);
  console.log(`总耗时: ${elapsedMinutes} 分钟`);
  console.log(`总成功: ${totalSuccess} 条`);
  console.log(`总失败: ${totalFailed} 条`);
  console.log(`成功率: ${((totalSuccess / (totalSuccess + totalFailed)) * 100).toFixed(2)}%`);

  await pool.end();
  process.exit(0);
}

fixEmbeddings().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
