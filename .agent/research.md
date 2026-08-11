# Product Evolution Research Report — Round 7: 01/09 UI/UX

> **演进轮次**：Round 7 (Product Evolution Mode)  
> **当前轮盘阶段**：01/09 UI/UX 视觉与交互极致打磨 (Visual & Interaction Refinement)  
> **研究对象**：CG AI Screenshot Translator (`app_v2`)  
> **报告生成时间**：2026-08-11  
> **角色**：研究 Agent (Research Agent) — *只研究、不写代码*

---

## 1. 当前状态分析 (Current State Analysis)

### 1.1 产品使命与技术架构基线
**CG AI Screenshot Translator (`app_v2`)** 是一款专为数字艺术概念设计师、3D 建模师、材质师与游戏技术美术 (TA) 打造的轻量级无感屏幕划词与截图翻译工具，深度适配 Blender、Substance 3D (Painter/Designer)、Unity、Unreal Engine 5、Maya、Houdini 等专业 DCC 软件的复杂 Dark UI 界面。

- **系统与技术架构基准**：
  - **宿主/系统层**：Tauri 2.0 (Rust 2021) + GDI/BitBlt 选区毫秒级截取 + 系统托盘常驻与全局透明置顶遮罩窗口。
  - **推理引擎层**：RapidOCR ONNX (PP-OCRv4 DBNet + SVTR 单例常驻架构，CLAHE 暗色 UI 自适应局部直方图增强)。
  - **前端视图层**：React 19 + TypeScript + Tailwind CSS 4 + Lucide Icons + Zustand 状态管理与数据持久化。
- **核心健康度指标矩阵 (Core Health Matrix)**：
  - 端到端划词翻译延迟 (E2E Latency)：~185ms (基线目标 <250ms，评级：🟢 EXCELLENT)
  - PP-OCRv4 区域推理耗时：~65ms (基线目标 <120ms，评级：🟢 EXCELLENT)
  - 本地 CG 专属词库匹配耗时：<1ms (基线目标 <5ms，评级：🟢 EXCELLENT)
  - 待机内存占用：~118MB / 峰值推理内存：~185MB (基线目标 <300MB，评级：🟢 EXCELLENT)
  - 单文件便携 EXE 体积：~39.8MB (基线目标 <45MB，评级：🟢 EXCELLENT)
  - 应用程序冷启动耗时：~151.5ms (基线目标 <500ms，评级：🟢 EXCELLENT)

---

### 1.2 现有 UI/UX 能力与组件全景审计 (Codebase Audit)

| 组件模块 | 文件路径 | 当前已具备的 UI/UX 特性 | 遗留体验断点与进阶空间 |
| :--- | :--- | :--- | :--- |
| **划词覆层** | `src/components/Overlay/CaptureOverlay.tsx` | 1. `rgba(0,0,0,0.38)` 全屏半透明暗化遮罩与动态虚线十字准星<br>2. 实时 `(X, Y)` 坐标指示气泡与 `📐 W×H px` 选区尺寸 HUD<br>3. 阶段化文字过渡 (`识别中... -> 翻译中... -> 渲染中...`)<br>4. Pin 锁定 (`Ctrl+P`)、单条复制、TTS 语音 (`Space`)、多语种胶囊 (`1~6`)、AI 模型循环 (`Tab`) | 1. 仅支持原位覆盖形态，容易遮挡 3D 界面紧凑的数值输入滑块与拾色器<br>2. 密集多行文本块缺乏纵向 AABB 避让算法与安全边界夹取保护<br>3. 缺少键盘快捷键可视化速查面板 (`?` / `F1`)，功能可发现性有待提升 |
| **主翻译器** | `src/components/MainWindow/DualPaneTranslator.tsx` | 1. 左右双栏实时防抖翻译 (350ms Debounce)<br>2. 源语言/目标语言快速互换与语种下拉选择<br>3. 多翻译引擎横向滑动 Tab 栏与并排对比卡片<br>4. 复制反馈、语音朗读与历史自动持久化 | 1. 命中专业 CG 词库的名词缺少行内视觉着重强调与悬浮参数释义<br>2. 多引擎 Tab 栏两侧缺少滚动溢出渐变遮罩与平滑触控回弹 |
| **标题栏** | `src/components/TitleBar.tsx` | 1. 原生 `startDragging()` 窗口拖拽手柄<br>2. 最小化、最大化/还原、关闭三键交互<br>3. 品牌 Logo 与版本号徽标 | 1. 窗口控制按钮触控感应区偏小 (<36px)，未达无障碍触控热区标准<br>2. 关闭按钮缺乏柔和渐变过渡与 `:active` 按压微缩微反馈 |
| **侧边栏** | `src/components/Sidebar/Sidebar.tsx` | 1. 模块化工作台与工具分组导航<br>2. 选中项微型发光指示条与渐变图标底座<br>3. 底部“划词翻译”CTA 按钮与 RapidOCR 状态指示 | 1. 导航项与快捷按钮缺少 Hover 快捷键 Tooltip 提示<br>2. 缺少动态键盘焦点轮廓线 (`focus-visible`) |
| **设置面板** | `src/components/Settings/SettingsDashboard.tsx` | 1. 外观主题、磨砂玻璃模糊度 (0~40px) 调节<br>2. 全局快捷键录制、LLM API 与离线词典配置 | 1. 缺少覆盖模式 (`Cover` vs `Tooltip`) 与 AABB 避让开关项 |

