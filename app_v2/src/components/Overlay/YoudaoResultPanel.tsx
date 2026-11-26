import React from 'react';
import type { OverlayBlock } from '../../services/types';
import { isDenseProseLayout } from '../../services/overlayDisplayPolicy';
import { isSuccessfulLlmTier } from '../../services/pipelineDiagnostics';

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
  const denseProse = isDenseProseLayout(blocks);
  const dualColumn = maxAvailW >= 560 && !denseProse;
  const panelW = denseProse ? Math.min(760, maxAvailW) : Math.max(
    dualColumn ? 520 : 320,
    Math.min(dualColumn ? 720 : 480, Math.max(selectionW, dualColumn ? 520 : 320), maxAvailW)
  );
  const estH = denseProse
    ? Math.min(Math.max(420, blocks.length * 92), Math.floor(vh * 0.75))
    : Math.min(Math.max(180 + blocks.length * 46, 240), Math.floor(vh * 0.7));
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
  const targetLabel = targetLang === 'auto' ? (srcHasCJK ? 'English' : '中文') : targetLang;
  const isAiRefined = blocks.some(
    (b) => !b.translationFailed && !!b.sourceTier && isSuccessfulLlmTier(b.sourceTier)
  );

  return (
    <div
      className="overlay-panel vision-modal-shell animate-modal-pop absolute flex flex-col overflow-hidden rounded-[20px]"
      style={{ left, top, width: panelW, maxHeight: estH, zIndex: 230, color: 'var(--g-text-1)' }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: 'var(--g-hairline)', background: 'var(--g-surface-2)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">🖼️</span>
          <span className="text-xs font-bold">截图翻译</span>
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold"
            style={{
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent-border)',
              color: 'var(--accent-text)',
            }}
          >
            {srcLabel} → {targetLabel}
          </span>
          {isAiRefined && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500/15 to-indigo-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400 shrink-0 select-none shadow-xs">
              ✨ AI 精翻
            </span>
          )}
          {translating && (
            <span className="text-[10px] font-mono animate-pulse" style={{ color: 'var(--accent-text)' }}>翻译中…</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSwitchMode}
            className="lg-btn !px-2.5 !py-1 !rounded-full text-[10px] font-semibold cursor-pointer"
            title="切换为原位覆盖模式 (M)"
          >
            🃏 原位模式
          </button>
          <button
            type="button"
            onClick={onClose}
            className="lg-btn lg-btn-ghost !p-1.5 !rounded-full hover:text-rose-500 transition cursor-pointer"
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
            className={`px-4 py-3 space-y-1 ${dualColumn ? 'border-r' : 'border-b'}`}
            style={{ borderColor: 'var(--g-hairline)', background: isLight ? 'rgba(15, 23, 42, 0.025)' : 'rgba(0, 0, 0, 0.16)' }}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider pb-1" style={{ color: 'var(--g-text-3)' }}>
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
                  className="rounded-lg px-2.5 py-1.5 transition-all cursor-default border-l-2"
                  style={
                    hovered
                      ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                      : { borderColor: 'transparent' }
                  }
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                >
                  <p
                    className={`${denseProse ? 'text-[13px] font-normal break-words' : 'text-[11.5px] font-mono break-all'} leading-relaxed`}
                    style={{ color: 'var(--g-text-2)' }}
                  >
                    {b.original}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Translation column (or bottom section when narrow) */}
          <div className="px-4 py-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider pb-1" style={{ color: 'var(--accent-text)' }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
              译文
            </div>
            {blocks.map((b, i) => {
              const hovered = hoverIndex === i;
              return (
                <div
                  key={i}
                  data-row-index={i}
                  data-row-side="dst"
                  className="rounded-lg px-2.5 py-1.5 transition-all cursor-default border-l-2"
                  style={
                    hovered
                      ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                      : { borderColor: 'transparent' }
                  }
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                >
                  <p
                    className={`${denseProse ? 'text-[14px] font-normal' : 'text-[15px] font-semibold'} leading-relaxed break-words ${
                      b.translated ? '' : 'italic opacity-60'
                    }`}
                    style={{ color: b.translated ? 'var(--g-text-1)' : 'var(--g-text-3)' }}
                  >
                    {b.translated || '识别完成，翻译接管中…'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2.5 border-t shrink-0"
        style={{ borderColor: 'var(--g-hairline)', background: 'var(--g-surface-2)' }}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => onCopyText(translatedText)}
            className="lg-btn lg-btn-primary !px-3 !py-1.5 !rounded-full text-[11px] font-semibold cursor-pointer"
            title="复制全部译文"
          >
            📋 复制译文
          </button>
          <button
            type="button"
            onClick={() => onCopyText(sourceText)}
            className="lg-btn !px-2.5 !py-1.5 !rounded-full text-[11px] font-medium cursor-pointer"
            title="复制全部原文"
          >
            📄 原文
          </button>
          <button
            type="button"
            onClick={() => onSpeech(allTranslated ? translatedText : sourceText)}
            className="lg-btn !px-2.5 !py-1.5 !rounded-full text-[11px] font-medium cursor-pointer"
            title="朗读"
          >
            🔊
          </button>
          <button
            type="button"
            onClick={onRetranslate}
            className="lg-btn !px-2.5 !py-1.5 !rounded-full text-[11px] font-medium cursor-pointer"
            title="重新翻译"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={onPin}
            className="lg-btn !px-2.5 !py-1.5 !rounded-full text-[11px] font-medium cursor-pointer"
            title="贴图到桌面（置顶小窗，可拖拽/滚轮缩放）"
            data-testid="pin-all-button"
          >
            📌 贴图
          </button>
          <button
            type="button"
            onClick={() => void onExportImage()}
            className="lg-btn !px-2.5 !py-1.5 !rounded-full text-[11px] font-medium cursor-pointer"
            title="导出为分享图片（保存到 图片库/猫步翻译/exports）"
          >
            🖼 导出图片
          </button>
        </div>
        <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--g-text-3)' }}>
          {blocks.length} 段 · 悬停联动原文位置
        </span>
      </div>
    </div>
  );
};

export { YoudaoResultPanel };
