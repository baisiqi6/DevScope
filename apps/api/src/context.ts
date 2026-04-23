/**
 * @package @devscope/api
 * @description tRPC 请求上下文
 *
 * 为每个请求提供共享的数据库实例和其他依赖。
 * 数据库连接池在服务启动时创建，所有请求复用同一实例。
 *
 * @module context
 */

import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { createDb, type Db } from "@devscope/db";

// 服务启动时创建共享的数据库实例
const db = createDb();

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  return {
    db,
    req,
    res,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;