import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@devscope/shared", "@devscope/api"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 添加代理配置，将 API 请求转发到后端服务器
  async rewrites() {
    return [
      {
        source: "/api/trpc/:path*",
        destination: "http://localhost:3100/trpc/:path*",
      },
    ];
  },
};

export default nextConfig;
