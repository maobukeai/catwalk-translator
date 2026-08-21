# 🐾 猫步翻译 (Catwalk Translator)

<p align="center">
  <img src="app_icon.png" width="128" height="128" alt="猫步翻译 Logo" />
</p>

<p align="center">
  <b>专为 3D/CG 创作者、设计师、游戏玩家与极客打造的新一代轻量、沉浸式桌面 AI 截图划词翻译神器</b>
</p>

<p align="center">
  <a href="https://github.com/maobukeai/catwalk-translator/releases"><img src="https://img.shields.io/github/v/release/maobukeai/catwalk-translator?style=flat-square&color=38bdf8" alt="Release" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20x64-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri-2.0-orange?style=flat-square" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square" alt="React" />
  <img src="https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square" alt="Rust" />
  <img src="https://img.shields.io/badge/Language-中文简体-brightgreen?style=flat-square" alt="Language" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

---

## 🌟 核心特性亮点

### 1. ⚡ 毫秒级原生 OCR 引擎
- **本地 ONNX 离线识别**：内置轻量级 PP-OCRv3/v4/v5 引擎支持，无需网络连接即可秒级提取屏幕文本。
- **Windows 10/11 原生 OCR 免模型直连**：零模型体积依赖，开箱即用。
- **高 DPI 像素级映射**：完美兼容 100%、125%、150%、200% 等 Windows 多显示器缩放比例，识别框零偏移。

### 2. 🎯 三级级联智能翻译流水线
- **专业 CG 词库毫秒直出**：内置 Blender、Substance 3D、Unity、Unreal Engine、Maya、Houdini 等数万条行业专业术语库。
- **主流大模型 (LLM) 深度整合**：原生支持 DeepSeek-V3 / R1、OpenAI GPT-4o-mini、Ollama 本地大模型、智谱 GLM 及任意 OpenAI 兼容 API。
- **在线引擎智能兜底**：集成 Google Translate、Bing、有道等高可用免费在线引擎，网络波动自动无缝降级。

### 3. 🎨 原位覆盖与智能背景拾色 (In-situ Overlay)
- **4px 外环中值色取样**：自动提取原文背景色，自适应生成高可读性前景色。
- **双模渲染**：支持卡片原位覆盖模式（Immersion）与面板聚合展示模式（Panel）。

### 4. 🛠️ 选区微调与专业截图标注
- **8 锚点自由调整选区**：划框后支持自由缩放、拖拽与方向键像素级微调。
- **丰富标注工具箱**：内置矩形框选、指示箭头、画笔涂鸦、马赛克遮挡等一站式截图编辑工具。

### 5. 🔄 区域变动监控 (Watch Mode)
- 选定屏幕区域后按 `W` 键，软件将自动以毫秒级周期监控区域文字变化，动态重译，专为实时渲染面板、游戏与视频界面量身定制。

### 6. 📖 生词本与复习强化
- 查词一键收藏至生词本（`Ctrl+D`），支持发音朗读、上下文回溯与生词记忆巩固。

---

## ⌨️ 常用快捷键速查

| 快捷键 | 功能说明 |
| :--- | :--- |
| `F4` | 唤起屏幕截图与划词翻译覆盖层 |
| `Alt + Space` | 呼出 Spotlight 快速查词 / 划词面板 |
| `Alt + Q` | 快速显示 / 隐藏主翻译窗口 |
| `W` (在覆盖层中) | 开启 / 停止当前选区的动态区域监控 (Watch Mode) |
| `Enter` / `Ctrl + C` | 复制当前全部译文 |
| `Esc` | 取消选区 / 关闭当前覆盖窗口 |
| `Tab` / `Shift + Tab` | 快速轮播切换翻译引擎 (DeepSeek / OpenAI / Blender 词典等) |

---

## 📦 下载与安装指南

请进入 [GitHub Releases 发布页面](https://github.com/maobukeai/catwalk-translator/releases/tag/v0.0.1) 下载对应格式文件：

| 安装包类型 | 文件名 | 说明 |
| :--- | :--- | :--- |
| **Windows 中文安装包 (强烈推荐)** | `猫步翻译_0.0.1_x64-setup.exe` | 纯中文安装引导，体积仅 ~7.2MB，支持覆盖升级与自动桌面图标 |
| **Windows MSI 安装包** | `猫步翻译_0.0.1_x64_zh-CN.msi` | 适用于 Windows 批量部署与标准 MSI 管理环境 |
| **绿色便携免安装版** | `猫步翻译_0.0.1_x64_portable.exe` | 单文件独立运行，无需安装，解压即用 |

### 🔄 覆盖安装与升级说明
- 安装包采用智能覆盖安装机制，直接运行最新安装包即可**自动就地升级**，无需手动卸载旧版本；
- 软件配置与生词本历史记录独立保存在系统 `%APPDATA%` 中，覆盖安装**绝对不会丢失您的 API Key、个性化设置与生词记录**。

---

## 💻 开发者指南

### 环境依赖
- [Node.js](https://nodejs.org/) (v18+) & `pnpm` 或 `npm`
- [Rust](https://rustup.rs/) (1.75+) 与 Cargo
- Windows 10/11 x64 (附带 WebView2 运行时)

### 本地运行与构建
```bash
# 进入前端与 Tauri 工程目录
cd app_v2

# 安装前端依赖
npm install

# 启动本地开发（热重载）
npm run tauri dev

# 打包生产安装包与独立运行版
npm run tauri build
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
