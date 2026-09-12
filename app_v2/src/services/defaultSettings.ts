import type { AppSettings, AppearanceSettings, AiProviderConfig, LlmConfig } from './types';

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

/** 默认预设的 AI 供应商列表（每个供应商支持挂载多个模型） */
export const defaultAiProviders: AiProviderConfig[] = [
  {
    id: 'provider-deepseek',
    name: 'DeepSeek',
    providerType: 'DeepSeek',
    apiKey: '',
    endpoint: 'https://api.deepseek.com/v1',
    enabled: true,
    defaultModelId: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', modelId: 'deepseek-chat', displayName: 'DeepSeek V3 (通用快译)', enabled: true },
      { id: 'deepseek-reasoner', modelId: 'deepseek-reasoner', displayName: 'DeepSeek R1 (深度思考)', enabled: true },
    ],
  },
  {
    id: 'provider-siliconflow',
    name: 'SiliconFlow (硅基流动)',
    providerType: 'SiliconFlow',
    apiKey: '',
    endpoint: 'https://api.siliconflow.cn/v1',
    enabled: true,
    defaultModelId: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3 (硅基高速)', enabled: true },
      { id: 'deepseek-ai/DeepSeek-R1', modelId: 'deepseek-ai/DeepSeek-R1', displayName: 'DeepSeek R1 (深度思考)', enabled: false },
      { id: 'Qwen/Qwen2.5-7B-Instruct', modelId: 'Qwen/Qwen2.5-7B-Instruct', displayName: 'Qwen 2.5 7B (极速)', enabled: false },
    ],
  },
  {
    id: 'provider-baidu-qianfan',
    name: '百度文心千帆',
    providerType: '百度文心 (千帆)',
    apiKey: '',
    endpoint: 'https://qianfan.baidubce.com/v2',
    enabled: true,
    defaultModelId: 'ernie-speed-128k',
    models: [
      { id: 'ernie-speed-128k', modelId: 'ernie-speed-128k', displayName: 'ERNIE Speed 128K (免费高并发)', enabled: true },
      { id: 'ernie-lite-8k', modelId: 'ernie-lite-8k', displayName: 'ERNIE Lite 8K', enabled: false },
      { id: 'ernie-4.0-turbo-8k', modelId: 'ernie-4.0-turbo-8k', displayName: 'ERNIE 4.0 Turbo', enabled: false },
    ],
  },
  {
    id: 'provider-zhipu',
    name: '智谱 GLM',
    providerType: '智谱 GLM',
    apiKey: '',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    enabled: true,
    defaultModelId: 'glm-4-flash',
    models: [
      { id: 'glm-4-flash', modelId: 'glm-4-flash', displayName: 'GLM-4-Flash (免费秒级)', enabled: true },
      { id: 'glm-4-plus', modelId: 'glm-4-plus', displayName: 'GLM-4-Plus (旗舰旗舰)', enabled: false },
      { id: 'glm-4-air', modelId: 'glm-4-air', displayName: 'GLM-4-Air', enabled: false },
    ],
  },
  {
    id: 'provider-qwen',
    name: '通义千问',
    providerType: '通义千问',
    apiKey: '',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    enabled: true,
    defaultModelId: 'qwen-plus',
    models: [
      { id: 'qwen-plus', modelId: 'qwen-plus', displayName: 'Qwen Plus', enabled: true },
      { id: 'qwen-turbo', modelId: 'qwen-turbo', displayName: 'Qwen Turbo (极速)', enabled: false },
      { id: 'qwen-max', modelId: 'qwen-max', displayName: 'Qwen Max', enabled: false },
    ],
  },
  {
    id: 'provider-kimi',
    name: 'Moonshot Kimi',
    providerType: 'Kimi',
    apiKey: '',
    endpoint: 'https://api.moonshot.cn/v1',
    enabled: true,
    defaultModelId: 'moonshot-v1-8k',
    models: [
      { id: 'moonshot-v1-8k', modelId: 'moonshot-v1-8k', displayName: 'Moonshot v1 8K', enabled: true },
      { id: 'moonshot-v1-32k', modelId: 'moonshot-v1-32k', displayName: 'Moonshot v1 32K', enabled: false },
    ],
  },
  {
    id: 'provider-openai',
    name: 'OpenAI',
    providerType: 'OpenAI',
    apiKey: '',
    endpoint: 'https://api.openai.com/v1',
    enabled: true,
    defaultModelId: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini', enabled: true },
      { id: 'gpt-4o', modelId: 'gpt-4o', displayName: 'GPT-4o (全能旗舰)', enabled: false },
    ],
  },
  {
    id: 'provider-ollama',
    name: 'Ollama (本地私有化)',
    providerType: 'Ollama',
    apiKey: '',
    endpoint: 'http://localhost:11434/v1',
    enabled: true,
    defaultModelId: 'llama3',
    models: [
      { id: 'llama3', modelId: 'llama3', displayName: 'Llama 3 8B', enabled: true },
      { id: 'qwen2.5:7b', modelId: 'qwen2.5:7b', displayName: 'Qwen 2.5 7B', enabled: false },
    ],
  },
];

