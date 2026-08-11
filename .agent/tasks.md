---
round: 3
stage: 01/09 UI/UX
N: 5
---
## Task 1
name: CheatSheetModal 快捷键可视化速查面板
priority: P1
files: app_v2/src/components/Overlay/CheatSheetModal.tsx|app_v2/src/tests/cheatsheet_modal.test.tsx
prompt: 创建独立的快捷键速查面板组件 `app_v2/src/components/Overlay/CheatSheetModal.tsx` 与配套测试 `app_v2/src/tests/cheatsheet_modal.test.tsx`。
1. `CheatSheetModal.tsx`：
   - 采用 Mica/Acrylic 毛玻璃卡片设计 (`backdrop-blur-xl`, 半透明黑底, 边框 `border-white/15`, 阴影 `shadow-2xl`)。
   - 优雅呈现快捷键分组：
     * 📐 划框选区：`拖拽` 矩形划词 | `Shift+拖拽` 多选区划词 | `Esc / 右键` 退出选区 | `F4` 划词开关
     * 🃏 卡片交互：`Ctrl+P` Pin固定锁定 | `Enter` 一键复制译文 | `Space` 语音朗读 | `Ctrl+D` 收藏词条
     * ⚙️ 模式与通道：`M` 原位覆盖/悬浮气泡切换 | `Tab` 循环切换AI模型 | `1~6` 切换中/英/日/韩/德/法 | `? / F1` 快捷键速查
   - 使用统一的 `<kbd>` 风格标签（圆角、微立体阴影、等宽字体）。
   - 提供右上角关闭按钮，监听 `Esc` / `?` / `F1` 键触发 `onClose`。
   - 符合 WCAG 4.5:1 AA 对比度标准。
2. `cheatsheet_modal.test.tsx`：
   - 测试组件在 `isOpen=true` 时正常渲染各快捷键条目与分类标题。
   - 测试点击关闭按钮或按下 Escape 键时触发 `onClose` 回调。
---
## Task 2
name: AABB 碰撞避让与 Tooltip 浮动定位计算算法
priority: P1
files: app_v2/src/services/overlayLayout.ts|app_v2/src/tests/overlay_layout.test.ts
prompt: 创建独立的屏幕空间布局避让与坐标计算模块 `app_v2/src/services/overlayLayout.ts` 与配套单元测试 `app_v2/src/tests/overlay_layout.test.ts`。
1. `overlayLayout.ts`：
   - 实现 `resolveAABBCollisions(blocks: OverlayBlock[], containerWidth: number, containerHeight: number, margin?: number): OverlayBlock[]`：
     * 检测多个 OverlayBlock 的 Bounding Box 矩形重叠（相交且 overlapY > 2px）。
     * 当发生垂直挤压时，自上而下对重叠卡片施加纵向推移微调 (`y += overlapY + margin`)。
     * 若超出底部边界，执行智能向上压缩或避让重排，确保卡片不错位且不遮挡相邻文本。
   - 实现 `calculateTooltipPosition(block: OverlayBlock, containerWidth: number, containerHeight: number, tooltipW: number, tooltipH: number): { x: number; y: number; placement: 'top' | 'bottom' }`：
     * 默认将悬浮气泡放置在选区上方 `y - tooltipH - 8`。
     * 若顶部空间不足 (`y - tooltipH - 8 < 10`)，自动下翻至选区下方 `y + block.logicalH + 8`。
     * X 轴自动夹取在 `[8, containerWidth - tooltipW - 8]` 范围内，防止左右溢出屏幕。
2. `overlay_layout.test.ts`：
   - 测试单块、多块无重叠场景返回原坐标。
   - 测试垂直紧邻重叠块的避让偏移计算。
   - 测试 Tooltip 顶部/底部边界自适应与 X 轴越界夹取。
