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
    <div className="fixed bottom-6 right-6 z-[350] max-w-sm w-full animate-in slide-in-from-bottom-5 fade-in duration-200">
      <div
        className="lg-surface rounded-2xl p-4 shadow-2xl space-y-2.5 transition-all border"
        style={{
          background: 'var(--g-surface-solid)',
          borderColor: 'var(--g-border-strong)',
          color: 'var(--g-text-1)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
              <ClipboardCheck className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-bold tracking-wide">剪贴板速译</span>
            {payload.fromWatch && (
              <span
                data-testid="clipboard-watch-badge"
                className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-400 border-emerald-400/30"
                title="来自被动监听：复制外文即自动翻译"
              >
                自动监听
              </span>
            )}
            <span className="text-[10px] font-mono px-2 py-0.2 rounded-full border bg-blue-500/15 text-sky-300 border-blue-400/30">
              {payload.sourceTier}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {payload.fromWatch && onDisableWatch && (
              <button
                type="button"
                data-testid="disable-watch-btn"
                onClick={onDisableWatch}
                className="p-1 rounded-lg text-zinc-400 hover:text-amber-400 transition"
                title="关闭剪贴板被动监听（可在设置中重新开启）"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-zinc-400 hover:text-white transition"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-mono line-clamp-1 opacity-70">
            “{payload.original}”
          </p>
          <div className="flex items-start justify-between gap-2 pt-0.5">
            <p className="text-xs font-bold leading-relaxed flex-1 text-blue-400">
              {payload.translated}
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 rounded-md border text-[10px] bg-white/5 hover:bg-white/10 border-white/10 text-zinc-300 flex items-center space-x-1 cursor-pointer shrink-0"
              title="复制译文"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
