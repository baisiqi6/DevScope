// 补充缺失的 embedding - 智能过滤版
// 跳过空内容和截断的内容片段
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

// 检查内容是否有效
function isValidContent(content) {
  if (!content || typeof content !== 'string') return false;

  const trimmed = content.trim();

  // 过滤条件
  if (trimmed.length < 20) return false;  // 太短
  if (trimmed.length < 100 && !trimmed.includes(' ')) return false;  // 短且无空格（可能是单词片段）
  if (/^[\s\W]+$/.test(trimmed.substring(0, 50))) return false;  // 开头只有特殊字符

  // 检查是否是截断片段（开头或结尾不完整）
  const words = trimmed.split(/\s+/);
  if (words.length > 0) {
    const firstWord = words[0];
    const lastWord = words[words.length - 1];

    // 第一个词以小写字母开头（可能不是句子开头）
    if (firstWord.length > 3 && /^[a-z]/.test(firstWord) && !/^[a-z]{2,}\./.test(firstWord)) {
      // 可能是片段，但不一定拒绝
    }

    // 最后一个词被截断（如 "nd", "ound", "und" 等）
    if (lastWord.length <= 3 && words.length > 5) {
      return false;  // 短结尾词在长文本中可能是截断
    }
  }

  return true;
}

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
  log('配置: BATCH_SIZE=5, DELAY=1500ms, 智能过滤空内容和截断片段');

  let skippedCount = 0;
  let processedCount = 0;
  const BATCH_LIMIT = 200;

  while (true) {
    // 获取所有缺失 embedding 的记录
    const { rows: missing } = await pool.query(
      'SELECT * FROM repo_chunks WHERE embedding IS NULL ORDER BY repo_id, id LIMIT $1',
      [BATCH_LIMIT * 2]  // 多取一些，因为会过滤
    );

    if (missing.length === 0) {
      log('✅ 所有 embeddings 已完成！');
      break;
    }

    // 过滤无效内容
    const validChunks = [];
    for (const chunk of missing) {
      if (isValidContent(chunk.content)) {
        validChunks.push(chunk);
      } else {
        skippedCount++;
        if (skippedCount <= 50) {  // 只记录前 50 条
          log(`跳过 ID ${chunk.id} (长度 ${chunk.content ? chunk.content.length : 0})`);
        }
      }
    }

    if (validChunks.length === 0) {
      log(`本轮 ${missing.length} 条全部被过滤，继续下一批...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }

    // 只处理有效的内容
    const toProcess = validChunks.slice(0, BATCH_LIMIT);
    log(`获取到 ${missing.length} 条待处理，过滤后 ${toProcess.length} 条有效`);

    // 按 repo_id 分组
    const byRepo = new Map();
    for (const chunk of toProcess) {
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
      log(`仓库 ${repoId}: ${successCount} 成功, ${failCount} 失败 | 总进度: ${stats[0].done}/${stats[0].total} (${percent}%) | 已处理: ${processedCount}, 跳过: ${skippedCount}`);
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
  log(`已处理: ${processedCount}, 跳过: ${skippedCount}, 剩余: ${stillMissing[0].count}`);

  await pool.end();
}

fixEmbeddings().catch(err => {
  log(`致命错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
