#!/bin/bash
# DevScope 一键部署脚本
# 用法: ./deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  DevScope 生产部署"
echo "=========================================="

# 检查 .env 文件
if [ ! -f .env ]; then
  echo "❌ 缺少 .env 文件，请从 .env.production 复制并填入实际值："
  echo "   cp .env.production .env"
  exit 1
fi

# 检查 Docker
if ! command -v docker &> /dev/null; then
  echo "❌ 未安装 Docker"
  exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo "❌ 未安装 Docker Compose"
  exit 1
fi

# 使用 docker compose (v2) 或 docker-compose (v1)
COMPOSE_CMD="docker compose"
if ! docker compose version &> /dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
fi

# Step 1: 备份数据库（如果容器在运行）
echo ""
echo "📦 Step 1: 备份数据库..."
if docker ps --format '{{.Names}}' | grep -q devscope-postgres; then
  BACKUP_DIR="./backups"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/devscope_$(date +%Y%m%d_%H%M%S).sql.gz"
  docker exec devscope-postgres pg_dump -U postgres devscope | gzip > "$BACKUP_FILE"
  echo "✅ 数据库已备份到: $BACKUP_FILE"

  # 保留最近 7 个备份
  ls -t "$BACKUP_DIR"/devscope_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm
else
  echo "⏭️  数据库容器未运行，跳过备份"
fi

# Step 2: 拉取最新代码
echo ""
echo "📥 Step 2: 拉取最新代码..."
if [ -d .git ]; then
  git pull --ff-only || echo "⚠️  git pull 失败，使用当前代码继续"
fi

# Step 3: 构建镜像
echo ""
echo "🔨 Step 3: 构建 Docker 镜像..."
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml build

# Step 4: 启动服务
echo ""
echo "🚀 Step 4: 启动服务..."
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml up -d

# Step 5: 等待数据库就绪
echo ""
echo "⏳ Step 5: 等待数据库就绪..."
for i in $(seq 1 30); do
  if docker exec devscope-postgres pg_isready -U postgres &> /dev/null; then
    echo "✅ 数据库已就绪"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "❌ 数据库启动超时"
    exit 1
  fi
  sleep 2
done

# Step 6: 健康检查
echo ""
echo "🏥 Step 6: 健康检查..."
sleep 5

# 检查各容器状态
for service in devscope-postgres devscope-api devscope-web devscope-nginx; do
  if docker ps --format '{{.Names}}' | grep -q "$service"; then
    echo "  ✅ $service 运行中"
  else
    echo "  ❌ $service 未运行"
    echo "  日志: docker logs $service"
  fi
done

# 检查 HTTP 响应
echo ""
if curl -sf http://localhost/trpc/health > /dev/null 2>&1; then
  echo "✅ API 健康检查通过"
else
  echo "⚠️  API 健康检查未通过（服务可能还在启动中）"
fi

if curl -sf http://localhost > /dev/null 2>&1; then
  echo "✅ Web 页面可访问"
else
  echo "⚠️  Web 页面暂不可访问（服务可能还在启动中）"
fi

echo ""
echo "=========================================="
echo "  部署完成！"
echo "  访问: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
echo "=========================================="
