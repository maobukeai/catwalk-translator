import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';
import * as tauriService from '../services/tauri';

describe('主窗口智能推荐快慢双流渐进翻译测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('在智能推荐模式下先以 skipLlm 极速秒出在线机翻，随后自动后台异步升级大模型精翻', async () => {
    const calls: any[] = [];
    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockImplementation(async (params: any) => {
      calls.push(params);
      if (params.skipLlm) {
        return {
          original: params.text,
          detectedLang: 'en',
          mainTranslation: '粗糙度贴图 (在线竞速机翻)',
          engines: [
            {
              engineName: '微软 Bing 翻译',
              translated: '粗糙度贴图 (在线竞速机翻)',
              sourceTier: 'Online Fallback',
            },
          ],
        };
      }
      if (params.forcedEngine === 'llm') {
        return {
          original: params.text,
          detectedLang: 'en',
          mainTranslation: '表面微观粗糙度分布贴图 (AI 精翻)',
          engines: [
            {
              engineName: 'gemini-3.5-flash-lite 深度翻译',
              translated: '表面微观粗糙度分布贴图 (AI 精翻)',
              sourceTier: 'LLM API',
            },
          ],
        };
      }
      return {
        original: params.text,
        detectedLang: 'en',
        mainTranslation: '普通翻译',
        engines: [],
      };
    });

    const customSettings = {
      ...DEFAULT_SETTINGS,
      enableLlmProgressiveRefine: true,
      llmConfig: {
        id: 'test-llm',
        provider: 'Custom',
        apiKey: 'test-key',
        model: 'gemini-3.5-flash-lite',
        endpoint: 'https://api.openai.com/v1',
        enabled: true,
      },
    };

    render(<DualPaneTranslator settings={customSettings} initialText="Roughness Map" />);

    // 1. 首屏快通道验证：迅速呈现机翻结果
    await waitFor(() => {
      expect(calls.some((c) => c.skipLlm === true)).toBe(true);
      expect(screen.getByText(/粗糙度贴图 \(在线竞速机翻\)/)).toBeDefined();
    });

    // 2. 慢通道验证：后台异步调用大模型
    await waitFor(() => {
      expect(calls.some((c) => c.forcedEngine === 'llm')).toBe(true);
    });
  });
});
