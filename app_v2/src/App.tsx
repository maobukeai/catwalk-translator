import { useEffect, useRef, useState, useCallback } from "react";
import { TitleBar } from "./components/TitleBar";
import { Dock, type AppTab } from "./components/Dock";
import { SettingsDashboard } from "./components/Settings/SettingsDashboard";
import { DualPaneTranslator } from "./components/MainWindow/DualPaneTranslator";
import { AboutPanel } from "./components/MainWindow/AboutPanel";
import { SearchPanel } from "./components/MainWindow/SearchPanel";
import { AiChatPanel } from "./components/MainWindow/AiChatPanel";
import { HistoryPanel } from "./components/Vocabulary/HistoryPanel";
import { CaptureOverlay } from "./components/Overlay/CaptureOverlay";
import { CheatSheetModal } from "./components/Overlay/CheatSheetModal";
import { SpotlightModal } from "./components/SpotlightModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { OcrModelGuideModal } from "./components/OcrModelGuideModal";
import { ClipboardToast, type ClipboardPayload } from "./components/ClipboardToast";
import { CloseConfirmModal } from "./components/CloseConfirmModal";
import { isTauri, cmdQueryText, cmdSetWindowBlur, cmdExitApp, cmdGetAutoStart, cmdSetAutoStart } from "./services/tauri";
import { matchesHotkey } from "./services/hotkeys";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useAppTheme } from "./hooks/useAppTheme";
import { Camera } from "lucide-react";

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("translate");
  const [triggerToast, setTriggerToast] = useState<string | null>(null);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);
  // 首次使用引导:localStorage 记忆只展示一次;设置页可发 open-onboarding 重看
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("catwalk_onboarding_v1")) setIsOnboardingOpen(true);
    } catch {
      /* localStorage 不可用则不展示 */
    }
    const reopen = () => setIsOnboardingOpen(true);
    window.addEventListener("open-onboarding", reopen);
    return () => window.removeEventListener("open-onboarding", reopen);
  }, []);

  // 首次运行 / 安装后默认开启开机自启
  useEffect(() => {
    try {
      const KEY = "catwalk_autostart_default_init_v1";
      if (!localStorage.getItem(KEY)) {
        localStorage.setItem(KEY, "true");
        cmdGetAutoStart()
          .then((enabled) => {
            if (!enabled) {
              void cmdSetAutoStart(true);
            }
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, []);

  const closeOnboarding = () => {
    try {
      localStorage.setItem("catwalk_onboarding_v1", "1");
    } catch {
      /* 忽略写入失败 */
    }
    setIsOnboardingOpen(false);
  };
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  // OCR 模型引导弹窗 → 设置页跳转目标（切到「专业词库」页并定位到模型卡片）
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<'appearance' | 'hotkey' | 'online' | 'dicts' | 'preference' | 'backup' | undefined>(undefined);
  const [settingsFocusOcr, setSettingsFocusOcr] = useState(false);
  const goDownloadOcrModels = () => {
    setSettingsInitialCategory('dicts');
    setSettingsFocusOcr(true);
    setActiveTab('settings');
  };
  const [clipboardPayload, setClipboardPayload] = useState<ClipboardPayload | null>(null);
  // seq 保证从划词 overlay 二次发送「相同文本」时也能强制重挂载 DualPaneTranslator
  const [transferred, setTransferred] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  const [openInHoverMode, setOpenInHoverMode] = useState(false);
  const { settings, fetchSettings, setClipboardWatchEnabled } = useSettingsStore();
  const { isLight } = useAppTheme();

  // CaptureOverlay owns F4 / Esc / capture-hotkey while it is open (pin-aware);
  // this ref keeps the App-level fallback listener out of its way.
  const isOverlayOpenRef = useRef(false);
  isOverlayOpenRef.current = isOverlayOpen;

  useEffect(() => {
    fetchSettings();
    if (isTauri()) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win.show().catch(() => {});
        win.unminimize().catch(() => {});
        win.setFocus().catch(() => {});
      }).catch(() => {});
    }
  }, [fetchSettings]);

  // Debounce refs to prevent double-execution from safe wake-up event emissions
  const lastCaptureTimeRef = useRef(0);
  const lastSpotlightTimeRef = useRef(0);
  const lastClipboardTimeRef = useRef(0);
  const lastHoverTimeRef = useRef(0);

  // Handle instant clipboard translation
  // seq 序号防止并发触发时慢的旧请求后到覆盖新结果
  const clipboardReqSeqRef = useRef(0);
  const handleTriggerClipboard = useCallback(async () => {
    const seq = ++clipboardReqSeqRef.current;
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const curSettings = useSettingsStore.getState().settings;
        const res = await cmdQueryText(text.trim(), curSettings.defaultPreset, curSettings.llmConfig);
        if (seq !== clipboardReqSeqRef.current) return;
        if (res.results && res.results.length > 0) {
          const top = res.results[0];
          setClipboardPayload({
            id: `clip_${Date.now()}`,
            original: res.original,
            translated: top.translated,
            sourceTier: top.sourceTier,
          });
        }
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  }, []);

  const triggerCapture = useCallback(() => {
    const now = Date.now();
    if (now - lastCaptureTimeRef.current < 250) return;
    lastCaptureTimeRef.current = now;
    const timeStr = new Date().toLocaleTimeString();
    setTriggerToast(`全局划词选区已启动 [${timeStr}]`);
    setOpenInHoverMode(false);
    setIsOverlayOpen(true);
    setTimeout(() => setTriggerToast(null), 3000);
  }, []);

  const triggerSpotlight = useCallback(() => {
    const now = Date.now();
    if (now - lastSpotlightTimeRef.current < 250) return;
    lastSpotlightTimeRef.current = now;
    setIsSpotlightOpen((prev) => !prev);
  }, []);

  const triggerClipboard = useCallback(() => {
    const now = Date.now();
    if (now - lastClipboardTimeRef.current < 250) return;
    lastClipboardTimeRef.current = now;
    void handleTriggerClipboard();
  }, [handleTriggerClipboard]);

  const triggerHover = useCallback(() => {
    const now = Date.now();
    if (now - lastHoverTimeRef.current < 250) return;
    lastHoverTimeRef.current = now;
    setIsOverlayOpen((prev) => {
      if (prev) return prev;
      setOpenInHoverMode(true);
      return true;
    });
  }, []);

  const handleRequestClose = useCallback(async () => {
    const curCloseAction = useSettingsStore.getState().settings.closeAction || 'ask';
    if (curCloseAction === 'exit') {
      if (isTauri()) {
        try {
          await cmdExitApp();
        } catch {
          import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close().catch(() => {}));
        }
      }
    } else if (curCloseAction === 'minimize') {
      if (isTauri()) {
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().hide().catch(() => {}));
      }
    } else {
      setIsCloseConfirmOpen(true);
    }
  }, []);

  // Browser-level hotkey listener fallback (matches exact configured hotkey strings)
  // 依赖数组只登记 handler 实际读取的快捷键标量，避免 settings 任意字段
  // 变化（如拖动模糊滑杆）都重挂 window 级监听器。
  const captureHotkeyEnabled = settings.captureHotkeyEnabled ?? settings.hotkeyEnabled ?? true;
  const captureHotkey = settings.hotkey || 'F4';
  const spotlightHotkeyEnabled = settings.spotlightHotkeyEnabled ?? false;
  const spotlightHotkey = settings.spotlightHotkey || 'Alt+Space';
  const clipboardHotkeyEnabled = settings.clipboardHotkeyEnabled ?? false;
  const clipboardHotkey = settings.clipboardHotkey || 'Ctrl+Shift+C';

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // While the capture overlay is open it handles every key itself
      // (F4 / Esc / capture hotkey are pin-aware there) — do not double-handle.
      if (isOverlayOpenRef.current) return;

      // ? / F1 唤出快捷键速查表（输入控件聚焦时让位给文本输入）
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if ((e.key === '?' || e.key === 'F1') && !typing && !isCheatSheetOpen) {
        e.preventDefault();
        setIsCheatSheetOpen(true);
        return;
      }

      // Capture Overlay hotkey (F4 or configured hotkey)
      if (captureHotkeyEnabled && (matchesHotkey(e, captureHotkey) || e.key === 'F4')) {
        e.preventDefault();
        setIsOverlayOpen((prev) => !prev);
        return;
      }

      // Spotlight hotkey
      if (spotlightHotkeyEnabled && matchesHotkey(e, spotlightHotkey)) {
        e.preventDefault();
        setIsSpotlightOpen((prev) => !prev);
        return;
      }

      // Clipboard hotkey（走 triggerClipboard 的 250ms 防抖，避免连按并发）
      if (clipboardHotkeyEnabled && matchesHotkey(e, clipboardHotkey)) {
        e.preventDefault();
        triggerClipboard();
        return;
      }

      // Hover-lookup hotkey (fixed Ctrl+Alt+H, browser/dev fallback parity)
      if (matchesHotkey(e, 'Ctrl+Alt+H')) {
        e.preventDefault();
        if (isOverlayOpenRef.current) return;
        setOpenInHoverMode(true);
        setIsOverlayOpen(true);
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [captureHotkeyEnabled, captureHotkey, spotlightHotkeyEnabled, spotlightHotkey, clipboardHotkeyEnabled, clipboardHotkey, isCheatSheetOpen, triggerClipboard]);

  // OS-level Tauri global shortcut and DOM CustomEvent listeners (dual insurance for wakeup from tray/sleep)
  useEffect(() => {
    // 1. Direct DOM event listeners (fired directly from Rust window.eval for instant unthrottled dispatch)
    const onDomCapture = () => triggerCapture();
    const onDomSpotlight = () => triggerSpotlight();
    const onDomClipboard = () => triggerClipboard();
    const onDomHover = () => triggerHover();

    window.addEventListener('trigger-capture', onDomCapture);
    window.addEventListener('trigger-spotlight', onDomSpotlight);
    window.addEventListener('trigger-clipboard', onDomClipboard);
    window.addEventListener('trigger-hover', onDomHover);

    // 2. Tauri event listeners
    // listen() 异步 resolve；若 effect 在 resolve 前被清理（StrictMode 双挂载必现），
    // 迟到的 unlisten 必须立即执行，否则监听器残留导致热键双触发。
    let disposed = false;
    const unlistens: (() => void)[] = [];
    const trackUnlisten = (u: () => void) => {
      if (disposed) {
        u();
      } else {
        unlistens.push(u);
      }
    };
    if (isTauri()) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('trigger-capture', () => triggerCapture()).then(trackUnlisten);
        listen('trigger-spotlight', () => triggerSpotlight()).then(trackUnlisten);
        listen('trigger-clipboard', () => triggerClipboard()).then(trackUnlisten);
        listen('trigger-hover', () => triggerHover()).then(trackUnlisten);

        // Passive clipboard watch: Rust translated a freshly copied text.
        // Suppressed while the capture overlay is open (its own copy actions
        // would otherwise bounce straight back as toasts).
        listen<{ original: string; translated: string; sourceTier: string }>('clipboard-watched', (event) => {
          if (isOverlayOpenRef.current) return;
          const p = event.payload;
          if (!p || !p.translated) return;
          setClipboardPayload({
            id: `clip_watch_${Date.now()}`,
            original: p.original,
            translated: p.translated,
            sourceTier: p.sourceTier,
            fromWatch: true,
          });
        }).then(trackUnlisten);
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener('trigger-capture', onDomCapture);
      window.removeEventListener('trigger-spotlight', onDomSpotlight);
      window.removeEventListener('trigger-clipboard', onDomClipboard);
      window.removeEventListener('trigger-hover', onDomHover);
      unlistens.forEach((u) => u());
    };
  }, [triggerCapture, triggerSpotlight, triggerClipboard, triggerHover]);

  const appearance = settings.appearance || {
    theme: 'system',
    enableBlur: true,
    blurAmount: 24,
    enableTransparency: true,
    windowOpacity: 85,
    fontFamily: 'system',
    fontSize: 'medium',
  };

  const activeTheme = appearance.theme || 'system';

  const blurEnabled = appearance.enableBlur ?? true;
  const blurPx = appearance.blurAmount ?? 24;
  // 磨砂开关是玻璃/纯色的唯一裁决：用户开启磨砂时任何主题都渲染玻璃层，
  // 主题（system/dark/light）只决定配色，不再强制纯色。
  const isSolid = !blurEnabled || blurPx === 0;

  useEffect(() => {
    if (!isOverlayOpen) {
      void cmdSetWindowBlur(blurEnabled, !isLight);
    }
  }, [blurEnabled, isLight, isOverlayOpen]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--glass-blur', `${blurPx}px`);
    }
  }, [blurPx]);

  const blurFilterVal = blurEnabled && blurPx > 0
    ? `blur(${blurPx}px) saturate(185%) contrast(105%) brightness(104%)`
    : 'none';

  // Dynamic style calculation for realistic Apple Frosted Glass / Solid Dark / Light
  const dynamicBgStyle: React.CSSProperties = isOverlayOpen
    ? {
        backgroundColor: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        boxShadow: 'none',
      }
    : {
        backgroundColor: isSolid
          ? (isLight ? '#f8fafc' : '#0f1015')
          : (isLight
              ? `rgba(255, 255, 255, ${(0.12 + (Math.min(Math.max(blurPx, 0), 60) / 60) * 0.10).toFixed(3)})`
              : `rgba(15, 18, 26, ${(0.15 + (Math.min(Math.max(blurPx, 0), 60) / 60) * 0.13).toFixed(3)})`),
        backdropFilter: blurFilterVal,
        WebkitBackdropFilter: blurFilterVal,
        boxShadow: isSolid
          ? 'none'
          : (isLight
              ? '0 20px 50px rgba(15, 23, 42, 0.08)'
              : '0 24px 60px rgba(0, 0, 0, 0.35)'),
      };

  const textColorClass = isLight ? 'text-slate-800' : 'text-zinc-100';
  const fontClass = `font-${appearance.fontFamily || 'system'}`;
  const fontSizeClass = `font-scale-${appearance.fontSize || 'medium'}`;

  // Blur amount as a CSS variable so every glass surface (titlebar, dock,
  // panels, cards, inputs) follows the user's slider — not just the backdrop.
  const glassVars = { '--glass-blur': `${blurPx}px` } as React.CSSProperties;
  const glassRootStyle = { ...dynamicBgStyle, ...glassVars };

  return (
    <div className="relative h-screen overflow-hidden">
      {/* Aurora Backdrop — ultra-subtle ambient glow behind the glass that preserves true DWM desktop Acrylic penetration.
          Hidden while overlay is open or in solid mode (invisible + saves GPU).
          Lightweight ambient glow (opacity 0.15) ensures external desktop/wallpaper shows through cleanly. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ willChange: 'transform' }}>
        <div
          className={`absolute inset-0 transition-opacity duration-500 aurora-field ${isOverlayOpen || isSolid ? 'opacity-0' : 'opacity-[0.15]'}`}
          style={{
            filter: `blur(${blurPx * 1.5}px) saturate(1.1)`,
            transform: 'scale(1.04)',
            transitionProperty: 'opacity',
            transitionDuration: '500ms',
            transitionTimingFunction: 'ease',
          }}
        >
          {/* 轻盈微弱的环境辉光（低不透明度，不遮挡底层 Windows DWM 硬件级磨砂与桌面内容） */}
          <div
            className="absolute -top-24 -left-20 h-[32rem] w-[32rem] rounded-full aurora-blob pointer-events-none"
            style={{
              background: isLight
                ? 'radial-gradient(circle, rgba(186,230,253,0.30) 0%, rgba(224,242,254,0.12) 45%, transparent 70%)'
                : 'radial-gradient(circle, rgba(255,255,255,0.02) 0%, rgba(148,163,184,0.01) 45%, transparent 70%)',
              animation: 'aurora-drift 24s ease-in-out infinite alternate',
            }}
          />
          <div
            className="absolute top-1/3 -right-16 h-[28rem] w-[28rem] rounded-full aurora-blob pointer-events-none"
            style={{
              background: isLight
                ? 'radial-gradient(circle, rgba(233,213,255,0.25) 0%, rgba(243,232,255,0.10) 45%, transparent 70%)'
                : 'radial-gradient(circle, rgba(255,255,255,0.015) 0%, rgba(100,116,139,0.01) 45%, transparent 70%)',
              animation: 'aurora-drift 28s ease-in-out infinite alternate-reverse',
            }}
          />
          <div
            className="absolute -bottom-20 left-1/4 h-[30rem] w-[30rem] rounded-full aurora-blob pointer-events-none"
            style={{
              background: isLight
                ? 'radial-gradient(circle, rgba(254,240,138,0.20) 0%, rgba(254,249,195,0.08) 45%, transparent 70%)'
                : 'radial-gradient(circle, rgba(255,255,255,0.018) 0%, rgba(148,163,184,0.01) 45%, transparent 70%)',
              animation: 'aurora-drift 32s ease-in-out infinite alternate',
            }}
          />
        </div>

        {/* 物理级喷砂微磨砂颗粒光栅层 (Physical Sandblasted Frosted Glass Texture) */}
        <div
          className={`absolute inset-0 transition-opacity duration-500 pointer-events-none ${isOverlayOpen || isSolid ? 'opacity-0' : 'opacity-40'}`}
          style={{
            filter: `blur(${(blurPx * 0.35).toFixed(1)}px)`,
            backgroundImage: isLight
              ? 'radial-gradient(rgba(100, 116, 139, 0.08) 1px, transparent 1.2px)'
              : 'radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1.2px)',
            backgroundSize: '10px 10px',
          }}
        />
        <div
          className={`absolute inset-0 transition-opacity duration-500 pointer-events-none ${isOverlayOpen || isSolid ? 'opacity-0' : 'opacity-30'}`}
          style={{
            filter: `blur(${(blurPx * 0.25).toFixed(1)}px)`,
            backgroundImage: isLight
              ? 'radial-gradient(rgba(148, 163, 184, 0.06) 1.2px, transparent 1.8px)'
              : 'radial-gradient(rgba(255, 255, 255, 0.10) 1.2px, transparent 1.8px)',
            backgroundSize: '22px 22px',
            backgroundPosition: '7px 9px',
          }}
        />
      </div>

    <div
      style={glassRootStyle}
      className={`relative z-10 flex flex-col h-screen antialiased selection:bg-[var(--accent)] selection:text-white overflow-hidden ${fontClass} ${fontSizeClass} ${textColorClass} ${isOverlayOpen ? 'bg-transparent' : (!isSolid ? (isLight ? 'border border-slate-200/60' : 'border border-white/[0.10]') : '')}`}
    >
      {/* Real Frosted Glass Grain & Specular Top Reflection Layer */}
      {blurEnabled && !isSolid && !isOverlayOpen && (
        <>
          {/* Frosted Micro-Grain Texture Overlay */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.1)_1px,transparent_1px)] [background-size:8px_8px] opacity-25 mix-blend-overlay z-[1]" />
          {/* Physical Noise Texture (SVG feTurbulence) */}
          <div className="glass-noise-tex pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-soft-light z-[1]" />
        </>
      )}

      {/* Only show app chrome when overlay is NOT open */}
      {!isOverlayOpen && (
        <>
          <TitleBar
            onTriggerCapture={() => setIsOverlayOpen(true)}
            hotkey={settings.hotkey || "F4"}
            onQuickSearch={() => setIsSpotlightOpen((v) => !v)}
            onOpenAbout={() => setActiveTab("about")}
            onRequestClose={handleRequestClose}
          />

          {/* Global Hotkey Trigger Toast */}
          {triggerToast && (
            <div className="fixed top-12 left-1/2 z-[90] flex items-center space-x-2.5 rounded-full px-5 py-2 text-sm font-semibold shadow-xl shadow-black/15 border animate-fade-in lg-panel"
              style={{ background: 'var(--g-surface-solid)', color: 'var(--g-text-1)' }}>
              <Camera className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
              <span>{triggerToast}</span>
            </div>
          )}

          {/* 主内容区：悬浮玻璃卡岛（全宽居中，底部为 Dock 让位） */}
          <main className="relative flex-1 min-w-0 overflow-y-auto scrollbar-thin px-6 pt-2 pb-[86px]">
            <div key={activeTab} className="page-in mx-auto h-full max-w-5xl">
              {activeTab === "translate" && (
                <DualPaneTranslator
                  key={`transfer_${transferred.seq}`}
                  settings={settings}
                  initialText={transferred.text}
                  onOpenSettings={() => setActiveTab("settings")}
                />
              )}
              {activeTab === "ai" && <AiChatPanel onOpenSettings={() => setActiveTab("settings")} />}
              {activeTab === "vocabulary" && <HistoryPanel />}
              {activeTab === "search" && <SearchPanel settings={settings} />}
              {activeTab === "about" && (
                <AboutPanel onOpenSettings={() => setActiveTab("settings")} />
              )}
              {activeTab === "settings" && (
                <SettingsDashboard
                  initialCategory={settingsInitialCategory}
                  focusOcrModels={settingsFocusOcr}
                  onInitialApplied={() => {
                    setSettingsInitialCategory(undefined);
                    setSettingsFocusOcr(false);
                  }}
                  onStartCapture={() => setIsOverlayOpen(true)}
                  onTriggerSpotlight={() => setIsSpotlightOpen(true)}
                  onTriggerClipboard={handleTriggerClipboard}
                  onOpenAbout={() => setActiveTab("about")}
                  onToggleWindow={() => {
                    setTriggerToast("主程序显隐逻辑联动运行中 (可按下录制的热键随时切换！)");
                    setTimeout(() => setTriggerToast(null), 3000);
                  }}
                />
              )}
            </div>
          </main>

          {/* 底部悬浮 macOS Dock */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center">
            <div className="pointer-events-auto">
              <Dock
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onTriggerCapture={() => setIsOverlayOpen(true)}
                onTriggerClipboard={handleTriggerClipboard}
                onTriggerSpotlight={() => setIsSpotlightOpen(true)}
                onOpenCheatSheet={() => setIsCheatSheetOpen(true)}
                hotkey={settings.hotkey || "F4"}
              />
            </div>
          </div>
        </>
      )}

      {/* Screen Selection & Translation Overlay — renders full-screen when open */}
      <CaptureOverlay
        isOpen={isOverlayOpen}
        openInHoverMode={openInHoverMode}
        onClose={() => {
          setIsOverlayOpen(false);
          setOpenInHoverMode(false);
        }}
        onSendToMainWindow={(text) => {
          setTransferred((t) => ({ text, seq: t.seq + 1 }));
          setActiveTab("translate");
        }}
      />

      {/* 首次使用引导 */}
      <OnboardingModal isOpen={isOnboardingOpen} onClose={closeOnboarding} />

      {/* 离线 OCR 模型未安装时的新手引导（自动探测，可「去下载」直达设置页） */}
      <OcrModelGuideModal onGoDownload={goDownloadOcrModels} />

      {/* Spotlight Instant Search Float Window */}
      <SpotlightModal
        isOpen={isSpotlightOpen}
        onClose={() => setIsSpotlightOpen(false)}
        settings={settings}
      />

      {/* 全局快捷键速查表（? / F1 唤出） */}
      <CheatSheetModal
        isOpen={isCheatSheetOpen}
        onClose={() => setIsCheatSheetOpen(false)}
      />

      {/* Clipboard Instant Translate Toast */}
      <ClipboardToast
        payload={clipboardPayload}
        onClose={() => setClipboardPayload(null)}
        onDisableWatch={() => setClipboardWatchEnabled(false)}
      />

      {/* 关闭窗口行为确认弹窗 */}
      <CloseConfirmModal
        isOpen={isCloseConfirmOpen}
        onClose={() => setIsCloseConfirmOpen(false)}
      />
    </div>
    </div>
  );
}

export default App;
