# Product Evolution Research Report — Round 3: 01/09 UI/UX

> **演进轮次**：Round 3  
> **当前阶段**：01/09 UI/UX 视觉与交互打磨  
> **研究对象**：CG AI Screenshot Translator (`app_v2`)  
> **报告生成时间**：2026-08-11  
> **角色**：研究 Agent (Research Agent)  

---

## 1. 当前状态分析 (Current Status Analysis)

### 1.1 产品现状与使命契合度
**CG AI Screenshot Translator (`app_v2`)** 是一款专注于数字艺术与游戏开发工程师（Blender / Substance 3D / Unity / Unreal Engine / Maya）的轻量级无感屏幕划词与截图翻译工具。
- **架构基础**：基于 Tauri 2.0 (Rust) + React 19 + TypeScript + Tailwind CSS 4 + RapidOCR ONNX (PP-OCRv4)。
- **性能基线**：端到端延迟约 185ms (目标 < 250ms)，ONNX 区域推理约 65ms，待机内存 118MB，打包体积 39.8MB (目标 < 45MB)。各项基线指标均优异。

### 1.2 已完成 UI/UX 基础设施与已有演进 (v0.1.0 ~ v0.2.0 Baseline)
根据对 `/.agent/` 历史文档及 `/app_v2/src/` 代码库的全面梳理，已实现并验证的 UI/UX 特性包括：
1. **选区半透明遮罩与操控 HUD (`CaptureOverlay.tsx`)**：
   - 全屏 `rgba(0, 0, 0, 0.38)` 选区遮罩、动态虚线十字准心、实时 `(X, Y)` 坐标气泡、选区 4 角 8x8 L 型角标与 `📐 W × H px` 尺寸悬浮气泡。
2. **原位覆盖翻译卡片 (`OverlayBlockCard`)**：
   - 动态收放字号计算 (10px~22px)，支持悬浮微工具栏 (📋 一键复制 / 🔊 英文语音朗读 / 词库来源标牌)。
   - 支持卡片鼠标自由拖拽与 `Ctrl+P` / 图钉按钮 Pin 锁定（防误触关闭）。
3. **顶部 HUD 控制条与降级感知 Banner**：
   - AI 大模型与翻译通道下拉选择 (支持 `Tab` 循环切换)、6 种常用目标语种胶囊切换 (中/英/日/韩/德/法)。
   - 阶段化加载文字 (识别中... -> 翻译中... -> 渲染中...) 与 LLM 降级感知警告 Banner。
4. **主界面与多源对照面板 (`DualPaneTranslator.tsx`, `Sidebar.tsx`, `TitleBar.tsx`)**：
   - Fluent Design / Mica 风格毛玻璃极光渐变背景与动态微粒纹理。
   - 支持多源引擎并行对照卡片展示、横向滑动 Tab 栏与一键置顶显示。

### 1.3 结合 3D/CG 专业场景发现的深层 UX 痛点与体验短板
针对 Blender / Substance / Unity 等密集参数面板真实使用场景，分析发现如下核心交互与视觉短板：
1. **密集参数面板遮挡问题与模式单一**：
   - 目前仅提供“原位覆盖 (In-place Cover)”模式。在 3D 软件密集属性栏（如 Blender 材质节点属性）中，卡片直接覆盖原文字会遮挡邻近的数值输入框或颜色选择器。用户强烈需要 **“悬浮气泡 (Floating Tooltip)”** 模式以实现原文与译文双语对照。
2. **多区域连续划词缺少交互与视觉留痕 (Multi-Region Selection)**：
   - 目前每次在 Overlay 上拖拽划框会清空前一次选区（除非已 Pin 锁定）。对于需要一次性划选 3D 面板上多个离散按钮/菜单项的场景，缺乏按住 `Shift` 连续划选并标注 `①`, `②`, `③` 选区序号并合并翻译的交互。
3. **快捷键系统缺少 Visual CheatSheet 快捷键速查面板**：
   - 系统内置了 `F4`、`Ctrl+P`、`Space`、`Tab`、`Enter`、`Ctrl+D`、`Esc` 等高效快捷键，但没有任何可视化的快捷键指引面板。新手用户无法直观学习，导致大量高效快捷键沉没。
