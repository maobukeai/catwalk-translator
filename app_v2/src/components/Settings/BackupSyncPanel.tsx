import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DatabaseBackup,
  FolderOpen,
  Plus,
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
} from 'lucide-react';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
  isTauri,
  cmdCreateBackup,
  cmdListBackups,
  cmdDeleteBackup,
  cmdRestoreBackup,
  cmdOpenBackupDir,
  cmdExportBackupBase64,
  cmdImportBackupBase64,
  cmdWebdavTest,
  cmdWebdavUpload,
  cmdWebdavList,
  cmdWebdavRestore,
  cmdWebdavDelete,
} from '../../services/tauri';
import type { BackupEntry, RemoteBackupEntry, WebdavConfig } from '../../services/types';

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

const INTERVAL_OPTIONS = [
  { value: 6, label: '每 6 小时' },
  { value: 24, label: '每天' },
  { value: 72, label: '每 3 天' },
  { value: 168, label: '每周' },
];

const RETENTION_OPTIONS = [
  { value: 5, label: '保留 5 份' },
  { value: 10, label: '保留 10 份' },
  { value: 20, label: '保留 20 份' },
  { value: 50, label: '保留 50 份' },
  { value: 0, label: '不限制' },
];

const CLOUD_DAYS_OPTIONS = [7, 15, 30, 90].map((d) => ({ value: d, label: `${d} 天` }));

interface ConfirmState {
  title: string;
  body: string;
  danger?: boolean;
  confirmLabel?: string;
  action: () => Promise<void>;
}

