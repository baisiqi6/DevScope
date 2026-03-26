/**
 * 检查 pgvector 扩展和向量数据
 */

import { createDb, repoChunks, documents } from "./packages/db/dist/index.mjs";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

async function check() {
  console.log("=== pgvector 检查 ===\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/devscope",
  });

  try {
    // 1. 检查扩展
    const ext = await pool.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'");
    console.log("1. pgvector 扩展:", ext.rows.length > 0 ? `✅ 已安装 v${ext.rows[0].extversion}` : "❌ 未安装");

    // 2. 检查类型
    const type = await pool.query("SELECT typname FROM pg_type WHERE typname = 'vector'");
    console.log("2. vector 类型:", type.rows.length > 0 ? "✅ 存在" : "❌ 不存在");

    // 3. 查询向量字段
    const tables = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE udt_name = 'vector'
    `);
    console.log("3. 向量字段:");
    if (tables.rows.length > 0) {
      tables.rows.forEach(r => console.log("   -", r.table_name + "." + r.column_name));
    } else {
      console.log("   没有找到向量字段");
    }

    // 4. 查询向量数据
    const db = createDb();
    const chunks = await db.select({
      id: repoChunks.id,
      content: repoChunks.content,
      chunkType: repoChunks.chunkType,
      embedding: repoChunks.embedding,
    }).from(repoChunks).where(sql`${repoChunks.embedding} IS NOT NULL`).limit(3);

    console.log("\n4. 向量数据:");
    if (chunks.length > 0) {
      console.log(`   ✅ 找到 ${chunks.length} 条有向量的记录`);
      chunks.forEach((c, i) => {
        const emb = c.embedding;
        console.log(`   [${i + 1}] ID=${c.id}, 类型=${c.chunkType}, 维度=${Array.isArray(emb) ? emb.length : "N/A"}`);
        if (Array.isArray(emb) && emb.length > 0) {
          console.log(`       前5个值: [${emb.slice(0, 5).map(v => v.toFixed(4)).join(", ")}...]`);
        }
      });
    } else {
      console.log("   ⚠️  没有向量数据");
    }

    // 5. 统计
    const stats = await db.select({
      total: sql`count(*)`,
      withVector: sql`count(*) FILTER (WHERE embedding IS NOT NULL)`,
    }).from(repoChunks);

    console.log("\n5. repo_chunks 统计:");
    console.log(`   总记录: ${stats[0].total}`);
    console.log(`   有向量: ${stats[0].withVector}`);

  } catch (e) {
    console.error("\n错误:", e.message);
    if (e.code === "ECONNREFUSED") {
      console.log("提示: 请确保 PostgreSQL 服务正在运行");
    }
  } finally {
    await pool.end();
  }

  console.log("\n=== 检查完成 ===");
}

check().catch(console.error);
