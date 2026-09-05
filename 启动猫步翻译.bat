@echo off
chcp 65001 >nul
title 猫步翻译 - 实时开发调试
color 0B

echo ===================================================================
echo             猫步翻译 [Catwalk Translator] - 实时开发调试
echo   * 前端热重载 [Vite HMR]: 修改 React/TSX/CSS 界面秒级实时刷新
echo   * 后端热重载 [Cargo Watch]: 修改 Rust 代码自动重新编译并重载
echo ===================================================================
echo.

echo [*] 正在检测并释放 1420 端口与历史进程...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\clean_dev.ps1"
echo.

cd /d "%~dp0app_v2"
echo [*] 正在启动热重载开发调试服务...
echo.

call npm run tauri dev
if %errorlevel% equ 0 goto :done

echo.
echo [*] 正在重新清理残留端口与环境并尝试使用 pnpm 启动...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\clean_dev.ps1"
cd /d "%~dp0app_v2"
call pnpm run tauri dev
if %errorlevel% equ 0 goto :done

color 0C
echo.
echo [错误] 开发服务异常退出，请检查上方报错信息。
echo.
pause

:done
