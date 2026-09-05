import React, { useState, useEffect, useRef } from 'react';
import type { OverlayBlock } from '../../services/types';

// ── OverlayBlockCard: a single translated text block rendered in-place ─────────
export type CardViewMode = 'translated' | 'original' | 'bilingual';

export const FALLBACK_FONT_FAMILY =
  '"Segoe UI Variable", "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif';

/**
 * 用 canvas measureText 在应用字体下量出文本的真实渲染宽度（基准 100px 再等比折算）。
 * 返回 0 表示测宽不可用（如 JSDOM 测试环境），调用方回退到字符数启发式。
 * 相比按字符数×平均字宽估算，实测宽度让字号收缩一步到位，排版更贴近原位。
 */
let measureCtxState: { ctx: CanvasRenderingContext2D | null; family: string } | undefined;

function measureTextWidth(text: string, fontSize: number): number {
  try {
    if (!measureCtxState) {
      let family = FALLBACK_FONT_FAMILY;
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const v = getComputedStyle(document.documentElement)
          .getPropertyValue('--app-font-family')
          .trim();
        if (v) family = v;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext && canvas.getContext('2d');
      measureCtxState = {
        ctx: ctx && typeof ctx.measureText === 'function' ? ctx : null,
        family,
      };
    }
    const { ctx, family } = measureCtxState;
    if (!ctx || !text) return 0;
    ctx.font = `100px ${family}`;
    const w = ctx.measureText(text).width;
    if (!Number.isFinite(w) || w <= 0) return 0;
    return (w * fontSize) / 100;
  } catch {
    return 0;
  }
}

