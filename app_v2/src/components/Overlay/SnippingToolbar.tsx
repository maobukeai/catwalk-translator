import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  Square,
  MoveUpRight,
  PenLine,
  Grid3X3,
  Type,
  Languages,
  FileText,
  RefreshCw,
  Undo2,
  Pin,
  Download,
  Copy,
  X,
  Check,
  Volume2,
  GripVertical,
} from 'lucide-react';
import type { LanguageCode, AppSettings } from '../../services/types';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { buildCaptureEngineChoices } from '../../services/engineOptions';
import { GlassSelect } from '../Common/GlassSelect';
import { useSlidingIndicator } from '../../hooks/useSlidingIndicator';
import { SlidingHighlight } from '../Common/SlidingHighlight';

export type AnnotationTool = 'rect' | 'arrow' | 'pen' | 'mosaic' | 'text' | null;

export interface SnippingToolbarProps {
  testId?: string;
  activeTool: AnnotationTool;
  onSelectTool: (tool: AnnotationTool) => void;
  selectedColor?: string;
  onSelectColor?: (color: string) => void;
  strokeWidth?: number;
  onSelectStrokeWidth?: (width: number) => void;
  onTranslate: () => void;
  onOcr: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onPin: () => void;
  isPinned: boolean;
  onSave: () => void;
  onCopy: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  isProcessing?: boolean;
  targetLang?: LanguageCode;
  onSelectLanguage?: (lang: LanguageCode) => void;
  selectedEngine?: string;
  onSelectEngine?: (engine: string) => void;
  settings?: AppSettings;
  watchMode?: boolean;
  onToggleWatch?: () => void;
  onCheatSheet?: () => void;
  isDowngraded?: boolean;
  effectiveEngineName?: string;
  isAiRefined?: boolean;
  isAiRefining?: boolean;
  aiEngineName?: string;
  bannerDismissed?: boolean;
  viewMode?: 'translated' | 'original' | 'bilingual';
  onSelectViewMode?: (mode: 'translated' | 'original' | 'bilingual') => void;
  onSpeech?: () => void;
  fontScale?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const TARGET_LANG_OPTIONS: { code: LanguageCode; label: string }[] = [
  { code: 'auto', label: '自动' },
  { code: 'zh-CN', label: '中' },
  { code: 'en', label: '英' },
  { code: 'ja', label: '日' },
  { code: 'ko', label: '韩' },
  { code: 'de', label: '德' },
  { code: 'fr', label: '法' },
  { code: 'es', label: '西' },
  { code: 'ru', label: '俄' },
  { code: 'zh-TW', label: '繁' },
  { code: 'it', label: '意' },
  { code: 'pt', label: '葡' },
  { code: 'ar', label: '阿' },
  { code: 'th', label: '泰' },
  { code: 'vi', label: '越' },
];

const PRESET_COLORS = [
  '#ef4444', // Red
  '#f59e0b', // Amber
  '#22c55e', // Green
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#ffffff', // White
  '#0f172a', // Black
];

const STROKE_SIZES = [
  { size: 2, label: '细' },
  { size: 4, label: '中' },
  { size: 6, label: '粗' },
];

export const SnippingToolbar: React.FC<SnippingToolbarProps> = ({
  testId = 'adjust-confirm-bar',
  activeTool,
  onSelectTool,
  selectedColor = '#ef4444',
  onSelectColor,
  strokeWidth = 3,
  onSelectStrokeWidth,
  onTranslate,
  onOcr,
  onUndo,
  canUndo,
  onPin,
  isPinned,
  onSave,
  onCopy,
  onCancel,
  onConfirm,
  isProcessing = false,
  targetLang = 'auto',
  onSelectLanguage,
  selectedEngine = 'auto',
  onSelectEngine,
  settings: settingsProp,
  watchMode = false,
  onToggleWatch,
  onCheatSheet,
  isDowngraded = false,
  effectiveEngineName = '',
  isAiRefined = false,
  isAiRefining = false,
  aiEngineName = '',
  bannerDismissed = false,
  viewMode = 'translated',
  onSelectViewMode,
  onSpeech,
  fontScale = 1.0,
  onZoomIn,
  onZoomOut,
  className = '',
  style,
}) => {
  const storeSettings = useSettingsStore((s) => s.settings);
  const effectiveSettings = settingsProp || storeSettings;
  const { isLight } = useAppTheme();

  // 与设置页下拉 / Tab 轮播同源：按当前配置动态生成 LLM 模型池 + 已开启在线引擎/词库
  const engineChoices = useMemo(() => buildCaptureEngineChoices(effectiveSettings), [effectiveSettings]);
  const annotationToolSlider = useSlidingIndicator<HTMLDivElement>(activeTool);

  // ── 拖拽移动状态与逻辑 ──
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialOffsetX: number; initialOffsetY: number } | null>(null);

