import { create } from 'zustand';
import { cmdGetSettings, cmdSaveSettings } from '../services/tauri';
import { DEFAULT_APPEARANCE, DEFAULT_SETTINGS } from '../services/defaultSettings';
import type {
  AppSettings,
  LlmConfig,
  PresetDicts,
  OnlineEngines,
  AppearanceSettings,
  ThemeMode,
  FontFamilyOption,
  FontSizeOption,
  CustomDictItem,
  BackupSettings,
  WebdavConfig,
  AnkiSettings,
} from '../services/types';

interface SettingsState {
  settings: AppSettings;
  initialSettings: AppSettings;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  toastMessage: string | null;

  // Actions
  fetchSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  setHotkey: (hotkey: string) => void;
  setSpotlightHotkey: (hotkey: string) => void;
  setClipboardHotkey: (hotkey: string) => void;
  setToggleWindowHotkey: (hotkey: string) => void;
  setQuickWindowHotkey: (hotkey: string) => void;
  setCaptureHotkeyEnabled: (enabled: boolean) => void;
  setSpotlightHotkeyEnabled: (enabled: boolean) => void;
  setClipboardHotkeyEnabled: (enabled: boolean) => void;
  setToggleWindowHotkeyEnabled: (enabled: boolean) => void;
  setQuickWindowHotkeyEnabled: (enabled: boolean) => void;
  setDefaultPreset: (preset: string) => void;
  setCaptureEngine: (engine: string) => void;
  setLlmConfig: (updates: Partial<LlmConfig>) => void;
  addLlmConfig: (config: Partial<LlmConfig>) => void;
  updateLlmConfig: (id: string, updates: Partial<LlmConfig>) => void;
  deleteLlmConfig: (id: string) => void;
  setActiveLlmConfig: (id: string) => void;
  toggleLlmConfigEnabled: (id: string) => void;
  setPresetDictToggle: (dict: keyof PresetDicts, enabled: boolean) => void;
  setOnlineEngineToggle: (engine: keyof OnlineEngines, enabled: boolean) => void;
  setAllOnlineEngines: (mode: 'all' | 'recommended' | 'domestic' | 'none') => void;
  setTranslationTiers: (tiers: string[]) => void;
  moveTier: (fromIndex: number, toIndex: number) => void;
  setAppearance: (updates: Partial<AppearanceSettings>) => void;
  updateAppearance: (updates: Partial<AppearanceSettings>) => void;
  setThemeMode: (theme: ThemeMode) => void;
  setEnableBlur: (enabled: boolean) => void;
  setBlurAmount: (amount: number) => void;
  setEnableTransparency: (enabled: boolean) => void;
  setWindowOpacity: (opacity: number) => void;
  setFontFamilyOption: (font: FontFamilyOption) => void;
  setFontSizeOption: (size: FontSizeOption) => void;
  // Custom Dictionary CRUD
  addCustomDictItem: (item: { original: string; translated: string; category: string; note?: string }) => void;
  updateCustomDictItem: (item: CustomDictItem) => void;
  deleteCustomDictItem: (id: string) => void;
  importCustomDictItems: (items: { original: string; translated: string; category?: string; note?: string }[]) => void;
  // Offline Model Management
  setOfflineModelInstalled: (installed: boolean) => void;
  setOfflineModelEnabled: (enabled: boolean) => void;
  installOfflineModel: (modelId: string, modelName: string, sizeMB: number) => void;
  uninstallOfflineModel: (modelId: string) => void;
  setActiveOfflineModel: (modelId: string) => void;
  setOverlayViewMode: (mode: 'cover' | 'tooltip' | 'panel') => void;
  setEnableAabbAvoidance: (enabled: boolean) => void;
  setTranslationStyle: (style: 'literal' | 'free' | 'terminology') => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCaptureReleaseAction: (action: 'auto' | 'adjust') => void;
  setWatchIntervalMs: (ms: number) => void;
  setClipboardWatchEnabled: (enabled: boolean) => void;
  setOcrEngine: (engine: 'auto' | 'onnx' | 'winrt') => void;
  setOcrVersion: (version: 'v3' | 'v4' | 'v5' | 'v6' | 'v6t') => void;
  setPrimaryTranslationEngine: (engine: 'auto' | 'dict' | 'llm' | 'online') => void;
  setBaiduConfig: (appId: string, secret: string, llmApiKey?: string, useSameSecret?: boolean) => void;
  setDeeplConfig: (apiKey: string, customUrl: string) => void;
  setVolcengineConfig: (accessKey: string, secretKey: string) => void;
  setYandexConfig: (apiKey: string, folderId: string) => void;
  setCloseAction: (action: 'ask' | 'minimize' | 'exit') => void;
  setMiniWindowCloseAction: (action: 'hide' | 'minimize') => void;
  setAlwaysOnTop: (enabled: boolean) => void;
  setProxyEnabled: (enabled: boolean) => void;
  setProxyUrl: (url: string) => void;
  setTtsRate: (rate: number) => void;
  setAutoDetectPreset: (enabled: boolean) => void;
  setEnableLlmProgressiveRefine: (enabled: boolean) => void;
  setAutoFavoriteQualityTerms: (enabled: boolean) => void;
  setBackupSettings: (patch: Partial<BackupSettings>) => void;
  setOcrFilterEnabled: (enabled: boolean) => void;
  setOcrFilterRules: (rules: string[]) => void;
  setSelectionLookupEnabled: (enabled: boolean) => void;
  setHoverLookupEnabled: (enabled: boolean) => void;
  setHoverLookupModifier: (modifier: 'ctrl' | 'alt' | 'shift') => void;
  setWebdavConfig: (patch: Partial<WebdavConfig>) => void;
  setAnkiSettings: (patch: Partial<AnkiSettings>) => void;
  resetSettings: () => void;
  clearToast: () => void;
}

