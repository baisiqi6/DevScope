/**
 * @package @devscope/web
 * @description 根布局组件
 *
 * Next.js App Router 的根布局，定义页面的基本结构和元数据。
 *
 * @module layout
 */

import type { Metadata } from "next";
import "./globals.css";
import { TRPCProvider } from "@/components/providers";

/**
 * 页面元数据配置
 */
export const metadata: Metadata = {
  /** 页面标题 */
  title: "DevScope",
  /** 页面描述 */
  description: "AI-powered development workspace",
};

/**
 * 根布局组件
 * @param children - 子页面内容
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
