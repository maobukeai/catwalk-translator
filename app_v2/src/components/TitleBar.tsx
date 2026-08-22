import React, { useState, useEffect } from "react";
import { X, Minus, Square, Command, Info } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../services/tauri";
import { useAppTheme } from "../hooks/useAppTheme";
import { useOcrStatus } from "../hooks/useOcrStatus";
import appIcon from "../assets/app_icon_v2.png";

interface TitleBarProps {
  onTriggerCapture?: () => void;
  hotkey?: string;
  onQuickSearch?: () => void;
  onOpenAbout?: () => void;
  onRequestClose?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({ onQuickSearch, onOpenAbout, onRequestClose }) => {
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
    if (onRequestClose) {
      onRequestClose();
      return;
    }
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
      className="flex h-10 w-full shrink-0 items-center justify-between px-2.5 select-none z-50 sticky top-0 cursor-default"
    >
      {/* 左侧：品牌 Logo 与名称（可点击直达软件信息） */}
      <button
        type="button"
        data-tauri-drag-region={false}
        onClick={onOpenAbout}
        className={`flex items-center gap-2 px-1.5 py-1 rounded-lg select-none transition cursor-pointer ${
          onOpenAbout
            ? (isLight ? 'hover:bg-black/5 active:bg-black/10' : 'hover:bg-white/10 active:bg-white/15')
            : 'pointer-events-none'
        }`}
        title={onOpenAbout ? "点击查看软件信息与架构" : undefined}
      >
        <img
          src={appIcon}
          className="h-6 w-6 object-contain select-none shrink-0"
          alt="猫步翻译"
        />
        <span className={`text-[13px] font-bold tracking-tight ${isLight ? 'text-slate-800' : 'text-white/90'}`}>
          猫步翻译
        </span>
      </button>

      {/* 中间：原生窗口可拖拽区域 */}
      <div data-tauri-drag-region className="flex-1 h-full min-w-8" />

      {/* 右侧：OCR 状态 + 软件信息 + ⌘K + Windows 11 Fluent 风格窗口控制按钮组 */}
      <div className="flex items-center gap-1.5" data-tauri-drag-region={false}>
        {/* 软件信息 / 关于 顶部快捷按钮 */}
        {onOpenAbout && (
          <button
            type="button"
            data-tauri-drag-region={false}
            onClick={onOpenAbout}
            className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all duration-150 cursor-pointer shadow-sm ${
              isLight
                ? 'text-slate-600 hover:text-slate-900 bg-white/70 hover:bg-white/95 border border-slate-200/80 hover:border-slate-300 active:scale-95'
                : 'text-zinc-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] hover:border-white/15 active:scale-95'
            }`}
            title="查看软件信息、版本更新与技术架构"
            aria-label="软件信息"
          >
            <Info className={`h-3.5 w-3.5 shrink-0 transition-colors ${
              isLight ? 'text-blue-500 group-hover:text-blue-600' : 'text-blue-400 group-hover:text-blue-300'
            }`} />
            <span>软件信息</span>
          </button>
        )}

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
