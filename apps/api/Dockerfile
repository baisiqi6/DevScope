# DevScope API Dockerfile
# 构建: docker build -t devscope/api -f apps/api/Dockerfile .

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
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建应用
RUN pnpm --filter @devscope/api build

# ============================================================================
# 运行阶段
# ============================================================================
FROM base AS runner

WORKDIR /app

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 devscope

# 复制构建产物
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 切换到非 root 用户
USER devscope

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["node", "apps/api/dist/index.js"]
