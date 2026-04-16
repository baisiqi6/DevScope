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
import { registerAgentWorkflowSSE } from "./routes/sse/agent-workflow";
import { registerReportsRoutes } from "./routes/reports";
import { registerWorkflowStatusRoute } from "./routes/workflow-status";
import { startScheduler } from "./scheduler";

// 从多个可能的路径加载 .env 文件
// 本地开发时在 apps/api 目录，需要向上两级；Docker 中 .env 在 cwd 下
const envPaths = [
  path.resolve(process.cwd(), ".env"),           // Docker / 项目根目录
  path.resolve(process.cwd(), "../../.env"),      // 本地开发 (apps/api -> 根目录)
];
const envPath = envPaths.find((p) => fs.existsSync(p)) || envPaths[0];
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

            // httpBatchLink 批量格式: {"0": {"json": {...}}, "1": {"json": {...}}}
            if (parsed["0"]) {
              const keys = Object.keys(parsed).sort();
              if (keys.length > 1 && keys.every(k => parsed[k]?.json !== undefined)) {
                input = keys.map(k => parsed[k].json);
              } else {
                input = parsed["0"].json ?? parsed["0"];
              }
            } else {
              input = parsed.json ?? parsed;
            }
          } catch {
            input = query.input as any;
          }
        }
      } else {
        // POST 请求：支持批量请求格式
        const body = await req.body;
        const requestBody = body as any;

        if (requestBody) {
          // httpBatchLink 批量格式: {"0": {"json": {...}}, "1": {"json": {...}}}
          if (requestBody["0"]?.json) {
            const keys = Object.keys(requestBody).sort();
            if (keys.length > 1 && keys.every(k => requestBody[k]?.json !== undefined)) {
              input = keys.map(k => requestBody[k].json);
            } else {
              input = requestBody["0"].json;
            }
          }
          // httpBatchLink 格式 (无 json 包装): {"0": {...}, "1": {...}}
          else if (requestBody["0"]) {
            const keys = Object.keys(requestBody).sort();
            if (keys.length > 1) {
              input = keys.map(k => requestBody[k]);
            } else {
              input = requestBody["0"];
            }
          }
          // 标准 tRPC 格式: { "json": { ... } }
          else if (requestBody.json !== undefined) {
            input = requestBody.json;
          }
          // 兼容旧格式: { "input": { ... } }
          else if (requestBody.input !== undefined) {
            input = requestBody.input;
          }
          // 直接使用请求体
          else if (Object.keys(requestBody).length > 0) {
            input = requestBody;
          }
        }
      }

      // 调用路由（支持批量请求）
      let result: any;

      // 检测批量请求格式: "getRepository,getReleases"
      if (path.includes(',')) {
        console.log("[tRPC] ✅ Detected batch request, path:", path);
        const paths = path.split(',');
        const batchInputs = Array.isArray(input) ? input : [input];

        // 处理批量请求
        const batchResults = await Promise.allSettled(
          paths.map((p, i) => (caller as any)[p](batchInputs[i]))
        );

        // 格式化批量响应
        result = batchResults.map((settled, index) => {
          if (settled.status === 'fulfilled') {
            return { result: { data: settled.value } };
          } else {
            console.error(`[tRPC] Batch item ${index} failed:`, settled.reason);
            return {
              error: {
                message: settled.reason?.message || 'Batch item failed',
                code: -32603,
                data: paths[index],
              }
            };
          }
        });
      } else {
        // 单个请求
        result = await (caller as any)[path](input);
      }

      // 返回结果（支持批量请求响应格式）
      reply.send(path.includes(',')
        ? result  // 批量请求：直接返回数组
        : {       // 单个请求：包装在 result.data 中
            result: {
              data: result,
            },
          }
      );
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
      origin: "*", // 允许所有来源（开发环境）
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    });

    // 注册 API 文档路由
    await registerDocsRoute(fastify);

    // 注册 Agent 工作流 SSE 端点
    await registerAgentWorkflowSSE(fastify);

    // 注册报告相关路由
    await registerReportsRoutes(fastify);

    // 注册工作流状态查询路由
    await registerWorkflowStatusRoute(fastify);

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

    // 启动定时调度器（通过环境变量控制）
    if (process.env.ENABLE_SCHEDULER === "true") {
      startScheduler();
    } else {
      console.log("[Scheduler] ⏭️ 调度器未启用 (设置 ENABLE_SCHEDULER=true 启用)");
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
