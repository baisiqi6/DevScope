/**
 * @package @devscope/web/api
 * @description 报告查询代理端点
 *
 * 代理前端请求到后端 API 获取报告。
 */

import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// API Route 处理
// ============================================================================

/**
 * GET /api/reports/:executionId
 *
 * 代理报告查询请求到后端 API
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;

    // 后端 API 地址
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3100";

    // 转发请求到后端
    const response = await fetch(`${backendUrl}/api/reports/${executionId}`);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend error: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API Route] Failed to fetch report:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch report",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
