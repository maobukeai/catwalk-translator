import React, { useEffect, useRef, useState } from "react";
import {
  Languages,
  Search,
  BookMarked,
  Settings,
  Camera,
  Bot,
  Clipboard,
  Keyboard,
  Zap,
  Info,
} from "lucide-react";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useOcrStatus } from "../hooks/useOcrStatus";

export type AppTab = "translate" | "search" | "vocabulary" | "settings" | "ai" | "about";

interface DockProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onTriggerCapture: () => void;
  onTriggerClipboard: () => void;
  onTriggerSpotlight: () => void;
  onOpenCheatSheet: () => void;
  hotkey?: string;
}

const DOCK_ITEMS: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: "translate", label: "翻译器", icon: Languages },
  { id: "search", label: "查词", icon: Search },
  { id: "ai", label: "AI 对话", icon: Bot },
  { id: "vocabulary", label: "生词本", icon: BookMarked },
  { id: "settings", label: "系统设置", icon: Settings },
];

/** 右键快捷菜单动作 */
const CONTEXT_ACTIONS = [
  { id: "capture", label: "截图翻译", icon: Camera },
  { id: "clipboard", label: "剪贴板翻译", icon: Clipboard },
  { id: "spotlight", label: "Spotlight 查词", icon: Zap },
  { id: "cheatsheet", label: "快捷键速查表", icon: Keyboard },
] as const;

export const Dock: React.FC<DockProps> = ({
  activeTab,
  onTabChange,
  onTriggerCapture,
  onTriggerClipboard,
  onTriggerSpotlight,
  onOpenCheatSheet,
  hotkey = "F4",
}) => {
  const { settings } = useSettingsStore();
  const { status: ocrStatus, detail: ocrDetail } = useOcrStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  // 点击 Dock 外部时关闭右键菜单
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const hotkeyTip = (id: AppTab): string => {
    if (id === "translate") return settings.toggleWindowHotkey || "Alt+Q";
    if (id === "search") return settings.spotlightHotkey || "Alt+Space";
    if (id === "vocabulary") return "Ctrl+D 收藏";
    return "";
  };

  const ocrDotColor =
    ocrStatus === "ready" ? "var(--ok)" :
    ocrStatus === "warming" ? "var(--warn)" :
    ocrStatus === "failed" ? "var(--danger)" :
    "var(--g-text-3)";

  const handleContextAction = (id: typeof CONTEXT_ACTIONS[number]["id"]) => {
    setMenuOpen(false);
    if (id === "capture") onTriggerCapture();
    else if (id === "clipboard") onTriggerClipboard();
    else if (id === "spotlight") onTriggerSpotlight();
    else if (id === "cheatsheet") onOpenCheatSheet();
  };

  return (
    <div ref={dockRef} className="relative">
      {/* 右键快捷菜单（悬浮于 Dock 上方） */}
      {menuOpen && (
        <div className="dock-menu tooltip-pop flex flex-col" role="menu">
          {CONTEXT_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                onClick={() => handleContextAction(action.id)}
                className="flex items-center gap-2.5 px-3.5 py-2 text-left text-[12px] font-medium rounded-lg mx-1 transition cursor-pointer hover:bg-[var(--g-surface-2)] hover:text-[var(--accent-text)]"
                style={{ color: "var(--g-text-1)" }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <nav
        className="dock"
        aria-label="主导航"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen((v) => !v);
        }}
      >
        {DOCK_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const tip = hotkeyTip(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              data-active={isActive}
              className="dock-item"
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-[19px] w-[19px]" strokeWidth={isActive ? 2.2 : 1.9} />
              <span className="dock-dot" />
              <span className="dock-tip">
                {item.label}
                {tip && <kbd>{tip}</kbd>}
              </span>
            </button>
          );
        })}

        <span className="dock-sep" aria-hidden />

        {/* 截图划词翻译 CTA（强调色） */}
        <button
          type="button"
          onClick={onTriggerCapture}
          className="dock-item dock-cta"
          aria-label="划词翻译"
          title={`开启截图划词翻译选区（${hotkey} / F4）`}
        >
          <Camera className="h-[19px] w-[19px]" strokeWidth={2.1} />
          <span className="dock-tip">
            划词翻译
            <kbd>{hotkey}</kbd>
          </span>
        </button>

        {/* OCR 引擎真实状态微指示点 */}
        <span
          className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: ocrDotColor, boxShadow: `0 0 6px ${ocrDotColor}` }}
          title={`OCR 引擎状态：${ocrStatus}${ocrDetail ? ` · ${ocrDetail}` : ""}`}
          aria-label={`OCR 引擎状态：${ocrStatus}`}
        />
      </nav>
    </div>
  );
};
