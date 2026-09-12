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

/** 常用预设的 AI 供应商模板库（供用户在设置中一键添加使用，首次安装不内置挂载） */
export const PRESET_AI_PROVIDER_TEMPLATES: AiProviderConfig[] = [
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
    id: 'provider-gemini',
    name: 'Google Gemini',
    providerType: 'Google Gemini',
    apiKey: '',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    enabled: true,
    defaultModelId: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (极速智能)', enabled: true },
      { id: 'gemini-2.5-pro', modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (全能旗舰)', enabled: false },
      { id: 'gemini-1.5-flash', modelId: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', enabled: false },
    ],
  },
  {
    id: 'provider-ollama',
    name: 'Ollama (本地私有化)',
    providerType: 'Ollama',
    apiKey: '',
    endpoint: 'http://localhost:11434/v1',
    enabled: false,
    defaultModelId: 'llama3',
    models: [
      { id: 'llama3', modelId: 'llama3', displayName: 'Llama 3 8B', enabled: true },
      { id: 'qwen2.5:7b', modelId: 'qwen2.5:7b', displayName: 'Qwen 2.5 7B', enabled: false },
    ],
  },
];

/** 向后兼容别名：常用预设模板库 */
export const defaultAiProviders: AiProviderConfig[] = PRESET_AI_PROVIDER_TEMPLATES;

/**
 * 校验指定大模型配置是否真正处于就绪可用状态：
 * - 必须启用 (enabled !== false)
 * - 必须包含有效端点 (endpoint 非空)
 * - 本地私有化端点 (localhost / 127.0.0.1) 必须显式开启 (enabled === true) 且配置了模型
 * - 远程在线端点必须已填入非空的有效 API Key
 */
export function isConfiguredLlm(cfg?: LlmConfig | null): boolean {
  if (!cfg || cfg.enabled === false) return false;
  const ep = cfg.endpoint?.trim() || '';
  if (!ep) return false;
  const isLocal = ep.includes('localhost') || ep.includes('127.0.0.1');
  if (isLocal) {
    return cfg.enabled === true && !!cfg.model?.trim();
  }
  return !!cfg.apiKey?.trim();
}

/**
 * 智能解析大模型配置所属的真实厂商/供应商名称，彻底剔除 'Custom' 等生硬未分类字样。
 * 优先根据 Model ID 关键词识别（即使多个模型经由同一个反向代理/中转网关转发，也能精确区隔厂商），
 * 其次根据 Endpoint 域名/路径特征匹配，最后根据配置名称或友好备用名称兜底。
 */
export function resolveVendor(cfg?: Partial<LlmConfig> | null): string {
  if (!cfg) return '未配置';
  const provider = (cfg.provider || '').trim();
  const model = (cfg.model || '').trim().toLowerCase();
  const endpoint = (cfg.endpoint || '').trim().toLowerCase();
  const name = (cfg.name || '').trim();

  // 若原有 provider 已是具体的非 Custom 厂商，规范化输出
  if (provider && !/^(custom|自定义|other|其他)$/i.test(provider)) {
    if (provider === 'Kimi') return 'Moonshot Kimi';
    if (provider === 'SiliconFlow') return 'SiliconFlow (硅基流动)';
    if (provider === 'Ollama') return 'Ollama (本地私有化)';
    if (provider.includes('百度文心')) return '百度文心';
    return provider;
  }

  // 1. 优先按照具体模型 Model ID 特征识别厂商（即便使用同一中转 Gateway 也能精准识别各自厂商）
  if (/^gemini/i.test(model) || model.includes('gemini')) return 'Google Gemini';
  if (/^deepseek/i.test(model) || model.includes('deepseek')) return 'DeepSeek';
  if (/^(gpt|o1-|o3-|text-embedding|dall-e|chatgpt)/i.test(model)) return 'OpenAI';
  if (/^claude/i.test(model) || model.includes('claude')) return 'Anthropic (Claude)';
  if (/^(glm|chatglm)/i.test(model) || model.includes('glm')) return '智谱 GLM';
  if (/^qwen/i.test(model) || model.includes('qwen')) return '通义千问';
  if (/^(ernie|eb-)/i.test(model) || model.includes('ernie')) return '百度文心';
  if (/^(moonshot|kimi)/i.test(model) || model.includes('moonshot') || model.includes('kimi')) return 'Moonshot Kimi';
  if (/^doubao/i.test(model) || model.includes('doubao')) return '字节豆包';
  if (/^hunyuan/i.test(model) || model.includes('hunyuan')) return '腾讯混元';
  if (/^(mistral|codestral|mixtral)/i.test(model)) return 'Mistral AI';
  if (/^grok/i.test(model) || model.includes('grok')) return 'xAI (Grok)';
  if (/^llama/i.test(model) || model.includes('llama')) return 'Meta Llama';
  if (/^agnes/i.test(model) || model.includes('agnes')) return 'Agnes';
  if (/^baichuan/i.test(model) || model.includes('baichuan')) return '百川智能';
  if (/^yi-/i.test(model) || model.includes('01-ai')) return '零一万物';
  if (/^minicpm/i.test(model) || model.includes('minicpm')) return '面壁智能';
  if (/^spark/i.test(model) || model.includes('sparkdesk')) return '讯飞星火';

  // 2. 按照 Endpoint 域名与路径特征识别厂商
  if (endpoint.includes('generativelanguage.googleapis.com') || endpoint.includes('google-ai-studio') || endpoint.includes('gemini')) {
    return 'Google Gemini';
  }
  if (endpoint.includes('deepseek.com') || endpoint.includes('deepseek')) {
    return 'DeepSeek';
  }
  if (endpoint.includes('openai.com')) {
    return 'OpenAI';
  }
  if (endpoint.includes('anthropic.com')) {
    return 'Anthropic (Claude)';
  }
  if (endpoint.includes('bigmodel.cn') || endpoint.includes('zhipu')) {
    return '智谱 GLM';
  }
  if (endpoint.includes('dashscope') || endpoint.includes('aliyuncs')) {
    return '通义千问';
  }
  if (endpoint.includes('qianfan') || endpoint.includes('baidubce')) {
    return '百度文心';
  }
  if (endpoint.includes('moonshot.cn')) {
    return 'Moonshot Kimi';
  }
  if (endpoint.includes('volces.com') || endpoint.includes('volcengine')) {
    return '字节豆包';
  }
  if (endpoint.includes('tencent') || endpoint.includes('tencentcloud')) {
    return '腾讯混元';
  }
  if (endpoint.includes('siliconflow')) {
    return 'SiliconFlow (硅基流动)';
  }
  if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.includes('11434')) {
    return 'Ollama (本地私有化)';
  }
  if (endpoint.includes('cloudflare')) {
    return 'Cloudflare AI';
  }

  // 3. 用户若指定了有意义的自定义厂商别名
  if (name && !/^(custom|自定义|默认|未命名|model)$/i.test(name) && name !== cfg.model) {
    return name;
  }

  return '第三方厂商';
}

