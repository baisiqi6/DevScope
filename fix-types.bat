@echo off
echo Fixing type errors...
echo.

echo [1/3] Cleaning shared package...
if exist packages\shared\dist rmdir /s /q packages\shared\dist

echo [2/3] Rebuilding shared package...
call pnpm --filter @devscope/shared build

echo [3/3] Rebuilding db package...
call pnpm --filter @devscope/db build

echo.
echo Done! Type errors should be fixed.
