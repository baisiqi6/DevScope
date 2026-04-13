import type { NextConfig } from "next";

const apiTarget = process.env.API_REWRITE_TARGET || "http://localhost:3100";

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
        destination: `${apiTarget}/trpc/:path*`,
      },
      {
        source: "/api/agent/:path*",
        destination: `${apiTarget}/api/agent/:path*`,
      },
    ];
  },
};

export default nextConfig;