4. **CG 专属术语词库命中缺乏视觉增强与悬浮解释**：
   - 命中 Blender / Substance 专业词库的译文没有突出视觉标识（如专有名词下划线或 `🧊 CG 术语` 徽标），且无法悬浮查看该参数在 3D 软件中的标准定义与用法。
5. **多行密集卡片纵向重叠与 AABB 碰撞挤压**：
   - 当框选多行密集单字时，卡片边缘在纵向上容易发生微小叠压，缺少 AABB 碰撞微调与边框防挤压避让计算。
6. **触控与按键 Hit Area 和视觉对比度细节**：
   - 顶部 HUD 部分图标按钮尺寸较小 (16~20px)，缺乏扩展 Touch Target (Hit Box ≥ 44×44pt)；在特定亮色或高对比 3D 视图背景下，暗色卡片与悬浮工具栏的边框识别度需遵照 WCAG 4.5:1 AA 标准持续增强。

---

## 2. 调研发现 (Research Findings & Design Trends)

### 2.1 竞品分析与桌面划词 UI/UX 标杆对比

| 竞品/标杆工具 | 核心 UI/UX 优势 | 交互亮点与设计哲学 | 对本项目的演进借鉴 |
| :--- | :--- | :--- | :--- |
| **PixPin / Snipaste** | 桌面截图与 Pin 贴图标杆 | 极致隐形 HUD、选区四角贴合工具栏、贴图阴影与透明度调节 | 学习其 HUD 工具栏贴合选区边缘跟随布局、Pin 锁定卡片的光晕与防误触提示 |
| **Bob (macOS) / Pot Desktop** | 桌面级划词/截图翻译标杆 | 支持“原位覆盖 (Cover)”与“悬浮气泡 (Tooltip)”双模式切换，侧边栏多引擎实时并行对照 | 在 `CaptureOverlay` 增加 `displayMode` 开关，Tooltip 模式附带三角指向指针，不遮挡 3D 控件 |
| **Immersive Translate (沉浸式翻译)** | 双语对照与专有名词库 | 译文与原文上下排版，专业术语下划线 + Hover 气泡释义 | 对命中 Tier 1 CG 词库的术语增加微型 `🧊 CG` 标牌与虚线下划线，Hover 展示术语解析 |
| **Fluent Design 2.0 / Apple HIG** | 现代化 UI 设计规范 | 44×44pt 触控响应区、`backdrop-filter: blur(20px)` 层次感、弹性 Spring Transitions (150~250ms) | 全面规范图标 Hit Box，优化卡片 hover 与拖拽的 Spring 缓动动效 |

### 2.2 2026 桌面效率工具 UI/UX 演进趋势
1. **Context-Preserving Dual-Display (上下文保留与双模式展示)**：
   - 效率工具的核心原则是“不打扰工作流 (Flow State)”。对于 3D 渲染与编程面板，提供原位替换与浮动气泡两套模式，让用户自主决定是否遮挡原 UI。
2. **Keyboard-First Discoverability (快捷键优先与高可发现性)**：
   - 纯快捷键工具如果缺乏浮动 HUD 指引（CheatSheet），使用门槛极高。通过按下 `?` 或 `F1` 唤起可视化按键面板是解决快捷键沉没的标准实践。
3. **Adaptive Contrast & Micro-Feedback (自适应对比度与微反馈)**：
   - 包含操作完成 Toast、防误触锁屏提示、音效/光晕感知等微反馈，能提升软件的高级感与操控确定感。

---

## 3. 具体改进方案（可执行，含文件路径）

