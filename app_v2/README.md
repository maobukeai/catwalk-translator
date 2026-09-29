# 猫步翻译

Windows 桌面截图、划词与原位翻译工具。前端使用 React/TypeScript，桌面端使用 Tauri/Rust。OCR 模型由用户在软件内下载，不随安装包分发。

## 使用

1. 安装 Windows 安装包并启动应用。首次使用可以跟随引导快速下载 Tiny；新安装的默认设置是均衡档 PP-OCRv6 Small，但引导若主动启用 Tiny 会保存这次选择。Tiny 更快，Medium 需要手动选择。
2. 按 `F4` 进入截图划词，框选屏幕文字。快捷键可在“设置 → 快捷键与 AI 模型”修改。
3. 设置顶部“常用入口”可直达 OCR 模型、翻译通道与显示偏好。浏览或下载模型不会改变当前默认；点击“设为默认并启用”后才切换。
4. 译文卡片可切换原文/译文/双语视图。结果右下角“本次耗时与来源”可查看截图准备、OCR＋排版、首屏绘制等待、首轮翻译耗时、缓存复用及每段实际翻译来源；仅在本机显示，不上传诊断数据。

## 效果与限制

原位覆盖、结果面板、翻译引擎和 OCR 是不同环节。文字识别正确并不保证翻译正确或覆盖画面自然；复杂纹理、极小字、图标混排与密集终端仍可能失败。请保留失败时的原文，利用单段重试、切换结果面板或重划较小区域；不要期待任意截图 100% 正确。

质量复现与已知边界见 [OCR_QUALITY_PLAN.md](OCR_QUALITY_PLAN.md)。用户提供的几类截图已保存在 `src-tauri/tests/fixtures/`，用于 OCR 回归。新增视觉问题应同时保留原图、OCR 框、译文与最终覆盖截图，避免只以文字准确率验收显示效果。

开发模式下打开 `http://127.0.0.1:1420/overlay-visual.html`，可在真实截图上以 1:1 尺寸对照原位覆盖。这个页面是 CSS/排版回归样例，不替代在实际桌面窗口验证截图坐标、原生背景补丁和不同 DPI。

## 开发与验证

需要 Node.js、pnpm、Rust 和 Tauri 的 Windows 构建依赖。

```powershell
pnpm install
pnpm tauri dev
pnpm test
pnpm build
cd src-tauri
cargo test --lib
```

打包 Windows NSIS 安装包：

```powershell
pnpm tauri build -- --bundles nsis
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。开发时请保留既有模型、设置和用户数据；重新打包不等于正在运行的旧程序已更新。建议在干净环境与已有配置环境各验证一次启动、下载模型、截图翻译和回退路径。
