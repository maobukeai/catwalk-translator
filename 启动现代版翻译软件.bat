@echo off
chcp 65001 >nul
cd /d "%~dp0app_v2\src-tauri\target\release"
echo 正在启动 猫步翻译软件 (Tauri 2 现代版)...
start "" app_v2.exe
