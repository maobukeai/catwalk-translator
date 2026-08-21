import React, { useState, useEffect, useRef } from 'react';
import type { OverlayBlock } from '../../services/types';

// ── OverlayBlockCard: a single translated text block rendered in-place ─────────
export type CardViewMode = 'translated' | 'original' | 'bilingual';

export interface OverlayBlockCardProps {
  block: OverlayBlock;
  /** Original index inside overlayResult.blocks (stable across re-sorts). */
  blockIndex: number;
  onClose: (force?: boolean) => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onCopySingle?: (text: string) => void;
  /** Right-click opens the per-card context menu instead of closing the overlay. */
  onCardContextMenu?: (e: React.MouseEvent) => void;
  /** Present when this block's translation failed — shows an inline retry. */
  onRetry?: () => void;
  /** 译文 / 原文 / 双语对照 (global O key cycles). */
  viewMode?: CardViewMode;
  /** Per-card zoom multiplier (Ctrl+wheel / A± buttons), clamped 0.6–2.0. */
  scale?: number;
  onScaleChange?: (scale: number) => void;
  onViewCycle?: () => void;
  /** Hover marks this card as the active keyboard target (Space / Ctrl+D / ↑↓). */
  onActive?: () => void;
  isActive?: boolean;
  /** Reports the real rendered height so wrapped cards avoid overlapping. */
  onRenderedHeight?: (blockIndex: number, height: number) => void;
}

export const clampCardScale = (s: number) => Math.min(2.0, Math.max(0.6, s));

/**
 * 将采样背景色转换为 100% 实色不透明背景（彻底遮盖底层文字，杜绝透字重叠 Bug）。
 * 若未提供背景色或为 transparent，根据文字色/亮度回退至实深色 #0d1117 或实白色 #ffffff。
 */
export function toSolidBg(bgCss?: string, fgCss?: string): string {
  if (!bgCss || !bgCss.trim() || bgCss === 'transparent') {
    return isLightBg(bgCss, fgCss) ? '#ffffff' : '#0d1117';
  }
  const str = bgCss.trim();

  // Match rgb(r, g, b) or rgba(r, g, b, a) -> return solid rgb(r, g, b)
  const rgbMatch = str.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+%?)?\s*\)$/i);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Match hex #RGB, #RGBA, #RRGGBB, #RRGGBBAA -> return solid #RRGGBB
  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      return `#${hex.slice(0, 6)}`;
    }
  }

  // Match hsl(h, s, l) or hsla(h, s, l, a) -> return solid hsl(h, s, l)
  const hslMatch = str.match(/^hsla?\s*\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)(?:\s*,\s*[\d.]+%?)?\s*\)$/i);
  if (hslMatch) {
    const [, h, s, l] = hslMatch;
    return `hsl(${h}, ${s}, ${l})`;
  }

  return str;
}

/**
 * 将采样背景色转换为高质感半透明层（支持 hex, rgb, rgba, hsl 等各种格式）。
 * 默认透明度 0.78，配合 backdropFilter 磨砂模糊可达到极佳的视觉融入感。
 */
export function toTranslucentBg(bgCss?: string, alpha = 0.78): string {
  if (!bgCss || !bgCss.trim() || bgCss === 'transparent') {
    return `rgba(18, 24, 38, ${alpha})`;
  }
  const str = bgCss.trim();

  // Match rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = str.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+%?)?\s*\)$/i);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Match hex #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
  }

  // Match hsl(h, s, l) or hsla(h, s, l, a)
  const hslMatch = str.match(/^hsla?\s*\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)(?:\s*,\s*[\d.]+%?)?\s*\)$/i);
  if (hslMatch) {
    const [, h, s, l] = hslMatch;
    return `hsla(${h}, ${s}, ${l}, ${alpha})`;
  }

  return str;
}

/**
 * 判断当前采样背景是否为浅色底，从而自适应选择浅色或深色微透明边框
 */
