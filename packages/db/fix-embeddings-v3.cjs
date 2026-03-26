// 补充缺失的 embedding - 稳定版
// 特点：更保守的参数 + 更好的错误处理 + 日志持续写入
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../.env') });
const { Pool } = require('pg');
const fs = require('fs');

// 日志函数
const logFile = path.join(__dirname, 'fix-embeddings-progress.log');
function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(msg);
  fs.appendFileSync(logFile, line);
}

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
    // 更保守的参数
    const BATCH_SIZE = 3;  // 减少到 3
    const RATE_LIMIT_DELAY = 2000;  // 增加到 2 秒

    if (texts.length <= BATCH_SIZE) {
      try {
        const response = await this.client.embeddings.create({
          model: this.defaultModel,
          input: texts,
        });
        return response.data.sort((a, b) => a.index - b.index).map((data) => data.embedding);
      } catch (error) {
        log(`单批请求失败: ${error.message}`);
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
        // 继续处理下一批，不中断
      }
    }

    return results;
  }
}

async function fixEmbeddings() {
  const embedder = new BGEEmbeddingProvider();

  log('=== 开始补充缺失的 embeddings ===');
  log('配置: BATCH_SIZE=3, DELAY=2000ms');

  while (true) {
    const { rows: missing } = await pool.query(
      'SELECT * FROM repo_chunks WHERE embedding IS NULL ORDER BY repo_id, id LIMIT 100'
    );

    if (missing.length === 0) {
      log('✅ 所有 embeddings 已完成！');
      break;
    }

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
            log(`更新数据库失败 (ID ${chunk.id}): ${err.message}`);
          }
        }
      }

      // 检查总进度
      const { rows: stats } = await pool.query(
        'SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL) as done, COUNT(*) as total FROM repo_chunks'
      );
      const percent = ((stats[0].done / stats[0].total) * 100).toFixed(2);
      log(`仓库 ${repoId}: ${successCount}/${chunks.length} 成功 | 总进度: ${stats[0].done}/${stats[0].total} (${percent}%)`);
    }

    // 每处理 100 条后暂停一下
    log('等待 5 秒后继续...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  await pool.end();
  log('=== 全部完成 ===');
}

fixEmbeddings().catch(err => {
  log(`致命错误: ${err.message}`);
  process.exit(1);
});
