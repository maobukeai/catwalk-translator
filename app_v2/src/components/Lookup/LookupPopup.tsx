import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Volume2 } from 'lucide-react';
import { cmdGetLookupPayload, cmdHideLookupPopup, isTauri } from '../../services/tauri';
import { speakText } from '../../services/tts';
import { detectSpeechLang } from '../../services/langDetect';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { WordDetail, MultiEngineTranslation } from '../../services/types';

/** 无感查词浮窗(load = lookup_popup 窗口):划词句子翻译 / 悬停词卡。
 *  不抢焦点:靠关闭按钮、鼠标移出、12 秒无操作或下一次取词收起。 */
export interface LookupPayload {
  kind: 'selection' | 'hover';
  text: string;
  translation?: string | null;
  sourceTier?: string | null;
  wordDetail?: WordDetail | null;
  engines?: MultiEngineTranslation[] | null;
  tsMs: number;
}

export const LookupPopupApp: React.FC = () => {
  const [payload, setPayload] = useState<LookupPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const { isLight } = useAppTheme();
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    cmdHideLookupPopup().catch(() => undefined);
  }, []);

  // 组件卸载时清理所有活跃定时器
  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // 初次挂载拉取 + 监听更新(浮窗常驻隐藏,新取词复用窗口)
  useEffect(() => {
    if (!isTauri()) return;
    cmdGetLookupPayload()
      .then((p) => {
        if (p) setPayload(p as LookupPayload);
      })
      .catch(() => undefined);
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('lookup-updated', (event) => setPayload(event.payload as LookupPayload)))
      .then((u) => {
        unlisten = u;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, []);

  // 12 秒无操作自动收起(每次新 payload 重置)
  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (payload) {
      hideTimerRef.current = setTimeout(hide, 12_000);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [payload, hide]);

  const handleCopy = async () => {
    if (!payload) return;
    const text = payload.kind === 'selection' ? payload.translation || payload.text : payload.text;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleSpeak = () => {
    if (!payload) return;
    speakText(payload.text, { lang: detectSpeechLang(payload.text) });
  };

  if (!payload) {
    return <div className="h-screen w-screen" data-tauri-drag-region />;
  }

  const isHover = payload.kind === 'hover';
  const detail = payload.wordDetail ?? null;
  const engines = (payload.engines ?? []).filter((e) => e.translated?.trim()).slice(0, 3);

  return (
    <div
      className="h-screen w-screen overflow-hidden p-2 select-none"
      onMouseEnter={() => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
      }}
      onMouseLeave={() => {
        // 移出浮窗 400ms 后收起(避免擦过边缘立即消失)
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = setTimeout(() => hide(), 400);
      }}
    >
      <div
        className={`lookup-vision-shell lookup-vision-enter h-full w-full rounded-[20px] overflow-hidden flex flex-col ${
          isLight ? 'text-slate-800' : 'text-zinc-100'
        }`}
      >
        {/* 头部：词头 / 原文 + 可点击音标胶囊 + 操作按钮 */}
        <div
          className="pin-vision-header flex items-start justify-between gap-2 px-3.5 pt-2.5 pb-2"
          data-testid="lookup-header"
        >
          <div className="min-w-0 flex-1">
            {isHover ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-base font-bold leading-snug break-words tracking-tight ${
                      isLight ? 'text-slate-900' : 'text-zinc-50'
                    }`}
                  >
                    {payload.text}
                  </span>
                  {detail?.pos && (
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent-text)]">
                      {detail.pos}
                    </span>
                  )}
                </div>
                {detail && (detail.phoneticUs || detail.phoneticUk) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                    {detail.phoneticUs && (
                      <button
                        type="button"
                        onClick={() => speakText(payload.text, { lang: 'en-US' })}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                          isLight
                            ? 'bg-white/75 border-slate-200/80 text-sky-700 hover:bg-[var(--accent-soft)] hover:border-[var(--accent-border)]'
                            : 'bg-white/[0.06] border-white/10 text-sky-300 hover:bg-[var(--accent-soft)] hover:border-[var(--accent-border)]'
                        }`}
                        title="点击朗读美式发音"
                      >
                        <Volume2 className="h-2.5 w-2.5 opacity-80" />
                        <span>US {detail.phoneticUs}</span>
                      </button>
                    )}
                    {detail.phoneticUk && (
                      <button
                        type="button"
                        onClick={() => speakText(payload.text, { lang: 'en-GB' })}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                          isLight
                            ? 'bg-white/75 border-slate-200/80 text-sky-700 hover:bg-[var(--accent-soft)] hover:border-[var(--accent-border)]'
                            : 'bg-white/[0.06] border-white/10 text-sky-300 hover:bg-[var(--accent-soft)] hover:border-[var(--accent-border)]'
                        }`}
                        title="点击朗读英式发音"
                      >
                        <Volume2 className="h-2.5 w-2.5 opacity-80" />
                        <span>UK {detail.phoneticUk}</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent-text)]">
                    划词翻译
                  </span>
                  {payload.sourceTier && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono border ${
                        isLight
                          ? 'bg-emerald-50/90 text-emerald-700 border-emerald-200/80'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25'
                      }`}
                    >
                      {payload.sourceTier}
                    </span>
                  )}
                </div>
                <div
                  className={`text-xs leading-snug break-words line-clamp-2 ${
                    isLight ? 'text-slate-600' : 'text-zinc-300'
                  }`}
                >
                  {payload.text}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleSpeak}
              className={`p-1.5 rounded-lg transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                isLight
                  ? 'hover:bg-[var(--accent-soft)] text-slate-400 hover:text-[var(--accent-text)]'
                  : 'hover:bg-white/10 text-zinc-400 hover:text-zinc-100'
              }`}
              title="朗读原文"
            >
              <Volume2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={`p-1.5 rounded-lg transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                isLight
                  ? 'hover:bg-[var(--accent-soft)] text-slate-400 hover:text-[var(--accent-text)]'
                  : 'hover:bg-white/10 text-zinc-400 hover:text-zinc-100'
              }`}
              title="复制"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={hide}
              className={`p-1.5 rounded-lg transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                isLight
                  ? 'hover:bg-rose-500/12 text-slate-400 hover:text-rose-600'
                  : 'hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400'
              }`}
              title="关闭 (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto px-3.5 py-2.5 space-y-2 text-sm">
          {isHover ? (
            <>
              {detail && (detail.pos || detail.definition || detail.cgDomainNote) && (
                <div className="space-y-1.5">
                  {detail.definition && (
                    <div
                      className={`text-[13.5px] font-semibold leading-snug ${
                        isLight ? 'text-slate-800' : 'text-zinc-100'
                      }`}
                    >
                      {detail.definition}
                    </div>
                  )}
                  {detail.cgDomainNote && (
                    <div
                      className={`rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed border ${
                        isLight
                          ? 'bg-amber-50/85 border-amber-200/80 text-amber-900'
                          : 'bg-amber-500/12 border-amber-400/25 text-amber-200'
                      }`}
                    >
                      <span className="font-semibold">CG 领域词库：</span>
                      <span>{detail.cgDomainNote}</span>
                    </div>
                  )}
                </div>
              )}
              {engines.length > 0 && (
                <div className="pt-1.5 border-t border-dashed border-[var(--g-hairline)] space-y-1">
                  {engines.map((e, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-xs">
                      <span
                        className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${
                          isLight
                            ? 'bg-white/80 border-slate-200/80 text-slate-500'
                            : 'bg-white/[0.06] border-white/[0.08] text-zinc-400'
                        }`}
                      >
                        {e.engineName}
                      </span>
                      <span
                        className={`min-w-0 break-words ${
                          isLight ? 'text-slate-700' : 'text-zinc-200'
                        }`}
                      >
                        {e.translated}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!detail && engines.length === 0 && (
                <div
                  className={`text-xs py-2 text-center ${
                    isLight ? 'text-slate-400' : 'text-zinc-500'
                  }`}
                >
                  暂无释义
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1.5">
              <div
                className={`font-semibold leading-relaxed break-words text-[14.5px] ${
                  isLight ? 'text-slate-900' : 'text-white'
                }`}
              >
                {payload.translation || '翻译中…'}
              </div>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div
          className={`px-3.5 py-1.5 border-t border-[var(--g-hairline)] text-[10px] flex items-center justify-between ${
            isLight ? 'text-slate-400' : 'text-zinc-500'
          }`}
        >
          <span>{isHover ? '悬停取词 · 移开鼠标或点 ✕ 收起' : '划词翻译 · 移开鼠标或点 ✕ 收起'}</span>
          <span className="font-mono opacity-65">猫步翻译</span>
        </div>
      </div>
    </div>
  );
};
