// 测试 Pipeline 初始化
console.log("=== Testing Pipeline Initialization ===\n");

// 加载环境变量
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env") });

// 1. 测试环境变量
console.log("1. Checking environment variables:");
console.log("   GITHUB_TOKEN:", process.env.GITHUB_TOKEN ? "SET" : "NOT SET");
console.log("   DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET");
console.log("   BGE_API_URL:", process.env.BGE_API_URL || "NOT SET");
console.log("   SILICONFLOW_API_KEY:", process.env.SILICONFLOW_API_KEY ? "SET" : "NOT SET");
console.log("");

// 2. 测试 BGEEmbeddingProvider 初始化
console.log("2. Testing BGEEmbeddingProvider initialization:");
try {
  const { BGEEmbeddingProvider } = await import("./packages/ai/dist/index.mjs");
  console.log("   Module loaded successfully");

  const embedder = new BGEEmbeddingProvider({
    baseURL: process.env.BGE_API_URL || "https://api.siliconflow.cn/v1"
  });
  console.log("   BGEEmbeddingProvider initialized successfully");
} catch (err) {
  console.error("   ERROR:", err.message);
  console.error("   Stack:", err.stack);
}
console.log("");

// 3. 测试数据库连接
console.log("3. Testing database connection:");
try {
  const { createDb } = await import("./packages/db/dist/index.mjs");
  console.log("   Module loaded successfully");

  const db = createDb();
  console.log("   Database connection created");
} catch (err) {
  console.error("   ERROR:", err.message);
  console.error("   Stack:", err.stack);
}
console.log("");

// 4. 测试 Pipeline 创建（快速模式）
console.log("4. Testing Pipeline creation (skipEmbeddings=true):");
try {
  const { createDb, createPipeline } = await import("./packages/db/dist/index.mjs");
  const db = createDb();
  const pipeline = createPipeline(db, { skipEmbeddings: true });
  console.log("   Pipeline created successfully");
} catch (err) {
  console.error("   ERROR:", err.message);
  console.error("   Stack:", err.stack);
}

console.log("\n=== Test Complete ===");
