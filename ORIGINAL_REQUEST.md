# Original User Request

## 2026-08-08T16:15:20Z

<USER_REQUEST>
重构并升级现有的 CG AI 截图翻译器为基于 Tauri 2.0 (Rust) + React 18 + RapidOCR ONNX 的现代高颜值桌面应用，支持 CG/3D 软件专有词库、多级混合翻译管道（Preset + LLM + 传统 API）以及高分屏（DPI）精确选区原位覆写。

Working directory: c:\Users\20269\Desktop\项目文件夹\翻译软件
Integrity mode: development

## Requirements

### R1. 高颜值 UI 与桌面容器 (Tauri 2.0 + React 18)
基于 Tauri 2.0 与 React 18 (Vite + TailwindCSS) 搭建现代化桌面应用骨架，支持暗黑/ Fluent Design 风格设置面板、全局热键配置、系统托盘以及选区原位 Canvas/Web 浮窗渲染。

### R2. 高性能端侧 OCR 与坐标转换 (Rust ONNX ort)
在 Rust 后端整合原生 ONNX Runtime (ort) 加载 RapidOCR 推理模型，完成全屏/局部选区文本识别。基于 PhysicalPosition / PhysicalSize 进行逻辑坐标与物理像素的双向映射，保证多显示器与不同 DPI 缩放比例下选区与渲染浮层绝对对齐。

### R3. 多级混合翻译管道 (Multi-Tier Translation Pipeline)
构建结合 CG/3D 专业词库缓存（Blender/Substance/Unity 字典）、LLM 大模型 API（DeepSeek / OpenAI / Ollama）与传统翻译 API（Google/DeepL）的多级翻译管道，确保术语准确与长句理解。

### R4. 模块化多智能体与测试审核闭环 (Multi-Agent Subagent-Driven Workflow)
遵循基建先遣 (Infra-First)、契约驱动 (Contract-First Mock) 与错误熔断 (Circuit Breaker) 规范，配合自动化测试套件（cargo test 与 npm test）确保软件质量。

## Acceptance Criteria

### A1. 功能与性能验收
- [ ] 应用体积不大于 40MB，启动响应时间小于 500ms。
- [ ] 全局热键（如 Ctrl+Alt+D）可稳定触发屏幕选区。
- [ ] 在 Windows 100%、125%、150% 等不同 DPI 缩放及多显示器环境下，选区与覆写浮层错位小于 1 像素。
- [ ] Blender/Substance 专有名词（如 Principled BSDF）能够优先精准匹配为中文术语。

### A2. 代码与构建闭环验收
- [ ] 前端 npm run build 和 npm run test 无 Error / Warning。
- [ ] 后端 cargo check 和 cargo test 100% 通过。
- [ ] 完整构建出便携版 Windows EXE 文件。
</USER_REQUEST>