export function isLightBg(bgCss?: string, fgCss?: string): boolean {
  if (fgCss) {
    const lowerFg = fgCss.toLowerCase().replace(/\s/g, '');
    if (lowerFg === '#000' || lowerFg === '#000000' || lowerFg === 'black' || lowerFg === 'rgb(0,0,0)') {
      return true;
    }
  }
  if (!bgCss) return false;
  const rgbMatch = bgCss.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 140;
  }
  if (bgCss.startsWith('#')) {
    let hex = bgCss.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum > 140;
    }
  }
  return false;
}

export const OverlayBlockCard: React.FC<OverlayBlockCardProps> = ({
  block,
  blockIndex,
  isPinned,
  onTogglePin,
  onCopySingle,
  onCardContextMenu,
  onRetry,
  viewMode = 'translated',
  scale = 1,
  onScaleChange,
  onViewCycle,
  onActive,
  isActive,
  onRenderedHeight,
}) => {
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ mx: 0, my: 0, ox: 0, oy: 0 });
  const [pos, setPos] = useState({ x: block.logicalX, y: block.logicalY });
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const userDraggedRef = useRef(false);

  // Follow external re-layout (AABB push after rendered-height reports, watch
  // refreshes) unless the user manually dragged this card somewhere.
  useEffect(() => {
    if (userDraggedRef.current) return;
    if (Math.abs(pos.x - block.logicalX) > 4 || Math.abs(pos.y - block.logicalY) > 4) {
      setPos({ x: block.logicalX, y: block.logicalY });
    }
  }, [block.logicalX, block.logicalY, pos.x, pos.y]);

  // Real rendered height feeds the parent's AABB collision avoidance so wrapped
  // (multi-line) cards push neighbours down instead of covering them.
  const lastReportedHRef = useRef(0);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !cardRef.current || !onRenderedHeight) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h > 0 && Math.abs(h - lastReportedHRef.current) > 2) {
        lastReportedHRef.current = h;
        onRenderedHeight(blockIndex, h);
      }
    });
    ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [blockIndex, onRenderedHeight]);

  // Ctrl+wheel zooms this card's font (native listener: wheel must be
  // non-passive to preventDefault the browser page zoom).
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !onScaleChange) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      const factor = ev.deltaY < 0 ? 1.1 : 0.9;
      onScaleChange(clampCardScale(scaleRef.current * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onScaleChange]);

  // 动态字号与排版计算：字号贴合 OCR 实测行高（CJK 墨高≈0.9em，拉丁混排
  // ≈1.0em）。不再夹在 11–14px——大字按原大渲染，才有"嵌在原文里"的感觉。
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  // Pending = stage-2 translation not arrived yet: show the OCR original with a
  // subtle shimmer so the swap to the translation feels like a live handover.
  const isPending = !block.translated;
  const displayText = block.translated || block.original;
  const primaryText = viewMode === 'original' ? block.original : displayText;
  const rawLines = (block.original || '').split('\n').filter(Boolean);
  const lineCount = Math.max(1, rawLines.length);
  const singleLineH = Math.max(10, block.logicalH / lineCount);
  const nonSpaceLen = Math.max(1, block.original.replace(/\s/g, '').length);
  const cjkCount = (block.original.match(/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g) || []).length;
  const emFactor = cjkCount / nonSpaceLen > 0.3 ? 1.05 : 0.92;
  const baseFontSize = singleLineH * emFactor;
  const fontSize = Math.round(Math.min(64, Math.max(9, baseFontSize)) * scale);
  const maxWidth = Math.min(vw - pos.x - 20, Math.max(Math.round(block.logicalW * 1.6 + 24), 160));
  const isLight = isLightBg(block.bgCss, block.fgCss);
  const hasPatch = !!block.patchPng && (block.patchW ?? 0) > 0;

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button === 2) {
      // Right-click opens the card context menu (parent handles positioning)
      onCardContextMenu?.(e);
      return;
    }
    if (e.button === 0) {
      userDraggedRef.current = true;
      setDragging(true);
      setDragStart({ mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y });
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPos({
      x: dragStart.ox + (e.clientX - dragStart.mx),
      y: dragStart.oy + (e.clientY - dragStart.my),
    });
  };

  const onMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDragging(false);
  };

  // 悬停/固定/失败态一律用 boxShadow 描边——不占布局空间，卡片默认态
  // 保持零边框、零内边距，文字与 OCR 框逐像素对齐。
  const cardBoxShadow = isPinned
    ? '0 0 0 1.5px rgba(245, 158, 11, 0.8), 0 2px 8px rgba(0, 0, 0, 0.15)'
    : dragging
    ? '0 8px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(56, 189, 248, 0.4)'
    : block.translationFailed
    ? '0 0 0 1.5px rgba(248, 113, 113, 0.75), 0 2px 8px rgba(0, 0, 0, 0.15)'
    : isActive
    ? '0 0 8px rgba(56, 189, 248, 0.25), 0 2px 8px rgba(0, 0, 0, 0.15)'
    : isHovered
    ? (isLight ? '0 0 0 1px rgba(0, 0, 0, 0.28)' : '0 0 0 1px rgba(56, 189, 248, 0.6)')
    : 'none';

  return (
    <div
      ref={cardRef}
      className="overlay-block group absolute flex flex-col justify-center transition-all duration-150"
      style={{
        boxSizing: 'border-box',
        left: pos.x,
        top: pos.y,
        width: 'fit-content',
        maxWidth,
        minHeight: block.logicalH,
        height: 'auto',
        // 有抹除补丁时卡片本体透明：补丁负责盖住原文并延续真实背景；
        // 无补丁（旧后端/测试）回退为实色底遮盖。
        background: hasPatch ? 'transparent' : toSolidBg(block.bgCss, block.fgCss),
        color: block.fgCss,
        fontSize: `${fontSize}px`,
        fontFamily: '"Segoe UI Variable", "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif',
        fontWeight: 400,
        lineHeight: 1.1,
        cursor: dragging ? 'grabbing' : 'move',
        zIndex: isPinned ? 210 : 200,
        borderRadius: 0,
        border: 'none',
        boxShadow: cardBoxShadow,
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        padding: 0,
      }}
      title={`${block.original} → ${block.translated || '翻译中…'} [${block.sourceTier}]`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseEnter={() => {
        setIsHovered(true);
        onActive?.();
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCardContextMenu?.(e);
      }}
    >
      {/* 抹除补丁：OCR 框外扩区域经背景插值抹掉字形后的 PNG。边缘像素与
          屏幕真实背景逐像素衔接，实现"原文被抹除、译文嵌入背景"的效果。 */}
      {hasPatch && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: (block.patchX ?? block.logicalX) - block.logicalX,
            top: (block.patchY ?? block.logicalY) - block.logicalY,
            width: block.patchW ?? block.logicalW,
            height: block.patchH ?? block.logicalH,
            backgroundImage: `url(data:image/png;base64,${block.patchPng})`,
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}

      {/* Stage-2 pending shimmer: original text is visible under a moving sheen */}
      {isPending && (
        <span className="overlay-shimmer pointer-events-none absolute inset-0" aria-hidden />
      )}

      {/* 双语对照：原文小字灰字在上，译文主体在下 */}
      {viewMode === 'bilingual' && (
        <span
          className="relative leading-snug"
          style={{ fontSize: '0.72em', opacity: 0.72, userSelect: 'text' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {block.original}
        </span>
      )}
      <span
        className={`relative ${isPending ? 'opacity-80' : 'tooltip-pop'}`}
        style={{ userSelect: 'text', lineHeight: 'inherit' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {primaryText}
      </span>

      {/* 📌 Pin indicator on card top-right when pinned */}
      {isPinned && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className="absolute -top-2 -right-2 z-30 flex items-center justify-center w-4.5 h-4.5 rounded-full text-[9px] shadow-sm transition-all duration-150 cursor-pointer bg-amber-500 text-white scale-100 opacity-100 ring-1 ring-white/70 shadow-amber-500/40"
          title="已固定（点击或按 Ctrl+P 解除）"
        >
          📌
        </button>
      )}
    </div>
  );
};
