import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  defaultAiProviders,
  flattenAiProvidersToLlmConfigs,
  migrateLlmConfigsToAiProviders,
} from '../services/defaultSettings';
import { useSettingsStore } from '../stores/useSettingsStore';
import { LlmProviderConfigCard } from '../components/Settings/panels/LlmProviderConfigCard';
import type { AiProviderConfig, LlmConfig } from '../services/types';

describe('AI Provider (1) ➔ Models (N) Architecture Test Suite', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        aiProviders: JSON.parse(JSON.stringify(defaultAiProviders)),
        llmConfigs: flattenAiProvidersToLlmConfigs(defaultAiProviders),
      },
      isDirty: false,
    });
  });

  describe('defaultAiProviders definition & structure', () => {
    it('contains major providers each with multiple models and shared credentials', () => {
      expect(defaultAiProviders.length).toBeGreaterThanOrEqual(7);

      const deepseek = defaultAiProviders.find((p) => p.providerType === 'DeepSeek' || p.name.includes('DeepSeek'));
      expect(deepseek).toBeDefined();
      expect(deepseek?.endpoint).toBe('https://api.deepseek.com/v1');
      expect(deepseek?.models.length).toBeGreaterThanOrEqual(2);
      expect(deepseek?.models.some((m) => m.modelId === 'deepseek-chat')).toBe(true);
      expect(deepseek?.models.some((m) => m.modelId === 'deepseek-reasoner')).toBe(true);

      const silicon = defaultAiProviders.find((p) => p.id === 'provider-siliconflow');
      expect(silicon).toBeDefined();
      expect(silicon?.models.length).toBeGreaterThanOrEqual(3);
      expect(silicon?.models.some((m) => m.modelId === 'deepseek-ai/DeepSeek-V3')).toBe(true);

      const qianfan = defaultAiProviders.find((p) => p.name === '百度文心千帆');
      expect(qianfan).toBeDefined();
      expect(qianfan?.endpoint).toBe('https://qianfan.baidubce.com/v2');
      expect(qianfan?.models.some((m) => m.modelId === 'ernie-speed-128k')).toBe(true);
    });
  });

  describe('flattenAiProvidersToLlmConfigs helper', () => {
    it('flattens providers into LlmConfig array with shared apiKey and endpoint for each model', () => {
      const sampleProviders: AiProviderConfig[] = [
        {
          id: 'test-provider',
          name: '测试供应商',
          providerType: 'Custom',
          endpoint: 'https://api.custom.com/v1',
          apiKey: 'sk-shared-key-12345',
          enabled: true,
          models: [
            { id: 'm1', modelId: 'model-a', displayName: '模型 A', enabled: true },
            { id: 'm2', modelId: 'model-b', displayName: '模型 B', enabled: false },
          ],
        },
      ];

      const flat = flattenAiProvidersToLlmConfigs(sampleProviders);
      expect(flat).toHaveLength(2);

      expect(flat[0].id).toBe('m1');
      expect(flat[0].provider).toBe('测试供应商');
      expect(flat[0].name).toBe('模型 A');
      expect(flat[0].model).toBe('model-a');
      expect(flat[0].apiKey).toBe('sk-shared-key-12345');
      expect(flat[0].endpoint).toBe('https://api.custom.com/v1');
      expect(flat[0].enabled).toBe(true);

      expect(flat[1].id).toBe('m2');
      expect(flat[1].model).toBe('model-b');
      expect(flat[1].apiKey).toBe('sk-shared-key-12345');
      expect(flat[1].enabled).toBe(false);
    });

    it('disables all derived models when parent provider is disabled', () => {
      const sampleProviders: AiProviderConfig[] = [
        {
          id: 'disabled-provider',
          name: '停用的供应商',
          providerType: 'Custom',
          endpoint: 'https://api.custom.com/v1',
          apiKey: 'key',
          enabled: false,
          models: [
            { id: 'm1', modelId: 'model-a', enabled: true },
          ],
        },
      ];

      const flat = flattenAiProvidersToLlmConfigs(sampleProviders);
      expect(flat[0].enabled).toBe(false);
    });
  });

  describe('migrateLlmConfigsToAiProviders helper', () => {
    it('migrates legacy flat LlmConfigs into structured AiProviderConfig with zero credential loss', () => {
      const legacyConfigs: LlmConfig[] = [
        {
          id: 'old-deepseek',
          provider: 'DeepSeek',
          apiKey: 'my-secret-deepseek-key',
          endpoint: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          enabled: true,
        },
        {
          id: 'old-custom',
          provider: 'MyCustomProvider',
          apiKey: 'custom-key-777',
          endpoint: 'https://my-custom.ai/v1',
          model: 'custom-large-v1',
          name: '自定义超大模型',
          enabled: true,
        },
      ];

      const migrated = migrateLlmConfigsToAiProviders(legacyConfigs);
      const deepseek = migrated.find((p) => p.name === 'DeepSeek');
      expect(deepseek).toBeDefined();
      expect(deepseek?.apiKey).toBe('my-secret-deepseek-key');

      const custom = migrated.find((p) => p.name === 'MyCustomProvider');
      expect(custom).toBeDefined();
      expect(custom?.apiKey).toBe('custom-key-777');
      expect(custom?.endpoint).toBe('https://my-custom.ai/v1');
      expect(custom?.models.some((m) => m.modelId === 'custom-large-v1')).toBe(true);
    });
  });

  describe('useSettingsStore Provider & Multi-Model Actions', () => {
    it('updateAiProvider updates credentials and immediately synchronizes to llmConfigs', () => {
      const store = useSettingsStore.getState();
      store.updateAiProvider('provider-deepseek', {
        apiKey: 'sk-new-deepseek-key',
        endpoint: 'https://custom-deepseek-proxy.com/v1',
      });

      const updatedSettings = useSettingsStore.getState().settings;
      const deepseekProvider = updatedSettings.aiProviders?.find((p) => p.id === 'provider-deepseek');
      expect(deepseekProvider?.apiKey).toBe('sk-new-deepseek-key');
      expect(deepseekProvider?.endpoint).toBe('https://custom-deepseek-proxy.com/v1');

      // Check that all models under DeepSeek now share this updated key and endpoint
      const deepseekModels = updatedSettings.llmConfigs?.filter((c) => c.provider === 'DeepSeek');
      expect(deepseekModels && deepseekModels.length > 0).toBe(true);
      for (const m of deepseekModels!) {
        expect(m.apiKey).toBe('sk-new-deepseek-key');
        expect(m.endpoint).toBe('https://custom-deepseek-proxy.com/v1');
      }
    });

    it('addModelToProvider appends a model to the provider and flattens into llmConfigs', () => {
      const store = useSettingsStore.getState();
      store.addModelToProvider('provider-deepseek', {
        modelId: 'deepseek-coder-33b',
        displayName: 'DeepSeek 代码大模型',
        enabled: true,
      });

      const updatedSettings = useSettingsStore.getState().settings;
      const deepseek = updatedSettings.aiProviders?.find((p) => p.id === 'provider-deepseek');
      expect(deepseek?.models.some((m) => m.modelId === 'deepseek-coder-33b')).toBe(true);

      const inFlatPool = updatedSettings.llmConfigs?.find((c) => c.model === 'deepseek-coder-33b');
      expect(inFlatPool).toBeDefined();
      expect(inFlatPool?.name).toBe('DeepSeek 代码大模型');
      expect(inFlatPool?.provider).toBe('DeepSeek');
    });

    it('removeModelFromProvider removes the model from provider and pool', () => {
      const store = useSettingsStore.getState();
      store.removeModelFromProvider('provider-deepseek', 'deepseek-reasoner');

      const updatedSettings = useSettingsStore.getState().settings;
      const deepseek = updatedSettings.aiProviders?.find((p) => p.id === 'provider-deepseek');
      expect(deepseek?.models.some((m) => m.modelId === 'deepseek-reasoner')).toBe(false);

      const inFlatPool = updatedSettings.llmConfigs?.find((c) => c.model === 'deepseek-reasoner');
      expect(inFlatPool).toBeUndefined();
    });

    it('toggleModelEnabled flips enabled status on model without deleting it', () => {
      const store = useSettingsStore.getState();
      const initialModel = useSettingsStore
        .getState()
        .settings.aiProviders?.find((p) => p.id === 'provider-deepseek')
        ?.models.find((m) => m.modelId === 'deepseek-chat');
      const initialStatus = initialModel?.enabled;

      store.toggleModelEnabled('provider-deepseek', 'deepseek-chat');

      const updatedModel = useSettingsStore
        .getState()
        .settings.aiProviders?.find((p) => p.id === 'provider-deepseek')
        ?.models.find((m) => m.modelId === 'deepseek-chat');
      expect(updatedModel?.enabled).toBe(!initialStatus);
    });

    it('addAiProvider creates a new provider and makes it selectable', () => {
      const store = useSettingsStore.getState();
      store.addAiProvider({
        id: 'provider-test-gateway',
        name: '本地测试网关',
        endpoint: 'http://localhost:8080/v1',
        apiKey: 'dummy-key',
        models: [{ id: 'gw-1', modelId: 'gw-chat', displayName: '网关对话', enabled: true }],
      });

      const updatedSettings = useSettingsStore.getState().settings;
      const gw = updatedSettings.aiProviders?.find((p) => p.id === 'provider-test-gateway');
      expect(gw).toBeDefined();
      expect(gw?.name).toBe('本地测试网关');

      const inFlatPool = updatedSettings.llmConfigs?.find((c) => c.model === 'gw-chat');
      expect(inFlatPool).toBeDefined();
      expect(inFlatPool?.endpoint).toBe('http://localhost:8080/v1');
    });
  });

  describe('LlmProviderConfigCard UI Integration', () => {
    it('renders provider tabs and switching providers changes the active form', () => {
      render(<LlmProviderConfigCard isLight={true} />);

      // Verify Provider tabs exist
      expect(screen.getAllByText(/DeepSeek/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText('SiliconFlow (硅基流动)')[0]).toBeInTheDocument();
      expect(screen.getAllByText('百度文心千帆')[0]).toBeInTheDocument();

      // DeepSeek is default active
      expect(screen.getByText(/DeepSeek.*基础配置/)).toBeInTheDocument();
      expect(screen.getByDisplayValue('https://api.deepseek.com/v1')).toBeInTheDocument();

      // Click on 百度文心千帆 tab (button)
      const qianfanBtn = screen.getAllByRole('button', { name: /百度文心千帆/i })[0];
      fireEvent.click(qianfanBtn);

      // Active form switches to 百度文心千帆
      expect(screen.getByText('百度文心千帆 基础配置')).toBeInTheDocument();
      expect(screen.getByDisplayValue('https://qianfan.baidubce.com/v2')).toBeInTheDocument();
    });

    it('allows adding a custom model to the active provider through the UI', () => {
      render(<LlmProviderConfigCard isLight={true} />);

      const modelIdInput = screen.getByPlaceholderText(/输入 Model ID/i);
      const displayNameInput = screen.getByPlaceholderText(/显示别名/i);
      const submitBtn = screen.getByRole('button', { name: /添加模型到供应商/i });

      fireEvent.change(modelIdInput, { target: { value: 'deepseek-coder-v2' } });
      fireEvent.change(displayNameInput, { target: { value: '代码专用版' } });
      fireEvent.click(submitBtn);

      // Verify new model badge appears in the UI
      expect(screen.getByText('代码专用版')).toBeInTheDocument();
      expect(screen.getByText('deepseek-coder-v2')).toBeInTheDocument();
    });
  });
});
