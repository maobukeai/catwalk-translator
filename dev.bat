@echo off
title Catwalk Translator Dev Server
cd /d "%~dp0app_v2"
call pnpm run tauri dev
if errorlevel 1 (
    call npm run tauri dev
)
if errorlevel 1 (
    pause
)
