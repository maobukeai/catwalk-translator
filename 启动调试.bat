@echo off
title 猫步翻译 - 实时热重载调试终端
color 0B

echo ===================================================================
echo             猫步翻译 (Catwalk Translator) - 实时开发调试
echo   * 前端热重载 (Vite HMR): 修改 React/TSX/CSS 界面秒级实时刷新
echo   * 后端热重载 (Cargo Watch): 修改 Rust 代码自动重新编译并重载
echo ===================================================================
echo.

cd /d "%~dp0app_v2"

echo [*] 正在启动热重载开发调试服务...
echo.

call pnpm run tauri dev
if %errorlevel% neq 0 (
    echo.
    echo [*] 尝试使用 npm 启动...
    call npm run tauri dev
)

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [错误] 开发服务异常退出，请检查上方报错信息。
    echo.
    pause
)
