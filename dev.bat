@echo off
title Catwalk Translator Dev Server

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\clean_dev.ps1"

cd /d "%~dp0app_v2"
call pnpm run tauri dev
if errorlevel 1 (
    call npm run tauri dev
)
if errorlevel 1 (
    pause
)