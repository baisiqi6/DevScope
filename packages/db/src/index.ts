/**
 * @package @devscope/db
 * @description 数据库包 - Drizzle ORM + PostgreSQL
 *
 * 本包提供数据库连接和操作接口，基于 Drizzle ORM 和 PostgreSQL。
 * 支持 pgvector 扩展实现向量嵌入存储和语义搜索。
 *
 * @module index
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import * as schema from "./schema";

// ============================================================================
// 导出 Schema
// ============================================================================

/**
 * 导出所有数据库 schema
 */
export * from "./schema";

// ============================================================================
// 数据库连接（单例模式）
// ============================================================================

let poolInstance: InstanceType<typeof Pool> | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

/**
 * 获取共享的数据库连接实例（单例模式）
 *
 * 首次调用时创建连接池，后续调用复用同一实例。
 * 避免每次请求创建新连接池导致连接耗尽。
 *
 * @param connectionString - 数据库连接字符串（可选，默认从环境变量读取）
 * @returns Drizzle 数据库实例
 */
export function createDb(connectionString?: string) {
  if (dbInstance && !connectionString) {
    return dbInstance;
  }

  // 创建或复用连接池
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    poolInstance.on("error", (err) => {
      console.error("[DB] Unexpected pool error:", err);
    });
  }

  dbInstance = drizzle(poolInstance, { schema });
  return dbInstance;
}

/**
 * 关闭数据库连接池
 * 在服务关闭时调用，确保所有连接正确释放。
 */
export async function closeDb() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    dbInstance = null;
  }
}

/**
 * 数据库实例类型
 * @description Drizzle 数据库客户端的类型定义
 */
export type Db = ReturnType<typeof createDb>;

// ============================================================================
// 导出数据库操作
// ============================================================================

/**
 * 仓库采集操作
 */
export * from "./collection";

/**
 * GitHub 数据采集
 */
export * from "./github";

/**
 * 数据采集 Pipeline
 */
export * from "./pipeline";

/**
 * OSSInsight API 客户端
 */
export * from "./ossinsight";

/**
 * 报告存储服务
 */
export * from "./report-storage";