interface OverlayBlockCardProps {
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
  /** Hover leaves card, clearing active focus when mouse moves away. */
  onInactive?: () => void;
  isActive?: boolean;
  /** Reports the real rendered size so wrapped/wide cards avoid overlapping. */
  onRenderedSize?: (blockIndex: number, size: { width: number; height: number }) => void;
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

/**
 * 智能计算高清晰度文字颜色：
 * 浅色/中浅色背景下：强制使用纯黑 (#000000) 确保极致深邃与清晰度，消除发灰发虚；
 * 深色背景下：若采样前景过暗或发灰，拉升至纯白 (#ffffff)，确保强对比度。
 */
export function getCardTextColor(bgCss?: string, fgCss?: string): string {
  const isLight = isLightBg(bgCss, fgCss);
  if (isLight) {
    return '#000000';
  }
  if (fgCss && fgCss !== 'transparent') {
    const rgbMatch = fgCss.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 160) return '#ffffff';
    }
    return fgCss;
  }
  return '#ffffff';
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
  onInactive,
  isActive,
  onRenderedSize,
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
    // 2px 死区：跟随重排纠偏，同时避免 watch 刷新时的轻微抖动
    if (Math.abs(pos.x - block.logicalX) > 2 || Math.abs(pos.y - block.logicalY) > 2) {
      setPos({ x: block.logicalX, y: block.logicalY });
    }
  }, [block.logicalX, block.logicalY, pos.x, pos.y]);

  // Real rendered size feeds the parent's AABB collision avoidance so wrapped
  // (multi-line/taller) cards push neighbours down instead of covering them.
  // Width uses scrollWidth: fit-content caps at maxWidth, but a single-line-
  // locked card whose text still overflows reports its true ink width.
  const lastReportedSizeRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !cardRef.current || !onRenderedSize) return;
    const el = cardRef.current;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      const w = el.scrollWidth || entries[0]?.contentRect.width || 0;
      const last = lastReportedSizeRef.current;
      if (h > 0 && (Math.abs(h - last.h) > 2 || Math.abs(w - last.w) > 2)) {
        lastReportedSizeRef.current = { w, h };
        onRenderedSize(blockIndex, { width: w, height: h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [blockIndex, onRenderedSize]);

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

  // 动态字号与排版计算：
  // 1. 根据原文与译文长度/字符集，计算理想贴合字号，使得译文在原文位置区域内自然缩放对齐；
  // 2. 避免译文较长时产生巨大字号导致多行膨胀与错位。
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const isPending = !block.translated;
  const displayText = block.translated || block.original;
  const primaryText = viewMode === 'original' ? block.original : displayText;
  const rawLines = (block.original || '').split('\n').filter(Boolean);
  const lineCount = Math.max(1, rawLines.length);
  // 原文单行时,显示文本里的换行(LLM 偶尔在译文中返回换行符)合并为空格,
  // 否则译文会被直接渲染成两行
  const renderText =
    lineCount === 1 ? primaryText.replace(/\s*\n+\s*/g, ' ').trim() : primaryText;
  const singleLineH = Math.max(10, block.logicalH / lineCount);
  const nonSpaceLen = Math.max(1, block.original.replace(/\s/g, '').length);
  const cjkCount = (block.original.match(/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g) || []).length;
  // OCR 检测框天然包含行距与 DBNet unclip 安全扩展，真实印刷字高约占框高的 68%~72%。
  // 采用 0.72 (CJK) 与 0.66 (西文) 使渲染字号与原图真实字号 1:1 贴合，彻底消除字体臃肿、冲出边框与上下挤压。
  const emFactor = cjkCount / nonSpaceLen > 0.3 ? 0.72 : 0.66;
  const baseFontSize = singleLineH * emFactor;

  // 自适应字号缩放计算 (Auto Font-Fit Calculation)
  // 识别阶段(显示原文)同样应用：原文字体被替换为应用字体后常比 OCR 框更宽，
  // 若不收缩会把卡片撑高、经 AABB 连锁推挤邻居，表现为「识别阶段排布凌乱」。
  // 多行块（original 含 \n）按最长一行估宽，避免按总长度过度缩小字号。
  // 卡片最大宽度收紧到原文 1.15 倍;提前计算以便单行适配时用视口安全值
  const cardMaxWidth = Math.min(
    vw - pos.x - 20,
    Math.max(Math.round(block.logicalW * 1.15 + 12), 120)
  );
  let targetFontSize = baseFontSize;
  // 原文单行 → 无条件锁定单行渲染(nowrap),不只限于触发了字号收缩的情况:
  // 未收缩分支下 canvas 度量稍有偏差也会在 maxWidth 处折行
  const singleLineLock = lineCount === 1;
  let estimatedWidth = 0;
  if (renderText) {
    const displayLines = renderText.split('\n').filter(Boolean);
    const longestLen = displayLines.reduce((m, l) => Math.max(m, l.length), 1);
    const dispCjkCount = (renderText.match(/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g) || []).length;
    const dispIsCjk = dispCjkCount / Math.max(1, renderText.replace(/\s/g, '').length) > 0.3;
    // 优先用 canvas 实测最长一行的真实渲染宽度；不可用时退回字符数×平均字宽
    // 启发式（CJK 约 1.05em，西文约 0.52em）
    for (const line of displayLines) {
      const w = measureTextWidth(line, baseFontSize);
      if (w > estimatedWidth) estimatedWidth = w;
    }
    if (estimatedWidth <= 0) {
      const charWidthRatio = dispIsCjk ? 1.05 : 0.52;
      estimatedWidth = longestLen * charWidthRatio * baseFontSize;
    }
    // 译文贴合原文:允许超出 5%;贴屏边时以视口安全宽度为准(否则仍会被迫换行)
    const allowedWidth = Math.min(
      Math.max(block.logicalW * 1.05, 60),
      Math.max(cardMaxWidth - 4, 40)
    );

    if (estimatedWidth > allowedWidth) {
      if (lineCount === 1) {
        // 原文单行 → 译文强制单行自适应缩放,绝不折行。
        // 3% 安全余量抵消字体度量误差,下限 6px(比原来 minSafe 门槛更激进,
        // 避免长译文掉进"双行折行"分支把一行原文变成两行卡片)
        const fitSize = baseFontSize * (allowedWidth / estimatedWidth) * 0.97;
        targetFontSize = Math.max(6, Math.min(baseFontSize, fitSize));
      } else {
        // 多行原文:按双行预算分配,保留可读下限
        const minSafeFontSize = Math.max(8, singleLineH * 0.5);
        const twoLineFitSize = baseFontSize * ((allowedWidth * 1.6) / estimatedWidth);
        targetFontSize = Math.max(minSafeFontSize, Math.min(baseFontSize * 0.88, twoLineFitSize));
      }
    }
  }

  // 单行锁定时下限放到 6px,否则最终 Math.max(9) 会把算好的适配字号顶回去,
  // 文字比 allowedWidth 宽照样换行——这正是"一行原文译成两行"的来源之一
  const fontSize = Math.round(
    Math.min(64, Math.max(singleLineLock ? 6 : 9, targetFontSize)) * scale
  );
  // 卡片最大宽度收紧到原文 1.15 倍,译文不再明显超出原文区域
  const maxWidth = cardMaxWidth;
  const isLight = isLightBg(block.bgCss, block.fgCss);
  const hasPatch = !!block.patchPng && (block.patchW ?? 0) > 0;
  const solidBg = toSolidBg(block.bgCss, block.fgCss);
  const isMoved = dragging || userDraggedRef.current;
  const renderedTextW = baseFontSize > 0 ? (estimatedWidth * (fontSize / (baseFontSize * Math.max(scale, 0.01)))) : estimatedWidth;
  const patchW = block.patchW ?? block.logicalW;
  const patchH = block.patchH ?? block.logicalH;
  const isOverflowingPatch = hasPatch && (patchW < Math.min(maxWidth, renderedTextW) || patchH < block.logicalH);
  const cardBg = isMoved || !hasPatch || isOverflowingPatch ? solidBg : undefined;

  const onDragStart = (e: React.MouseEvent | React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      // Right-click is handled by onContextMenu to avoid duplicate calls
      return;
    }
    if (e.button === 0) {
      if (dragging) return;
      e.stopPropagation();
      userDraggedRef.current = true;
      setDragging(true);
      setDragStart({ mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y });
      if ('setPointerCapture' in e.currentTarget && 'pointerId' in e) {
        try {
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        } catch {}
      }
    }
  };

  const onDragMove = (e: React.MouseEvent | React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.stopPropagation();
    setPos({
      x: dragStart.ox + (e.clientX - dragStart.mx),
      y: dragStart.oy + (e.clientY - dragStart.my),
    });
  };

  const onDragEnd = (e: React.MouseEvent | React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      e.stopPropagation();
      setDragging(false);
      if ('releasePointerCapture' in e.currentTarget && 'pointerId' in e) {
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {}
      }
    }
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
        backgroundColor: cardBg,
        color: getCardTextColor(block.bgCss, block.fgCss),
        fontSize: `${fontSize}px`,
        fontFamily: 'var(--app-font-family, "Segoe UI Variable Text", "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif)',
        fontWeight: fontSize <= 20 ? 600 : 500,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        textRendering: 'optimizeLegibility',
        letterSpacing: '0.015em',
        lineHeight: 1.2,
        cursor: dragging ? 'grabbing' : 'move',
        zIndex: isPinned ? 210 : 200,
        borderRadius: isMoved ? 6 : 2,
        border: 'none',
        boxShadow: cardBoxShadow,
        textShadow: isLight
          ? '0 0 1px rgba(0, 0, 0, 0.15)'
          : '0 0 1.5px rgba(0, 0, 0, 0.85), 0 1px 2px rgba(0, 0, 0, 0.6)',
        // pre-wrap：合并块 original 里的 \n 必须真实换行（normal 会折叠成空格
        // 导致整段在 maxWidth 处乱换行、卡片被撑高）
        // 单行锁定时用 nowrap 双保险:配合已收缩的字号,度量误差也绝不折行
        whiteSpace: singleLineLock ? 'nowrap' : 'pre-wrap',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        // 仅保留侧边余量，左/上 padding 为 0：文字与 OCR 框逐像素对齐
        padding: isMoved ? '3px 8px' : '0 2px 0 0',
      }}
      title={`${block.original} → ${block.translated || '翻译中…'} [${block.sourceTier}]`}
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onMouseDown={onDragStart}
      onMouseMove={onDragMove}
      onMouseUp={onDragEnd}
      onMouseEnter={() => {
        setIsHovered(true);
        onActive?.();
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onInactive?.();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCardContextMenu?.(e);
      }}
    >
      {/* 保底实色抹除底板：与插值 patch 边界完全重合（作为 PNG 加载失败的兜底）。
          任何外扩都会在渐变/纹理背景上露出中位数色边——即用户看到的「不干净」色边 */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={
          hasPatch
            ? {
                // 锚定屏幕坐标而非卡片坐标：卡片被 AABB 推挤或拖动时，patch 若
                // 跟着移动会把「别处的背景」盖到新位置上——横穿邻行字形，呈现
                // 为一条划掉邻文的横线。绝对定位内 left/top 用屏幕值减 pos 即可。
                top: (block.patchY ?? pos.y) - pos.y,
                left: (block.patchX ?? pos.x) - pos.x,
                width: block.patchW ?? block.logicalW,
                height: block.patchH ?? block.logicalH,
                background: toSolidBg(block.bgCss, block.fgCss),
                borderRadius: 0,
                zIndex: 0,
              }
            : {
                top: -3,
                left: -4,
                right: -4,
                bottom: -3,
                background: toSolidBg(block.bgCss, block.fgCss),
                borderRadius: 3,
                zIndex: 0,
              }
        }
      />

      {/* 抹除补丁：OCR 框外扩区域经背景插值抹掉字形后的 PNG。边缘像素与
          屏幕真实背景逐像素衔接，实现"原文被抹除、译文嵌入背景"的效果。 */}
      {hasPatch && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            // 同底板：锚定屏幕坐标，卡片被推挤/拖动后 patch 仍精确盖住它
            // 所来源的屏幕区域（其像素本就是从那里插值来的）
            left: (block.patchX ?? pos.x) - pos.x,
            top: (block.patchY ?? pos.y) - pos.y,
            width: block.patchW ?? block.logicalW,
            height: block.patchH ?? block.logicalH,
            backgroundImage: `url(data:image/png;base64,${block.patchPng})`,
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
            // patch 边缘需与屏幕真实背景逐像素衔接，圆角会裁掉对齐的边角出现接缝
            borderRadius: 0,
            zIndex: 1,
          }}
        />
      )}

      {/* Stage-2 pending shimmer: original text is visible under a moving sheen */}
      {isPending && (
        <span className="overlay-shimmer pointer-events-none absolute inset-0 z-[2]" aria-hidden />
      )}

      {/* 双语对照：原文小字灰字在上，译文主体在下 */}
      {viewMode === 'bilingual' && (
        <span
          className="relative z-[2] leading-snug"
          style={{ fontSize: '0.72em', opacity: 0.72, userSelect: 'text' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {block.original}
        </span>
      )}
      <span
        key={displayText}
        className={`relative z-[2] transition-opacity duration-200 ${isPending ? 'opacity-80' : 'tooltip-pop'}`}
        style={{ userSelect: 'text', lineHeight: 'inherit' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {renderText}
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
