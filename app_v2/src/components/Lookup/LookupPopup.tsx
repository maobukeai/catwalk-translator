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
      className="h-screen w-screen overflow-hidden p-2.5 select-none"
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
        className={`h-full w-full rounded-xl backdrop-blur-xl shadow-2xl flex flex-col ${
          isLight
            ? 'bg-white/95 border border-slate-200/80 text-slate-800'
            : 'bg-zinc-900/95 border border-white/10 text-zinc-100'
        }`}
      >
        {/* 头部:词/原文 + 操作按钮 */}
        <div
          className={`flex items-start justify-between gap-2 px-3 pt-2.5 pb-1.5 border-b ${
            isLight ? 'border-slate-100' : 'border-white/[0.06]'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div
              className={`font-bold leading-snug break-words ${
                isLight ? 'text-slate-900' : 'text-zinc-100'
              } ${isHover ? 'text-base' : 'text-sm opacity-90'}`}
            >
              {payload.text}
            </div>
            {detail && (detail.phoneticUs || detail.phoneticUk) && (
              <div
                className={`mt-0.5 text-[11px] font-mono ${
                  isLight ? 'text-sky-600' : 'text-sky-300/90'
                }`}
              >
                {detail.phoneticUs && <span>US {detail.phoneticUs}</span>}
                {detail.phoneticUs && detail.phoneticUk && <span className="mx-1.5 opacity-40">|</span>}
                {detail.phoneticUk && <span>UK {detail.phoneticUk}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleSpeak}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                isLight
                  ? 'hover:bg-slate-100 text-slate-400 hover:text-slate-700'
                  : 'hover:bg-white/10 text-zinc-400 hover:text-zinc-100'
              }`}
              title="朗读原文"
            >
              <Volume2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                isLight
                  ? 'hover:bg-slate-100 text-slate-400 hover:text-slate-700'
                  : 'hover:bg-white/10 text-zinc-400 hover:text-zinc-100'
              }`}
              title="复制"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={hide}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                isLight
                  ? 'hover:bg-slate-100 text-slate-400 hover:text-slate-700'
                  : 'hover:bg-white/10 text-zinc-400 hover:text-zinc-100'
              }`}
              title="关闭 (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
          {isHover ? (
            <>
              {detail && (detail.pos || detail.definition) && (
                <div>
                  {detail.pos && (
                    <span
                      className={`inline-block mr-2 px-1.5 py-0.5 rounded text-[10px] font-mono italic ${
                        isLight
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/20'
                      }`}
                    >
                      {detail.pos}
                    </span>
                  )}
                  <span className={isLight ? 'text-slate-800' : 'text-zinc-100'}>
                    {detail.definition || '—'}
                  </span>
                  {detail.cgDomainNote && (
                    <span
                      className={`ml-1.5 text-[11px] ${
                        isLight ? 'text-sky-600' : 'text-sky-300/90'
                      }`}
                    >
                      {detail.cgDomainNote}
                    </span>
                  )}
                </div>
              )}
              {engines.map((e, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <span
                    className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      isLight
                        ? 'bg-slate-100 border border-slate-200 text-slate-500'
                        : 'bg-white/[0.06] border border-white/[0.08] text-zinc-400'
                    }`}
                  >
                    {e.engineName}
                  </span>
                  <span
                    className={`min-w-0 break-words ${
                      isLight ? 'text-slate-800' : 'text-zinc-100'
                    }`}
                  >
                    {e.translated}
                  </span>
                </div>
              ))}
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
            <div className="space-y-1">
              <div
                className={`font-semibold leading-relaxed break-words text-[15px] ${
                  isLight ? 'text-slate-900' : 'text-white'
                }`}
              >
                {payload.translation || '翻译中…'}
              </div>
              {payload.sourceTier && (
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    isLight
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-blue-500/15 text-blue-300 border border-blue-400/20'
                  }`}
                >
                  {payload.sourceTier}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div
          className={`px-3 pb-2 text-[10px] flex items-center justify-between ${
            isLight ? 'text-slate-400' : 'text-zinc-500'
          }`}
        >
          <span>{isHover ? '悬停取词 · 移开鼠标或点 ✕ 收起' : '划词翻译 · 移开鼠标或点 ✕ 收起'}</span>
          <span className="font-mono opacity-60">猫步翻译</span>
        </div>
      </div>
    </div>
  );
};
