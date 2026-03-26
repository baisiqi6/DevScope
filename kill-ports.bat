@echo off
echo ========================================
echo Cleaning occupied ports
echo ========================================
echo.

echo [1/2] Cleaning port 3000 (Web)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo     Kill PID: %%a
    taskkill /F /PID %%a 2>nul
)

echo [2/2] Cleaning port 3100 (API)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3100 ^| findstr LISTENING') do (
    echo     Kill PID: %%a
    taskkill /F /PID %%a 2>nul
)

echo.
echo ========================================
echo Port cleanup completed!
echo ========================================
echo.
echo Note: Database port 5432 will NOT be cleaned
echo To restart database, use: podman start devscope-postgres
