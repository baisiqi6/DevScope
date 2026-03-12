/**
 * @package @devscope/api
 * @description tRPC 上下文创建
 *
 * 为每个请求创建上下文对象，包含请求和响应信息。
 *
 * @module context
 */

import { inferAsyncReturnType } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

/**
 * 创建 tRPC 上下文
 * @description 为每个请求创建包含 Fastify 请求和响应的上下文
 *
 * @param opts - Fastify 上下文选项
 * @returns tRPC 上下文对象
 */
export async function createContext({ req, res }: CreateFastifyContextOptions) {
  return {
    /** Fastify 请求对象 */
    req,
    /** 原始响应对象 */
    res,
  };
}

/**
 * 上下文类型
 * @description 从 createContext 函数推断的类型
 */
export type Context = inferAsyncReturnType<typeof createContext>;
