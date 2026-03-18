# 端口管理指南

## 端口分配

为了避免端口冲突，本项目使用以下端口分配：

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 (Web) | 3000 | Next.js 开发服务器 |
| 后端 (API) | 3100 | Fastify/tRPC API 服务器 |
| PostgreSQL | 5432 | 数据库 |
| BGE-M3 API | 9997 | Embedding 服务 (Xinference) |

> **注意**: 后端端口已从 3000 改为 3100，避免与前端冲突。

## 环境变量配置

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

关键配置项：

```bash
# API 服务器端口（默认 3100）
PORT=3100
API_PORT=3100

# 前端 API 连接地址
NEXT_PUBLIC_API_URL=http://localhost:3100/trpc
```

## 端口清理命令

### 清理默认端口（3000, 3100, 9997）

```bash
pnpm kill-ports
```

### 清理指定端口

```bash
# 清理单个端口
pnpm kill-ports 8080

# 清理多个端口
pnpm kill-ports 3000 3100 8080
```

### 开发前自动清理

```bash
# 自动清理端口后启动开发服务器
pnpm dev:clean
```

## 手动清理端口（Windows）

如果脚本不工作，可以手动清理：

```cmd
# 查找占用端口的进程
netstat -ano | findstr :3000
netstat -ano | findstr :3100

# 杀死进程（替换 PID 为实际进程 ID）
taskkill /F /PID 12345
```

## 手动清理端口（macOS/Linux）

```bash
# 查找占用端口的进程
lsof -i :3000
lsof -i :3100

# 杀死进程
kill -9 <PID>

# 或者使用 fuser
fuser -k 3000/tcp
fuser -k 3100/tcp
```

## 常见问题

### Q: 启动时提示端口被占用？

```bash
# 方案 1: 使用自动清理命令
pnpm dev:clean

# 方案 2: 先清理端口再启动
pnpm kill-ports
pnpm dev

# 方案 3: 手动杀死进程
# Windows: taskkill /F /PID <PID>
# macOS/Linux: kill -9 <PID>
```

### Q: 如何修改端口？

1. 修改 `.env` 文件中的端口配置
2. 重启开发服务器

```bash
# 前端端口（Next.js 使用环境变量）
PORT=3001 pnpm --filter @devscope/web dev

# 后端端口
# 在 .env 中设置 PORT=3200
```

### Q: 为什么前端连接不到后端？

确保：
1. 后端服务器正在运行（检查控制台输出）
2. `.env` 中 `NEXT_PUBLIC_API_URL` 配置正确
3. 后端 CORS 配置正确（默认允许所有来源）

## 开发工作流

推荐的开发流程：

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入必要的配置

# 3. 启动数据库
docker-compose up -d postgres

# 4. 运行数据库迁移
pnpm db:push

# 5. 启动开发服务器（自动清理端口）
pnpm dev:clean
```
