/**
 * CaptureOverlay — Ultra-fast invisible selection mask with instant in-place translation overlay.
 *
 * Performance-optimised flow (<200ms end-to-end):
 *  1. Hotkey -> Rust hides main window and expands transparent always-on-top selection window (0ms image transfer delay)
 *  2. User draws selection rect directly over real screen (spotlight mask + crosshair guides + corner brackets)
 *  3. On mouse release: Rust crops the pre-captured desktop BMP at the exact physical rect (<1ms)
 *     — physical scale is derived from BMP÷viewport geometry so mixed-DPI monitors map correctly
 *  4. Feed tiny region BMP to persistent RapidOCR daemon (<80ms) + sample background colors
 *  5. Render in-place translated text blocks directly at exact original screen coordinates
 *  6. Right-click or Esc to dismiss and restore main window (unless pinned)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  cmdBeginCapture,
  cmdShowOverlay,
  cmdCloseOverlay,
  cmdRegionOcrLayout,
  cmdWatchTick,
  cmdCopyRegionImage,
  cmdSaveRegionImage,
  cmdHoverLookup,
  cmdTranslatePhrasesStyled,
  cmdUniversalTranslate,
  cmdSnapRegion,
  cmdSaveCaptureSession,
  cmdOpenPin,
  saveTranslationHistory,
  isTauri,
} from '../../services/tauri';
import { matchesHotkey } from '../../services/hotkeys';
import { speakText } from "../../services/tts";
import { resolveAABBCollisions } from '../../services/overlayLayout';
import { detectSpeechLang } from '../../services/langDetect';
import type { OverlayBlock, OverlayResult, LanguageCode, TranslationResult } from '../../services/types';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { CheatSheetModal } from './CheatSheetModal';
import { OverlayBlockCard } from './OverlayBlockCard';
import { SnippingToolbar, type AnnotationTool } from './SnippingToolbar';
import { memoKey, memoGet, memoPut } from './translationMemo';
import { YoudaoResultPanel } from './YoudaoResultPanel';

export interface AnnotationItem {
  id: string;
  type: AnnotationTool;
  color: string;
  strokeWidth: number;
  points?: { x: number; y: number }[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  text?: string;
  x?: number;
  y?: number;
}

interface CaptureOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSendToMainWindow?: (text: string) => void;
  /** Open directly in frozen-frame hover-lookup mode (global Ctrl+Alt+H). */
  openInHoverMode?: boolean;
}

/** Normalised selection rectangle in logical (overlay CSS) pixels. */
interface SelRect { x: number; y: number; width: number; height: number }

/** One hover-lookup bubble / pinned lookup card. */
interface HoverHit { x: number; y: number; width: number; height: number; text: string; translated: string; tier: string }

type Phase =
  | 'idle'          // not open
  | 'selecting'     // invisible mask open, user drawing selection
  | 'adjusting'     // selection frozen: resize handles / move / arrow-key nudge
  | 'hovering'      // frozen-frame hover lookup: rest the cursor on text
  | 'processing'    // region capture + OCR + translate running
  | 'overlay';      // transparent overlay displaying in-place translated blocks

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

/** 8 resize handles around the adjusting rect: four corners + four edge midpoints. */
const ADJUST_HANDLES: { id: string; style: React.CSSProperties }[] = [
  { id: 'nw', style: { left: -5, top: -5 } },
  { id: 'n', style: { left: '50%', top: -5, marginLeft: -5 } },
  { id: 'ne', style: { right: -5, top: -5 } },
  { id: 'e', style: { right: -5, top: '50%', marginTop: -5 } },
  { id: 'se', style: { right: -5, bottom: -5 } },
  { id: 's', style: { left: '50%', bottom: -5, marginLeft: -5 } },
  { id: 'sw', style: { left: -5, bottom: -5 } },
  { id: 'w', style: { left: -5, top: '50%', marginTop: -5 } },
];

const HANDLE_CURSOR: Record<string, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

/** Hit-test a logical point against a selection rect (inclusive edges). */
const pointInRect = (p: { x: number; y: number }, r: SelRect): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Last processed selection rect (module scope: survives overlay re-opens),
 *  powering the R key "repeat last region" and the region-watch monitor.
 *  Mirrored into localStorage so R keeps working across app restarts. */
let LAST_SELECTION: SelRect | null = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('catwalk_last_selection');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.width === 'number') return parsed;
      }
    }
  } catch { /* corrupted entry — start fresh */ }
  return null;
})();

function rememberLastSelection(rect: SelRect) {
  LAST_SELECTION = { ...rect };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('catwalk_last_selection', JSON.stringify(LAST_SELECTION));
    }
  } catch { /* storage unavailable — in-memory only */ }
}

export { memoKey, memoGet, memoPut, __clearTranslationMemoForTests } from './translationMemo';

/** Region-watch refresh interval default (ms); user-configurable 1000–10000. */
const WATCH_INTERVAL_MS = 3000;

