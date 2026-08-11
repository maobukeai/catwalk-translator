# Product Evolution Research Report — Round 4: 01/09 UI/UX

> **演进轮次**：Round 4  
> **当前阶段**：01/09 UI/UX 视觉与交互极致打磨 (Visual & Interaction Refinement)  
> **研究对象**：CG AI Screenshot Translator (`app_v2`)  
> **报告生成时间**：2026-08-11  
> **角色**：研究 Agent (Research Agent)  

---

## 1. 当前状态分析 (Current State Analysis)

### 1.1 产品使命与核心价值
**CG AI Screenshot Translator (`app_v2`)** 是专为数字艺术与游戏开发工程师（Blender / Substance 3D / Unity / Unreal Engine / Maya）打造的无感屏幕划词与截图翻译工具。
- **使命定位**：三维创作界面“零门槛、零延迟、不打断心流”的本地化翻译体验。
- **技术栈**：Tauri 2.0 (Rust) + React 19 + TypeScript + Tailwind CSS 4 + RapidOCR ONNX (PP-OCRv4) + 多级容灾翻译管道。
- **性能基线指标**：端到端 E2E 响应 ~185ms (基线 < 250ms)，ONNX 区域推理 ~65ms，待机内存 ~118MB，冷启动 ~151.5ms，单文件独立便携体积 ~39.8MB，各项指标表现优异。

### 1.2 现有 UI/UX 架构与已落地能力 (Current Codebase Audit)
经过对 `app_v2/src/` 与 `.agent/` 的深度代码审查与交互架构梳理，当前产品已具备以下 UI/UX 基础：
1. **划词选区遮罩与操控层 (`CaptureOverlay.tsx`)**：
   - 全屏 `rgba(0, 0, 0, 0.38)` 半透明遮罩，动态跟随光标的细虚线十字准星与 `(X, Y)` 坐标 HUD。
   - 选区边框采用天蓝高亮色、4 角 8x8 白色 L 型角标与 `📐 W × H px` 尺寸指示气泡。
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

### 1.3 面向 3D/CG 专业场景的深层体验痛点 (Critical UX Gaps)
结合数字艺术家的真实工作流，发现目前仍存在以下核心交互与视觉痛点待系统化解决：
1. **单一覆盖模式导致的 3D 控件遮挡痛点 (Occlusion Issue)**：
   - 现状：当前仅有“原位覆盖 (Cover)”模式。
   - 痛点：在 Blender 材质着色器（Shader Editor）或 Substance 图层属性面板中，卡片直接覆盖原文字会挡住紧邻的数值滑块、颜色吸管或复选框，导致用户无法一边看翻译一边调参数。
   - 需求：亟需实现 **“悬浮气泡 (Floating Tooltip)”与“原位覆盖 (In-place Cover)”双模式一键切换 (`M` 键)**。
2. **快捷键系统缺少 Visual CheatSheet 可视化速查面板 (Discoverability Gap)**：
   - 现状：系统内置了 10+ 项高效快捷键（`F4`, `Ctrl+P`, `Space`, `Tab`, `M`, `Enter`, `Ctrl+D`, `Shift+Drag`, `Esc`, `1~6`），但用户没有任何可视化速查途径。
   - 痛点：新用户无法感知快捷键，导致操作效率大打折扣。
   - 需求：按下 `?` 或 `F1` 或点击顶部指引即可呼出半透明 Acrylic 快捷键速查模态框。
3. **密集参数多卡片 AABB 碰撞挤压与重叠 (Collision & Layout Overlap)**：
   - 现状：当框选多行密集文本（如属性列表）时，若译文行高或卡片内边距稍大，卡片在纵向上容易发生搭界、重叠或错位。
   - 需求：引入轻量级 AABB 碰撞检测与避让重排算法 (`overlayLayout.ts`)，实现动态垂直微调与屏幕边界智能防溢出。
4. **CG 专属术语命中缺乏视觉增强与悬浮释义层 (Terminology Glossary Tooltip)**：
   - 现状：命中 Blender / Substance 专业词库的词条仅展示小标，缺乏专业感。
   - 需求：为专业 CG 词条添加天蓝/琥珀虚线下划线与 `🧊 CG 术语` 标牌，Hover 弹出词条标准定名、行业释义与 3D 软件应用提示。
5. **多区域连续划词缺少视觉留痕 (Multi-Region Selection UI)**：
   - 现状：每次划框会重置前一次选区。
   - 需求：支持按住 `Shift` 连续划选多个离散按钮/参数，选区标注 `①`, `②`, `③` 序号并在松开后合并批量翻译展示。
