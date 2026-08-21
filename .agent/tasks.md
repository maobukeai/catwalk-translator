N: 5

## Task 1
name: cheatsheet-modal-and-tests
prompt: 实现快捷键速查面板组件 app_v2/src/components/Overlay/CheatSheetModal.tsx 与单元测试 app_v2/src/tests/cheatsheet_modal.test.tsx。要求：1. Mica毛玻璃视觉(backdrop-blur-xl, bg-slate-950/85, border-white/20, shadow-2xl, rounded-2xl)与环境光晕；2. 结构化四大快捷键分类(选区操作、卡片操作、模式通道、帮助指引)；3. 精致<kbd>按键标签与Focus Trap无障碍保护，符合WCAG 2.2 AA标准；4. 支持Esc/?/F1及遮罩点击关闭；5. 编写Vitest测试确保覆盖显隐/按键响应/点击遮罩。目标文件仅限于 app_v2/src/components/Overlay/CheatSheetModal.tsx 和 app_v2/src/tests/cheatsheet_modal.test.tsx，严禁修改其他文件。验证：npx vitest run src/tests/cheatsheet_modal.test.tsx 通过且 npx tsc --noEmit 0错误。

## Task 2
name: aabb-overlay-layout-algorithm
prompt: 实现屏幕空间碰撞避让与Tooltip定位算法 app_v2/src/services/overlayLayout.ts 及单元测试 app_v2/src/tests/overlay_layout.test.ts。要求：1. 实现 resolveAABBCollisions 函数，相交条件ΔX>4px且ΔY>2px时自上而下纵向推移微调，底部溢出阻尼反向压缩回推，边界Clamp至[0, containerHeight-h]；2. 实现 calculateTooltipPosition 函数，默认上方y-tooltipH-8，空间<10px翻转至下方y+block.logicalH+8，X轴居中夹取至[8, containerWidth-tooltipW-8]；3. 编写Vitest测试覆盖单块/多块密集/底部溢出/翻转/边界用例。目标文件仅限于 app_v2/src/services/overlayLayout.ts 和 app_v2/src/tests/overlay_layout.test.ts，严禁修改其他文件。验证：npx vitest run src/tests/overlay_layout.test.ts 通过且 npx tsc --noEmit 0错误。

## Task 3
name: settings-store-and-design-system
prompt: 扩展配置与全局UI/UX样式系统 app_v2/src/services/types.ts、app_v2/src/stores/useSettingsStore.ts 与 app_v2/src/index.css。要求：1. types.ts在AppSettings中增加 overlayViewMode?: 'cover' | 'tooltip' 与 enableAabbAvoidance?: boolean；2. useSettingsStore.ts设置默认值(overlayViewMode: 'cover', enableAabbAvoidance: true)并添加持久化更新方法 setOverlayViewMode 和 setEnableAabbAvoidance；3. index.css新增 .pulse-glow-amber 呼吸微光、.tooltip-pop 弹性动效、.cg-term-highlight/.cg-term-badge 术语微样式、.touch-hit-box 触控热区样式。目标文件仅限于 app_v2/src/services/types.ts、app_v2/src/stores/useSettingsStore.ts、app_v2/src/index.css，严禁修改其他文件。验证：npx tsc --noEmit 0错误且现有测试通过。

## Task 4
name: dual-pane-cg-terms-and-tab-scroll
prompt: 优化主翻译窗口CG专有名词高亮悬浮释义与多源Tab体验 app_v2/src/components/MainWindow/DualPaneTranslator.tsx 及调优测试 app_v2/src/tests/cg_terms_and_tab_scroll.test.tsx。要求：1. 命中CG专业词库时渲染 🧊 CG 术语 标牌与天蓝发光虚线下划线，鼠标悬停展示释义浮层；2. 多源Tab水平溢出时提供两侧渐变遮罩指示器与平滑滚动扩展热区；3. 调优修复 cg_terms_and_tab_scroll.test.tsx 中的防抖计时等待与选择器冲突，确保100%通过。目标文件仅限于 app_v2/src/components/MainWindow/DualPaneTranslator.tsx 和 app_v2/src/tests/cg_terms_and_tab_scroll.test.tsx，严禁修改其他文件。验证：npx vitest run src/tests/cg_terms_and_tab_scroll.test.tsx 通过且 npx tsc --noEmit 0错误。

## Task 5
name: titlebar-sidebar-ux-and-fix-tests
prompt: 增强标题栏与侧边栏触控热区微交互并修复现有测试 app_v2/src/components/TitleBar.tsx、app_v2/src/components/Sidebar/Sidebar.tsx、app_v2/src/App.tsx、app_v2/src/services/tauri.ts 与 app_v2/src/tests/m4_overlay_sampler.test.tsx。要求：1. TitleBar.tsx窗口操作按钮Hit Box扩大至36x36px，关闭按钮增加红色渐变与:active微缩放；2. Sidebar.tsx导航项与划词按钮增加Hover快捷键气泡(如快捷划词F4)，强化Active发光条；3. App.tsx修正 settings.captureHotkeyEnabled ?? settings.hotkeyEnabled ?? true 兼容性；4. tauri.ts历史记录读写增加 Array.isArray(current) 容错守卫；5. 修复 m4_overlay_sampler.test.tsx 的 closest('.overlay-block') 断言。目标文件仅限于上述5个文件，严禁修改其他文件。验证：npx vitest run src/tests/m4_overlay_sampler.test.tsx 通过且 npx tsc --noEmit 0错误。
