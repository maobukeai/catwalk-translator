import React from 'react';
import type { OverlayBlock } from '../../services/types';

interface YoudaoResultPanelProps {
  blocks: import('../../services/types').OverlayBlock[];
  selectionX: number;
  selectionY: number;
  selectionW: number;
  selectionH: number;
  isLight: boolean;
  translating: boolean;
  hoverIndex: number | null;
  targetLang: string;
  onHover: (idx: number | null) => void;
  onCopyText: (text: string) => void;
  onSpeech: (text: string) => void;
  onRetranslate: () => void;
  onSwitchMode: () => void;
  onPin: () => void;
  onExportImage: () => void;
  onClose: () => void;
}

const YoudaoResultPanel: React.FC<YoudaoResultPanelProps> = ({
  blocks,
  selectionX,
  selectionY,
  selectionW,
  selectionH,
  isLight,
  translating,
  hoverIndex,
  targetLang,
  onHover,
  onCopyText,
  onSpeech,
  onRetranslate,
  onSwitchMode,
  onPin,
  onExportImage,
  onClose,
}) => {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;

  // Web-Youdao-style dual-column panel needs room; fall back to stacked
  // (source above, translation below) when the viewport is narrow.
  const maxAvailW = vw - 16;
  const dualColumn = maxAvailW >= 560;
  const panelW = Math.max(
    dualColumn ? 520 : 320,
    Math.min(dualColumn ? 720 : 480, Math.max(selectionW, dualColumn ? 520 : 320), maxAvailW)
  );
  const estH = Math.min(Math.max(180 + blocks.length * 46, 240), Math.floor(vh * 0.7));
  let top = selectionY + selectionH + 12;
  if (top + estH > vh - 8) {
    const flipped = selectionY - estH - 12;
    top = flipped >= 8 ? flipped : Math.max(8, vh - estH - 8);
  }
  const left = Math.max(8, Math.min(selectionX, vw - panelW - 8));

  const sourceText = blocks.map((b) => b.original).join('\n');
  const translatedText = blocks.map((b) => b.translated || b.original).join('\n');
  const allTranslated = blocks.length > 0 && blocks.every((b) => b.translated);
  // Auto source-language label for the header pill (Youdao shows the pair)
  const srcHasCJK = blocks.some((b) => /[\u4e00-\u9fff]/.test(b.original));
  const srcLabel = srcHasCJK ? '中文' : 'English';
  const isAiRefined = blocks.some(
    (b) => b.sourceTier && (b.sourceTier.includes('✨') || b.sourceTier.includes('AI 精翻') || b.sourceTier.includes('LLM'))
  );

  return (
    <div
      className={`overlay-panel absolute flex flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-2xl ${
        isLight
          ? 'bg-white/95 border-slate-300 text-slate-800'
          : 'bg-slate-900/92 border-white/15 text-zinc-100'
      }`}
      style={{ left, top, width: panelW, maxHeight: estH, zIndex: 230 }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Panel header */}
      <div className={`flex items-center justify-between gap-2 px-4 py-2.5 border-b shrink-0 ${
        isLight ? 'border-slate-200 bg-slate-100/70' : 'border-white/10 bg-white/[0.04]'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">🖼️</span>
          <span className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>截图翻译</span>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
            isLight ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-blue-500/15 border-blue-400/30 text-sky-300'
          }`}>
            {srcLabel} ⇄ {targetLang}
          </span>
          {isAiRefined && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500/15 to-indigo-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400 shrink-0 select-none shadow-xs">
              ✨ AI 精翻
            </span>
          )}
          {translating && (
            <span className="text-[10px] font-mono text-sky-400 animate-pulse">翻译中…</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSwitchMode}
            className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition cursor-pointer ${
              isLight ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200' : 'bg-white/[0.06] border-white/10 text-zinc-300 hover:bg-white/[0.12]'
            }`}
            title="切换为原位覆盖模式 (M)"
          >
            🃏 原位模式
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded-lg transition cursor-pointer ${isLight ? 'text-slate-400 hover:text-rose-600' : 'text-zinc-400 hover:text-rose-400'}`}
            title="关闭划词 (Esc)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body — web-Youdao style: source column | translation column with
          per-sentence hover linkage (panel rows ↔ screen dashed outlines) */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className={dualColumn ? 'grid grid-cols-[2fr_3fr]' : 'flex flex-col'}>
          {/* Source column (or top section when narrow) */}
          <div
            className={`px-4 py-3 space-y-1 ${dualColumn ? 'border-r' : 'border-b'} ${
              isLight ? 'border-slate-200 bg-slate-50/70' : 'border-white/[0.07] bg-black/25'
            }`}
          >
            <div className={`flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider pb-1 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
              原文
            </div>
            {blocks.map((b, i) => {
              const hovered = hoverIndex === i;
              return (
                <div
                  key={i}
                  data-row-index={i}
                  data-row-side="src"
                  className={`rounded-md px-2 py-1.5 transition-colors cursor-default ${hovered ? (isLight ? 'bg-sky-100/90' : 'bg-sky-500/15') : ''}`}
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                >
                  <p className={`text-[11.5px] font-mono leading-relaxed break-all ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                    {b.original}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Translation column (or bottom section when narrow) */}
          <div className="px-4 py-3 space-y-1">
            <div className={`flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider pb-1 ${isLight ? 'text-blue-500' : 'text-sky-400'}`}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
              译文
            </div>
            {blocks.map((b, i) => {
              const hovered = hoverIndex === i;
              return (
                <div
                  key={i}
                  data-row-index={i}
                  data-row-side="dst"
                  className={`rounded-md px-2 py-1.5 transition-colors cursor-default ${hovered ? (isLight ? 'bg-sky-100/90' : 'bg-sky-500/15') : ''}`}
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                >
                  <p className={`text-[15px] font-semibold leading-relaxed break-words ${
                    b.translated
                      ? (isLight ? 'text-slate-900' : 'text-white')
                      : (isLight ? 'text-slate-400 italic' : 'text-zinc-500 italic')
                  }`}>
                    {b.translated || '识别完成，翻译接管中…'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className={`flex items-center justify-between gap-2 px-4 py-2.5 border-t shrink-0 ${
        isLight ? 'border-slate-200 bg-slate-100/70' : 'border-white/10 bg-white/[0.04]'
      }`}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onCopyText(translatedText)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
              isLight ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400'
            }`}
            title="复制全部译文"
          >
            📋 复制译文
          </button>
          <button
            type="button"
            onClick={() => onCopyText(sourceText)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
              isLight ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200' : 'bg-white/[0.06] border-white/10 text-zinc-300 hover:bg-white/[0.12]'
            }`}
            title="复制全部原文"
          >
            📄 原文
          </button>
          <button
            type="button"
            onClick={() => onSpeech(allTranslated ? translatedText : sourceText)}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
              isLight ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200' : 'bg-white/[0.06] border-white/10 text-zinc-300 hover:bg-white/[0.12]'
            }`}
            title="朗读"
          >
            🔊
          </button>
          <button
            type="button"
            onClick={onRetranslate}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
              isLight ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200' : 'bg-white/[0.06] border-white/10 text-zinc-300 hover:bg-white/[0.12]'
            }`}
            title="重新翻译"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={onPin}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
              isLight ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200' : 'bg-white/[0.06] border-white/10 text-zinc-300 hover:bg-white/[0.12]'
            }`}
            title="贴图到桌面（置顶小窗，可拖拽/滚轮缩放）"
            data-testid="pin-all-button"
          >
            📌 贴图
          </button>
          <button
            type="button"
            onClick={() => void onExportImage()}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
              isLight ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200' : 'bg-white/[0.06] border-white/10 text-zinc-300 hover:bg-white/[0.12]'
            }`}
            title="导出为分享图片（保存到 图片库/猫步翻译/exports）"
          >
            🖼 导出图片
          </button>
        </div>
        <span className={`text-[10px] font-mono ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
          {blocks.length} 段 · 悬停联动原文位置
        </span>
      </div>
    </div>
  );
};

export { YoudaoResultPanel };
