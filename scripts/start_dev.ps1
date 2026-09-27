# 猫步翻译 - 开发调试启动脚本
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "猫步翻译 - 实时开发调试"

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "            猫步翻译 [Catwalk Translator] - 实时开发调试" -ForegroundColor Yellow
Write-Host "  * 前端热重载 (Vite HMR): 修改 React/TSX/CSS 界面秒级实时刷新" -ForegroundColor DarkGray
Write-Host "  * 后端热重载 (Cargo Watch): 修改 Rust 代码自动重新编译并重载" -ForegroundColor DarkGray
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 释放端口与历史僵死进程
& "$PSScriptRoot\clean_dev.ps1"
Write-Host ""

# 2. 定位到前端工程目录
$RootDir = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $RootDir "app_v2"
Set-Location $AppDir

# 3. 优先选用 pnpm，若未安装则回退 npm
$pkg = if (Get-Command pnpm -ErrorAction SilentlyContinue) { "pnpm" } else { "npm" }
Write-Host "[*] 正在启动热重载开发调试服务 ($pkg run tauri dev)..." -ForegroundColor Green
Write-Host ""

& $pkg run tauri dev
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "[!] 开发调试服务已退出 (ExitCode: $exitCode)" -ForegroundColor Yellow
}
exit $exitCode
