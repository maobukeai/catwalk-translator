/**
 * CaptureOverlay — Ultra-fast invisible selection mask with instant in-place translation overlay.
 *
 * Performance-optimised flow (<200ms end-to-end):
 *  1. Hotkey -> Rust hides main window and expands transparent always-on-top selection window (0ms image transfer delay)
 *  2. User draws selection rect directly over real screen (with translucent mask + crosshair guides + spotlight corners)
 *  3. On mouse release: Rust captures ONLY that region via native GDI BitBlt (<1ms)
 *  4. Feed tiny region BMP to persistent RapidOCR daemon (<80ms) + sample background colors
 *  5. Render in-place translated text blocks directly at exact original screen coordinates
 *  6. Right-click or Esc to dismiss and restore main window (unless pinned)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  cmdBeginCapture,
  cmdShowOverlay,
  cmdCloseOverlay,
  cmdRegionOcrTranslate,
  cmdUniversalTranslate,
  saveTranslationHistory,
  isTauri,
} from '../../services/tauri';
import type { OverlayBlock, OverlayResult, LanguageCode } from '../../services/types';
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

const TARGET_LANG_OPTIONS: { code: LanguageCode; label: string }[] = [
  { code: 'zh-CN', label: '中' },
  { code: 'en', label: '英' },
  { code: 'ja', label: '日' },
  { code: 'ko', label: '韩' },
  { code: 'de', label: '德' },
  { code: 'fr', label: '法' },
];

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
  const [targetLang, setTargetLang] = useState<LanguageCode>('zh-CN');

  // 速赢 5: Pin 锁定状态
  const [isPinned, setIsPinned] = useState(false);

  // 速赢 3: 降级提示关闭状态
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // 速赢 2: 阶段化文字过渡
  const [processingStage, setProcessingStage] = useState<'ocr' | 'translate' | 'render'>('ocr');

  // Selection box state (logical CSS pixels)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currPos, setCurrPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Recognition & translation result
  const [overlayResult, setOverlayResult] = useState<OverlayResult | null>(null);
  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  const showFeedback = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => {
      if (mountedRef.current) setFeedbackToast(null);
    }, 2200);
  };

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
      setCursorPos(null);
      setIsPinned(false);
      setBannerDismissed(false);
      setFeedbackToast(null);
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

  // ── Re-translate existing blocks when targetLang / engine changes ────────────
  const retranslateBlocks = useCallback(
    async (newTargetLang: LanguageCode, engine: string) => {
      if (!overlayResult || overlayResult.blocks.length === 0) return;
      try {
        const updatedBlocks = await Promise.all(
          overlayResult.blocks.map(async (block) => {
            const res = await cmdUniversalTranslate({
              text: block.original,
              sourceLang: 'auto',
              targetLang: newTargetLang,
              preset: engine !== 'auto' ? engine : (settings.defaultPreset || 'blender'),
              llmConfig: settings.llmConfig,
              presetDicts: settings.presetDicts,
              onlineEngines: settings.onlineEngines,
              translationTiers: settings.translationTiers,
            });
            return {
              ...block,
              translated: res.mainTranslation || block.translated,
              sourceTier: res.engines[0]?.sourceTier || block.sourceTier,
            };
          })
        );
        setOverlayResult((prev) => (prev ? { ...prev, blocks: updatedBlocks } : null));
        showFeedback(`已切换至 ${newTargetLang} 重新翻译`);
      } catch (err) {
        console.warn('[CaptureOverlay] Retranslate error:', err);
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

  // ── Keyboard shortcuts handler (Overlay & Selection phase) ─────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // F4: 一键快速关闭 / 切换
      if (e.key === 'F4') {
        e.preventDefault();
        if (!isPinned) {
          handleClose();
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
        if (isPinned) {
          showFeedback('📌 当前处于锁定状态，请按 Ctrl+P 解锁后再退出');
          return;
        }
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
            showFeedback('🔊 正在朗读原文...');
          }
          return;
        }

        // Tab: Cycle AI model / translation engine
        if (e.key === 'Tab') {
          e.preventDefault();
          const engines = ['auto', 'deepseek', 'openai', 'ollama', 'custom', 'google', 'bing', 'blender'];
          const currIdx = engines.indexOf(selectedEngine);
          const nextEngine = engines[(currIdx + 1) % engines.length];
          handleEngineChange(nextEngine);
          return;
        }

        // Enter or Ctrl+C: Copy translated text to clipboard
        if (e.key === 'Enter' || (e.ctrlKey && e.key.toLowerCase() === 'c')) {
          e.preventDefault();
          const translatedText = overlayResult.blocks.map((b) => b.translated).join('\n');
          navigator.clipboard.writeText(translatedText);
          showFeedback('📋 全部译文已复制到剪贴板！');
          if (!isPinned) {
            setTimeout(() => {
              if (mountedRef.current) handleClose();
            }, 600);
          }
          return;
        }

        // Ctrl+D: Add to favorite / vocabulary
        if (e.ctrlKey && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          saveTranslationHistory(topBlock.original, topBlock.translated, `${topBlock.sourceTier} (⭐已生词本)`).catch(console.warn);
          showFeedback('⭐ 已收藏至生词本 (Ctrl+D)');
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, phase, overlayResult, selectedEngine, isPinned, retranslateBlocks, targetLang]);

  // ── Mouse handlers for selection phase ───────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (phase !== 'selecting' && phase !== 'overlay') return;
    if ((e.target as HTMLElement).closest('.overlay-block')) return;
    if ((e.target as HTMLElement).closest('.overlay-toolbar')) return;

    // Right-click exits immediately (if not pinned)
    if (e.button === 2) {
      if (!isPinned) {
        handleClose();
      } else {
        showFeedback('📌 当前处于固定状态，点击图钉或按 Ctrl+P 解锁');
      }
      return;
    }

    if (e.button === 0) {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const pos = { x: e.clientX - r.left, y: e.clientY - r.top };
      setStartPos(pos);
      setCurrPos(pos);
      setIsDragging(true);
      if (phase === 'overlay') {
        if (!isPinned) {
          setOverlayResult(null);
          setPhase('selecting');
        }
      }
      e.preventDefault();
    }
  }, [phase, isPinned]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height));

    setCursorPos({ x, y });

    if (isDragging && startPos) {
      setCurrPos({ x, y });
    }
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
    setProcessingStage('ocr');
    setBannerDismissed(false);

    // 阶段化平滑推进: 识别中 -> 翻译中 -> 渲染中
    const timer1 = setTimeout(() => {
      if (mountedRef.current) setProcessingStage('translate');
    }, 120);
    const timer2 = setTimeout(() => {
      if (mountedRef.current) setProcessingStage('render');
    }, 360);

    try {
      // Direct region OCR + sampling + translation (<200ms!)
      let result = await cmdRegionOcrTranslate(
        selection,
        scaleFactor,
        selectedEngine !== 'auto' ? selectedEngine : (settings.defaultPreset || 'blender'),
        settings.llmConfig ?? null,
      );

      clearTimeout(timer1);
      clearTimeout(timer2);
      if (!mountedRef.current) return;

      setProcessingStage('render');

      // 若用户选定了非中文的目标语种，进一步按目标语种渲染
      if (targetLang !== 'zh-CN' && result.blocks.length > 0) {
        const translatedBlocks = await Promise.all(
          result.blocks.map(async (block) => {
            const res = await cmdUniversalTranslate({
              text: block.original,
              sourceLang: 'auto',
              targetLang: targetLang,
              preset: selectedEngine !== 'auto' ? selectedEngine : (settings.defaultPreset || 'blender'),
              llmConfig: settings.llmConfig,
              presetDicts: settings.presetDicts,
              onlineEngines: settings.onlineEngines,
              translationTiers: settings.translationTiers,
            });
            return {
              ...block,
              translated: res.mainTranslation || block.translated,
              sourceTier: res.engines[0]?.sourceTier || block.sourceTier,
            };
          })
        );
        result = { ...result, blocks: translatedBlocks };
      }

      if (result.blocks.length === 0) {
        setEmptyNotice('未在选区内识别到清晰文本，请重新划框框选');
        setTimeout(() => {
          if (mountedRef.current) setEmptyNotice(null);
        }, 2500);
        setPhase('selecting');
        setStartPos(null);
        setCurrPos(null);
        return;
      }

      if (onSendToMainWindow) {
        const combinedText = result.blocks.map((b) => b.original).join('\n');
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
      clearTimeout(timer1);
      clearTimeout(timer2);
      console.error('[CaptureOverlay] Region OCR/translate failed:', err);
      if (mountedRef.current) {
        setPhase('selecting');
        setStartPos(null);
        setCurrPos(null);
      }
    }
  }, [isDragging, startPos, currPos, scaleFactor, selectedEngine, settings, targetLang, onSendToMainWindow]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!isPinned) {
      handleClose();
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

  // 速赢 3: 降级感知检测（用户指定 LLM 但结果为 Fallback / Google / MyMemory / 词库）
  const isLlmEngine = ['deepseek', 'openai', 'ollama', 'custom'].includes(selectedEngine) ||
    (selectedEngine === 'auto' && Boolean(settings.llmConfig?.apiKey));

  let isDowngraded = false;
  let effectiveEngineName = '公共备用通道';

  if (phase === 'overlay' && overlayResult && overlayResult.blocks.length > 0) {
    const primaryTier = overlayResult.blocks[0].sourceTier || '';
    const isLlmSuccess =
      primaryTier.includes('LLM') ||
      primaryTier.includes('DeepSeek') ||
      primaryTier.includes('OpenAI') ||
      primaryTier.includes('Ollama');

    if (isLlmEngine && !isLlmSuccess) {
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
      {/* ── 选区阶段全屏半透明遮罩 + 十字准星与聚光灯 ──────────────────────── */}
      {(phase === 'selecting' || isDragging) && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'rgba(0, 0, 0, 0.38)' }}
        >
          {/* 十字准星参考线 (Crosshair Guidelines) */}
          {cursorPos && !isDragging && (
            <>
              <div
                className="absolute top-0 bottom-0 pointer-events-none border-l border-dashed border-sky-400/35"
                style={{ left: cursorPos.x }}
              />
              <div
                className="absolute left-0 right-0 pointer-events-none border-t border-dashed border-sky-400/35"
                style={{ top: cursorPos.y }}
              />
              <div
                className="absolute pointer-events-none text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-900/90 text-sky-300 border border-sky-400/30 shadow-lg backdrop-blur-md"
                style={{
                  left: Math.min(cursorPos.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 90),
                  top: Math.min(cursorPos.y + 12, (typeof window !== 'undefined' ? window.innerHeight : 1080) - 30),
                }}
              >
                {Math.round(cursorPos.x)}, {Math.round(cursorPos.y)}
              </div>
            </>
          )}

          {/* 选区矩形框与 L 标尺 */}
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
                boxShadow: '0 0 0 1.5px rgba(56,189,248,0.9), 0 0 24px rgba(56,189,248,0.35), inset 0 0 16px rgba(56,189,248,0.12)',
              }}
              className="border border-white/90 bg-sky-500/15 rounded-[2px]"
            >
              {/* 四角 8x8 白色 L 形角标 */}
              <div className="absolute -top-[1px] -left-[1px] w-2.5 h-2.5 border-t-2 border-l-2 border-white pointer-events-none shadow-sm" />
              <div className="absolute -top-[1px] -right-[1px] w-2.5 h-2.5 border-t-2 border-r-2 border-white pointer-events-none shadow-sm" />
              <div className="absolute -bottom-[1px] -left-[1px] w-2.5 h-2.5 border-b-2 border-l-2 border-white pointer-events-none shadow-sm" />
              <div className="absolute -bottom-[1px] -right-[1px] w-2.5 h-2.5 border-b-2 border-r-2 border-white pointer-events-none shadow-sm" />

              {/* 尺寸指示气泡 */}
              <span className="absolute -top-7 left-0 text-[11px] font-mono font-bold bg-gradient-to-r from-sky-600 to-blue-600 text-white px-2 py-0.5 rounded shadow-lg border border-white/30 flex items-center gap-1.5 backdrop-blur-md">
                <span>📐</span>
                <span>{Math.round(selBox.w)} × {Math.round(selBox.h)} px</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 顶部控制条 (AI 模型选择 + 目标语种胶囊 + Pin 锁定) ─────────────────── */}
      {(phase === 'selecting' || phase === 'overlay') && (
        <div className="overlay-toolbar absolute top-6 left-1/2 -translate-x-1/2 z-[220] flex flex-wrap items-center justify-center gap-2.5 pointer-events-auto">
          {/* Guidance Toast */}
          <div className={`flex items-center gap-2 rounded-full px-4 py-1.5 shadow-2xl text-xs border backdrop-blur-md transition-all ${
            isLight
              ? 'bg-white/95 border-slate-300 text-slate-800'
              : 'bg-slate-900/90 border-white/20 text-zinc-100'
          }`}>
            <span className="text-base">🐱</span>
            <span className="font-bold text-sky-500">猫步划词翻译</span>
            <span className={isLight ? 'text-slate-300' : 'text-zinc-500'}>·</span>
            <span className={`font-medium ${isLight ? 'text-slate-700' : 'text-zinc-200'}`}>按住鼠标左键划框</span>
            <span className={isLight ? 'text-slate-300' : 'text-zinc-500'}>·</span>
            <span className={isLight ? 'text-slate-500' : 'text-zinc-400'}>
              {isPinned ? '📌 已锁定' : '右键 / Esc 退出'}
            </span>
          </div>

          {/* AI Model & Engine Switcher Dropdown Pill */}
          <div className="relative">
            <select
              value={selectedEngine}
              onChange={(e) => handleEngineChange(e.target.value)}
              className={`font-mono text-xs font-semibold px-3.5 py-1.5 rounded-full border shadow-2xl outline-none cursor-pointer transition backdrop-blur-md ${
                isLight
                  ? 'bg-white hover:bg-slate-50 text-slate-900 border-slate-300'
                  : 'bg-slate-900/90 hover:bg-slate-950 text-white border-white/30'
              }`}
              title="切换划词翻译 AI 大模型与通道 (快捷键: Tab 循环切换)"
            >
              <optgroup label="── 智能自动降级 ──">
                <option value="auto">🤖 默认多级智能优先级队列 (推荐)</option>
              </optgroup>
              <optgroup label="── 强行指定 AI 大语言模型 ──">
                <option value="deepseek">🧠 DeepSeek (Chat / V3)</option>
                <option value="openai">🧠 OpenAI (GPT-4o)</option>
                <option value="ollama">🦙 Local Ollama (本地大模型)</option>
                <option value="custom">⚡ Custom API (自定义模型)</option>
              </optgroup>
              <optgroup label="── 强行指定免 Key 公共通道 ──">
                <option value="google">🌐 Google 官方翻译 (免 Key)</option>
                <option value="bing">🔷 Bing 必应神经网络翻译</option>
              </optgroup>
              <optgroup label="── 强行指定 3D 离线词库 ──">
                <option value="blender">🧊 Blender CG 专属词库优先</option>
              </optgroup>
            </select>
          </div>

          {/* 目标语种切换胶囊 */}
          <div className={`flex items-center p-0.5 rounded-full border shadow-2xl backdrop-blur-md ${
            isLight ? 'bg-white/95 border-slate-300' : 'bg-slate-900/90 border-white/20'
          }`}>
            {TARGET_LANG_OPTIONS.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => handleLanguageChange(opt.code)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-full transition cursor-pointer ${
                  targetLang === opt.code
                    ? 'bg-sky-500 text-white shadow-sm font-bold'
                    : (isLight ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white')
                }`}
                title={`切换目标语言：${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Pin 锁定按钮 */}
          <button
            type="button"
            onClick={() => {
              setIsPinned((prev) => {
                const next = !prev;
                showFeedback(next ? '📌 已锁定卡片 (防误触退出)' : '🔓 已解除固定');
                return next;
              });
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-2xl transition cursor-pointer backdrop-blur-md ${
              isPinned
                ? 'bg-amber-500 text-white border-amber-400 shadow-amber-500/40 ring-2 ring-amber-400/60 font-bold'
                : (isLight
                    ? 'bg-white/95 border-slate-300 text-slate-700 hover:bg-slate-100'
                    : 'bg-slate-900/90 border-white/20 text-zinc-200 hover:bg-slate-800')
            }`}
            title={isPinned ? '点击或按 Ctrl+P 解除固定' : '点击或按 Ctrl+P 固定卡片（防误触关闭）'}
          >
            <span>📌</span>
            <span>{isPinned ? '已固定 (Ctrl+P)' : '固定 (Ctrl+P)'}</span>
          </button>

          {/* 退出按钮 */}
          {phase === 'overlay' && (
            <button
              type="button"
              onClick={() => handleClose(true)}
              className={`p-1.5 rounded-full border text-xs shadow-2xl transition cursor-pointer backdrop-blur-md ${
                isLight
                  ? 'bg-white/95 border-slate-300 text-slate-600 hover:bg-red-50 hover:text-red-600'
                  : 'bg-slate-900/90 border-white/20 text-zinc-300 hover:bg-red-950/60 hover:text-red-400'
              }`}
              title="退出划词 Overlay (快捷键: Esc / F4)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* ── 降级感知提示 Banner ────────────────────────────────────────────────── */}
      {isDowngraded && !bannerDismissed && (
        <div className="absolute top-18 left-1/2 -translate-x-1/2 z-[230] pointer-events-auto flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 text-amber-200 px-3.5 py-1 rounded-full text-xs shadow-xl backdrop-blur-md animate-fade-in font-medium">
          <span>⚠️ LLM 通道降级，已自动使用 {effectiveEngineName} 翻译</span>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="hover:text-white p-0.5 rounded-full transition ml-1 cursor-pointer"
            title="关闭提示"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── CaptureOverlay 翻译中态文字阶段 ─────────────────────────────────── */}
      {phase === 'processing' && (
        <div className="absolute inset-0 flex items-center justify-center z-[120] pointer-events-none">
          <div className={`flex items-center gap-3 border rounded-2xl px-7 py-4 shadow-2xl backdrop-blur-md ${
            isLight
              ? 'bg-white/95 border-blue-400 text-slate-900 shadow-blue-500/10'
              : 'bg-slate-900/95 border-sky-400/40 text-white shadow-sky-500/20'
          }`}>
            <svg className="animate-spin h-5 w-5 text-sky-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <div className="flex items-center gap-2 font-semibold text-sm">
              <span>🐱 正在提取与翻译…</span>
              <span className="text-xs opacity-80 font-mono">
                ({processingStage === 'ocr'
                  ? '识别中...'
                  : processingStage === 'translate'
                  ? '翻译中...'
                  : '渲染中...'})
              </span>
            </div>
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

      {/* ── Feedback Toast (Copy / Pin / Voice actions) ────────────────────────── */}
      {feedbackToast && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[250] pointer-events-none animate-bounce">
          <div className="flex items-center gap-2 bg-slate-900/95 border border-sky-400/50 rounded-full px-4 py-1.5 shadow-2xl text-xs font-semibold text-sky-200 backdrop-blur-md">
            <span>{feedbackToast}</span>
          </div>
        </div>
      )}

      {/* ── In-place translated text blocks ───────────────────────────────────── */}
      {phase === 'overlay' && overlayResult && overlayResult.blocks.map((block, i) => (
        <OverlayBlockCard
          key={i}
          block={block}
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
            navigator.clipboard.writeText(text);
            showFeedback(`📋 已复制: "${text}"`);
          }}
        />
      ))}
    </div>
  );
};

// ── OverlayBlockCard: a single translated text block rendered in-place ─────────
interface OverlayBlockCardProps {
  block: OverlayBlock;
  onClose: (force?: boolean) => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onCopySingle?: (text: string) => void;
}

const OverlayBlockCard: React.FC<OverlayBlockCardProps> = ({
  block,
  onClose,
  isPinned,
  onTogglePin,
  onCopySingle,
}) => {
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ mx: 0, my: 0, ox: 0, oy: 0 });
  const [pos, setPos] = useState({ x: block.logicalX, y: block.logicalY });
  const [isCopied, setIsCopied] = useState(false);

  // 动态字号与多行自适应计算
  const charCount = Math.max(block.translated.length, 1);
  const computedW = Math.max(block.logicalW + 6, 36);
  const fontSize = Math.max(
    10,
    Math.min(
      block.logicalH * 0.68,
      (computedW / charCount) * 1.55,
      22
    )
  );

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button === 2) {
      if (!isPinned) {
        onClose();
      }
      return;
    }
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

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCopySingle) {
      onCopySingle(block.translated);
    } else {
      navigator.clipboard.writeText(block.translated);
    }
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1800);
  };

  const handleSpeech = (e: React.MouseEvent) => {
    e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(block.original);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  };

  return (
    <div
      className="overlay-block group absolute flex items-center justify-center rounded-[3px] transition-shadow duration-150"
      style={{
        left: pos.x - 3,
        top: pos.y - 2,
        width: computedW,
        height: Math.max(block.logicalH + 4, 18),
        background: block.bgCss,
        color: block.fgCss,
        fontSize: `${fontSize}px`,
        fontFamily: '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
        fontWeight: 600,
        lineHeight: 1.15,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        zIndex: isPinned ? 210 : 200,
        boxShadow: isPinned
          ? '0 0 0 2px rgba(245, 158, 11, 0.85), 0 6px 18px rgba(245, 158, 11, 0.35)'
          : dragging
          ? '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(56,189,248,0.7)'
          : '0 2px 10px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.12)',
        whiteSpace: 'nowrap',
        overflow: 'visible',
        padding: '1px 5px',
      }}
      title={`${block.original} → ${block.translated} [${block.sourceTier}]`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isPinned) {
          onClose();
        }
      }}
    >
      <span className="truncate">{block.translated}</span>

      {/* 📌 Pin indicator / toggle button on card top-right (速赢 5) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        className={`absolute -top-2.5 -right-2.5 z-30 flex items-center justify-center w-5 h-5 rounded-full text-[10px] shadow transition cursor-pointer ${
          isPinned
            ? 'bg-amber-500 text-white scale-100 opacity-100 ring-2 ring-white/60 shadow-amber-500/50'
            : 'bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 opacity-0 group-hover:opacity-100 hover:scale-110'
        }`}
        title={isPinned ? '已固定（点击或按 Ctrl+P 解除）' : '固定此卡片（防误触关闭，快捷键 Ctrl+P）'}
      >
        📌
      </button>

      {/* 悬停微型操作工具栏 (复制 / 朗读 / 词库小标) */}
      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-slate-950/90 border border-white/20 rounded-full px-2 py-0.5 shadow-xl text-[10px] text-zinc-300 pointer-events-auto backdrop-blur-md">
        <button
          type="button"
          onClick={handleCopy}
          className="hover:text-sky-300 p-0.5 transition cursor-pointer"
          title="复制此条译文"
        >
          {isCopied ? '✓' : '📋'}
        </button>
        <button
          type="button"
          onClick={handleSpeech}
          className="hover:text-sky-300 p-0.5 transition cursor-pointer"
          title="朗读英文发音 (Space)"
        >
          🔊
        </button>
        <span className="text-[9px] font-mono text-zinc-400 opacity-80 border-l border-white/20 pl-1">
          {block.sourceTier || '词库'}
        </span>
      </div>
    </div>
  );
};
