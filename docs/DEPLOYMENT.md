# DevScope 自动部署配置指南

本文档说明如何配置 GitHub Actions 自动部署到服务器。

## 架构概览

```
代码推送 → GitHub Actions 构建镜像 → 推送到 GHCR → SSH 到服务器 → 拉取镜像 → 重启服务
```

## 前置要求

- GitHub 仓库
- 服务器（已安装 Docker 和 Docker Compose）
- SSH 访问权限

## 配置步骤

### 1. 配置 GitHub Secrets

在 GitHub 仓库设置中添加以下 Secrets：

**Settings → Secrets and variables → Actions → New repository secret**

| Secret 名称 | 说明 | 示例 |
|------------|------|------|
| `SSH_PRIVATE_KEY` | 服务器的 SSH 私钥 | `-----BEGIN RSA PRIVATE KEY-----\n...` |

**如何获取 SSH 私钥：**

如果你本地能 SSH 到服务器，说明已经有私钥了。查看私钥：

```bash
cat ~/.ssh/id_rsa  # 或 ~/.ssh/id_ed25519
```

复制完整内容（包括 `-----BEGIN` 和 `-----END` 行）作为 Secret 值。

### 2. 服务器初始化

首次部署需要在服务器上初始化环境：

```bash
# SSH 到服务器
ssh devscope@47.120.41.136

# 创建项目目录
mkdir -p /home/devscope/DevScope
cd /home/devscope/DevScope

# 克隆仓库
git clone https://github.com/baisiqi6/DevScope.git .

# 创建 .env 文件（从示例复制）
cp .env.production .env

# 编辑 .env，填入实际配置
nano .env

# 登录 GHCR（需要 GitHub Personal Access Token）
# Token 需要 read:packages 权限
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 启动服务
docker compose -f docker-compose.prod.yml up -d
```

### 3. 触发自动部署

配置完成后，每次推送到 `main` 分支都会自动触发部署：

1. GitHub Actions 构建新的 Docker 镜像
2. 推送到 GHCR
3. SSH 到服务器执行部署脚本
4. 服务器拉取最新镜像并重启服务

**手动触发部署：**

在 GitHub 仓库的 Actions 页面，选择 "Build and Deploy" workflow，点击 "Run workflow"。

## 环境变量说明

服务器上的 `.env` 文件需要配置以下变量：

### 必填项

- `POSTGRES_PASSWORD`: 数据库密码（强密码）
- `GITHUB_TOKEN`: GitHub API Token
- `DEEPSEEK_API_KEY`: DeepSeek API Key

### 可选项

- `ANTHROPIC_API_KEY`: Anthropic API Key
- `SILICONFLOW_API_KEY`: SiliconFlow API Key（用于 BGE-M3 embedding）
- `LANGTUM_API_KEY`: Langcore API Key

## 端口说明

| 端口 | 服务 | 访问方式 |
|------|------|---------|
| 80 | Nginx | 对外开放 |
| 3000 | Web 前端 | 仅本地 |
| 3001 | API 服务 | 仅本地 |
| 5432 | PostgreSQL | 仅本地 |

外部访问通过 Nginx 反向代理，所有应用端口不直接暴露。

## 故障排查

### 查看服务状态

```bash
docker compose -f docker-compose.prod.yml ps
```

### 查看日志

```bash
# 所有服务日志
docker compose -f docker-compose.prod.yml logs

# 特定服务日志
docker compose -f docker-compose.prod.yml logs api
docker compose -f docker-compose.prod.yml logs web
docker compose -f docker-compose.prod.yml logs postgres
```

### 重启服务

```bash
docker compose -f docker-compose.prod.yml restart
```

### 完全重新部署

```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

## 安全建议

1. **数据库密码**：使用强密码（至少 16 位，包含大小写字母、数字和特殊字符）
2. **API Keys**：定期轮换，不要提交到 Git
3. **SSH 密钥**：使用 ED25519 或 RSA 4096 位密钥
4. **防火墙**：只开放 80/443 端口，SSH 端口建议修改默认值

## 多项目部署

如果服务器上运行多个项目，注意：

- 每个项目的数据库使用不同的宿主机端口（5432/5433/5434...）
- Nginx 按域名分发，只占用 80/443
- 每个项目独立的 Docker network

示例配置：

```yaml
# 项目 A
postgres:
  ports:
    - "127.0.0.1:5432:5432"

# 项目 B
postgres:
  ports:
    - "127.0.0.1:5433:5432"
```
