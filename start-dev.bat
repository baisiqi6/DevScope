@echo off
REM DevScope 开发环境启动脚本
REM 自动启动 PostgreSQL 容器和开发服务器

echo ========================================
echo DevScope 开发环境启动
echo ========================================
echo.

REM 启动 PostgreSQL 容器
echo [1/2] 启动 PostgreSQL 容器...
podman start devscope-postgres >nul 2>&1
if errorlevel 1 (
    echo 容器启动失败，可能容器不存在
    echo 请先运行: podman run -d --name devscope-postgres -p 5432:5432 -e POSTGRES_DB=devscope -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16
    pause
    exit /b 1
)
echo PostgreSQL 容器已启动
echo.

REM 等待数据库就绪
echo 等待数据库就绪...
timeout /t 3 /nobreak >nul

REM 启动开发服务器
echo [2/2] 启动开发服务器...
echo.
pnpm dev
