import React, { useState, useEffect, useMemo } from 'react';
import {
  GraduationCap,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Copy,
  Check,
  X,
  Layers,
  Sparkles,
  FileText,
  Settings,
} from 'lucide-react';
import {
  cmdAnkiCheckConnection,
  cmdAnkiSyncNotes,
  cmdAnkiExportFile,
  cmdExportAnki,
} from '../../services/tauri';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { HistoryItem, AnkiCheckResult, AnkiNotePayload, AnkiSyncResult } from '../../services/types';

interface AnkiSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: HistoryItem[];
  selectedIds?: Set<string>;
}

const DEFAULT_ANKI_ENDPOINT = 'http://127.0.0.1:8765';
const DEFAULT_DECK = 'Catwalk Vocabulary';
const ANKICONNECT_CODE = '2055492159';

export const AnkiSyncModal: React.FC<AnkiSyncModalProps> = ({
  isOpen,
  onClose,
  items,
  selectedIds,
}) => {
  const { settings, setAnkiSettings } = useSettingsStore();
  const { isLight } = useAppTheme();

  const [endpoint, setEndpoint] = useState<string>(
    settings.ankiSettings?.endpoint || DEFAULT_ANKI_ENDPOINT
  );
  const [deckName, setDeckName] = useState<string>(
    settings.ankiSettings?.deckName || DEFAULT_DECK
  );
  const [tagsInput, setTagsInput] = useState<string>(
    (settings.ankiSettings?.tags || ['Catwalk', 'Vocabulary']).join(', ')
  );

  const [checking, setChecking] = useState(false);
  const [ankiStatus, setAnkiStatus] = useState<AnkiCheckResult | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<AnkiSyncResult | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // 决定同步目标生词集合：若在列表勾选了项则优先同步勾选项，否则同步传入的所有生词
  const targetItems = useMemo(() => {
    if (selectedIds && selectedIds.size > 0) {
      return items.filter((i) => selectedIds.has(i.id));
    }
    return items;
  }, [items, selectedIds]);

  // 打开时自动探测 AnkiConnect 状态
  const checkConnection = async (customEndpoint?: string) => {
    setChecking(true);
    setSyncResult(null);
    try {
      const ep = customEndpoint || endpoint || DEFAULT_ANKI_ENDPOINT;
      const res = await cmdAnkiCheckConnection(ep);
      setAnkiStatus(res);
      if (res.connected && res.decks && res.decks.length > 0) {
        if (!res.decks.includes(deckName) && !deckName) {
          setDeckName(res.decks[0]);
        }
      }
    } catch (err: any) {
      setAnkiStatus({
        connected: false,
        version: 0,
        decks: [],
        models: [],
        message: err?.message || '无法连接至 AnkiConnect',
      });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkConnection();
    } else {
      setSyncResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(ANKICONNECT_CODE);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSaveSettings = () => {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    setAnkiSettings({
      endpoint,
      deckName: deckName.trim() || DEFAULT_DECK,
      tags,
    });
  };

  // 将 HistoryItem 转换为 AnkiNotePayload
  const prepareNotes = (): AnkiNotePayload[] => {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    return targetItems.map((item) => ({
      original: item.original,
      translated: item.translated,
      phonetic: (item as any).phonetic,
      context: (item as any).context,
      category: (item as any).category || item.sourceTier || '生词本',
      tags,
    }));
  };

  // 1. 实时一键同步到 AnkiConnect
  const handleSyncToAnki = async () => {
    if (targetItems.length === 0 || !ankiStatus?.connected) return;
    setIsSyncing(true);
    setSyncResult(null);
    handleSaveSettings();
    try {
      const notes = prepareNotes();
      const res = await cmdAnkiSyncNotes(
        notes,
        deckName.trim() || DEFAULT_DECK,
        endpoint || DEFAULT_ANKI_ENDPOINT
      );
      setSyncResult(res);
    } catch (err: any) {
      setSyncResult({
        total: targetItems.length,
        added: 0,
        skipped: 0,
        errors: [err?.message || '同步失败，请检查 Anki 连接'],
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // 2. 免插件导出标准 Anki TSV 文件
  const handleExportAnkiTsv = async () => {
    if (targetItems.length === 0) return;
    try {
      const notes = prepareNotes();
      const tsvContent = await cmdAnkiExportFile(notes);
      const blob = new Blob([tsvContent], { type: 'text/tab-separated-values;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `anki_deck_${deckName.replace(/\s+/g, '_')}_${Date.now()}.tsv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Anki export failed:', err);
    }
  };

  // 3. 导出普通 CSV 文件
  const handleExportLegacyCsv = async () => {
    if (targetItems.length === 0) return;
    try {
      const csv = await cmdExportAnki(targetItems);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `catwalk_vocabulary_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col transition-all ${
          isLight
            ? 'bg-white text-slate-800 border-slate-200'
            : 'bg-zinc-900 text-zinc-100 border-white/10'
        }`}
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-500/15 text-blue-500">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <span>同步生词到 Anki</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-mono">
                  双轨闭环
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                支持本地 AnkiConnect 无缝直连同步，或一键导出专业制表符卡片
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* 连接状态条 */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-colors ${
              checking
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-500'
                : ankiStatus?.connected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-500'
            }`}
          >
            <div className="flex items-center space-x-2">
              {checking ? (
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
              ) : ankiStatus?.connected ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <div className="flex flex-col">
                <span className="font-semibold">
                  {checking
                    ? '正在探测本地 AnkiConnect 服务...'
                    : ankiStatus?.connected
                    ? `AnkiConnect 已连接 (API v${ankiStatus.version})`
                    : '未连接到 AnkiConnect'}
                </span>
                {!checking && !ankiStatus?.connected && (
                  <span className="text-[11px] opacity-80">
                    未检测到运行中的 Anki (端口 8765)，可按下方指南开启或直接导出文件
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-1.5 shrink-0">
              <button
                type="button"
                onClick={() => checkConnection()}
                disabled={checking}
                className={`p-1.5 rounded-lg border transition cursor-pointer ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/10'
                }`}
                title="重新检测连接"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setShowConfig(!showConfig)}
                className={`p-1.5 rounded-lg border transition cursor-pointer ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/10'
                }`}
                title="配置端点与选项"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* 高级设置抽屉（端点地址修改） */}
          {showConfig && (
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-2.5 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-800/60 border-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">AnkiConnect 端点地址</span>
                <button
                  type="button"
                  onClick={() => {
                    setEndpoint(DEFAULT_ANKI_ENDPOINT);
                    checkConnection(DEFAULT_ANKI_ENDPOINT);
                  }}
                  className="text-[11px] text-blue-500 hover:underline cursor-pointer"
                >
                  恢复默认 (8765)
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="http://127.0.0.1:8765"
                  className={`flex-1 px-3 py-1.5 rounded-lg border text-xs outline-none font-mono ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-800'
                      : 'bg-zinc-900 border-white/15 text-zinc-100'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => checkConnection(endpoint)}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition cursor-pointer"
                >
                  测试连接
                </button>
              </div>
            </div>
          )}

          {/* 同步选项卡片 */}
          <div
            className={`p-4 rounded-xl border space-y-3 ${
              isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-zinc-800/40 border-white/10'
            }`}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                <span>目标牌组 (Deck)</span>
              </span>
              <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                若牌组不存在将自动创建
              </span>
            </div>

            {/* Deck 输入或选择框 */}
            <div className="relative">
              <input
                type="text"
                list="anki-deck-datalist"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="例如: Catwalk Vocabulary 或 默认"
                className={`w-full px-3 py-2 rounded-xl border text-xs outline-none transition font-medium ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-800 focus:border-blue-500'
                    : 'bg-zinc-900 border-white/15 text-zinc-100 focus:border-blue-500'
                }`}
              />
              <datalist id="anki-deck-datalist">
                {ankiStatus?.decks?.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>

            {/* 标签配置 */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-zinc-400">
                卡片标签 (逗号分隔)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="Catwalk, Vocabulary, CG"
                className={`w-full px-3 py-1.5 rounded-lg border text-xs outline-none ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-800'
                    : 'bg-zinc-900 border-white/15 text-zinc-100'
                }`}
              />
            </div>

            {/* 待同步统计 */}
            <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-zinc-400">本次同步范围:</span>
              <span className="font-bold text-blue-500">
                {selectedIds && selectedIds.size > 0
                  ? `已勾选的 ${targetItems.length} 个生词`
                  : `生词本中全部 ${targetItems.length} 个生词`}
              </span>
            </div>
          </div>

          {/* 同步结果展示 */}
          {syncResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-1 animate-in fade-in duration-150 ${
                syncResult.errors.length > 0 && syncResult.added === 0
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-500'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
              }`}
            >
              <div className="flex items-center space-x-2 font-bold">
                {syncResult.errors.length === 0 || syncResult.added > 0 ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <span>
                  {syncResult.errors.length === 0
                    ? '🎉 同步成功！'
                    : syncResult.added > 0
                    ? '⚠️ 同步部分完成'
                    : '❌ 同步失败'}
                </span>
              </div>
              <p className="text-[11px] opacity-90 pl-6">
                共处理 {syncResult.total} 条，成功新增 {syncResult.added} 张卡片，跳过已存在{' '}
                {syncResult.skipped} 张卡片。
              </p>
              {syncResult.errors.length > 0 && (
                <div className="pl-6 pt-1 text-[10px] text-rose-400">
                  {syncResult.errors.slice(0, 3).map((err, idx) => (
                    <div key={idx}>• {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 若未连接：新手极速引导卡片 */}
          {!ankiStatus?.connected && (
            <div
              className={`p-4 rounded-xl border text-xs space-y-3 ${
                isLight ? 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-500/10 border-amber-500/20'
              }`}
            >
              <div className="flex items-center space-x-2 text-amber-500 font-bold">
                <Layers className="h-4 w-4" />
                <span>30 秒安装 AnkiConnect 插件（实现一键直连）</span>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-zinc-300 text-[11px]">
                <li>打开本地 Anki 桌面应用；</li>
                <li>
                  点击顶部菜单：<span className="font-semibold">工具 (Tools)</span> ➔{' '}
                  <span className="font-semibold">插件 (Add-ons)</span> ➔{' '}
                  <span className="font-semibold">获取插件 (Get Add-ons...)</span>；
                </li>
                <li className="flex items-center gap-1.5 flex-wrap">
                  <span>在弹出的代码框中输入插件代码:</span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1 font-mono font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded cursor-pointer hover:bg-amber-500/30 transition"
                  >
                    {copiedCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{ANKICONNECT_CODE}</span>
                  </button>
                  <span className="text-[10px] text-slate-400">(点击复制)</span>
                </li>
                <li>安装完成后点击确定并重启 Anki，回到此处点击「重新检测」即可！</li>
              </ol>
            </div>
          )}
        </div>

        {/* Footer 操作栏 */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0 bg-slate-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* 免插件导出选项 */}
            <button
              type="button"
              onClick={handleExportAnkiTsv}
              disabled={targetItems.length === 0}
              className={`flex-1 sm:flex-none flex items-center justify-center space-x-1 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/10'
              }`}
              title="导出带 HTML 卡片排版的 Anki 专用制表符文件，可在 Anki 直接点击「文件 ➔ 导入」"
            >
              <FileText className="h-3.5 w-3.5 text-blue-500" />
              <span>导出 Anki 文件 (.tsv)</span>
            </button>

            <button
              type="button"
              onClick={handleExportLegacyCsv}
              disabled={targetItems.length === 0}
              className={`flex-1 sm:flex-none flex items-center justify-center space-x-1 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/10'
              }`}
              title="导出普通逗号分隔 CSV 文件"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span>普通 CSV</span>
            </button>
          </div>

          {/* 直连同步主按钮 */}
          <button
            type="button"
            onClick={handleSyncToAnki}
            disabled={targetItems.length === 0 || !ankiStatus?.connected || isSyncing}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSyncing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>同步中...</span>
              </>
            ) : (
              <>
                <GraduationCap className="h-4 w-4" />
                <span>一键同步至 Anki ({targetItems.length})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
