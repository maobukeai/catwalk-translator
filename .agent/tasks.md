---
round: 4
stage: 01/09 UI/UX
N: 5
---
## Task 1
name: CheatSheetModal 快捷键可视化速查面板与单元测试
priority: P1
files: app_v2/src/components/Overlay/CheatSheetModal.tsx|app_v2/src/tests/cheatsheet_modal.test.tsx
prompt: 创建独立的快捷键速查面板组件 app_v2/src/components/Overlay/CheatSheetModal.tsx 与配套单元测试 app_v2/src/tests/cheatsheet_modal.test.tsx。1. CheatSheetModal.tsx：采用 Mica/Acrylic 毛玻璃卡片设计 (backdrop-blur-xl, 半透明黑底 bg-slate-950/85, 边框 border-white/20, 阴影 shadow-2xl, 圆角 rounded-2xl)，结构化展示快捷键分类（📐 选区操作：拖拽划词、Shift+拖拽多选、Esc/右键退出、F4开关；🃏 卡片操作：Ctrl+P锁定、Enter/Ctrl+C复制、Space语音朗读、Ctrl+D收藏；⚙️ 模式通道：M切换原位/气泡、Tab切AI模型、1~6切换语种；💡 帮助指引：?/F1速查），使用统一的 <kbd> 按键样式（微阴影、圆角边框、等宽字体），提供右上角关闭按钮，监听 Esc / ? / F1 键触发 onClose，符合 WCAG 4.5:1 AA 对比度标准。2. cheatsheet_modal.test.tsx：编写全面测试用例，验证 isOpen=true 时正确渲染各分组与快捷键内容、点击关闭按钮与按 Esc 触发 onClose 回调、isOpen=false 时不渲染。确保运行 npm test 全部通过。
---
## Task 2
name: AABB 碰撞避让与 Tooltip 浮动定位计算算法
priority: P1
files: app_v2/src/services/overlayLayout.ts|app_v2/src/tests/overlay_layout.test.ts
prompt: 创建独立的屏幕空间布局避让与坐标计算算法模块 app_v2/src/services/overlayLayout.ts 与配套单元测试 app_v2/src/tests/overlay_layout.test.ts。1. overlayLayout.ts：实现 resolveAABBCollisions(blocks: OverlayBlock[], containerWidth: number, containerHeight: number, margin?: number): OverlayBlock[]，检测多个 OverlayBlock 的 Bounding Box 矩形相交（overlapY > 2px 且 overlapX > 4px），在垂直重叠时自上而下施加纵向推移微调（y += overlapY + margin），若底部超出 containerHeight 则执行智能向上压缩与边界夹取；实现 calculateTooltipPosition(block: OverlayBlock, containerWidth: number, containerHeight: number, tooltipW: number, tooltipH: number): { x: number; y: number; placement: 'top' | 'bottom' }，默认在选区上方 y - tooltipH - 8 放置气泡，若顶部越界 (y - tooltipH - 8 < 10) 自动下翻至选区下方 y + block.logicalH + 8，X 坐标在 [8, containerWidth - tooltipW - 8] 范围内 Clamp 夹取。2. overlay_layout.test.ts：编写测试用例覆盖单块/多块无重叠场景、密集重叠块避让偏移计算、Tooltip 顶部/底部边界自适应与屏幕左右越界夹取。确保运行 npm test 全部通过。
---
## Task 3
name: Store 配置扩展与全局 UI/UX 设计系统样式
priority: P1
files: app_v2/src/stores/useSettingsStore.ts|app_v2/src/services/types.ts|app_v2/src/index.css
prompt: 扩展设置状态、类型定义与全局设计系统样式。1. app_v2/src/services/types.ts：在 AppSettings 接口中新增 overlayViewMode?: 'cover' | 'tooltip'（原位覆盖 vs 悬浮气泡）与 enableAabbAvoidance?: boolean（是否启用 AABB 碰撞避让）。2. app_v2/src/stores/useSettingsStore.ts：在 DEFAULT_SETTINGS 中赋予 overlayViewMode: 'cover' 与 enableAabbAvoidance: true，在 SettingsStore 接口及实现中增加 setOverlayViewMode: (mode: 'cover' | 'tooltip') => void 与 setEnableAabbAvoidance: (enabled: boolean) => void 方法，触发时设置 isDirty 为 true 并持久化配置。3. app_v2/src/index.css：增加 @keyframes pulse-glow-amber 与 .pulse-glow-amber 呼吸动画类（为 Pin 锁定卡片提供琥珀金色微光光晕）；增加 @keyframes tooltip-pop 与 .tooltip-pop 弹性平滑进场动效 (cubic-bezier(0.16, 1, 0.3, 1))；增加 .cg-term-highlight 与 .cg-term-badge 样式（专属天蓝/琥珀虚线下划线与轻量徽标）；增加 .touch-hit-box 工具类，扩展图标按钮可点击感应区至最小 36px~44px。
---
## Task 4
name: 主翻译窗口 CG 术语高亮与多引擎对照 Tab 体验打磨
priority: P2
files: app_v2/src/components/MainWindow/DualPaneTranslator.tsx
prompt: 优化主翻译窗口 app_v2/src/components/MainWindow/DualPaneTranslator.tsx 的专业术语视觉体验与 Tab 栏交互。1. CG 专业术语高亮与释义：检查 response.engines 或 sourceTier，若包含 Preset、CG 词库、Blender、Substance 等专业词典来源，为对应译文卡片渲染 🧊 CG 术语 标识与天蓝色微发光虚线下划线；当鼠标悬停在专有名词或词库标牌时，展示释义浮层（含英文原词、中文标准定名与 3D 软件应用提示）。2. 多源对照 Tab 栏交互与滚动打磨：优化水平滚动栏的视觉反馈，当存在左/右可滚动内容时在两侧显示柔和的渐变遮罩指示器 (from-black/40 to-transparent)；左右翻页按钮增加扩展触控区 (hitbox) 并加入平滑弹性滚动动效；保证所有交互元素符合 WCAG 4.5:1 AA 对比度。确保编译无 warning、测试通过。
---
## Task 5
name: TitleBar 与 Sidebar 触控热区与微交互反馈增强
priority: P2
files: app_v2/src/components/TitleBar.tsx|app_v2/src/components/Sidebar/Sidebar.tsx
prompt: 打磨标题栏与侧边栏的无障碍触控体验与微交互反馈。1. app_v2/src/components/TitleBar.tsx：将最小化、最大化、关闭按钮的触控响应区（Hit Box）扩展至 36x36px，内部图标保持居中；关闭按钮 Hover 增加柔和红色背景渐变过渡，支持 :active 按压微缩 (scale(0.95)) 微反馈；版本号与 Logo 增加高质感渐变光晕与 Tooltip 说明。2. app_v2/src/components/Sidebar/Sidebar.tsx：为每个导航 Tab 项与快捷划词按钮添加 Hover 快捷键气泡提示（如“快捷划词 (F4)”）；Active Tab 增加动态平滑光标条与柔和呼吸背景；统一图标与文字的色彩层级与聚焦轮廓线 (focus-visible:ring-2)。确保编译与测试通过。
---
