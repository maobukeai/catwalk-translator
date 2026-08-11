import { create } from 'zustand';
import { cmdGetSettings, cmdSaveSettings } from '../services/tauri';
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
} from '../services/types';

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'fluent-dark',
  enableBlur: true,
  blurAmount: 24,
  enableTransparency: true,
  windowOpacity: 85,
  fontFamily: 'system',
  fontSize: 'medium',
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'fluent-dark',
  hotkey: 'Ctrl+Alt+D',
  spotlightHotkey: 'Alt+Space',
  clipboardHotkey: 'Ctrl+Shift+C',
  toggleWindowHotkey: 'Alt+Q',
  captureHotkeyEnabled: true,
  spotlightHotkeyEnabled: true,
  clipboardHotkeyEnabled: true,
  toggleWindowHotkeyEnabled: true,
  defaultPreset: 'blender',
  captureEngine: 'auto',
  llmConfig: {
    id: 'llm-deepseek-deepseek-chat',
    provider: 'DeepSeek',
    apiKey: '',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  },
  llmConfigs: [
    {
      id: 'llm-deepseek-deepseek-chat',
      provider: 'DeepSeek',
      apiKey: '',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
    },
    {
      id: 'llm-openai-gpt-4o-mini',
      provider: 'OpenAI',
      apiKey: '',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1',
    },
    {
      id: 'llm-ollama-llama3',
      provider: 'Ollama',
      apiKey: '',
      model: 'llama3',
      endpoint: 'http://localhost:11434/v1',
    },
    {
      id: 'llm-智谱-glm-4-flash',
      provider: '智谱 GLM',
      apiKey: '',
      model: 'glm-4-flash',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    },
    {
      id: 'llm-custom-custom-model',
      provider: 'Custom',
      apiKey: '',
      model: 'custom-model',
      endpoint: 'https://api.custom-llm.com/v1',
    },
  ],
  translationTiers: ['Preset Dictionary', 'LLM API', 'Online Fallback'],
  presetDicts: {
    blender: true,
    substance: true,
    unity: true,
    unreal: true,
    maya: true,
    houdini: true,
  },
  onlineEngines: {
    google: true,
    bing: true,
    youdao: true,
    deepl: false,
    myMemory: false,
    baidu: false,
    tencent: false,
  },
  appearance: DEFAULT_APPEARANCE,
  offlineModel: {
    installed: false,
    activeModelId: 'opus-standard',
    enabled: true,
    installedModelIds: [],
    modelName: 'Opus-MT 英汉标准版',
    sizeMB: 38.5,
  },
};

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
  setCaptureHotkeyEnabled: (enabled: boolean) => void;
  setSpotlightHotkeyEnabled: (enabled: boolean) => void;
  setClipboardHotkeyEnabled: (enabled: boolean) => void;
  setToggleWindowHotkeyEnabled: (enabled: boolean) => void;
  setDefaultPreset: (preset: string) => void;
  setCaptureEngine: (engine: string) => void;
  setLlmConfig: (updates: Partial<LlmConfig>) => void;
  addLlmConfig: (config: Partial<LlmConfig>) => void;
  updateLlmConfig: (id: string, updates: Partial<LlmConfig>) => void;
  deleteLlmConfig: (id: string) => void;
  setActiveLlmConfig: (id: string) => void;
  setPresetDictToggle: (dict: keyof PresetDicts, enabled: boolean) => void;
  setOnlineEngineToggle: (engine: keyof OnlineEngines, enabled: boolean) => void;
  setAllOnlineEngines: (mode: 'all' | 'recommended' | 'none') => void;
  setTranslationTiers: (tiers: string[]) => void;
  moveTier: (fromIndex: number, toIndex: number) => void;
  setAppearance: (updates: Partial<AppearanceSettings>) => void;
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
  resetSettings: () => void;
  clearToast: () => void;
}

