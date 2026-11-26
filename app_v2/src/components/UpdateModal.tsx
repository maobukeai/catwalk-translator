import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Download, CheckCircle2, AlertCircle, ExternalLink, X, Zap, Loader2,
  ShieldCheck, RefreshCw, Rocket,
} from 'lucide-react';
import { useAppTheme } from '../hooks/useAppTheme';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  cmdDownloadAndInstallUpdate,
  cmdOpenExternalUrl,
  onUpdateDownloadProgress,
} from '../services/tauri';
import type { UpdateInfo, UpdateDownloadProgress } from '../services/types';
import { APP_VERSION } from '../version';

export interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose, updateInfo }) => {
  const { isLight } = useAppTheme();
  const { settings, setAutoSilentUpdate } = useSettingsStore();

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useSilent, setUseSilent] = useState<boolean>(settings.autoSilentUpdate ?? false);

  useEffect(() => {
    setUseSilent(settings.autoSilentUpdate ?? false);
  }, [settings.autoSilentUpdate]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isOpen) {
      onUpdateDownloadProgress((p) => {
        setProgress(p);
        if (p.stage.startsWith('error:')) {
          setError(p.stage.replace(/^error:\s*/, ''));
          setDownloading(false);
        }
      }).then((u) => {
        if (disposed) u();
        else unlisten = u;
      }).catch(() => {});
    }
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [isOpen]);

  if (!isOpen || !updateInfo) {
    return null;
  }

  // 优先选取 setup.exe 安装包直链，未找到则回退默认 download_url
  const preferredAsset = (updateInfo.assets || []).find(
    (a: { name: string; url: string }) => a.name.toLowerCase().endsWith('-setup.exe')
  );
  const targetDownloadUrl = preferredAsset?.url || updateInfo.download_url;

  const handleStartUpdate = async () => {
    setError(null);
    setDownloading(true);
    setProgress({
      percentage: 0,
      downloadedBytes: 0,
      totalBytes: preferredAsset?.size || 0,
      speedBytesPerSec: 0,
      stage: 'downloading',
    });

    try {
      await cmdDownloadAndInstallUpdate(targetDownloadUrl, useSilent, {
        sha256: preferredAsset?.sha256 ?? updateInfo.sha256,
        expectedSize: preferredAsset?.size,
      });
    } catch (err: any) {
      setError(err?.message || String(err));
      setDownloading(false);
    }
  };

  const handleOpenBrowser = () => {
    void cmdOpenExternalUrl(updateInfo.download_url || targetDownloadUrl);
  };

  const isInstalling = progress?.stage === 'installing' || (progress?.percentage ?? 0) >= 100;

  return (
    <div
      className="vision-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200"
      data-testid="update-modal-backdrop"
    >
      <div
        className={`vision-modal-shell vision-modal-enter relative w-full max-w-lg rounded-[26px] overflow-hidden transition-all ${
          isLight ? 'text-slate-800' : 'text-zinc-100'
        }`}
        data-testid="update-modal-dialog"
        role="dialog"
        aria-modal="true"
      >
        {!downloading && (
          <button
            type="button"
            onClick={onClose}
            className={`absolute top-4 right-4 p-1.5 rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              isLight ? 'hover:bg-slate-200/70 text-slate-400 hover:text-slate-700' : 'hover:bg-white/10 text-zinc-400 hover:text-zinc-200'
            }`}
            title="稍后提醒"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* 居中对称 Sheet 头部 */}
        <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center">
          <div className="mb-3 h-12 w-12 rounded-2xl bg-gradient-to-br from-[var(--accent)] to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/25">
            <Rocket className="w-5 h-5" />
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h3 className="text-base font-bold tracking-tight text-[var(--g-text-1)]">
              发现新版本可用
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)]">
              v{updateInfo.version}
            </span>
          </div>
          <p className="text-xs mt-1 text-[var(--g-text-3)]">
            当前版本: v{APP_VERSION} {updateInfo.release_date && `· 发布于 ${updateInfo.release_date.slice(0, 10)}`}
          </p>
        </div>

        {/* 更新内容说明区 */}
        <div className="px-6 pb-4">
          <div
            className={`p-3.5 rounded-2xl border text-xs leading-relaxed max-h-48 overflow-y-auto ${
              isLight
                ? 'bg-white/65 border-slate-200/80 text-slate-700'
                : 'bg-white/[0.04] border-white/[0.08] text-zinc-300'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold mb-1.5 text-[var(--accent-text)]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>更新亮点与更新日志</span>
            </div>
            <div className="whitespace-pre-wrap font-sans opacity-95">
              {updateInfo.release_notes || '本次更新包含性能提升与已知问题修复，建议立即升级体验最新特性。'}
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="px-6 pb-3">
            <div className="flex items-start gap-2.5 p-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">下载或升级过程中出现异常</div>
                <div className="mt-0.5 text-[11px] leading-tight break-all opacity-90">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* 下载中进度状态 */}
        {downloading && progress && (
          <div className="px-6 pb-5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold flex items-center gap-1.5">
                {isInstalling ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-[var(--accent)] animate-spin" />
                    <span>{useSilent ? '正在自动静默安装并重启...' : '正在启动安装向导...'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 text-[var(--accent)] animate-bounce" />
                    <span>正在高速下载更新包...</span>
                  </>
                )}
              </span>
              <span className="font-mono font-bold text-[var(--accent-text)]">
                {progress.percentage.toFixed(1)}%
              </span>
            </div>

            {/* 进度条轨道 */}
            <div
              className={`h-2.5 w-full rounded-full overflow-hidden p-0.5 border ${
                isLight ? 'bg-slate-200/70 border-slate-200' : 'bg-white/[0.06] border-white/[0.10]'
              }`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-indigo-500 transition-all duration-150 relative overflow-hidden"
                style={{ width: `${Math.max(3, Math.min(100, progress.percentage))}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-[shimmer_1.5s_infinite] -skew-x-12" />
              </div>
            </div>

            {/* 下载详情：已下/总大小 + 速度 */}
            <div className="flex items-center justify-between text-[11px] font-mono text-[var(--g-text-3)]">
              <span>
                {formatBytes(progress.downloadedBytes)}
                {progress.totalBytes > 0 && ` / ${formatBytes(progress.totalBytes)}`}
              </span>
              {progress.speedBytesPerSec > 0 && !isInstalling && (
                <span className="text-emerald-500 font-semibold">
                  {formatBytes(progress.speedBytesPerSec)}/s
                </span>
              )}
            </div>
          </div>
        )}

        {/* 底部控制栏：Mac Sheet 全圆角胶囊按钮组 */}
        <div
          className={`p-5 pt-3.5 border-t border-[var(--g-hairline)] flex flex-col gap-3 ${
            isLight ? 'bg-white/40' : 'bg-white/[0.02]'
          }`}
        >
          {/* 静默更新勾选框 */}
          {!downloading && (
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useSilent}
                  onChange={(e) => {
                    setUseSilent(e.target.checked);
                    setAutoSilentUpdate(e.target.checked);
                  }}
                  className="rounded accent-[var(--accent)] h-3.5 w-3.5 cursor-pointer"
                  data-testid="update-modal-silent-checkbox"
                />
                <span className="text-xs font-medium text-[var(--g-text-2)]">
                  全自动静默无感升级（免点击下一步，自动重启新版）
                </span>
              </label>

              <button
                type="button"
                onClick={handleOpenBrowser}
                className="text-[11px] flex items-center gap-1 text-[var(--g-text-3)] hover:text-[var(--accent-text)] hover:underline cursor-pointer shrink-0"
                title="在默认浏览器中打开 GitHub Release"
              >
                <span>网页下载</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 操作按钮组 */}
          <div className="flex items-center gap-2.5">
            {!downloading ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className={`flex-1 px-4 py-2 rounded-full text-xs font-semibold transition-colors cursor-pointer border active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                    isLight
                      ? 'bg-white/85 border-slate-200/90 hover:bg-white text-slate-600'
                      : 'bg-white/[0.06] border-white/[0.12] hover:bg-white/[0.12] text-zinc-300'
                  }`}
                  data-testid="update-modal-cancel-btn"
                >
                  稍后提醒
                </button>

                <button
                  type="button"
                  onClick={handleStartUpdate}
                  className="flex-1 px-5 py-2 rounded-full text-xs font-bold text-white bg-gradient-to-r from-[var(--accent)] to-indigo-600 hover:brightness-110 active:scale-97 transition-all shadow-sm shadow-sky-500/25 flex items-center justify-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)]"
                  data-testid="update-modal-install-btn"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>{useSilent ? '极速静默升级' : '立即下载更新'}</span>
                </button>
              </>
            ) : (
              <div className="w-full flex items-center justify-between">
                <span className="text-xs text-[var(--g-text-3)]">
                  {isInstalling ? '升级完成前请勿强制关闭计算机' : '已自动接入全球 CDN 加速镜像'}
                </span>
                {error && (
                  <button
                    type="button"
                    onClick={handleStartUpdate}
                    className="px-4 py-1.5 rounded-full text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>重试</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