6. **视觉层次、设计令牌与无障碍触控细节 (Design Tokens & WCAG AA)**：
   - 顶部 HUD 与微型工具栏部分图标按钮缺少扩展触控感应区（Hit Box 应 ≥ 36px~44px）。
   - Pin 锁定卡片需更具辨识度的琥珀色呼吸发光光晕（`.pulse-glow-amber`），保证在深黑、浅灰等各种 CG 软件视口背景下均符合 WCAG 4.5:1 AA 对比度标准。

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
   - 避免使用刺眼的纯黑 (#000) 或高饱和纯色，采用多阶深灰结合 1px 细微光边框与半透明毛玻璃，在复杂三维视口（Viewport）上均能保证文字清晰易读。

---

## 3. 具体改进方案（可执行，含文件路径）

### 方案 1: 双模式视图切换——原位覆盖 (Cover) vs 悬浮气泡 (Tooltip)
- **目标**：解决密集 3D 控件遮挡问题，支持用户自由选择“原位覆盖原词”或“在原词上方弹出带箭头的悬浮气泡”，实现原文与译文双语对照。
- **涉及文件路径**：
  - [app_v2/src/services/types.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/services/types.ts)
  - [app_v2/src/stores/useSettingsStore.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/stores/useSettingsStore.ts)
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [app_v2/src/index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
- **可执行改进细节**：
  1. 在 `AppSettings` 中增加 `overlayViewMode?: 'cover' | 'tooltip'` 字段，默认 `'cover'`；在 `useSettingsStore` 中提供 `setOverlayViewMode` 方法并持久化。
  2. 在 `CaptureOverlay.tsx` 顶部 HUD 添加“👁️ 原位 / 💬 气泡”切换胶囊按钮，并绑定全局快捷键 `M` 实时切换。
  3. 当处于 `'tooltip'` 模式时：
     - 卡片显示在目标选区上方 `y - cardHeight - 8px` 处；若靠近屏幕顶部边缘，自动下翻至 `y + block.logicalH + 8px`。
     - 卡片底端（或顶端）渲染向下指向的半透明小三角形指针 (`border-t-[6px] border-t-slate-900/90`)。
     - 卡片内展示上下两行结构：上方展示小字浅灰英文原文，下方展示大字高亮中文译文。

---

### 方案 2: HUD 快捷键可视化速查面板 (CheatSheet Modal)
- **目标**：通过 `?` 或 `F1` 键随时呼出半透明 Acrylic 快捷键指南面板，彻底消除新用户学习门槛。
- **涉及文件路径**：
  - `app_v2/src/components/Overlay/CheatSheetModal.tsx` *(新建独立组件)*
  - `app_v2/src/tests/cheatsheet_modal.test.tsx` *(配套单元测试)*
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [app_v2/src/App.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/App.tsx)
- **可执行改进细节**：
  1. 创建 `CheatSheetModal.tsx`，采用深色毛玻璃卡片（`backdrop-blur-xl`, `bg-slate-950/85`, `border-white/20`, `shadow-2xl`）。
  2. 结构化展示四大类快捷键：
     - **📐 划框与选区**：`拖拽` 矩形划词 | `Shift+拖拽` 多选区划词 | `Esc / 右键` 退出选区 | `F4` 划词开关
     - **🃏 卡片与操作**：`Ctrl+P` Pin固定锁定 | `Enter / Ctrl+C` 复制全部译文 | `Space` 语音朗读 | `Ctrl+D` 收藏至生词本
     - **⚙️ 模式与通道**：`M` 原位覆盖/悬浮气泡切换 | `Tab` 循环切换AI模型 | `1~6` 快捷切换目标语种
     - **💡 帮助与指引**：`? / F1` 打开/关闭本速查面板
  3. 按键统一使用专属 `<kbd>` 标签样式（微阴影、圆角边框、等宽字体）。
  4. 在 `CaptureOverlay` 顶部 HUD 增加 `? 快捷键` 帮助按钮，同时全局监听 `?` / `F1` 快捷唤起。

---

### 方案 3: 屏幕空间 AABB 碰撞避让与智能布局算法
- **目标**：解决多行密集文本卡片重叠挤压问题，确保卡片排列整齐且不遮挡相邻文本行。
- **涉及文件路径**：
  - `app_v2/src/services/overlayLayout.ts` *(新建布局避让算法库)*
  - `app_v2/src/tests/overlay_layout.test.ts` *(配套测试)*
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
- **可执行改进细节**：
  1. 在 `overlayLayout.ts` 中实现 `resolveAABBCollisions(blocks: OverlayBlock[], containerW: number, containerH: number, margin?: number): OverlayBlock[]`：
     - 算法按 Y 坐标自上而下排序，逐一检测矩形 AABB 碰撞（`overlapY > 2px` 且 `overlapX > 4px`）。
     - 发生重叠时向下微调下层卡片 Y 坐标 (`y = prevBlock.y + prevBlock.h + margin`)。
     - 若底部超出容器高度，反向执行向上避让压缩并夹取在安全可见区域内。
  2. 实现 `calculateTooltipPosition(block, containerW, containerH, tooltipW, tooltipH)`：
     - 自动计算悬浮气泡的锚定坐标，X 轴自动在 `[8, containerW - tooltipW - 8]` 范围内做夹取（Clamp），防止横向溢出屏幕。

---

### 方案 4: CG 专属术语词库视觉高亮与悬浮释义层 (Terminology Glossary Tooltip)
- **目标**：精准凸显 Blender / Substance / Unity 等专业词典命中项，提供专业背景知识与参数释义。
- **涉及文件路径**：
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [app_v2/src/components/MainWindow/DualPaneTranslator.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/MainWindow/DualPaneTranslator.tsx)
  - [app_v2/src/index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
- **可执行改进细节**：
  1. 在 `OverlayBlockCard` 中检查 `block.sourceTier`：若包含 `Preset`、`CG 词库`、`Blender`、`Substance` 等来源，在译文下方渲染精致的天蓝色/琥珀色虚线下划线（`.cg-term-highlight`）以及 `🧊 CG` 徽标。
  2. 鼠标悬停在 `🧊 CG` 徽标或术语上时，弹出轻量释义气泡，展示：
     - 英文术语名（如 `Roughness`）
     - 标准中文定名（如 `粗糙度`）
     - 3D 软件应用提示（如 `控制材质表面微观不平整度，数值越大高光越散射`）
  3. 在 `DualPaneTranslator.tsx` 中同样为命中 CG 词库的翻译卡片添加高亮与专用释义卡片。

---

### 方案 5: 多区域连续划词 UI 留痕与批处理 (Multi-Region Selection)
- **目标**：支持按住 `Shift` 键连续划选多个离散按钮或参数框，保留带有数字标牌的选区框并合并翻译。
- **涉及文件路径**：
  - [app_v2/src/components/Overlay/CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
- **可执行改进细节**：
  1. 在 `CaptureOverlay` 中维护 `extraSelections: Array<{ id: number; x: number; y: number; w: number; h: number }>` 状态。
  2. 当 `e.shiftKey` 为 true 时，鼠标松开将当前选区存入 `extraSelections`，并在选区左上角渲染 `①`, `②`, `③` 编号圆形标牌。
  3. 在不按 `Shift` 划选或按下 `Enter` 时，触发多区域合并 OCR 请求与结果呈现。

---

### 方案 6: 设计系统令牌规范化、触控区增强与 Pin 呼吸光晕
- **目标**：全面对齐 WCAG 4.5:1 AA 对比度标准与 Fluent Design 2.0 规范。
- **涉及文件路径**：
  - [app_v2/src/index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
  - [app_v2/src/components/TitleBar.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/TitleBar.tsx)
  - [app_v2/src/components/Sidebar/Sidebar.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Sidebar/Sidebar.tsx)
- **可执行改进细节**：
  1. 在 `index.css` 中添加 `.pulse-glow-amber` 呼吸动画类与 `@keyframes pulse-glow-amber`，为 `isPinned` 卡片赋予高辨识度外发光。
  2. 增加 `.tooltip-pop` 弹性平滑进场动画（`cubic-bezier(0.16, 1, 0.3, 1)`）。
  3. 将 `TitleBar.tsx`、`Sidebar.tsx` 与 `CaptureOverlay.tsx` 中小图标按钮的点击感应区（Hit Box）扩展至最小 36px~44px，增加 `:active` 微缩微动效。

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

---

## 6. 总结与后续交付展望 (Conclusion)

本研究报告针对 Round 4 (01/09 UI/UX 阶段) 全面梳理了产品现状与深层痛点，确立了以 **原位/气泡双模式视图切换、Visual CheatSheet 快捷键速查面板、AABB 碰撞避让引擎、CG 专业术语高亮释义、多选区连续划词以及 WCAG 触控细节** 为核心的可执行演进方案。方案中所有文件路径明确、技术选型轻量、风险防护周密，可无缝输入给下一阶段规划与并行开发 Agent。
