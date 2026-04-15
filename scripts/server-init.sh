#!/bin/bash
# DevScope 服务器初始化脚本
# 在服务器上首次部署时运行此脚本

set -e

echo "=== DevScope 服务器初始化 ==="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "Docker 未安装，正在安装..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "Docker 安装完成，请重新登录后继续"
    exit 0
fi

# 检查 Docker Compose 是否安装
if ! command -v docker compose &> /dev/null; then
    echo "Docker Compose 未安装"
    exit 1
fi

# 创建项目目录
PROJECT_DIR="/home/devscope/DevScope"
if [ ! -d "$PROJECT_DIR" ]; then
    echo "创建项目目录: $PROJECT_DIR"
    mkdir -p "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"

# 克隆仓库（如果还没有）
if [ ! -d ".git" ]; then
    echo "克隆仓库..."
    git clone https://github.com/baisiqi6/DevScope.git .
fi

# 创建 .env 文件
if [ ! -f ".env" ]; then
    echo "创建 .env 文件..."
    cat > .env << 'EOF'
# 数据库密码（请修改为强密码）
POSTGRES_PASSWORD=your_strong_password_here

# GitHub Token
GITHUB_TOKEN=your_github_token_here

# DeepSeek API
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

# SiliconFlow API (BGE-M3)
SILICONFLOW_API_KEY=your_siliconflow_api_key_here
BGE_API_URL=https://api.siliconflow.cn/v1
BGE_MODEL_NAME=BAAI/bge-m3

# Langcore
LANGTUM_API_KEY=your_langcore_api_key_here
LANGTUM_BASE_URL=https://demo.langcore.cn
EOF
    echo ".env 文件已创建，请编辑填入实际值"
fi

# 登录 GHCR
echo "请手动登录 GHCR:"
echo "  echo \$GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin"

echo ""
echo "=== 初始化完成 ==="
echo "接下来请:"
echo "1. 编辑 $PROJECT_DIR/.env 填入实际配置"
echo "2. 登录 GHCR"
echo "3. 运行: docker compose -f docker-compose.prod.yml up -d"
