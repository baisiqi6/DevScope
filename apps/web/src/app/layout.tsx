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
import { AppHeader } from "@/components/app-header";
import { TRPCProvider } from "@/components/providers";

/**
 * 页面元数据配置
 */
export const metadata: Metadata = {
  /** 页面标题 */
  title: "DevScope",
  /** 页面描述 */
  description: "开源生态采集、搜索与分析工作台",
  /** 图标配置 */
  icons: {
    icon: "/icon.svg",
    shortcut: "/favicon.ico",
    apple: "/icon.svg",
  },
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
    <html lang="zh-CN">
      <body className="antialiased">
        <TRPCProvider>
          <AppHeader />
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
        </TRPCProvider>
      </body>
    </html>
  );
}
