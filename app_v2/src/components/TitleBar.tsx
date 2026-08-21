import React, { useState, useEffect } from "react";
import { X, Minus, Square, Command } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../services/tauri";
import { useAppTheme } from "../hooks/useAppTheme";
import { useOcrStatus } from "../hooks/useOcrStatus";

interface TitleBarProps {
  onTriggerCapture?: () => void;
  hotkey?: string;
  onQuickSearch?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({ onQuickSearch }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  // 原生窗口拖拽处理（同步无延迟调用）
  const handleStartDrag = (e: React.MouseEvent) => {
    // 仅在鼠标左键按下，并且未点击在交互控件上时触发拖拽
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, input, textarea, a, select, [data-tauri-drag-region="false"]')) {
      if (isTauri()) {
        try {
          getCurrentWindow().startDragging();
        } catch (err) {
          console.warn('Window drag error:', err);
        }
      }
    }
  };

  // 监听并同步 Tauri 窗口最大化/还原状态
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenResize: (() => void) | undefined;

    const checkMaximized = async () => {
      try {
        const win = getCurrentWindow();
        const max = await win.isMaximized();
        setIsMaximized(max);
      } catch (err) {
        console.warn('Check maximized error:', err);
      }
    };

    checkMaximized();

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('tauri://resize', () => {
        checkMaximized();
      }).then((u) => {
        unlistenResize = u;
      });
    }).catch(() => {});

    return () => {
      if (unlistenResize) unlistenResize();
    };
  }, []);

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

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTauri()) {
      try {
        const win = getCurrentWindow();
        await win.toggleMaximize();
        const max = await win.isMaximized();
        setIsMaximized(max);
      } catch (err) {
        console.warn('Window maximize error:', err);
      }
    } else {
      setIsMaximized((prev) => !prev);
      console.log('[Browser Mode] Window maximize clicked');
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTauri()) {
      try {
        getCurrentWindow().hide();
      } catch (err) {
        console.warn('Window close error:', err);
      }
    } else {
      console.log('[Browser Mode] Window close clicked');
    }
  };

  const { isLight } = useAppTheme();
  const { status, detail } = useOcrStatus();

  const ocrDotColor =
    status === 'ready' ? 'var(--ok)' :
    status === 'warming' ? 'var(--warn)' :
    status === 'failed' ? 'var(--danger)' :
    'var(--g-text-3)';

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      className="flex h-9 w-full shrink-0 items-center justify-between px-2 select-none z-50 sticky top-0 cursor-default"
    >
      {/* 左侧：品牌 Logo 与名称 */}
      <div className="flex items-center gap-2 pl-1 select-none pointer-events-none">
        <img
          src="/icon.png"
          className="h-4.5 w-4.5 rounded-[5px] object-cover select-none shadow-sm"
          alt="猫步翻译"
        />
        <span className={`text-[12px] font-semibold tracking-wide ${isLight ? 'text-slate-800' : 'text-white/85'}`}>
          猫步翻译
        </span>
      </div>

      {/* 中间：原生窗口可拖拽区域 */}
      <div data-tauri-drag-region className="flex-1 h-full min-w-8" />

      {/* 右侧：OCR 状态 + ⌘K + Windows 11 Fluent 风格窗口控制按钮组 */}
      <div className="flex items-center gap-1.5" data-tauri-drag-region={false}>
        {/* OCR 引擎真实状态 */}
        <div
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md select-none"
          title={`OCR 引擎：${detail || status || '未知'}`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: ocrDotColor, boxShadow: `0 0 6px ${ocrDotColor}` }}
          />
          <span className={`text-[10px] font-medium tabular-nums ${isLight ? 'text-slate-500' : 'text-white/45'}`}>
            OCR
          </span>
        </div>

        {/* ⌘K 快速查词入口 */}
        {onQuickSearch && (
          <button
            type="button"
            data-tauri-drag-region={false}
            onClick={onQuickSearch}
            className={`flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-[10.5px] font-medium transition cursor-pointer ${
              isLight
                ? 'text-slate-600 hover:text-slate-900 hover:bg-black/5 active:bg-black/10'
                : 'text-white/60 hover:text-white hover:bg-white/10 active:bg-white/15'
            }`}
            title="快速查词（Spotlight）"
            aria-label="快速查词"
          >
            <Command className="h-3 w-3" />
            <span>K</span>
          </button>
        )}

        {/* 微细分割线 */}
        <div className={`h-3.5 w-px mx-0.5 ${isLight ? 'bg-black/10' : 'bg-white/10'}`} />

        {/* Windows 控制按钮三件套（最右侧） */}
        <div className="flex items-center gap-0.5" data-tauri-drag-region={false}>
          {/* 最小化 */}
          <button
            type="button"
            data-tauri-drag-region={false}
            onClick={handleMinimize}
            className={`inline-flex items-center justify-center h-7 w-9 rounded-[4px] transition-colors duration-150 cursor-default ${
              isLight
                ? 'text-slate-600 hover:bg-black/5 hover:text-slate-900 active:bg-black/10'
                : 'text-white/70 hover:bg-white/10 hover:text-white active:bg-white/15'
            }`}
            title="最小化"
            aria-label="最小化窗口"
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          {/* 最大化 / 还原 */}
          <button
            type="button"
            data-tauri-drag-region={false}
            onClick={handleMaximize}
            className={`inline-flex items-center justify-center h-7 w-9 rounded-[4px] transition-colors duration-150 cursor-default ${
              isLight
                ? 'text-slate-600 hover:bg-black/5 hover:text-slate-900 active:bg-black/10'
                : 'text-white/70 hover:bg-white/10 hover:text-white active:bg-white/15'
            }`}
            title={isMaximized ? "向下还原" : "最大化"}
            aria-label={isMaximized ? "向下还原窗口" : "最大化窗口"}
          >
            {isMaximized ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M5.5 3.5H12.5V10.5" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="3.5" y="5.5" width="7" height="7" rx="0.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <Square className="h-3 w-3" strokeWidth={1.5} />
            )}
          </button>

          {/* 关闭 */}
          <button
            type="button"
            data-tauri-drag-region={false}
            onClick={handleClose}
            className={`inline-flex items-center justify-center h-7 w-9 rounded-[4px] transition-colors duration-150 cursor-default ${
              isLight ? 'text-slate-600' : 'text-white/70'
            } hover:bg-[#c42b1c] hover:text-white active:bg-[#b52618] active:text-white`}
            title="关闭"
            aria-label="关闭窗口"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </header>
  );
};
