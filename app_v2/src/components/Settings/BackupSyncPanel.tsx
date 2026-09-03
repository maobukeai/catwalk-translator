import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Upload,
  CloudUpload,
  CloudDownload,
  Cloud,
  Trash2,
  History,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Check,
  Settings2,
  KeyRound,
  BookMarked,
  BookOpen,
  Camera,
  ListChecks,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
  isTauri,
  cmdExportBackupBase64,
  cmdImportBackupBase64,
  cmdWebdavTest,
  cmdWebdavUpload,
  cmdWebdavList,
  cmdWebdavRestore,
  cmdWebdavDelete,
} from '../../services/tauri';
import type { RemoteBackupEntry, WebdavConfig } from '../../services/types';

export interface BackupScopeItem {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  sensitive?: boolean;
}

export const BACKUP_SCOPE_ITEMS: BackupScopeItem[] = [
  {
    id: 'settings',
    label: '基础设置与外观',
    desc: '主题、快捷键、窗口置顶/透明度及交互行为',
    icon: Settings2,
  },
  {
    id: 'api_keys',
    label: 'API 密钥与 AI 配置',
    desc: '各大在线翻译引擎密钥、LLM Key 与自定义端点',
    icon: KeyRound,
    sensitive: true,
  },
  {
    id: 'custom_dict',
    label: '专业词库与过滤规则',
    desc: '用户自定义术语对照表及 OCR 过滤正则规则',
    icon: BookMarked,
  },
  {
    id: 'history',
    label: '查词历史与生词本',
    desc: '历史翻译查词记录与收藏的生词本单词',
    icon: BookOpen,
  },
  {
    id: 'capture_sessions',
    label: '截图翻译历史会话',
    desc: '截图 OCR 识别文本、位置选区与翻译结果',
    icon: Camera,
  },
];

export const DEFAULT_INCLUDED_ITEMS = [
  'settings',
  'api_keys',
  'custom_dict',
  'history',
  'capture_sessions',
];

export const ITEM_NAME_MAP: Record<string, string> = {
  settings: '设置',
  api_keys: '密钥',
  custom_dict: '词库',
  history: '生词本',
  capture_sessions: '截图',
};

const errText = (err: unknown): string =>
  typeof err === 'string' ? err : (err as Error)?.message || '操作失败，请重试';

const pad2 = (n: number): string => String(n).padStart(2, '0');

