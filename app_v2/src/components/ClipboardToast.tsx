import React, { useEffect, useState } from 'react';
import { Copy, Check, X, Sparkles, ClipboardCheck } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';

export interface ClipboardPayload {
  id: string;
  original: string;
  translated: string;
  sourceTier: string;
}

interface ClipboardToastProps {
  payload: ClipboardPayload | null;
  onClose: () => void;
}

export const ClipboardToast: React.FC<ClipboardToastProps> = ({ payload, onClose }) => {
  const [copied, setCopied] = useState(false);
  const { settings } = useSettingsStore();
  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

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
    navigator.clipboard.writeText(payload.translated);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed bottom-6 right-6 z-[350] max-w-sm w-full animate-in slide-in-from-bottom-5 fade-in duration-200">
      <div
        className={`rounded-2xl border p-4 shadow-2xl backdrop-blur-xl space-y-2.5 transition-all ${
          isLight
            ? 'bg-white/95 border-slate-300 text-slate-900 shadow-slate-900/20'
            : 'bg-[#181824]/95 border-blue-500/30 text-zinc-100 shadow-[0_20px_50px_rgba(0,0,0,0.8)]'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
              <ClipboardCheck className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-bold tracking-wide">剪贴板速译</span>
            <span className="text-[10px] font-mono px-2 py-0.2 rounded-full border bg-blue-500/15 text-sky-300 border-blue-400/30">
              {payload.sourceTier}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
