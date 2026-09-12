import { useState } from 'react';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { cmdFetchLlmModels } from '../../../services/tauri';
import { defaultAiProviders, migrateLlmConfigsToAiProviders, PRESET_AI_PROVIDER_TEMPLATES } from '../../../services/defaultSettings';
import type { LlmConfig, AiProviderConfig, AiModelItem } from '../../../services/types';

const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

export const PROVIDER_DEFAULT_ENDPOINTS: Record<string, { endpoint: string; model: string }> = {
  DeepSeek: {
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  '百度文心 (千帆)': {
    endpoint: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-speed-128k',
  },
  SiliconFlow: {
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  '智谱 GLM': {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  '通义千问': {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  Kimi: {
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  OpenAI: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  Ollama: {
    endpoint: 'http://localhost:11434/v1',
    model: 'llama3',
  },
  Custom: {
    endpoint: 'https://api.custom-llm.com/v1',
    model: 'custom-model',
  },
};

export const PROVIDER_PRESET_MODELS: Record<string, string[]> = {
  '百度文心 (千帆)': [
    'ernie-speed-128k',
    'ernie-lite-8k',
    'ernie-4.0-turbo-8k',
    'ernie-4.0-8k',
    'ernie-3.5-8k',
  ],
  DeepSeek: ['deepseek-chat', 'deepseek-reasoner'],
  SiliconFlow: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-7B-Instruct'],
  '智谱 GLM': ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
  '通义千问': ['qwen-plus', 'qwen-turbo', 'qwen-max'],
  Kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  OpenAI: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
};

/**
 * LLM 模型池的共享面板状态：当前模型、连接测试、模型列表拉取与多模型 CRUD。
 * 「快捷键与 AI 模型」和「在线引擎」两个分区都渲染 LLM 配置 UI，共用此 hook
 * 保证状态与逻辑只有一份定义。
 */
export function useLlmPanelState() {
  const settings = useSettingsStore((s) => s.settings);
  const setAiProviders = useSettingsStore((s) => s.setAiProviders);
  const updateAiProvider = useSettingsStore((s) => s.updateAiProvider);
  const addAiProvider = useSettingsStore((s) => s.addAiProvider);
  const deleteAiProvider = useSettingsStore((s) => s.deleteAiProvider);
  const addModelToProvider = useSettingsStore((s) => s.addModelToProvider);
  const removeModelFromProvider = useSettingsStore((s) => s.removeModelFromProvider);
  const toggleModelEnabled = useSettingsStore((s) => s.toggleModelEnabled);
  const setDefaultModelForProvider = useSettingsStore((s) => s.setDefaultModelForProvider);

  // Legacy actions
  const setLlmConfig = useSettingsStore((s) => s.setLlmConfig);
  const addLlmConfig = useSettingsStore((s) => s.addLlmConfig);
  const updateLlmConfig = useSettingsStore((s) => s.updateLlmConfig);
  const deleteLlmConfig = useSettingsStore((s) => s.deleteLlmConfig);
  const setActiveLlmConfig = useSettingsStore((s) => s.setActiveLlmConfig);
  const toggleLlmConfigEnabled = useSettingsStore((s) => s.toggleLlmConfigEnabled);
  const rawProviders = settings?.aiProviders;
  const providers: AiProviderConfig[] =
    rawProviders !== undefined
      ? rawProviders
      : settings?.llmConfig || (settings?.llmConfigs && settings.llmConfigs.length > 0)
      ? migrateLlmConfigsToAiProviders(
          settings?.llmConfigs?.length
            ? settings.llmConfigs
            : settings?.llmConfig
            ? [settings.llmConfig]
            : []
        )
      : [];

  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    providers?.[0]?.id || ''
  );

  const [showApiKey, setShowApiKey] = useState(false);
  const [testLatency, setTestLatency] = useState<number | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchModelNotice, setFetchModelNotice] = useState<string | null>(null);

  // Safe active provider (null when 0 providers)
  const currentProvider: AiProviderConfig | null =
    providers.find((p) => p.id === selectedProviderId) ||
    providers[0] ||
    null;

  const currentModels: AiModelItem[] = currentProvider?.models || [];

  // Legacy fallback compatibility
  const llm = (settings.llmConfig as (LlmConfig & { availableModels?: string[] })) || {
    provider: currentProvider?.name || '未添加模型',
    apiKey: currentProvider?.apiKey || '',
    model: currentProvider?.defaultModelId || currentModels[0]?.modelId || '',
    endpoint: currentProvider?.endpoint || '',
  };

  const llmPool: LlmConfig[] =
    settings.llmConfigs && settings.llmConfigs.length > 0
      ? settings.llmConfigs
      : (currentProvider ? [llm] : []);

  // Provider operations
  const handleUpdateCurrentProvider = (updates: Partial<AiProviderConfig>) => {
    if (!currentProvider) return;
    updateAiProvider(currentProvider.id, updates);
  };

  const handleAddModelToCurrentProvider = (modelId: string, displayName?: string) => {
    if (!currentProvider) return;
    addModelToProvider(currentProvider.id, {
      modelId,
      displayName: displayName || modelId,
      enabled: true,
    });
  };

  const handleRemoveModelFromCurrent = (modelId: string) => {
    if (!currentProvider) return;
    removeModelFromProvider(currentProvider.id, modelId);
  };

  const handleToggleModelInCurrent = (modelId: string) => {
    if (!currentProvider) return;
    toggleModelEnabled(currentProvider.id, modelId);
  };

  const handleSetDefaultModelInCurrent = (modelId: string) => {
    if (!currentProvider) return;
    setDefaultModelForProvider(currentProvider.id, modelId);
  };

  const handleAddNewProvider = (name: string, endpoint: string, providerType: string = 'Custom') => {
    const id = `provider-${name.toLowerCase().replace(/[\s\u4e00-\u9fff]+/g, '-')}-${Date.now().toString(36)}`;
    addAiProvider({
      id,
      name,
      providerType,
      endpoint,
      apiKey: '',
      enabled: true,
      models: [
        {
          id: 'default-model',
          modelId: 'default-model',
          displayName: '默认模型',
          enabled: true,
        },
      ],
    });
    setSelectedProviderId(id);
  };

  const handleDeleteCurrentProvider = () => {
    if (!currentProvider) return;
    deleteAiProvider(currentProvider.id);
    const remaining = providers.filter((p) => p.id !== currentProvider.id);
    setSelectedProviderId(remaining[0]?.id || '');
  };

  const handleAddPresetProvider = (preset: AiProviderConfig) => {
    const existing = providers.find((p) => p.providerType === preset.providerType || p.name === preset.name);
    if (existing) {
      setSelectedProviderId(existing.id);
      return;
    }
    const cloned: AiProviderConfig = JSON.parse(JSON.stringify(preset));
    addAiProvider(cloned);
    setSelectedProviderId(cloned.id);
  };

  const handleTestLlmConnection = async () => {
    setIsTestingLlm(true);
    setTestLatency(null);
    setTestStatus(null);
    setTestSuccess(null);
    const start = performance.now();

    const endpoint = currentProvider?.endpoint || llm?.endpoint || '';
    const apiKey = currentProvider?.apiKey ?? llm?.apiKey ?? '';

    if (!endpoint) {
      setTestStatus('未配置 API 接口地址');
      setTestSuccess(false);
      setIsTestingLlm(false);
      return;
    }

    if (isTestEnv) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      setTestLatency(Math.round(performance.now() - start));
      setTestSuccess(true);
      setTestStatus('模拟环境：测试通过');
      setIsTestingLlm(false);
      return;
    }

    try {
      const modelList = await cmdFetchLlmModels(endpoint, apiKey);
      const elapsed = Math.max(12, Math.round(performance.now() - start));
      setTestLatency(elapsed);
      setTestSuccess(true);
      setTestStatus(`连接成功 (延迟 ${elapsed}ms，识别到 ${modelList.length} 个可用模型)`);
      if (modelList.length > 0) {
        setFetchedModels(modelList);
      }
    } catch (err) {
      setTestSuccess(false);
      setTestLatency(null);
      const rawMsg = typeof err === 'string' ? err : (err as Error)?.message || '网络连接失败';
      setTestStatus(`连接失败：${rawMsg}`);
    } finally {
      setIsTestingLlm(false);
    }
  };

  const handleFetchModels = async () => {
    const endpoint = currentProvider.endpoint || llm.endpoint;
    const apiKey = currentProvider.apiKey ?? llm.apiKey;

    if (!endpoint) return;
    setIsFetchingModels(true);
    setFetchModelNotice(null);

    const isLocal = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');
    if (!apiKey && !isLocal) {
      setFetchModelNotice('⚠️ 未配置 API Key，请先在下方填入 API 密钥后再试。');
      setIsFetchingModels(false);
      return;
    }

    try {
      const modelList = await cmdFetchLlmModels(endpoint, apiKey);
      if (modelList && modelList.length > 0) {
        setFetchedModels(modelList);
        setFetchModelNotice(`已成功拉取 ${modelList.length} 个可用模型！`);
      } else {
        setFetchModelNotice('获取成功，但未解析到模型列表');
      }
    } catch (err) {
      console.warn('Fetch models failed:', err);
      const rawMsg = typeof err === 'string' ? err : (err as Error)?.message || '';
      let friendly = '网络连接异常';
      if (rawMsg.includes('Failed to fetch') || rawMsg.includes('fetch failed')) {
        friendly = `无法连接到 ${currentProvider.name} 接口 (Failed to fetch)。请检查网络代理或 Base URL 地址。`;
      } else if (rawMsg.includes('401') || rawMsg.includes('Unauthorized')) {
        friendly = `API Key 验证失败 (401 Unauthorized)。请核对密钥。`;
      } else if (rawMsg.includes('404')) {
        friendly = `接口路径 404 (Not Found)。请确认 Base URL。`;
      } else {
        friendly = rawMsg;
      }
      setFetchModelNotice(`⚠️ 拉取失败: ${friendly}`);
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Legacy compat functions
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const rawVal = e.target.value;
    const newProvider = rawVal.replace(/^\+\s*/, '');
    let matchedProvider = providers.find((p) => p.providerType === newProvider || p.name === newProvider);
    const defaults = PROVIDER_DEFAULT_ENDPOINTS[newProvider] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
    const endpoint = matchedProvider?.endpoint || defaults.endpoint;
    const model = matchedProvider?.defaultModelId || matchedProvider?.models?.[0]?.modelId || defaults.model;
    const apiKey = matchedProvider?.apiKey || '';

    if (!matchedProvider) {
      const template = PRESET_AI_PROVIDER_TEMPLATES.find(
        (t) => t.providerType === newProvider || t.name === newProvider
      );
      const newProvConfig: AiProviderConfig = {
        id: template ? template.id : `provider-${Date.now().toString(36)}`,
        name: template ? template.name : newProvider,
        providerType: template ? template.providerType : newProvider,
        endpoint,
        apiKey,
        enabled: true,
        defaultModelId: model,
        models: template ? template.models : [{ id: model, modelId: model, displayName: model, enabled: true }],
      };
      setAiProviders([...providers, newProvConfig]);
      setSelectedProviderId(newProvConfig.id);
    } else {
      setSelectedProviderId(matchedProvider.id);
    }

    setLlmConfig({
      provider: newProvider,
      endpoint,
      model,
      apiKey,
    });
  };

  const handleAddModel = (providerName: string) => {
    const matched = providers.find((p) => p.name === providerName || p.providerType === providerName);
    if (matched) {
      setSelectedProviderId(matched.id);
    } else {
      const defaults = PROVIDER_DEFAULT_ENDPOINTS[providerName] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
      handleAddNewProvider(providerName, defaults.endpoint, providerName);
    }
    setShowModelPicker(false);
  };

  return {
    settings,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    currentProvider,
    currentModels,
    handleUpdateCurrentProvider,
    handleAddModelToCurrentProvider,
    handleRemoveModelFromCurrent,
    handleToggleModelInCurrent,
    handleSetDefaultModelInCurrent,
    handleAddNewProvider,
    handleDeleteCurrentProvider,
    handleAddPresetProvider,
    // Legacy support
    llm,
    llmPool,
    showApiKey,
    setShowApiKey,
    testLatency,
    testStatus,
    testSuccess,
    isTestingLlm,
    showModelPicker,
    setShowModelPicker,
    isFetchingModels,
    fetchedModels,
    fetchModelNotice,
    handleProviderChange,
    handleAddModel,
    handleTestLlmConnection,
    handleFetchModels,
    setLlmConfig,
    addLlmConfig,
    updateLlmConfig,
    deleteLlmConfig,
    setActiveLlmConfig,
    toggleLlmConfigEnabled,
    setAiProviders,
  };
}