function checkIsDirty(current: AppSettings, initial: AppSettings): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const debouncedSaveSettings = (
  get: () => SettingsState,
  set: (partial: Partial<SettingsState> | ((state: SettingsState) => Partial<SettingsState>)) => void
) => {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(async () => {
    const { settings } = get();
    set({ isSaving: true });
    try {
      const savePromise = cmdSaveSettings(settings);
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Save settings timeout')), 4000)
      );
      await Promise.race([savePromise, timeoutPromise]);
      set({
        initialSettings: settings,
        isDirty: false,
      });
    } catch (err) {
      console.error('Failed to save settings (debounced):', err);
    } finally {
      set({ isSaving: false });
      saveDebounceTimer = null;
    }
  }, 300);
};

export const useSettingsStore = create<SettingsState>((set, get) => {
  /**
   * 内部通用 patch:合并字段 → 重算 isDirty → 按模式持久化。
   * 'now' 立即保存(离散开关/选择);'debounced' 300ms 防抖(滑杆/连续输入);
   * 'none' 仅更新状态(由调用方自行决定何时保存)。
   */
  const applyPatch = (
    partial: Partial<AppSettings>,
    mode: 'now' | 'debounced' | 'none' = 'now'
  ) => {
    const { settings, initialSettings } = get();
    const updated = { ...settings, ...partial };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    if (mode === 'now') get().saveSettings();
    else if (mode === 'debounced') debouncedSaveSettings(get, set);
  };

  return {
  settings: DEFAULT_SETTINGS,
  initialSettings: DEFAULT_SETTINGS,
  isDirty: false,
  isLoading: false,
  isSaving: false,
  toastMessage: null,

  fetchSettings: async () => {
    set({ isLoading: true });
    try {
      const fetched = await cmdGetSettings();
      const fetchedPool = fetched.llmConfigs && fetched.llmConfigs.length > 0
        ? fetched.llmConfigs
        : (fetched.llmConfig ? [fetched.llmConfig] : []);
      const rawTheme = fetched.appearance?.theme || fetched.theme || 'system';
      const normalizedTheme: ThemeMode = (rawTheme === 'fluent-dark' ? 'dark' : rawTheme) as ThemeMode;
      const initialAppearance: AppearanceSettings = {
        ...(fetched.appearance || DEFAULT_APPEARANCE),
        theme: normalizedTheme,
      };
      // 确保历史配置或未显式设为 'adjust' 的用户均默认采用 'auto'（松手即译）
      let releaseAction = fetched.captureReleaseAction || (fetched as any).capture_release_action;
      if (!releaseAction || releaseAction !== 'adjust') {
        releaseAction = 'auto';
      }

      const settingsWithAppearance: AppSettings = {
        ...fetched,
        hotkey: fetched.hotkey || 'F4',
        theme: normalizedTheme,
        spotlightHotkey: fetched.spotlightHotkey || 'Alt+Space',
        clipboardHotkey: fetched.clipboardHotkey || 'Ctrl+Shift+C',
        toggleWindowHotkey: fetched.toggleWindowHotkey || 'Alt+W',
        quickWindowHotkey: fetched.quickWindowHotkey || 'Alt+W',
        captureHotkeyEnabled: fetched.captureHotkeyEnabled ?? true,
        spotlightHotkeyEnabled: fetched.spotlightHotkeyEnabled ?? false,
        clipboardHotkeyEnabled: fetched.clipboardHotkeyEnabled ?? false,
        toggleWindowHotkeyEnabled: fetched.toggleWindowHotkeyEnabled ?? false,
        quickWindowHotkeyEnabled: fetched.quickWindowHotkeyEnabled ?? false,
        appearance: initialAppearance,
        llmConfig: fetched.llmConfig || fetchedPool[0] || null,
        llmConfigs: fetchedPool,
        overlayViewMode: fetched.overlayViewMode || 'cover',
        enableAabbAvoidance: fetched.enableAabbAvoidance !== undefined ? fetched.enableAabbAvoidance : true,
        translationStyle: fetched.translationStyle || 'free',
        sidebarCollapsed: fetched.sidebarCollapsed ?? false,
        captureReleaseAction: releaseAction,
        watchIntervalMs: fetched.watchIntervalMs ?? 3000,
        clipboardWatchEnabled: fetched.clipboardWatchEnabled ?? false,
        ocrEngine: fetched.ocrEngine || 'auto',
        ocrVersion: (fetched.ocrVersion as 'v3' | 'v4' | 'v5' | 'v6' | 'v6t') || 'v4',
        ocrFilterEnabled: fetched.ocrFilterEnabled ?? true,
        ocrFilterRules: fetched.ocrFilterRules ?? [],
        selectionLookupEnabled: fetched.selectionLookupEnabled ?? false,
        hoverLookupEnabled: fetched.hoverLookupEnabled ?? false,
        hoverLookupModifier: fetched.hoverLookupModifier ?? 'ctrl',
        backupSettings: {
          autoBackupEnabled: fetched.backupSettings?.autoBackupEnabled ?? false,
          intervalHours: fetched.backupSettings?.intervalHours ?? 24,
          maxLocalBackups: fetched.backupSettings?.maxLocalBackups ?? 10,
          lastBackupAtMs: fetched.backupSettings?.lastBackupAtMs,
        },
        webdavConfig: {
          ...fetched.webdavConfig,
          remoteDir: fetched.webdavConfig?.remoteDir || 'MaobuTranslator',
          retentionDays: fetched.webdavConfig?.retentionDays ?? 15,
        },
      };
      set({
        settings: settingsWithAppearance,
        initialSettings: settingsWithAppearance,
        isDirty: false,
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      set({ isLoading: false });
    }
  },

  saveSettings: async () => {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    const { settings } = get();
    set({ isSaving: true });
    try {
      const savePromise = cmdSaveSettings(settings);
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Save settings timeout')), 4000)
      );
      await Promise.race([savePromise, timeoutPromise]);
      set({
        initialSettings: settings,
        isDirty: false,
        toastMessage: 'Settings saved successfully!',
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
      set({
        toastMessage: 'Failed to save settings',
      });
    } finally {
      set({ isSaving: false });
    }
  },

  setHotkey: (hotkey: string) => applyPatch({ hotkey }),

  setSpotlightHotkey: (spotlightHotkey: string) => applyPatch({ spotlightHotkey }),

  setClipboardHotkey: (clipboardHotkey: string) => applyPatch({ clipboardHotkey }),

  setToggleWindowHotkey: (toggleWindowHotkey: string) => applyPatch({ toggleWindowHotkey }),

  setQuickWindowHotkey: (quickWindowHotkey: string) => applyPatch({ quickWindowHotkey }),

  setCaptureHotkeyEnabled: (enabled: boolean) => applyPatch({ captureHotkeyEnabled: enabled }),

  setSpotlightHotkeyEnabled: (enabled: boolean) => applyPatch({ spotlightHotkeyEnabled: enabled }),

  setClipboardHotkeyEnabled: (enabled: boolean) => applyPatch({ clipboardHotkeyEnabled: enabled }),

  setToggleWindowHotkeyEnabled: (enabled: boolean) => applyPatch({ toggleWindowHotkeyEnabled: enabled }),

  setQuickWindowHotkeyEnabled: (enabled: boolean) => applyPatch({ quickWindowHotkeyEnabled: enabled }),

  setLlmConfig: (updates: Partial<LlmConfig>) => {
    const { settings, initialSettings } = get();
    const currentLlm = settings.llmConfig || {
      provider: 'DeepSeek',
      apiKey: '',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
    };
    const updatedLlm = { ...currentLlm, ...updates };
    let updated: AppSettings = { ...settings, llmConfig: updatedLlm };
    if (settings.llmConfigs && updatedLlm.id) {
      const pool = settings.llmConfigs;
      let updatedPool = pool.map((c) => (c.id === updatedLlm.id ? updatedLlm : c));
      if (!pool.some((c) => c.id === updatedLlm.id)) {
        updatedPool = [...pool, updatedLlm];
      }
      updated = { ...updated, llmConfigs: updatedPool };
    }
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  addLlmConfig: (config: Partial<LlmConfig>) => {
    const { settings, initialSettings } = get();
    const pool = settings.llmConfigs || [];
    const provider = config.provider || 'Custom';
    const model = config.model || 'custom-model';
    const base = provider.toLowerCase().replace(/[\s\u4e00-\u9fff]+/g, '-').replace(/-+/g, '-');
    const uid = `${base}-${Date.now().toString(36)}`;
    const newConfig: LlmConfig = {
      id: uid,
      provider,
      apiKey: config.apiKey || '',
      model,
      endpoint: config.endpoint || 'https://api.custom-llm.com/v1',
      enabled: config.enabled ?? true,
      availableModels: config.availableModels,
    };
    const updatedPool = [...pool, newConfig];
    const updated = {
      ...settings,
      llmConfig: newConfig,
      llmConfigs: updatedPool,
    };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  updateLlmConfig: (id: string, updates: Partial<LlmConfig>) => {
    const { settings, initialSettings } = get();
    if (!settings.llmConfigs) return;
    const updatedPool = settings.llmConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    let newActive = settings.llmConfig;
    if (settings.llmConfig?.id === id) {
      newActive = updatedPool.find((c) => c.id === id) || settings.llmConfig;
    }
    const updated = { ...settings, llmConfigs: updatedPool, llmConfig: newActive };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  deleteLlmConfig: (id: string) => {
    const { settings, initialSettings } = get();
    const pool = settings.llmConfigs || [];
    const updatedPool = pool.filter((c) => c.id !== id);
    let newActive = settings.llmConfig;
    if (settings.llmConfig?.id === id) {
      newActive = updatedPool[0] || null;
    }
    const updated = { ...settings, llmConfigs: updatedPool, llmConfig: newActive };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  setActiveLlmConfig: (id: string) => {
    const { settings, initialSettings } = get();
    const pool = settings.llmConfigs || [];
    const target = pool.find((c) => c.id === id);
    if (!target) return;
    const updated = { ...settings, llmConfig: { ...target } };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  toggleLlmConfigEnabled: (id: string) => {
    const { settings, initialSettings } = get();
    const pool = settings.llmConfigs || [];
    const target = pool.find((c) => c.id === id);
    if (!target) return;
    const nextEnabled = !(target.enabled ?? true);
    const updatedPool = pool.map((c) => (c.id === id ? { ...c, enabled: nextEnabled } : c));
    let newActive = settings.llmConfig;
    if (settings.llmConfig?.id === id) {
      newActive = { ...settings.llmConfig, enabled: nextEnabled };
    }
    const updated = { ...settings, llmConfigs: updatedPool, llmConfig: newActive };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  setDefaultPreset: (preset: string) => applyPatch({ defaultPreset: preset }, 'none'),

  setCaptureEngine: (engine: string) => applyPatch({ captureEngine: engine }, 'none'),

  setPresetDictToggle: (dict: keyof PresetDicts, enabled: boolean) => {
    const { settings, initialSettings } = get();
    const updatedPresetDicts = {
      ...settings.presetDicts,
      [dict]: enabled,
    };
    const updated = { ...settings, presetDicts: updatedPresetDicts };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  setOnlineEngineToggle: (engine: keyof OnlineEngines, enabled: boolean) => {
    const { settings, initialSettings } = get();
    const currentOnline = settings.onlineEngines || DEFAULT_SETTINGS.onlineEngines!;
    const updatedOnline = {
      ...currentOnline,
      [engine]: enabled,
    };
    const updated = { ...settings, onlineEngines: updatedOnline };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    debouncedSaveSettings(get, set);
  },

  setAllOnlineEngines: (mode: 'all' | 'recommended' | 'domestic' | 'none') => {
    const { settings, initialSettings } = get();
    let updatedOnline: OnlineEngines;
    if (mode === 'all') {
      updatedOnline = {
        google: true,
        bing: true,
        youdao: true,
        deepl: true,
        myMemory: true,
        baidu: true,
        baiduLlm: true,
        tencent: true,
        lingva: true,
        caiyun: true,
        urban: true,
        volcengine: true,
        yandex: true,
      };
    } else if (mode === 'recommended' || mode === 'domestic') {
      updatedOnline = {
        google: false,
        bing: true,
        youdao: true,
        deepl: false,
        myMemory: false,
        baidu: false,
        baiduLlm: false,
        tencent: true,
        lingva: true,
        caiyun: true,
        urban: false,
        volcengine: true,
        yandex: false,
      };
    } else {
      updatedOnline = {
        google: false,
        bing: false,
        youdao: false,
        deepl: false,
        myMemory: false,
        baidu: false,
        baiduLlm: false,
        tencent: false,
        lingva: false,
        caiyun: false,
        urban: false,
        volcengine: false,
        yandex: false,
      };
    }
    const updated = { ...settings, onlineEngines: updatedOnline };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    debouncedSaveSettings(get, set);
  },

  setBaiduConfig: (appId: string, secret: string, llmApiKey?: string, useSameSecret?: boolean) => {
    const { settings, initialSettings } = get();
    const updated = {
      ...settings,
      baiduAppId: appId,
      baiduSecret: secret,
      ...(llmApiKey !== undefined ? { baiduLlmApiKey: llmApiKey } : {}),
      ...(useSameSecret !== undefined ? { useBaiduSameSecret: useSameSecret } : {}),
    };
    set({ settings: updated, isDirty: checkIsDirty(updated, initialSettings) });
    debouncedSaveSettings(get, set);
  },

  setDeeplConfig: (apiKey: string, customUrl: string) => {
    const { settings, initialSettings } = get();
    const updated = { ...settings, deeplApiKey: apiKey, deeplCustomUrl: customUrl };
    set({ settings: updated, isDirty: checkIsDirty(updated, initialSettings) });
    debouncedSaveSettings(get, set);
  },

  setVolcengineConfig: (accessKey: string, secretKey: string) => {
    const { settings, initialSettings } = get();
    const updated = { ...settings, volcengineAccessKey: accessKey, volcengineSecretKey: secretKey };
    set({ settings: updated, isDirty: checkIsDirty(updated, initialSettings) });
    debouncedSaveSettings(get, set);
  },

  setYandexConfig: (apiKey: string, folderId: string) => {
    const { settings, initialSettings } = get();
    const updated = { ...settings, yandexApiKey: apiKey, yandexFolderId: folderId };
    set({ settings: updated, isDirty: checkIsDirty(updated, initialSettings) });
    debouncedSaveSettings(get, set);
  },

  setTranslationTiers: (tiers: string[]) => applyPatch({ translationTiers: tiers }, 'none'),

  moveTier: (fromIndex: number, toIndex: number) => {
    const { settings, initialSettings } = get();
    const tiers = [...settings.translationTiers];
    if (fromIndex < 0 || fromIndex >= tiers.length || toIndex < 0 || toIndex >= tiers.length) {
      return;
    }
    const [movedItem] = tiers.splice(fromIndex, 1);
    tiers.splice(toIndex, 0, movedItem);
    const updated = { ...settings, translationTiers: tiers };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  setAppearance: (updates: Partial<AppearanceSettings>) => {
    const { settings, initialSettings } = get();
    const currentAppearance = settings.appearance || DEFAULT_APPEARANCE;
    const updatedAppearance = { ...currentAppearance, ...updates };
    const syncTheme: ThemeMode = (updates.theme !== undefined
      ? updates.theme
      : (updatedAppearance.theme || settings.theme || 'system')) as ThemeMode;
    const normalizedTheme: ThemeMode = syncTheme === ('fluent-dark' as any) ? 'dark' : syncTheme;
    updatedAppearance.theme = normalizedTheme;

    const updated: AppSettings = {
      ...settings,
      theme: normalizedTheme,
      appearance: updatedAppearance,
    };
    // 毫秒级即时同步 CSS 根变量，消除 React 调度与 re-render 延迟
    if (typeof document !== 'undefined') {
      const bEnabled = updatedAppearance.enableBlur ?? true;
      const bAmount = bEnabled ? (updatedAppearance.blurAmount ?? 24) : 0;
      document.documentElement.style.setProperty('--glass-blur', `${bAmount}px`);
    }

    // 毫秒级即时同步 UI 状态
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    // 300ms 防抖持久化写盘，防止用户快速滑动滑杆时密集 I/O 导致卡顿掉帧
    debouncedSaveSettings(get, set);
  },
  updateAppearance: (updates: Partial<AppearanceSettings>) => {
    get().setAppearance(updates);
  },
  setThemeMode: (theme: ThemeMode) => {
    const normalizedTheme: ThemeMode = theme === ('fluent-dark' as any) ? 'dark' : theme;
    get().setAppearance({ theme: normalizedTheme });
  },
  setEnableBlur: (enableBlur: boolean) => {
    const current = get().settings.appearance;
    const updates: Partial<AppearanceSettings> = { enableBlur };
    // 纯色主题会把 blurAmount 预设为 0；重新开启磨砂时恢复默认模糊量，
    // 否则开关亮着却因 0px 依然纯色（用户感知为"失效"）。
    if (enableBlur && (current?.blurAmount ?? 24) === 0) {
      updates.blurAmount = 24;
    }
    get().setAppearance(updates);
  },
  setBlurAmount: (blurAmount: number) => get().setAppearance({ blurAmount }),
  setEnableTransparency: (enableTransparency: boolean) => get().setAppearance({ enableTransparency }),
  setWindowOpacity: (windowOpacity: number) => get().setAppearance({ windowOpacity }),
  setFontFamilyOption: (fontFamily: FontFamilyOption) => get().setAppearance({ fontFamily }),
  setFontSizeOption: (fontSize: FontSizeOption) => get().setAppearance({ fontSize }),

  // Custom Dictionary CRUD Implementations
  addCustomDictItem: (item) => {
    const { settings, initialSettings } = get();
    const current = settings.customDictItems || [];
    const newItem: CustomDictItem = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      original: item.original.trim(),
      translated: item.translated.trim(),
      category: item.category || '通用CG',
      note: item.note?.trim() || '',
      createdAt: new Date().toLocaleDateString('zh-CN'),
    };
    const updatedList = [newItem, ...current];
    const updatedSettings = { ...settings, customDictItems: updatedList };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
    });
  },

  updateCustomDictItem: (item) => {
    const { settings, initialSettings } = get();
    const current = settings.customDictItems || [];
    const updatedList = current.map((i) => (i.id === item.id ? item : i));
    const updatedSettings = { ...settings, customDictItems: updatedList };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
    });
  },

  deleteCustomDictItem: (id) => {
    const { settings, initialSettings } = get();
    const current = settings.customDictItems || [];
    const updatedList = current.filter((i) => i.id !== id);
    const updatedSettings = { ...settings, customDictItems: updatedList };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
    });
  },

  importCustomDictItems: (items) => {
    const { settings, initialSettings } = get();
    const current = settings.customDictItems || [];
    const newItems: CustomDictItem[] = items.map((it, idx) => ({
      id: `custom_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
      original: it.original.trim(),
      translated: it.translated.trim(),
      category: it.category || '通用CG',
      note: it.note?.trim() || '',
      createdAt: new Date().toLocaleDateString('zh-CN'),
    }));
    const updatedList = [...newItems, ...current];
    const updatedSettings = { ...settings, customDictItems: updatedList };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
      toastMessage: `成功导入 ${newItems.length} 条自定义词条！`,
    });
  },

  setOfflineModelInstalled: (installed: boolean) => {
    const { settings, initialSettings } = get();
    const currentOffline = settings.offlineModel || {
      installed: false,
      activeModelId: 'opus-standard',
      enabled: true,
      installedModelIds: [],
      modelName: 'Opus-MT 英汉标准版',
      sizeMB: 38.5,
    };
    const updatedOffline = {
      ...currentOffline,
      installed,
      downloadDate: installed ? new Date().toLocaleDateString('zh-CN') : undefined,
    };
    const updatedSettings = { ...settings, offlineModel: updatedOffline };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
      toastMessage: installed ? '离线神经网络翻译模型包已成功安装！断网时自动启用。' : '已卸载离线神经网络模型。',
    });
  },

  setOfflineModelEnabled: (enabled: boolean) => {
    const { settings, initialSettings } = get();
    const currentOffline = settings.offlineModel || {
      installed: false,
      activeModelId: 'opus-standard',
      enabled: true,
      installedModelIds: [],
      modelName: 'Opus-MT 英汉标准版',
      sizeMB: 38.5,
    };
    const updatedOffline = { ...currentOffline, enabled };
    const updatedSettings = { ...settings, offlineModel: updatedOffline };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
    });
  },

  installOfflineModel: (modelId: string, modelName: string, sizeMB: number) => {
    const { settings, initialSettings } = get();
    const currentOffline = settings.offlineModel || {
      installed: false,
      activeModelId: 'opus-standard',
      enabled: true,
      installedModelIds: [],
      modelName: 'Opus-MT 英汉标准版',
      sizeMB: 38.5,
    };
    const installedIds = Array.from(new Set([...(currentOffline.installedModelIds || []), modelId]));
    const updatedOffline = {
      ...currentOffline,
      installed: true,
      activeModelId: modelId,
      installedModelIds: installedIds,
      modelName,
      sizeMB,
      downloadDate: new Date().toLocaleDateString('zh-CN'),
    };
    const updatedSettings = { ...settings, offlineModel: updatedOffline };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
      toastMessage: `模型【${modelName}】成功下载并安装！断网时自动启用。`,
    });
  },

  uninstallOfflineModel: (modelId: string) => {
    const { settings, initialSettings } = get();
    const currentOffline = settings.offlineModel || {
      installed: false,
      activeModelId: 'opus-standard',
      enabled: true,
      installedModelIds: [],
      modelName: 'Opus-MT 英汉标准版',
      sizeMB: 38.5,
    };
    const installedIds = (currentOffline.installedModelIds || []).filter(id => id !== modelId);
    const hasRemaining = installedIds.length > 0;
    const updatedOffline = {
      ...currentOffline,
      installed: hasRemaining,
      activeModelId: hasRemaining ? installedIds[0] : 'opus-standard',
      installedModelIds: installedIds,
    };
    const updatedSettings = { ...settings, offlineModel: updatedOffline };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
      toastMessage: `已成功卸载模型。`,
    });
  },

  setActiveOfflineModel: (modelId: string) => {
    const { settings, initialSettings } = get();
    const currentOffline = settings.offlineModel || {
      installed: false,
      activeModelId: 'opus-standard',
      enabled: true,
      installedModelIds: [],
      modelName: 'Opus-MT 英汉标准版',
      sizeMB: 38.5,
    };
    const updatedOffline = {
      ...currentOffline,
      activeModelId: modelId,
    };
    const updatedSettings = { ...settings, offlineModel: updatedOffline };
    set({
      settings: updatedSettings,
      isDirty: checkIsDirty(updatedSettings, initialSettings),
      toastMessage: `已成功切换默认离线模型。`,
    });
  },

  resetSettings: () => {
    const { initialSettings } = get();
    set({
      settings: initialSettings,
      isDirty: false,
    });
  },

  setOverlayViewMode: (mode: 'cover' | 'tooltip' | 'panel') => applyPatch({ overlayViewMode: mode }),

  setEnableAabbAvoidance: (enabled: boolean) => applyPatch({ enableAabbAvoidance: enabled }),

  setTranslationStyle: (style) => applyPatch({ translationStyle: style }),

  setSidebarCollapsed: (collapsed) => applyPatch({ sidebarCollapsed: collapsed }),

  setCaptureReleaseAction: (action) => applyPatch({ captureReleaseAction: action }),

  setWatchIntervalMs: (ms) => {
    const clamped = Math.min(10000, Math.max(1000, Math.round(ms)));
    applyPatch({ watchIntervalMs: clamped });
  },

  setClipboardWatchEnabled: (enabled) => applyPatch({ clipboardWatchEnabled: enabled }),

  setOcrEngine: (engine) => applyPatch({ ocrEngine: engine }),

  setOcrVersion: (version) => applyPatch({ ocrVersion: version }, 'debounced'),

  setPrimaryTranslationEngine: (engine) => applyPatch({ primaryTranslationEngine: engine }),

  setCloseAction: (action) => applyPatch({ closeAction: action }),

  setMiniWindowCloseAction: (action) => applyPatch({ miniWindowCloseAction: action }),

  setAlwaysOnTop: (enabled) => applyPatch({ alwaysOnTop: enabled }),

  setProxyEnabled: (enabled) => applyPatch({ proxyEnabled: enabled }),

  setProxyUrl: (url) => applyPatch({ proxyUrl: url }, 'debounced'),

  setAutoDetectPreset: (enabled) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, autoDetectPreset: enabled };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setEnableLlmProgressiveRefine: (enabled) => applyPatch({ enableLlmProgressiveRefine: enabled }),
  setAutoFavoriteQualityTerms: (enabled) => applyPatch({ autoFavoriteQualityTerms: enabled }),

  setTtsRate: (rate) => {
    const clamped = Math.min(2, Math.max(0.5, Math.round(rate * 10) / 10));
    applyPatch({ ttsRate: clamped }, 'debounced');
  },

  setOcrFilterEnabled: (enabled) => applyPatch({ ocrFilterEnabled: enabled }),
  setOcrFilterRules: (rules) => applyPatch({ ocrFilterRules: rules }),
  setSelectionLookupEnabled: (enabled) => applyPatch({ selectionLookupEnabled: enabled }),
  setHoverLookupEnabled: (enabled) => applyPatch({ hoverLookupEnabled: enabled }),
  setHoverLookupModifier: (modifier) => applyPatch({ hoverLookupModifier: modifier }),

  setBackupSettings: (patch) =>
    applyPatch({ backupSettings: { ...get().settings.backupSettings, ...patch } }),

  setWebdavConfig: (patch) =>
    applyPatch({ webdavConfig: { ...get().settings.webdavConfig, ...patch } }),

  setAnkiSettings: (patch) =>
    applyPatch({ ankiSettings: { ...get().settings.ankiSettings, ...patch } }),

  clearToast: () => {
    set({ toastMessage: null });
  },
  };
});

