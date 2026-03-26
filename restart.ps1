# Restart DevScope Project
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Restart DevScope Project" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/2] Cleaning ports (Web:3000, API:3100)..." -ForegroundColor Yellow
$ports = @(3000, 3100)
$found = $false

foreach ($port in $ports) {
    $process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
               Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue

    if ($process) {
        Write-Host "  Port $port : PID $process" -ForegroundColor Red
        Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
        $found = $true
    }
}

if (-not $found) {
    Write-Host "  No process found using ports" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/2] Starting project..." -ForegroundColor Yellow
Write-Host ""
pnpm dev
