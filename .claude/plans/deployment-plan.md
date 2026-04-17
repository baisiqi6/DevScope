# DevScope 生产部署方案

## 概述

将 DevScope 部署到阿里云 ECS 服务器，使用 Docker Compose 管理所有服务，并添加定时任务自动采集数据。

---

## 第一部分：修复现有 Bug（否则 Docker 部署会失败）

### 1.1 修复 Web Dockerfile 启动路径
**文件**: `apps/web/Dockerfile`
- 问题：`CMD ["node", "apps/web/server.js"]` 路径错误，Next.js standalone 模式下 server.js 在根目录
- 修复：改为 `CMD ["node", "server.js"]`

### 1.2 修复 API Dockerfile 缺少 workspace 包
**文件**: `apps/api/Dockerfile`
- 问题：runner 阶段只复制了 `apps/api/dist`，没有复制 `@devscope/db`、`@devscope/ai`、`@devscope/shared` 的构建产物
- 修复：在 runner 阶段增加 `COPY --from=builder /app/packages/*/dist ./packages/*/dist`

### 1.3 修复 next.config.ts 硬编码 localhost
**文件**: `apps/web/next.config.ts`
- 问题：rewrites 中硬编码了 `http://localhost:3100`，Docker 容器内无法访问
- 修复：改为从环境变量 `API_REWRITE_TARGET` 读取，默认 `http://localhost:3100`

### 1.4 修复 API .env 加载路径
**文件**: `apps/api/src/index.ts`
- 问题：`path.resolve(process.cwd(), "../../.env")` 在 Docker 中解析为 `/.env`，找不到文件
- 修复：增加多路径查找逻辑，优先查找 `process.cwd()/.env`

---

## 第二部分：添加定时数据采集调度器

### 2.1 安装 node-cron 依赖
**文件**: `apps/api/package.json`
- 添加 `"node-cron": "^3.0.3"` 到 dependencies

### 2.2 创建调度器服务
**新文件**: `apps/api/src/scheduler.ts`

在 API 服务内部集成调度器（而非单独容器），共享数据库连接和已有的 Pipeline 代码。

定时任务：

| 任务 | 调度 | 说明 |
|------|------|------|
| 刷新已关注仓库 | 每天凌晨 2:00 | 重新采集 `repositories` 表中超过 24h 未更新的仓库数据 |
| 发现趋势项目 | 每天早上 6:00 | 从 OSSInsight 获取热门项目，新项目自动入库 |
| 处理待向量化数据 | 每 30 分钟 | 处理 `embeddingStatus = 'pending'` 的仓库向量化 |

### 2.3 在 API 入口启动调度器
**文件**: `apps/api/src/index.ts`
- 在 `fastify.listen()` 之后调用 `startScheduler()`
- 通过环境变量 `ENABLE_SCHEDULER=true` 控制是否启用

---

## 第三部分：生产环境 Docker Compose

### 3.1 创建生产环境 compose 文件
**新文件**: `docker-compose.prod.yml`

覆盖开发配置：
- PostgreSQL 使用强密码，端口只绑定 127.0.0.1
- API 和 Web 端口只绑定 127.0.0.1（通过 Nginx 对外暴露）
- API 启用 `ENABLE_SCHEDULER=true`
- 添加 Nginx 反向代理容器
- Web 的 `API_REWRITE_TARGET` 指向 `http://api:3001`

### 3.2 创建 Nginx 配置
**新文件**: `nginx/conf.d/default.conf`

- `/trpc/*` 和 `/api/*` 转发到 API 容器 (3001)
- 其余请求转发到 Web 容器 (3000)
- SSE 长连接支持（`proxy_buffering off`）
- 先用 HTTP，后续可加 SSL

---

## 第四部分：部署脚本和配置

### 4.1 创建生产环境变量模板
**新文件**: `.env.production`

包含所有必需的环境变量和说明。

### 4.2 创建部署脚本
**新文件**: `deploy.sh`

一键部署：备份数据库 -> 拉取代码 -> 构建镜像 -> 重启服务 -> 健康检查

### 4.3 创建 Nginx 主配置
**新文件**: `nginx/nginx.conf`

---

## 第五部分：服务器端操作指南（文档，不写代码）

部署到阿里云 ECS 的步骤：

1. 安装 Docker + Docker Compose
2. 克隆仓库到 `/opt/devscope`
3. 复制 `.env.production` 为 `.env` 并填入实际密钥
4. 阿里云安全组开放 80 端口
5. 运行 `./deploy.sh` 一键部署
6. 访问 `http://<服务器IP>` 验证

---

## 实施顺序

1. 修复 Dockerfile Bug（1.1, 1.2）
2. 修复 next.config.ts 和 API .env 路径（1.3, 1.4）
3. 创建调度器（2.1, 2.2, 2.3）
4. 创建 docker-compose.prod.yml（3.1）
5. 创建 Nginx 配置（3.2）
6. 创建部署脚本和环境变量模板（4.1, 4.2, 4.3）

---

## 预估影响

- **新文件**: 5 个（scheduler.ts, docker-compose.prod.yml, nginx 配置, deploy.sh, .env.production）
- **修改文件**: 5 个（2 个 Dockerfile, next.config.ts, api/index.ts, api/package.json）
- **服务器要求**: 阿里云 ECS 2C4G 以上，安装 Docker
