import React, { useEffect, useState } from 'react';
import { Cpu, Download, X } from 'lucide-react';
import { useAppTheme } from '../hooks/useAppTheme';
import { cmdOfflineModelsStatus } from '../services/tauri';
import type { OfflineModelStatus } from '../services/types';

/**
 * 离线 OCR 模型新手引导弹窗。
 *
 * 触发条件（全部满足才出现，每个会话最多一次）：
 * 1. v6 Small / Tiny / Medium 均没有完整的「三件套」（det + rec + cls）——
 *    未装模型时 ONNX 不可用，OCR 会降到 WinRT；
 * 2. 本地存储中没有「不再提示」标记（勾选"不再提示"后永不再现）。
 *
 * 「去下载」跳到 设置 → 专业词库（该页内嵌 OCR 模型管理卡片）并滚动定位。
 */
const DISMISS_KEY = 'catwalk.ocrGuideDismissed';

/** 是否存在至少一个完整安装的模型版本（det + rec + cls 齐备）。 */
export function hasAnyCompleteModelSet(status: OfflineModelStatus[]): boolean {
  if (!status || status.length === 0) return false;
  const byVersion = new Map<string, { det: boolean; rec: boolean; cls: boolean }>();
  for (const m of status) {
    if (!m.installed || (m.version !== 'v6' && m.version !== 'v6t' && m.version !== 'v6m')) continue;
    const parts = byVersion.get(m.version) ?? { det: false, rec: false, cls: false };
    if (m.id.includes('-det')) parts.det = true;
    else if (m.id.includes('-rec')) parts.rec = true;
    else if (m.id.includes('-cls')) parts.cls = true;
    byVersion.set(m.version, parts);
  }
  for (const c of byVersion.values()) {
    if (c.det && c.rec && c.cls) return true;
  }
  return false;
}

export const OcrModelGuideModal: React.FC<{ onGoDownload: () => void; suppressed?: boolean }> = ({
  onGoDownload,
  suppressed = false,
}) => {
  const { isLight } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [dismissForever, setDismissForever] = useState(false);

  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1') {
          return;
        }
        if (checkedOnce) return; // 本会话已提示过
        const status = await cmdOfflineModelsStatus();
        if (cancelled) return;
        if (!hasAnyCompleteModelSet(status)) {
          setCheckedOnce(true);
          setOpen(true);
        }
      } catch {
        // 状态拉取失败（如非 Tauri 环境）静默跳过，不打扰用户
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkedOnce, suppressed]);

  const close = (forever: boolean) => {
    setOpen(false);
    if (forever && typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, '1');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4" data-testid="ocr-model-guide">
      <div className="vision-modal-backdrop absolute inset-0" onClick={() => close(false)} />
      <div
        className={`vision-modal-shell vision-modal-enter relative w-full max-w-md rounded-[26px] p-6 overflow-hidden ${
          isLight ? 'text-slate-800' : 'text-zinc-100'
        }`}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={() => close(false)}
          className={`absolute top-4 right-4 p-1.5 rounded-full transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
            isLight ? 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-700' : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-100'
          }`}
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent-text)] shadow-inner">
            <Cpu className="h-5 w-5" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)] mb-2">
            首次使用提示
          </div>
          <h2 className="text-base font-bold leading-snug text-[var(--g-text-1)]">尚未安装本地 OCR 识别模型</h2>
        </div>

        <div
          className={`mt-4 rounded-2xl border p-3.5 space-y-2 text-[12.5px] leading-relaxed ${
            isLight
              ? 'bg-white/65 border-slate-200/70 text-slate-600'
              : 'bg-white/[0.04] border-white/[0.08] text-zinc-300'
          }`}
        >
          <p>
            截图划词翻译由<b className="text-[var(--g-text-1)]">本地离线 PP-OCR 模型</b>
            执行识别，模型由您自己下载安装（不占安装包体积）。未安装时 OCR 会降级到系统内置识别——实测对 UI 小字几乎无法识别。
          </p>
          <p>
            推荐先下载 <b className="text-[var(--g-text-1)]">PP-OCRv6 Small</b>（约 31MB，默认均衡档）；
            Tiny 更快但复杂文字可能漏读，Medium 可按需试用。可在设置页下载并明确设置默认模型。
          </p>
        </div>

        <div className="mt-4 flex justify-center">
          <label
            className={`inline-flex items-center gap-2 text-[11.5px] cursor-pointer select-none rounded-full px-3 py-1 border transition ${
              isLight
                ? 'bg-white/75 border-slate-200/80 text-slate-600 hover:bg-white'
                : 'bg-white/[0.05] border-white/10 text-zinc-300 hover:bg-white/[0.09]'
            }`}
          >
            <input
              type="checkbox"
              checked={dismissForever}
              onChange={(e) => setDismissForever(e.target.checked)}
              className="accent-[var(--accent)] cursor-pointer"
            />
            不再提示
          </label>
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => close(dismissForever)}
            className={`flex-1 px-4 py-2 rounded-full text-xs font-semibold border transition cursor-pointer active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              isLight
                ? 'bg-white/85 border-slate-200/90 text-slate-600 hover:bg-white'
                : 'bg-white/[0.06] border-white/12 text-zinc-300 hover:bg-white/[0.12]'
            }`}
            data-testid="ocr-guide-dismiss"
          >
            稍后再说
          </button>
          <button
            type="button"
            data-testid="ocr-guide-download"
            onClick={() => {
              if (dismissForever && typeof window !== 'undefined') window.localStorage.setItem(DISMISS_KEY, '1');
              setOpen(false);
              onGoDownload();
            }}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-gradient-to-r from-[var(--accent)] to-indigo-600 text-white hover:brightness-110 transition cursor-pointer shadow-sm shadow-sky-500/20 active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)]"
          >
            <Download className="h-3.5 w-3.5" />
            去下载模型
          </button>
        </div>
      </div>
    </div>
  );
};