/** 将结构化的 AiProviderConfig 转换为平铺的 LlmConfig 列表（供后端或现有组件平滑调用） */
export function flattenAiProvidersToLlmConfigs(providers: AiProviderConfig[]): LlmConfig[] {
  const list: LlmConfig[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      list.push({
        id: m.id || `${p.id}__${m.modelId}`,
        name: m.displayName || m.modelId,
        provider: p.providerType && p.providerType !== 'Custom' ? p.providerType : (p.name || p.providerType),
        apiKey: p.apiKey,
        model: m.modelId,
        endpoint: p.endpoint,
        enabled: p.enabled && m.enabled,
      });
    }
  }
  return list;
}

/** 将平铺的 LlmConfig 列表聚合升维为结构化的 AiProviderConfig 列表（保证旧版本历史配置零丢失） */
export function migrateLlmConfigsToAiProviders(
  llmConfigs?: LlmConfig[] | null,
  existingProviders?: AiProviderConfig[]
): AiProviderConfig[] {
  if (existingProviders && existingProviders.length > 0) {
    return JSON.parse(JSON.stringify(existingProviders));
  }

  if (!llmConfigs || llmConfigs.length === 0) {
    return JSON.parse(JSON.stringify(defaultAiProviders));
  }

  const baseProviders: AiProviderConfig[] = [];

  for (const cfg of llmConfigs) {
    if (!cfg.provider) continue;
    let p = baseProviders.find(
      (bp) =>
        bp.providerType.toLowerCase() === cfg.provider.toLowerCase() ||
        bp.name.toLowerCase() === cfg.provider.toLowerCase()
    );

    if (!p) {
      const defaultPreset = defaultAiProviders.find(
        (dp) =>
          dp.providerType.toLowerCase() === cfg.provider.toLowerCase() ||
          dp.name.toLowerCase() === cfg.provider.toLowerCase()
      );
      p = {
        id: defaultPreset ? defaultPreset.id : `provider-${cfg.provider.toLowerCase().replace(/[\s\u4e00-\u9fff]+/g, '-')}-${Date.now().toString(36)}`,
        name: defaultPreset ? defaultPreset.name : cfg.provider,
        providerType: defaultPreset ? defaultPreset.providerType : cfg.provider,
        endpoint: cfg.endpoint || defaultPreset?.endpoint || '',
        apiKey: cfg.apiKey || '',
        enabled: cfg.enabled ?? true,
        defaultModelId: cfg.model || '',
        models: [],
      };
      baseProviders.push(p);
    } else {
      if (cfg.apiKey && !p.apiKey) p.apiKey = cfg.apiKey;
      if (cfg.endpoint && (!p.endpoint || p.endpoint.includes('custom-llm'))) p.endpoint = cfg.endpoint;
    }

    if (cfg.model) {
      const existingModel = p.models.find((m) => m.id === cfg.id || m.modelId === cfg.model);
      if (!existingModel) {
        p.models.push({
          id: cfg.id || cfg.model,
          modelId: cfg.model,
          displayName: cfg.name || cfg.model,
          enabled: cfg.enabled ?? true,
        });
      }
    }
  }

  return baseProviders;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  hotkey: 'F4',
  spotlightHotkey: 'Alt+Space',
  clipboardHotkey: 'Ctrl+Shift+C',
  toggleWindowHotkey: 'Alt+W',
  quickWindowHotkey: 'Alt+W',
  captureHotkeyEnabled: true,
  spotlightHotkeyEnabled: false,
  clipboardHotkeyEnabled: false,
  toggleWindowHotkeyEnabled: false,
  quickWindowHotkeyEnabled: false,
  defaultPreset: 'blender',
  captureEngine: 'auto',
  aiProviders: defaultAiProviders,
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
      id: 'llm-siliconflow-deepseek-v3',
      provider: 'SiliconFlow',
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-V3',
      endpoint: 'https://api.siliconflow.cn/v1',
    },
    {
      id: 'llm-tongyi-qwen-plus',
      provider: '通义千问',
      apiKey: '',
      model: 'qwen-plus',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    {
      id: 'llm-kimi-moonshot-v1-8k',
      provider: 'Kimi',
      apiKey: '',
      model: 'moonshot-v1-8k',
      endpoint: 'https://api.moonshot.cn/v1',
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
    baiduLlm: false,
    tencent: false,
    lingva: false,
    caiyun: false,
    urban: false,
    volcengine: false,
    yandex: false,
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
  enableLlmProgressiveRefine: true,
  autoFavoriteQualityTerms: false,
  ankiSettings: {
    enabled: true,
    endpoint: 'http://127.0.0.1:8765',
    deckName: 'Catwalk',
    modelName: 'Basic',
    autoSyncOnStar: false,
    tags: ['Catwalk'],
  },
  autoCheckUpdate: true,
  autoSilentUpdate: false,
};
