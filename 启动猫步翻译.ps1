<#
.SYNOPSIS
    猫步翻译 (Catwalk Translator) 现代化一键启动与管理工具
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "🐾 猫步翻译 - 管理与启动终端"

function Show-Banner {
    Clear-Host
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host "             🐾 猫步翻译 (Catwalk Translator)" -ForegroundColor Yellow
    Write-Host "      Tauri 2.0 + React 19 + Rust 原生轻量桌面翻译器" -ForegroundColor DarkGray
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host ""
}

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$RootDir\app_v2\package.json")) {
    $RootDir = Get-Location
}
$AppDir = Join-Path $RootDir "app_v2"
$ReleaseExe = Join-Path $AppDir "src-tauri\target\release\MaobuTranslator.exe"
$ReleaseDir = Join-Path $AppDir "src-tauri\target\release"

function Get-PkgManager {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        return "pnpm"
    }
    return "npm"
}

function Check-Env {
    Write-Host "[环境检查]" -ForegroundColor Cyan
    $node = Get-Command node -ErrorAction SilentlyContinue
    $cargo = Get-Command cargo -ErrorAction SilentlyContinue
    $pkg = Get-PkgManager

    if (-not $node) {
        Write-Host "  [-] 未找到 Node.js (https://nodejs.org/)" -ForegroundColor Red
    } else {
        $nodeVer = (& node -v)
        Write-Host "  [+] Node.js: $nodeVer" -ForegroundColor Green
    }

    if (-not $cargo) {
        Write-Host "  [-] 未找到 Rust/Cargo (https://rustup.rs/)" -ForegroundColor Red
    } else {
        $cargoVer = (& cargo -V)
        Write-Host "  [+] Rust: $cargoVer" -ForegroundColor Green
    }

    Write-Host "  [+] 包管理器: $pkg" -ForegroundColor Green

    if (Test-Path $ReleaseExe) {
        Write-Host "  [+] Release 独立程序: 已就绪 (秒级启动可用)" -ForegroundColor Green
    } else {
        Write-Host "  [!] Release 独立程序: 尚未编译 (可使用选项 3 编译或选项 2 调试启动)" -ForegroundColor Yellow
    }
    Write-Host ""
}

function Start-Direct {
    if (Test-Path $ReleaseExe) {
        Write-Host "🚀 正在秒级启动猫步翻译客户端..." -ForegroundColor Green
        Start-Process -FilePath $ReleaseExe -WorkingDirectory $ReleaseDir
        exit 0
    } else {
        Start-Dev
    }
}

function Start-Dev {
    Show-Banner
    Check-Env
    $pkg = Get-PkgManager
    Write-Host "🚀 正在启动猫步翻译开发调试环境 ($pkg run tauri dev)..." -ForegroundColor Yellow
    Write-Host "提示: 正在拉起本地服务与窗口..." -ForegroundColor DarkGray
    Write-Host ""
    Set-Location $AppDir
    & $pkg run tauri dev
}

function Build-Release {
    Show-Banner
    Check-Env
    $pkg = Get-PkgManager
    Write-Host "📦 正在编译发布版本 ($pkg run tauri build)..." -ForegroundColor Yellow
    Set-Location $AppDir
    & $pkg run tauri build -- --no-bundle
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ 编译完成！可执行文件位于: $ReleaseExe" -ForegroundColor Green
    }
}

function Run-Tests {
    Show-Banner
    Check-Env
    $pkg = Get-PkgManager
    Write-Host "🧪 正在执行全量测试套件..." -ForegroundColor Yellow
    Set-Location $AppDir
    Write-Host "`n>>> [1/2] 运行前端 Vitest 测试..." -ForegroundColor Cyan
    & $pkg test -- --run
    Write-Host "`n>>> [2/2] 运行 Rust 后端 Cargo 测试..." -ForegroundColor Cyan
    Set-Location "$AppDir\src-tauri"
    cargo test
    Set-Location $AppDir
}

# 菜单模式
Show-Banner
Check-Env

Write-Host "请选择操作模式 (直接按回车默认秒级启动 [1]):" -ForegroundColor White
Write-Host "  [1] 🚀 秒级直接启动桌面客户端 (已就绪程序 / Dev 模式)" -ForegroundColor Green
Write-Host "  [2] 🛠️ 启动前端+后端热重载开发环境 (Tauri Dev)" -ForegroundColor Cyan
Write-Host "  [3] 📦 重新编译发布版程序 (Release Build)" -ForegroundColor Yellow
Write-Host "  [4] 🧪 运行全量测试套件 (Frontend + Rust Tests)" -ForegroundColor Magenta
Write-Host "  [0] 🚪 退出" -ForegroundColor DarkGray
Write-Host ""
$choice = Read-Host "输入选项 [1/2/3/4/0] (默认 1)"

if ([string]::IsNullOrWhiteSpace($choice)) {
    $choice = "1"
}

switch ($choice) {
    "1" { Start-Direct }
    "2" { Start-Dev }
    "3" { Build-Release; Read-Host "`n按回车键返回..." }
    "4" { Run-Tests; Read-Host "`n按回车键返回..." }
    "0" { exit 0 }
    default { Start-Direct }
}
