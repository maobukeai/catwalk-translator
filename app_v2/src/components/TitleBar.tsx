import React from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../services/tauri";
import { useSettingsStore } from "../stores/useSettingsStore";

interface TitleBarProps {
  onTriggerCapture?: () => void;
  hotkey?: string;
}

export const TitleBar: React.FC<TitleBarProps> = () => {
  // 原生窗口拖拽处理（同步无延迟调用）
  const handleStartDrag = (e: React.MouseEvent) => {
    // 仅在鼠标左键按下，并且未点击在按钮、输入框等交互控件上时触发拖拽
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, input, textarea, a, select')) {
      if (isTauri()) {
        try {
          getCurrentWindow().startDragging();
        } catch (err) {
          console.warn('Window drag error:', err);
        }
      }
    }
  };

  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTauri()) {
      try {
        getCurrentWindow().minimize();
      } catch (err) {
        console.warn('Window minimize error:', err);
      }
    } else {
      console.log('[Browser Mode] Window minimize clicked');
    }
  };

  const handleMaximize = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTauri()) {
      try {
        getCurrentWindow().toggleMaximize();
      } catch (err) {
        console.warn('Window maximize error:', err);
      }
    } else {
      console.log('[Browser Mode] Window maximize clicked');
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTauri()) {
      try {
        getCurrentWindow().close();
      } catch (err) {
        console.warn('Window close error:', err);
      }
    } else {
      console.log('[Browser Mode] Window close clicked');
    }
  };

  const { settings } = useSettingsStore();
  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      className={`flex h-10 w-full items-center justify-between px-3.5 border-b select-none z-50 sticky top-0 cursor-default shadow-sm transition-colors duration-200 ${
        isLight
          ? 'bg-slate-100/90 backdrop-blur-xl border-slate-200 text-slate-700'
          : 'bg-[#121216]/80 backdrop-blur-xl border-white/15 text-zinc-300'
      }`}
    >
      {/* 左侧品牌与 Logo 区域 */}
      <div data-tauri-drag-region className="flex items-center space-x-2.5">
        <div className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)] pointer-events-none overflow-hidden p-0.5">
          <img src="/icon.png" className="h-full w-full rounded-md object-cover select-none" alt="猫步Logo" />
        </div>
        <div data-tauri-drag-region className="flex items-center space-x-2 pointer-events-none">
          <span className={`text-xs font-bold tracking-tight ${isLight ? 'text-slate-800' : 'text-white drop-shadow-sm'}`}>
            猫步翻译软件
          </span>
          <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border shadow-sm ${
            isLight
              ? 'bg-blue-500/15 border-blue-400/30 text-blue-600'
              : 'bg-white/15 backdrop-blur-md border-white/25 text-sky-300'
          }`}>
            v2.0.1
          </span>
        </div>
      </div>

      {/* 弹性拖拽空白区域 */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* 右侧：窗口控制按钮组 */}
      <div className="flex items-center space-x-1 pl-3 z-10">
        <button
          type="button"
          onClick={handleMinimize}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-white/[0.08] hover:text-zinc-100 text-zinc-400'
          }`}
          title="最小化"
          aria-label="最小化窗口"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-white/[0.08] hover:text-zinc-100 text-zinc-400'
          }`}
          title="最大化 / 还原"
          aria-label="最大化或还原窗口"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            isLight ? 'hover:bg-rose-500 hover:text-white text-slate-600' : 'hover:bg-red-500/90 hover:text-white text-zinc-400'
          }`}
          title="关闭"
          aria-label="关闭窗口"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
};