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
import { UpdateModal } from "./components/UpdateModal";
import { isTauri, cmdQueryText, cmdSetWindowBlur, cmdExitApp, cmdGetAutoStart, cmdSetAutoStart, cmdOpenQuickWindow, cmdCheckAppUpdate } from "./services/tauri";
import type { UpdateInfo } from "./services/types";
import { matchesHotkey } from "./services/hotkeys";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useAppTheme } from "./hooks/useAppTheme";
import { Camera } from "lucide-react";

const TAB_ORDER: Record<AppTab, number> = {
  translate: 0,
  search: 1,
  ai: 2,
  vocabulary: 3,
  settings: 4,
  about: 5,
};

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("translate");
  const [navDirection, setNavDirection] = useState<"none" | "right" | "left">("none");
  const activeTabRef = useRef<AppTab>("translate");
  activeTabRef.current = activeTab;

  const handleTabChange = useCallback((nextTab: AppTab) => {
    const prevTab = activeTabRef.current;
    if (prevTab === nextTab) return;
    setNavDirection(TAB_ORDER[nextTab] >= TAB_ORDER[prevTab] ? "right" : "left");
    setActiveTab(nextTab);
  }, []);

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
    handleTabChange('settings');
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

  const [isMaximized, setIsMaximized] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    fetchSettings();
    if (isTauri()) {
      let unlistenResize: (() => void) | undefined;
      let disposed = false;
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win.isMaximized().then((max) => { if (!disposed) setIsMaximized(max); }).catch(() => {});
      }).catch(() => {});

      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('tauri://resize', async () => {
          try {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const max = await getCurrentWindow().isMaximized();
            if (!disposed) setIsMaximized(max);
          } catch {}
        }).then((u) => {
          if (disposed) u(); else unlistenResize = u;
        });
      }).catch(() => {});

      return () => {
        disposed = true;
        if (unlistenResize) unlistenResize();
      };
    }
  }, [fetchSettings]);

  useEffect(() => {
    // 启动时延迟 3 秒静默探测新版本（避开冷启动 I/O 竞争高峰）
    const timer = setTimeout(async () => {
      const curSettings = useSettingsStore.getState().settings;
      if (curSettings.autoCheckUpdate !== false) {
        try {
          const res = await cmdCheckAppUpdate();
          if (res.has_update && res.latest) {
            setPendingUpdate(res.latest);
            setUpdateModalOpen(true);
          }
        } catch (err) {
          console.log('[AutoUpdater] Startup check skipped/failed:', err);
        }
      }
    }, 3000);

    const handleOpenUpdate = (e: CustomEvent<UpdateInfo>) => {
      if (e.detail) {
        setPendingUpdate(e.detail);
      }
      setUpdateModalOpen(true);
    };
    window.addEventListener('open-update-modal' as any, handleOpenUpdate);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('open-update-modal' as any, handleOpenUpdate);
    };
  }, []);

  const isFloatingWindow = !isOverlayOpen && !isMaximized;

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

  const handleRequestClose = useCallback(() => {
    const curCloseAction = useSettingsStore.getState().settings.closeAction;
    if (curCloseAction === 'exit') {
      if (isTauri()) {
        try {
          cmdExitApp();
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

  const handleOpenQuickWindow = useCallback(async () => {
    if (isTauri()) {
      await cmdOpenQuickWindow();
    } else {
      setTriggerToast("快捷查词小窗 (仅在桌面端独立运行)");
      setTimeout(() => setTriggerToast(null), 2000);
    }
  }, []);

  // Browser-level hotkey listener fallback (matches exact configured hotkey strings)
  // 依赖数组只登记 handler 实际读取的快捷键标量，避免 settings 任意字段
  // 变化（如拖动模糊滑杆）都重挂 window 级监听器。
  const captureHotkeyEnabled = settings.captureHotkeyEnabled ?? true;
  const captureHotkey = settings.hotkey || 'F4';
  const spotlightHotkeyEnabled = settings.spotlightHotkeyEnabled ?? false;
  const spotlightHotkey = settings.spotlightHotkey || 'Alt+Space';
  const clipboardHotkeyEnabled = settings.clipboardHotkeyEnabled ?? false;
  const clipboardHotkey = settings.clipboardHotkey || 'Ctrl+Shift+C';
  const quickWindowHotkeyEnabled = settings.quickWindowHotkeyEnabled ?? false;
  const quickWindowHotkey = settings.quickWindowHotkey || 'Alt+W';

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

      // Quick Window hotkey (browser/dev fallback parity when not in Tauri)
      if (!isTauri() && quickWindowHotkeyEnabled && matchesHotkey(e, quickWindowHotkey)) {
        e.preventDefault();
        void cmdOpenQuickWindow();
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
  }, [captureHotkeyEnabled, captureHotkey, spotlightHotkeyEnabled, spotlightHotkey, clipboardHotkeyEnabled, clipboardHotkey, quickWindowHotkeyEnabled, quickWindowHotkey, isCheatSheetOpen, triggerClipboard]);

  // OS-level Tauri global shortcut and DOM CustomEvent listeners (dual insurance for wakeup from tray/sleep)
  useEffect(() => {
    // 1. Direct DOM event listeners (fired directly from Rust window.eval for instant unthrottled dispatch)
    const onDomCapture = () => triggerCapture();
    const onDomSpotlight = () => triggerSpotlight();
    const onDomClipboard = () => triggerClipboard();
    const onDomHover = () => triggerHover();
    const onDomQuickWindow = () => void cmdOpenQuickWindow();

    window.addEventListener('trigger-capture', onDomCapture);
    window.addEventListener('trigger-spotlight', onDomSpotlight);
    window.addEventListener('trigger-clipboard', onDomClipboard);
    window.addEventListener('trigger-hover', onDomHover);
    window.addEventListener('trigger-quick-window', onDomQuickWindow);

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
        listen('trigger-quick-window', () => void cmdOpenQuickWindow()).then(trackUnlisten);

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
      window.removeEventListener('trigger-quick-window', onDomQuickWindow);
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
  const blurPx = Math.max(0, Math.min(40, appearance.blurAmount ?? 24));
  // 磨砂开关关闭才切为不透明纯色；开启磨砂但滑到 0px 时为「清晰透视」半透明态
  const isSolid = !blurEnabled;
  const isClearGlass = blurEnabled && blurPx === 0;
  const dwmBlurActive = blurEnabled && blurPx > 0;
  const frostRatio = blurEnabled ? blurPx / 40 : 0;
  const glassState: 'off' | 'clear' | 'frosted' = isSolid ? 'off' : isClearGlass ? 'clear' : 'frosted';

  useEffect(() => {
    if (!isOverlayOpen) {
      void cmdSetWindowBlur(dwmBlurActive, !isLight);
    }
  }, [dwmBlurActive, isLight, isOverlayOpen]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--glass-blur', `${blurEnabled ? blurPx : 0}px`);
      document.documentElement.style.setProperty('--glass-frost-ratio', frostRatio.toFixed(3));
      document.documentElement.dataset.glass = glassState;
    }
  }, [blurEnabled, blurPx, frostRatio, glassState]);

  const blurFilterVal = dwmBlurActive
    ? `blur(${blurPx}px) saturate(${Math.round(145 + frostRatio * 55)}%) contrast(${Math.round(102 + frostRatio * 4)}%)`
    : 'none';

  // Dynamic style calculation for realistic Frosted Glass / Clear Translucency / Solid
  // 底色透明度随 0~40px 连续变化，避免遮盖 Windows DWM 亚克力或使浅色页变成死白纸
  const windowBgColor = isSolid
    ? (isLight ? '#f8fafc' : '#0f1015')
    : isClearGlass
    ? (isLight ? 'rgba(255, 255, 255, 0.22)' : 'rgba(15, 20, 34, 0.24)')
    : (isLight
        ? `rgba(255, 255, 255, ${(0.22 + frostRatio * 0.44).toFixed(3)})`
        : `rgba(15, 20, 34, ${(0.26 + frostRatio * 0.46).toFixed(3)})`);

  const dynamicBgStyle: React.CSSProperties = isOverlayOpen
    ? {
        backgroundColor: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        boxShadow: 'none',
      }
    : {
        backgroundColor: windowBgColor,
        backdropFilter: blurFilterVal,
        WebkitBackdropFilter: blurFilterVal,
        boxShadow: isFloatingWindow && !isOverlayOpen
          ? (isLight
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.85)'
              : 'inset 0 1px 0 rgba(255, 255, 255, 0.24)')
          : 'none',
      };

  const textColorClass = isLight ? 'text-slate-800' : 'text-zinc-100';
  const fontClass = `font-${appearance.fontFamily || 'system'}`;
  const fontSizeClass = `font-scale-${appearance.fontSize || 'medium'}`;

  // Blur amount as a CSS variable so every glass surface (titlebar, dock,
  // panels, cards, inputs) follows the user's slider — not just the backdrop.
  const glassVars = {
    '--glass-blur': `${blurEnabled ? blurPx : 0}px`,
    '--glass-frost-ratio': frostRatio.toFixed(3),
  } as React.CSSProperties;
  const glassRootStyle = { ...dynamicBgStyle, ...glassVars };

  const pageAnimClass =
    navDirection === "right"
      ? "page-in-right"
      : navDirection === "left"
      ? "page-in-left"
      : "page-in";

  return (
    <div
      style={glassRootStyle}
      className={`relative h-screen w-screen flex flex-col antialiased selection:bg-[var(--accent)] selection:text-white overflow-hidden select-none transition-[border-radius,border-color,background-color] duration-150 ${fontClass} ${fontSizeClass} ${textColorClass} ${
        isOverlayOpen
          ? 'bg-transparent'
          : isFloatingWindow
          ? 'rounded-[8px] border border-black/[0.08] dark:border-white/[0.16]'
          : 'rounded-none border-none'
      }`}
    >
      {/* Aurora Backdrop — clean Vision prism glow strictly clipped within window shell */}
      {!isOverlayOpen && !isSolid && (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" style={{ willChange: 'transform' }}>
          <div
            className="absolute inset-0 transition-opacity duration-300 aurora-field"
            style={{
              opacity: isClearGlass ? 0.06 : Number(((isLight ? 0.14 : 0.12) + frostRatio * 0.22).toFixed(3)),
              filter: `blur(${Math.max(12, blurPx * 1.4).toFixed(1)}px) saturate(1.15)`,
              transform: 'scale(1.04)',
              transitionProperty: 'opacity, filter',
              transitionDuration: '300ms',
              transitionTimingFunction: 'ease',
            }}
          >
            {/* 方案 A · 克制青蓝 + 靛蓝液态棱镜极光，强度随磨砂滑杆平滑响应 */}
            <div
              className="absolute -top-24 -left-20 h-[32rem] w-[32rem] rounded-full aurora-blob pointer-events-none"
              style={{
                background: isLight
                  ? 'radial-gradient(circle, rgba(56,189,248,0.34) 0%, rgba(186,230,253,0.14) 48%, transparent 72%)'
                  : 'radial-gradient(circle, rgba(56,189,248,0.32) 0%, rgba(14,165,233,0.10) 48%, transparent 72%)',
                animation: 'aurora-drift 22s ease-in-out infinite alternate',
              }}
            />
            <div
              className="absolute -bottom-24 -right-16 h-[30rem] w-[30rem] rounded-full aurora-blob pointer-events-none"
              style={{
                background: isLight
                  ? 'radial-gradient(circle, rgba(129,140,248,0.28) 0%, rgba(224,231,255,0.12) 48%, transparent 72%)'
                  : 'radial-gradient(circle, rgba(129,140,248,0.28) 0%, rgba(99,102,241,0.09) 48%, transparent 72%)',
                animation: 'aurora-drift 26s ease-in-out infinite alternate-reverse',
              }}
            />
          </div>
        </div>
      )}

      {/* Subtle Physical Prism Grain Layer — scales with frost intensity */}
      {dwmBlurActive && !isOverlayOpen && (
        <div
          className="glass-noise-tex pointer-events-none absolute inset-0 mix-blend-soft-light z-[1]"
          style={{ opacity: Number((0.02 + frostRatio * 0.05).toFixed(3)) }}
        />
      )}

      {/* Hide the chrome during capture without destroying form/chat/settings
          state. Cancelling a screenshot must preserve the user's input. */}
      <div className={isOverlayOpen ? 'hidden' : 'contents'} aria-hidden={isOverlayOpen || undefined}>
          <TitleBar
            onTriggerCapture={() => setIsOverlayOpen(true)}
            hotkey={settings.hotkey || "F4"}
            onQuickSearch={() => setIsSpotlightOpen((v) => !v)}
            onOpenAbout={() => handleTabChange("about")}
            onRequestClose={handleRequestClose}
            onOpenQuickWindow={handleOpenQuickWindow}
            quickWindowHotkey={quickWindowHotkey}
            isMaximized={isMaximized}
            onToggleMaximize={() => {
              if (isTauri()) {
                import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                  const win = getCurrentWindow();
                  win.toggleMaximize().then(() => win.isMaximized().then(setIsMaximized)).catch(() => {});
                }).catch(() => {});
              } else {
                setIsMaximized((prev) => !prev);
              }
            }}
          />

          {/* Global Hotkey Trigger Toast */}
          {triggerToast && (
            <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[90] flex items-center space-x-2.5 rounded-full px-5 py-2 text-sm font-semibold shadow-xl shadow-black/15 border animate-toast-in lg-panel"
              style={{ background: 'var(--g-surface-solid)', color: 'var(--g-text-1)' }}>
              <Camera className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
              <span>{triggerToast}</span>
            </div>
          )}

          {/* 主内容区：悬浮玻璃卡岛（宽屏自适应，底部为 Dock 让位留足呼吸空间） */}
          <main className="relative flex-1 min-w-0 overflow-y-auto scrollbar-thin px-4 sm:px-6 pt-2 pb-[116px]">
            <div
              key={activeTab}
              className={`${pageAnimClass} mx-auto w-full ${
                activeTab === "ai" ? "h-full" : ""
              } ${
                activeTab === "translate"
                  ? "max-w-[1600px]"
                  : activeTab === "ai"
                  ? "max-w-[1400px]"
                  : activeTab === "vocabulary"
                  ? "max-w-[1300px]"
                  : activeTab === "settings"
                  ? "max-w-[1220px]"
                  : "max-w-5xl"
              }`}
            >
              {activeTab === "translate" && (
                <DualPaneTranslator
                  key={`transfer_${transferred.seq}`}
                  settings={settings}
                  initialText={transferred.text}
                  onOpenSettings={() => handleTabChange("settings")}
                />
              )}
              {activeTab === "ai" && <AiChatPanel onOpenSettings={() => handleTabChange("settings")} />}
              {activeTab === "vocabulary" && <HistoryPanel />}
              {activeTab === "search" && (
                <SearchPanel settings={settings} onOpenSettings={() => handleTabChange("settings")} />
              )}
              {activeTab === "about" && (
                <AboutPanel onOpenSettings={() => handleTabChange("settings")} />
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
                  onOpenAbout={() => handleTabChange("about")}
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
                onTabChange={handleTabChange}
                onTriggerCapture={() => setIsOverlayOpen(true)}
                onTriggerClipboard={handleTriggerClipboard}
                onTriggerSpotlight={() => setIsSpotlightOpen(true)}
                onOpenCheatSheet={() => setIsCheatSheetOpen(true)}
                hotkey={settings.hotkey || "F4"}
              />
            </div>
          </div>
      </div>

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
          handleTabChange("translate");
        }}
      />

      {/* 首次使用引导 */}
      <OnboardingModal isOpen={isOnboardingOpen} onClose={closeOnboarding} />

      {/* 离线 OCR 模型未安装时的新手引导（待首次引导关闭后再弹出，避免双弹窗叠加） */}
      <OcrModelGuideModal onGoDownload={goDownloadOcrModels} suppressed={isOnboardingOpen} />

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

      {/* 自动检查更新与升级弹窗 */}
      <UpdateModal
        isOpen={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        updateInfo={pendingUpdate}
      />
    </div>
  );
}

export default App;
