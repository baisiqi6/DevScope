/**
 * @package @devscope/api
 * @description API 服务器入口
 *
 * 基于 Fastify 和 tRPC 的后端 API 服务器。
 *
 * @module index
 */

// 加载环境变量（必须在最顶部）
import path from "path";
import dotenv from "dotenv";
import fs from 'fs';
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createContext } from "./context";
import { appRouter } from "./router";
import { registerWebhookRoute } from "./webhook/langtum";
import { registerDocsRoute } from "./docs";

// 从项目根目录加载 .env 文件
// API 服务器运行时在 apps/api 目录，需要向上两级
const envPath = path.resolve(process.cwd(), "../../.env");
console.log(`[Env] Loading .env from: ${envPath}`);
console.log(`[Env] File exists: ${fs.existsSync(envPath)}`);
dotenv.config({ path: envPath });
console.log(`[Env] SILICONFLOW_API_KEY loaded: ${!!process.env.SILICONFLOW_API_KEY ? 'Yes (length: ' + process.env.SILICONFLOW_API_KEY.length + ')' : 'No'}`);
console.log(`[Env] BGE_API_URL loaded: ${process.env.BGE_API_URL || 'Not set'}`);
console.log(`[Env] BGE_MODEL_NAME loaded: ${process.env.BGE_MODEL_NAME || 'Not set'}`);

// ============================================================================
// 服务器初始化
// ============================================================================

/**
 * 创建 Fastify 服务器实例
 * @description 配置日志记录器和 body parser
 */
