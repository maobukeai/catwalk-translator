import { useState } from 'react';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { cmdFetchLlmModels } from '../../../services/tauri';
import type { LlmConfig } from '../../../services/types';

const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

export const PROVIDER_DEFAULT_ENDPOINTS: Record<string, { endpoint: string; model: string }> = {
  DeepSeek: {
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
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

/**
 * LLM 模型池的共享面板状态：当前模型、连接测试、模型列表拉取与多模型 CRUD。
 * 「快捷键与 AI 模型」和「在线引擎」两个分区都渲染 LLM 配置 UI，共用此 hook
 * 保证状态与逻辑只有一份定义。
 */
export function useLlmPanelState() {
  const settings = useSettingsStore((s) => s.settings);
  const setLlmConfig = useSettingsStore((s) => s.setLlmConfig);
  const addLlmConfig = useSettingsStore((s) => s.addLlmConfig);
  const updateLlmConfig = useSettingsStore((s) => s.updateLlmConfig);
  const deleteLlmConfig = useSettingsStore((s) => s.deleteLlmConfig);
  const setActiveLlmConfig = useSettingsStore((s) => s.setActiveLlmConfig);

  const [showApiKey, setShowApiKey] = useState(false);
  const [testLatency, setTestLatency] = useState<number | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const llm = (settings.llmConfig as (LlmConfig & { availableModels?: string[] })) || {
    provider: 'DeepSeek',
    apiKey: '',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  };

  const llmPool: LlmConfig[] =
    settings.llmConfigs && settings.llmConfigs.length > 0
      ? settings.llmConfigs
      : llm
        ? [llm]
        : [];

  const [fetchedModels, setFetchedModels] = useState<string[]>(llm.availableModels || []);
  const [fetchModelNotice, setFetchModelNotice] = useState<string | null>(null);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    const defaults = PROVIDER_DEFAULT_ENDPOINTS[newProvider] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
    setLlmConfig({
      provider: newProvider,
      endpoint: defaults.endpoint,
      model: defaults.model,
    });
  };

  const handleAddModel = (provider: string) => {
    const defaults = PROVIDER_DEFAULT_ENDPOINTS[provider] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
    addLlmConfig({
      provider,
      model: defaults.model,
      endpoint: defaults.endpoint,
    });
    setShowModelPicker(false);
  };

  const handleTestLlmConnection = async () => {
    setIsTestingLlm(true);
    setTestLatency(null);
    setTestStatus(null);
    setTestSuccess(null);
    const start = performance.now();

    if (!llm.endpoint) {
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
      const modelList = await cmdFetchLlmModels(llm.endpoint, llm.apiKey);
      const elapsed = Math.max(12, Math.round(performance.now() - start));
      setTestLatency(elapsed);
      setTestSuccess(true);
      setTestStatus(`连接成功 (延迟 ${elapsed}ms，识别到 ${modelList.length} 个可用模型)`);
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
    if (!llm.endpoint) return;
    setIsFetchingModels(true);
    setFetchModelNotice(null);

    // Pre-flight check for API Key
    const isLocal = llm.endpoint.includes('localhost') || llm.endpoint.includes('127.0.0.1');
    if (!llm.apiKey && !isLocal) {
      setFetchModelNotice('⚠️ 未配置 API Key，请先在下方填入 API 密钥后再试。');
      setIsFetchingModels(false);
      return;
    }

    try {
      // Call native Rust HTTP client (bypasses browser CORS & supports custom gateway endpoints)
      const modelList = await cmdFetchLlmModels(llm.endpoint, llm.apiKey);

      if (modelList && modelList.length > 0) {
        setFetchedModels(modelList);
        setLlmConfig({ availableModels: modelList });
        if (!modelList.includes(llm.model)) {
          setLlmConfig({ model: modelList[0] });
        }
        setFetchModelNotice(`已成功拉取 ${modelList.length} 个可用模型！`);
      } else {
        setFetchModelNotice('获取成功，但未解析到模型列表');
      }
    } catch (err) {
      console.warn('Fetch models failed:', err);
      const rawMsg = typeof err === 'string' ? err : (err as Error)?.message || '';
      let friendly = '网络连接异常';
      if (rawMsg.includes('Failed to fetch') || rawMsg.includes('fetch failed')) {
        friendly = `无法连接到 ${llm.provider} 接口 (Failed to fetch)。请检查网络代理或 Base URL 地址。`;
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

  return {
    settings,
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
  };
}
