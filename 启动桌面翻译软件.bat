@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动 猫步翻译软件 (桌面原生版)...
start "" python.exe main.py
