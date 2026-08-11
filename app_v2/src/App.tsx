import { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar, type AppTab } from "./components/Sidebar/Sidebar";
import { SettingsDashboard } from "./components/Settings/SettingsDashboard";
import { DualPaneTranslator } from "./components/MainWindow/DualPaneTranslator";
import { SearchPanel } from "./components/MainWindow/SearchPanel";
import { AiChatPanel } from "./components/MainWindow/AiChatPanel";
import { HistoryPanel } from "./components/Vocabulary/HistoryPanel";
import { CaptureOverlay } from "./components/Overlay/CaptureOverlay";
import { SpotlightModal } from "./components/SpotlightModal";
import { ClipboardToast, type ClipboardPayload } from "./components/ClipboardToast";
import { isTauri, cmdQueryText } from "./services/tauri";
import { useSettingsStore } from "./stores/useSettingsStore";
import { Camera } from "lucide-react";

function matchesHotkey(e: KeyboardEvent, hotkeyStr?: string): boolean {
  if (!hotkeyStr) return false;
  const parts = hotkeyStr.split('+').map((p) => p.trim().toUpperCase());

  const needCtrl = parts.includes('CTRL') || parts.includes('CONTROL');
  const needAlt = parts.includes('ALT');
  const needShift = parts.includes('SHIFT');
  const needWin = parts.includes('WIN') || parts.includes('META');

  if (e.ctrlKey !== needCtrl) return false;
  if (e.altKey !== needAlt) return false;
  if (e.shiftKey !== needShift) return false;
  if (e.metaKey !== needWin) return false;

  const keyParts = parts.filter((p) => !['CTRL', 'CONTROL', 'ALT', 'SHIFT', 'WIN', 'META'].includes(p));
  if (keyParts.length === 0) return false;

  const targetKey = keyParts[0];
  let pressedKey = e.key.toUpperCase();
  if (e.code.startsWith('Key')) pressedKey = e.code.replace('Key', '');
  else if (e.code.startsWith('Digit')) pressedKey = e.code.replace('Digit', '');

  return pressedKey === targetKey || e.key.toUpperCase() === targetKey;
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("translate");
  const [triggerToast, setTriggerToast] = useState<string | null>(null);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);
  const [clipboardPayload, setClipboardPayload] = useState<ClipboardPayload | null>(null);
  const [transferredText, setTransferredText] = useState<string>("");
  const { settings, fetchSettings } = useSettingsStore();

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Handle instant clipboard translation
  const handleTriggerClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const res = await cmdQueryText(text.trim(), settings.defaultPreset, settings.llmConfig);
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
  };

  // Browser-level hotkey listener fallback (matches exact configured hotkey strings)
  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      // Spotlight hotkey
      if ((settings.spotlightHotkeyEnabled ?? true) && matchesHotkey(e, settings.spotlightHotkey || 'Alt+Space')) {
        e.preventDefault();
        setIsSpotlightOpen((prev) => !prev);
        return;
      }

      // Clipboard hotkey
      if ((settings.clipboardHotkeyEnabled ?? true) && matchesHotkey(e, settings.clipboardHotkey || 'Ctrl+Shift+C')) {
        e.preventDefault();
        await handleTriggerClipboard();
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [settings]);

  // OS-level Tauri global shortcut event listeners (works across Windows in any app)
  useEffect(() => {
    if (isTauri()) {
      const unlistens: (() => void)[] = [];

      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('trigger-capture', () => {
          const now = new Date().toLocaleTimeString();
          setTriggerToast(`全局划词选区已启动 [${now}]`);
          setIsOverlayOpen(true);
          setTimeout(() => setTriggerToast(null), 3000);
        }).then((u) => unlistens.push(u));

        listen('trigger-spotlight', () => {
          setIsSpotlightOpen((prev) => !prev);
        }).then((u) => unlistens.push(u));

        listen('trigger-clipboard', () => {
          handleTriggerClipboard();
        }).then((u) => unlistens.push(u));
      });

      return () => {
        unlistens.forEach((u) => u());
      };
    }
  }, [settings]);

  const appearance = settings.appearance || {
    theme: 'fluent-dark',
    enableBlur: true,
    blurAmount: 24,
    enableTransparency: true,
    windowOpacity: 85,
    fontFamily: 'system',
    fontSize: 'medium',
  };

  const activeTheme = appearance.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  const blurEnabled = appearance.enableBlur ?? (activeTheme === 'fluent-dark');
  const blurPx = appearance.blurAmount ?? 24;
  const isSolid = activeTheme === 'dark' || activeTheme === 'light' || !blurEnabled || blurPx === 0;

  const blurFilterVal = blurEnabled && blurPx > 0
    ? `blur(${blurPx}px) saturate(190%) contrast(110%) brightness(105%)`
    : 'none';

  // Dynamic style calculation for realistic Frosted Glass / Solid Dark / Light
  const dynamicBgStyle: React.CSSProperties = isOverlayOpen
    ? {
        backgroundColor: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        boxShadow: 'none',
      }
    : {
        backgroundColor: isSolid
          ? (isLight ? '#f8fafc' : '#121216')
          : (isLight ? 'rgba(248, 250, 252, 0.6)' : 'rgba(15, 16, 22, 0.55)'),
        backdropFilter: blurFilterVal,
        WebkitBackdropFilter: blurFilterVal,
        boxShadow: isSolid ? 'none' : 'inset 0 1px 1px rgba(255, 255, 255, 0.22), inset 0 -1px 1px rgba(255, 255, 255, 0.06), 0 20px 50px rgba(0,0,0,0.5)',
      };

  const textColorClass = isLight ? 'text-slate-800' : 'text-zinc-100';
  const fontClass = `font-${appearance.fontFamily || 'system'}`;
  const fontSizeClass = `font-scale-${appearance.fontSize || 'medium'}`;

  return (
    <div className="relative h-screen overflow-hidden">
      {/* Aurora Backdrop — colorful layers behind the glass that give the frosted diffusion */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ willChange: 'transform' }}>
        <div className={`absolute inset-0 transition-opacity duration-500 ${isOverlayOpen ? 'opacity-0' : 'opacity-100'}`} style={{ filter: 'blur(18px) saturate(1.2)', transform: 'scale(1.04)' }}>
          {/* Base tint wash — rich gradient guaranteed to show through any glass tint */}
          <div
            className="absolute inset-0"
            style={{
              background: isLight
                ? 'linear-gradient(118deg, #c7d7fe 0%, #ddd6fe 32%, #bfdbfe 58%, #fbcfe8 100%)'
                : 'linear-gradient(118deg, #123a7a 0%, #27185e 32%, #0f2a56 58%, #54203f 100%)',
            }}
          />
          <div
            className="absolute -top-24 -left-20 h-[32rem] w-[32rem] rounded-full"
            style={{ background: isLight ? 'radial-gradient(circle, rgba(56,189,248,0.65), transparent 68%)' : 'radial-gradient(circle, rgba(56,189,248,0.55), transparent 68%)', filter: 'blur(60px)', animation: 'aurora-drift 16s ease-in-out infinite alternate' }}
          />
          <div
            className="absolute top-1/4 -right-16 h-[26rem] w-[26rem] rounded-full"
            style={{ background: isLight ? 'radial-gradient(circle, rgba(139,92,246,0.6), transparent 68%)' : 'radial-gradient(circle, rgba(139,92,246,0.5), transparent 68%)', filter: 'blur(60px)', animation: 'aurora-drift 20s ease-in-out infinite alternate-reverse' }}
          />
          <div
            className="absolute -bottom-24 left-1/3 h-[30rem] w-[30rem] rounded-full"
            style={{ background: isLight ? 'radial-gradient(circle, rgba(59,130,246,0.6), transparent 68%)' : 'radial-gradient(circle, rgba(59,130,246,0.5), transparent 68%)', filter: 'blur(64px)', animation: 'aurora-drift 24s ease-in-out infinite alternate' }}
          />
          <div
            className="absolute bottom-16 right-1/4 h-80 w-80 rounded-full"
            style={{ background: isLight ? 'radial-gradient(circle, rgba(217,70,239,0.5), transparent 68%)' : 'radial-gradient(circle, rgba(217,70,239,0.42), transparent 68%)', filter: 'blur(55px)', animation: 'aurora-drift 18s ease-in-out infinite alternate-reverse' }}
          />
        </div>
      </div>

    <div
      style={dynamicBgStyle}
      className={`relative z-10 flex flex-col h-screen antialiased selection:bg-blue-600/40 selection:text-white overflow-hidden ${fontClass} ${fontSizeClass} ${textColorClass} ${isOverlayOpen ? 'bg-transparent' : (!isSolid ? 'border border-white/20' : '')}`}
    >
      {/* Real Frosted Glass Grain & Specular Top Reflection Layer */}
      {blurEnabled && !isSolid && !isOverlayOpen && (
        <>
          {/* Top Specular Glass Reflection Spotlight */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(255,255,255,0.18),transparent_70%)] z-[1]" />
          {/* Frosted Micro-Grain Texture Overlay */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:10px_10px] opacity-30 mix-blend-overlay z-[1]" />
          {/* Physical Noise Texture (SVG feTurbulence) */}
          <div className="glass-noise-tex pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-soft-light z-[1]" />
        </>
      )}

      {/* Only show app chrome when overlay is NOT open */}
      {!isOverlayOpen && (
        <>
          <TitleBar
            onTriggerCapture={() => setIsOverlayOpen(true)}
            hotkey={settings.hotkey || "Ctrl+Alt+D"}
          />

          {/* Global Hotkey Trigger Toast */}
          {triggerToast && (
            <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[90] flex items-center space-x-2.5 rounded-full bg-white/45 backdrop-blur-md px-5 py-2 text-sm font-semibold text-slate-800 shadow-xl shadow-black/10 border border-white/60 animate-bounce">
              <Camera className="h-4 w-4 text-blue-600" />
              <span>{triggerToast}</span>
            </div>
          )}

          {/* 左侧导航 + 主内容区 */}
          <div className="flex flex-1 min-h-0">
            <Sidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onTriggerCapture={() => setIsOverlayOpen(true)}
              hotkey={settings.hotkey || "Ctrl+Alt+D"}
            />

            <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin px-5 py-4 bg-[radial-gradient(1000px_450px_at_60%_-10%,rgba(59,130,246,0.08),transparent)]">
              <div key={activeTab} className="page-in h-full">
                {activeTab === "translate" && (
                  <DualPaneTranslator
                    key={transferredText}
                    settings={settings}
                    initialText={transferredText}
                  />
                )}
                {activeTab === "search" && <SearchPanel settings={settings} />}
                {activeTab === "ai" && <AiChatPanel onOpenSettings={() => setActiveTab("settings")} />}
                {activeTab === "vocabulary" && <HistoryPanel />}
                {activeTab === "settings" && (
                  <SettingsDashboard
                    onStartCapture={() => setIsOverlayOpen(true)}
                    onTriggerSpotlight={() => setIsSpotlightOpen(true)}
                    onTriggerClipboard={handleTriggerClipboard}
                    onToggleWindow={() => {
                      setTriggerToast("⚡ 主程序显隐逻辑联动运行中 (可按下录制的热键随时切换！)");
                      setTimeout(() => setTriggerToast(null), 3000);
                    }}
                  />
                )}
              </div>
            </main>
          </div>
        </>
      )}

      {/* Screen Selection & Translation Overlay — renders full-screen when open */}
      <CaptureOverlay
        isOpen={isOverlayOpen}
        onClose={() => setIsOverlayOpen(false)}
        onSendToMainWindow={(text) => {
          setTransferredText(text);
          setActiveTab("translate");
        }}
      />

      {/* Spotlight Instant Search Float Window */}
      <SpotlightModal
        isOpen={isSpotlightOpen}
        onClose={() => setIsSpotlightOpen(false)}
        settings={settings}
      />

      {/* Clipboard Instant Translate Toast */}
      <ClipboardToast
        payload={clipboardPayload}
        onClose={() => setClipboardPayload(null)}
      />
    </div>
    </div>
  );
}

export default App;