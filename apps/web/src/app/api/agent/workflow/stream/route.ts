/**
 * @package @devscope/web/api
 * @description Agent 工作流 SSE 代理端点
 *
 * 代理前端请求到后端 API，解决 CORS 和超时问题。
 * 在服务器端运行，不受浏览器超时限制。
 */

import { NextRequest } from "next/server";

// ============================================================================
// 类型定义
// ============================================================================

interface SSERequestBody {
  repos: string[];
  analysisType: "competitive_landscape" | "health_report" | "single_repo";
  context?: string;
}

// ============================================================================
// API Route 处理
// ============================================================================

/**
 * POST /api/agent/workflow/stream
 *
 * 代理 SSE 流式请求到后端 API
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as SSERequestBody;

    // 后端 API 地址（内部调用，不需要暴露给公网）
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3100";

    // 转发请求到后端
    const response = await fetch(`${backendUrl}/api/agent/workflow/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Next.js 服务器端 fetch 没有超时限制
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Backend error: ${response.statusText}` }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // 返回 SSE 流
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[API Route] Failed to proxy request:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to connect to backend",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
