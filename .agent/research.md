# Product Evolution Research Report — Round 2: 01/09 UI/UX

> **演进轮次**：Round 2 (Product Evolution Mode)  
> **当前轮盘阶段**：01/09 UI/UX 视觉与交互极致打磨 (Visual & Interaction Refinement)  
> **研究对象**：CG AI Screenshot Translator (`app_v2`)  
> **报告生成时间**：2026-08-11  
> **角色**：研究 Agent (Research Agent) — *只研究、不写代码*

---

## 1. 当前状态分析 (Current State Analysis)

### 1.1 产品使命与当前基线状态
**CG AI Screenshot Translator (`app_v2`)** 致力于消除三维数字艺术与游戏开发（Blender / Substance 3D / Unity / Unreal Engine / Maya）中的语言门槛。
- **架构技术栈**：Tauri 2.0 (Rust) + React 19 + TypeScript + Tailwind CSS 4 + RapidOCR ONNX (PP-OCRv4) + Zustand。
- **核心健康度指标矩阵 (Health Matrix)**：
  - 端到端划词翻译 E2E 延迟：~185ms (基线 <250ms，评级：🟢 EXCELLENT)
  - PP-OCRv4 本地推理延迟：~65ms (基线 <120ms，评级：🟢 EXCELLENT)
  - 本地 CG 词库毫秒级命中：<1ms (基线 <5ms，评级：🟢 EXCELLENT)
  - 待机内存：~118MB / 峰值内存：~185MB (基线 <300MB，评级：🟢 EXCELLENT)
  - 单文件便携 EXE 体积：~39.8MB (基线 <45MB，评级：🟢 EXCELLENT)

### 1.2 现有 UI/UX 能力与代码审查 (Codebase Audit)
通过对 `app_v2/src/` 与 `.agent/` 历史记录的深度审查：
1. **双层混合覆盖浮层 (`CaptureOverlay.tsx`)**：
   - 实现了全屏 `rgba(0, 0, 0, 0.38)` 半透明遮罩、动态跟随光标的细虚线十字准星与 `(X, Y)` 坐标指示。
   - 具备选区尺寸指示气泡（`📐 W × H px`）与四角 L 型白色角标。
   - 具备阶段化识别动效（`识别中... -> 翻译中... -> 渲染中...`）与 LLM 降级感知警告 Banner。
   - 支持 Pin 锁定（`Ctrl+P`）、单项复制、朗读发音（`Space`）、多语种胶囊切换与 AI 模型循环切换（`Tab`）。
2. **主窗口与控制面板 (`DualPaneTranslator.tsx`, `Sidebar.tsx`, `TitleBar.tsx`)**：
   - 采用 Mica/Acrylic 风格毛玻璃质感、极光流光背景与暗色主题。
   - 多源翻译结果横向滚动 Tab 栏，具备弹性滑动与左右渐变遮罩。

### 1.3 存在的核心缺陷与体验断点 (Identified UX & Engineering Gaps)
通过运行现有自动化测试套件 (`npm test`) 与实际用户交互场景推演，发现以下关键缺陷与痛点：
1. **测试断言与 DOM 层级耦合问题**：
   - `src/tests/m4_overlay_sampler.test.tsx` 失败：`findByText('BSDF 材质')` 获取到了卡片内部的 `<span className="truncate">`，导致 `expect(card.className).toContain('overlay-block')` 断言失败。需要在测试或组件中规范卡片根容器与文本载体的层级关系。
2. **IPC 数据防御缺失**：
   - `src/services/tauri.ts` 中 `saveTranslationHistory` 在测试环境 mock 数据不完整时抛出 `TypeError: current.find is not a function`，需加入 `Array.isArray(current)` 防御性类型守卫。
