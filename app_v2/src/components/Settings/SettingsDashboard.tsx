import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  RotateCcw,
  Save,
  CheckCircle2,
  Zap,
  BookOpen,
  Sliders,
  Globe,
  Palette,
  CloudUpload,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { BackupSyncPanel } from './BackupSyncPanel';
import { AppearancePanel } from './panels/AppearancePanel';
import { HotkeyPanel } from './panels/HotkeyPanel';
import { OnlinePanel, ONLINE_ENGINE_DEFS } from './panels/OnlinePanel';
import { DictsPanel } from './panels/DictsPanel';
import { PreferencePanel } from './panels/PreferencePanel';
import { APP_VERSION } from '../../version';

type SettingCategory = 'appearance' | 'hotkey' | 'online' | 'dicts' | 'preference' | 'backup';

interface SettingsDashboardProps {
  onStartCapture?: () => void;
  onTriggerSpotlight?: () => void;
  onTriggerClipboard?: () => void;
  onToggleWindow?: () => void;
  onOpenAbout?: () => void;
}

/**
 * 设置中心外壳：头部保存/重置栏、分类导航与 Toast。
 * 各分区内容在 panels/ 下独立维护（自持状态 + 就地订阅 store）。
 */

// 模块级「已拉取过一次」标记:App 挂载时已全局 fetchSettings,设置页只兜底拉取一次
let hasFetchedSettingsOnce = false;
export const SettingsDashboard: React.FC<SettingsDashboardProps> = ({
  onStartCapture,
  onTriggerSpotlight,
  onTriggerClipboard,
  onToggleWindow,
  onOpenAbout,
}) => {
  const {
    settings,
    isDirty,
    isLoading,
    isSaving,
    toastMessage,
    fetchSettings,
    saveSettings,
    resetSettings,
    clearToast,
  } = useSettingsStore();

  const { isLight } = useAppTheme();
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('appearance');

  // App 挂载时已全局 fetchSettings；这里只在首次进入设置页时兜底拉取一次，
  // 避免每次切 tab 都用服务端数据覆盖用户可能存在的未保存编辑
  useEffect(() => {
    if (hasFetchedSettingsOnce) return;
    hasFetchedSettingsOnce = true;
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        clearToast();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, clearToast]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center text-zinc-400">
        <div className="flex items-center space-x-2.5 text-xs text-zinc-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          <span>正在加载设置项...</span>
        </div>
      </div>
    );
  }

  const online = settings.onlineEngines || {
    google: true,
    bing: true,
    youdao: true,
    deepl: false,
    myMemory: false,
    baidu: false,
    tencent: false,
  };

  const activeOnlineCount = ONLINE_ENGINE_DEFS.filter(
    (e) => (online as Record<string, boolean | undefined>)[e.id] ?? false
  ).length;

  const categories = [
    { id: 'appearance', label: '外观与个性化', icon: Palette },
    { id: 'hotkey', label: '快捷键与 AI 模型', icon: Zap },
    { id: 'online', label: '在线引擎', badge: activeOnlineCount, icon: Globe },
    { id: 'dicts', label: '专业词库', icon: BookOpen },
    { id: 'preference', label: '优先级', icon: Sliders },
    { id: 'backup', label: '备份与同步', icon: CloudUpload },
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-5 text-zinc-200 font-sans pb-10">
      {/* Toast 操作通知 */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center space-x-2.5 rounded-xl px-4 py-3 text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200 ${
          isLight
            ? 'bg-white/95 border border-emerald-500/40 text-slate-800'
            : 'bg-zinc-900/90 border border-emerald-500/40 text-zinc-100'
        }`}>
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* 顶部 Header：标题 + 始终常驻的全局保存/重置按钮 */}
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.08] pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className={`text-lg font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>系统设置</h1>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono font-medium shadow-xs ${
              isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/15 border-blue-400/30 text-blue-300'
            }`}>
              v{APP_VERSION}
            </span>
          </div>
          <p className={`mt-0.5 text-xs ${isLight ? 'text-slate-500 font-medium' : 'text-zinc-400'}`}>
            配置快捷键、翻译引擎、AI 模型与界面外观
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0 whitespace-nowrap self-start sm:self-auto">
          {isDirty && (
            <span className="flex items-center space-x-1 text-xs font-medium text-amber-300 bg-amber-500/15 border border-amber-400/30 px-2.5 py-1 rounded-lg animate-pulse whitespace-nowrap shrink-0">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>未保存</span>
            </span>
          )}

          <button
            type="button"
            onClick={resetSettings}
            disabled={!isDirty}
            className={`flex items-center space-x-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap shrink-0 ${
              isLight
                ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40'
                : 'border-white/15 bg-white/10 text-zinc-200 hover:bg-white/20 hover:text-white disabled:opacity-30'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">重置</span>
          </button>

          <button
            type="button"
            onClick={saveSettings}
            disabled={!isDirty || isSaving}
            className="flex items-center space-x-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer border border-blue-400/40 whitespace-nowrap shrink-0"
          >
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{isSaving ? '保存中...' : '保存更改'}</span>
          </button>
        </div>
      </div>

      {/* 顶部二级分类分段选择器 */}
      <nav
        className={`flex items-center gap-1 p-1 rounded-xl border shadow-2xs backdrop-blur-md transition-colors ${
          isLight
            ? 'bg-black/[0.04] border-black/[0.06]'
            : 'bg-white/[0.06] border-white/[0.08]'
        }`}
        aria-label="设置分类"
      >
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          const badgeCount = 'badge' in cat ? cat.badge : undefined;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id as SettingCategory)}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer select-none whitespace-nowrap ${
                isActive
                  ? isLight
                    ? 'bg-white text-blue-600 shadow-sm border border-black/[0.06] font-bold'
                    : 'bg-white/15 text-white shadow-sm border border-white/15 font-bold'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-black/[0.03]'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]'
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                  isActive
                    ? isLight
                      ? 'text-blue-600'
                      : 'text-blue-400'
                    : isLight
                    ? 'text-slate-500'
                    : 'text-zinc-400'
                }`}
              />
              <span className="truncate">{cat.label}</span>
              {badgeCount !== undefined && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold leading-none shrink-0 transition-colors ${
                    isActive
                      ? isLight
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-blue-500/25 text-blue-300'
                      : isLight
                      ? 'bg-black/[0.06] text-slate-600'
                      : 'bg-white/10 text-zinc-400'
                  }`}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 分类: 外观与个性化 */}
      {activeCategory === 'appearance' && <AppearancePanel />}

      {/* 分类: 快捷键与 AI 模型 */}
      {activeCategory === 'hotkey' && (
        <HotkeyPanel
          onStartCapture={onStartCapture}
          onTriggerSpotlight={onTriggerSpotlight}
          onTriggerClipboard={onTriggerClipboard}
          onToggleWindow={onToggleWindow}
        />
      )}

      {/* 分类: 在线引擎 */}
      {activeCategory === 'online' && <OnlinePanel />}

      {/* 分类: 专业词库 */}
      {activeCategory === 'dicts' && <DictsPanel />}

      {/* 分类: 优先级 */}
      {activeCategory === 'preference' && <PreferencePanel onOpenAbout={onOpenAbout} />}

      {/* 分类: 备份与同步 */}
      {activeCategory === 'backup' && <BackupSyncPanel />}
    </div>
  );
};
