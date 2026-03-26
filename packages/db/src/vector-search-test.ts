/**
 * @package @devscope/db
 * @description 向量召回测试脚本
 *
 * 演示如何使用 pgvector 进行语义搜索
 */

import { createDb, semanticSearchRepoChunks, getRepositoryByFullName } from "./index";
import { BGEEmbeddingProvider } from "@devscope/ai";

async function testVectorSearch() {
  console.log("=== 向量召回测试 ===\n");

  // 1. 初始化
  const db = createDb();
  const embedder = new BGEEmbeddingProvider();

  // 2. 测试查询
  const testQueries = [
    "如何使用 React Hooks？",
    "TypeScript 类型定义",
    "部署到生产环境",
    "性能优化技巧",
  ];

  // 3. 获取一个测试仓库
  const repository = await getRepositoryByFullName(db, "facebook/react");
  if (!repository) {
    console.log("⚠️  仓库 facebook/react 未找到，请先采集数据");
    console.log("运行: pnpm --filter @devscope/api dev");
    console.log("然后调用 collectRepository 接口采集数据");
    return;
  }

  console.log(`📦 仓库: ${repository.fullName}`);
  console.log(`⭐ Stars: ${repository.stars}`);
  console.log(`📝 描述: ${repository.description || "N/A"}\n`);

  // 4. 执行向量召回
  for (const query of testQueries) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔍 查询: "${query}"`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const startTime = Date.now();

    // 生成查询向量
    const queryEmbedding = await embedder.embed(query);
    console.log(`📐 查询向量维度: ${queryEmbedding.length}`);

    // 执行语义搜索
    const chunks = await semanticSearchRepoChunks(
      db,
      repository.id,
      queryEmbedding,
      3 // 返回 top 3
    );

    const duration = Date.now() - startTime;

    console.log(`⏱️  耗时: ${duration}ms`);
    console.log(`📊 找到 ${chunks.length} 个相关分块:\n`);

    // 显示结果
    chunks.forEach((chunk, index) => {
      const score = chunk.embedding ? calculateSimilarity(queryEmbedding, chunk.embedding as number[]) : "N/A";
      console.log(`  [${index + 1}] 类型: ${chunk.chunkType} | 相似度: ${typeof score === 'number' ? score.toFixed(4) : score}`);
      console.log(`      来源: ${chunk.sourceId || "N/A"}`);
      console.log(`      内容: ${chunk.content.slice(0, 100)}...`);
      console.log("");
    });
  }

  console.log("\n✅ 测试完成");
}

/**
 * 计算余弦相似度
 */
function calculateSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error("Vector dimensions must match");
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// 运行测试
testVectorSearch().catch(console.error);
