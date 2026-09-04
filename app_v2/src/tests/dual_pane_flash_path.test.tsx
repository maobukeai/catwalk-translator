import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';
import * as tauriService from '../services/tauri';

describe('主窗口智能推荐 150ms 闪电先锋快通道 (Flash Path) 测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('在智能推荐模式下先发起 cmdTranslatePhrasesStyled 闪电先锋快通道，秒出结果并解除 loading 态', async () => {
    const flashCalls: any[] = [];
    const universalCalls: any[] = [];

    vi.spyOn(tauriService, 'cmdTranslatePhrasesStyled').mockImplementation(async (...args: any[]) => {
      flashCalls.push(args);
      return [{
        original: args[0][0],
        translated: '表面微观粗糙度分布贴图 (150ms 闪电秒出)',
        sourceTier: 'Bing Edge ⚡',
      }];
    });

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockImplementation(async (params: any) => {
      universalCalls.push(params);
      await new Promise((r) => setTimeout(r, 80));
      return {
        original: params.text,
        detectedLang: 'en',
        mainTranslation: '粗糙度贴图 (多引擎全量对照)',
        engines: [
          {
            engineName: '微软 Bing 翻译',
            translated: '粗糙度贴图 (多引擎全量对照)',
            sourceTier: 'Online Fallback',
          },
        ],
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

    // 1. 验证 150ms 闪电先锋通道被调用且迅速上屏
    await waitFor(() => {
      expect(flashCalls.length).toBeGreaterThan(0);
      expect(screen.getByText(/表面微观粗糙度分布贴图 \(150ms 闪电秒出\)/)).toBeDefined();
    });

    // 2. 随后全量多引擎返回后平滑更新
    await waitFor(() => {
      expect(universalCalls.length).toBeGreaterThan(0);
      expect(screen.getByText(/粗糙度贴图 \(多引擎全量对照\)/)).toBeDefined();
    });
  });
});
