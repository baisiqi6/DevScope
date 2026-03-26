// 测试完整的数据采集流程
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env") });

console.log("=== Testing Full Collection Pipeline ===\n");
console.log("Using repository: vercel/next.js (small repo for testing)\n");

const { createDb, createPipeline } = await import("./packages/db/dist/index.mjs");

console.log("1. Creating database connection...");
const db = createDb();
console.log("   OK\n");

console.log("2. Creating pipeline (skipEmbeddings=true)...");
const pipeline = createPipeline(db, { skipEmbeddings: true });
console.log("   OK\n");

console.log("3. Running collection for 'vercel/next.js'...");
console.log("   (This may take 30-60 seconds)\n");

const startTime = Date.now();

try {
  const result = await pipeline.run({
    repo: "vercel/next.js",
    config: { skipEmbeddings: true }
  });

  const duration = Date.now() - startTime;

  console.log("\n=== Collection Result ===");
  console.log("Status:", result.status);
  console.log("Repository:", result.repository?.fullName);
  console.log("Chunks collected:", result.chunksCollected);
  console.log("Embeddings generated:", result.embeddingsGenerated);
  console.log("HN items collected:", result.hnItemsCollected);
  console.log("Duration:", Math.round(duration / 1000), "seconds");

  if (result.error) {
    console.log("Error:", result.error);
  }
  if (result.warning) {
    console.log("Warning:", result.warning);
  }

  if (result.status === "completed") {
    console.log("\n✅ Collection completed successfully!");
  } else {
    console.log("\n❌ Collection failed!");
    process.exit(1);
  }
} catch (err) {
  console.error("\n=== Exception during collection ===");
  console.error("Error:", err.message);
  console.error("Stack:", err.stack);
  process.exit(1);
}