const fastify = Fastify({
  /** 启用请求日志 */
  logger: true,
  /** 配置 body parser */
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

// ============================================================================
// Webhook 路由配置
// ============================================================================

/**
 * 注册 Langtum Webhook 路由（可选）
 * @description 接收来自 Langtum 平台的工作流状态通知
 * 仅当设置了 LANGTUM_API_KEY 时才注册此路由
 */
if (process.env.LANGTUM_API_KEY) {
  registerWebhookRoute(fastify, "/api/webhook/langtum");
  console.log("[Webhook] Langtum webhook registered");
} else {
  console.log("[Webhook] LANGTUM_API_KEY not set, skipping Langtum webhook registration");
}

// ============================================================================
// tRPC 路由配置（手动实现，支持批量请求）
// ============================================================================

/**
 * 创建 tRPC 路由处理器（支持批量请求）
 */
function createTRPCHandle() {
  return async (req: any, reply: any) => {
    const path = (req.params as { path: string }).path;

    try {
      const context = await createContext({ req, res: reply.raw, info: {} as any });
      const caller = appRouter.createCaller(context);

      // 解析输入 - 支持批量请求格式
      let input: any = undefined;

      if (req.method === "GET") {
        // GET 请求：从查询参数获取
        const query = req.query as Record<string, string>;
        if (query.input) {
          try {
            const parsed = JSON.parse(query.input);
            console.log("[tRPC] 🔍 DEBUG GET - Parsed input:", JSON.stringify(parsed, null, 2));

            // 处理 httpBatchLink 格式: { "0": { id: 3 } }
            if (parsed["0"]) {
              console.log("[tRPC] ✅ Detected GET httpBatchLink format");
              input = parsed["0"];
            } else {
              input = parsed;
            }
          } catch {
            input = query.input as any;
          }
        }
      } else {
        // POST 请求：支持批量请求格式
        // 🔍 调试日志：打印原始请求信息
        console.log("[tRPC] 🔍 DEBUG - Path:", path);
        console.log("[tRPC] 🔍 DEBUG - Method:", req.method);
        console.log("[tRPC] 🔍 DEBUG - Content-Type:", req.headers["content-type"]);
        console.log("[tRPC] 🔍 DEBUG - Query params:", JSON.stringify(req.query));

        const body = await req.body;
        const requestBody = body as any;
        console.log("[tRPC] 🔍 DEBUG - Body type:", typeof body);
        console.log("[tRPC] 🔍 DEBUG - Body keys:", body ? Object.keys(body) : "null/undefined");
        console.log("[tRPC] 🔍 DEBUG - Body value:", JSON.stringify(requestBody, null, 2));

        if (requestBody) {
          // httpBatchLink 批量请求格式: { "0": { "json": { ... } } }
          if (requestBody["0"]?.json) {
            console.log("[tRPC] ✅ Detected httpBatchLink format with json wrapper");
            input = requestBody["0"].json;
          }
          // httpBatchLink 格式 (无 json 包装): { "0": { repo: "..." } }
          else if (requestBody["0"]) {
            console.log("[tRPC] ✅ Detected httpBatchLink format (direct)");
            input = requestBody["0"];
          }
          // 标准 tRPC 格式: { "json": { ... } }
          else if (requestBody.json !== undefined) {
            console.log("[tRPC] ✅ Detected standard tRPC format");
            input = requestBody.json;
          }
          // 兼容旧格式: { "input": { ... } }
          else if (requestBody.input !== undefined) {
            console.log("[tRPC] ✅ Detected legacy format");
            input = requestBody.input;
          }
          // 直接使用请求体
          else if (Object.keys(requestBody).length > 0) {
            console.log("[tRPC] ✅ Using body as direct input");
            input = requestBody;
          }
        }

        console.log("[tRPC] 🔍 DEBUG - Parsed input:", JSON.stringify(input, null, 2));
      }

      // 调用路由
      const result = await (caller as any)[path](input);

      // 返回结果（支持批量请求响应格式）
      reply.send({
        result: {
          data: result,
        },
      });
    } catch (error: any) {
      console.error("[tRPC] Error caught in createTRPCHandle:");
      console.error("[tRPC] Error type:", typeof error);
      console.error("[tRPC] Error name:", error?.name);
      console.error("[tRPC] Error message:", error?.message);
      console.error("[tRPC] Error stack:", error?.stack);

      // Zod 验证错误
      if (error.code === "invalid_type" || error.code === "ZodError") {
        console.error("[tRPC] Zod validation error");
        reply.code(400).send({
          error: {
            message: error.message || "Validation failed",
            code: "BAD_REQUEST",
            issues: error.issues || [error],
          },
        });
        return;
      }

      // 其他错误 - 返回详细的错误信息
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails = {
        message: errorMessage,
        code: -32603,
        name: error?.name,
        ...(process.env.NODE_ENV === "development" && { stack: error?.stack }),
      };

      console.error("[tRPC] Sending error response:", errorDetails);
      reply.code(500).send({
        error: errorDetails,
      });
    }
  };
}

/**
 * 注册 tRPC 路由
 * @description 所有 tRPC 请求通过 /trpc/:path 处理
 */
fastify.all("/trpc/:path", createTRPCHandle());

// 兼容前端可能使用的 /api/trpc/:path 路径
fastify.all("/api/trpc/:path", createTRPCHandle());

// ============================================================================
// 服务器启动
// ============================================================================

/**
 * 启动服务器
 * @description 监听指定端口，启动 API 服务
 */
const start = async () => {
  try {
    // 注册 CORS 中间件
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });

    // 注册 API 文档路由
    await registerDocsRoute(fastify);

    // 检查环境变量配置
    const hasGitHubToken = !!process.env.GITHUB_TOKEN;
    const hasDbUrl = !!process.env.DATABASE_URL;
    const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;
    const hasSiliconFlowKey = !!process.env.SILICONFLOW_API_KEY;
    const hasLangtumKey = !!process.env.LANGTUM_API_KEY;
    const hasBgeApiUrl = !!process.env.BGE_API_URL;
    const hasBgeModelName = !!process.env.BGE_MODEL_NAME;

    console.log("=".repeat(50));
    console.log("🔧 环境变量检查:");
    console.log(`  GITHUB_TOKEN: ${hasGitHubToken ? "✅ 已配置" : "❌ 未配置"}`);
    console.log(`  DATABASE_URL: ${hasDbUrl ? "✅ 已配置" : "❌ 未配置"}`);
    console.log(`  DEEPSEEK_API_KEY: ${hasDeepSeekKey ? "✅ 已配置" : "❌ 未配置"}`);
    console.log(`  SILICONFLOW_API_KEY: ${hasSiliconFlowKey ? "✅ 已配置" : "❌ 未配置"} ${hasSiliconFlowKey ? `(value: ${process.env.SILICONFLOW_API_KEY?.substring(0, 10)}...)` : ""}`);
    console.log(`  LANGTUM_API_KEY: ${hasLangtumKey ? "✅ 已配置" : "❌ 未配置"}`);
    console.log(`  BGE_API_URL: ${hasBgeApiUrl ? "✅ 已配置" : "❌ 未配置"} ${hasBgeApiUrl ? `(${process.env.BGE_API_URL})` : ""}`);
    console.log(`  BGE_MODEL_NAME: ${hasBgeModelName ? "✅ 已配置" : "❌ 未配置"} ${hasBgeModelName ? `(${process.env.BGE_MODEL_NAME})` : ""}`);
    console.log("=".repeat(50));

    /** 从环境变量读取端口，默认 3100 */
    const port = Number(process.env.PORT || process.env.API_PORT) || 3100;
    /** 监听所有网络接口 */
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 API Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
