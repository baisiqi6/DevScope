/**
 * @package @devscope/web/api
 * @description 工作流状态查询代理端点
 *
 * 代理前端请求到后端 API 查询工作流执行状态。
 */

import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// API Route 处理
// ============================================================================

/**
 * GET /api/workflow/status/:executionId
 *
 * 代理工作流状态查询请求到后端 API
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;

    const backendUrl = process.env.BACKEND_URL || "http://localhost:3100";
    const response = await fetch(`${backendUrl}/api/workflow/status/${executionId}`);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend error: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API Route] Failed to check workflow status:", error);
    return NextResponse.json(
      {
        error: "Failed to check workflow status",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
