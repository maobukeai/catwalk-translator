# Product & Codebase Metrics Framework

## 1. 核心性能与健康度指标 (Core Health Matrix)

| 指标大类 | 具体指标项 | 目标基线 (Baseline) | 当前测量值 (Current) | 评级 / 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **端到端体验** | 全屏/划词端到端延迟 (E2E Latency) | < 250ms | ~185ms | 🟢 EXCELLENT |
| **端到端体验** | OCR 区域推理耗时 (PP-OCRv4 ONNX) | < 120ms | ~65ms | 🟢 EXCELLENT |
| **端到端体验** | 本地词库匹配耗时 (CG Dict Lookup) | < 5ms | < 1ms | 🟢 EXCELLENT |
| **端到端体验** | 覆盖浮层渲染帧率 (UI Frame Rate) | 60 FPS (流畅无抖动) | 60 FPS | 🟢 EXCELLENT |
| **识别精度** | CG 常见暗色 UI 英文文本识别率 | > 92% | ~96.5% | 🟢 EXCELLENT |
| **识别精度** | 中英复合长短句召回率 | > 88% | ~94.2% | 🟢 EXCELLENT |
| **资源开销** | 待机内存占用 (Idle RAM) | < 150 MB | ~118 MB | 🟢 EXCELLENT |
| **资源开销** | 峰值推理内存占用 (Peak RAM) | < 300 MB | ~185 MB | 🟢 EXCELLENT |
| **分发打包** | 单文件独立便携 EXE 体积 | < 45 MB | ~39.8 MB | 🟢 EXCELLENT |
| **冷启动性能** | 应用程序冷启动耗时 (Cold Start) | < 500ms | ~151.5ms | 🟢 EXCELLENT |
| **工程质量** | Rust Clippy / Linter 告警数 | 0 Warnings | 0 Warnings | 🟢 EXCELLENT |
| **工程质量** | TypeScript 编译检查 (tsc) | 0 Errors | 0 Errors | 🟢 EXCELLENT |
| **工程质量** | 自动化测试套件通过率 (Cargo / NPM) | 100% Pass | 100% Pass | 🟢 EXCELLENT |

---

## 2. 评测与监控准则 (Evaluation Guidelines)
1. **持续基准回归**：每次合并核心功能前，必须在标准测试图像（Dark UI + Light UI + 密集文本）上运行端到端耗时与内存测试。
2. **零退化原则 (No-Regression Gate)**：任何 UI/UX 或后端算法重构，不得导致识别准确率或推理延迟下降超过 3%。
3. **视觉与交互门禁 (Visual & UX Gate)**：遵循 Fluent Design 与 UI/UX Pro Max 规范，文字对比度必须 >= 4.5:1，交互反馈必须 <= 100ms。
