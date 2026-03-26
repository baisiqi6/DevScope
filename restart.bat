@echo off
echo ========================================
echo 重启 DevScope 项目
echo ========================================
echo.

echo [1/2] 清理端口 3000 (Web)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

echo [2/2] 清理端口 3100 (API)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3100 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

echo.
echo ========================================
echo 端口清理完成，正在启动项目...
echo ========================================
echo.

pnpm dev