### 方案 1: 双模式视图——原位覆盖 (Cover Mode) vs 悬浮气泡 (Tooltip Mode)
- **目标**：解决原位覆盖遮挡 3D 软件原始英文参数的痛点，支持快捷键 `M` 或 HUD 按钮在“原位覆盖”与“悬浮气泡”间无缝切换。
- **可执行文件路径**：
  - [CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [useSettingsStore.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/stores/useSettingsStore.ts)
  - [types.ts](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/services/types.ts)
  - [index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
- **改进设计细节**：
  1. 在 `useSettingsStore` 中增加 `overlayViewMode: 'cover' | 'tooltip'` 字段，默认值为 `'cover'`。
  2. 在 `CaptureOverlay.tsx` 顶部 HUD 增加“👁️ 原位 / 💬 气泡”胶囊切换按钮，并绑定 `M` 键快捷切换。
  3. 当为 `'tooltip'` 模式时，`OverlayBlockCard` 自动计算并偏移至选区上方 `y - cardHeight - 8px` 处（顶部溢出时自动下弹至 `y + block.logicalH + 8px`），外加向下指向箭头三角指示器，展示 “原文 ➔ 译文” 双语对比。

### 方案 2: 多区域连续划词 (Multi-Region Selection UI Mask)
- **目标**：支持按住 `Shift` 键连续划选多个屏幕不相邻区域（如多个节点参数），并在蒙版上保留深天蓝选区框与 `①`, `②`, `③` 序号，松开后并发 OCR 并合并展示。
- **可执行文件路径**：
  - [CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
- **改进设计细节**：
  1. 在 `CaptureOverlay` 组件中新增 `extraSelections: SelectionBox[]` 状态。
  2. 当 `e.shiftKey` 为 true 时，`onMouseUp` 将当前划选框推入 `extraSelections` 数组，保留带有数字编号标牌 (`①`, `②`, `③`) 的选区边框。
  3. 松开 `Shift` 键或按 `Enter` 触发批量多区域 OCR 和卡片渲染。

### 方案 3: HUD 快捷键速查面板 (CheatSheet Modal)
- **目标**：按下 `?` 或 `F1` 呼出半透明 Acrylic 快捷键指南面板，极大提升功能可发现性。
- **可执行文件路径**：
  - `app_v2/src/components/Overlay/CheatSheetModal.tsx` *(新建 HUD 组件)*
  - [CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [App.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/App.tsx)
- **改进设计细节**：
  1. 创建 `CheatSheetModal.tsx`，以 Grid 结合 kbd 样式列举快捷键：
     - **选区操控**：`拖拽` 划框 | `Esc / 右键` 退出 | `F4` 划词开关
     - **卡片交互**：`Ctrl+P` Pin 锁定 | `Enter / Ctrl+C` 复制译文 | `Space` 发音 | `Ctrl+D` 收藏
     - **模式与通道**：`M` 原位/气泡模式切换 | `Tab` 循环 AI 模型 | `Shift+Drag` 多选区划词 | `? / F1` 本速查面板
  2. 在 `CaptureOverlay.tsx` 中增加 `isCheatSheetOpen` 状态，捕获 `?` 与 `F1` 键触发显隐。

### 方案 4: CG 专属术语命中视觉高亮与悬浮释义层
- **目标**：对命中 Blender / Substance / Unity 专属词库的专业名词添加特有视觉标识与悬浮解释。
- **可执行文件路径**：
  - [CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [DualPaneTranslator.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/MainWindow/DualPaneTranslator.tsx)
  - [index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
- **改进设计细节**：
  1. 在 `OverlayBlockCard` 中检查 `block.sourceTier`。若包含 `Preset` 或 `Blender/Substance/Unity`，为卡片加上琥珀/天蓝虚线下划线与 `🧊 CG` 专属标牌。
  2. 鼠标 Hover 悬停时弹出一个极轻量 Hover 卡片，显示该 CG 术语的原始英文、对应中文释义及参数应用提示（如“Roughness: 粗糙度，控制材质高光散射程度”）。

### 方案 5: 多卡片 AABB 碰撞避让与防遮挡微调算法
- **目标**：防止密集多行文本划选时卡片上下重叠搭挤。
- **可执行文件路径**：
  - `app_v2/src/services/overlayLayout.ts` *(新建布局避让辅助算法)*
  - [CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
- **改进设计细节**：
  1. 封装 `resolveAABBCollisions(blocks: OverlayBlock[]): OverlayBlock[]` 函数。
  2. 遍历检测矩形相交（Bounding Box Intersect），若 Y 轴重叠 > 2px，对下方卡片施加垂直微调偏移 (`+deltaY`)，确保多卡片平行对齐且无视觉交叠。

### 方案 6: 触控区 (Hit Box) 规范化、对比度增强与 Pin 呼吸光晕
- **目标**：满足 UI/UX Pro Max 极致设计规范（WCAG 4.5:1 AA 对比度与触控响应区）。
- **可执行文件路径**：
  - [index.css](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/index.css)
  - [CaptureOverlay.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/Overlay/CaptureOverlay.tsx)
  - [TitleBar.tsx](file:///C:/Users/20269/Desktop/%E9%A1%B9%E7%9B%AE%E6%96%87%E4%BB%B6%E5%A4%B9/%E7%BF%BB%E8%AF%91%E8%BD%AF%E4%BB%B6/app_v2/src/components/TitleBar.tsx)
- **改进设计细节**：
  1. 顶部 HUD 与卡片工具栏中的小图标按钮添加透明内边距，确保最小点击感应区达到 36~44px。
  2. 在 `index.css` 中增加琥珀色渐变呼吸脉冲动效 `@keyframes pulse-glow-amber`，为 `isPinned` 的卡片提供高质感发光外框。
  3. 改进 `glass-card` 的高斯模糊与边框比例，提高在 3D 软件暗色/复杂材质背景下的文本可读性。

---

## 4. 技术选型建议 (Technology Selection Recommendations)

1. **零新增第三方重型依赖 (Zero Heavy Deps)**：
   - 保持项目的轻量化原则（体积 < 40MB），完全基于现有 **React 19 + Tailwind CSS 4 + Lucide Icons + Zustand** 实现 UI 演进。
2. **高效 CSS Transform 与硬件加速**：
   - 动效与平移动画统一使用 `transform: translate3d(...)` 和 `will-change: transform`，避免触发 DOM 重排 (Reflow)。
   - Spring 动效曲线统一采用 `cubic-bezier(0.16, 1, 0.3, 1)`，与系统原生 Fluent 体验保持高度一致。
3. **计算性能与 AABB 防抖**：
   - AABB 避让计算在选区完成瞬间一次性完成，时间复杂度为 $O(N \log N)$（$N \le 30$），开销小于 1ms，不影响端到端 185ms 响应。

---

## 5. 风险评估 (Risk Assessment)

| 风险项 | 严重程度 | 触发场景 | 规避与应对措施 |
| :--- | :--- | :--- | :--- |
| **高 DPI 屏幕 (125%/150%/200%) 下的 Tooltip 气泡坐标偏移** | 中 (Medium) | 多显示器高 DPI 混用环境 | 严格通过 `scaleFactor`（`window.devicePixelRatio`）换算逻辑像素与物理像素，防止气泡偏移。 |
| **密集参数面板卡片过多时的 UI 顿挫** | 低 (Low) | 单次框选识别出超过 30 行零碎参数 | 在 `CaptureOverlay` 中引入并发上限 (Cap at 25 blocks)，多余块使用虚拟化合并，确保 60 FPS 流畅度。 |
| **快捷键 `?` 与输入框 (Input) 输入焦点冲突** | 低 (Low) | 用户在软件搜索框中键入 `?` | 在全局 `keydown` 监听器头部严格校验 `(e.target as HTMLElement).tagName !== 'INPUT'`。 |

---

## 6. 总结 (Conclusion)

本研究报告针对 Round 3 (01/09 UI/UX) 阶段提出了包含 **原位/气泡双模式视图、多选区连续划选 UI、Visual CheatSheet 快捷键速查面板、CG 专属术语高亮悬浮释义、AABB 碰撞避让算法以及 WCAG/Touch 细节打磨** 的完整改进规划。此方案具备高度可执行性，指向明确的源文件路径，为后续开发阶段提供了清晰的技术规范与交互蓝图。