---

### 1.3 关键工程与测试回归断点分析

1. **测试断言层级失效 (`m4_overlay_sampler.test.tsx`)**：
   - **现状**：在 `m4_overlay_sampler.test.tsx:83` 中，`screen.findByText('BSDF 材质')` 获取到了内部 `<span className="truncate">`，直接断言 `card.className.toContain('overlay-block')` 导致失败。
   - **根因**：卡片根容器为 `<div className="overlay-block ...">`，而文本包裹在子元素 `span` 中。
   - **解决方案**：在测试中使用 `card.closest('.overlay-block')` 或在组件根节点增加 `data-testid="overlay-card"`。
2. **Mock 环境数据防御缺失 (`tauri.ts`)**：
   - **现状**：`tauri.ts:739` 中 `saveTranslationHistory` 调用 `const current = await cmdGetHistory()`，在测试 mock 环境中返回值非数组时抛出 `TypeError: current.find is not a function`。
   - **解决方案**：加入 `const currentList = Array.isArray(current) ? current : [];` 防御性守卫。

---

## 2. 调研发现 (Research Findings & Benchmark)

### 2.1 竞品与业界标杆深度对比

| 标杆产品 / 规范 | 核心 UI/UX 亮点 | 设计哲学 | 对本项目的演进借鉴 |
| :--- | :--- | :--- | :--- |
| **Bob (macOS) / Pot Desktop** | 桌面级划词与屏幕取词标杆 | 非破坏性双模切换（原位覆盖 vs 浮动气泡） | 引入 `overlayViewMode` 切换机制；在气泡形态下通过小箭头指向原词，不遮挡 3D 软件参数滑动条 |
| **PixPin / Snipaste** | 截图与贴图交互巅峰 | 像素级精准指示、琥珀金光晕与低干扰 HUD | 选区十字准星提供坐标 HUD；Pin 锁定卡片采用琥珀金多层光晕，杜绝误触关闭 |
| **Raycast / Alfred** | 键盘优先 (Keyboard-First) | 全局随叫随到、内置 Visual CheatSheet 速查 | 引入 `?` / `F1` 呼出 Acrylic 半透明按键速查面板，使用专属 `<kbd>` 样式消除认知成本 |
| **Immersive Translate** | 沉浸式专业双语对照 | 术语虚线下划线与悬停参数百科 | 在主面板与覆盖卡片中对命中 CG 词库的术语渲染天蓝虚线下划线，鼠标悬停展示 3D 软件应用释义 |
| **Fluent Design 2.0 / Apple HIG** | 现代化桌面设计系统 | Mica/Acrylic 材质分层、>=36px 触控响应区 | 规范标题栏与卡片微工具栏 Hit Box，使用 Composite-Only CSS GPU 动画提升流畅度 |