---
## Task 3
name: Store 配置扩展与全局 UI/UX 设计系统样式
priority: P1
files: app_v2/src/stores/useSettingsStore.ts|app_v2/src/services/types.ts|app_v2/src/index.css
prompt: 扩展设置状态、类型定义与全局视觉动效系统。
1. `app_v2/src/services/types.ts`：
   - 在 `AppSettings` 中新增 `overlayViewMode?: 'cover' | 'tooltip'`（原位覆盖 vs 悬浮气泡）与 `enableAabbAvoidance?: boolean`。
2. `app_v2/src/stores/useSettingsStore.ts`：
   - 在 `DEFAULT_SETTINGS` 中赋予 `overlayViewMode: 'cover'` 与 `enableAabbAvoidance: true`。
   - 在 store 接口与实现中增加 `setOverlayViewMode: (mode: 'cover' | 'tooltip') => void` 与 `setEnableAabbAvoidance: (enabled: boolean) => void`，变更时自动标记 isDirty 并持久化。
3. `app_v2/src/index.css`：
   - 增加 `@keyframes pulse-glow-amber` 与 `.pulse-glow-amber`（为 Pin 锁定卡片提供琥珀金色微光呼吸动效）。
   - 增加 `@keyframes tooltip-pop` 与 `.tooltip-pop` 弹性平滑进场动画 (`cubic-bezier(0.16, 1, 0.3, 1)`)。
   - 增加 `.cg-term-highlight` 与 `.cg-term-badge` 样式（专属天蓝/琥珀虚线下划线与轻量徽标）。
   - 规范 `.touch-hit-box` 工具类，扩展图标按钮可点击感应区至最小 36px~44px。
---
## Task 4
name: 主翻译窗口 CG 术语高亮与多引擎对照 Tab 体验打磨
priority: P2
files: app_v2/src/components/MainWindow/DualPaneTranslator.tsx
prompt: 优化主翻译窗口 `app_v2/src/components/MainWindow/DualPaneTranslator.tsx` 的专业术语视觉体验与 Tab 栏交互。
1. CG 专业术语高亮与释义：
   - 检查 `response.engines` 或 `sourceTier`，若包含 `Preset`、`CG 词库`、`Blender`、`Substance` 等专业词典来源，为对应译文卡片渲染 `🧊 CG 术语` 标识与天蓝色微发光下划线。
   - 当用户 Hover 专业术语或点击词库标牌时，展示释义浮层（含英文原词、中文标准定名与 3D 软件应用提示）。
2. 多源对照 Tab 栏交互与滚动打磨：
   - 优化水平滚动栏的视觉反馈：当存在左/右可滚动内容时，在两侧显示柔和的渐变遮罩指示器 (`from-black/40 to-transparent`)。
   - 左右翻页按钮增加扩展触控区，并加入平滑弹性滚动动效。
   - 保证所有交互元素符合 WCAG 4.5:1 AA 对比度。
---
## Task 5
name: TitleBar 与 Sidebar 触控热区与微交互反馈增强
priority: P2
files: app_v2/src/components/TitleBar.tsx|app_v2/src/components/Sidebar/Sidebar.tsx
prompt: 打磨标题栏与侧边栏的无障碍触控体验与微交互反馈。
1. `app_v2/src/components/TitleBar.tsx`：
   - 将最小化、最大化、关闭按钮的触控响应区（Hit Box）扩展至 36x36px，内部图标保持精巧居中。
   - 关闭按钮 Hover 增加柔和红色背景渐变过渡，支持 `:active` 按压微缩（`scale(0.95)`）微反馈。
   - 版本号与 Logo 增加高质感渐变光晕与 Tooltip 说明。
2. `app_v2/src/components/Sidebar/Sidebar.tsx`：
   - 为每个导航 Tab 项与快捷划词按钮添加 Hover 快捷键气泡提示（如“快捷划词 (F4)”）。
   - Active Tab 增加动态平滑光标条与柔和呼吸背景。
   - 统一图标与文字的色彩层级与聚焦轮廓线 (`focus-visible:ring-2`)。
---
