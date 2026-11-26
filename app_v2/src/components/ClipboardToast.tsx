import React, { useEffect, useState } from 'react';
import { Copy, Check, X, Sparkles, ClipboardCheck } from 'lucide-react';
import { useAppTheme } from '../hooks/useAppTheme';

export interface ClipboardPayload {
  id: string;
  original: string;
  translated: string;
  sourceTier: string;
  /** True when this came from the passive clipboard watcher (not the hotkey). */
  fromWatch?: boolean;
}

interface ClipboardToastProps {
  payload: ClipboardPayload | null;
  onClose: () => void;
  /** Offer a one-click "stop watching" when the payload came from the watcher. */
  onDisableWatch?: () => void;
}

export const ClipboardToast: React.FC<ClipboardToastProps> = ({ payload, onClose, onDisableWatch }) => {
  const [copied, setCopied] = useState(false);
  const { isLight } = useAppTheme();

  useEffect(() => {
    if (payload) {
      setCopied(false);
      const timer = setTimeout(() => {
        onClose();
      }, 3800);
      return () => clearTimeout(timer);
    }
  }, [payload, onClose]);

  if (!payload) return null;

  const handleCopy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(payload.translated);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard unavailable (e.g. page not focused) — keep the toast so
           the user can still read and manually copy the text */
      }
    })();
  };

  return (
    <div className="fixed bottom-6 right-6 z-[350] max-w-sm w-full">
      <div
        key={payload.id}
        className={`vision-toast-shell vision-modal-enter rounded-[22px] p-4 space-y-2.5 overflow-hidden ${
          isLight ? 'text-slate-800' : 'text-zinc-100'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent-text)] shrink-0">
              <ClipboardCheck className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-bold tracking-wide text-[var(--g-text-1)] shrink-0">
              剪贴板速译
            </span>
            {payload.fromWatch && (
              <span
                data-testid="clipboard-watch-badge"
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold shrink-0 ${
                  isLight
                    ? 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                }`}
                title="来自被动监听：复制外文即自动翻译"
              >
                自动监听
              </span>
            )}
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent-border)] truncate max-w-[120px]">
              {payload.sourceTier}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {payload.fromWatch && onDisableWatch && (
              <button
                type="button"
                data-testid="disable-watch-btn"
                onClick={onDisableWatch}
                className={`p-1 rounded-full transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                  isLight
                    ? 'text-slate-400 hover:bg-amber-500/12 hover:text-amber-600'
                    : 'text-zinc-400 hover:bg-amber-500/15 hover:text-amber-300'
                }`}
                title="关闭剪贴板被动监听（可在设置中重新开启）"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`p-1 rounded-full transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                isLight
                  ? 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-700'
                  : 'text-zinc-400 hover:bg-white/10 hover:text-white'
              }`}
              title="关闭提示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-mono line-clamp-1 text-[var(--g-text-3)]">
            “{payload.original}”
          </p>
          <div className="flex items-start justify-between gap-2 pt-0.5">
            <p className="text-[12.5px] font-bold leading-relaxed flex-1 text-[var(--accent-text)]">
              {payload.translated}
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className={`p-1.5 rounded-full border text-[10px] flex items-center cursor-pointer shrink-0 transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                isLight
                  ? 'bg-white/85 hover:bg-white border-slate-200/80 text-slate-600 shadow-2xs'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/12 text-zinc-200'
              }`}
              title="复制译文"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>

        <div className="vision-toast-life pointer-events-none" />
      </div>
    </div>
  );
};