---

### 2.2 2026 数字艺术与 3D/CG 专业工具 UI/UX 核心原则

1. **Non-Destructive Context Preservation (非破坏性上下文保留)**：
   - 3D 创作者在调整材质节点（如 Blender Principled BSDF）或着色器属性（Substance Roughness）时，需要“一边看着原始英文属性，一边调节滑块数值”。浮动气泡模式 (Floating Tooltip) 保留了原始 UI 视线，而原位覆盖模式 (In-place Cover) 适合大段说明文本，两者支持通过快捷键 `M` 即时切换。
2. **Progressive Disclosure & Keyboard Discoverability (渐进式暴露与按键可发现性)**：
   - 极简日常界面保持零视觉噪音；当用户需要了解快捷操作时，按下 `?` 或 `F1` 即可呼出半透明 Acrylic 速查面板，清晰归类选区、卡片、模式与系统快捷键。
3. **Ergonomic Touch Targets & Visual Feedback (符合人机工程的热区与即时反馈)**：
   - 所有可交互按钮感应区扩展至最小 36px×36px，微工具栏和窗口控制按键增加柔和的 `:active` 缩放微反馈（`scale(0.95)`）与流光毛玻璃 Toast 提示。
4. **Spatial AABB Collision Avoidance (空间 AABB 避让算法)**：
   - 针对多行密集界面（如属性面板），通过计算每个卡片的 Bounding Box，避免纵向重叠与边缘裁剪。

---

## 3. 具体改进方案（可执行，含文件路径）

### 方案 1: HUD 快捷键可视化速查面板 (CheatSheet Modal) 与配套测试
- **目标**：实现按 `?` 或 `F1` 快速唤起与退出的 Mica/Acrylic 毛玻璃按键速查面板，让所有高阶交互一目了然。
- **涉及文件路径**：
  - `app_v2/src/components/Overlay/CheatSheetModal.tsx` *(新建独立组件)*
  - `app_v2/src/tests/cheatsheet_modal.test.tsx` *(配套完整单元测试)*
  - `app_v2/src/components/Overlay/CaptureOverlay.tsx`
  - `app_v2/src/App.tsx`
- **可执行细节**：
  1. 创建 `CheatSheetModal.tsx`，采用深色毛玻璃卡片设计（`backdrop-blur-xl`, `bg-slate-950/85`, `border-white/20`, `shadow-2xl`, `rounded-2xl`）。
  2. 结构化四大分组：
     - **📐 选区操作**：`拖拽` 矩形划词 | `Shift+拖拽` 多选区划词 | `Esc / 右键` 退出选区 | `F4` 划词开关
     - **🃏 卡片操作**：`Ctrl+P` Pin固定锁定 | `Enter / Ctrl+C` 复制全部译文 | `Space` 语音朗读 | `Ctrl+D` 收藏至生词本
     - **⚙️ 模式通道**：`M` 原位覆盖/悬浮气泡切换 | `Tab` 循环切换AI模型 | `1~6` 快捷切换目标语种
     - **💡 帮助指引**：`? / F1` 打开/关闭本速查面板
  3. 采用统一定制 `<kbd>` 标签样式（微阴影、圆角边框、等宽字体），符合 WCAG AA 4.5:1 对比度。
  4. 编写 `cheatsheet_modal.test.tsx`，验证打开/关闭、按键渲染、Esc 与外部遮罩点击响应。

---

### 方案 2: AABB 屏幕空间碰撞避让与 Tooltip 浮动定位计算算法
- **目标**：解决多行密集 3D 控件卡片重叠挤压与屏幕边缘越界问题，提供精确气泡浮动坐标计算。
- **涉及文件路径**：
  - `app_v2/src/services/overlayLayout.ts` *(新建布局算法库)*
  - `app_v2/src/tests/overlay_layout.test.ts` *(配套单元测试)*
