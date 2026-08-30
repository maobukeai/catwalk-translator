import type { AppSettings, AppearanceSettings } from './types';

/**
 * 应用默认设置的唯一来源（single source of truth）。
 * useSettingsStore（初始状态）与 services/tauri.ts（浏览器/测试环境的
 * mock 降级）共用此份，避免两处手抄漂移。
 */

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  enableBlur: true,
  blurAmount: 24,
  enableTransparency: true,
  windowOpacity: 85,
  fontFamily: 'system',
  fontSize: 'medium',
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  hotkey: 'F4',
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
  overlayViewMode: 'cover',
  enableAabbAvoidance: true,
  translationStyle: 'free',
  sidebarCollapsed: false,
  captureReleaseAction: 'auto',
  watchIntervalMs: 3000,
  clipboardWatchEnabled: false,
  ocrEngine: 'auto',
  // 默认档 v6Tiny：划词/小图实测最快且 100% 全对（7.3ms vs v4 14.3ms/张）
  ocrVersion: 'v6t' as 'v3' | 'v4' | 'v5' | 'v6' | 'v6t',
  closeAction: 'ask',
  miniWindowCloseAction: 'hide',
};
