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
// 数据库连接
// ============================================================================

/**
 * 创建数据库连接实例
 *
 * @param connectionString - 数据库连接字符串（可选，默认从环境变量读取）
 * @returns Drizzle 数据库实例
 *
 * @example
 * ```typescript
 * import { createDb } from "@devscope/db";
 *
 * const db = createDb("postgresql://localhost:5432/devscope");
 *
 * // 查询用户
 * const users = await db.select().from(schema.users);
 * ```
 *
 * @example
 * ```typescript
 * // 使用环境变量 DATABASE_URL
 * const db = createDb();
 * ```
 */
export function createDb(connectionString?: string) {
  // 创建 PostgreSQL 连接池
  const pool = new Pool({
    connectionString: connectionString || process.env.DATABASE_URL,
  });

  // 返回 Drizzle ORM 实例
  return drizzle(pool, { schema });
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
