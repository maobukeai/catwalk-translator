import React, { useState } from 'react';
import { Activity, RefreshCw, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { cmdNetworkDiagnose, type DiagItem } from '../../../services/tauri';
import { useAppTheme } from '../../../hooks/useAppTheme';

const KIND_LABEL: Record<string, string> = {
  engine: '在线引擎',
  llm: 'LLM 端点',
  update: '更新/数据源',
  proxy: '代理',
};

/** 网络诊断卡片：并发探测各引擎/端点可达性与延迟，区分网络问题与配置问题 */
export const NetworkDiagCard: React.FC = () => {
  const { isLight } = useAppTheme();
  const [items, setItems] = useState<DiagItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setItems(null);
    try {
      setItems(await cmdNetworkDiagnose());
    } catch (e) {
      console.warn('网络诊断失败:', e);
    } finally {
      setBusy(false);
    }
  };

  const latencyColor = (ms: number, ok: boolean) =>
    !ok ? 'text-rose-500' : ms < 500 ? 'text-emerald-500' : ms < 1500 ? 'text-amber-500' : 'text-orange-500';

  return (
    <div className={`rounded-2xl border p-4 ${
      isLight ? 'bg-white/70 border-slate-200' : 'bg-zinc-900/40 border-white/[0.07]'
    }`} data-testid="network-diag-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-500" />
          <span className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>网络诊断</span>
          <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
            翻译全挂？先看这里区分网络问题与配置问题
          </span>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer disabled:opacity-50 ${
            isLight
              ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
              : 'bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border-white/10'
          }`}
          data-testid="network-diag-run"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
          {busy ? '探测中…' : items ? '重新诊断' : '开始诊断'}
        </button>
      </div>

      {items && (
        <div className="space-y-1" data-testid="network-diag-results">
          {items.map((it) => (
            <div
              key={it.name}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                isLight ? 'border-slate-200 bg-slate-50/60' : 'border-white/[0.05] bg-white/[0.02]'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {it.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                )}
                <span className={`shrink-0 font-semibold ${isLight ? 'text-slate-700' : 'text-zinc-200'}`}>
                  {it.name}
                </span>
                <span className={`shrink-0 rounded px-1 text-[9px] ${
                  isLight ? 'bg-slate-200/70 text-slate-500' : 'bg-white/[0.06] text-zinc-500'
                }`}>
                  {KIND_LABEL[it.kind] || it.kind}
                </span>
                <span className={`min-w-0 truncate text-[10.5px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                  {it.detail}
                </span>
              </div>
              <span className={`shrink-0 font-mono text-[11px] font-bold ${latencyColor(it.latencyMs, it.ok)}`}>
                {it.kind === 'proxy' ? <ArrowRight className="h-3 w-3" /> : `${it.latencyMs}ms`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
