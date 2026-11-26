import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Layers,
  Search,
  X,
  ArrowRight,
  Eye,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useSlidingIndicator } from '../../hooks/useSlidingIndicator';
import { SlidingHighlight } from '../Common/SlidingHighlight';
import { BackupSyncPanel } from './BackupSyncPanel';
import { AppearancePanel } from './panels/AppearancePanel';
import { HotkeyPanel } from './panels/HotkeyPanel';
import { OnlinePanel, ONLINE_ENGINE_DEFS } from './panels/OnlinePanel';
import { GlossaryPanel } from './panels/GlossaryPanel';
import { DictsPanel } from './panels/DictsPanel';
import { PreferencePanel } from './panels/PreferencePanel';
import { APP_VERSION } from '../../version';

type SettingCategory = 'appearance' | 'hotkey' | 'online' | 'glossary' | 'dicts' | 'preference' | 'backup';

export type SettingsCategory = SettingCategory;

interface SettingsDashboardProps {
  onStartCapture?: () => void;
  onTriggerSpotlight?: () => void;
  onTriggerClipboard?: () => void;
  onToggleWindow?: () => void;
  onOpenAbout?: () => void;
  /** 首次挂载时直接选中该分类（OCR 模型引导弹窗「去下载」跳转用）。 */
  initialCategory?: SettingCategory;
  /** 定位到内嵌的 OCR 模型管理卡片并滚动到可见。 */
  focusOcrModels?: boolean;
  /** 一次性跳转处理完成后的回调（App 用它清空跳转提示，避免下次手动进设置也停在词库页）。 */
  onInitialApplied?: () => void;
}

interface SearchSettingItem {
  id: string;
  title: string;
  sub: string;
  keywords: string;
  category: SettingCategory;
  scrollOcr?: boolean;
}

const SETTINGS_SEARCH_INDEX: SearchSettingItem[] = [
  { id: 'theme', title: '视觉主题与深浅模式', sub: '外观与个性化', keywords: '主题 浅色 深色 跟随系统 theme light dark', category: 'appearance' },
  { id: 'blur', title: '毛玻璃高斯模糊与窗口透明度', sub: '外观与个性化', keywords: '磨砂 高斯模糊 透明度 玻璃 blur opacity', category: 'appearance' },
  { id: 'font', title: '全局字体与字号缩放', sub: '外观与个性化', keywords: '字体 字号 微软雅黑 font size', category: 'appearance' },
  { id: 'hotkey', title: '全局划词 / Spotlight / 剪贴板快捷键', sub: '快捷键与 AI 模型', keywords: '快捷键 热键 F4 录制 划词 spotlight', category: 'hotkey' },
  { id: 'llm', title: 'AI 大语言模型供应商与 API Key', sub: '快捷键与 AI 模型', keywords: 'ai 大模型 llm deepseek gemini openai ollama api key 模型', category: 'hotkey' },
  { id: 'online', title: '在线翻译引擎开关与秘钥配置', sub: '在线引擎', keywords: '在线 引擎 通道 google bing youdao deepl 百度 腾讯 彩云 lingva', category: 'online' },
  { id: 'glossary', title: '专属术语库与 Anki 同步', sub: '专属术语库', keywords: '术语 库 导入 导出 anki glossary', category: 'glossary' },
  { id: 'ocr', title: '离线 OCR 识别模型下载与管理', sub: '专业词库 / OCR', keywords: 'ocr 模型 离线 识别 下载 pp-ocr', category: 'dicts', scrollOcr: true },
  { id: 'dicts', title: 'CG 行业词库与通用离线词典', sub: '专业词库 / OCR', keywords: '词库 词典 blender substance unity unreal maya houdini', category: 'dicts' },
  { id: 'priority', title: '翻译引擎四级优先级调度', sub: '偏好与优先级', keywords: '优先级 顺序 调度 默认词库 preset', category: 'preference' },
  { id: 'network', title: '网络代理与连通性诊断', sub: '偏好与优先级', keywords: '代理 proxy 网络 诊断 超时 开机自启 置顶 关闭行为', category: 'preference' },
  { id: 'backup', title: '本地快照导出与 WebDAV 云端同步', sub: '备份与同步', keywords: '备份 同步 webdav 坚果云 恢复 导出', category: 'backup' },
];

// 模块级「已拉取过一次」标记:App 挂载时已全局 fetchSettings,设置页只兜底拉取一次
let hasFetchedSettingsOnce = false;

