@echo off
title Catwalk Translator Dev Server

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r /c:":1420 .*LISTENING"' ) do (
    taskkill /f /pid %%a >nul 2>&1
)
taskkill /f /im MaobuTranslator.exe >nul 2>&1

cd /d "%~dp0app_v2"
call pnpm run tauri dev
if errorlevel 1 (
    call npm run tauri dev
)
if errorlevel 1 (
    pause
)

