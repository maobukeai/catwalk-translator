import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  CheckCircle2,
  Trash2,
  Cpu,
  AlertTriangle,
  Sparkles,
  Zap,
  Layers,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import {
  cmdOfflineModelsStatus,
  cmdDownloadOfflineModel,
  cmdDeleteOfflineModel,
  cmdGetActiveOcrVersion,
  cmdSwitchOcrVersion,
  isTauri,
  type OfflineModelStatus,
} from '../../services/tauri';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface ProgressInfo {
  received: number;
  total: number;
  done?: boolean;
}

type OcrVersion = 'v6' | 'v6t' | 'v6m';

interface VersionTabConfig {
  id: OcrVersion;
  label: string;
  badge: string;
  badgeColor: string;
  desc: string;
  recommendNote: string;
}

const VERSION_CONFIGS: VersionTabConfig[] = [
  {
    id: 'v6',
    label: 'PP-OCRv6 Small',
    badge: '均衡 · 精度优先',
    badgeColor: 'bg-amber-500/15 text-amber-500 border-amber-400/30',
    desc: '精度优先 · 约 31MB；复杂界面仍可能漏字，必要时与 Tiny / 系统 OCR 局部互补',
    recommendNote: '精度优先',
  },
  {
    id: 'v6t',
    label: 'PP-OCRv6 Tiny',
    badge: '最快 · 6MB',
    badgeColor: 'bg-cyan-500/15 text-cyan-500 border-cyan-400/30',
    desc: '速度优先 · 约 6MB；密排小字可能漏读，必要时由 Small / 系统 OCR 局部复查',
    recommendNote: '速度优先',
  },
  {
    id: 'v6m',
    label: 'PP-OCRv6 Medium',
    badge: '可选 · 密集文字',
    badgeColor: 'bg-violet-500/15 text-violet-500 border-violet-400/30',
    desc: '约 139MB；终端密集文字可能更准，但 CPU 速度明显慢，其他截图不一定优于 Small。仅建议按需启用。',
    recommendNote: '高精度试用',
  },
];

const getModelVersion = (m: OfflineModelStatus): OcrVersion | null => {
  if (
    m.version === 'v6' ||
    m.version === 'v6t' ||
    m.version === 'v6m'
  ) {
    return m.version;
  }
  // 后备匹配按长前缀优先，避免 Medium/Tiny 被归到 Small。
  if (m.id.includes('v6m') || m.fileName.includes('v6_medium')) return 'v6m';
  if (m.id.includes('v6t') || m.fileName.includes('v6_tiny')) return 'v6t';
  if (m.id.includes('v6') || m.fileName.includes('v6')) return 'v6';
  return null;
};

/**
 * Local OCR model manager: supports PP-OCRv6 Tiny / Small / Medium
 * multi-version switching, streaming progress download, Windows lock-safe deletion,
 * and hot reloading without client restart.
 */
