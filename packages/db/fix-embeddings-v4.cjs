// 补充缺失的 embedding - 过滤空内容版
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../.env') });
const { Pool } = require('pg');
const fs = require('fs');

const logFile = path.join(__dirname, 'fix-embeddings-progress.log');
function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(msg);
  fs.appendFileSync(logFile, line);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
    const BATCH_SIZE = 5;
    const RATE_LIMIT_DELAY = 1500;

    if (texts.length <= BATCH_SIZE) {
      try {
        const response = await this.client.embeddings.create({
          model: this.defaultModel,
          input: texts,
        });
        return response.data.sort((a, b) => a.index - b.index).map((data) => data.embedding);
      } catch (error) {
        log(`API 错误: ${error.message}`);
        return new Array(texts.length).fill(null);
      }
    }

    const results = new Array(texts.length).fill(null);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      const batch = texts.slice(i, i + BATCH_SIZE);

      if (batchIndex > 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }

      try {
        const response = await this.client.embeddings.create({
          model: this.defaultModel,
          input: batch,
        });

        for (const data of response.data) {
          results[i + data.index] = data.embedding;
        }
      } catch (error) {
        log(`批次 ${batchIndex} 失败: ${error.message}`);
      }
    }

    return results;
  }
}

async function fixEmbeddings() {
  const embedder = new BGEEmbeddingProvider();

  log('=== 开始补充缺失的 embeddings ===');
  log('配置: BATCH_SIZE=5, DELAY=1500ms, 过滤空内容');

  // 首先删除或标记空内容的记录
  const { rows: emptyChunks } = await pool.query(
    "SELECT id, repo_id, LENGTH(content) as len FROM repo_chunks WHERE embedding IS NULL AND (content IS NULL OR content = '' OR LENGTH(content) < 10)"
  );

  if (emptyChunks.length > 0) {
    log(`发现 ${emptyChunks.length} 条空内容记录，将跳过这些记录`);
    for (const row of emptyChunks) {
      log(`  跳过 ID ${row.id} (仓库 ${row.repo_id}, 长度 ${row.len})`);
    }
  }

  let processedCount = 0;
  const BATCH_LIMIT = 200;  // 每轮处理 200 条

  while (true) {
    // 只获取有内容的记录
    const { rows: missing } = await pool.query(
      'SELECT * FROM repo_chunks WHERE embedding IS NULL AND LENGTH(content) >= 10 ORDER BY repo_id, id LIMIT $1',
      [BATCH_LIMIT]
    );

    if (missing.length === 0) {
      log('✅ 所有有效内容的 embeddings 已完成！');
      break;
    }

    log(`获取到 ${missing.length} 条待处理记录`);

    // 按 repo_id 分组
    const byRepo = new Map();
    for (const chunk of missing) {
      if (!byRepo.has(chunk.repo_id)) {
        byRepo.set(chunk.repo_id, []);
      }
      byRepo.get(chunk.repo_id).push(chunk);
    }

    for (const [repoId, chunks] of byRepo.entries()) {
      const texts = chunks.map(c => c.content);
      const embeddings = await embedder.embedBatch(texts);

      let successCount = 0;
      let failCount = 0;

      for (let j = 0; j < chunks.length; j++) {
        const chunk = chunks[j];
        const embedding = embeddings[j];

        if (embedding) {
          try {
            const embeddingStr = JSON.stringify(embedding);
            await pool.query(
              'UPDATE repo_chunks SET embedding = $1::vector(1024) WHERE id = $2',
              [embeddingStr, chunk.id]
            );
            successCount++;
          } catch (err) {
            log(`更新失败 (ID ${chunk.id}): ${err.message}`);
            failCount++;
          }
        } else {
          failCount++;
        }
      }

      processedCount += successCount;

      // 检查总进度
      const { rows: stats } = await pool.query(
        'SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL) as done, COUNT(*) as total FROM repo_chunks'
      );
      const percent = ((stats[0].done / stats[0].total) * 100).toFixed(2);
      log(`仓库 ${repoId}: ${successCount} 成功, ${failCount} 失败 | 总进度: ${stats[0].done}/${stats[0].total} (${percent}%) | 已处理: ${processedCount}`);
    }

    log('等待 3 秒后继续...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // 最终统计
  const { rows: finalStats } = await pool.query(
    'SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL) as done, COUNT(*) as total FROM repo_chunks'
  );
  const { rows: stillMissing } = await pool.query(
    'SELECT COUNT(*) as count FROM repo_chunks WHERE embedding IS NULL'
  );

  log(`=== 完成 ===`);
  log(`总进度: ${finalStats[0].done}/${finalStats[0].total} (${((finalStats[0].done / finalStats[0].total) * 100).toFixed(2)}%)`);
  log(`剩余空内容: ${stillMissing[0].count} 条`);

  await pool.end();
}

fixEmbeddings().catch(err => {
  log(`致命错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
