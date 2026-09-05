import { describe, it, expect, beforeEach } from 'vitest';
import { isBaiduLlmConfigured } from '../services/tauri';
import { useSettingsStore } from '../stores/useSettingsStore';
import { PROVIDER_DEFAULT_ENDPOINTS, PROVIDER_PRESET_MODELS } from '../components/Settings/panels/useLlmPanelState';
import type { AppSettings } from '../services/types';

describe('Baidu LLM Integration & Credentials Test Suite', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        baiduAppId: '',
        baiduSecret: '',
        baiduLlmApiKey: '',
      },
    });
  });

  describe('isBaiduLlmConfigured logic', () => {
    it('returns false when appid is missing', () => {
      const s: Partial<AppSettings> = {
        baiduAppId: '',
        baiduLlmApiKey: 'llm-key-456',
      };
      expect(isBaiduLlmConfigured(s as AppSettings)).toBe(false);
    });

    it('returns false when baiduLlmApiKey is missing even if general secret exists', () => {
      const s: Partial<AppSettings> = {
        baiduAppId: 'appid123',
        baiduSecret: 'secret123',
        baiduLlmApiKey: '',
      };
      expect(isBaiduLlmConfigured(s as AppSettings)).toBe(false);
    });

    it('returns true when both appid and baiduLlmApiKey are provided', () => {
      const s: Partial<AppSettings> = {
        baiduAppId: 'appid123',
        baiduLlmApiKey: 'llm-key-456',
      };
      expect(isBaiduLlmConfigured(s as AppSettings)).toBe(true);
    });
  });

  describe('useSettingsStore.setBaiduConfig', () => {
    it('updates all Baidu credentials fields cleanly', () => {
      const store = useSettingsStore.getState();
      store.setBaiduConfig('2024000123', 'my-secret-key', 'my-llm-token');

      const updated = useSettingsStore.getState().settings;
      expect(updated.baiduAppId).toBe('2024000123');
      expect(updated.baiduSecret).toBe('my-secret-key');
      expect(updated.baiduLlmApiKey).toBe('my-llm-token');
    });
  });

  describe('Baidu Qianfan LLM Pool Provider & Presets', () => {
    it('includes 百度文心 (千帆) in PROVIDER_DEFAULT_ENDPOINTS with official OpenAI-compatible endpoint', () => {
      const qianfan = PROVIDER_DEFAULT_ENDPOINTS['百度文心 (千帆)'];
      expect(qianfan).toBeDefined();
      expect(qianfan.endpoint).toBe('https://qianfan.baidubce.com/v2');
      expect(qianfan.model).toBe('ernie-speed-128k');
    });

    it('provides preset ERNIE models in PROVIDER_PRESET_MODELS', () => {
      const models = PROVIDER_PRESET_MODELS['百度文心 (千帆)'];
      expect(models).toBeDefined();
      expect(models).toContain('ernie-speed-128k');
      expect(models).toContain('ernie-4.0-turbo-8k');
      expect(models).toContain('ernie-4.0-8k');
    });
  });
});