3. **单一覆盖模式遮挡 3D 控件 (Occlusion Pain Point)**：
   - 在 Blender / Substance 属性栏划词时，卡片直接覆盖原位会遮挡相邻的数值输入框与滑块，破坏“边看参数边调节”的工作流。缺少“悬浮气泡 (Floating Tooltip)”模式与“原位覆盖 (In-place Cover)”的双模快速切换。
4. **密集文本行卡片 AABB 碰撞挤压重叠**：
   - 多行密集参数同时识别时，邻近卡片在 Y 轴上容易重叠；气泡在屏幕顶部边界容易被截断。缺少独立的 AABB 碰撞避让与边界夹取算法。
5. **快捷键系统缺少可视化 CheatSheet 速查面板**：
   - 当前支持十余种高效快捷键（`F4`, `Ctrl+P`, `Space`, `Tab`, `M`, `Enter`, `Ctrl+D`, `Shift+拖拽`, `1~6`, `?`, `F1`），但新手用户缺乏一目了然的速查面板。
6. **CG 专属术语缺少行内高亮与释义卡片**：
   - 命中 Blender / Substance 词典的专业术语未在主窗口和覆层中做视觉差异化着重渲染（如天蓝色虚线下划线与 `🧊 CG` 徽标），缺乏悬停专业释义。

---

## 2. 调研发现 (Research Findings & Benchmark)

### 2.1 竞品与业界标杆深度对比

| 标杆产品 / 规范 | 核心 UI/UX 优势 | 交互亮点与设计哲学 | 对本项目的演进借鉴 |
| :--- | :--- | :--- | :--- |
| **Bob (macOS) / Pot Desktop** | 桌面级划词翻译标杆 | 支持“原位覆盖”与“悬浮气泡”双形态；支持多引擎并发与快捷键速查 | 引入 `overlayViewMode` 切换机制（`Cover` vs `Tooltip`），气泡带指示三角且不遮挡原 UI |
| **PixPin / Snipaste** | 截图与 Pin 贴图巅峰体验 | 极轻量 HUD、贴图发光光晕与防误触锁定反馈 | 借鉴其 Pin 锁定卡片的琥珀金多层光晕、Toast 及时微反馈与选区精准像素指示 |
| **Raycast / Alfred** | 键盘优先 (Keyboard-First) | 全局热键随叫随到、内置 Visual CheatSheet 速查、无冗余视觉干扰 | 引入 `?` / `F1` CheatSheet 模态框，统一 `<kbd>` 按键视觉标签与等宽字体排版 |
| **Immersive Translate** | 专业双语对照与术语高亮 | 术语悬浮词典卡片、精准虚线下划线、原文/译文上下对照 | 在覆盖卡片与主面板对命中 CG 词典的名词渲染天蓝虚线下划线，Hover 展示参数解释 |
| **Fluent Design 2.0 / Apple HIG** | 现代化桌面设计规范 | Acrylic / Mica 毛玻璃材质、36~44px 触控响应区、Spring 弹性缓动 | 规范按钮 Hit Box，优化进场动效 (`cubic-bezier(0.16, 1, 0.3, 1)`) 与暗色对比度 |

### 2.2 2026 桌面效率与数字艺术工具 UI/UX 核心设计原则
1. **Non-Destructive Context Preservation (非破坏性上下文保留)**：
   - 工具不得打断 3D 创作者的设计心流。通过“浮动气泡”保留原始英文参数对照，通过“原位覆盖”实现沉浸式汉化，赋予用户完全的显示控制权（快捷键 `M` 即时切换）。
2. **Instant Discoverability (高可发现性与零学习成本)**：
   - 优秀工具应具备“渐进式暴露”特性——日常使用极简无感，当用户需要帮助时，按下 `?` 或 `F1` 即可立即获得清晰的快捷键全貌。
