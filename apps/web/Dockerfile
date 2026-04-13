# DevScope Web Dockerfile
# 构建: docker build -t devscope/web -f apps/web/Dockerfile .

# 使用 Node.js 20 LTS
FROM node:20-alpine AS base

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# ============================================================================
# 生产构建阶段
# ============================================================================
FROM base AS builder

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages/

# 安装依赖
RUN pnpm install --no-frozen-lockfile

# 复制源代码
COPY . .

# 构建应用（使用 standalone 模式减少镜像大小）
RUN pnpm --filter @devscope/web build

# ============================================================================
# 运行阶段
# ============================================================================
FROM base AS runner

WORKDIR /app

# 安装 OpenSSL（Next.js 需要）
RUN apk add --no-cache openssl

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 devscope

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# 复制 Next.js 构建产物
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./public

# 复制 node_modules
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

# 切换到非 root 用户
USER devscope

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]
