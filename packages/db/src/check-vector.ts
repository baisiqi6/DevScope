/**
 * 检查 pgvector 扩展和向量数据
 */

import { createDb } from "./index";
import { repoChunks, documents } from "./schema";
import { sql } from "drizzle-orm";
import pkg from "pg";
const { Pool } = pkg;

async function checkVectorData() {
  console.log("=== pgvector 数据检查 ===\n");

  // 使用原生 pg 连接检查扩展
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/devscope",
  });

  try {
    // 1. 检查 pgvector 扩展是否安装
    console.log("1️⃣ 检查 pgvector 扩展...");
    const extResult = await pool.query(`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname = 'vector'
    `);

    if (extResult.rows.length > 0) {
      console.log("   ✅ pgvector 扩展已安装");
      console.log(`   版本: ${extResult.rows[0].extversion}`);
    } else {
      console.log("   ❌ pgvector 扩展未安装");
      console.log("   运行: CREATE EXTENSION vector;");
    }

    // 2. 检查 vector 类型是否存在
    console.log("\n2️⃣ 检查 vector 类型...");
    const typeResult = await pool.query(`
      SELECT typname, typlen
      FROM pg_type
      WHERE typname = 'vector'
    `);

    if (typeResult.rows.length > 0) {
      console.log("   ✅ vector 类型存在");
      console.log(`   类型长度: ${typeResult.rows[0].typlen}`);
    } else {
      console.log("   ❌ vector 类型不存在");
    }

    // 3. 查询带有向量字段的表
    console.log("\n3️⃣ 检查向量字段...");

    const tables = await pool.query(`
      SELECT
        table_name,
        column_name,
        udt_name
      FROM information_schema.columns
      WHERE udt_name = 'vector'
      ORDER BY table_name, column_name
    `);

    if (tables.rows.length > 0) {
      console.log(`   找到 ${tables.rows.length} 个向量字段:`);
      tables.rows.forEach((row) => {
        console.log(`   - ${row.table_name}.${row.column_name}`);
      });
    } else {
      console.log("   ⚠️  没有找到向量字段");
    }

    // 4. 使用 Drizzle 查询向量数据
    console.log("\n4️⃣ 查询 repo_chunks 表的向量数据...");
    const db = createDb();

    const chunksWithEmbeddings = await db
      .select({
        id: repoChunks.id,
        content: repoChunks.content,
        chunkType: repoChunks.chunkType,
        embedding: repoChunks.embedding,
      })
      .from(repoChunks)
      .where(sql`${repoChunks.embedding} IS NOT NULL`)
      .limit(3);

    console.log(`   找到 ${chunksWithEmbeddings.length} 条有向量的记录:`);

    chunksWithEmbeddings.forEach((chunk) => {
      const embedding = chunk.embedding as number[];
      console.log(`\n   [ID: ${chunk.id}] ${chunk.chunkType}`);
      console.log(`   内容: ${chunk.content.slice(0, 60)}...`);
      if (embedding && embedding.length > 0) {
        console.log(`   向量维度: ${embedding.length}`);
        console.log(`   前5个值: [${embedding.slice(0, 5).map(v => v.toFixed(6)).join(", ")}...]`);
      } else {
        console.log(`   向量: NULL 或空数组`);
      }
    });

    // 5. 统计向量数据
    console.log("\n5️⃣ 向量数据统计...");

    const chunkStats = await db
      .select({
        total: sql<number>`count(*)`,
        withEmbedding: sql<number>`count(*) FILTER (WHERE embedding IS NOT NULL)`,
        withoutEmbedding: sql<number>`count(*) FILTER (WHERE embedding IS NULL)`,
      })
      .from(repoChunks);

    console.log(`   repo_chunks 表:`);
    console.log(`   - 总记录数: ${chunkStats[0].total}`);
    console.log(`   - 有向量: ${chunkStats[0].withEmbedding}`);
    console.log(`   - 无向量: ${chunkStats[0].withoutEmbedding}`);

    const docStats = await db
      .select({
        total: sql<number>`count(*)`,
        withEmbedding: sql<number>`count(*) FILTER (WHERE embedding IS NOT NULL)`,
      })
      .from(documents);

    console.log(`\n   documents 表:`);
    console.log(`   - 总记录数: ${docStats[0].total}`);
    console.log(`   - 有向量: ${docStats[0].withEmbedding}`);

    // 6. 测试向量相似度搜索
    if (chunksWithEmbeddings.length > 0) {
      console.log("\n6️⃣ 测试向量相似度搜索...");
      const testVector = chunksWithEmbeddings[0].embedding as number[];

      if (testVector && testVector.length > 0) {
        const vectorLiteral = `'[${testVector.join(",")}]'`;

        const similarityResults = await db
          .select({
            id: repoChunks.id,
            content: repoChunks.content,
            distance: sql<number>`${repoChunks.embedding} <=> ${sql.raw(vectorLiteral)}::vector`,
          })
          .from(repoChunks)
          .where(sql`${repoChunks.embedding} IS NOT NULL`)
          .orderBy(sql`${repoChunks.embedding} <=> ${sql.raw(vectorLiteral)}::vector`)
          .limit(3);

        console.log("   相似度搜索结果 (余弦距离，越小越相似):");
        similarityResults.forEach((r, i) => {
          console.log(`   ${i + 1}. ID=${r.id}, distance=${r.distance.toFixed(4)}`);
          console.log(`      ${r.content.slice(0, 50)}...`);
        });
      }
    }

  } catch (error: any) {
    console.error("\n❌ 错误:", error.message);
    if (error.code === "ECONNREFUSED") {
      console.log("   提示: 请确保 PostgreSQL 服务正在运行");
      console.log("   启动: docker-compose up -d postgres");
    }
  } finally {
    await pool.end();
  }

  console.log("\n=== 检查完成 ===");
}

checkVectorData().catch(console.error);