function checkIsDirty(current: AppSettings, initial: AppSettings): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
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
      const settingsWithAppearance: AppSettings = {
        ...fetched,
        spotlightHotkey: fetched.spotlightHotkey || 'Alt+Space',
        clipboardHotkey: fetched.clipboardHotkey || 'Ctrl+Shift+C',
        toggleWindowHotkey: fetched.toggleWindowHotkey || 'Alt+Q',
        appearance: fetched.appearance || DEFAULT_APPEARANCE,
        llmConfig: fetched.llmConfig || fetchedPool[0] || null,
        llmConfigs: fetchedPool,
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
    const { settings } = get();
    set({ isSaving: true });
    try {
      await cmdSaveSettings(settings);
      set({
        initialSettings: settings,
        isDirty: false,
        isSaving: false,
        toastMessage: 'Settings saved successfully!',
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
      set({
        isSaving: false,
        toastMessage: 'Failed to save settings',
      });
    }
  },

  setHotkey: (hotkey: string) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, hotkey };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setSpotlightHotkey: (spotlightHotkey: string) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, spotlightHotkey };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setClipboardHotkey: (clipboardHotkey: string) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, clipboardHotkey };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setToggleWindowHotkey: (toggleWindowHotkey: string) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, toggleWindowHotkey };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setCaptureHotkeyEnabled: (enabled: boolean) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, captureHotkeyEnabled: enabled };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setSpotlightHotkeyEnabled: (enabled: boolean) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, spotlightHotkeyEnabled: enabled };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setClipboardHotkeyEnabled: (enabled: boolean) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, clipboardHotkeyEnabled: enabled };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

  setToggleWindowHotkeyEnabled: (enabled: boolean) => {
    const { settings, initialSettings, saveSettings } = get();
    const updated = { ...settings, toggleWindowHotkeyEnabled: enabled };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
    saveSettings();
  },

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

  setDefaultPreset: (preset: string) => {
    const { settings, initialSettings } = get();
    const updated = { ...settings, defaultPreset: preset };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  setCaptureEngine: (engine: string) => {
    const { settings, initialSettings } = get();
    const updated = { ...settings, captureEngine: engine };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

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
  },

  setAllOnlineEngines: (mode: 'all' | 'recommended' | 'none') => {
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
        tencent: true,
      };
    } else if (mode === 'recommended') {
      updatedOnline = {
        google: true,
        bing: true,
        youdao: true,
        deepl: false,
        myMemory: false,
        baidu: false,
        tencent: false,
      };
    } else {
      updatedOnline = {
        google: false,
        bing: false,
        youdao: false,
        deepl: false,
        myMemory: false,
        baidu: false,
        tencent: false,
      };
    }
    const updated = { ...settings, onlineEngines: updatedOnline };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

  setTranslationTiers: (tiers: string[]) => {
    const { settings, initialSettings } = get();
    const updated = { ...settings, translationTiers: tiers };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },

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
    const updated = { ...settings, appearance: updatedAppearance };
    set({
      settings: updated,
      isDirty: checkIsDirty(updated, initialSettings),
    });
  },
  setThemeMode: (theme: ThemeMode) => {
    if (theme === 'fluent-dark') {
      get().setAppearance({ theme: 'fluent-dark', enableBlur: true, blurAmount: 24, enableTransparency: true, windowOpacity: 85 });
    } else if (theme === 'dark') {
      get().setAppearance({ theme: 'dark', enableBlur: false, blurAmount: 0, enableTransparency: false, windowOpacity: 100 });
    } else if (theme === 'light') {
      get().setAppearance({ theme: 'light', enableBlur: false, blurAmount: 0, enableTransparency: false, windowOpacity: 100 });
    } else {
      get().setAppearance({ theme: 'system' });
    }
  },
  setEnableBlur: (enableBlur: boolean) => get().setAppearance({ enableBlur }),
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

  clearToast: () => {
    set({ toastMessage: null });
  },
}));