/**
 * 纯净解析模型显示名称，剔除生硬的前缀
 */
export function resolveModelLabel(cfg?: Partial<LlmConfig> | null): string {
  if (!cfg) return '未配置模型';
  const name = (cfg.name || '').trim();
  const model = (cfg.model || '').trim();
  if (name && !/^(custom|自定义|默认)$/i.test(name) && name !== model) {
    return name;
  }
  return model || '未配置模型';
}

/** 将结构化的 AiProviderConfig 转换为平铺的 LlmConfig 列表（供后端或现有组件平滑调用） */
export function flattenAiProvidersToLlmConfigs(providers: AiProviderConfig[]): LlmConfig[] {
  const list: LlmConfig[] = [];
  for (const p of providers) {
    const rawVendor = p.name && !/^(custom|自定义)$/i.test(p.name) ? p.name : (p.providerType && p.providerType !== 'Custom' ? p.providerType : '');
    for (const m of p.models) {
      const interimCfg: Partial<LlmConfig> = {
        provider: rawVendor,
        model: m.modelId,
        endpoint: p.endpoint,
        name: m.displayName,
      };
      const vendorName = rawVendor || resolveVendor(interimCfg);
      list.push({
        id: m.id || `${p.id}__${m.modelId}`,
        name: m.displayName || m.modelId,
        provider: vendorName,
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
  // 若已有供应商配置（包括用户主动清空为 0 个的空数组 []），直接保留，绝不强行塞入默认模型
  if (existingProviders !== undefined && existingProviders !== null) {
    return JSON.parse(JSON.stringify(existingProviders));
  }

  if (!llmConfigs || llmConfigs.length === 0) {
    return JSON.parse(JSON.stringify(defaultAiProviders));
  }

  const baseProviders: AiProviderConfig[] = [];

  for (const cfg of llmConfigs) {
    if (!cfg.provider && !cfg.model) continue;
    const vendorName = resolveVendor(cfg);
    let p = baseProviders.find(
      (bp) =>
        bp.providerType.toLowerCase() === vendorName.toLowerCase() ||
        bp.name.toLowerCase() === vendorName.toLowerCase() ||
        bp.providerType.toLowerCase() === (cfg.provider || '').toLowerCase() ||
        bp.name.toLowerCase() === (cfg.provider || '').toLowerCase()
    );

    if (!p) {
      const defaultPreset = PRESET_AI_PROVIDER_TEMPLATES.find(
        (dp) =>
          dp.providerType.toLowerCase() === vendorName.toLowerCase() ||
          dp.name.toLowerCase() === vendorName.toLowerCase()
      );
      const safeId = vendorName.toLowerCase().replace(/[\s\u4e00-\u9fff()（）]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'custom';
      p = {
        id: defaultPreset ? defaultPreset.id : `provider-${safeId}`,
        name: defaultPreset ? defaultPreset.name : vendorName,
        providerType: defaultPreset ? defaultPreset.providerType : vendorName,
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
          displayName: resolveModelLabel(cfg),
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
  aiProviders: [],
  llmConfig: null,
  llmConfigs: [],
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
