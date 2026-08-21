import React from 'react';
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
} from 'lucide-react';
import type { LanguageCode, AppSettings } from '../../services/types';
import { useSettingsStore } from '../../stores/useSettingsStore';

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
  targetLang = 'zh-CN',
  onSelectLanguage,
  selectedEngine = 'auto',
  onSelectEngine,
  settings: settingsProp,
  watchMode = false,
  onToggleWatch,
  onCheatSheet,
  isDowngraded = false,
  effectiveEngineName = '',
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

  const enabledLlmConfigs = (effectiveSettings.llmConfigs || []).filter(
    (cfg) => !!cfg.apiKey?.trim() || cfg.endpoint?.includes('localhost') || cfg.endpoint?.includes('127.0.0.1')
  );

  const onlineEnginesList = [
    { key: 'google', label: 'Google 翻译', enabled: effectiveSettings.onlineEngines?.google ?? true },
    { key: 'bing', label: '微软 Bing 翻译', enabled: effectiveSettings.onlineEngines?.bing ?? true },
    { key: 'youdao', label: '网易有道翻译', enabled: effectiveSettings.onlineEngines?.youdao ?? true },
    { key: 'deepl', label: 'DeepL 极速翻译', enabled: !!effectiveSettings.onlineEngines?.deepl },
    { key: 'baidu', label: '百度通用翻译', enabled: !!effectiveSettings.onlineEngines?.baidu },
    { key: 'myMemory', label: 'MyMemory 记忆库', enabled: !!effectiveSettings.onlineEngines?.myMemory },
    { key: 'tencent', label: '腾讯交互翻译', enabled: !!effectiveSettings.onlineEngines?.tencent },
  ].filter((item) => item.enabled);

  return (
    <div
      data-testid={testId}
      className={`snipping-toolbar-container flex flex-col items-center gap-1.5 pointer-events-auto select-none ${className}`}
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* ── 主工具条 (白底微阴影紧凑悬浮长条，6大功能分区) ──────────────────────── */}
      <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 shadow-xl backdrop-blur-md rounded-xl p-1 flex items-center gap-1 max-w-[98vw] flex-wrap md:flex-nowrap">
        {/* ── 分区 1: [品牌标签与操作指引] ── */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 select-none font-bold text-xs shrink-0 cursor-default"
          title="按住鼠标左键划框 · 双击自动吸附段落"
        >
          <span className="text-sm">🐾</span>
          <span className="font-extrabold bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 bg-clip-text text-transparent tracking-tight">
            猫步划词
          </span>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700/80 mx-0.5 shrink-0" />

        {/* ── 分区 2: [5大标注工具] ── */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 矩形框 */}
          <button
            type="button"
            data-testid="btn-tool-rect"
            onClick={() => onSelectTool(activeTool === 'rect' ? null : 'rect')}
            className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              activeTool === 'rect'
                ? 'bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
            title="矩形标注 (Rect)"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          {/* 箭头 */}
          <button
            type="button"
            data-testid="btn-tool-arrow"
            onClick={() => onSelectTool(activeTool === 'arrow' ? null : 'arrow')}
            className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              activeTool === 'arrow'
                ? 'bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
            title="箭头标注 (Arrow)"
          >
            <MoveUpRight className="w-3.5 h-3.5" />
          </button>

          {/* 画笔 */}
          <button
            type="button"
            data-testid="btn-tool-pen"
            onClick={() => onSelectTool(activeTool === 'pen' ? null : 'pen')}
            className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              activeTool === 'pen'
                ? 'bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
            title="画笔涂鸦 (Pen)"
          >
            <PenLine className="w-3.5 h-3.5" />
          </button>

          {/* 马赛克 */}
          <button
            type="button"
            data-testid="btn-tool-mosaic"
            onClick={() => onSelectTool(activeTool === 'mosaic' ? null : 'mosaic')}
            className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              activeTool === 'mosaic'
                ? 'bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
            title="马赛克遮挡 (Mosaic)"
          >
            <Grid3X3 className="w-3.5 h-3.5" />
          </button>

          {/* 文字 */}
          <button
            type="button"
            data-testid="btn-tool-text"
            onClick={() => onSelectTool(activeTool === 'text' ? null : 'text')}
            className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              activeTool === 'text'
                ? 'bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
            title="添加文字 (Text)"
          >
            <Type className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700/80 mx-0.5 shrink-0" />

        {/* ── 分区 3: [核心翻译与OCR] ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 截图翻译 [文A] */}
          <button
            type="button"
            data-testid="adjust-confirm-btn"
            onClick={onTranslate}
            disabled={isProcessing}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-medium text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50 shrink-0"
            title="截图翻译 (文A / Enter)"
          >
            <Languages className="w-3.5 h-3.5 text-emerald-100" />
            <span className="tracking-wide">翻译</span>
          </button>

          {/* 提取文字 [A] (OCR) */}
          <button
            type="button"
            data-testid="btn-ocr"
            onClick={onOcr}
            disabled={isProcessing}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-600 active:scale-95 text-white font-medium text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50 shrink-0"
            title="提取纯文本并复制到剪贴板 (OCR)"
          >
            <FileText className="w-3.5 h-3.5 text-sky-100" />
            <span className="tracking-wide">提取文字</span>
          </button>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700/80 mx-0.5 shrink-0" />

        {/* ── 分区: [视图与阅读控制组] ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 3态分段胶囊按钮 [ 文 | 原 | 双 ] */}
          <div className="flex items-center bg-slate-100/90 dark:bg-slate-800/90 p-0.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
            <button
              type="button"
              data-testid="view-mode-translated"
              onClick={() => onSelectViewMode?.('translated')}
              className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                viewMode === 'translated'
                  ? 'bg-sky-500 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-sky-500 dark:hover:text-sky-400'
              }`}
              title="仅显示译文 (O)"
            >
              文
            </button>
            <button
              type="button"
              data-testid="view-mode-original"
              onClick={() => onSelectViewMode?.('original')}
              className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                viewMode === 'original'
                  ? 'bg-sky-500 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-sky-500 dark:hover:text-sky-400'
              }`}
              title="仅显示原文 (O)"
            >
              原
            </button>
            <button
              type="button"
              data-testid="view-mode-bilingual"
              onClick={() => onSelectViewMode?.('bilingual')}
              className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                viewMode === 'bilingual'
                  ? 'bg-sky-500 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-sky-500 dark:hover:text-sky-400'
              }`}
              title="双语对照 (O)"
            >
              双
            </button>
          </div>

          {/* 🔊 朗读 按钮 */}
          <button
            type="button"
            data-testid="btn-speech"
            onClick={onSpeech}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer shrink-0"
            title="语音朗读 (Space)"
          >
            <Volume2 className="w-3.5 h-3.5 text-sky-500" />
            <span>朗读</span>
          </button>

          {/* A⁻ | A⁺ 紧凑微型步进按钮组 */}
          <div className="flex items-center bg-slate-100/90 dark:bg-slate-800/90 p-0.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
            <button
              type="button"
              data-testid="btn-zoom-out"
              onClick={onZoomOut}
              className="px-1.5 py-0.5 rounded text-[11px] font-bold hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
              title="缩小字号 (A⁻)"
            >
              A⁻
            </button>
            <div className="w-[1px] h-3 bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0" />
            <button
              type="button"
              data-testid="btn-zoom-in"
              onClick={onZoomIn}
              className="px-1.5 py-0.5 rounded text-[11px] font-bold hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
              title="放大字号 (A⁺)"
            >
              A⁺
            </button>
          </div>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700/80 mx-0.5 shrink-0" />

        {/* ── 分区 4: [语种与引擎] ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 语种选择极简下拉框 */}
          <select
            value={targetLang}
            onChange={(e) => onSelectLanguage?.(e.target.value as LanguageCode)}
            className="bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-[11px] px-2 py-1 font-medium text-slate-700 dark:text-slate-200 outline-none cursor-pointer hover:border-sky-400 transition shrink-0"
            title="切换目标语种"
          >
            {TARGET_LANG_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* 引擎选择极简下拉框 */}
          <select
            value={selectedEngine}
            onChange={(e) => onSelectEngine?.(e.target.value)}
            className="bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-[11px] px-2 py-1 font-medium text-slate-700 dark:text-slate-200 outline-none cursor-pointer hover:border-sky-400 transition shrink-0 max-w-[155px]"
            title="切换翻译引擎 (Tab)"
          >
            <option value="auto">⚡ 默认多级队列 (智能回退)</option>

            {/* 🤖 AI 深度翻译（仅展示已配置/启用的模型） */}
            {enabledLlmConfigs.length > 0 && (
              <optgroup label="🤖 AI 深度翻译">
                {enabledLlmConfigs.map((cfg) => {
                  const val = (cfg.model || cfg.provider || cfg.id || 'deepseek').toLowerCase();
                  return (
                    <option key={cfg.id || cfg.model} value={val}>
                      {cfg.provider} ({cfg.model || '默认'})
                    </option>
                  );
                })}
              </optgroup>
            )}

            {/* 🌐 在线翻译通道（仅展示已开启的引擎） */}
            {onlineEnginesList.length > 0 && (
              <optgroup label="🌐 在线翻译通道">
                {onlineEnginesList.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700/80 mx-0.5 shrink-0" />

        {/* ── 分区 5: [辅助工具] ── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 监控区域 (W) */}
          <button
            type="button"
            onClick={onToggleWatch}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer shrink-0 ${
              watchMode
                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
            title="开启/关闭区域监控 (W)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${watchMode ? 'animate-spin' : ''}`} />
            <span>监控 (W)</span>
          </button>

          {/* 快捷键速查 (?) */}
          <button
            type="button"
            data-testid="cheatsheet-btn"
            onClick={onCheatSheet}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer shrink-0"
            title="快捷键速查 (? / F1)"
          >
            <span className="w-3.5 h-3.5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-[9px]">?</span>
            <span>速查</span>
          </button>
        </div>

        {/* 细竖线分隔 */}
        <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700/80 mx-0.5 shrink-0" />

        {/* ── 分区 6: [操作与退出] ── */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 撤销 (Undo) */}
          <button
            type="button"
            data-testid="btn-undo"
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              canUndo
                ? 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                : 'opacity-30 cursor-not-allowed text-slate-400'
            }`}
            title="撤销上一步标注 (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>

          {/* 置顶贴图 (Pin) */}
          <button
            type="button"
            data-testid="btn-pin"
            onClick={onPin}
            className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              isPinned
                ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-400/40'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
            title={isPinned ? '已置顶固定 (Pin)' : '置顶贴图 (Pin)'}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>

          {/* 保存 (Save) */}
          <button
            type="button"
            data-testid="btn-save"
            onClick={onSave}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer flex items-center justify-center"
            title="保存截图为图片 (Ctrl+S)"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* 复制 (Copy) */}
          <button
            type="button"
            data-testid="btn-copy"
            onClick={onCopy}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer flex items-center justify-center"
            title="复制截图到剪贴板 (Ctrl+C)"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          {/* 取消 / 退出 (X) */}
          <button
            type="button"
            data-testid="adjust-cancel-btn"
            onClick={onCancel}
            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-all cursor-pointer flex items-center justify-center shrink-0"
            title="退出划词 (Esc / 鼠标右键)"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {/* 完成 (Check) */}
          <button
            type="button"
            data-testid="btn-done"
            onClick={onConfirm}
            className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white transition-all cursor-pointer flex items-center justify-center shadow-sm"
            title="完成并复制 (Enter)"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>

        {/* 降级提示（如有） */}
        {isDowngraded && !bannerDismissed && (
          <div className="ml-1 pl-2 border-l border-amber-400/40 text-[11px] font-semibold text-amber-500 flex items-center gap-1 shrink-0">
            <span>⚠️ 通道降级: {effectiveEngineName}</span>
          </div>
        )}
      </div>

      {/* ── 标注工具子选项条 (颜色选择与粗细调整) ─────────────────────────── */}
      {activeTool && activeTool !== 'mosaic' && onSelectColor && onSelectStrokeWidth && (
        <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 shadow-md backdrop-blur-md rounded-lg px-2.5 py-1 flex items-center gap-2 text-xs animate-fade-in">
          {/* 粗细选择 */}
          <div className="flex items-center gap-1 pr-2 border-r border-slate-200 dark:border-slate-700/80">
            {STROKE_SIZES.map((sz) => (
              <button
                key={sz.size}
                type="button"
                onClick={() => onSelectStrokeWidth(sz.size)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                  strokeWidth === sz.size
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
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
                className={`w-3.5 h-3.5 rounded-full border border-black/10 dark:border-white/20 transition-all cursor-pointer ${
                  selectedColor === c ? 'scale-125 ring-2 ring-sky-500 ring-offset-1 dark:ring-offset-slate-900' : 'hover:scale-110'
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