function formatMs(ms?: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function localStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const CLOUD_DAYS_OPTIONS = [7, 15, 30, 90].map((d) => ({ value: d, label: `${d} 天` }));

interface ConfirmState {
  title: string;
  body: string;
  danger?: boolean;
  confirmLabel?: string;
  action: () => Promise<void>;
}

/**
 * 备份与同步设置面板：备份范围勾选、WebDAV 云端同步与离线数据迁移。
 */
export const BackupSyncPanel: React.FC = () => {
  const { isLight } = useAppTheme();
  const settings = useSettingsStore((s) => s.settings);
  const setBackupSettings = useSettingsStore((s) => s.setBackupSettings);
  const setWebdavConfig = useSettingsStore((s) => s.setWebdavConfig);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  const desktop = isTauri();
  const backupSettings = settings.backupSettings;
  const webdavConfig = settings.webdavConfig;

  // ── 面板通知与忙碌状态 ──
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // ── WebDAV 状态 ──
  const [remoteEntries, setRemoteEntries] = useState<RemoteBackupEntry[] | null>(null);
  const [remoteExpanded, setRemoteExpanded] = useState(false);

  // WebDAV 表单（支持明文直显与小眼睛切换）
  const [wdUrl, setWdUrl] = useState('');
  const [wdUser, setWdUser] = useState('');
  const [wdPass, setWdPass] = useState('');
  const [showWdPass, setShowWdPass] = useState(true);
  const [wdDir, setWdDir] = useState('MaobuTranslator');
  const [wdDays, setWdDays] = useState(15);
  const [wdHasSavedPass, setWdHasSavedPass] = useState(false);
  const [webdavReady, setWebdavReady] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4200);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  // 表单随已保存配置回填
  useEffect(() => {
    setWdUrl(webdavConfig?.url || '');
    setWdUser(webdavConfig?.username || '');
    setWdPass(webdavConfig?.password || '');
    setWdDir(webdavConfig?.remoteDir || 'MaobuTranslator');
    setWdDays(webdavConfig?.retentionDays ?? 15);
    setWdHasSavedPass(Boolean(webdavConfig?.password));
    setWebdavReady(
      Boolean(webdavConfig?.url?.trim()) &&
        Boolean(webdavConfig?.username?.trim()) &&
        Boolean(webdavConfig?.password)
    );
  }, [webdavConfig]);

  // 恢复/导入完成后由 Rust 广播，兜底刷新界面
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('app:settings-restored', () => {
          void fetchSettings();
        })
      )
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {
        /* event channel unavailable in browser mode */
      });
    return () => {
      unlisten?.();
    };
  }, [fetchSettings]);

  // ── 备份清单范围 ──
  const currentIncludedItems =
    backupSettings?.includedItems && backupSettings.includedItems.length > 0
      ? backupSettings.includedItems
      : DEFAULT_INCLUDED_ITEMS;

  const handleToggleScopeItem = (id: string) => {
    const next = currentIncludedItems.includes(id)
      ? currentIncludedItems.filter((i) => i !== id)
      : [...currentIncludedItems, id];
    if (next.length === 0) {
      notify('err', '备份清单至少需要保留 1 项');
      return;
    }
    setBackupSettings({ includedItems: next });
  };

  const handleApplyPreset = (type: 'all' | 'recommended' | 'safe') => {
    let next: string[] = [];
    if (type === 'all') {
      next = DEFAULT_INCLUDED_ITEMS;
    } else if (type === 'recommended') {
      next = ['settings', 'api_keys', 'custom_dict'];
    } else if (type === 'safe') {
      next = ['settings', 'custom_dict'];
    }
    setBackupSettings({ includedItems: next });
    notify('ok', `已切换为「${type === 'all' ? '全选' : type === 'recommended' ? '推荐配置' : '安全脱敏'}」备份清单`);
  };

  const restoreSummaryText = (s: {
    createdAt: string;
    historyCount: number;
    captureSessionCount: number;
    restoredItems?: string[];
  }) => {
    const itemsStr =
      s.restoredItems && s.restoredItems.length > 0
        ? s.restoredItems.map((i) => ITEM_NAME_MAP[i] || i).join('、')
        : '全部数据';
    return `恢复成功（备份生成于 ${s.createdAt}）：已恢复 [${itemsStr}] · 生词本 ${s.historyCount} 条 · 截图会话 ${s.captureSessionCount} 个`;
  };

  // ── 离线导出 / 导入 ──

  const handleExport = async () => {
    setBusy('export');
    try {
      const b64 = await cmdExportBackupBase64();
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maobu_backup_${localStamp()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify('ok', `备份包已导出（${formatSize(bytes.length)}）`);
    } catch (err) {
      notify('err', errText(err));
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setConfirmState({
      title: '导入数据备份',
      body: `将从「${file.name}」恢复数据并覆盖当前系统对应模块。恢复前会自动生成一份安全备份，确定继续吗？`,
      confirmLabel: '导入并恢复',
      action: async () => {
        setBusy('import');
        try {
          const buffer = await file.arrayBuffer();
          const b64 = arrayBufferToBase64(buffer);
          const summary = await cmdImportBackupBase64(b64);
          notify('ok', restoreSummaryText(summary));
          await fetchSettings();
        } catch (err) {
          notify('err', errText(err));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  // ── WebDAV 云端同步 ──

  const buildWebdavPatch = (): Partial<WebdavConfig> => {
    const patch: Partial<WebdavConfig> = {
      url: wdUrl.trim(),
      username: wdUser.trim(),
      remoteDir: wdDir.trim() || 'MaobuTranslator',
      retentionDays: wdDays,
    };
    if (wdPass.trim()) {
      patch.password = wdPass.trim();
    }
    return patch;
  };

  const handleSaveWebdav = async () => {
    setBusy('webdav-save');
    try {
      const result = await cmdWebdavTest(wdUrl, wdUser, wdPass);
      setWebdavConfig(buildWebdavPatch());
      notify('ok', `配置已保存，${result}`);
    } catch (err) {
      notify('err', errText(err));
    } finally {
      setBusy(null);
    }
  };

  const ensureWebdavSaved = async (): Promise<boolean> => {
    const patch = buildWebdavPatch();
    const changed =
      patch.url !== (webdavConfig?.url || '') ||
      patch.username !== (webdavConfig?.username || '') ||
      patch.remoteDir !== (webdavConfig?.remoteDir || '') ||
      patch.retentionDays !== (webdavConfig?.retentionDays ?? 15) ||
      (patch.password !== undefined && patch.password !== webdavConfig?.password);
    if (changed) {
      setWebdavConfig(patch);
      await new Promise((r) => setTimeout(r, 450));
    }
    return true;
  };

  const handleWebdavUpload = async () => {
    await ensureWebdavSaved();
    setBusy('webdav-upload');
    try {
      const result = await cmdWebdavUpload();
      const extra = result.deletedOld > 0 ? `，清理了 ${result.deletedOld} 份过期云端备份` : '';
      notify('ok', `已上传 ${result.name}（${formatSize(result.sizeBytes)}）${extra}`);
      if (remoteExpanded) await loadRemoteList();
    } catch (err) {
      notify('err', errText(err));
    } finally {
      setBusy(null);
    }
  };

  const loadRemoteList = useCallback(async () => {
    setBusy('webdav-list');
    try {
      setRemoteEntries(await cmdWebdavList());
    } catch (err) {
      setRemoteEntries([]);
      notify('err', errText(err));
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const toggleRemoteList = async () => {
    const next = !remoteExpanded;
    setRemoteExpanded(next);
    if (next) await loadRemoteList();
  };

  const handleSyncFromCloud = async () => {
    await ensureWebdavSaved();
    setBusy('webdav-sync');
    try {
      const entries = (remoteEntries?.length ?? 0) > 0 ? remoteEntries! : await cmdWebdavList();
      if (!remoteEntries) setRemoteEntries(entries);
      if (entries.length === 0) {
        notify('err', '云端还没有备份，请先「立即生成并上传」');
        return;
      }
      const latest = entries[0];
      setConfirmState({
        title: '从云端同步配置',
        body: `将下载云端最新备份（${latest.name}）并精准覆盖本地对应模块。未包含的项目将安全保留，确定继续吗？`,
        confirmLabel: '同步',
        action: async () => {
          setBusy(`webdav-restore:${latest.name}`);
          try {
            const summary = await cmdWebdavRestore(latest.name);
            notify('ok', restoreSummaryText(summary));
            await fetchSettings();
          } catch (err) {
            notify('err', errText(err));
          } finally {
            setBusy(null);
          }
        },
      });
    } catch (err) {
      notify('err', errText(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRemoteRestore = (entry: RemoteBackupEntry) => {
    setConfirmState({
      title: '从云端恢复备份',
      body: `将下载 ${entry.name} 并按需恢复到本机。未包含的项目将安全保留，确定继续吗？`,
      confirmLabel: '恢复',
      action: async () => {
        setBusy(`webdav-restore:${entry.name}`);
        try {
          const summary = await cmdWebdavRestore(entry.name);
          notify('ok', restoreSummaryText(summary));
          await fetchSettings();
        } catch (err) {
          notify('err', errText(err));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const handleRemoteDelete = (entry: RemoteBackupEntry) => {
    setConfirmState({
      title: '删除云端备份',
      body: `确定删除云端备份 ${entry.name} 吗？该操作不可撤销。`,
      danger: true,
      confirmLabel: '删除',
      action: async () => {
        setBusy(`webdav-delete:${entry.name}`);
        try {
          await cmdWebdavDelete(entry.name);
          notify('ok', '云端备份已删除');
          await loadRemoteList();
        } catch (err) {
          notify('err', errText(err));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  // ── 样式工具 ──
  const cardCls = `p-5 space-y-4 rounded-2xl border transition-colors ${
    isLight
      ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800'
      : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
  }`;
  const subCardCls = `rounded-xl border p-3.5 text-xs ${
    isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
  }`;
  const inputCls = `w-full rounded-lg border px-3 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
    isLight
      ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400'
      : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
  }`;
  const labelCls = `block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`;
  const primaryBtnCls = `flex items-center space-x-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40 whitespace-nowrap`;
  const secondaryBtnCls = `flex items-center space-x-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${
    isLight
      ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
      : 'border-white/15 bg-white/10 text-zinc-200 hover:bg-white/20 hover:text-white'
  }`;
  const iconBtnCls = `flex items-center space-x-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition cursor-pointer disabled:opacity-40 ${
    isLight
      ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
      : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/15 hover:text-white'
  }`;

  const spinner = (key: string) => (
    <Loader2
      className={`h-3.5 w-3.5 animate-spin ${busy === key ? 'opacity-100' : 'opacity-0'}`}
    />
  );

  return (
    <div className="space-y-6">
      {/* 消息 Toast */}
      {notice && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center space-x-2.5 rounded-xl border px-4 py-3 text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200 ${
            notice.kind === 'ok'
              ? 'bg-zinc-900/90 border-emerald-500/40 text-zinc-100'
              : 'bg-zinc-900/90 border-red-500/40 text-zinc-100'
          }`}
        >
          {notice.kind === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          )}
          <span className="font-medium max-w-md">{notice.text}</span>
        </div>
      )}

      {/* ── 卡片 1：备份内容清单（细粒度勾选） ── */}
      <div className={cardCls}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2 text-sm font-bold">
              <ListChecks className="h-4 w-4 text-cyan-500 shrink-0" />
              <span>备份内容清单</span>
              <span
                className={`text-[10px] font-normal px-2 py-0.5 rounded-full border ${
                  isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-600'
                    : 'bg-white/5 border-white/10 text-zinc-400'
                }`}
              >
                已选 {currentIncludedItems.length}/5 项
              </span>
            </div>
            <p className={`mt-0.5 text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              自定义云端备份与离线导出时包含的数据模块
            </p>
          </div>

          {/* 快捷预设按键 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => handleApplyPreset('all')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                currentIncludedItems.length === 5
                  ? isLight
                    ? 'bg-cyan-100 text-cyan-800 font-bold border border-cyan-300'
                    : 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/40'
                  : isLight
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-white/10'
              }`}
            >
              全选（完整）
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('recommended')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                currentIncludedItems.length === 3 &&
                currentIncludedItems.includes('settings') &&
                currentIncludedItems.includes('api_keys') &&
                currentIncludedItems.includes('custom_dict')
                  ? isLight
                    ? 'bg-cyan-100 text-cyan-800 font-bold border border-cyan-300'
                    : 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/40'
                  : isLight
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-white/10'
              }`}
              title="包含设置、密钥与词库，排除大体积历史记录，快速轻巧"
            >
              推荐（排除历史）
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('safe')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                currentIncludedItems.length === 2 &&
                currentIncludedItems.includes('settings') &&
                currentIncludedItems.includes('custom_dict')
                  ? isLight
                    ? 'bg-amber-100 text-amber-800 font-bold border border-amber-300'
                    : 'bg-amber-500/20 text-amber-300 font-bold border border-amber-400/40'
                  : isLight
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-white/10'
              }`}
              title="仅包含外观与词库，排除 API 密钥与个人使用历史，适合安全脱敏分享"
            >
              安全脱敏
            </button>
          </div>
        </div>

        {/* 5 项勾选卡片网格 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {BACKUP_SCOPE_ITEMS.map((item) => {
            const active = currentIncludedItems.includes(item.id);
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                onClick={() => handleToggleScopeItem(item.id)}
                className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer select-none transition-all ${
                  active
                    ? isLight
                      ? 'bg-cyan-50/70 border-cyan-300 shadow-xs'
                      : 'bg-cyan-950/30 border-cyan-500/40 shadow-xs'
                    : isLight
                      ? 'bg-white/60 border-slate-200/80 opacity-60 hover:opacity-90'
                      : 'bg-zinc-900/40 border-white/[0.05] opacity-50 hover:opacity-80'
                }`}
              >
                <div
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    active
                      ? isLight
                        ? 'bg-cyan-600 border-cyan-600 text-white'
                        : 'bg-cyan-500 border-cyan-500 text-zinc-950 font-bold'
                      : isLight
                        ? 'border-slate-300 bg-white'
                        : 'border-zinc-700 bg-zinc-800'
                  }`}
                >
                  {active && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        active
                          ? isLight
                            ? 'text-cyan-700'
                            : 'text-cyan-400'
                          : isLight
                            ? 'text-slate-400'
                            : 'text-zinc-500'
                      }`}
                    />
                    <span
                      className={`text-xs font-semibold ${
                        active
                          ? isLight
                            ? 'text-slate-900'
                            : 'text-zinc-100'
                          : isLight
                            ? 'text-slate-500'
                            : 'text-zinc-400'
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.sensitive && (
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${
                          isLight
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        含密钥
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-1 text-[10px] leading-relaxed ${
                      isLight ? 'text-slate-500' : 'text-zinc-400'
                    }`}
                  >
                    {item.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 卡片 2：WebDAV 云同步 ── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center space-x-2 text-sm font-bold">
              <Cloud className="h-4 w-4 text-sky-500 shrink-0" />
              <span>WebDAV 云端备份与同步</span>
            </div>
            <p className={`mt-0.5 text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              通过坚果云等 WebDAV 服务在多台设备间同步配置并保留云端备份（备份包通常 &lt;1MB）
            </p>
          </div>
          {webdavReady && (
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full border ${
                isLight
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              云端就绪
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>服务地址</label>
            <input
              type="url"
              value={wdUrl}
              onChange={(e) => setWdUrl(e.target.value)}
              placeholder="https://dav.jiangguoyun.com/dav/"
              className={inputCls + ' font-mono'}
            />
          </div>
          <div>
            <label className={labelCls}>账号</label>
            <input
              type="text"
              value={wdUser}
              onChange={(e) => setWdUser(e.target.value)}
              placeholder="WebDAV 账号（邮箱）"
              className={inputCls}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>
                应用密码
                {wdHasSavedPass && (
                  <span className={`ml-1.5 font-normal ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`}>
                    已保存
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={() => setShowWdPass(!showWdPass)}
                className={`flex items-center gap-1 text-[11px] mb-1 transition cursor-pointer ${
                  isLight ? 'text-slate-500 hover:text-slate-800' : 'text-zinc-400 hover:text-white'
                }`}
                title={showWdPass ? '隐藏密码' : '显示明文'}
              >
                {showWdPass ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                <span>{showWdPass ? '隐藏' : '显示明文'}</span>
              </button>
            </div>
            <input
              type={showWdPass ? 'text' : 'password'}
              value={wdPass}
              onChange={(e) => setWdPass(e.target.value)}
              placeholder="坚果云请在网页端生成「应用密码」"
              className={inputCls + ' font-mono'}
            />
          </div>
          <div>
            <label className={labelCls}>远端目录</label>
            <input
              type="text"
              value={wdDir}
              onChange={(e) => setWdDir(e.target.value)}
              placeholder="MaobuTranslator"
              className={inputCls + ' font-mono'}
            />
          </div>
          <div>
            <label className={labelCls}>云端保留天数</label>
            <select
              value={wdDays}
              onChange={(e) => setWdDays(Number(e.target.value))}
              className={inputCls}
            >
              {CLOUD_DAYS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <p className={`text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
          坚果云用户请前往
          <a
            href="https://www.jiangguoyun.com/#/safety"
            target="_blank"
            rel="noreferrer"
            className={`mx-1 underline underline-offset-2 ${isLight ? 'text-sky-600' : 'text-sky-400'}`}
          >
            账户安全页
          </a>
          生成「应用密码」；上传时会自动按保留天数清理过期备份。
        </p>

        {/* 操作按钮 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveWebdav}
            disabled={!desktop || busy !== null}
            className={secondaryBtnCls}
          >
            {busy === 'webdav-save' ? spinner('save') : <Save className="h-3.5 w-3.5 shrink-0" />}
            <span>测试 / 保存配置</span>
          </button>
          <button
            type="button"
            onClick={handleWebdavUpload}
            disabled={!desktop || busy !== null || currentIncludedItems.length === 0}
            className={primaryBtnCls}
          >
            {busy === 'webdav-upload' ? spinner('upload') : <CloudUpload className="h-3.5 w-3.5 shrink-0" />}
            <span>立即生成并上传</span>
          </button>
          <button
            type="button"
            onClick={handleSyncFromCloud}
            disabled={!desktop || busy !== null || !webdavReady}
            className={secondaryBtnCls}
            title={webdavReady ? '下载云端最新备份并恢复到本机' : '请先填写并保存 WebDAV 配置'}
          >
            {busy === 'webdav-sync' ? spinner('sync') : <CloudDownload className="h-3.5 w-3.5 shrink-0" />}
            <span>从云端同步配置</span>
          </button>
        </div>

        {/* 远端备份列表 */}
        <div>
          <button
            type="button"
            onClick={toggleRemoteList}
            disabled={!desktop || busy !== null}
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-40 ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                : 'bg-zinc-950/50 border-white/[0.05] text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <span>云端历史备份{remoteEntries ? `（${remoteEntries.length}）` : ''}</span>
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${remoteExpanded ? 'rotate-90' : ''}`}
            />
          </button>
          {remoteExpanded && (
            <div
              className={`mt-2 rounded-xl border overflow-hidden ${
                isLight
                  ? 'bg-slate-50/80 border-slate-200 divide-y divide-slate-200'
                  : 'bg-zinc-950/40 border-white/[0.05] divide-y divide-white/[0.05]'
              }`}
            >
              {busy === 'webdav-list' ? (
                <div className={`px-3 py-5 text-center text-[11px] ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                  正在读取云端备份列表...
                </div>
              ) : !remoteEntries || remoteEntries.length === 0 ? (
                <div className={`px-3 py-5 text-center text-[11px] ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                  云端暂无备份，点击「立即生成并上传」创建第一份
                </div>
              ) : (
                remoteEntries.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className={`text-xs font-medium ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                        {entry.modifiedAt && !Number.isNaN(new Date(entry.modifiedAt).getTime())
                          ? formatMs(new Date(entry.modifiedAt).getTime())
                          : '—'}
                      </div>
                      <div className={`text-[10px] font-mono truncate ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                        {formatSize(entry.sizeBytes)} · {entry.name}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRemoteRestore(entry)}
                        disabled={busy !== null}
                        className={iconBtnCls}
                      >
                        <History className="h-3 w-3 shrink-0" />
                        <span>恢复</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoteDelete(entry)}
                        disabled={busy !== null}
                        className={`${iconBtnCls} hover:!border-red-300 hover:!text-red-500`}
                      >
                        <Trash2 className="h-3 w-3 shrink-0" />
                        <span>删除</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 状态行 */}
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}
        >
          <span>
            最近上传：
            {webdavConfig?.lastUploadAtMs
              ? `${formatMs(webdavConfig.lastUploadAtMs)}${webdavConfig.lastUploadName ? `（${webdavConfig.lastUploadName}）` : ''}`
              : '尚未上传'}
          </span>
          <span>
            最近恢复：{webdavConfig?.lastRestoreAtMs ? formatMs(webdavConfig.lastRestoreAtMs) : '尚未同步'}
          </span>
        </div>
      </div>

      {/* ── 卡片 3：离线数据迁移 ── */}
      <div className={cardCls}>
        <div className="flex items-center space-x-2 text-sm font-bold">
          <Download className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>离线数据迁移</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={subCardCls}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>数据导出</div>
                <p className={`mt-1 text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                  按上方勾选的清单打包（已选 {currentIncludedItems.length}/5 项{currentIncludedItems.includes('api_keys') ? '，含引擎密钥' : '，已排除密钥'}），导出为 zip 文件，便于换机离线迁移或归档。
                </p>
              </div>
              <button
                type="button"
                onClick={handleExport}
                disabled={!desktop || busy === 'export' || currentIncludedItems.length === 0}
                className={primaryBtnCls + ' shrink-0'}
              >
                {busy === 'export' ? spinner('export') : <Download className="h-3.5 w-3.5 shrink-0" />}
                <span>导出</span>
              </button>
            </div>
          </div>
          <div className={subCardCls}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>数据导入</div>
                <p className={`mt-1 text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                  从导出的 zip 备份包恢复数据，系统将精准合并所含项目。
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!desktop || busy === 'import'}
                className={secondaryBtnCls + ' shrink-0'}
              >
                {busy === 'import' ? spinner('import') : <Upload className="h-3.5 w-3.5 shrink-0" />}
                <span>导入</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 确认弹窗（Tauri WebView 不支持 window.confirm，使用 React Portal 挂载到 body，确保 100% 全屏蒙层覆盖） */}
      {confirmState && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div
            className={`w-full max-w-sm rounded-2xl border p-5 space-y-4 shadow-2xl ${
              isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-zinc-900 border-white/10 text-zinc-100'
            }`}
          >
            <div className="flex items-start space-x-2.5">
              {confirmState.danger ? (
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              ) : (
                <History className="h-5 w-5 text-cyan-500 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-bold">{confirmState.title}</div>
                <p className={`mt-1.5 text-[11px] leading-relaxed ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                  {confirmState.body}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmState(null)} className={secondaryBtnCls}>
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmState.action;
                  setConfirmState(null);
                  await action();
                }}
                className={`flex items-center space-x-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition cursor-pointer ${
                  confirmState.danger
                    ? 'bg-red-600 hover:bg-red-500 border border-red-400/40'
                    : 'bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40'
                }`}
              >
                <span>{confirmState.confirmLabel || '确定'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