3. **Adaptive Contrast & Anti-Halation (自适应对比度与防光晕)**：
   - 避免使用刺眼的纯黑 (#000000) 或纯白 (#ffffff)，采用深灰底色 (`#121216` ~ `#18181c`) 配合柔和浅灰文字 (`#f1f5f9` / `#e2e8f0`)，符合 WCAG AA 4.5:1 对比度标准，长时间在 3D 暗色界面工作不伤眼。

---

## 3. 具体改进方案（可执行，含文件路径）

### 方案 1: HUD 快捷键可视化速查面板 (CheatSheet Modal) 与测试
- **目标**：通过 `?` 或 `F1` 键随时呼出半透明 Acrylic 快捷键指南面板，彻底消除新用户学习门槛。
- **涉及文件路径**：
  - `app_v2/src/components/Overlay/CheatSheetModal.tsx` *(新建独立组件)*
  - `app_v2/src/tests/cheatsheet_modal.test.tsx` *(配套单元测试)*
  - `app_v2/src/components/Overlay/CaptureOverlay.tsx`
  - `app_v2/src/App.tsx`
- **可执行改进细节**：
  1. 创建 `CheatSheetModal.tsx`，采用深色毛玻璃卡片（`backdrop-blur-xl`, `bg-slate-950/85`, `border-white/20`, `shadow-2xl`, `rounded-2xl`）。
  2. 结构化展示四大类快捷键：
     - **📐 划框与选区**：`拖拽` 矩形划词 | `Shift+拖拽` 多选区划词 | `Esc / 右键` 退出选区 | `F4` 划词开关
     - **🃏 卡片与操作**：`Ctrl+P` Pin固定锁定 | `Enter / Ctrl+C` 复制全部译文 | `Space` 语音朗读 | `Ctrl+D` 收藏至生词本
     - **⚙️ 模式与通道**：`M` 原位覆盖/悬浮气泡切换 | `Tab` 循环切换AI模型 | `1~6` 快捷切换目标语种
     - **💡 帮助与指引**：`? / F1` 打开/关闭本速查面板
  3. 按键统一使用专属 `<kbd>` 标签样式（微阴影、圆角边框、等宽字体）。
  4. 监听 `Esc` / `?` / `F1` 触发 `onClose`，点击外部半透明遮罩关闭，符合 WCAG 4.5:1 AA 对比度标准。

---

### 方案 2: AABB 碰撞避让与 Tooltip 浮动定位计算算法
- **目标**：解决密集 3D 控件遮挡与重叠问题，支持精确计算气泡浮动坐标与多卡片垂直避让。
- **涉及文件路径**：
  - `app_v2/src/services/overlayLayout.ts` *(新建布局避让与坐标计算库)*
  - `app_v2/src/tests/overlay_layout.test.ts` *(配套单元测试)*
- **可执行改进细节**：
  1. `resolveAABBCollisions(blocks, containerW, containerH, margin)`：
     - 识别多矩形相交（`overlapY > 2px` 且 `overlapX > 4px`）。
     - 按 Y 轴升序遍历，对重叠块向下施加纵向推移微调（`y += overlapY + margin`）。
     - 若超出容器底部 `containerH`，执行自底向上弹性压缩与安全边界夹取（Clamp）。
  2. `calculateTooltipPosition(block, containerW, containerH, tooltipW, tooltipH)`：
     - 默认在选区上方 `y - tooltipH - 8` 放置气泡，箭头朝下。
     - 若顶部越界 (`y - tooltipH - 8 < 10`)，自动翻转至选区下方 `y + block.logicalH + 8`，箭头朝上。
     - X 坐标在 `[8, containerW - tooltipW - 8]` 范围内 Clamp 夹取，防止左右溢出屏幕。

---

### 方案 3: Store 配置扩展与全局 UI/UX 设计系统样式
- **目标**：打磨全局主题微交互，支持视图模式切换与呼吸光晕。
- **涉及文件路径**：
  - `app_v2/src/services/types.ts`
  - `app_v2/src/stores/useSettingsStore.ts`
  - `app_v2/src/index.css`
- **可执行改进细节**：
  1. `app_v2/src/services/types.ts`：
     - 在 `AppSettings` 接口中扩展 `overlayViewMode?: 'cover' | 'tooltip'` 与 `enableAabbAvoidance?: boolean`。
  2. `app_v2/src/stores/useSettingsStore.ts`：
     - 在 `DEFAULT_SETTINGS` 中默认赋予 `overlayViewMode: 'cover'` 与 `enableAabbAvoidance: true`。
     - 增加 `setOverlayViewMode` 与 `setEnableAabbAvoidance` 方法并支持持久化。
  3. `app_v2/src/index.css`：
     - 新增 `@keyframes pulse-glow-amber` 与 `.pulse-glow-amber`（Pin 锁定卡片琥珀金色呼吸光晕）。
     - 新增 `@keyframes tooltip-pop` 与 `.tooltip-pop`（平滑弹性进场动画 `cubic-bezier(0.16, 1, 0.3, 1)`）。
     - 新增 `.cg-term-highlight` 与 `.cg-term-badge` 样式（天蓝/琥珀虚线下划线与微徽标）。
     - 新增 `.touch-hit-box` 工具类，将小图标按钮可点击感应区扩展至最小 36px~44px。

---

### 方案 4: 主翻译窗口 CG 术语高亮与多引擎对照 Tab 体验打磨
- **目标**：增强专业 CG 术语辨识度与多翻译引擎横向滑动视觉反馈。
- **涉及文件路径**：
  - `app_v2/src/components/MainWindow/DualPaneTranslator.tsx`
  - `app_v2/src/components/Overlay/CaptureOverlay.tsx`
- **可执行改进细节**：
  1. 在 `DualPaneTranslator.tsx` 中检查译文来源：若包含 `Preset`、`CG 词库`、`Blender`、`Substance` 等专业词典来源，为对应卡片添加 `🧊 CG 术语` 标识与天蓝色微发光虚线下划线。
  2. 鼠标悬停在专有名词标牌时，展示释义浮层（含英文原词、中文标准定名与 3D 软件应用提示）。
  3. 优化多引擎 Tab 栏：当左/右存在未滚动内容时显示柔和的渐变遮罩指示器 (`from-black/40 to-transparent`)，左右翻页按钮增加扩展触控区与弹性滚动。

---

### 方案 5: TitleBar 与 Sidebar 触控热区与微交互反馈增强及测试加固
- **目标**：对齐 Fluent 2.0 规范，增强触控热区与微交互，修复历史测试兼容性问题。
- **涉及文件路径**：
  - `app_v2/src/components/TitleBar.tsx`
  - `app_v2/src/components/Sidebar/Sidebar.tsx`
  - `app_v2/src/services/tauri.ts`
  - `app_v2/src/tests/m4_overlay_sampler.test.tsx`
- **可执行改进细节**：
  1. `TitleBar.tsx`：最小化、最大化、关闭按钮触控热区扩展至 36x36px，关闭按钮增加柔和红色背景渐变过渡与 `:active` 按压微缩（`scale(0.95)`）。
  2. `Sidebar.tsx`：为每个导航 Tab 与快捷划词按钮添加 Hover 快捷键气泡提示（如“快捷划词 (F4)”），Active Tab 增加动态平滑光标条与柔和呼吸背景。
  3. `tauri.ts`：在 `saveTranslationHistory` 中增加 `Array.isArray(current) ? current : []` 防御，避免在 mock 环境中抛出 TypeError。
  4. `m4_overlay_sampler.test.tsx`：优化测试用例中对 `OverlayBlockCard` DOM 容器与类名的查询定位，保证 100% 测试通过。

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
本研究报告为 Product Evolution Mode 第 2 轮（阶段：01/09 UI/UX）提供了详尽的现状分析、竞品对标、架构与样式改进方案、技术选型及风险规避策略。下一阶段 Planner Agent 可直接依据本报告的 5 大可执行方案生成具体的拆解任务并分发给 Dev Agents 实施。