- **可执行细节**：
  1. `resolveAABBCollisions(blocks: OverlayBlock[], containerW: number, containerH: number, margin?: number): OverlayBlock[]`：
     - 识别多矩形相交（`overlapY > 2px` 且 `overlapX > 4px`）。
     - 按 Y 轴升序遍历，重叠时自上而下施加推移微调（`y += overlapY + margin`）。
     - 若底部越界，执行智能自底向上压缩与安全边界夹取 (Clamp)。
  2. `calculateTooltipPosition(block: OverlayBlock, containerW: number, containerH: number, tooltipW: number, tooltipH: number): { x: number; y: number; placement: 'top' | 'bottom' }`：
     - 默认在选区上方 `y - tooltipH - 8` 放置气泡，箭头朝下。
     - 若顶部空间不足 (`y - tooltipH - 8 < 10`)，自动翻转至下方 `y + block.logicalH + 8`，箭头朝上。
     - X 坐标在 `[8, containerW - tooltipW - 8]` 范围内 Clamp 夹取，防止左右溢出屏幕。
  3. 编写 `overlay_layout.test.ts` 覆盖单块/多块无重叠、密集重叠避让、Tooltip 上下翻转与屏幕左右夹取边界用例。

---

### 方案 3: Store 配置扩展、Dual-Mode 覆盖模式与全局 UI/UX 设计系统样式
- **目标**：扩展状态存储与全局 CSS 工具类，支撑模式切换、琥珀金光晕与弹性动效。
- **涉及文件路径**：
  - `app_v2/src/services/types.ts`
  - `app_v2/src/stores/useSettingsStore.ts`
  - `app_v2/src/index.css`
- **可执行细节**：
  1. `types.ts`：在 `AppSettings` 接口中新增 `overlayViewMode?: 'cover' | 'tooltip'` 与 `enableAabbAvoidance?: boolean`。
  2. `useSettingsStore.ts`：在 `DEFAULT_SETTINGS` 中赋予 `overlayViewMode: 'cover'` 与 `enableAabbAvoidance: true`，增加 `setOverlayViewMode` 与 `setEnableAabbAvoidance` 方法并支持配置持久化。
  3. `index.css`：
     - 新增 `@keyframes pulse-glow-amber` 与 `.pulse-glow-amber`（Pin 锁定卡片琥珀金呼吸光晕）。
     - 新增 `@keyframes tooltip-pop` 与 `.tooltip-pop`（平滑弹性进场动效 `cubic-bezier(0.16, 1, 0.3, 1)`）。
     - 新增 `.cg-term-highlight` 与 `.cg-term-badge` 样式（专属天蓝/琥珀虚线下划线与微徽标）。
     - 新增 `.touch-hit-box` 工具类，扩展图标按钮可点击感应区至最小 36px~44px。

---

### 方案 4: 主翻译窗口与浮层 CG 术语高亮、悬浮释义与多源 Tab 体验打磨
- **目标**：提升 CG 行业专有名词辨识度与多源引擎对比 Tab 栏的交互质感。
- **涉及文件路径**：
  - `app_v2/src/components/MainWindow/DualPaneTranslator.tsx`
  - `app_v2/src/components/Overlay/CaptureOverlay.tsx`
- **可执行细节**：
  1. 在 `DualPaneTranslator.tsx` 中：若译文来源包含 `Preset`、`CG 词库`、`Blender`、`Substance` 等专业词典，渲染 `🧊 CG 术语` 标识与天蓝色微发光虚线下划线。
  2. 鼠标悬停在专有名词或词库标牌时，展示释义浮层（含英文原词、中文标准定名与 3D 软件参数应用提示）。
  3. 优化多引擎 Tab 栏：当左/右存在未滚动内容时显示柔和的渐变遮罩指示器 (`from-black/40 to-transparent`)，左右翻页按钮增加扩展触控区与弹性平滑滚动。

---

### 方案 5: TitleBar 与 Sidebar 无障碍触控热区、微交互动效与测试加固
- **目标**：对齐 Fluent 2.0 桌面无障碍规范，增强微交互反馈，消除测试断言阻断。
- **涉及文件路径**：
  - `app_v2/src/components/TitleBar.tsx`
  - `app_v2/src/components/Sidebar/Sidebar.tsx`
  - `app_v2/src/services/tauri.ts`
  - `app_v2/src/tests/m4_overlay_sampler.test.tsx`
