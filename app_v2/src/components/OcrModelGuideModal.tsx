import React, { useEffect, useState } from 'react';
import { Cpu, Download, X } from 'lucide-react';
import { useAppTheme } from '../hooks/useAppTheme';
import { cmdOfflineModelsStatus } from '../services/tauri';
import type { OfflineModelStatus } from '../services/types';

/**
 * 离线 OCR 模型新手引导弹窗。
 *
 * 触发条件（全部满足才出现，每个会话最多一次）：
 * 1. 没有任何一个版本的 OCR 模型「三件套」（det + rec + cls）完整安装 ——
 *    未装模型时 ONNX 不可用，OCR 会降到 WinRT（实测在这类 UI 文本上 0% 识别率）;
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
    if (!m.installed || !m.version) continue;
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

export const OcrModelGuideModal: React.FC<{ onGoDownload: () => void }> = ({ onGoDownload }) => {
  const { isLight } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [dismissForever, setDismissForever] = useState(false);

  useEffect(() => {
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
  }, [checkedOnce]);

  const close = (forever: boolean) => {
    setOpen(false);
    if (forever && typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, '1');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4" data-testid="ocr-model-guide">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => close(false)} />
      <div
        className={`relative w-full max-w-md rounded-2xl border p-6 shadow-2xl overflow-hidden ${
          isLight
            ? 'bg-white/95 border-slate-200 text-slate-800'
            : 'bg-zinc-900/95 border-white/10 text-zinc-100'
        }`}
      >
        <button
          type="button"
          onClick={() => close(false)}
          className={`absolute top-3 right-3 p-1.5 rounded-lg transition cursor-pointer ${
            isLight ? 'text-slate-400 hover:bg-slate-100' : 'text-zinc-500 hover:bg-white/5'
          }`}
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>

        <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold mb-3 ${
          isLight ? 'bg-blue-500/10 text-blue-600' : 'bg-blue-500/15 text-blue-400'
        }`}>
          <Cpu className="h-3.5 w-3.5" />
          首次使用提示
        </div>

        <h2 className="text-base font-bold leading-snug">尚未安装本地 OCR 识别模型</h2>

        <div className={`mt-2.5 space-y-2 text-[12.5px] leading-relaxed ${
          isLight ? 'text-slate-600' : 'text-zinc-400'
        }`}>
          <p>
            截图划词翻译由<b className={isLight ? 'text-slate-900' : 'text-zinc-100'}>本地离线 PP-OCR 模型</b>
            执行识别，模型由您自己下载安装（不占安装包体积）。未安装时 OCR 会降级到系统
            内置识别——实测对 UI 小字几乎无法识别。
          </p>
          <p>
            推荐下载 <b className={isLight ? 'text-slate-900' : 'text-zinc-100'}>PP-OCRv6 Tiny</b>（约 6.3MB，
            实测最快：划词场景平均 7.3ms/词且 12/12 全对），也可在设置页对比其他版本。
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <label className={`flex items-center gap-2 text-[11.5px] cursor-pointer select-none ${
            isLight ? 'text-slate-500' : 'text-zinc-500'
          }`}>
            <input
              type="checkbox"
              checked={dismissForever}
              onChange={(e) => setDismissForever(e.target.checked)}
              className="accent-blue-500"
            />
            不再提示
          </label>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => close(dismissForever)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border transition cursor-pointer ${
                isLight
                  ? 'border-slate-300 text-slate-600 hover:bg-slate-100'
                  : 'border-white/15 text-zinc-300 hover:bg-white/5'
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
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 transition cursor-pointer shadow-sm"
            >
              <Download className="h-3.5 w-3.5" />
              去下载模型
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
