# Product Evolution Research Report — Round 5: 01/09 UI/UX

> **演进轮次**：Round 5  
> **当前阶段**：01/09 UI/UX 视觉与交互极致打磨 (Visual & Interaction Refinement)  
> **研究对象**：CG AI Screenshot Translator (`app_v2`)  
> **报告生成时间**：2026-08-11  
> **角色**：研究 Agent (Research Agent)  

---

## 1. 当前状态分析 (Current State Analysis)

### 1.1 产品使命与核心价值定位
**CG AI Screenshot Translator (`app_v2`)** 是一款专为 3D 概念设计师、建模师、渲染师、游戏引擎开发者与技术美术 (TA) 打造的轻量级无感屏幕划词与截图翻译工具。
- **使命宣言**：“让 CG 软件（Blender / Substance 3D / Unity / Unreal Engine / Maya）界面零门槛本地化，鼠标框选即翻译，消除语言障碍，释放数字创作生产力。”
- **技术栈**：Tauri 2.0 (Rust) + React 19 + TypeScript + Tailwind CSS 4 + RapidOCR ONNX (PP-OCRv4) + Zustand + 多级容灾翻译管道。
- **当前核心健康度指标**：
  - 端到端 E2E 响应：~185ms (基线指标 < 250ms)
  - PP-OCRv4 区域推理耗时：~65ms (基线指标 < 120ms)
  - 待机内存：~118MB，峰值内存：~185MB (基线 < 300MB)
  - 应用程序冷启动耗时：~151.5ms (基线 < 500ms)
  - 单文件便携 EXE 体积：~39.8MB (基线 < 45MB)
  - Rust Clippy 编译：0 告警，纯净通过

### 1.2 现有 UI/UX 架构与已落地能力 (Current Codebase Audit)
经过对 `app_v2/src/` 与 `.agent/` 的深度代码审查与交互架构梳理，当前产品已具备以下 UI/UX 基础：
1. **双层混合覆盖浮层架构 (`CaptureOverlay.tsx`)**：
   - 全屏 `rgba(0, 0, 0, 0.38)` 半透明遮罩，动态跟随光标的细虚线十字准星与 `(X, Y)` 坐标 HUD。
   - 选区框天蓝高亮色、4 角 8x8 白色 L 型角标与 `📐 W × H px` 尺寸指示气泡。
2. **原位覆盖卡片与微交互 (`OverlayBlockCard`)**：
   - 4px 外环中值背景色采样与动态自适应字号（10px~22px），支持长短句防截断计算。
   - 悬停微型工具栏：📋 单项复制（附带 `✓` 动画）、🔊 英文语音朗读（`Space` 触发）、来源词库标牌展示。
   - Pin 锁定机制：支持 `Ctrl+P` 或图钉按钮锁定卡片，避免误触退出并支持卡片自由拖拽。
3. **顶部控制条与系统反馈**：
   - AI 大模型与翻译通道下拉选择（支持 `Tab` 键循环切换）、6 种目标语种胶囊切换（中/英/日/韩/德/法）。
   - 阶段化加载状态提示（`识别中... -> 翻译中... -> 渲染中...`）与 LLM 自动降级感知警告 Banner。
   - 快捷操作包含 `F4` 快速唤起/退出、`Enter` / `Ctrl+C` 复制全部译文、`Ctrl+D` 一键收藏至生词本。
4. **主界面与多源对照面板 (`DualPaneTranslator.tsx`, `Sidebar.tsx`, `TitleBar.tsx`)**：
   - Fluent Design / Mica 风格极光动态毛玻璃背景与微粒纹理。
   - 支持多源翻译引擎横向滑动 Tab 栏（带左右渐变遮罩指示与弹性滚动）。
   - 自定义标题栏原生拖拽与无边框窗口控制。

