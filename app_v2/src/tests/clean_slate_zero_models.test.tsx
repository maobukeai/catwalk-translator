import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DEFAULT_SETTINGS,
  PRESET_AI_PROVIDER_TEMPLATES,
  migrateLlmConfigsToAiProviders,
} from '../services/defaultSettings';
import { useSettingsStore } from '../stores/useSettingsStore';
import { LlmProviderConfigCard } from '../components/Settings/panels/LlmProviderConfigCard';
import { AiChatPanel } from '../components/MainWindow/AiChatPanel';

describe('Clean Slate Zero-Model (首次下载零内置模型) Architecture & UI Test Suite', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiProviders: [],
        llmConfig: null,
        llmConfigs: [],
      },
      isDirty: false,
    });
  });

  describe('1. Clean Default Settings State', () => {
    it('DEFAULT_SETTINGS must contain exactly 0 AI providers and null llmConfig', () => {
      expect(DEFAULT_SETTINGS.aiProviders).toEqual([]);
      expect(DEFAULT_SETTINGS.llmConfigs).toEqual([]);
      expect(DEFAULT_SETTINGS.llmConfig).toBeNull();
    });

    it('PRESET_AI_PROVIDER_TEMPLATES provides templates without auto-mounting them', () => {
      expect(PRESET_AI_PROVIDER_TEMPLATES.length).toBeGreaterThanOrEqual(7);
      const deepseek = PRESET_AI_PROVIDER_TEMPLATES.find((t) => t.providerType === 'DeepSeek');
      expect(deepseek).toBeDefined();
      expect(deepseek?.endpoint).toBe('https://api.deepseek.com/v1');
      expect(deepseek?.models.length).toBeGreaterThanOrEqual(2);

      const openai = PRESET_AI_PROVIDER_TEMPLATES.find((t) => t.providerType === 'OpenAI');
      expect(openai).toBeDefined();
    });

    it('migrateLlmConfigsToAiProviders does not revive default models if clean slate', () => {
      const migrated = migrateLlmConfigsToAiProviders([], []);
      expect(migrated).toEqual([]);
    });
  });

  describe('2. Store CRUD & Zero Resurrection Prevention', () => {
    it('allows deleting providers until 0 and resets llmConfig to null without resurrection', () => {
      const store = useSettingsStore.getState();
      const template = PRESET_AI_PROVIDER_TEMPLATES[0];

      // Add a provider
      store.addAiProvider(template);
      expect(useSettingsStore.getState().settings.aiProviders?.length).toBe(1);
      expect(useSettingsStore.getState().settings.llmConfig).not.toBeNull();

      // Delete the provider
      const addedId = useSettingsStore.getState().settings.aiProviders![0].id;
      store.deleteAiProvider(addedId);

      // Verify zero models and no resurrection
      const current = useSettingsStore.getState().settings;
      expect(current.aiProviders).toEqual([]);
      expect(current.llmConfigs).toEqual([]);
      expect(current.llmConfig).toBeNull();
    });
  });

  describe('3. Settings LlmProviderConfigCard Empty State & One-Click Mounting', () => {
    it('renders zero-model-empty-state card with preset chips when providers list is empty', () => {
      render(<LlmProviderConfigCard />);

      const emptyState = screen.getByTestId('zero-model-empty-state');
      expect(emptyState).toBeInTheDocument();
      expect(screen.getByText('暂未添加任何 AI 大语言模型')).toBeInTheDocument();

      // Should show preset buttons
      const dsChip = screen.getByText('DeepSeek');
      expect(dsChip).toBeInTheDocument();
    });

    it('clicking a preset chip mounts the provider and transitions away from empty state', () => {
      render(<LlmProviderConfigCard />);

      const dsChip = screen.getByText('DeepSeek');
      fireEvent.click(dsChip);

      // Now providers should contain DeepSeek
      expect(useSettingsStore.getState().settings.aiProviders?.length).toBe(1);
      expect(useSettingsStore.getState().settings.aiProviders![0].name).toBe('DeepSeek');

      // Empty state should be gone
      expect(screen.queryByTestId('zero-model-empty-state')).not.toBeInTheDocument();
      expect(screen.getByText('DeepSeek 基础配置')).toBeInTheDocument();
    });
  });

  describe('4. AiChatPanel Zero-Model Handling & Interception', () => {
    it('renders clean zero-model badge and greeting when no models configured', () => {
      render(<AiChatPanel onOpenSettings={() => {}} />);

      expect(screen.getByText('未配置 AI 模型')).toBeInTheDocument();
      expect(screen.getByText('暂未配置 AI 大语言模型')).toBeInTheDocument();
      expect(screen.getByText('前往设置添加 AI 模型')).toBeInTheDocument();
    });

    it('intercepts message sending gracefully when zero models configured', async () => {
      render(<AiChatPanel onOpenSettings={() => {}} />);

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: '你好，请测试' } });

      const sendBtn = screen.getByTitle(/发送/i);
      fireEvent.click(sendBtn);

      // Should show friendly notification without crash
      expect(screen.getByText(/当前尚未配置任何 AI 大语言模型/i)).toBeInTheDocument();
      expect(screen.getByText(/未配置任何 AI 大模型。请点击【前往设置】添加。/i)).toBeInTheDocument();
    });
  });
});
