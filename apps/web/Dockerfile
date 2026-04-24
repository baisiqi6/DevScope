# DevScope Web Dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# 构建阶段
FROM base AS builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/ai/package.json ./packages/ai/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @devscope/web build

# 运行阶段
FROM base AS runner
WORKDIR /app

RUN apk add --no-cache openssl socat
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 devscope

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# 复制 Next.js standalone 产物（已包含所需 node_modules）
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

# 启动脚本：用 socat 将 localhost:3100 转发到 api:3100（Docker 网络）
COPY <<'EOF' /app/start.sh
#!/bin/sh
# 将 localhost:3100 转发到 Docker 网络中的 api:3100
# 这样 Next.js rewrite (写死 localhost:3100) 就能访问 API 容器
socat TCP-LISTEN:3100,bind=127.0.0.1,fork TCP:api:3100 &
exec node apps/web/server.js
EOF
RUN chmod +x /app/start.sh

USER devscope
EXPOSE 3000
CMD ["/app/start.sh"]