### 1.3 代码与测试全景审查 (Codebase & Test Health Audit)
在对代码库运行静态检查和自动化测试时，发现了以下需在 UI/UX 阶段一并收敛和解决的关键工程与体验缺陷：
1. **TypeScript 编译类型错误**：
   - 在 [app_v2/src/App.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/App.tsx#L80) 第 80 行中使用了 `settings.hotkeyEnabled`，而类型定义 [app_v2/src/services/types.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/services/types.ts#L175) 中实际字段为 `captureHotkeyEnabled`，导致 `npx tsc --noEmit` 失败。
2. **测试断言与 DOM 结构不匹配**：
   - 在 [app_v2/src/tests/m4_overlay_sampler.test.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/tests/m4_overlay_sampler.test.tsx#L83) 中，测试使用 `screen.findByText('BSDF 材质')` 抓取到了 `OverlayBlockCard` 内部嵌套的 `<span className="truncate">`，导致 `expect(card.className).toContain('overlay-block')` 失败。`OverlayBlockCard` 的结构需保持整洁，或者在卡片容器上直接提供文本内容，确保样式与可测性统一。
3. **历史记录保存的非空防护**：
   - 在 [app_v2/src/services/tauri.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/services/tauri.ts#L739) 中，`saveTranslationHistory` 假设 `cmdGetHistory()` 一定返回数组，但在部分 Mock/IPC 异常时可能出现 `TypeError: current.find is not a function`，需要加入 `Array.isArray(current)` 容错。
4. **Round 4 规划资产未落盘**：
   - 快捷键可视化速查面板 (`CheatSheetModal.tsx`) 与屏幕空间 AABB 碰撞避让算法 (`overlayLayout.ts`) 在上一轮完成了详细设计，但尚未实际合并入 `src/`，本轮应正式作为高优先级组件交付。

### 1.4 面向 3D/CG 专业场景的深层交互痛点 (Critical UX Gaps)
1. **单一覆盖模式导致 3D 控件遮挡 (Occlusion Issue)**：
   - 痛点：在 Blender 节点编辑器（Shader Editor）或 Substance 属性面板中，卡片直接覆盖原文字会遮挡紧邻的数值滑块、颜色吸管或复选框，破坏创作者边对照边调参的工作流。
   - 需求：亟需实现 **“悬浮气泡 (Floating Tooltip)”与“原位覆盖 (In-place Cover)”双模式一键切换 (`M` 键)**。
2. **快捷键系统缺少 Visual CheatSheet 可视化速查 (Discoverability Gap)**：
   - 痛点：系统内置了丰富快捷键（`F4`, `Ctrl+P`, `Space`, `Tab`, `M`, `Enter`, `Ctrl+D`, `Shift+Drag`, `Esc`, `1~6`），但用户缺少直观速查渠道。
   - 需求：按下 `?` 或 `F1` 或点击顶部指引即可呼出半透明 Acrylic 快捷键速查模态框。
3. **密集参数多卡片 AABB 碰撞挤压与重叠 (Collision & Layout Overlap)**：
   - 痛点：框选多行密集属性列表时，卡片在纵向上容易重叠错位。
   - 需求：引入轻量级 AABB 碰撞检测与避让重排算法 (`overlayLayout.ts`)，实现动态垂直微调与屏幕边界智能防溢出。
4. **CG 专属术语命中缺乏视觉增强与悬浮释义层 (Glossary Tooltip)**：
   - 需求：为命中 CG 专业词库的名词添加天蓝虚线下划线与 `🧊 CG` 标牌，Hover 弹出词条标准定名、行业释义与 3D 软件应用提示。
5. **无障碍触控细节与微交互反馈 (Design Tokens & WCAG AA)**：
   - 顶部 HUD 与微型工具栏部分小图标按钮触控响应区需扩展至 ≥ 36px~44px，提供清晰的 `:active` 按压反馈与 Pin 锁定琥珀金色微光呼吸光晕（`.pulse-glow-amber`）。

---

## 2. 调研发现 (Research Findings & Benchmark)

### 2.1 竞品与业界标杆深度对比

| 标杆产品 / 设计规范 | 核心 UI/UX 优势 | 交互亮点与设计哲学 | 对本项目的演进借鉴 |
| :--- | :--- | :--- | :--- |
| **PixPin / Snipaste** | 桌面截图与 Pin 贴图巅峰体验 | 极轻量 HUD、选区四角吸附微调、贴图发光光晕与防误触锁定反馈 | 借鉴其 Pin 锁定卡片的琥珀金多层光晕、Toast 微反馈与选区精准像素指示 |
| **Bob (macOS) / Pot Desktop** | 桌面级划词翻译标杆 | 支持“原位覆盖”与“浮动气泡 (Tooltip)”双模式；支持多源对照与快捷键速查 | 引入 `overlayViewMode` 切换机制（`Cover` vs `Tooltip`），气泡模式带指示三角且不遮挡原 UI |
| **Raycast / Alfred** | 键盘优先 (Keyboard-First) 生产力 | 全局热键随叫随到、内置 Visual CheatSheet 速查、无冗余视觉干扰 | 引入 `?` / `F1` CheatSheet 模态框，统一 `<kbd>` 按键视觉标签与等宽字体排版 |
| **Immersive Translate (沉浸式翻译)** | 专业术语库与双语高亮 | 术语悬浮词典卡片、精准虚线下划线、原文/译文上下对照 | 在覆盖卡片上对命中 Tier 1 CG 词典的名词渲染天蓝虚线下划线，Hover 展示参数解释 |
| **Fluent Design 2.0 / Apple HIG** | 现代化桌面设计规范 | Acrylic / Mica 毛玻璃材质、44×44pt 触控响应区、Spring 弹性缓动 | 规范按钮 Hit Box，优化进场动效 (`cubic-bezier(0.16, 1, 0.3, 1)`) 与暗色对比度 |

### 2.2 2026 桌面效率与数字艺术工具 UI/UX 核心设计原则
1. **Non-Destructive Context Preservation (非破坏性上下文保留)**：
   - 工具不得打断 3D 创作者的设计心流。通过“浮动气泡”保留原始英文参数对照，通过“原位覆盖”实现沉浸式汉化，赋予用户完全的显示控制权。
2. **Instant Discoverability (高可发现性与零学习成本)**：
   - 优秀工具应具备“渐进式暴露”特性——日常使用极简无感，当用户需要帮助时，按下 `?` 或 `F1` 即可立即获得清晰的快捷键全貌。
3. **Adaptive Contrast & Micro-Haptics (自适应对比度与微动效)**：
   - 避免使用刺眼的纯黑 (#000) 或高饱和纯色，采用多阶深灰结合 1px 细微光边框与半透明毛玻璃，在复杂三维视口（Viewport）上均能保证文字清晰易读（符合 WCAG AA 4.5:1 对比度）。

---

## 3. 具体改进方案（可执行，含文件路径）

### 方案 1: 双模式视图切换——原位覆盖 (Cover) vs 悬浮气泡 (Tooltip) 与 AABB 布局避让
- **目标**：解决密集 3D 控件遮挡问题，支持用户自由选择“原位覆盖原词”或“在原词上方弹出带箭头的悬浮气泡”，实现原文与译文双语对照，同时通过 AABB 算法避免密集卡片上下重叠。
- **涉及文件路径**：
  - `app_v2/src/services/overlayLayout.ts` *(新建布局避让算法库)*
  - `app_v2/src/tests/overlay_layout.test.ts` *(配套单元测试)*
  - [app_v2/src/services/types.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/services/types.ts)
  - [app_v2/src/stores/useSettingsStore.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/stores/useSettingsStore.ts)
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [app_v2/src/index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
- **可执行改进细节**：
  1. 在 `AppSettings` 中新增 `overlayViewMode?: 'cover' | 'tooltip'` 与 `enableAabbAvoidance?: boolean` 字段。
  2. 在 `useSettingsStore` 中提供 `setOverlayViewMode` 与 `setEnableAabbAvoidance` 方法并持久化。
  3. 在 `overlayLayout.ts` 中实现：
     - `resolveAABBCollisions(blocks, containerW, containerH, margin)`：按 Y 轴排序检测相交矩形（`overlapY > 2px` 且 `overlapX > 4px`），纵向推移微调并进行屏幕边缘安全夹取。
     - `calculateTooltipPosition(block, containerW, containerH, tooltipW, tooltipH)`：默认在上方 `y - tooltipH - 8` 显示气泡，顶部越界时自动翻转到底部 `y + block.logicalH + 8`，横向在 `[8, containerW - tooltipW - 8]` Clamp 夹取。
  4. 在 `CaptureOverlay.tsx` 顶部 HUD 增加模式切换胶囊，并支持全局按键 `M` 快捷切换。

---

### 方案 2: HUD 快捷键可视化速查面板 (CheatSheet Modal)
- **目标**：通过 `?` 或 `F1` 键随时呼出半透明 Acrylic 快捷键指南面板，彻底消除新用户学习门槛。
- **涉及文件路径**：
  - `app_v2/src/components/Overlay/CheatSheetModal.tsx` *(新建独立组件)*
  - `app_v2/src/tests/cheatsheet_modal.test.tsx` *(配套单元测试)*
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [app_v2/src/App.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/App.tsx)
- **可执行改进细节**：
  1. 创建 `CheatSheetModal.tsx`，采用深色毛玻璃卡片（`backdrop-blur-xl`, `bg-slate-950/85`, `border-white/20`, `shadow-2xl`, `rounded-2xl`）。
  2. 结构化展示四大类快捷键：
     - **📐 划框与选区**：`拖拽` 矩形划词 | `Shift+拖拽` 多选区划词 | `Esc / 右键` 退出选区 | `F4` 划词开关
     - **🃏 卡片与操作**：`Ctrl+P` Pin固定锁定 | `Enter / Ctrl+C` 复制全部译文 | `Space` 语音朗读 | `Ctrl+D` 收藏至生词本
     - **⚙️ 模式与通道**：`M` 原位覆盖/悬浮气泡切换 | `Tab` 循环切换AI模型 | `1~6` 快捷切换目标语种
     - **💡 帮助与指引**：`? / F1` 打开/关闭本速查面板
  3. 按键统一使用专属 `<kbd>` 标签样式（微阴影、圆角边框、等宽字体）。
  4. 监听 `Esc` / `?` / `F1` 触发 `onClose`，符合 WCAG 4.5:1 AA 对比度标准。

---

### 方案 3: 卡片 DOM 结构修复与类型/测试健壮性加固
- **目标**：修复 `App.tsx` 中的类型不匹配与 `m4_overlay_sampler.test.tsx` 测试失败，确保工程 100% 绿色通过。
- **涉及文件路径**：
  - [app_v2/src/App.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/App.tsx)
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [app_v2/src/services/tauri.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/services/tauri.ts)
  - [app_v2/src/tests/m4_overlay_sampler.test.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/tests/m4_overlay_sampler.test.tsx)
- **可执行改进细节**：
  1. 在 `App.tsx` 中将 `settings.hotkeyEnabled` 修正为 `settings.captureHotkeyEnabled ?? (settings as any).hotkeyEnabled ?? true`，消解 TypeScript 编译错误。
  2. 在 `OverlayBlockCard` 中优化 DOM 层次结构，使 `.overlay-block` 容器能被测试和屏幕阅读器准确识别。
  3. 在 `tauri.ts` 的 `saveTranslationHistory` 中，对 `cmdGetHistory()` 返回值加入 `Array.isArray(current) ? current : []` 防御，避免未处理异常。

---

### 方案 4: CG 专属术语词库视觉高亮与悬浮释义层 (Terminology Glossary Tooltip)
- **目标**：精准凸显 Blender / Substance / Unity 等专业词典命中项，提供专业背景知识与参数释义。
- **涉及文件路径**：
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [app_v2/src/components/MainWindow/DualPaneTranslator.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/MainWindow/DualPaneTranslator.tsx)
  - [app_v2/src/index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
- **可执行改进细节**：
  1. 在 `OverlayBlockCard` 与 `DualPaneTranslator` 中检查 `sourceTier`：命中 `Preset` / `Blender` / `Substance` 等专业词典时，渲染精致的天蓝色/琥珀色虚线下划线（`.cg-term-highlight`）以及 `🧊 CG` 徽标。
  2. 鼠标悬停弹出轻量释义气泡，展示英文原词、中文标准定名与 3D 软件应用提示（如 `Roughness -> 粗糙度：控制材质表面微观不平整度，数值越大高光越散射`）。

---

### 方案 5: TitleBar、Sidebar 与 Overlay 触控热区扩展与微交互打磨
- **目标**：对齐 Fluent 2.0 规范，增强交互反馈与无障碍触控体验。
- **涉及文件路径**：
  - [app_v2/src/components/TitleBar.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/TitleBar.tsx)
  - [app_v2/src/components/Sidebar/Sidebar.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Sidebar/Sidebar.tsx)
  - [app_v2/src/index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
- **可执行改进细节**：
  1. `TitleBar.tsx`：将最小化、最大化、关闭按钮的触控响应区（Hit Box）扩展至 36x36px，关闭按钮增加柔和红色背景过渡与 `:active` 按压微缩（`scale(0.95)`）。
  2. `Sidebar.tsx`：为每个导航项与划词按钮添加 Hover 快捷键气泡提示（如“快捷划词 (F4)”），Active 项增加平滑发光指示条与呼吸背景。
  3. `index.css`：增加 `@keyframes pulse-glow-amber`（Pin 锁定微光光晕）与 `@keyframes tooltip-pop`（平滑进场弹性动效）。

---

## 4. 技术选型建议 (Technology Selection Recommendations)

1. **零外部重型依赖原则 (Zero Heavy Dependencies)**：
   - 严禁引入外部重型 UI 组件库（如 MUI / Ant Design），避免破坏便携包体积（维持 <40MB）。
   - 完全基于 **React 19 + TypeScript + Tailwind CSS 4 + Lucide Icons + Zustand** 原生实现所有交互组件。
2. **纯 CSS GPU 硬件加速与 Composite-Only 动效**：
   - 浮动 Tooltip、Toast、CheatSheet 弹窗位移动画仅使用 `transform: translate3d(...)` 和 `opacity`，启用 `will-change: transform`，避免引发浏览器重排（Reflow）。
3. **极轻量 AABB 算法时间复杂度**：
   - 单次截图识别文本块数量通常在 1~30 块之间，AABB 碰撞检测与避让计算时间复杂度为 $O(N \log N)$，单次运算耗时 <0.5ms，完全无感。

---

## 5. 风险评估 (Risk Assessment)

| 风险项 | 严重程度 | 触发场景 | 规避与应对措施 |
| :--- | :--- | :--- | :--- |
| **高 DPI / 多显示器混用导致 Tooltip 气泡坐标偏移** | 中 (Medium) | 4K 主屏 (150% DPI) 与 1080P 副屏混用 | 统一采用 `scaleFactor`（`window.devicePixelRatio`）进行逻辑像素与物理像素的双向精准换算。 |
| **密集卡片过多时的 DOM 节点渲染压力** | 低 (Low) | 单次框选了包含 40+ 行文本的巨型代码/表格区域 | 对识别结果设置阈值保护（超过 30 块自动聚合提示或提供紧凑滚动容器），确保 60 FPS 渲染帧率。 |
| **全局快捷键 `?` / `M` 与文本输入框冲突** | 低 (Low) | 用户在主界面的搜索框或输入框中键入字母 | 在所有全局按键监听器头部统一校验 `(e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA'`。 |
| **测试环境 Mock IPC 返回值类型不一致** | 低 (Low) | `npm test` 运行时 `cmdGetHistory` 返回 undefined 或非数组对象 | 在前端调用链中严格进行 `Array.isArray()` 前置类型守卫与默认空数组兜底。 |

---

## 6. 总结与后续交付展望 (Conclusion)
本研究报告为 Product Evolution Mode 第 5 轮（阶段：01/09 UI/UX）提供了详尽的现状分析、竞品对标、架构与样式改进方案、技术选型及风险规避策略。下一阶段 Planner Agent 可直接依据本报告的 5 大可执行方案生成具体的拆解任务并分发给 Dev Agents 实施。