export const CaptureOverlay: React.FC<CaptureOverlayProps> = ({
  isOpen,
  onClose,
  onSendToMainWindow,
  openInHoverMode = false,
}) => {
  const { settings, setCaptureEngine, setOverlayViewMode } = useSettingsStore();

  // 自定义词库指纹(djb2):词库增删改后翻译 memo 缓存整体失效,
  // 与 Rust 侧翻译记忆的 ensure_glossary 守卫语义一致
  const glossaryFp = React.useMemo(() => {
    const items = settings.customDictItems;
    if (!items || items.length === 0) return '';
    let h = 5381;
    for (const it of items) {
      const s = `${it.original}|${it.translated}|`;
      for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return `g${h}`;
  }, [settings.customDictItems]);
  const enableAabb = settings.enableAabbAvoidance ?? true;
  // Region-watch refresh interval (user-configurable, clamped 1000–10000ms)
  const watchIntervalMs = Math.min(10000, Math.max(1000, settings.watchIntervalMs ?? WATCH_INTERVAL_MS));
  const watchIntervalSec = Math.round(watchIntervalMs / 100) / 10;

  const activeTheme = settings.appearance?.theme || 'system';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  const [phase, setPhase] = useState<Phase>('idle');
  const [scaleFactor, setScaleFactor] = useState(() => (typeof window !== 'undefined' ? window.devicePixelRatio || 1.0 : 1.0));
  const [selectedEngine, setSelectedEngine] = useState<string>(settings.captureEngine || 'auto');
  const [targetLang, setTargetLang] = useState<LanguageCode>('zh-CN');

  // 速赢 5: Pin 锁定状态
  const [isPinned, setIsPinned] = useState(false);

  // 速赢 3: 降级提示关闭状态
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Selection box state (logical CSS pixels)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currPos, setCurrPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Adjust mode: released rect stays frozen for resize/move/nudge before
  // recognition (captureReleaseAction='adjust'). adjustHandle tracks which of
  // the 8 handles (or 'move') is being dragged; adjustStart anchors the gesture.
  const [adjustRect, setAdjustRect] = useState<SelRect | null>(null);
  const [adjustHandle, setAdjustHandle] = useState<string | null>(null);
  const adjustStartRef = useRef<{ mx: number; my: number; rect: SelRect } | null>(null);

  // ── 5大标注工具状态 (矩形/箭头/画笔/马赛克/文字) ─────────────────────────
  const [activeTool, setActiveTool] = useState<AnnotationTool>(null);
  const [annotationColor, setAnnotationColor] = useState<string>('#ef4444');
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = useState<number>(3);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [drawingAnnotation, setDrawingAnnotation] = useState<AnnotationItem | null>(null);
  const drawingAnnotationRef = useRef<AnnotationItem | null>(null);

  // ── OCR 提取文本浮窗状态 ────────────────────────────────────────────────
  const [ocrModalText, setOcrModalText] = useState<string | null>(null);

  // ── Shift+drag multi-select: additional rects queued up, Enter processes all.
  const [pendingRects, setPendingRects] = useState<SelRect[]>([]);

  // ── Double-click snap busy indicator.
  const [snapping, setSnapping] = useState(false);

  // ── Cheat sheet modal (?/F1).
  const [cheatOpen, setCheatOpen] = useState(false);
  const cheatOpenRef = useRef(false);

  // ── Robustness: actionable toast (retry stage-1), per-card context menu,
  // cancelable processing (epoch guard), double-Esc force close.
  const [actionToast, setActionToast] = useState<{ message: string; actionLabel: string; onAction: () => void } | null>(null);
  const actionToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processEpochRef = useRef(0);
  // 前台 3D/CG 软件自动识别（每次截图开始时由 Rust 下发，划词期间生效）
  const detectedPresetRef = useRef<{ preset: string; appName: string } | null>(null);
  const lastEscTsRef = useRef(0);
  const [cardMenu, setCardMenu] = useState<{ blockIndex: number; x: number; y: number } | null>(null);
  const [dismissedBlockIndexes, setDismissedBlockIndexes] = useState<number[]>([]);

  // ── Reading experience: source/translation view cycle, per-card zoom,
  // active-card tracking for keyboard actions, real rendered card heights.
  const [cardViewMode, setCardViewMode] = useState<'translated' | 'original' | 'bilingual'>('translated');
  const [globalFontScale, setGlobalFontScale] = useState<number>(1.0);
  const [cardScales, setCardScales] = useState<Record<number, number>>({});
  const [renderedHeights, setRenderedHeights] = useState<Record<number, number>>({});
  const [activeBlockIdx, setActiveBlockIdx] = useState<number | null>(null);

  // ── Hover lookup (frozen-frame word taking): debounced OCR at the cursor.
  const [hoverBubble, setHoverBubble] = useState<HoverHit | null>(null);
  const [pinnedLookups, setPinnedLookups] = useState<HoverHit[]>([]);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEpochRef = useRef(0);
  const hoverBusyRef = useRef(false);

  // Recognition & translation result
  const [overlayResult, setOverlayResult] = useState<OverlayResult | null>(null);
  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  // Progressive stage-2 state: translations streaming into already-rendered cards
  const [translatingProgress, setTranslatingProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Region watch mode: pin the last selection and auto re-OCR + re-translate
  // every few seconds (game HP bars, live chat, streaming logs...). ──────────
  const [watchMode, setWatchMode] = useState(false);
  const watchModeRef = useRef(false);
  const watchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchTickBusyRef = useRef(false);
  const watchQuietFailuresRef = useRef(0);
  const lastWatchTextRef = useRef<string | null>(null);

  // ── Display mode: 'cover' = in-place translated cards over the original text
  // (default) | 'panel' = Youdao-style — keep the original text visible on
  // screen with dashed outlines, and show a result panel (source on top,
  // translation below, toolbar) docked next to the selection. ────────────────
  const [displayMode, setDisplayMode] = useState<'cover' | 'panel'>(
    (settings.overlayViewMode === 'tooltip' || settings.overlayViewMode === 'panel') ? 'panel' : 'cover'
  );
  const displayModeRef = useRef<'cover' | 'panel'>(displayMode);
  const [hoverBlockIndex, setHoverBlockIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  // Dense-text safety: when several OCR lines land close together the in-place
  // translated cards would overlap each other — resolve AABB collisions once per
  // result. `__i` carries the original overlayResult index through the internal
  // sort so per-card actions (context menu / retry) address the right block.
  const displayBlocks = React.useMemo(() => {
    if (!overlayResult || overlayResult.blocks.length === 0) return [] as (OverlayBlock & { __i: number })[];
    const kept = overlayResult.blocks
      .map((block, i) => {
        // Wrapped cards grow taller than the OCR box — the real rendered height
        // (reported via ResizeObserver) participates in collision avoidance via aabbH,
        // leaving the original logicalH intact so font sizing never inflates in a loop.
        const realH = renderedHeights[i];
        const aabbH = realH && realH > block.logicalH ? realH : block.logicalH;
        return { ...block, aabbH, __i: i };
      })
      .filter((b) => !dismissedBlockIndexes.includes(b.__i));
    if (!enableAabb) return kept;
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
    return resolveAABBCollisions(kept, w, h);
  }, [overlayResult, enableAabb, dismissedBlockIndexes, renderedHeights]);

  // 定时器持有引用：连续 showFeedback 时先清旧 timer，
  // 防止新 toast 被上一个 toast 的定时器提前清除
  const feedbackToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (msg: string) => {
    setFeedbackToast(msg);
    if (feedbackToastTimerRef.current) clearTimeout(feedbackToastTimerRef.current);
    feedbackToastTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setFeedbackToast(null);
    }, 2200);
  };

  /** 生效词库：自动识别开启且检测到前台 CG 软件时优先其专业词库，否则用默认词库 */
  const effectivePreset = () =>
    (useSettingsStore.getState().settings.autoDetectPreset !== false && detectedPresetRef.current?.preset) ||
    settings.defaultPreset ||
    'blender';

  /** Clipboard write that awaits and reports failures instead of fire-and-forget. */
  const copyTextSafely = useCallback(async (text: string, okMsg?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showFeedback(okMsg || '📋 已复制到剪贴板');
    } catch {
      showFeedback('⚠️ 复制失败：剪贴板暂不可用');
    }
  }, []);

  /** Toast with an inline action button (e.g. stage-1 retry). Auto-expires in 5s. */
  const showActionToast = useCallback((t: { message: string; actionLabel: string; onAction: () => void }) => {
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
    setActionToast(t);
    actionToastTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setActionToast(null);
    }, 5000);
  }, []);

  const cancelProcessing = useCallback(() => {
    // Invalidate any in-flight recognition result and return to the frozen rect
    processEpochRef.current += 1;
    setPhase((p) => (p === 'processing' ? ((settings.captureReleaseAction ?? 'auto') === 'adjust' && adjustRect ? 'adjusting' : 'selecting') : p));
    if ((settings.captureReleaseAction ?? 'auto') !== 'adjust') {
      setAdjustRect(null);
    }
  }, [adjustRect, settings.captureReleaseAction]);

  /** Hover lookup: OCR the line under the cursor, translate it, show a bubble. */
  const doHoverLookup = useCallback(async (x: number, y: number) => {
    if (hoverBusyRef.current) return;
    hoverBusyRef.current = true;
    const epoch = ++hoverEpochRef.current;
    try {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const line = await cmdHoverLookup(x, y, scaleFactor, vw, vh);
      if (!mountedRef.current || epoch !== hoverEpochRef.current) return;
      if (!line || !line.text || line.text.trim().length < 2) {
        setHoverBubble(null);
        return;
      }
      let translated = '';
      let tier = '';
      try {
        const res = await cmdUniversalTranslate({
          text: line.text,
          sourceLang: 'auto',
          targetLang,
          preset: selectedEngine !== 'auto' ? selectedEngine : effectivePreset(),
          llmConfig: ['deepseek', 'openai', 'ollama', 'glm', 'custom'].some((k) => selectedEngine.toLowerCase().includes(k))
            ? settings.llmConfig
            : null,
          presetDicts: settings.presetDicts,
          onlineEngines: settings.onlineEngines,
          translationTiers: settings.translationTiers,
          baiduAppId: settings.baiduAppId,
          baiduSecret: settings.baiduSecret,
          deeplApiKey: settings.deeplApiKey,
          deeplCustomUrl: settings.deeplCustomUrl,
        });
        translated = res.mainTranslation || '';
        tier = res.engines[0]?.sourceTier || '';
      } catch { /* show the original text only */ }
      if (!mountedRef.current || epoch !== hoverEpochRef.current) return;
      setHoverBubble({
        x: line.x, y: line.y, width: line.width, height: line.height,
        text: line.text, translated, tier,
      });
    } catch {
      // transient OCR failure — the next hover retries
    } finally {
      hoverBusyRef.current = false;
    }
  }, [scaleFactor, targetLang, selectedEngine, settings]);

  useEffect(() => {
    if (settings.captureEngine) {
      setSelectedEngine(settings.captureEngine);
    }
  }, [settings.captureEngine]);

  // 组件实例常驻 App（从不卸载），mountedRef 必须跟随 isOpen 才有意义；
  // 否则所有 await 之后的 mountedRef 守卫恒为 true，overlay 关闭后仍会继续写状态。
  useEffect(() => {
    mountedRef.current = isOpen;
  }, [isOpen]);

  // 卸载兜底清理（生产常驻不触发，测试环境/热重载会卸载）：
  // 防止 toast 定时器在环境销毁后仍 setState
  useEffect(() => {
    return () => {
      if (feedbackToastTimerRef.current) clearTimeout(feedbackToastTimerRef.current);
      if (emptyNoticeTimerRef.current) clearTimeout(emptyNoticeTimerRef.current);
    };
  }, []);

  // ── Open / close lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setPhase('idle');
      setOverlayResult(null);
      setStartPos(null);
      setCurrPos(null);
      setCursorPos(null);
      setIsPinned(false);
      setBannerDismissed(false);
      setFeedbackToast(null);
      setEmptyNotice(null);
      if (feedbackToastTimerRef.current) clearTimeout(feedbackToastTimerRef.current);
      if (emptyNoticeTimerRef.current) clearTimeout(emptyNoticeTimerRef.current);
      if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
      setTranslatingProgress(null);
      setAdjustRect(null);
      setAdjustHandle(null);
      adjustStartRef.current = null;
      setPendingRects([]);
      setSnapping(false);
      setCheatOpen(false);
      cheatOpenRef.current = false;
      setActionToast(null);
      setCardMenu(null);
      setDismissedBlockIndexes([]);
      setHoverBubble(null);
      setPinnedLookups([]);
      setGlobalFontScale(1.0);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      processEpochRef.current += 1;
      stopWatch();
      return;
    }

    const init = async () => {
      try {
        if (isTauri()) {
          const payload = await cmdBeginCapture();   // hides main window (0ms image transfer!)
          if (!mountedRef.current) return;
          setScaleFactor(payload.scaleFactor || window.devicePixelRatio || 1.0);
          const detected = payload.detectedApp ?? null;
          if (detected && useSettingsStore.getState().settings.autoDetectPreset !== false) {
            detectedPresetRef.current = detected;
            showFeedback(`🎯 检测到 ${detected.appName} · 已自动启用其专业词库`);
          } else {
            detectedPresetRef.current = null;
          }
          await cmdShowOverlay();                    // expand translucent window to full screen
        } else {
          setScaleFactor(window.devicePixelRatio || 1.0);
        }
        if (mountedRef.current) {
          setPhase(openInHoverMode ? 'hovering' : 'selecting');
          // One-time discoverability hint for the cheat sheet
          try {
            if (typeof localStorage !== 'undefined' && !localStorage.getItem('catwalk_cheatsheet_hinted')) {
              localStorage.setItem('catwalk_cheatsheet_hinted', '1');
              showFeedback(openInHoverMode
                ? '🖱 悬停取词模式：光标停在文字上即可翻译'
                : '❓ 随时按 ? 或 F1 查看快捷键速查表');
            }
          } catch { /* localStorage unavailable — skip hint */ }
        }
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
  }, [isOpen, openInHoverMode]);

  // ── 智能解析当前选中的 LLM 实例配置 ──────────────────────────────────────────
  const resolveLlmConfig = useCallback(
    (engine: string) => {
      const isLlm =
        engine.startsWith('llm:') ||
        engine === 'llm' ||
        engine === 'ai' ||
        ['deepseek', 'openai', 'ollama', 'glm', 'gemini', 'claude', 'qwen', 'moonshot', 'kimi', 'custom', 'siliconflow', 'groq'].some((k) =>
          engine.toLowerCase().includes(k)
        ) ||
        !!settings.llmConfigs?.some(
          (c) => c.id === engine || `llm:${c.id}` === engine || c.model?.toLowerCase() === engine.toLowerCase()
        );

      if (!isLlm && engine !== 'auto') {
        return null;
      }

      const targetClean = engine.startsWith('llm:') ? engine.slice(4) : engine;
      const matched = settings.llmConfigs?.find(
        (c) =>
          c.id === targetClean ||
          `llm:${c.id}` === engine ||
          c.model?.toLowerCase() === targetClean.toLowerCase() ||
          c.provider?.toLowerCase() === targetClean.toLowerCase() ||
          targetClean.toLowerCase().includes(c.provider?.toLowerCase() || '') ||
          targetClean.toLowerCase().includes(c.model?.toLowerCase() || '')
      );
      return matched || settings.llmConfig || null;
    },
    [settings]
  );

  // ── Re-translate existing blocks when targetLang / engine changes ────────────
  const retranslateBlocks = useCallback(
    async (newTargetLang: LanguageCode, engine: string) => {
      if (!overlayResult || overlayResult.blocks.length === 0) return;
      const total = overlayResult.blocks.length;
      setTranslatingProgress({ done: 0, total });
      try {
        let done = 0;
        const forcedEngine = engine === 'auto' ? undefined : engine;
        const activeLlm = resolveLlmConfig(engine);
        const updatedBlocks = await Promise.all(
          overlayResult.blocks.map(async (block) => {
            const res = await cmdUniversalTranslate({
              text: block.original,
              sourceLang: 'auto',
              targetLang: newTargetLang,
              preset: engine !== 'auto' ? engine : effectivePreset(),
              llmConfig: activeLlm,
              llmConfigs: settings.llmConfigs,
              presetDicts: settings.presetDicts,
              onlineEngines: settings.onlineEngines,
              translationTiers: settings.translationTiers,
              style: settings.translationStyle,
              forcedEngine,
              baiduAppId: settings.baiduAppId,
              baiduSecret: settings.baiduSecret,
              deeplApiKey: settings.deeplApiKey,
              deeplCustomUrl: settings.deeplCustomUrl,
            });
            done += 1;
            if (mountedRef.current) setTranslatingProgress({ done, total });
            return {
              ...block,
              translated: res.mainTranslation || block.translated,
              sourceTier: res.engines[0]?.sourceTier || block.sourceTier,
              translationFailed: !res.mainTranslation,
            };
          })
        );
        setOverlayResult((prev) => (prev ? { ...prev, blocks: updatedBlocks } : null));
        showFeedback(`已切换至 ${engine === 'auto' ? '智能回退' : engine} 重新翻译全部卡片`);
      } catch (err) {
        console.warn('[CaptureOverlay] Retranslate error:', err);
        showFeedback('⚠️ 重译失败，可按 Tab 切换引擎后重试');
      } finally {
        if (mountedRef.current) setTranslatingProgress(null);
      }
    },
    [overlayResult, settings]
  );

  const handleLanguageChange = (lang: LanguageCode) => {
    setTargetLang(lang);
    if (phase === 'overlay' && overlayResult) {
      retranslateBlocks(lang, selectedEngine);
    }
  };

  const handleEngineChange = (engine: string) => {
    setSelectedEngine(engine);
    setCaptureEngine(engine);
    if (phase === 'overlay' && overlayResult) {
      retranslateBlocks(targetLang, engine);
    }
  };

  const handleCloseRef = useRef<(force?: boolean) => void | Promise<void>>(() => {});
  // Late-bound refs so the keydown effect (declared earlier) can call the
  // region pipeline / watch controls defined below it.
  const processSelectionRef = useRef<(sel: SelRect) => void | Promise<void>>(() => {});
  const processPendingRef = useRef<(override?: SelRect[]) => void | Promise<void>>(() => {});
  const toggleWatchRef = useRef<() => void>(() => {});
  const stopWatchRef = useRef<() => void>(() => {});
  const toggleDisplayModeRef = useRef<() => void>(() => {});

  // ── Keyboard shortcuts handler (Overlay & Selection phase) ─────────────────
  // CaptureOverlay owns F4 / Esc / capture-hotkey while it is open, so the
  // App-level fallback listener stays out of the way (single handling, pin-aware).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // The cheat sheet modal owns every key while open (its own listener
      // closes itself on Esc / ? / F1) — don't double-handle or close overlay.
      if (cheatOpenRef.current) return;

      // ? or F1: toggle the shortcut cheat sheet
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        e.stopPropagation();
        cheatOpenRef.current = true;
        setCheatOpen(true);
        return;
      }

      // H: toggle frozen-frame hover lookup (划框 ↔ 悬停取词)
      if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (phase === 'hovering') {
          setHoverBubble(null);
          setPhase('selecting');
          showFeedback('📐 已切回划框模式');
        } else {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          // Invalidate any in-flight recognition so a late result can't yank
          // the UI out of hover mode.
          processEpochRef.current += 1;
          setHoverBubble(null);
          setAdjustRect(null);
          setPendingRects([]);
          stopWatchRef.current();
          setPhase('hovering');
          showFeedback('🖱 悬停取词：光标停在文字上即可翻译 (H 切回)');
        }
        return;
      }

      // F4 or the configured capture hotkey: pin-aware quick close
      if (e.key === 'F4' || matchesHotkey(e, settings.hotkey || 'F4')) {
        e.preventDefault();
        e.stopPropagation();
        if (!isPinned) {
          handleCloseRef.current();
        } else {
          showFeedback('📌 当前处于锁定状态，请先解除锁定 (Ctrl+P)');
        }
        return;
      }

      // 速赢 5: Ctrl+P 切换锁定
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsPinned((prev) => {
          const next = !prev;
          showFeedback(next ? '📌 已固定卡片 (防误触退出)' : '🔓 已解除固定');
          return next;
        });
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        // Adjust mode: the first Esc only discards the frozen rect
        if (phase === 'adjusting') {
          setAdjustRect(null);
          setAdjustHandle(null);
          adjustStartRef.current = null;
          setPhase('selecting');
          showFeedback('↩️ 已取消选区，可重新划框');
          return;
        }
        if (isPinned) {
          // Locked: pressing Esc twice within 800ms force-closes even when pinned
          const now = Date.now();
          if (now - lastEscTsRef.current <= 800) {
            lastEscTsRef.current = 0;
            showFeedback('🔓 连按两次 Esc，已强制退出');
            stopWatchRef.current();
            handleCloseRef.current(true);
          } else {
            lastEscTsRef.current = now;
            showFeedback('📌 已锁定 — 再按一次 Esc 强制退出，或 Ctrl+P 解锁');
          }
          return;
        }
        stopWatchRef.current();
        handleCloseRef.current();
        return;
      }

      // ── 调整模式：Enter 确认识别 / 方向键微调 (Shift = 10px) ────────────────
      if (phase === 'adjusting' && adjustRect) {
        if (e.key === 'Enter') {
          e.preventDefault();
          processSelectionRef.current({ ...adjustRect });
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
          setAdjustRect((r) => (r ? {
            ...r,
            x: Math.max(0, Math.min(r.x + dx, vw - r.width)),
            y: Math.max(0, Math.min(r.y + dy, vh - r.height)),
          } : r));
          return;
        }
      }

      // ── 选区阶段快捷键 ──────────────────────────────────────────────────────
      if (phase === 'selecting') {
        // Enter: process Shift-accumulated multi selections, else full screen
        if (e.key === 'Enter') {
          e.preventDefault();
          if (pendingRects.length > 0) {
            processPendingRef.current();
            return;
          }
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
          showFeedback('🖥 已选定全屏区域');
          processSelectionRef.current({ x: 0, y: 0, width: vw, height: vh });
          return;
        }
      }

      // R: 重划上一次选区（选区/结果阶段均可用，跨会话记忆）
      if ((phase === 'selecting' || phase === 'overlay') && e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (LAST_SELECTION) {
          showFeedback('🔁 重划上次选区');
          setAdjustRect(null);
          setPendingRects([]);
          processSelectionRef.current({ ...LAST_SELECTION });
        } else {
          showFeedback('暂无历史选区，请先划框或双击吸附');
        }
        return;
      }

      // ── Digit 1~7: 快速切换目标语种（与顶部语种胶囊一一对应） ────────────────
      {
        const digit = /^Digit([1-7])$/.test(e.code)
          ? Number(e.code.slice(5))
          : /^[1-7]$/.test(e.key) ? Number(e.key) : null;
        if (digit !== null && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          const opt = TARGET_LANG_OPTIONS[digit - 1];
          if (opt) {
            handleLanguageChange(opt.code);
            showFeedback(`🌐 已切换目标语种：${opt.code} (${digit})`);
          }
          return;
        }
      }

      // W: 区域监控模式开关（须在 overlay 阶段）
      if (phase === 'overlay' && e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleWatchRef.current();
        return;
      }

      // M: 切换原位覆盖 / 有道式结果面板
      if (phase === 'overlay' && e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleDisplayModeRef.current();
        return;
      }

      if (phase === 'overlay' && overlayResult && overlayResult.blocks.length > 0) {
        // Keyboard actions target the hovered/active card (↑↓ to move), falling
        // back to the first block — no longer hardcoded to blocks[0].
        const activeIdx = activeBlockIdx !== null && overlayResult.blocks[activeBlockIdx]
          ? activeBlockIdx
          : 0;
        const targetBlock = overlayResult.blocks[activeIdx];

        // O: cycle 译文 → 原文 → 双语对照
        if (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          setCardViewMode((m) => (m === 'translated' ? 'original' : m === 'original' ? 'bilingual' : 'translated'));
          return;
        }

        // ↑/↓: move the active card (keyboard focus for Space / Ctrl+D)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const maxIdx = overlayResult.blocks.length - 1;
          setActiveBlockIdx((prev) => {
            const cur = prev !== null && prev <= maxIdx ? prev : 0;
            const next = e.key === 'ArrowDown' ? Math.min(cur + 1, maxIdx) : Math.max(cur - 1, 0);
            return next;
          });
          return;
        }

        // Space: TTS Speech (language auto-detected from the source characters)
        if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
          e.preventDefault();
          speakText(targetBlock.original, { lang: detectSpeechLang(targetBlock.original) });
          showFeedback(`🔊 正在朗读第 ${activeIdx + 1} 段原文...`);
          return;
        }

        // Tab / Shift+Tab: cycle AI model / translation engine both ways
        if (e.key === 'Tab') {
          e.preventDefault();
          const engines = ['auto', 'deepseek', 'openai', 'ollama', 'custom', 'google', 'bing', 'blender'];
          const currIdx = engines.indexOf(selectedEngine);
          const dir = e.shiftKey ? -1 : 1;
          const nextEngine = engines[(currIdx + dir + engines.length) % engines.length];
          handleEngineChange(nextEngine);
          return;
        }

        // Enter or Ctrl+C: copy all translations — the overlay stays open so the
        // user can keep reading/switching; close explicitly with Esc when done.
        if (e.key === 'Enter' || (e.ctrlKey && e.key.toLowerCase() === 'c')) {
          e.preventDefault();
          const translatedText = overlayResult.blocks.map((b) => b.translated).join('\n');
          void copyTextSafely(translatedText, '📋 全部译文已复制（Esc 关闭）');
          return;
        }

        // Ctrl+D: Add the ACTIVE card to favorite / vocabulary
        if (e.ctrlKey && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          saveTranslationHistory(targetBlock.original, targetBlock.translated, `${targetBlock.sourceTier} (⭐已生词本)`).catch(console.warn);
          showFeedback(`⭐ 已收藏第 ${activeIdx + 1} 段至生词本 (Ctrl+D)`);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  // settings 整体入依赖：handler 内的引擎/词典/在线开关都来自 settings，
  // 之前只登记 settings.hotkey 会导致按 1-7 切语种时用旧配置重译
  }, [isOpen, phase, overlayResult, selectedEngine, isPinned, targetLang, settings, adjustRect, pendingRects, activeBlockIdx]);

  // ── Mouse handlers for selection phase ───────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (phase === 'hovering') {
      // Hover mode: bubbles/pinned cards handle their own clicks; right-click exits
      if (e.button === 2 && !isPinned) {
        handleCloseRef.current();
      }
      return;
    }
    if (phase !== 'selecting' && phase !== 'adjusting' && phase !== 'overlay') return;
    // Clicking anywhere outside the card context menu closes it
    if (!(e.target as HTMLElement).closest('.overlay-card-menu')) {
      setCardMenu(null);
    }
    if ((e.target as HTMLElement).closest('.overlay-toolbar')) return;
    if ((e.target as HTMLElement).closest('.snipping-toolbar-container')) return;
    if (!activeTool && (e.target as HTMLElement).closest('.overlay-block')) return;
    if (!activeTool && (e.target as HTMLElement).closest('.overlay-panel')) return;

    // Right-click exits immediately (if not pinned)
    if (e.button === 2) {
      if (!isPinned) {
        handleCloseRef.current();
      } else {
        showFeedback('📌 当前处于固定状态，点击图钉或按 Ctrl+P 解锁');
      }
      return;
    }

    if (e.button === 0) {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const pos = { x: e.clientX - r.left, y: e.clientY - r.top };

      const effectiveRect = adjustRect || (overlayResult ? {
        x: overlayResult.selectionX,
        y: overlayResult.selectionY,
        width: overlayResult.selectionW,
        height: overlayResult.selectionH,
      } : null);

      // 标注模式：若激活了标注工具且在调整选区阶段或翻译结果阶段，开始绘制标注
      if ((phase === 'adjusting' || phase === 'overlay') && effectiveRect && activeTool) {
        e.preventDefault();
        if (activeTool === 'pen') {
          const ann: AnnotationItem = {
            id: 'ann_' + Date.now(),
            type: 'pen',
            color: annotationColor,
            strokeWidth: annotationStrokeWidth,
            points: [pos],
          };
          drawingAnnotationRef.current = ann;
          setDrawingAnnotation(ann);
          return;
        }
        if (activeTool === 'rect' || activeTool === 'arrow' || activeTool === 'mosaic') {
          const ann: AnnotationItem = {
            id: 'ann_' + Date.now(),
            type: activeTool,
            color: annotationColor,
            strokeWidth: annotationStrokeWidth,
            start: pos,
            end: pos,
          };
          drawingAnnotationRef.current = ann;
          setDrawingAnnotation(ann);
          return;
        }
        if (activeTool === 'text') {
          const userText = window.prompt('请输入标注文字：');
          if (userText && userText.trim()) {
            setAnnotations((prev) => [
              ...prev,
              {
                id: 'ann_' + Date.now(),
                type: 'text',
                color: annotationColor,
                strokeWidth: annotationStrokeWidth,
                text: userText.trim(),
                x: pos.x,
                y: pos.y,
              },
            ]);
          }
          return;
        }
      }

      // Adjust mode: grab a resize handle, or move the frozen rect from inside
      const handleEl = (e.target as HTMLElement).closest('[data-handle]');
      const handleId = handleEl ? handleEl.getAttribute('data-handle') : null;
      if (phase === 'adjusting' && adjustRect && (handleId || pointInRect(pos, adjustRect))) {
        e.preventDefault();
        setAdjustHandle(handleId || 'move');
        adjustStartRef.current = { mx: e.clientX, my: e.clientY, rect: { ...adjustRect } };
        return;
      }

      // A fresh drag discards the frozen rect; Shift keeps the multi-select queue
      // so shift-dragging can keep stacking regions.
      if (!e.shiftKey) {
        setAdjustRect(null);
        setPendingRects([]);
      }
      setStartPos(pos);
      setCurrPos(pos);
      setIsDragging(true);
      if (phase === 'overlay') {
        // Blank click no longer wipes results (misclick used to destroy them).
        // Dragging still starts a fresh selection; a bare click just hints.
        showFeedback('💡 按 R 重划上次选区 · Esc 退出');
      } else if (phase === 'adjusting') {
        setPhase('selecting');
      }
      e.preventDefault();
    }
  }, [phase, isPinned, adjustRect, overlayResult, activeTool, annotationColor, annotationStrokeWidth]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height));

    setCursorPos({ x, y });

    // 绘制标注中
    if (drawingAnnotationRef.current) {
      const cur = drawingAnnotationRef.current;
      if (cur.type === 'pen') {
        const next = { ...cur, points: [...(cur.points || []), { x, y }] };
        drawingAnnotationRef.current = next;
        setDrawingAnnotation(next);
        return;
      }
      if (
        cur.type === 'rect' ||
        cur.type === 'arrow' ||
        cur.type === 'mosaic'
      ) {
        const next = { ...cur, end: { x, y } };
        drawingAnnotationRef.current = next;
        setDrawingAnnotation(next);
        return;
      }
    }

    if (isDragging && startPos) {
      setCurrPos({ x, y });
    }

    // Hover mode: debounce a lookup at the resting cursor position
    if (phase === 'hovering') {
      setHoverBubble(null);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      const cx = x;
      const cy = y;
      hoverTimerRef.current = setTimeout(() => {
        void doHoverLookup(cx, cy);
      }, 180);
    }

    // Adjust gesture: resize via one of the 8 handles or move the whole rect
    if (adjustHandle && adjustStartRef.current) {
      const { mx, my, rect } = adjustStartRef.current;
      const dx = e.clientX - mx;
      const dy = e.clientY - my;
      const minS = 12;
      const maxX = r.width;
      const maxY = r.height;

      if (adjustHandle === 'move') {
        setAdjustRect({
          x: Math.round(Math.max(0, Math.min(rect.x + dx, maxX - rect.width))),
          y: Math.round(Math.max(0, Math.min(rect.y + dy, maxY - rect.height))),
          width: rect.width,
          height: rect.height,
        });
      } else {
        let nx = rect.x;
        let ny = rect.y;
        let w = rect.width;
        let h = rect.height;
        if (adjustHandle.includes('w')) {
          const edge = Math.max(0, Math.min(rect.x + dx, rect.x + rect.width - minS));
          w = rect.width + (rect.x - edge);
          nx = edge;
        }
        if (adjustHandle.includes('e')) {
          w = Math.max(minS, Math.min(rect.width + dx, maxX - rect.x));
        }
        if (adjustHandle.includes('n')) {
          const edge = Math.max(0, Math.min(rect.y + dy, rect.y + rect.height - minS));
          h = rect.height + (rect.y - edge);
          ny = edge;
        }
        if (adjustHandle.includes('s')) {
          h = Math.max(minS, Math.min(rect.height + dy, maxY - rect.y));
        }
        setAdjustRect({ x: Math.round(nx), y: Math.round(ny), width: Math.round(w), height: Math.round(h) });
      }
    }
  }, [isDragging, startPos, adjustHandle, phase, doHoverLookup]);

  // ── Shared region pipeline: used by mouse-drag selection, double-click snap,
  // Enter fullscreen, R repeat, and the region-watch monitor loop ──────────────
  const applyLayoutAndTranslate = useCallback(async (
    layout: import('../../services/types').OverlayResult,
    isWatch: boolean = false
  ) => {
    // 与 processSelection / processPendingRects / runWatchTick 共用 epoch：
    // 新选区开始、取消或 overlay 关闭都会 bump epoch，使旧 stage-2 的所有
    // 后续写入作废，防止旧译文按 index 错位覆盖新选区的卡片。
    const epoch = processEpochRef.current;
    const stale = () => !mountedRef.current || epoch !== processEpochRef.current;

    if (layout.blocks.length === 0) {
      if (!isWatch) {
        setEmptyNotice('未在选区内识别到清晰文本，请重新划框框选');
        if (emptyNoticeTimerRef.current) clearTimeout(emptyNoticeTimerRef.current);
        emptyNoticeTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setEmptyNotice(null);
        }, 2500);
        setPhase('selecting');
        setStartPos(null);
        setCurrPos(null);
      }
      return;
    }

    if (onSendToMainWindow && !isWatch) {
      const combinedText = layout.blocks.map((b) => b.original).join('\n');
      onSendToMainWindow(combinedText);
    }

    // Cards visible NOW with original text + shimmer placeholders
    setOverlayResult(layout);
    setPhase('overlay');
    setStartPos(null);
    setCurrPos(null);
    setDismissedBlockIndexes([]);
    // Per-index card state (zoom / measured heights / active) belongs to the
    // PREVIOUS result — stale values would mis-apply to new blocks at the
    // same index (wrong zoom, inflated collision heights).
    setCardScales({});
    setRenderedHeights({});
    setActiveBlockIdx(null);
    setTranslatingProgress({ done: 0, total: layout.blocks.length });

    // ── Stage 2 (background): batched translation via the Rust pipeline
    // (dict cache → batched LLM → parallel online fallback), then swap each
    // card's text in place as soon as results arrive.
    const phrases = layout.blocks.map((b) => b.original);
    const preset = selectedEngine !== 'auto' ? selectedEngine : effectivePreset();
    const llmConfig = resolveLlmConfig(selectedEngine);
    const style = settings.translationStyle;

    try {
      // Memo partition: unchanged phrases (typical for region-watch ticks) come
      // back instantly; only misses hit the batched Rust pipeline.
      const memoHits = new Map<number, TranslationResult>();
      const misses: number[] = [];
      phrases.forEach((p, i) => {
        const hit = memoGet(memoKey(p, targetLang, preset, style, glossaryFp));
        if (hit) memoHits.set(i, hit);
        else misses.push(i);
      });

      let translations: TranslationResult[];
      if (misses.length === 0) {
        translations = phrases.map((_, i) => memoHits.get(i)!);
      } else {
        const fetched = await cmdTranslatePhrasesStyled(
          misses.map((i) => phrases[i]),
          preset,
          llmConfig,
          style,
        );
        if (stale()) return;
        const byIdx = new Map<number, TranslationResult>();
        misses.forEach((pi, k) => {
          const tr = fetched[k];
          if (tr) {
            byIdx.set(pi, tr);
            if (tr.translated && tr.translated.trim()) {
              memoPut(memoKey(phrases[pi], targetLang, preset, style, glossaryFp), tr);
            }
          }
        });
        translations = phrases.map(
          (_, i) => byIdx.get(i) ?? memoHits.get(i) ?? { original: phrases[i], translated: '', sourceTier: 'OCR' },
        );
      }

      let translatedCount = 0;
      const updatedBlocks = layout.blocks.map((block, i) => {
        const tr = translations[i];
        if (tr && tr.translated && tr.translated.trim()) {
          translatedCount += 1;
          return { ...block, translated: tr.translated, sourceTier: tr.sourceTier, translationFailed: false };
        }
        return { ...block, translated: block.original, sourceTier: tr?.sourceTier || block.sourceTier, translationFailed: true };
      });
      if (stale()) return;
      setOverlayResult((prev) => (prev ? { ...prev, blocks: updatedBlocks } : prev));
      setTranslatingProgress({ done: translatedCount, total: layout.blocks.length });

      // Non-Chinese target or selected specific engine: progressively re-translate each card in place
      if ((targetLang !== 'zh-CN' || (selectedEngine && selectedEngine !== 'auto')) && translations.length > 0) {
        let done = 0;
        await Promise.all(
          updatedBlocks.map(async (block, i) => {
            try {
              const forcedEngine = selectedEngine === 'auto' ? undefined : selectedEngine;
              const res = await cmdUniversalTranslate({
                text: block.original,
                sourceLang: 'auto',
                targetLang: targetLang,
                preset,
                llmConfig,
                llmConfigs: settings.llmConfigs,
                presetDicts: settings.presetDicts,
                onlineEngines: settings.onlineEngines,
                translationTiers: settings.translationTiers,
                style,
                forcedEngine,
                baiduAppId: settings.baiduAppId,
                baiduSecret: settings.baiduSecret,
                deeplApiKey: settings.deeplApiKey,
                deeplCustomUrl: settings.deeplCustomUrl,
              });
              if (res.mainTranslation) {
                const newBlock = {
                  ...block,
                  translated: res.mainTranslation,
                  sourceTier: res.engines[0]?.sourceTier || block.sourceTier,
                };
                if (!stale()) {
                  setOverlayResult((prev) =>
                    prev
                      ? { ...prev, blocks: prev.blocks.map((b, j) => (j === i ? newBlock : b)) }
                      : prev
                  );
                  done += 1;
                  setTranslatingProgress({ done, total: updatedBlocks.length });
                }
              }
            } catch {
              // keep the zh-CN translation for this card
            }
          })
        );
      }

      // 将识别并翻译的文本块异步写入历史记录（按原文去重）
      updatedBlocks.forEach((b) => {
        saveTranslationHistory(b.original, b.translated, b.sourceTier).catch((e) =>
          console.warn('History save failed:', e)
        );
      });

      // 保存整场划词会话，供主窗口「划词回放」重看与导出（监控 tick 不重复存档）
      if (!isWatch) {
        cmdSaveCaptureSession({
          id: `sess_${Date.now()}`,
          timestamp: new Date().toLocaleString(),
          targetLang,
          engine: selectedEngine,
          blocks: updatedBlocks,
        }).catch((e) => console.warn('Capture session save failed:', e));
      }
    } catch (err) {
      console.warn('[CaptureOverlay] Stage-2 translation failed, keeping OCR text:', err);
      if (!stale() && !isWatch) {
        // Mark every card as failed so each shows its own inline retry button
        setOverlayResult((prev) => prev
          ? { ...prev, blocks: prev.blocks.map((b) => ({ ...b, translated: b.original, translationFailed: true })) }
          : prev);
        showFeedback('⚠️ 翻译通道暂不可用，卡片上可单块重试');
      }
    } finally {
      if (!stale()) setTranslatingProgress(null);
    }
  }, [selectedEngine, settings, targetLang, onSendToMainWindow]);

  /** Per-card retry for a stage-2 translation failure (single block, single call). */
  const retryBlockTranslation = useCallback(async (blockIndex: number) => {
    if (!overlayResult) return;
    const block = overlayResult.blocks[blockIndex];
    if (!block) return;
    const preset = selectedEngine !== 'auto' ? selectedEngine : effectivePreset();
    const llmConfig = resolveLlmConfig(selectedEngine);
    try {
      const [tr] = await cmdTranslatePhrasesStyled([block.original], preset, llmConfig, settings.translationStyle);
      if (!mountedRef.current) return;
      if (tr && tr.translated && tr.translated.trim()) {
        setOverlayResult((prev) => prev ? {
          ...prev,
          blocks: prev.blocks.map((b, j) => (j === blockIndex
            ? { ...b, translated: tr.translated, sourceTier: tr.sourceTier, translationFailed: false }
            : b)),
        } : prev);
        showFeedback('✅ 该卡片重试成功');
      } else {
        showFeedback('⚠️ 仍失败 — 可按 Tab 换引擎后再试');
      }
    } catch {
      if (mountedRef.current) showFeedback('⚠️ 重试失败：翻译通道不可用');
    }
  }, [overlayResult, selectedEngine, settings]);

  /** 把整场译文渲染为分享卡片 PNG 保存到图片库 */
  const exportOverlayImage = async () => {
    if (!overlayResult || overlayResult.blocks.length === 0) return;
    showFeedback('🖼 正在生成分享图片…');
    try {
      const { exportTranslationImage } = await import('../../services/exportImage');
      const path = await exportTranslationImage({
        title: '划词译文',
        lines: overlayResult.blocks.slice(0, 12).map((b) => ({
          original: b.original.slice(0, 200),
          translated: (b.translated || b.original).slice(0, 200),
        })),
      });
      showFeedback(`✅ 已导出到 ${path.slice(-40)}`);
    } catch (e) {
      showFeedback(`⚠️ 导出失败：${String(e).slice(0, 40)}`);
    }
  };

  /** 把译文块钉成桌面贴图（独立置顶小窗，overlay 关闭后仍常驻） */
  const pinOverlayBlocks = (
    pinBlocks: { original: string; translated: string; sourceTier: string }[],
    title: string,
    originX: number,
    originY: number,
  ) => {
    if (pinBlocks.length === 0) return;
    const id = `pin_${Date.now()}`;
    const height = Math.min(680, 104 + pinBlocks.length * 74);
    cmdOpenPin({
      id,
      title,
      blocks: pinBlocks,
      x: Math.max(8, (typeof window !== 'undefined' ? window.screenX : 0) + originX),
      y: Math.max(8, (typeof window !== 'undefined' ? window.screenY : 0) + originY),
      width: 380,
      height,
    })
      .then(() => showFeedback('📌 已贴图到桌面（可拖拽 / 滚轮缩放）'))
      .catch((e) => showFeedback(`⚠️ 贴图失败：${String(e).slice(0, 40)}`));
  };

  /** Copy the whole selection region image (clean desktop BMP) to the clipboard. */
  const copyRegionImage = useCallback(async (rect: SelRect) => {
    try {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const ok = await cmdCopyRegionImage(rect, scaleFactor, vw, vh);
      showFeedback(ok ? '📷 选区图片已复制到剪贴板' : '⚠️ 图片复制失败');
    } catch (err) {
      showFeedback(`⚠️ 图片复制失败：${err instanceof Error ? err.message.slice(0, 40) : String(err)}`);
    }
  }, [scaleFactor]);

  /** Save the selection region image as PNG under Pictures/猫步翻译/. */
  const saveRegionImage = useCallback(async (rect: SelRect) => {
    try {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const path = await cmdSaveRegionImage(rect, scaleFactor, vw, vh);
      showFeedback(`💾 已保存：…${path.slice(-46)}`);
    } catch (err) {
      showFeedback(`⚠️ 图片保存失败：${err instanceof Error ? err.message.slice(0, 40) : String(err)}`);
    }
  }, [scaleFactor]);

  /** Stable callback: real card heights join the AABB collision layout. */
  const handleRenderedHeight = useCallback((blockIndex: number, height: number) => {
    setRenderedHeights((prev) => {
      const cur = prev[blockIndex];
      if (cur !== undefined && Math.abs(cur - height) <= 2) return prev;
      return { ...prev, [blockIndex]: height };
    });
  }, []);

  const cycleCardView = useCallback(() => {
    setCardViewMode((m) => (m === 'translated' ? 'original' : m === 'original' ? 'bilingual' : 'translated'));
  }, []);

  const handleZoomIn = useCallback(() => {
    setGlobalFontScale((prev) => Math.min(2.0, Math.max(0.6, +(prev + 0.1).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setGlobalFontScale((prev) => Math.min(2.0, Math.max(0.6, +(prev - 0.1).toFixed(2))));
  }, []);

  const handleSpeechActive = useCallback(() => {
    if (!overlayResult || overlayResult.blocks.length === 0) return;
    const activeIdx = activeBlockIdx !== null && activeBlockIdx < overlayResult.blocks.length ? activeBlockIdx : 0;
    const targetBlock = overlayResult.blocks[activeIdx];
    if (!targetBlock) return;
    speakText(targetBlock.original, { lang: detectSpeechLang(targetBlock.original) });
    showFeedback(`🔊 正在朗读第 ${activeIdx + 1} 段原文...`);
  }, [overlayResult, activeBlockIdx]);

  const processSelection = useCallback(async (selection: { x: number; y: number; width: number; height: number }) => {
    // 记忆本次选区，供 R 键快速重划、监控模式复用与跨重启持久化
    rememberLastSelection(selection);
    // Cancel guard: bumping the epoch invalidates any in-flight recognition
    const epoch = ++processEpochRef.current;

    setAdjustRect(selection);
    setPhase('processing');
    setBannerDismissed(false);
    setCardMenu(null);

    try {
      // ── Stage 1 (fast, ~100-300ms): OCR + layout + background colors only.
      // Cards render immediately with the ORIGINAL text — the user sees the
      // capture landed exactly where they drew it, no dead spinner time.
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : undefined;
      const viewportH = typeof window !== 'undefined' ? window.innerHeight : undefined;
      const layout = await cmdRegionOcrLayout(
        selection,
        scaleFactor,
        viewportW,
        viewportH,
      );

      if (!mountedRef.current) return;
      if (epoch !== processEpochRef.current) return; // cancelled while awaiting

      await applyLayoutAndTranslate(layout);
    } catch (err) {
      if (typeof window === 'undefined' || !mountedRef.current || epoch !== processEpochRef.current) return;
      console.error('[CaptureOverlay] Region OCR failed:', err);
      setPhase((settings.captureReleaseAction ?? 'auto') === 'adjust' && adjustRect ? 'adjusting' : 'selecting');
      setStartPos(null);
      setCurrPos(null);
      if ((settings.captureReleaseAction ?? 'auto') !== 'adjust') {
        setAdjustRect(null);
      }
      const msg = err instanceof Error ? err.message : String(err);
      showActionToast({
        message: `⚠️ 识别失败：${msg.slice(0, 60)}`,
        actionLabel: '重试',
        onAction: () => {
          setActionToast(null);
          void processSelectionRef.current(selection);
        },
      });
    }
  }, [scaleFactor, applyLayoutAndTranslate, adjustRect, settings.captureReleaseAction]);

  // ── Shift multi-select: OCR every queued rect, merge into a single overlay ──
  const processPendingRects = useCallback(async (override?: SelRect[]) => {
    const rects = override ?? pendingRects;
    if (rects.length === 0) return;
    setPendingRects([]);
    setAdjustRect(null);

    setPhase('processing');
    setBannerDismissed(false);
    const epoch = ++processEpochRef.current;

    try {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const layouts = await Promise.all(
        rects.map((sel) => cmdRegionOcrLayout(sel, scaleFactor, vw, vh)),
      );
      if (!mountedRef.current || epoch !== processEpochRef.current) return;

      const blocks = layouts.flatMap((l) => l.blocks);
      const unionX = Math.min(...rects.map((s) => s.x));
      const unionY = Math.min(...rects.map((s) => s.y));
      const unionR = Math.max(...rects.map((s) => s.x + s.width));
      const unionB = Math.max(...rects.map((s) => s.y + s.height));
      const union = { x: unionX, y: unionY, width: unionR - unionX, height: unionB - unionY };
      rememberLastSelection(union);

      if (blocks.length === 0) {
        setEmptyNotice('多个选区内均未识别到清晰文本，请重新划框');
        if (emptyNoticeTimerRef.current) clearTimeout(emptyNoticeTimerRef.current);
        emptyNoticeTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setEmptyNotice(null);
        }, 2500);
        setPhase('selecting');
        return;
      }

      const merged: OverlayResult = {
        blocks,
        selectionX: union.x,
        selectionY: union.y,
        selectionW: union.width,
        selectionH: union.height,
      };
      await applyLayoutAndTranslate(merged);
    } catch (err) {
      if (!mountedRef.current || epoch !== processEpochRef.current) return;
      console.error('[CaptureOverlay] Multi-region OCR failed:', err);
      setPhase('selecting');
      setStartPos(null);
      setCurrPos(null);
      const msg = err instanceof Error ? err.message : String(err);
      showActionToast({
        message: `⚠️ 多选区识别失败：${msg.slice(0, 50)}`,
        actionLabel: '重试',
        onAction: () => {
          setActionToast(null);
          void processPendingRects(rects);
        },
      });
    }
  }, [pendingRects, scaleFactor, applyLayoutAndTranslate]);

  // ── Region watch: refresh the pinned region on an interval ─────────────────
  const stopWatch = useCallback(() => {
    watchModeRef.current = false;
    setWatchMode(false);
    if (watchTimerRef.current) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
    lastWatchTextRef.current = null;
    watchQuietFailuresRef.current = 0;
  }, []);

  const runWatchTick = useCallback(async () => {
    if (!watchModeRef.current || watchTickBusyRef.current) return;
    if (!LAST_SELECTION) return;
    watchTickBusyRef.current = true;
    // 与手动划词共用 epoch：新的一次 tick 使上一次在途结果作废，
    // 反之用户手动划新区域时，本次 tick 的结果也不再写入。
    const epoch = ++processEpochRef.current;
    try {
      const vw = typeof window !== 'undefined' ? window.innerWidth : undefined;
      const vh = typeof window !== 'undefined' ? window.innerHeight : undefined;
      let layout: OverlayResult;
      if (isTauri()) {
        try {
          // Quiet path: Rust refreshes only the watched rect in place — the
          // overlay window never hides, so there is zero on-screen flicker.
          layout = await cmdWatchTick(LAST_SELECTION, scaleFactor, vw, vh);
          watchQuietFailuresRef.current = 0;
        } catch {
          // Fallback: legacy refresh (hide overlay → capture → restore).
          // Persistent quiet-path failure auto-stops the watch instead of
          // degrading into the old flicker every tick.
          watchQuietFailuresRef.current += 1;
          if (watchQuietFailuresRef.current >= 3) {
            stopWatch();
            showFeedback('⚠️ 静默监控通道不可用，已停止区域监控');
            return;
          }
          await cmdBeginCapture();
          await cmdShowOverlay();
          layout = await cmdRegionOcrLayout(LAST_SELECTION, scaleFactor, vw, vh);
        }
      } else {
        layout = await cmdRegionOcrLayout(LAST_SELECTION, scaleFactor, vw, vh);
      }
      if (!watchModeRef.current || !mountedRef.current || epoch !== processEpochRef.current) return;

      // Skip re-translation when the recognized text has not changed
      const text = layout.blocks.map((b) => b.original).join('\n');
      if (text === lastWatchTextRef.current) return;
      lastWatchTextRef.current = text;
      await applyLayoutAndTranslate(layout, true);
    } catch (e) {
      console.warn('[Watch] tick failed:', e);
    } finally {
      watchTickBusyRef.current = false;
    }
  }, [scaleFactor, applyLayoutAndTranslate]);

  const toggleWatch = useCallback(() => {
    if (watchModeRef.current) {
      stopWatch();
      showFeedback('⏹ 已停止区域监控');
      return;
    }
    if (!LAST_SELECTION || phase !== 'overlay') {
      showFeedback('请先划选一个区域，再按 W 开启监控');
      return;
    }
    watchModeRef.current = true;
    setWatchMode(true);
    lastWatchTextRef.current = overlayResult
      ? overlayResult.blocks.map((b) => b.original).join('\n')
      : null;
    showFeedback(`🔄 区域监控已开启 · 每 ${watchIntervalSec}s 自动重译 (W 停止)`);
    runWatchTick();
    // 定时器由下方 useEffect 统一创建，watchIntervalMs 变化时自动按新间隔重建
  }, [phase, overlayResult, runWatchTick, stopWatch, watchIntervalSec]);

  // 监控定时器统一在此管理：开启监控时启动，关闭时清理；
  // 设置页修改刷新间隔后运行中的定时器立即热更新，无需关掉重开。
  useEffect(() => {
    if (!watchMode) return;
    watchTimerRef.current = setInterval(() => {
      runWatchTick();
    }, watchIntervalMs);
    return () => {
      if (watchTimerRef.current) clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    };
  }, [watchMode, watchIntervalMs, runWatchTick]);

  // Youdao-style display mode toggle (persisted; M key shortcut)
  const toggleDisplayMode = useCallback(() => {
    const next = displayModeRef.current === 'cover' ? 'panel' : 'cover';
    displayModeRef.current = next;
    setDisplayMode(next);
    setOverlayViewMode(next === 'panel' ? 'panel' : 'cover');
    showFeedback(next === 'panel' ? '🪟 已切换为结果面板模式（有道式）' : '🃏 已切换为原位覆盖模式');
  }, [setOverlayViewMode]);

  processSelectionRef.current = processSelection;
  processPendingRef.current = processPendingRects;
  toggleWatchRef.current = toggleWatch;
  stopWatchRef.current = stopWatch;
  toggleDisplayModeRef.current = toggleDisplayMode;

  const handleUndoAnnotation = useCallback(() => {
    setAnnotations((prev) => prev.slice(0, -1));
  }, []);

  const handleOcrExtract = useCallback(async () => {
    if (phase === 'overlay' && overlayResult && overlayResult.blocks.length > 0) {
      const fullText = overlayResult.blocks.map((b) => b.original).join('\n');
      if (!fullText.trim()) {
        showFeedback('⚠️ 未在选区内识别到文字');
        return;
      }
      await copyTextSafely(fullText, '📋 文字已提取并复制到剪贴板！');
      setOcrModalText(fullText);
      return;
    }

    const rectToOcr = adjustRect || (overlayResult ? {
      x: overlayResult.selectionX,
      y: overlayResult.selectionY,
      width: overlayResult.selectionW,
      height: overlayResult.selectionH,
    } : null);

    if (!rectToOcr) return;
    setPhase('processing');
    try {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const layout = await cmdRegionOcrLayout(rectToOcr, scaleFactor, vw, vh);
      if (!mountedRef.current) return;
      const fullText = layout.blocks.map((b) => b.original).join('\n');
      if (!fullText.trim()) {
        showFeedback('⚠️ 未在选区内识别到文字');
        setPhase('adjusting');
        return;
      }
      await copyTextSafely(fullText, '📋 文字已提取并复制到剪贴板！');
      setOcrModalText(fullText);
      setPhase('adjusting');
    } catch (err) {
      console.error('[CaptureOverlay] OCR extract failed:', err);
      showFeedback('⚠️ OCR 提取失败');
      setPhase('adjusting');
    }
  }, [phase, overlayResult, adjustRect, scaleFactor, copyTextSafely]);

  const onMouseUp = useCallback(async (e?: React.MouseEvent) => {
    // Finish an in-progress drawing annotation
    if (drawingAnnotationRef.current) {
      const finished = drawingAnnotationRef.current;
      drawingAnnotationRef.current = null;
      setAnnotations((prev) => [...prev, finished]);
      setDrawingAnnotation(null);
      return;
    }
    // Finish an adjust gesture (resize / move) — don't fall through to processing
    if (adjustHandle) {
      setAdjustHandle(null);
      adjustStartRef.current = null;
      return;
    }
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

    const rect: SelRect = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
    setStartPos(null);
    setCurrPos(null);

    // Shift+release: queue this rect for multi-region recognition (Enter runs all)
    if (e && e.shiftKey) {
      setPendingRects((prev) => {
        const next = [...prev, rect];
        showFeedback(`＋ 已叠加 ${next.length} 个选区（Enter 一起识别）`);
        return next;
      });
      return;
    }

    // Manual adjust mode (user enabled in settings): freeze the rect for resize/move/nudge before recognition
    if (settings.captureReleaseAction === 'adjust') {
      setAdjustRect(rect);
      setPhase('adjusting');
      return;
    }

    // Default 'auto': trigger recognition immediately upon release
    setAdjustRect(rect);
    await processSelection(rect);
  }, [isDragging, startPos, currPos, processSelection, adjustHandle, settings.captureReleaseAction, drawingAnnotation]);

  // ── Double-click smart snap: OCR around the cursor and auto-fit the whole
  // paragraph — no precise dragging needed for a seamless capture experience.
  const onDoubleClick = useCallback(async (e: React.MouseEvent) => {
    if ((phase !== 'selecting' && phase !== 'adjusting') || isDragging) return;
    if ((e.target as HTMLElement).closest('.overlay-block')) return;
    if ((e.target as HTMLElement).closest('.overlay-toolbar')) return;
    if ((e.target as HTMLElement).closest('.snipping-toolbar-container')) return;
    if ((e.target as HTMLElement).closest('.overlay-panel')) return;

    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return;
    const lx = e.clientX - r.left;
    const ly = e.clientY - r.top;

    // Adjust mode + double-click inside the frozen rect = confirm recognition
    if (phase === 'adjusting' && adjustRect && pointInRect({ x: lx, y: ly }, adjustRect)) {
      e.preventDefault();
      await processSelection({ ...adjustRect });
      return;
    }

    setSnapping(true);
    try {
      const snapped = await cmdSnapRegion(
        lx,
        ly,
        scaleFactor,
        typeof window !== 'undefined' ? window.innerWidth : undefined,
        typeof window !== 'undefined' ? window.innerHeight : undefined,
      );
      if (!mountedRef.current) return;
      if (!snapped || snapped.width < 12 || snapped.height < 12) {
        showFeedback('🪄 此处未检测到可吸附的文本段落');
        return;
      }
      showFeedback('🪄 已智能吸附文本段落');
      setPendingRects([]);
      setAdjustRect(null);
      await processSelection({
        x: Math.round(snapped.x),
        y: Math.round(snapped.y),
        width: Math.round(snapped.width),
        height: Math.round(snapped.height),
      });
    } catch (err) {
      console.warn('[CaptureOverlay] Snap failed:', err);
    } finally {
      if (mountedRef.current) setSnapping(false);
    }
  }, [phase, isDragging, scaleFactor, processSelection, adjustRect]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!isPinned) {
      handleCloseRef.current();
    } else {
      showFeedback('📌 卡片已锁定 (按 Ctrl+P 解锁)');
    }
  }, [isPinned]);

  const handleClose = async (force: boolean = false) => {
    if (isPinned && !force) {
      return;
    }
    setPhase('idle');
    setOverlayResult(null);
    setStartPos(null);
    setCurrPos(null);
    setCursorPos(null);
    setIsPinned(false);
    setBannerDismissed(false);
    setFeedbackToast(null);
    setTranslatingProgress(null);
    setAdjustRect(null);
    setAdjustHandle(null);
    adjustStartRef.current = null;
    setPendingRects([]);
    setAnnotations([]);
    drawingAnnotationRef.current = null;
    setDrawingAnnotation(null);
    setActiveTool(null);
    setOcrModalText(null);
    setSnapping(false);
    setCheatOpen(false);
    cheatOpenRef.current = false;
    setActionToast(null);
    setCardMenu(null);
    setDismissedBlockIndexes([]);
    setHoverBubble(null);
    setPinnedLookups([]);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setCardScales({});
    setRenderedHeights({});
    setActiveBlockIdx(null);
    setCardViewMode('translated');
    processEpochRef.current += 1;
    stopWatch();
    if (isTauri()) {
      try {
        await cmdCloseOverlay();
      } catch (e) {
        console.warn('cmdCloseOverlay error:', e);
      }
    }
    onClose();
  };
  handleCloseRef.current = handleClose;

  if (!isOpen) return null;

  const selBox = startPos && currPos ? {
    x: Math.min(startPos.x, currPos.x),
    y: Math.min(startPos.y, currPos.y),
    w: Math.abs(startPos.x - currPos.x),
    h: Math.abs(startPos.y - currPos.y),
  } : null;

  // The box the mask should spotlight: live drag rect, or the frozen adjust rect / active processing rect
  const activeBox = selBox
    ? selBox
    : ((phase === 'adjusting' || phase === 'processing') && adjustRect
        ? { x: adjustRect.x, y: adjustRect.y, w: adjustRect.width, h: adjustRect.height }
        : null);

  // 降级感知检测（仅当用户在工具栏主动切换为 AI 大模型时，若大模型失败降级才提示）
  const isLlmEngine =
    selectedEngine.startsWith('llm:') ||
    ['deepseek', 'openai', 'ollama', 'glm', 'gemini', 'claude', 'qwen', 'moonshot', 'kimi', 'custom', 'siliconflow', 'groq', 'ai', 'llm'].some((k) =>
      selectedEngine.toLowerCase().includes(k)
    ) ||
    !!settings.llmConfigs?.some(
      (c) => c.id === selectedEngine || `llm:${c.id}` === selectedEngine || c.model?.toLowerCase() === selectedEngine.toLowerCase()
    );

  let isDowngraded = false;
  let effectiveEngineName = '公共备用通道';

  if (phase === 'overlay' && overlayResult && overlayResult.blocks.length > 0) {
    // Aggregate across ALL blocks (the old first-block-only check misreported
    // mixed-tier results): downgraded = not a single block came back via LLM.
    const isLlmTier = (t: string) =>
      t.includes('LLM') || t.includes('DeepSeek') || t.includes('OpenAI') || t.includes('Ollama');
    const anyLlmSuccess = overlayResult.blocks.some((b) => isLlmTier(b.sourceTier || ''));
    const primaryTier =
      overlayResult.blocks.map((b) => b.sourceTier || '').find((t) => t && t !== 'OCR')
      || overlayResult.blocks[0].sourceTier
      || '';

    if (isLlmEngine && !anyLlmSuccess) {
      isDowngraded = true;
      if (primaryTier.includes('Preset') || primaryTier.includes('词库') || primaryTier.includes('词典') || primaryTier.includes('Blender')) {
        effectiveEngineName = '3D 本地词库';
      } else if (primaryTier.includes('Google') || primaryTier.includes('谷歌')) {
        effectiveEngineName = 'Google 翻译';
      } else if (primaryTier.includes('MyMemory')) {
        effectiveEngineName = 'MyMemory 记忆库';
      } else if (primaryTier.includes('Bing') || primaryTier.includes('微软')) {
        effectiveEngineName = 'Bing 翻译';
      } else if (primaryTier.includes('Online') || primaryTier.includes('Fallback')) {
        effectiveEngineName = '公共在线通道';
      } else {
        effectiveEngineName = primaryTier || '备用通道';
      }
    }
  }

  const maskOpacity = 'rgba(2, 6, 12, 0.30)';
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const effectiveRect = adjustRect || (overlayResult ? {
    x: overlayResult.selectionX,
    y: overlayResult.selectionY,
    width: overlayResult.selectionW,
    height: overlayResult.selectionH,
  } : null);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] overflow-hidden select-none"
      style={{
        cursor: adjustHandle
          ? HANDLE_CURSOR[adjustHandle] || 'move'
          : phase === 'processing'
          ? 'wait'
          : phase === 'overlay'
          ? 'default'
          : phase === 'adjusting'
          ? 'move'
          : 'crosshair',
        background: 'transparent',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {/* ── 选区阶段全屏遮罩（聚光灯模式：选框内部完全透亮，全屏遮罩 100% 均匀无十字阴影重叠） ── */}
      {(phase === 'selecting' || phase === 'adjusting' || phase === 'processing' || isDragging) && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden z-[101]">
          <defs>
            <mask id="spotlight-selection-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {activeBox && activeBox.w > 4 && (
                <rect
                  x={activeBox.x}
                  y={activeBox.y}
                  width={activeBox.w}
                  height={activeBox.h}
                  fill="black"
                />
              )}
              {pendingRects.map((r, i) => (
                <rect key={`mask-pending-${i}`} x={r.x} y={r.y} width={r.width} height={r.height} fill="black" />
              ))}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={maskOpacity}
            mask="url(#spotlight-selection-mask)"
          />
        </svg>
      )}

      {/* ── 选区高亮、虚影与控制点层 ────────────────────────────────────────── */}
      {(phase === 'selecting' || phase === 'adjusting' || phase === 'processing' || isDragging) && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[104]">
          {/* Shift 多选已排队的虚影选区 */}
          {pendingRects.map((rect, i) => (
            <div
              key={`pending-${i}`}
              data-testid={`pending-rect-${i}`}
              style={{
                position: 'absolute',
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                border: '1.5px dashed rgba(52,211,153,0.85)',
                background: 'rgba(52,211,153,0.08)',
                zIndex: 104,
              }}
              className="rounded-[2px] pointer-events-none"
            >
              <span className="absolute -top-5 -right-1 text-[10px] font-mono font-bold bg-emerald-600 text-white px-1.5 rounded shadow">
                {i + 1}
              </span>
            </div>
          ))}

          {/* 选区矩形框与控制点 (识别中为极光科技蓝扫描框，平时为经典绿框) */}
          {activeBox && activeBox.w > 4 && (
            <div
              style={{
                position: 'absolute',
                left: activeBox.x,
                top: activeBox.y,
                width: activeBox.w,
                height: activeBox.h,
                pointerEvents: 'none',
                zIndex: 105,
                border: phase === 'processing' ? '2px solid #38bdf8' : '2px solid #22c55e',
                boxShadow: phase === 'processing'
                  ? '0 0 16px rgba(56,189,248,0.5), inset 0 0 12px rgba(56,189,248,0.2)'
                  : '0 0 0 1px rgba(34,197,94,0.3), 0 8px 32px rgba(0,0,0,0.3)',
              }}
              className={`rounded-[2px] ${phase === 'processing' ? 'breathing-scan-box overflow-hidden' : ''}`}
            >
              {/* 识别处理中的全息激光扫描束与科技角标 */}
              {phase === 'processing' && (
                <>
                  <div className="laser-scan-fill" />
                  <div className="laser-scan-line" />
                  <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-sky-300 pointer-events-none" />
                  <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-sky-300 pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-sky-300 pointer-events-none" />
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-sky-300 pointer-events-none" />
                </>
              )}

              {/* 调整模式：8 个白色绿边控制点 */}
              {phase === 'adjusting' && adjustRect && ADJUST_HANDLES.map((h) => (
                <div
                  key={h.id}
                  data-handle={h.id}
                  data-testid={`adjust-handle-${h.id}`}
                  style={{
                    position: 'absolute',
                    width: 9,
                    height: 9,
                    borderRadius: 2,
                    background: '#ffffff',
                    border: '2px solid #22c55e',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                    pointerEvents: 'auto',
                    cursor: HANDLE_CURSOR[h.id] || 'default',
                    zIndex: 110,
                    ...h.style,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 激活标注工具时的全屏绘制交互层 (z-[215]) ────────────────────────── */}
      {activeTool && (
        <div
          className="absolute inset-0 z-[215] pointer-events-auto"
          style={{ cursor: 'crosshair' }}
        />
      )}

      {/* ── 标注层 (Annotations Layer) ───────────────────────────────────────── */}
      {(annotations.length > 0 || drawingAnnotation) && (
        <svg
          className="absolute inset-0 pointer-events-none z-[225] w-full h-full"
          style={{ overflow: 'visible' }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill={annotationColor} />
            </marker>
            <pattern id="mosaic-pattern" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="rgba(0,0,0,0.4)" />
              <rect x="5" width="5" height="5" fill="rgba(255,255,255,0.4)" />
              <rect y="5" width="5" height="5" fill="rgba(255,255,255,0.4)" />
              <rect x="5" y="5" width="5" height="5" fill="rgba(0,0,0,0.4)" />
            </pattern>
          </defs>

          {[...annotations, ...(drawingAnnotation ? [drawingAnnotation] : [])].map((ann) => {
            if (ann.type === 'pen' && ann.points && ann.points.length > 1) {
              const d = ann.points.reduce(
                (acc, pt, idx) => (idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`),
                ''
              );
              return (
                <path
                  key={ann.id}
                  d={d}
                  stroke={ann.color}
                  strokeWidth={ann.strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            }
            if (ann.type === 'rect' && ann.start && ann.end) {
              const rx = Math.min(ann.start.x, ann.end.x);
              const ry = Math.min(ann.start.y, ann.end.y);
              const rw = Math.abs(ann.start.x - ann.end.x);
              const rh = Math.abs(ann.start.y - ann.end.y);
              return (
                <rect
                  key={ann.id}
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  stroke={ann.color}
                  strokeWidth={ann.strokeWidth}
                  fill="none"
                  rx="3"
                />
              );
            }
            if (ann.type === 'arrow' && ann.start && ann.end) {
              return (
                <line
                  key={ann.id}
                  x1={ann.start.x}
                  y1={ann.start.y}
                  x2={ann.end.x}
                  y2={ann.end.y}
                  stroke={ann.color}
                  strokeWidth={ann.strokeWidth}
                  strokeLinecap="round"
                  markerEnd="url(#arrowhead)"
                />
              );
            }
            if (ann.type === 'mosaic' && ann.start && ann.end) {
              const mx = Math.min(ann.start.x, ann.end.x);
              const my = Math.min(ann.start.y, ann.end.y);
              const mw = Math.abs(ann.start.x - ann.end.x);
              const mh = Math.abs(ann.start.y - ann.end.y);
              return (
                <rect
                  key={ann.id}
                  x={mx}
                  y={my}
                  width={mw}
                  height={mh}
                  fill="url(#mosaic-pattern)"
                  stroke="rgba(0,0,0,0.3)"
                  strokeWidth="1"
                  rx="2"
                />
              );
            }
            if (ann.type === 'text' && ann.x !== undefined && ann.y !== undefined) {
              return (
                <text
                  key={ann.id}
                  x={ann.x}
                  y={ann.y}
                  fill={ann.color}
                  fontSize="16"
                  fontWeight="bold"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                >
                  {ann.text}
                </text>
              );
            }
            return null;
          })}
        </svg>
      )}

      {/* ── 统一现代白底微阴影悬浮工具条 (SnippingToolbar: selecting/hovering/adjusting/overlay 全流程统一承载) ── */}
      {(phase === 'selecting' || phase === 'hovering' || phase === 'adjusting' || phase === 'overlay') && (
        <SnippingToolbar
          testId={phase === 'selecting' || phase === 'hovering' ? 'snipping-top-bar' : 'adjust-confirm-bar'}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          selectedColor={annotationColor}
          onSelectColor={setAnnotationColor}
          strokeWidth={annotationStrokeWidth}
          onSelectStrokeWidth={setAnnotationStrokeWidth}
          onTranslate={() => {
            if (phase === 'overlay') {
              retranslateBlocks(targetLang, selectedEngine);
            } else if (effectiveRect) {
              processSelectionRef.current({ ...effectiveRect });
            } else {
              if (pendingRects.length > 0) {
                processPendingRef.current();
              } else {
                processSelectionRef.current({ x: 0, y: 0, width: vw, height: vh });
              }
            }
          }}
          onOcr={handleOcrExtract}
          onUndo={handleUndoAnnotation}
          canUndo={annotations.length > 0}
          onPin={() => {
            setIsPinned((prev) => {
              const next = !prev;
              showFeedback(next ? '📌 已锁定 (防误触退出)' : '🔓 已解除锁定');
              return next;
            });
          }}
          isPinned={isPinned}
          onSave={() => void saveRegionImage(effectiveRect || { x: 0, y: 0, width: vw, height: vh })}
          onCopy={() => {
            if (phase === 'overlay' && overlayResult && overlayResult.blocks.length > 0) {
              const fullTranslated = overlayResult.blocks.map((b) => b.translated).join('\n');
              void copyTextSafely(fullTranslated, '📋 全部译文已复制到剪贴板！');
            } else {
              void copyRegionImage(effectiveRect || { x: 0, y: 0, width: vw, height: vh });
            }
          }}
          onCancel={() => {
            if (phase === 'overlay') {
              handleClose(true);
            } else if (phase === 'adjusting') {
              setAdjustRect(null);
              setPendingRects([]);
              setAnnotations([]);
              setPhase('selecting');
            } else {
              handleClose(true);
            }
          }}
          onConfirm={async () => {
            if (phase === 'overlay' && overlayResult && overlayResult.blocks.length > 0) {
              const fullTranslated = overlayResult.blocks.map((b) => b.translated).join('\n');
              await copyTextSafely(fullTranslated, '📋 全部译文已复制并退出');
            } else {
              await copyRegionImage(effectiveRect || { x: 0, y: 0, width: vw, height: vh });
            }
            await handleClose(true);
          }}
          isProcessing={!!translatingProgress}
          targetLang={targetLang}
          onSelectLanguage={handleLanguageChange}
          selectedEngine={selectedEngine}
          onSelectEngine={handleEngineChange}
          settings={settings}
          watchMode={watchMode}
          onToggleWatch={() => toggleWatch()}
          onCheatSheet={() => setCheatOpen(true)}
          isDowngraded={isDowngraded}
          effectiveEngineName={effectiveEngineName}
          bannerDismissed={bannerDismissed}
          viewMode={cardViewMode}
          onSelectViewMode={setCardViewMode}
          onSpeech={handleSpeechActive}
          fontScale={globalFontScale}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          style={
            (phase === 'adjusting' || phase === 'overlay') && effectiveRect
              ? {
                  position: 'absolute',
                  zIndex: 220,
                  left: Math.max(10, Math.min(effectiveRect.x + effectiveRect.width / 2 - 250, Math.max(10, vw - 520))),
                  top:
                    effectiveRect.y + effectiveRect.height + 10 + 46 > vh - 10
                      ? Math.max(10, effectiveRect.y - 52)
                      : effectiveRect.y + effectiveRect.height + 10,
                }
              : {
                  position: 'fixed',
                  zIndex: 230,
                  top: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                }
          }
        />
      )}

      {/* ── 提取文字 (OCR) 浮窗 ────────────────────────────────────────────── */}
      {ocrModalText && (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in pointer-events-auto"
          onClick={() => setOcrModalText(null)}
        >
          <div
            className="max-w-md w-full mx-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 font-bold text-sm">
                  📄 OCR
                </span>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">提取文本内容</h3>
              </div>
              <button
                type="button"
                onClick={() => setOcrModalText(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <textarea
              readOnly
              value={ocrModalText}
              rows={6}
              className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-800 dark:text-slate-200 resize-none outline-none focus:ring-2 focus:ring-sky-500"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void copyTextSafely(ocrModalText, '📋 已复制到剪贴板');
                  setOcrModalText(null);
                }}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs shadow-md shadow-sky-500/20 transition cursor-pointer flex items-center gap-1.5"
              >
                📋 复制并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 双击智能吸附进行中指示 ─────────────────────────────────────────────── */}
      {snapping && cursorPos && (
        <div
          data-testid="snap-loading"
          className="absolute pointer-events-none z-[214] flex items-center gap-2 rounded-full border border-sky-400/40 bg-slate-900/92 px-3 py-1.5 shadow-2xl backdrop-blur-md"
          style={{ left: cursorPos.x + 18, top: cursorPos.y + 18 }}
        >
          <svg className="animate-spin h-3.5 w-3.5 text-sky-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs font-semibold text-sky-200">🪄 正在吸附文本段落…</span>
        </div>
      )}

      {/* ── 悬停取词模式：暗幕 + 底部提示 + 译文气泡 + 已钉住的词条 ─────────────── */}
      {phase === 'hovering' && (
        <div className="absolute inset-0 pointer-events-none z-[100]" style={{ background: 'rgba(2, 6, 12, 0.45)' }} />
      )}
      {phase === 'hovering' && (
        <div
          data-testid="hover-hint"
          className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[240] pointer-events-none animate-fade-in"
        >
          <div className="flex items-center gap-2 rounded-full border border-violet-400/40 bg-slate-900/88 px-4 py-1.5 shadow-2xl text-xs font-semibold text-violet-200 backdrop-blur-md">
            🖱 悬停取词 · 光标停在文字上自动翻译 · 气泡内 📌 钉住 · H 切回划框 · Esc 退出
          </div>
        </div>
      )}
      {phase === 'hovering' && pinnedLookups.map((hit, i) => (
        <div
          key={`pinned-${i}`}
          data-testid={`pinned-lookup-${i}`}
          className="absolute z-[200] max-w-[380px] rounded-xl border border-violet-400/40 bg-slate-900/92 px-3 py-2 shadow-2xl backdrop-blur-md"
          style={{ left: Math.max(8, Math.min(hit.x, vw - 390)), top: Math.min(hit.y + hit.height + 6, vh - 100) }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10.5px] font-mono text-zinc-400 truncate">{hit.text}</p>
            <button
              type="button"
              onClick={() => setPinnedLookups((prev) => prev.filter((_, j) => j !== i))}
              className="text-zinc-400 hover:text-rose-400 transition cursor-pointer text-[11px] shrink-0"
              title="移除此词条"
            >
              ✕
            </button>
          </div>
          <p className="text-sm font-bold text-violet-200 break-words">{hit.translated || '（未翻译）'}</p>
        </div>
      ))}
      {phase === 'hovering' && hoverBubble && (
        <div
          data-testid="hover-bubble"
          className="absolute z-[230] max-w-[380px] rounded-xl border border-violet-400/60 bg-slate-900/95 px-3 py-2 shadow-2xl backdrop-blur-xl animate-fade-in"
          style={{
            left: Math.max(8, Math.min(hoverBubble.x, vw - 390)),
            top: Math.min(hoverBubble.y + hoverBubble.height + 8, vh - 110),
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-[10.5px] font-mono text-zinc-400 break-all">{hoverBubble.text}</p>
              <p className="text-sm font-bold text-violet-200 break-words">
                {hoverBubble.translated || '翻译中…'}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0 text-[11px]">
              <button
                type="button"
                title="钉住此词条"
                className="p-1 rounded-md text-zinc-300 hover:text-amber-300 hover:bg-white/10 transition cursor-pointer"
                onClick={() => {
                  setPinnedLookups((prev) => [...prev, hoverBubble]);
                  setHoverBubble(null);
                }}
              >
                📌
              </button>
              <button
                type="button"
                title="复制译文"
                className="p-1 rounded-md text-zinc-300 hover:text-sky-300 hover:bg-white/10 transition cursor-pointer"
                onClick={() => {
                  void copyTextSafely(hoverBubble.translated || hoverBubble.text, '📋 已复制');
                }}
              >
                📋
              </button>
              <button
                type="button"
                title="朗读原文"
                className="p-1 rounded-md text-zinc-300 hover:text-sky-300 hover:bg-white/10 transition cursor-pointer"
                onClick={() => {
                  speakText(hoverBubble.text, { lang: detectSpeechLang(hoverBubble.text) });
                }}
              >
                🔊
              </button>
              <button
                type="button"
                title="收藏到生词本"
                className="p-1 rounded-md text-zinc-300 hover:text-amber-300 hover:bg-white/10 transition cursor-pointer"
                onClick={() => {
                  saveTranslationHistory(hoverBubble.text, hoverBubble.translated, `${hoverBubble.tier || 'hover'} (⭐已生词本)`).catch(console.warn);
                  showFeedback('⭐ 已收藏至生词本');
                }}
              >
                ⭐
              </button>
            </div>
          </div>
          {hoverBubble.tier && (
            <span className="inline-block mt-1 text-[9px] font-mono text-zinc-500">{hoverBubble.tier}</span>
          )}
        </div>
      )}



      {/* ── CaptureOverlay 翻译中态微光全息指示胶囊 ─────────────────────────── */}
      {phase === 'processing' && (
        <div
          className="absolute z-[220] pointer-events-auto flex items-center justify-center animate-fade-in"
          style={
            activeBox && activeBox.w > 4
              ? {
                  position: 'absolute',
                  left: Math.max(16, Math.min(activeBox.x + activeBox.w / 2 - 140, vw - 300)),
                  top: activeBox.y + activeBox.h + 14 > vh - 60
                    ? Math.max(16, activeBox.y - 52)
                    : activeBox.y + activeBox.h + 14,
                }
              : {
                  position: 'absolute',
                  inset: 0,
                }
          }
        >
          <div
            className={`flex items-center gap-3 border rounded-2xl px-5 py-2.5 shadow-2xl backdrop-blur-xl transition-all duration-200 ${
              isLight
                ? 'bg-white/95 border-sky-400/60 text-slate-800 shadow-sky-500/15'
                : 'bg-slate-950/90 border-sky-400/50 text-white shadow-sky-500/25 ring-1 ring-white/10'
            }`}
          >
            {/* 脉冲星芒 AI 图标 */}
            <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-70" />
              <svg className="relative w-4 h-4 text-sky-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-85" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>

            <span className="font-semibold text-xs tracking-wide bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent" data-testid="processing-label">
              ✨ 正在极速识别并翻译…
            </span>

            <button
              type="button"
              data-testid="cancel-processing-btn"
              onClick={() => cancelProcessing()}
              className={`ml-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition cursor-pointer flex items-center gap-1 ${
                isLight
                  ? 'border-slate-300 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-300'
                  : 'border-white/15 text-zinc-300 hover:bg-rose-950/50 hover:text-rose-300 hover:border-rose-500/40'
              }`}
              title="取消本次识别（回到选区）"
            >
              <span>✕</span>
              <span>取消</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Empty OCR Notice Toast ──────────────────────────────────────────────── */}
      {emptyNotice && (
        <div className="absolute top-18 left-1/2 -translate-x-1/2 z-[130] pointer-events-none">
          <div className="flex items-center gap-2 bg-amber-950/90 border border-amber-500/40 rounded-full px-5 py-2 shadow-2xl text-xs font-semibold text-amber-200">
            <span>⚠️</span>
            <span>{emptyNotice}</span>
          </div>
        </div>
      )}

      {/* ── Region-watch live indicator ─────────────────────────────────────── */}
      {phase === 'overlay' && watchMode && !translatingProgress && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[240] pointer-events-none animate-fade-in">
          <div className="flex items-center gap-2.5 rounded-full border border-emerald-400/40 bg-slate-900/85 backdrop-blur-md px-4 py-1.5 shadow-2xl">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-xs font-semibold text-emerald-300 font-mono">
              🔄 区域监控中 · 每 {watchIntervalSec}s 自动重译
            </span>
          </div>
        </div>
      )}

      {/* ── Stage-2 non-blocking progress chip (translations streaming in) ────── */}
      {phase === 'overlay' && translatingProgress && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[240] pointer-events-none animate-fade-in">
          <div className="flex items-center gap-2.5 rounded-full border border-sky-400/40 bg-slate-900/85 backdrop-blur-md px-4 py-1.5 shadow-2xl">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400" />
            </span>
            <span className="text-xs font-semibold text-sky-200 font-mono">
              译文接管中 {translatingProgress.done}/{translatingProgress.total}
            </span>
          </div>
        </div>
      )}

      {/* ── Feedback Toast (Copy / Pin / Voice actions) ────────────────────────── */}
      {feedbackToast && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[250] pointer-events-none animate-fade-in">
          <div className="flex items-center gap-2 bg-slate-900/95 border border-sky-400/50 rounded-full px-4 py-1.5 shadow-2xl text-xs font-semibold text-sky-200 backdrop-blur-md">
            <span>{feedbackToast}</span>
          </div>
        </div>
      )}

      {/* ── Actionable toast (stage-1 retry 等) ───────────────────────────────── */}
      {actionToast && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[255] pointer-events-auto animate-fade-in" data-testid="action-toast">
          <div className="flex items-center gap-3 bg-slate-900/95 border border-amber-400/50 rounded-full px-4 py-1.5 shadow-2xl text-xs font-semibold text-amber-200 backdrop-blur-md">
            <span>{actionToast.message}</span>
            <button
              type="button"
              onClick={() => actionToast.onAction()}
              className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white hover:bg-amber-400 transition cursor-pointer font-bold"
            >
              {actionToast.actionLabel}
            </button>
            <button
              type="button"
              onClick={() => setActionToast(null)}
              className="text-zinc-400 hover:text-white transition cursor-pointer"
              title="忽略"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Card context menu（卡片右键：复制/朗读/收藏/隐藏，不再误关整场） ────── */}
      {cardMenu && overlayResult && overlayResult.blocks[cardMenu.blockIndex] && (
        <div
          className="overlay-card-menu absolute z-[260] rounded-xl border border-white/15 bg-slate-900/95 backdrop-blur-xl shadow-2xl py-1 min-w-[150px] pointer-events-auto"
          data-testid="card-context-menu"
          style={{ left: Math.min(cardMenu.x, vw - 175), top: Math.min(cardMenu.y, vh - 210) }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {(() => {
            const mb = overlayResult.blocks[cardMenu.blockIndex];
            const items: { label: string; run: () => void }[] = [
              { label: '📋 复制译文', run: () => void copyTextSafely(mb.translated || mb.original, '📋 已复制译文') },
              { label: '📄 复制原文', run: () => void copyTextSafely(mb.original, '📋 已复制原文') },
              {
                label: '🔊 朗读原文',
                run: () => {
                  speakText(mb.original, { lang: 'en-US' });
                  showFeedback('🔊 正在朗读原文...');
                },
              },
              {
                label: '⭐ 收藏到生词本',
                run: () => {
                  saveTranslationHistory(mb.original, mb.translated, `${mb.sourceTier} (⭐已生词本)`).catch(console.warn);
                  showFeedback('⭐ 已收藏至生词本');
                },
              },
            ];
            if (mb.translationFailed) {
              items.push({ label: '🔄 重试翻译', run: () => void retryBlockTranslation(cardMenu.blockIndex) });
            }
            items.push({
              label: '🚫 隐藏此卡片',
              run: () => setDismissedBlockIndexes((prev) => [...prev, cardMenu.blockIndex]),
            });
            const selRect: SelRect = {
              x: overlayResult.selectionX,
              y: overlayResult.selectionY,
              width: overlayResult.selectionW,
              height: overlayResult.selectionH,
            };
            items.push({
              label: '📌 贴图此卡片',
              run: () => pinOverlayBlocks(
                [{ original: mb.original, translated: mb.translated, sourceTier: mb.sourceTier }],
                '划词 · 单卡片',
                mb.logicalX,
                mb.logicalY + 24,
              ),
            });
            items.push({
              label: '📌 贴图全部译文',
              run: () => pinOverlayBlocks(
                overlayResult.blocks.map((b) => ({ original: b.original, translated: b.translated, sourceTier: b.sourceTier })),
                '划词译文',
                overlayResult.selectionX + 24,
                overlayResult.selectionY,
              ),
            });
            items.push({ label: '📷 复制选区图片', run: () => void copyRegionImage(selRect) });
            items.push({ label: '💾 保存选区图片 (PNG)', run: () => void saveRegionImage(selRect) });
            return items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  item.run();
                  setCardMenu(null);
                }}
                className="w-full text-left px-3.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-sky-500/20 hover:text-white transition cursor-pointer"
              >
                {item.label}
              </button>
            ));
          })()}
        </div>
      )}

      {/* ── In-place translated text blocks (cover mode) ─────────────────────── */}
      {phase === 'overlay' && displayMode === 'cover' && displayBlocks.map((block) => (
        <OverlayBlockCard
          key={block.__i}
          block={block}
          blockIndex={block.__i}
          onClose={handleClose}
          isPinned={isPinned}
          onTogglePin={() => {
            setIsPinned((prev) => {
              const next = !prev;
              showFeedback(next ? '📌 已固定卡片' : '🔓 已解除固定');
              return next;
            });
          }}
          onCopySingle={(text) => {
            void copyTextSafely(text, `📋 已复制: "${text.slice(0, 24)}${text.length > 24 ? '…' : ''}"`);
          }}
          onCardContextMenu={(e) => {
            const r = containerRef.current?.getBoundingClientRect();
            setCardMenu({
              blockIndex: block.__i,
              x: e.clientX - (r?.left ?? 0),
              y: e.clientY - (r?.top ?? 0),
            });
          }}
          onRetry={block.translationFailed ? () => { void retryBlockTranslation(block.__i); } : undefined}
          viewMode={cardViewMode}
          scale={(cardScales[block.__i] ?? 1.0) * globalFontScale}
          onScaleChange={(s) => setCardScales((prev) => ({ ...prev, [block.__i]: s }))}
          onViewCycle={cycleCardView}
          onActive={() => setActiveBlockIdx(block.__i)}
          isActive={activeBlockIdx === block.__i}
          onRenderedHeight={handleRenderedHeight}
        />
      ))}

      {/* ── Youdao-style panel mode: dashed outlines keep the original text
          visible on screen; results live in a docked source/translation panel ── */}
      {phase === 'overlay' && displayMode === 'panel' && overlayResult && (
        <>
          {displayBlocks.map((block, dispIdx) => (
            <div
              key={block.__i}
              className="overlay-outline pointer-events-none absolute rounded-[3px] transition-all duration-150"
              data-block-index={dispIdx}
              style={{
                left: block.logicalX - 2,
                top: block.logicalY - 2,
                width: block.logicalW + 4,
                height: block.logicalH + 4,
                border: `1.5px dashed ${hoverBlockIndex === dispIdx ? 'rgba(56,189,248,0.95)' : 'rgba(56,189,248,0.55)'}`,
                background: hoverBlockIndex === dispIdx ? 'rgba(56,189,248,0.12)' : 'rgba(56,189,248,0.04)',
                boxShadow: hoverBlockIndex === dispIdx ? '0 0 14px rgba(56,189,248,0.35)' : 'none',
                zIndex: 150,
              }}
              title={`${block.original} → ${block.translated || '翻译中…'}`}
            />
          ))}

          <YoudaoResultPanel
            blocks={displayBlocks}
            selectionX={overlayResult.selectionX}
            selectionY={overlayResult.selectionY}
            selectionW={overlayResult.selectionW}
            selectionH={overlayResult.selectionH}
            isLight={isLight}
            translating={!!translatingProgress}
            hoverIndex={hoverBlockIndex}
            targetLang={targetLang}
            onHover={setHoverBlockIndex}
            onCopyText={(text) => {
              void copyTextSafely(text, '📋 已复制到剪贴板');
            }}
            onSpeech={(text) => {
              speakText(text, { lang: targetLang === 'zh-CN' ? 'zh-CN' : 'en-US' });
              showFeedback('🔊 正在朗读...');
            }}
            onRetranslate={() => retranslateBlocks(targetLang, selectedEngine)}
            onSwitchMode={() => toggleDisplayModeRef.current()}
            onExportImage={() => void exportOverlayImage()}
            onPin={() => pinOverlayBlocks(
              displayBlocks.map((b) => ({ original: b.original, translated: b.translated, sourceTier: b.sourceTier })),
              '划词译文',
              overlayResult.selectionX + 24,
              overlayResult.selectionY,
            )}
            onClose={() => handleCloseRef.current()}
          />
        </>
      )}

      {/* ── 快捷键速查面板 (?/F1) ─────────────────────────────────────────── */}
      <CheatSheetModal
        isOpen={cheatOpen}
        onClose={() => {
          cheatOpenRef.current = false;
          setCheatOpen(false);
        }}
      />
    </div>
  );
};


