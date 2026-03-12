/**
 * @package @devscope/api
 * @description API 服务器入口
 *
 * 基于 Fastify 和 tRPC 的后端 API 服务器。
 *
 * @module index
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { createContext } from "./context";
import { appRouter } from "./router";
import { createTRPCHandle } from "./trpc";
import { registerWebhookRoute } from "./webhook/langtum";

// 导出类型供前端使用 - 使用 typeof 来避免循环引用
export type AppRouter = typeof appRouter;

// ============================================================================
// 服务器初始化
// ============================================================================

/**
 * 创建 Fastify 服务器实例
 * @description 配置日志记录器
 */
const fastify = Fastify({
  /** 启用请求日志 */
  logger: true,
});

// ============================================================================
// 中间件配置
// ============================================================================

/**
 * 注册 CORS 中间件
 * @description 允许跨域请求
 */
await fastify.register(cors, {
  /** 允许所有来源（开发环境） */
  origin: true,
  /** 允许发送凭证 */
  credentials: true,
});

// ============================================================================
// tRPC 路由配置
// ============================================================================

/**
 * 创建 tRPC 处理器
 * @description 将 tRPC 路由挂载到 Fastify
 */
const trpcHandle = createTRPCHandle({ router: appRouter, createContext });

/**
 * 注册 tRPC 路由
 * @description 所有 tRPC 请求通过 /trpc/:path 处理
 */
fastify.all("/trpc/:path", trpcHandle);

// ============================================================================
// Webhook 路由配置
// ============================================================================

/**
 * 注册 Langtum Webhook 路由
 * @description 接收来自 Langtum 平台的工作流状态通知
 */
registerWebhookRoute(fastify, "/api/webhook/langtum");

// ============================================================================
// 服务器启动
// ============================================================================

/**
 * 启动服务器
 * @description 监听指定端口，启动 API 服务
 */
const start = async () => {
  try {
    /** 从环境变量读取端口，默认 3001 */
    const port = Number(process.env.PORT) || 3001;
    /** 监听所有网络接口 */
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 API Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
