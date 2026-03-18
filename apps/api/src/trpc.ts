/**
 * @package @devscope/api
 * @description tRPC 配置
 *
 * 初始化 tRPC 并创建路由处理器。
 *
 * @module trpc
 */

import { initTRPC } from "@trpc/server";
import type { Context } from "./context";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

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

    try {
      /** 创建请求上下文 */
      const context = await createContext({ req, res: reply.raw, info: {} as any });

      /** 解析输入 - 处理 GET 和 POST 请求的不同格式 */
      let input = undefined;

      if (req.method === "GET") {
        // GET 请求：从查询参数获取 input
        const query = req.query as Record<string, string>;
        if (query.input) {
          try {
            // tRPC 将 input 作为 JSON 字符串编码在查询参数中
            input = JSON.parse(query.input);
          } catch {
            // 如果解析失败，尝试直接使用
            input = query.input as any;
          }
        }
      } else {
        // POST 请求：从请求体获取
        const body = await req.body;
        const requestBody = body as any;

        if (requestBody) {
          // 处理标准 tRPC 格式: { "json": { ... } }
          if (requestBody.json !== undefined) {
            input = requestBody.json;
          } else if (requestBody.input !== undefined) {
            // 兼容旧格式: { "input": { ... } }
            input = requestBody.input;
          } else if (Object.keys(requestBody).length > 0) {
            // 直接使用请求体作为输入
            input = requestBody;
          }
        }
      }

      /** 创建路由调用器 */
      const caller = router.createCaller(context);

      /** 调用对应的路由处理函数 */
      const result = await (caller as any)[path](input);

      /** 返回结果，使用 tRPC 期望的格式 */
      reply.send({
        result: {
          data: result,
        },
      });
    } catch (error) {
      /** 错误处理 */
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      reply.code(500).send({
        error: {
          message: errorMessage,
          code: -32603,
        },
      });
    }
  };
}