export const OcrModelsCard: React.FC = () => {
  const { isLight } = useAppTheme();
  const setOcrDefaultModel = useSettingsStore((s) => s.setOcrDefaultModel);
  const ocrEngine = useSettingsStore((s) => s.settings.ocrEngine);
  const [models, setModels] = useState<OfflineModelStatus[]>([]);
  const [activeVersion, setActiveVersion] = useState<OcrVersion>('v6');
  const [selectedTab, setSelectedTab] = useState<OcrVersion>('v6');
  const [progress, setProgress] = useState<Record<string, ProgressInfo>>({});
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedSelection = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const fetchedModels = await cmdOfflineModelsStatus();
      let activeVer: string = 'v6';
      try {
        const rawVer = await cmdGetActiveOcrVersion();
        if (typeof rawVer === 'string' && rawVer.trim().length > 0) {
          activeVer = rawVer.trim();
        }
      } catch {
        activeVer = 'v6';
      }

      setModels(fetchedModels || []);

      let cleanActive: OcrVersion = 'v6';
      const lower = activeVer.toLowerCase();
      // Longer variant names must be checked before plain v6.
      if (lower.includes('v6m')) cleanActive = 'v6m';
      else if (lower.includes('v6t')) cleanActive = 'v6t';
      else if (lower.includes('v6')) cleanActive = 'v6';
      else cleanActive = 'v6';
      if (!initializedSelection.current) {
        setSelectedTab(cleanActive);
        initializedSelection.current = true;
      }

      // If only one supported version is returned, show that version immediately.
      // align activeVersion and selectedTab to that version so they are instantly visible.
      if (fetchedModels && fetchedModels.length > 0) {
        const versionsPresent = Array.from(
          new Set(fetchedModels.map((m) => getModelVersion(m)).filter((v): v is OcrVersion => v !== null))
        );
        if (versionsPresent.length === 1) {
          cleanActive = versionsPresent[0];
          setSelectedTab(versionsPresent[0]);
        } else {
          const hasSelectedModels = fetchedModels.some(
            (m) => getModelVersion(m) === selectedTab
          );
          if (!hasSelectedModels) {
            setSelectedTab(cleanActive);
          }
        }
      }

      setActiveVersion(cleanActive);
    } catch (err) {
      console.warn('OCR model status failed:', err);
    }
  }, [selectedTab]);

  useEffect(() => {
    void refresh();
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    try {
      listen<{ modelId: string; received: number; total: number; done?: boolean }>(
        'model-download-progress',
        (event) => {
          const p = event.payload;
          if (!p?.modelId) return;
          setProgress((prev) => ({
            ...prev,
            [p.modelId]: { received: p.received, total: p.total, done: p.done },
          }));
        }
      )
        .then((u) => {
          unlisten = u;
        })
        .catch(() => {});
    } catch {
      // ignore
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleDownload = async (id: string) => {
    setError(null);
    setProgress((prev) => ({ ...prev, [id]: { received: 0, total: 0 } }));
    try {
      await cmdDownloadOfflineModel(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 120) : String(err));
    } finally {
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await cmdDeleteOfflineModel(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 120) : String(err));
    }
  };

  const handleSwitchVersion = async (version: OcrVersion) => {
    setError(null);
    try {
      const switched = await cmdSwitchOcrVersion(version);
      if (!switched) {
        setError(`PP-OCR${version.toUpperCase()} 模型未完整安装，请先下载该版本的检测与识别模型。`);
        await refresh();
        return;
      }
      setActiveVersion(version);
      setOcrDefaultModel(version);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 120) : String(err));
    }
  };

  const handleDownloadAll = async (version: OcrVersion) => {
    const toDownload = models.filter(
      (m) => getModelVersion(m) === version && !m.installed && !progress[m.id]
    );
    if (toDownload.length === 0) return;
    setIsBatchDownloading(true);
    setError(null);
    try {
      for (const m of toDownload) {
        setProgress((prev) => ({ ...prev, [m.id]: { received: 0, total: 0 } }));
        try {
          await cmdDownloadOfflineModel(m.id);
        } finally {
          setProgress((prev) => {
            const next = { ...prev };
            delete next[m.id];
            return next;
          });
        }
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBatchDownloading(false);
    }
  };

  const activeTabModels = models.filter((m) => getModelVersion(m) === selectedTab);
  const activeTabInstalledCount = activeTabModels.filter((m) => m.installed).length;
  const isActiveTabFullyInstalled =
    activeTabModels.length > 0 && activeTabInstalledCount === activeTabModels.length;
  const isCurrentTabActive = activeVersion === selectedTab && ocrEngine !== 'winrt';

  const currentTabConfig =
    VERSION_CONFIGS.find((c) => c.id === selectedTab) || VERSION_CONFIGS[0];

  return (
    <div
      className="rounded-xl border p-4 space-y-4 shadow-sm"
      id="ocr-models-card-anchor"
      data-testid="ocr-models-card"
      style={{
        borderColor: isLight ? 'rgba(148,163,184,0.35)' : 'rgba(255,255,255,0.12)',
        background: isLight ? 'rgba(241,245,249,0.65)' : 'rgba(255,255,255,0.03)',
      }}
    >
      {/* ── Card Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-violet-600/10 text-violet-500 border border-violet-500/20">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-slate-800 dark:text-slate-100">
                离线 OCR 引擎模型管理
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  VERSION_CONFIGS.find((c) => c.id === activeVersion)?.badgeColor ??
                  'bg-blue-500/15 text-blue-500 border-blue-400/30'
                }`}
              >
              当前默认:{' '}
                {VERSION_CONFIGS.find((c) => c.id === activeVersion)?.label ??
                  activeVersion.toUpperCase()}
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--g-text-3)' }}>
              基于 Rust 原生 ONNX Runtime 推理，纯离线零外网依赖，支持多版本热切换
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer hover:bg-white/5"
          title="刷新模型状态"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Version Tabs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {VERSION_CONFIGS.map((cfg) => {
          const tabModels = models.filter((m) => getModelVersion(m) === cfg.id);
          const installedCount = tabModels.filter((m) => m.installed).length;
          const isFullyInstalled = tabModels.length > 0 && installedCount === tabModels.length;
          const isSelected = selectedTab === cfg.id;
          const isThisActive = activeVersion === cfg.id;

          return (
            <button
              key={cfg.id}
              type="button"
              onClick={() => {
                initializedSelection.current = true;
                setSelectedTab(cfg.id);
              }}
              className={`flex flex-col p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer relative overflow-hidden ${
                isThisActive
                  ? (isLight
                      ? 'border-emerald-500/80 bg-emerald-50/70 shadow-sm ring-2 ring-emerald-500/20'
                      : 'border-emerald-500/80 bg-emerald-500/10 shadow-sm ring-2 ring-emerald-500/20')
                  : isSelected
                  ? (isLight
                      ? 'border-violet-500 bg-violet-50/60 shadow-xs'
                      : 'border-violet-500/80 bg-violet-600/10 shadow-xs')
                  : (isLight
                      ? 'border-slate-200/90 hover:border-slate-300 bg-white/70 hover:bg-white'
                      : 'border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.05]')
              }`}
            >
              <div className="flex items-center justify-between gap-1 w-full">
                <span
                  className={`text-xs font-bold ${
                    isThisActive
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isSelected
                      ? 'text-violet-600 dark:text-violet-400'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {cfg.label}
                </span>
                {isThisActive ? (
                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 flex items-center gap-1 shadow-2xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    当前默认
                  </span>
                ) : isFullyInstalled ? (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                    可设默认
                  </span>
                ) : (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    需下载
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-1 mt-2 w-full">
                <span className="text-[10px]" style={{ color: 'var(--g-text-3)' }}>
                  {cfg.recommendNote}
                </span>
                <span className="text-[10.5px] font-mono font-medium text-slate-500 dark:text-slate-400">
                  {tabModels.length > 0 ? `${installedCount}/${tabModels.length}` : '0/3'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Current Version Banner & Actions ── */}
      <div
        className="rounded-lg p-3 border flex items-center justify-between gap-3 flex-wrap"
        style={{
          background: isLight ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.2)',
          borderColor: isLight ? 'rgba(148,163,184,0.3)' : 'rgba(255,255,255,0.08)',
        }}
      >
        <div className="space-y-0.5 flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {currentTabConfig.label}
            </span>
            <span
              className={`text-[9.5px] px-2 py-0.5 rounded-full border font-medium ${currentTabConfig.badgeColor}`}
            >
              {currentTabConfig.badge}
            </span>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--g-text-3)' }}>
            {currentTabConfig.desc}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Switch Active Version Button */}
          {isActiveTabFullyInstalled && !isCurrentTabActive && (
            <button
              type="button"
              onClick={() => void handleSwitchVersion(selectedTab)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer shadow-sm"
              title={`将 ${currentTabConfig.label} 设为当前 OCR 推理版本`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>设为默认并启用</span>
            </button>
          )}

          {isCurrentTabActive && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-500 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="h-3.5 w-3.5" />
              当前默认并使用
            </span>
          )}

          {/* Download Entire Set Button */}
          {!isActiveTabFullyInstalled && (
            <button
              type="button"
              disabled={isBatchDownloading}
              onClick={() => void handleDownloadAll(selectedTab)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title="仅下载 det + rec + cls；下载完成后可手动设为默认"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isBatchDownloading ? '下载中...' : '一键下载整套'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Models List for Current Version ── */}
      <div className="space-y-2.5">
        {activeTabModels.map((m) => {
          const p = progress[m.id];
          const pct =
            p && p.total > 0
              ? Math.min(100, Math.round((p.received / p.total) * 100))
              : 0;

          return (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 p-2.5 rounded-lg border transition-colors"
              data-testid={`ocr-model-${m.id}`}
              style={{
                borderColor: isLight
                  ? 'rgba(148,163,184,0.25)'
                  : 'rgba(255,255,255,0.06)',
                background: isLight
                  ? 'rgba(255,255,255,0.5)'
                  : 'rgba(255,255,255,0.02)',
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {m.name}
                  </span>
                  <span
                    className="text-[10px] font-mono"
                    style={{ color: 'var(--g-text-3)' }}
                  >
                    {((m.installed ? m.sizeBytes : m.approxBytes) / 1_000_000).toFixed(1)} MB
                  </span>
                  {m.installed ? (
                    <span
                      className="text-[10px] font-bold text-emerald-500 flex items-center gap-1"
                      data-testid={`ocr-status-${m.id}`}
                    >
                      <CheckCircle2 className="h-3 w-3" /> 已安装
                    </span>
                  ) : (
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--g-text-3)' }}
                      data-testid={`ocr-status-${m.id}`}
                    >
                      未下载
                    </span>
                  )}
                </div>

                <div
                  className="text-[10px] font-mono truncate mt-0.5"
                  style={{ color: 'var(--g-text-3)' }}
                  title={m.fileName}
                >
                  {m.fileName}
                </div>

                {p && (
                  <div
                    className="mt-1.5 h-1.5 rounded-full overflow-hidden"
                    style={{
                      background: isLight
                        ? 'rgba(148,163,184,0.3)'
                        : 'rgba(255,255,255,0.1)',
                    }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      data-testid={`ocr-progress-${m.id}`}
                      style={{
                        width: `${pct}%`,
                        background: 'linear-gradient(90deg,#8b5cf6,#6366f1)',
                      }}
                    />
                  </div>
                )}
              </div>

              {m.installed ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleDelete(m.id);
                  }}
                  className="p-1.5 rounded-lg transition cursor-pointer hover:bg-rose-500/10"
                  style={{ color: 'var(--danger, #f43f5e)' }}
                  title="删除已下载的模型文件"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleDownload(m.id);
                  }}
                  disabled={!!p || isBatchDownloading}
                  data-testid={`ocr-download-${m.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  title="从镜像下载（hf-mirror 优先）"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{p ? `${pct}%` : '下载'}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div
          className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-400"
          data-testid="ocr-models-error"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </div>
  );
};