  const handlePointerDownDrag = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    // 仅响应鼠标主键 (左键)
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialOffsetX: dragOffset.x,
      initialOffsetY: dragOffset.y,
    };

    const handleMove = (ev: MouseEvent | PointerEvent) => {
      if (!dragStartRef.current) return;
      const dx = ev.clientX - dragStartRef.current.startX;
      const dy = ev.clientY - dragStartRef.current.startY;
      setDragOffset({
        x: dragStartRef.current.initialOffsetX + dx,
        y: dragStartRef.current.initialOffsetY + dy,
      });
    };

    const handleUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      window.removeEventListener('pointermove', handleMove as EventListener);
      window.removeEventListener('pointerup', handleUp as EventListener);
      window.removeEventListener('pointercancel', handleUp as EventListener);
      window.removeEventListener('mousemove', handleMove as EventListener);
      window.removeEventListener('mouseup', handleUp as EventListener);
    };

    window.addEventListener('pointermove', handleMove as EventListener, { passive: true });
    window.addEventListener('pointerup', handleUp as EventListener, { passive: true });
    window.addEventListener('pointercancel', handleUp as EventListener, { passive: true });
    window.addEventListener('mousemove', handleMove as EventListener, { passive: true });
    window.addEventListener('mouseup', handleUp as EventListener, { passive: true });
  }, [dragOffset]);

  const handleResetPosition = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDragOffset({ x: 0, y: 0 });
  }, []);

  // 计算合并后的 style 与 transform
  const mergedStyle = useMemo<React.CSSProperties>(() => {
    const baseStyle = style || {};
    const hasOffset = dragOffset.x !== 0 || dragOffset.y !== 0;
    if (!hasOffset) {
      return baseStyle;
    }
    const baseTransform = baseStyle.transform ? `${baseStyle.transform} ` : '';
    return {
      ...baseStyle,
      transform: `${baseTransform}translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
      transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1)',
    };
  }, [style, dragOffset, isDragging]);

  return (
    <div
      data-testid={testId}
      className={`snipping-toolbar-container flex flex-col items-center gap-1.5 pointer-events-auto select-none ${className}`}
      style={mergedStyle}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* ── 第 1 层: [翻译与阅读控制条] (Vision 液态棱镜胶囊) ─────────────── */}
      <div
        className="overlay-vision-pill rounded-full py-1 px-2 flex items-center gap-1 max-w-[calc(100vw-24px)] overflow-x-auto scrollbar-none flex-nowrap shrink-0"
        style={{ color: 'var(--g-text-1)' }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) handlePointerDownDrag(e);
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) handlePointerDownDrag(e);
        }}
      >
        {/* 截图翻译 [文A] */}
        <button
          type="button"
          data-testid="adjust-confirm-btn"
          onClick={onTranslate}
          disabled={isProcessing}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-105 active:scale-95 text-white font-medium text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50 shrink-0"
          title="截图翻译 (文A / Enter)"
        >
          <Languages className="w-3.5 h-3.5 text-emerald-50" />
          <span className="tracking-wide font-semibold">翻译</span>
        </button>

        {/* 提取文字 [A] (OCR) */}
        <button
          type="button"
          data-testid="btn-ocr"
          onClick={onOcr}
          disabled={isProcessing}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 hover:brightness-105 active:scale-95 text-white font-medium text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50 shrink-0"
          title="提取纯文本并复制到剪贴板 (OCR / A)"
        >
          <FileText className="w-3.5 h-3.5 text-sky-50" />
          <span className="tracking-wide font-semibold">提取</span>
        </button>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-3.5 mx-0.5 shrink-0" style={{ background: 'var(--g-border-strong)' }} />

        {/* 3态分段胶囊按钮 [ 文 | 原 | 双 ]（带弹性滑块过渡） */}
        {(() => {
          const viewModeIndex = viewMode === 'original' ? 1 : viewMode === 'bilingual' ? 2 : 0;
          return (
            <div
              className="relative grid grid-cols-3 items-center p-0.5 rounded-full border shrink-0"
              style={{ background: 'var(--g-surface-2)', borderColor: 'var(--g-border)' }}
            >
              <span
                aria-hidden="true"
                data-testid="view-mode-slider"
                className="seg-pill-indicator pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-full shadow-xs"
                style={{
                  width: 'calc((100% - 4px) / 3)',
                  transform: `translate3d(${viewModeIndex * 100}%, 0, 0)`,
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-border)',
                }}
              />
              <button
                type="button"
                data-testid="view-mode-translated"
                onClick={() => onSelectViewMode?.('translated')}
                className="relative z-10 px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors duration-150 cursor-pointer"
                style={{ color: viewMode === 'translated' ? 'var(--accent-text)' : 'var(--g-text-2)' }}
                title="仅显示译文 (O)"
              >
                文
              </button>
              <button
                type="button"
                data-testid="view-mode-original"
                onClick={() => onSelectViewMode?.('original')}
                className="relative z-10 px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors duration-150 cursor-pointer"
                style={{ color: viewMode === 'original' ? 'var(--accent-text)' : 'var(--g-text-2)' }}
                title="仅显示原文 (O)"
              >
                原
              </button>
              <button
                type="button"
                data-testid="view-mode-bilingual"
                onClick={() => onSelectViewMode?.('bilingual')}
                className="relative z-10 px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors duration-150 cursor-pointer"
                style={{ color: viewMode === 'bilingual' ? 'var(--accent-text)' : 'var(--g-text-2)' }}
                title="双语对照 (O)"
              >
                双
              </button>
            </div>
          );
        })()}

        {/* 🔊 朗读 按钮 */}
        <button
          type="button"
          data-testid="btn-speech"
          onClick={onSpeech}
          className="p-1.5 rounded-full hover:bg-[var(--g-surface-3)] transition-all cursor-pointer shrink-0 flex items-center justify-center"
          style={{ color: 'var(--accent-text)' }}
          title="语音朗读 (Space)"
        >
          <Volume2 className="w-3.5 h-3.5" />
        </button>

        {/* A⁻ | A⁺ 紧凑微型步进按钮组 */}
        <div
          className="flex items-center p-0.5 rounded-full border shrink-0"
          style={{ background: 'var(--g-surface-2)', borderColor: 'var(--g-border)' }}
        >
          <button
            type="button"
            data-testid="btn-zoom-out"
            onClick={onZoomOut}
            className="px-1.5 py-0.5 rounded-full text-[11px] font-bold hover:bg-[var(--g-surface-3)] transition cursor-pointer"
            style={{ color: 'var(--g-text-2)' }}
            title="缩小字号 (A⁻)"
          >
            A⁻
          </button>
          <div className="w-[1px] h-3 mx-0.5 shrink-0" style={{ background: 'var(--g-border)' }} />
          <button
            type="button"
            data-testid="btn-zoom-in"
            onClick={onZoomIn}
            className="px-1.5 py-0.5 rounded-full text-[11px] font-bold hover:bg-[var(--g-surface-3)] transition cursor-pointer"
            style={{ color: 'var(--g-text-2)' }}
            title="放大字号 (A⁺)"
          >
            A⁺
          </button>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-3.5 mx-0.5 shrink-0" style={{ background: 'var(--g-border-strong)' }} />

        {/* 语种选择下拉框 */}
        <GlassSelect
          value={targetLang}
          options={TARGET_LANG_OPTIONS.map((opt) => ({ value: opt.code, label: opt.label }))}
          onChange={(val) => onSelectLanguage?.(val as LanguageCode)}
          title="切换目标语种"
          size="xs"
          variant="pill"
          menuMinWidth={150}
          className="shrink-0"
        />

        {/* 引擎选择极简下拉框 */}
        <GlassSelect
          value={selectedEngine}
          options={[{ value: engineChoices.auto.value, label: '🤖 智能极速' }]}
          groups={engineChoices.groups.map((g) => ({
            key: g.key,
            label: g.label,
            options: g.options.map((o) => ({ value: o.value, label: o.label })),
          }))}
          onChange={(val) => onSelectEngine?.(val)}
          title="切换翻译引擎 (Tab)"
          size="xs"
          variant="pill"
          menuMinWidth={248}
          triggerClassName="max-w-[116px]"
          className="shrink-0"
        />

        {/* 大模型深度精翻标注 */}
        {isAiRefining && (
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 animate-pulse select-none ml-0.5 border"
            style={{
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent-border)',
              color: 'var(--accent-text)',
            }}
            title="正在使用大模型后台异步润色中…"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
            <span className="whitespace-nowrap">AI 润色中…</span>
          </div>
        )}
        {isAiRefined && !isAiRefining && (
          <div
            data-testid="ai-refined-badge"
            className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500/15 via-indigo-500/15 to-sky-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] font-semibold shrink-0 animate-fade-in select-none shadow-xs ml-0.5"
            title={`大模型深度精翻已就绪${aiEngineName ? `: ${aiEngineName}` : ''}`}
          >
            <span className="text-[11px] leading-none">✨</span>
            <span className="whitespace-nowrap max-w-[76px] truncate inline-block align-bottom">{aiEngineName ? `${aiEngineName} 精翻` : 'AI 精翻'}</span>
          </div>
        )}

        {/* 降级提示（如有） */}
        {isDowngraded && !bannerDismissed && (
          <div className="ml-0.5 pl-1.5 border-l border-amber-400/40 text-[10px] font-semibold text-amber-500 flex items-center gap-0.5 shrink-0" title={`通道已自动降级至: ${effectiveEngineName}`}>
            <span>⚠️ {effectiveEngineName}</span>
          </div>
        )}
      </div>

      {/* ── 第 2 层: [截图标注与输出工具条] (按用户要求严格保留原版纯图标样式 + Vision 胶囊壳) ──────────── */}
      <div
        className="overlay-vision-pill rounded-full py-1 px-2.5 flex items-center gap-1 max-w-[calc(100vw-24px)] overflow-x-auto scrollbar-none flex-nowrap shrink-0"
        style={{ color: 'var(--g-text-1)' }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) handlePointerDownDrag(e);
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) handlePointerDownDrag(e);
        }}
      >
        {/* 品牌标签与拖拽把手 */}
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 select-none font-bold text-xs shrink-0 cursor-grab active:cursor-grabbing hover:bg-[var(--g-surface-3)] rounded-full transition-colors group"
          title="按住拖拽移动工具栏 · 按住鼠标左键划框 · 双击恢复默认位置"
          onPointerDown={handlePointerDownDrag}
          onMouseDown={handlePointerDownDrag}
          onDoubleClick={handleResetPosition}
        >
          <GripVertical className="w-3.5 h-3.5 group-hover:text-sky-500 transition-colors shrink-0" style={{ color: 'var(--g-text-3)' }} />
          <span className="text-xs shrink-0">🐾</span>
          <span className="font-extrabold bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 bg-clip-text text-transparent tracking-tight whitespace-nowrap text-[11px]">
            猫步
          </span>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-3.5 mx-0.5 shrink-0" style={{ background: 'var(--g-border-strong)' }} />

        {/* 5 大标注工具（纯图标，带弹性滑动高亮） */}
        <div ref={annotationToolSlider.containerRef} className="relative flex items-center gap-0.5 shrink-0">
          <SlidingHighlight
            rect={annotationToolSlider.rect}
            isReady={annotationToolSlider.isReady}
            variant="solid"
            radiusClass="rounded-full"
            testId="annotation-tool-slider"
          />
          <button
            ref={annotationToolSlider.registerItem('rect')}
            type="button"
            data-testid="btn-tool-rect"
            onClick={() => onSelectTool(activeTool === 'rect' ? null : 'rect')}
            className={`relative z-10 p-1.5 rounded-full transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              activeTool === 'rect'
                ? annotationToolSlider.isReady
                  ? 'text-white'
                  : 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-[var(--g-surface-3)]'
            }`}
            style={activeTool === 'rect' ? undefined : { color: 'var(--g-text-2)' }}
            title="矩形标注 (Rect)"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          <button
            ref={annotationToolSlider.registerItem('arrow')}
            type="button"
            data-testid="btn-tool-arrow"
            onClick={() => onSelectTool(activeTool === 'arrow' ? null : 'arrow')}
            className={`relative z-10 p-1.5 rounded-full transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              activeTool === 'arrow'
                ? annotationToolSlider.isReady
                  ? 'text-white'
                  : 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-[var(--g-surface-3)]'
            }`}
            style={activeTool === 'arrow' ? undefined : { color: 'var(--g-text-2)' }}
            title="箭头标注 (Arrow)"
          >
            <MoveUpRight className="w-3.5 h-3.5" />
          </button>

          <button
            ref={annotationToolSlider.registerItem('pen')}
            type="button"
            data-testid="btn-tool-pen"
            onClick={() => onSelectTool(activeTool === 'pen' ? null : 'pen')}
            className={`relative z-10 p-1.5 rounded-full transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              activeTool === 'pen'
                ? annotationToolSlider.isReady
                  ? 'text-white'
                  : 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-[var(--g-surface-3)]'
            }`}
            style={activeTool === 'pen' ? undefined : { color: 'var(--g-text-2)' }}
            title="画笔涂鸦 (Pen)"
          >
            <PenLine className="w-3.5 h-3.5" />
          </button>

          <button
            ref={annotationToolSlider.registerItem('mosaic')}
            type="button"
            data-testid="btn-tool-mosaic"
            onClick={() => onSelectTool(activeTool === 'mosaic' ? null : 'mosaic')}
            className={`relative z-10 p-1.5 rounded-full transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              activeTool === 'mosaic'
                ? annotationToolSlider.isReady
                  ? 'text-white'
                  : 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-[var(--g-surface-3)]'
            }`}
            style={activeTool === 'mosaic' ? undefined : { color: 'var(--g-text-2)' }}
            title="马赛克遮挡 (Mosaic)"
          >
            <Grid3X3 className="w-3.5 h-3.5" />
          </button>

          <button
            ref={annotationToolSlider.registerItem('text')}
            type="button"
            data-testid="btn-tool-text"
            onClick={() => onSelectTool(activeTool === 'text' ? null : 'text')}
            className={`relative z-10 p-1.5 rounded-full transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              activeTool === 'text'
                ? annotationToolSlider.isReady
                  ? 'text-white'
                  : 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-[var(--g-surface-3)]'
            }`}
            style={activeTool === 'text' ? undefined : { color: 'var(--g-text-2)' }}
            title="添加文字 (Text)"
          >
            <Type className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-3.5 mx-0.5 shrink-0" style={{ background: 'var(--g-border-strong)' }} />

        {/* 辅助工具（纯图标） */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onToggleWatch}
            className={`p-1.5 rounded-full transition-all cursor-pointer shrink-0 flex items-center justify-center ${
              watchMode
                ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/40'
                : 'hover:bg-[var(--g-surface-3)]'
            }`}
            style={watchMode ? undefined : { color: 'var(--g-text-2)' }}
            title="开启/关闭区域监控 (W)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${watchMode ? 'animate-spin text-emerald-500' : ''}`} />
          </button>

          <button
            type="button"
            data-testid="cheatsheet-btn"
            onClick={onCheatSheet}
            className="p-1.5 rounded-full hover:bg-[var(--g-surface-3)] transition-all cursor-pointer shrink-0 flex items-center justify-center"
            style={{ color: 'var(--g-text-2)' }}
            title="快捷键速查 (? / F1)"
          >
            <span
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold text-[9px]"
              style={{ background: 'var(--g-surface-3)', color: 'var(--g-text-1)' }}
            >
              ?
            </span>
          </button>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-3.5 mx-0.5 shrink-0" style={{ background: 'var(--g-border-strong)' }} />

        {/* 输出与退出操作（纯图标） */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            data-testid="btn-undo"
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded-full transition-all cursor-pointer flex items-center justify-center ${
              canUndo
                ? 'hover:bg-[var(--g-surface-3)]'
                : 'opacity-30 cursor-not-allowed'
            }`}
            style={{ color: canUndo ? 'var(--g-text-1)' : 'var(--g-text-3)' }}
            title="撤销上一步标注 (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="btn-pin"
            onClick={onPin}
            className={`p-1.5 rounded-full transition-all cursor-pointer flex items-center justify-center ${
              isPinned
                ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-400/40'
                : 'hover:bg-[var(--g-surface-3)]'
            }`}
            style={isPinned ? undefined : { color: 'var(--g-text-2)' }}
            title={isPinned ? '已置顶固定 (Pin)' : '置顶贴图 (Pin)'}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="btn-save"
            onClick={onSave}
            className="p-1.5 rounded-full hover:bg-[var(--g-surface-3)] transition-all cursor-pointer flex items-center justify-center"
            style={{ color: 'var(--g-text-2)' }}
            title="保存截图为图片 (Ctrl+S)"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="btn-copy"
            onClick={onCopy}
            className="p-1.5 rounded-full hover:bg-[var(--g-surface-3)] transition-all cursor-pointer flex items-center justify-center"
            style={{ color: 'var(--g-text-2)' }}
            title="复制截图到剪贴板 (Ctrl+C)"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="adjust-cancel-btn"
            onClick={onCancel}
            className="p-1.5 rounded-full text-rose-500 hover:bg-rose-500/12 hover:text-rose-600 transition-all cursor-pointer flex items-center justify-center shrink-0"
            title="退出划词 (Esc / 鼠标右键)"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="btn-done"
            onClick={onConfirm}
            className="p-1.5 px-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-105 active:scale-95 text-white transition-all cursor-pointer flex items-center justify-center shadow-sm shrink-0"
            title="完成并复制 (Enter)"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* ── 标注工具子选项条 (颜色选择与粗细调整) ─────────────────────────── */}
      {activeTool && activeTool !== 'mosaic' && onSelectColor && onSelectStrokeWidth && (
        <div
          className="overlay-vision-pill rounded-full px-3 py-1 flex items-center gap-2 text-xs animate-fade-in"
          style={{ color: 'var(--g-text-1)' }}
        >
          {/* 粗细选择 */}
          <div className="flex items-center gap-1 pr-2 border-r" style={{ borderColor: 'var(--g-border)' }}>
            {STROKE_SIZES.map((sz) => (
              <button
                key={sz.size}
                type="button"
                onClick={() => onSelectStrokeWidth(sz.size)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition cursor-pointer ${
                  strokeWidth === sz.size
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'hover:bg-[var(--g-surface-3)]'
                }`}
                style={strokeWidth === sz.size ? undefined : { color: 'var(--g-text-2)' }}
              >
                {sz.label}
              </button>
            ))}
          </div>

          {/* 预设色板 */}
          <div className="flex items-center gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onSelectColor(c)}
                className={`w-3.5 h-3.5 rounded-full border border-black/15 dark:border-white/25 transition-all cursor-pointer ${
                  selectedColor === c ? 'scale-125 ring-2 ring-sky-500 ring-offset-1' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