- **可执行细节**：
  1. `TitleBar.tsx`：最小化、最大化、关闭按钮触控热区扩展至 36x36px，关闭按钮增加柔和红色背景渐变过渡与 `:active` 按压微缩（`scale(0.95)`）。
  2. `Sidebar.tsx`：为每个导航 Tab 与快捷划词按钮添加 Hover 快捷键气泡提示（如“快捷划词 (F4)”），Active Tab 增加动态平滑光标条与柔和呼吸背景。
  3. `tauri.ts`：在 `saveTranslationHistory` 中增加 `Array.isArray(current) ? current : []` 防御性守卫。
  4. `m4_overlay_sampler.test.tsx`：优化测试中对 `OverlayBlockCard` DOM 容器的选择器查询，确保 `npm test` 100% 通过。

---

## 4. 技术选型建议 (Technology Selection Recommendations)

1. **零外部重型依赖原则 (Zero Heavy Dependencies)**：
   - 坚决杜绝引入 AntD / MUI 等庞大外部 UI 库，纯基于 **React 19 + TypeScript + Tailwind CSS 4 + Lucide Icons + Zustand** 原生实现，维持安装包体积严格控制在 <40MB。
2. **纯 CSS GPU 合成层硬件加速 (Composite-Only Animations)**：
   - 浮动 Tooltip、Toast、CheatSheet 弹窗位移动画仅使用 `transform: translate3d(...)` 和 `opacity`，启用 `will-change: transform`，避免引发浏览器重排（Reflow）。
3. **轻量 AABB 算法时间复杂度**：
   - 单次截图识别文本块数量通常在 1~30 块之间，AABB 碰撞检测与避让计算时间复杂度为 $O(N \log N)$，单次运算耗时 <0.5ms，完全无感。
4. **高 DPI 双向精准换算 (High-DPI Coordinate Mapping)**：
   - 统一采用 `scaleFactor`（`window.devicePixelRatio`）进行逻辑像素与物理像素的双向精准换算，确保 4K 多屏混用时无像素偏移。

---

## 5. 风险评估 (Risk Assessment)

| 风险项 | 严重程度 | 触发场景 | 规避与应对措施 |
| :--- | :--- | :--- | :--- |
| **高 DPI / 多显示器混用导致 Tooltip 气泡坐标偏移** | 中 (Medium) | 4K 主屏 (150% DPI) 与 1080P 副屏混用 | 统一采用 `scaleFactor`（`window.devicePixelRatio`）进行逻辑像素与物理像素的双向精准换算。 |
| **密集卡片过多时的 DOM 节点渲染压力** | 低 (Low) | 单次框选了包含 40+ 行文本的巨型代码/表格区域 | 对识别结果设置阈值保护（超过 30 块自动聚合提示或提供紧凑滚动容器），确保 60 FPS 渲染帧率。 |
| **全局快捷键 `?` / `M` 与文本输入框冲突** | 低 (Low) | 用户在主界面的搜索框或输入框中键入字母 | 在所有全局按键监听器头部统一校验 `(e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA'`。 |
| **测试环境 Mock IPC 返回值类型不一致** | 低 (Low) | `npm test` 运行时 `cmdGetHistory` 返回 undefined 或非数组对象 | 在前端调用链中严格进行 `Array.isArray()` 前置类型守卫与默认空数组兜底。 |

---

## 6. 演进阶段推进与后续规划 (Stage Transition & Roadmap Next Steps)

本轮研究为 Stage 01/09 (UI/UX) 的全面收官与向 Stage 02/09 (交互体验) 平滑过渡奠定了坚实的技术方案基础。
- **本轮交付物**：本研究报告 `/.agent/research.md`。
- **下阶段指引**：Planner Agent 可直接依据上述 5 大可执行方案拆解生成 `tasks.md` 并指派并行 Dev Agents 实施开发。