/**
 * 备份与同步设置面板：本地备份管理（自动备份/备份列表/恢复）、
 * 数据导出导入、WebDAV 云同步（配置/上传/云端恢复/远端列表）。
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

  // ── 本地面板状态 ──
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<RemoteBackupEntry[] | null>(null);
  const [remoteExpanded, setRemoteExpanded] = useState(false);

  // WebDAV 表单（密码留空 = 保持已保存密码不变）
  const [wdUrl, setWdUrl] = useState('');
  const [wdUser, setWdUser] = useState('');
  const [wdPass, setWdPass] = useState('');
  const [wdDir, setWdDir] = useState('MaobuTranslator');
  const [wdDays, setWdDays] = useState(15);
  const [wdHasSavedPass, setWdHasSavedPass] = useState(false);
  const [webdavReady, setWebdavReady] = useState(false);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4200);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  // 表单随已保存配置回填（保存/恢复/导入后同步刷新）
  useEffect(() => {
    setWdUrl(webdavConfig?.url || '');
    setWdUser(webdavConfig?.username || '');
    setWdPass('');
    setWdDir(webdavConfig?.remoteDir || 'MaobuTranslator');
    setWdDays(webdavConfig?.retentionDays ?? 15);
    setWdHasSavedPass(Boolean(webdavConfig?.password));
    setWebdavReady(
      Boolean(webdavConfig?.url?.trim()) &&
        Boolean(webdavConfig?.username?.trim()) &&
        Boolean(webdavConfig?.password)
    );
  }, [webdavConfig]);

  const refreshBackups = useCallback(async () => {
    try {
      setBackups(await cmdListBackups());
    } catch (err) {
      console.warn('list backups failed:', err);
    }
  }, []);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  // 恢复/导入完成后由 Rust 广播，兜底刷新界面
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('app:settings-restored', () => {
        void fetchSettings();
        void refreshBackups();
      }))
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {
        /* event channel unavailable in browser mode */
      });
    return () => {
      unlisten?.();
    };
  }, [fetchSettings, refreshBackups]);

  const restoreSummaryText = (s: {
    createdAt: string;
    historyCount: number;
    captureSessionCount: number;
  }) => `恢复成功（备份生成于 ${s.createdAt}）：生词本 ${s.historyCount} 条 · 截图会话 ${s.captureSessionCount} 个`;

  // ── 备份管理 ──

  const handleCreateBackup = async () => {
    setBusy('create');
    try {
      const entry = await cmdCreateBackup();
      await refreshBackups();
      notify('ok', `已创建备份 ${formatSize(entry.sizeBytes)}（${formatMs(entry.createdAtMs)}）`);
    } catch (err) {
      notify('err', errText(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = (entry: BackupEntry) => {
    setConfirmState({
      title: '恢复本地备份',
      body: `将用 ${formatMs(entry.createdAtMs)} 的备份覆盖当前全部配置与用户数据（引擎密钥、生词本、截图会话等）。覆盖前会自动生成一份安全备份，确定继续吗？`,
      confirmLabel: '恢复',
      action: async () => {
        setBusy(`restore:${entry.name}`);
        try {
          const summary = await cmdRestoreBackup(entry.name);
          notify('ok', restoreSummaryText(summary));
          await fetchSettings();
          await refreshBackups();
        } catch (err) {
          notify('err', errText(err));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const handleDeleteBackup = (entry: BackupEntry) => {
    setConfirmState({
      title: '删除本地备份',
      body: `确定删除 ${formatMs(entry.createdAtMs)} 的备份（${formatSize(entry.sizeBytes)}）吗？该操作不可撤销。`,
      danger: true,
      confirmLabel: '删除',
      action: async () => {
        setBusy(`delete:${entry.name}`);
        try {
          await cmdDeleteBackup(entry.name);
          await refreshBackups();
          notify('ok', '备份已删除');
        } catch (err) {
          notify('err', errText(err));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  // ── 导出 / 导入 ──

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
      a.download = `猫步翻译备份_${localStamp()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify('ok', `已导出备份包（${formatSize(bytes.length)}），可在「下载」文件夹中找到`);
    } catch (err) {
      notify('err', errText(err));
    } finally {
      setBusy(null);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setConfirmState({
      title: '导入备份包',
      body: `将用「${file.name}」覆盖当前全部配置与用户数据。覆盖前会自动生成一份安全备份，确定继续吗？`,
      confirmLabel: '导入',
      action: async () => {
        setBusy('import');
        try {
          const buffer = await file.arrayBuffer();
          const summary = await cmdImportBackupBase64(arrayBufferToBase64(buffer));
          notify('ok', restoreSummaryText(summary));
          await fetchSettings();
          await refreshBackups();
        } catch (err) {
          notify('err', errText(err));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  // ── WebDAV ──

  const buildWebdavPatch = (): Partial<WebdavConfig> => {
    const patch: Partial<WebdavConfig> = {
      url: wdUrl.trim(),
      username: wdUser.trim(),
      remoteDir: wdDir.trim() || 'MaobuTranslator',
      retentionDays: wdDays,
    };
    if (wdPass.trim() !== '') patch.password = wdPass.trim();
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
      // 等待设置写盘后再走云端命令
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
        notify('err', '云端还没有备份，请先「生成并上传」');
        return;
      }
      const latest = entries[0];
      setConfirmState({
        title: '从云端同步配置',
        body: `将下载云端最新备份（${latest.name}）并覆盖当前全部配置与用户数据。覆盖前会自动生成一份安全备份，确定继续吗？`,
        confirmLabel: '同步',
        action: async () => {
          setBusy(`webdav-restore:${latest.name}`);
          try {
            const summary = await cmdWebdavRestore(latest.name);
            notify('ok', restoreSummaryText(summary));
            await fetchSettings();
            await refreshBackups();
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
      body: `将下载 ${entry.name} 并覆盖当前全部配置与用户数据。覆盖前会自动生成一份安全备份，确定继续吗？`,
      confirmLabel: '恢复',
      action: async () => {
        setBusy(`webdav-restore:${entry.name}`);
        try {
          const summary = await cmdWebdavRestore(entry.name);
          notify('ok', restoreSummaryText(summary));
          await fetchSettings();
          await refreshBackups();
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
  const subCardCls = `rounded-xl border p-3 text-xs ${
    isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
  }`;
  const inputCls = `w-full rounded-lg border px-3 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
    isLight
      ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400'
      : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
  }`;
  const labelCls = `block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`;
  const primaryBtnCls = `flex items-center space-x-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40 whitespace-nowrap`;
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
    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* 操作通知 */}
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

      {/* ── 卡片 1：备份管理 ── */}
      <div className={cardCls}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center space-x-2 text-sm font-bold">
              <DatabaseBackup className="h-4 w-4 text-cyan-500 shrink-0" />
              <span>备份管理</span>
            </div>
            <p className={`mt-0.5 text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              统一管理定期备份、备份目录和备份列表
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full border ${
                backupSettings?.autoBackupEnabled
                  ? isLight
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
                  : isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-500'
                    : 'bg-white/5 border-white/10 text-zinc-400'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  backupSettings?.autoBackupEnabled ? 'bg-emerald-400' : 'bg-zinc-400'
                }`}
              />
              {backupSettings?.autoBackupEnabled ? '自动备份已开启' : '自动备份已关闭'}
              {backupSettings?.lastBackupAtMs ? ` · 最近备份：${formatMs(backupSettings.lastBackupAtMs)}` : ' · 尚未备份'}
            </span>
            <button
              type="button"
              onClick={() =>
                cmdOpenBackupDir().catch((err) => notify('err', errText(err)))
              }
              disabled={!desktop}
              className={secondaryBtnCls}
              title="在资源管理器中打开备份目录"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span>打开</span>
            </button>
          </div>
        </div>

        {/* 自动备份设置 */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${subCardCls}`}>
          <div className="flex items-center justify-between sm:justify-start sm:gap-3">
            <div className="min-w-0">
              <div className={`font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>定期自动备份</div>
              <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                后台静默打包配置与用户数据
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setBackupSettings({
                  autoBackupEnabled: !(backupSettings?.autoBackupEnabled ?? false),
                })
              }
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-auto ${
                backupSettings?.autoBackupEnabled
                  ? 'bg-cyan-600'
                  : isLight
                    ? 'bg-slate-300'
                    : 'bg-zinc-700'
              }`}
              title="开启或关闭定期自动备份"
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  backupSettings?.autoBackupEnabled ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className={labelCls}>备份频率</label>
            <select
              value={backupSettings?.intervalHours ?? 24}
              onChange={(e) => setBackupSettings({ intervalHours: Number(e.target.value) })}
              className={inputCls}
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>本地保留策略</label>
            <select
              value={backupSettings?.maxLocalBackups ?? 10}
              onChange={(e) => setBackupSettings({ maxLocalBackups: Number(e.target.value) })}
              className={inputCls}
            >
              {RETENTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 备份列表 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-zinc-200'}`}>
              本地备份（{backups.length}）
            </div>
            <button
              type="button"
              onClick={handleCreateBackup}
              disabled={!desktop || busy === 'create'}
              className={primaryBtnCls}
            >
              {busy === 'create' ? spinner('create') : <Plus className="h-3.5 w-3.5 shrink-0" />}
              <span>立即备份</span>
            </button>
          </div>
          <div
            className={`rounded-xl border ${
              isLight
                ? 'bg-slate-50/80 border-slate-200 divide-y divide-slate-200'
                : 'bg-zinc-950/40 border-white/[0.05] divide-y divide-white/[0.05]'
            } ${backups.length === 0 ? '' : 'divide-y'}`}
          >
            {backups.length === 0 ? (
              <div className={`px-3 py-6 text-center text-[11px] ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                {desktop ? '暂无备份，点击「立即备份」创建第一份' : '备份功能仅在桌面端可用'}
              </div>
            ) : (
              backups.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-xs font-medium ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                        {formatMs(entry.createdAtMs)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                          entry.source === 'auto'
                            ? isLight
                              ? 'bg-blue-50 border-blue-200 text-blue-600'
                              : 'bg-blue-500/15 border-blue-400/30 text-blue-300'
                            : isLight
                              ? 'bg-purple-50 border-purple-200 text-purple-600'
                              : 'bg-purple-500/15 border-purple-400/30 text-purple-300'
                        }`}
                      >
                        {entry.source === 'auto' ? '自动' : '手动'}
                      </span>
                    </div>
                    <div className={`text-[10px] font-mono truncate ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                      {formatSize(entry.sizeBytes)} · {entry.name}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRestore(entry)}
                      disabled={busy !== null}
                      className={iconBtnCls}
                    >
                      <History className="h-3 w-3 shrink-0" />
                      <span>恢复</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBackup(entry)}
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
        </div>
      </div>

      {/* ── 卡片 2：数据导出 / 数据导入 ── */}
      <div className={cardCls}>
        <div className="flex items-center space-x-2 text-sm font-bold">
          <Download className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>数据迁移</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={subCardCls}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>数据导出</div>
                <p className={`mt-1 text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                  将全部配置（含引擎密钥、AI 配置）、生词本与截图会话打包为 zip 文件，便于换机迁移或外部存档。
                </p>
              </div>
              <button
                type="button"
                onClick={handleExport}
                disabled={!desktop || busy === 'export'}
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
                  从导出的备份包恢复全部数据，覆盖前会自动生成一份当前数据的安全备份。
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

      {/* ── 卡片 3：WebDAV 云同步 ── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center space-x-2 text-sm font-bold">
              <Cloud className="h-4 w-4 text-sky-500 shrink-0" />
              <span>WebDAV 云同步</span>
            </div>
            <p className={`mt-0.5 text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              通过坚果云等 WebDAV 服务在多台设备间同步配置（备份文件通常 &lt;1MB）
            </p>
          </div>
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
            <label className={labelCls}>
              应用密码
              {wdHasSavedPass && (
                <span className={`ml-1.5 font-normal ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`}>已保存</span>
              )}
            </label>
            <input
              type="password"
              value={wdPass}
              onChange={(e) => setWdPass(e.target.value)}
              placeholder={wdHasSavedPass ? '已保存，留空保持不变' : '坚果云请在网页端生成「应用密码」'}
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
          生成「应用密码」；上传按保留天数自动清理过期备份。
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
            disabled={!desktop || busy !== null}
            className={primaryBtnCls}
          >
            {busy === 'webdav-upload' ? spinner('upload') : <CloudUpload className="h-3.5 w-3.5 shrink-0" />}
            <span>生成并上传</span>
          </button>
          <button
            type="button"
            onClick={handleSyncFromCloud}
            disabled={!desktop || busy !== null || !webdavReady}
            className={secondaryBtnCls}
            title={webdavReady ? '下载云端最新备份并恢复到本机' : '请先填写并保存 WebDAV 配置'}
          >
            {busy === 'webdav-sync' ? spinner('sync') : <CloudDownload className="h-3.5 w-3.5 shrink-0" />}
            <span>同步配置</span>
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
            <span>远端备份{remoteEntries ? `（${remoteEntries.length}）` : ''}</span>
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
                  云端暂无备份，点击「生成并上传」创建第一份
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

      {/* 确认弹窗（Tauri WebView 不支持 window.confirm，自绘轻量弹窗） */}
      {confirmState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
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
        </div>
      )}
    </div>
  );
};
