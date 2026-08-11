/**
 * CaptureOverlay — Ultra-fast invisible selection mask with instant in-place translation overlay.
 *
 * Performance-optimised flow (<200ms end-to-end):
 *  1. Hotkey -> Rust hides main window and expands transparent always-on-top selection window (0ms image transfer delay)
 *  2. User draws selection rect directly over real screen
 *  3. On mouse release: Rust captures ONLY that 300x50 region via native GDI BitBlt (<1ms)
 *  4. Feed tiny region BMP to persistent RapidOCR daemon (<80ms) + sample background colors
 *  5. Render in-place translated text blocks directly at exact original screen coordinates
 *  6. Right-click or Esc to dismiss and restore main window
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  cmdBeginCapture,
  cmdShowOverlay,
  cmdCloseOverlay,
  cmdRegionOcrTranslate,
  saveTranslationHistory,
  isTauri,
} from '../../services/tauri';
import type { OverlayBlock, OverlayResult } from '../../services/types';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface CaptureOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSendToMainWindow?: (text: string) => void;
}

type Phase =
  | 'idle'          // not open
  | 'selecting'     // invisible mask open, user drawing selection
  | 'processing'    // region capture + OCR + translate running
  | 'overlay';      // transparent overlay displaying in-place translated blocks

export const CaptureOverlay: React.FC<CaptureOverlayProps> = ({
  isOpen,
  onClose,
  onSendToMainWindow,
}) => {
  const { settings, setCaptureEngine } = useSettingsStore();

  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  const [phase, setPhase] = useState<Phase>('idle');
  const [scaleFactor, setScaleFactor] = useState(1.0);
  const [selectedEngine, setSelectedEngine] = useState<string>(settings.captureEngine || 'auto');

  // Selection box state (logical CSS pixels)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currPos, setCurrPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Recognition & translation result
  const [overlayResult, setOverlayResult] = useState<OverlayResult | null>(null);
  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (settings.captureEngine) {
      setSelectedEngine(settings.captureEngine);
    }
  }, [settings.captureEngine]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Open / close lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setPhase('idle');
      setOverlayResult(null);
      setStartPos(null);
      setCurrPos(null);
      return;
    }

    const init = async () => {
      try {
        if (isTauri()) {
          const payload = await cmdBeginCapture();   // hides main window (0ms image transfer!)
          if (!mountedRef.current) return;
          setScaleFactor(payload.scaleFactor || window.devicePixelRatio || 1.0);
          await cmdShowOverlay();                    // expand translucent window to full screen
        } else {
          setScaleFactor(window.devicePixelRatio || 1.0);
        }
        if (mountedRef.current) setPhase('selecting');
      } catch (err) {
        console.error('[CaptureOverlay] init failed:', err);
        if (mountedRef.current) {
          setPhase('idle');
          onClose();
        }
      }
    };

    init();

    return () => {
      if (isTauri()) cmdCloseOverlay().catch(console.warn);
    };
  }, [isOpen]);

  // ── Keyboard shortcuts handler (Overlay & Selection phase) ─────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      if (phase === 'overlay' && overlayResult && overlayResult.blocks.length > 0) {
        const topBlock = overlayResult.blocks[0];

        // Space: TTS Speech
        if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
          e.preventDefault();
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(topBlock.original);
            u.lang = 'en-US';
            window.speechSynthesis.speak(u);
          }
          return;
        }

        // Tab: Cycle AI model / translation engine
        if (e.key === 'Tab') {
          e.preventDefault();
          const engines = ['auto', 'deepseek', 'openai', 'ollama', 'custom', 'google', 'bing', 'blender'];
          const currIdx = engines.indexOf(selectedEngine);
          const nextEngine = engines[(currIdx + 1) % engines.length];
          setSelectedEngine(nextEngine);
          setCaptureEngine(nextEngine);
          return;
        }

        // Enter or Ctrl+C: Copy translated text to clipboard
        if (e.key === 'Enter' || (e.ctrlKey && e.key.toLowerCase() === 'c')) {
          e.preventDefault();
          const translatedText = overlayResult.blocks.map(b => b.translated).join('\n');
          navigator.clipboard.writeText(translatedText);
          handleClose();
          return;
        }

        // Ctrl+D: Add to favorite / vocabulary
        if (e.ctrlKey && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          saveTranslationHistory(topBlock.original, topBlock.translated, `${topBlock.sourceTier} (⭐已生词本)`).catch(console.warn);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, phase, overlayResult, selectedEngine, setCaptureEngine]);

  // ── Mouse handlers for selection phase ───────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (phase !== 'selecting' && phase !== 'overlay') return;
    if ((e.target as HTMLElement).closest('.overlay-block')) return;

    // Right-click exits immediately
    if (e.button === 2) { handleClose(); return; }

    if (e.button === 0) {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const pos = { x: e.clientX - r.left, y: e.clientY - r.top };
      setStartPos(pos);
      setCurrPos(pos);
      setIsDragging(true);
      if (phase === 'overlay') {
        setOverlayResult(null);
        setPhase('selecting');
      }
      e.preventDefault();
    }
  }, [phase]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !startPos || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    setCurrPos({
      x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
      y: Math.max(0, Math.min(e.clientY - r.top, r.height)),
    });
  }, [isDragging, startPos]);

  const onMouseUp = useCallback(async () => {
    if (!isDragging || !startPos || !currPos) return;
    setIsDragging(false);

    const x = Math.min(startPos.x, currPos.x);
    const y = Math.min(startPos.y, currPos.y);
    const w = Math.abs(startPos.x - currPos.x);
    const h = Math.abs(startPos.y - currPos.y);

    if (w < 12 || h < 12) {
      setStartPos(null);
      setCurrPos(null);
      return;
    }

    const selection = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
    };

    setPhase('processing');

    try {
      // Direct region OCR + sampling + translation (<200ms!)
      const result = await cmdRegionOcrTranslate(
        selection,
        scaleFactor,
        selectedEngine !== 'auto' ? selectedEngine : (settings.defaultPreset || 'blender'),
        settings.llmConfig ?? null,
      );

      if (!mountedRef.current) return;

      if (result.blocks.length === 0) {
        setEmptyNotice('未在选区内识别到清晰文本，请重新划框框选');
        setTimeout(() => setEmptyNotice(null), 2500);
        setPhase('selecting');
        setStartPos(null);
        setCurrPos(null);
        return;
      }

      if (onSendToMainWindow) {
        const combinedText = result.blocks.map(b => b.original).join('\n');
        onSendToMainWindow(combinedText);
      }

      // 将识别并翻译的文本块异步写入历史记录（按原文去重）
      result.blocks.forEach((b) => {
        saveTranslationHistory(b.original, b.translated, b.sourceTier).catch((e) =>
          console.warn('History save failed:', e)
        );
      });

      setOverlayResult(result);
      setPhase('overlay');
    } catch (err) {
      console.error('[CaptureOverlay] Region OCR/translate failed:', err);
      if (mountedRef.current) {
        setPhase('selecting');
        setStartPos(null);
        setCurrPos(null);
      }
    }
  }, [isDragging, startPos, currPos, scaleFactor, settings]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleClose();
  }, []);

  const handleClose = async () => {
    setPhase('idle');
    setOverlayResult(null);
    setStartPos(null);
    setCurrPos(null);
    if (isTauri()) {
      try {
        await cmdCloseOverlay();
      } catch (e) {
        console.warn('cmdCloseOverlay error:', e);
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  const selBox = startPos && currPos ? {
    x: Math.min(startPos.x, currPos.x),
    y: Math.min(startPos.y, currPos.y),
    w: Math.abs(startPos.x - currPos.x),
    h: Math.abs(startPos.y - currPos.y),
  } : null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] overflow-hidden select-none"
      style={{
        cursor: phase === 'processing' ? 'wait' : phase === 'overlay' ? 'default' : 'crosshair',
        background: 'transparent',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
    >
      {/* ── Selection rect layer (transparent background) ─────────────────────── */}
      {(phase === 'selecting' || isDragging) && (
        <div className="absolute inset-0 bg-transparent pointer-events-none">
          {selBox && selBox.w > 4 && (
            <div
              style={{
                position: 'absolute',
                left: selBox.x,
                top: selBox.y,
                width: selBox.w,
                height: selBox.h,
                pointerEvents: 'none',
                zIndex: 105,
              }}
              className="border-2 border-sky-400 bg-sky-500/10 shadow-[0_0_12px_rgba(56,189,248,0.4)] rounded-[2px]"
            >
              <span className="absolute -top-6 left-0 text-[11px] font-mono bg-sky-600/90 text-white px-1.5 py-0.5 rounded shadow">
                {Math.round(selBox.w)} × {Math.round(selBox.h)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Guidance Toast + Interactive AI Model Selector (selecting phase) ────── */}
      {phase === 'selecting' && !selBox && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[115] flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-full px-5 py-2 shadow-2xl text-xs border ${
            isLight
              ? 'bg-white/95 border-slate-300 text-slate-800'
              : 'bg-slate-900/90 border-white/20 text-zinc-100'
          }`}>
            <span>🐱</span>
            <span className="font-bold text-sky-500">猫步划词翻译</span>
            <span className={isLight ? 'text-slate-300' : 'text-zinc-500'}>·</span>
            <span className={`font-medium ${isLight ? 'text-slate-700' : 'text-zinc-200'}`}>按住鼠标左键划框</span>
            <span className={isLight ? 'text-slate-300' : 'text-zinc-500'}>·</span>
            <span className={isLight ? 'text-slate-500' : 'text-zinc-400'}>右键 / Esc 退出</span>
          </div>

          {/* AI Model & Engine Switcher Dropdown Pill */}
          <div className="relative pointer-events-auto">
            <select
              value={selectedEngine}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedEngine(val);
                setCaptureEngine(val);
              }}
              className={`font-mono text-xs font-semibold px-3.5 py-2 rounded-full border shadow-2xl outline-none cursor-pointer transition ${
                isLight
                  ? 'bg-white hover:bg-slate-50 text-slate-900 border-slate-300'
                  : 'bg-slate-900/90 hover:bg-slate-950 text-white border-white/30'
              }`}
              title="切换划词翻译 AI 大模型与通道"
            >
              <optgroup label="── 智能自动降级 ──">
                <option value="auto">🤖 默认多级智能优先级队列 (推荐)</option>
              </optgroup>
              <optgroup label="── 强行指定 AI 大语言模型 ──">
                <option value="deepseek">🧠 DeepSeek (Chat / V3 极速高准确率)</option>
                <option value="openai">🧠 OpenAI (GPT-4o / GPT-4o-mini)</option>
                <option value="ollama">🦙 Local Ollama (本地私有化大模型)</option>
                <option value="custom">⚡ Custom API (自定义 Endpoint & Key)</option>
              </optgroup>
              <optgroup label="── 强行指定免 Key 公共通道 ──">
                <option value="google">🌐 Google 官方翻译 (免 Key 极速)</option>
                <option value="bing">🔷 Bing 必应神经网络翻译</option>
              </optgroup>
              <optgroup label="── 强行指定 3D 离线词库 ──">
                <option value="blender">🧊 Blender CG 专属词库优先</option>
              </optgroup>
            </select>
          </div>
        </div>
      )}

      {/* ── Processing Indicator ────────────────────────────────────────────────── */}
      {phase === 'processing' && (
        <div className="absolute inset-0 flex items-center justify-center z-[120] pointer-events-none">
          <div className={`flex items-center gap-3 border rounded-2xl px-7 py-4 shadow-2xl ${
            isLight
              ? 'bg-white/95 border-blue-400 text-slate-900'
              : 'bg-slate-900/95 border-sky-400/40 text-white'
          }`}>
            <svg className="animate-spin h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-sm font-semibold">🐱 正在提取与翻译…</span>
          </div>
        </div>
      )}

      {/* ── Empty OCR Notice Toast ──────────────────────────────────────────────── */}
      {emptyNotice && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[130] pointer-events-none">
          <div className="flex items-center gap-2 bg-amber-950/90 border border-amber-500/40 rounded-full px-5 py-2 shadow-2xl text-xs font-semibold text-amber-200">
            <span>⚠️</span>
            <span>{emptyNotice}</span>
          </div>
        </div>
      )}

      {/* ── In-place translated text blocks ───────────────────────────────────── */}
      {phase === 'overlay' && overlayResult && overlayResult.blocks.map((block, i) => (
        <OverlayBlockCard key={i} block={block} onClose={handleClose} />
      ))}
    </div>
  );
};

// ── OverlayBlockCard: a single translated text block rendered in-place ─────────
interface OverlayBlockCardProps {
  block: OverlayBlock;
  onClose: () => void;
}

const OverlayBlockCard: React.FC<OverlayBlockCardProps> = ({ block, onClose }) => {
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ mx: 0, my: 0, ox: 0, oy: 0 });
  const [pos, setPos] = useState({ x: block.logicalX, y: block.logicalY });

  const fontSize = Math.max(10, Math.min(block.logicalH * 0.65, (block.logicalW / Math.max(block.translated.length, 1)) * 1.5, 22));

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button === 2) { onClose(); return; }
    if (e.button === 0) {
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

  return (
    <div
      className="overlay-block absolute flex items-center justify-center rounded-[3px]"
      style={{
        left: pos.x - 3,
        top: pos.y - 2,
        width: Math.max(block.logicalW + 6, 36),
        height: Math.max(block.logicalH + 4, 18),
        background: block.bgCss,
        color: block.fgCss,
        fontSize: `${fontSize}px`,
        fontFamily: '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
        fontWeight: 600,
        lineHeight: 1.1,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        zIndex: 200,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        padding: '1px 5px',
      }}
      title={`${block.original} → ${block.translated} [${block.sourceTier}]`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
    >
      {block.translated}
    </div>
  );
};