/**
 * 设置中心外壳（方案 A：Vision 左导右览控制中心）：
 * 左侧粘性磨砂导航 + 搜设置快捷直达 + 右侧粘性操作页头与子面板舞台。
 */
export const SettingsDashboard: React.FC<SettingsDashboardProps> = ({
  onStartCapture,
  onTriggerSpotlight,
  onTriggerClipboard,
  onToggleWindow,
  onOpenAbout,
  initialCategory,
  focusOcrModels,
  onInitialApplied,
}) => {
  const {
    settings,
    isDirty,
    isLoading,
    isSaving,
    toastMessage,
    toastKind,
    fetchSettings,
    saveSettings,
    resetSettings,
    clearToast,
  } = useSettingsStore();

  const { isLight } = useAppTheme();
  const [activeCategory, setActiveCategory] = useState<SettingCategory>(initialCategory ?? 'appearance');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const {
    containerRef: navRef,
    registerItem: registerNavItem,
    rect: navIndicator,
    isReady: isNavSliderReady,
  } = useSlidingIndicator<HTMLElement>(activeCategory, [isLoading]);

  const openOcrModels = () => {
    setActiveCategory('dicts');
    requestAnimationFrame(() => {
      document.getElementById('ocr-models-card-anchor')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  };

  // 引导跳转：切到指定分类后滚动到 OCR 模型卡片，用户可直接一键下载
  const initialAppliedRef = useRef(false);
  useEffect(() => {
    if (focusOcrModels) {
      const raf = requestAnimationFrame(() => {
        document
          .getElementById('ocr-models-card-anchor')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      if (!initialAppliedRef.current) {
        initialAppliedRef.current = true;
        onInitialApplied?.();
      }
      return () => cancelAnimationFrame(raf);
    }
  }, [focusOcrModels, activeCategory, onInitialApplied]);

  // App 挂载时已全局 fetchSettings；这里只在首次进入设置页时兜底拉取一次
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

  // 点击外部或按 Escape 关闭搜索跳转浮层
  useEffect(() => {
    if (!searchFocused && !searchQuery) return;
    const handleOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchFocused(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [searchFocused, searchQuery]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_SEARCH_INDEX.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.sub.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
    );
  }, [searchQuery]);

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
    {
      id: 'appearance' as const,
      label: '外观与个性化',
      desc: '自定义视觉主题、高斯模糊透明度与全局字体排版',
      group: '视觉与交互',
      icon: Palette,
    },
    {
      id: 'hotkey' as const,
      label: '快捷键与 AI 模型',
      desc: '录制全局划词热键、取词模式与多厂商大模型配置池',
      group: '视觉与交互',
      icon: Zap,
    },
    {
      id: 'online' as const,
      label: '在线引擎',
      desc: '管理公开在线翻译渠道开关、自有 API Key 与凭据校验',
      group: '引擎与词库',
      badge: activeOnlineCount,
      icon: Globe,
    },
    {
      id: 'glossary' as const,
      label: '专属术语库',
      desc: '个人术语强干预词条管理、表格导入导出与 Anki 同步',
      group: '引擎与词库',
      icon: BookOpen,
    },
    {
      id: 'dicts' as const,
      label: '专业词库 / OCR',
      desc: 'CG 领域专业术语预设、通用词典与离线高精度 OCR 模型',
      group: '引擎与词库',
      icon: Layers,
    },
    {
      id: 'preference' as const,
      label: '偏好与优先级',
      desc: '调度优先级排序、代理网络诊断、开机自启与窗口行为',
      group: '系统与数据',
      icon: Sliders,
    },
    {
      id: 'backup' as const,
      label: '备份与同步',
      desc: '本地加密快照导出恢复与 WebDAV 云端自动备份同步',
      group: '系统与数据',
      icon: CloudUpload,
    },
  ];

  const navGroups = ['视觉与交互', '引擎与词库', '系统与数据'] as const;
  const activeMeta = categories.find((c) => c.id === activeCategory) || categories[0];
  const ActiveIcon = activeMeta.icon;

  return (
    <div
      className={`flex flex-col min-[720px]:flex-row items-start gap-4 font-sans pb-10 ${
        isLight ? 'text-slate-800' : 'text-zinc-200'
      }`}
    >
      {/* Toast 操作通知 */}
      {toastMessage && (
        <div
          role={toastKind === 'error' ? 'alert' : 'status'}
          className={`vision-modal-shell animate-toast-in fixed bottom-24 right-6 z-50 flex items-center space-x-2.5 rounded-2xl px-4 py-3 text-xs border ${
            toastKind === 'error' ? 'border-rose-500/50' : 'border-emerald-500/40'
          }`}
          style={{ color: 'var(--g-text-1)' }}
        >
          {toastKind === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          )}
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* 左侧粘性磨砂控制栏（方案 A） */}
      <aside
        data-testid="settings-workspace-sidebar"
        className="settings-sidebar-glass w-full min-[720px]:w-[222px] lg:w-[234px] shrink-0 min-[720px]:sticky min-[720px]:top-2 p-3 space-y-3"
      >
        {/* 标题 + 版本胶囊 */}
        <div className="flex items-center justify-between px-1.5 pt-0.5">
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--g-text-1)' }}>
              系统设置
            </h1>
            <p className="text-[10.5px] truncate mt-0.5" style={{ color: 'var(--g-text-3)' }}>
              配置快捷键、模型与偏好
            </p>
          </div>
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold shrink-0"
            style={{
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent-border)',
              color: 'var(--accent-text)',
            }}
          >
            v{APP_VERSION}
          </span>
        </div>

        {/* 搜设置快捷直达 */}
        <div ref={searchBoxRef} className="relative">
          <div className="vision-select-search relative flex items-center">
            <Search
              className="h-3.5 w-3.5 absolute left-2.5 pointer-events-none"
              style={{ color: 'var(--g-text-3)' }}
            />
            <input
              type="text"
              data-testid="settings-search-input"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchFocused(true);
              }}
              placeholder="搜设置（OCR / 代理 / Key）..."
              className="w-full bg-transparent pl-8 pr-7 py-1.5 text-xs outline-none placeholder:text-[11px]"
              style={{ color: 'var(--g-text-1)' }}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="清空设置搜索"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 opacity-65 hover:opacity-100 cursor-pointer"
                style={{ color: 'var(--g-text-2)' }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {searchFocused && searchQuery.trim().length > 0 && (
            <div
              data-testid="settings-search-results"
              className="vision-select-popover absolute left-0 right-0 top-full mt-1.5 z-40 max-h-60 overflow-y-auto space-y-0.5"
            >
              {searchResults.length > 0 ? (
                searchResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.scrollOcr) {
                        openOcrModels();
                      } else {
                        setActiveCategory(item.category);
                      }
                      setSearchQuery('');
                      setSearchFocused(false);
                    }}
                    className="vision-select-option"
                  >
                    <div className="min-w-0 pr-1">
                      <div className="truncate font-semibold text-[11.5px]" style={{ color: 'var(--g-text-1)' }}>
                        {item.title}
                      </div>
                      <div className="text-[10px] truncate" style={{ color: 'var(--g-text-3)' }}>
                        {item.sub}
                      </div>
                    </div>
                    <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />
                  </button>
                ))
              ) : (
                <div className="py-3 text-center text-[11px]" style={{ color: 'var(--g-text-3)' }}>
                  未找到与「{searchQuery}」匹配的设置
                </div>
              )}
            </div>
          )}
        </div>

        {/* 分组式 7 大分类导航（带垂直弹性滑动高亮胶囊） */}
        <nav ref={navRef} aria-label="设置分类" className="relative space-y-2.5">
          <SlidingHighlight
            rect={navIndicator}
            isReady={isNavSliderReady}
            variant="glass"
            radiusClass="rounded-xl"
            testId="settings-nav-slider"
          />
          {navGroups.map((groupName) => (
            <div key={groupName} className="relative z-10 space-y-0.5">
              <div
                className="px-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider select-none"
                style={{ color: 'var(--g-text-3)' }}
              >
                {groupName}
              </div>
              <div className="space-y-0.5">
                {categories
                  .filter((c) => c.group === groupName)
                  .map((cat) => {
                    const Icon = cat.icon;
                    const isActive = activeCategory === cat.id;
                    const badgeCount = 'badge' in cat ? cat.badge : undefined;
                    const useFallbackActiveSurface = isActive && !isNavSliderReady;
                    return (
                      <button
                        key={cat.id}
                        ref={registerNavItem(cat.id)}
                        type="button"
                        onClick={() => setActiveCategory(cat.id)}
                        className={`relative z-10 w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold border transition-colors duration-150 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                          isActive
                            ? 'font-bold border-transparent'
                            : 'border-transparent hover:bg-[var(--g-surface-2)]'
                        }`}
                        style={
                          isActive
                            ? useFallbackActiveSurface
                              ? {
                                  background: 'var(--accent-soft)',
                                  borderColor: 'var(--accent-border)',
                                  color: 'var(--accent-text)',
                                  boxShadow: 'var(--g-inset-top)',
                                }
                              : { color: 'var(--accent-text)' }
                            : { color: 'var(--g-text-2)' }
                        }
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Icon
                            className="w-3.5 h-3.5 shrink-0"
                            style={{ color: isActive ? 'var(--accent-text)' : 'var(--g-text-3)' }}
                          />
                          <span className="truncate">{cat.label}</span>
                        </span>
                        {badgeCount !== undefined && (
                          <span
                            className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold leading-none shrink-0"
                            style={
                              isActive
                                ? { background: 'var(--accent)', color: '#ffffff' }
                                : { background: 'var(--g-surface-3)', color: 'var(--g-text-2)' }
                            }
                          >
                            {badgeCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        {/* 底部高频直达快捷入口 */}
        <div
          className="pt-2.5 border-t grid grid-cols-2 gap-1.5"
          style={{ borderColor: 'var(--g-hairline)' }}
          aria-label="常用设置入口"
        >
          <button
            type="button"
            onClick={openOcrModels}
            className="vision-select-trigger flex items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold cursor-pointer"
          >
            <Eye className="h-3 w-3 shrink-0" style={{ color: 'var(--accent-text)' }} />
            <span>OCR 模型</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('online')}
            className="vision-select-trigger flex items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold cursor-pointer"
          >
            <Globe className="h-3 w-3 shrink-0" style={{ color: 'var(--accent-text)' }} />
            <span>翻译通道</span>
          </button>
        </div>
      </aside>

      {/* 右侧页头 + 子面板主舞台 */}
      <div className="flex-1 min-w-0 w-full space-y-4">
        <header
          data-testid="settings-sticky-header"
          className="settings-sticky-header px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="h-8 w-8 rounded-xl flex items-center justify-center border shrink-0"
              style={{
                background: 'var(--accent-soft)',
                borderColor: 'var(--accent-border)',
                color: 'var(--accent-text)',
              }}
            >
              <ActiveIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight truncate" style={{ color: 'var(--g-text-1)' }}>
                {activeMeta.label}
              </h2>
              <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--g-text-3)' }}>
                {activeMeta.desc}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
            {isDirty && (
              <span
                className={`flex items-center space-x-1 text-xs font-medium border px-2.5 py-1 rounded-full animate-pulse whitespace-nowrap shrink-0 ${
                  isLight
                    ? 'text-amber-700 bg-amber-50 border-amber-300'
                    : 'text-amber-300 bg-amber-500/15 border-amber-400/30'
                }`}
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>未保存</span>
              </span>
            )}

            <button
              type="button"
              onClick={resetSettings}
              disabled={!isDirty}
              className="vision-select-trigger flex items-center space-x-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">重置</span>
            </button>

            <button
              type="button"
              onClick={saveSettings}
              disabled={!isDirty || isSaving}
              className="flex items-center space-x-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-35 disabled:cursor-not-allowed transition cursor-pointer whitespace-nowrap shrink-0"
              style={{
                background: 'var(--accent)',
                boxShadow: !isDirty || isSaving ? undefined : '0 4px 12px color-mix(in srgb, var(--accent) 34%, transparent)',
              }}
            >
              <Save className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{isSaving ? '保存中...' : '保存更改'}</span>
            </button>
          </div>
        </header>

        {/* 子面板切换容器 */}
        <div key={activeCategory} className="animate-settings-pane-in">
          {activeCategory === 'appearance' && <AppearancePanel />}

          {activeCategory === 'hotkey' && (
            <HotkeyPanel
              onStartCapture={onStartCapture}
              onTriggerSpotlight={onTriggerSpotlight}
              onTriggerClipboard={onTriggerClipboard}
              onToggleWindow={onToggleWindow}
            />
          )}

          {activeCategory === 'online' && <OnlinePanel />}

          {activeCategory === 'glossary' && <GlossaryPanel />}

          {activeCategory === 'dicts' && <DictsPanel />}

          {activeCategory === 'preference' && <PreferencePanel onOpenAbout={onOpenAbout} />}

          {activeCategory === 'backup' && <BackupSyncPanel />}
        </div>
      </div>
    </div>
  );
};
