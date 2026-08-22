import React, { useEffect, useState } from 'react';
import { BookOpen, Download, Trash2, Loader2 } from 'lucide-react';
import {
  cmdGeneralDictStatus,
  cmdGeneralDictInstall,
  cmdGeneralDictUninstall,
  type GeneralDictStatus,
} from '../../../services/tauri';
import { useAppTheme } from '../../../hooks/useAppTheme';

/**
 * 通用离线英汉词典（ECDICT，MIT）卡片：
 * 一次性下载完整库（~63MB）→ 本地精简为高频词条缓存（仅数 MB），
 * 之后查普通英文单词完全离线秒出（自动并入查词与翻译优先级链路）。
 */
export const GeneralDictCard: React.FC = () => {
  const { isLight } = useAppTheme();
  const [status, setStatus] = useState<GeneralDictStatus>({ installed: false, entries: 0, installedAt: '' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cmdGeneralDictStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await cmdGeneralDictInstall((downloaded, total, phase, detail) => {
        setProgress(phase === 'download' ? `下载中 ${detail}` : phase === 'parse' ? '解析筛选高频词条…' : detail);
      });
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const uninstall = async () => {
    setBusy(true);
    try {
      await cmdGeneralDictUninstall();
      setStatus({ installed: false, entries: 0, installedAt: '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-2xl border p-4 ${
      isLight ? 'bg-white/70 border-slate-200' : 'bg-zinc-900/40 border-white/[0.07]'
    }`} data-testid="general-dict-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 text-sky-500" />
          <span className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>通用离线英汉词典</span>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-medium ${
            status.installed
              ? isLight ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
              : isLight ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white/[0.05] border-white/10 text-zinc-500'
          }`}>
            {status.installed ? `已安装 · ${status.entries.toLocaleString()} 词条` : '未安装'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status.installed ? (
            <button
              type="button"
              onClick={() => void uninstall()}
              disabled={busy}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer disabled:opacity-50 ${
                isLight
                  ? 'bg-slate-100 hover:bg-rose-50 text-rose-600 border-slate-300'
                  : 'bg-white/[0.06] hover:bg-rose-500/15 text-rose-400 border-white/10'
              }`}
            >
              <Trash2 className="h-3 w-3" />
              卸载
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void install()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 px-3 py-1.5 text-[11px] font-bold text-white transition cursor-pointer disabled:opacity-60 border border-sky-400/30 shadow-lg shadow-sky-500/20"
              data-testid="general-dict-install"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              {busy ? '安装中…' : '下载安装 (~63MB)'}
            </button>
          )}
        </div>
      </div>

      <p className={`text-[11px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
        收录 ECDICT（MIT 协议）高频英汉词条。安装后查询普通英文单词无需联网——
        CG 专业词库未命中时自动走该词典，查词页与划词翻译均生效。首次安装需下载完整词库并本地精简，之后不再消耗流量。
      </p>

      {progress && (
        <div className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] ${
          isLight ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-sky-400/30 bg-sky-500/10 text-sky-300'
        }`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="font-mono">{progress}</span>
        </div>
      )}
      {error && (
        <div className={`mt-2 rounded-lg border px-3 py-1.5 text-[11px] ${
          isLight ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-rose-400/30 bg-rose-500/10 text-rose-400'
        }`}>
          安装失败：{error}（可稍后重试，或检查代理设置）
        </div>
      )}
      {status.installed && status.installedAt && (
        <p className={`mt-2 text-[10px] font-mono ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>
          安装于 {status.installedAt} · 数据来源 github.com/skywind3000/ECDICT (MIT)
        </p>
      )}
    </div>
  );
};
