/**
 * @package @devscope/api
 * @description tRPC 配置
 *
 * 初始化 tRPC 并创建路由处理器。
 *
 * @module trpc
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { FastifyRequest, FastifyReply } from "fastify";

// ============================================================================
// tRPC 初始化
// ============================================================================

/**
 * 初始化 tRPC 实例
 * @description 配置上下文类型
 */
const t = initTRPC.context<Context>().create();

/**
 * 导出路由器创建函数
 */
export const router = t.router;

/**
 * 导出公共过程创建函数
 * @description 无需认证即可访问的过程
 */
export const publicProcedure = t.procedure;

// ============================================================================
// Fastify 适配器
// ============================================================================

/**
 * tRPC 处理器配置选项
 */
export interface CreateTRPCHandleOptions {
  /** tRPC 路由器实例 */
  router: ReturnType<typeof router>;
  /** 上下文创建函数 */
  createContext: (opts: CreateFastifyContextOptions) => Promise<Context>;
}

/**
 * 创建 tRPC Fastify 处理器
 * @description 将 tRPC 路由适配到 Fastify 请求处理
 *
 * @param options - 配置选项
 * @returns Fastify 请求处理函数
 */
export function createTRPCHandle({ router, createContext }: CreateTRPCHandleOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    /** 从请求参数中获取路由路径 */
    const path = (req.params as { path: string }).path;
    /** 获取请求体 */
    const body = await req.body;

    try {
      /** 创建请求上下文 */
      const context = await createContext({ req, res: reply.raw, info: req as any });
      /** 创建路由调用器 */
      const caller = router.createCaller(context);

      /** 调用对应的路由处理函数 */
      const result = await (caller as any)[path](body);

      /** 返回结果 */
      reply.send(result);
    } catch (error) {
      /** 错误处理 */
      reply.code(500).send({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  };
}
