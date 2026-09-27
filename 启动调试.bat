@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_dev.ps1"
if %errorlevel% neq 0 (
    echo.
    pause
)
