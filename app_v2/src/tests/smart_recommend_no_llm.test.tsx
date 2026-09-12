import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';
import * as tauriService from '../services/tauri';

describe('主窗口智能推荐：无大模型配置与大模型异常时的降级自愈测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('未配置任何大模型 API Key 时，智能推荐模式必须传 skipLlm: true，秒级直出在线机翻且绝不罢工', async () => {
    const universalCalls: any[] = [];

    vi.spyOn(tauriService, 'cmdTranslatePhrasesStyled').mockResolvedValue([
      {
        original: 'Roughness Map',
        translated: '粗糙度贴图 (闪电先锋)',
        sourceTier: 'Bing Edge ⚡',
      },
    ]);

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockImplementation(async (params: any) => {
      universalCalls.push(params);
      return {
        original: params.text,
        detectedLang: 'en',
        mainTranslation: '粗糙度贴图 (在线引擎)',
        engines: [
          {
            engineName: '微软 Bing 翻译',
            translated: '粗糙度贴图 (在线引擎)',
            sourceTier: 'Online Fallback',
          },
          {
            engineName: '网易有道翻译',
            translated: '粗糙度贴图 (有道在线)',
            sourceTier: 'Online Fallback',
          },
        ],
      };
    });

    // 模拟全新安装且未填写任何 API Key 的默认设置
    const defaultUnconfiguredSettings = {
      ...DEFAULT_SETTINGS,
      enableLlmProgressiveRefine: true,
      llmConfig: {
        id: 'llm-deepseek-deepseek-chat',
        provider: 'DeepSeek',
        apiKey: '',
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/v1',
      },
    };

    render(<DualPaneTranslator settings={defaultUnconfiguredSettings} initialText="Roughness Map" />);

    // 1. 验证首屏机翻结果正常渲染呈现（主区或卡片中均有对应译文）
    await waitFor(() => {
      const matches = screen.getAllByText(/粗糙度贴图/);
      expect(matches.length).toBeGreaterThan(0);
    });

    // 2. 验证传递给 UniversalTranslate 的参数中，skipLlm 必须为 true
    expect(universalCalls.length).toBeGreaterThan(0);
    expect(universalCalls[0].skipLlm).toBe(true);

    // 3. 验证绝不会发起 forcedEngine: 'llm' 的异步精翻（因为没有配置有效 LLM）
    expect(universalCalls.some((c) => c.forcedEngine === 'llm')).toBe(false);

    // 4. 验证界面绝不包含「需配置」或「未配置 API Key」的报错横幅
    expect(screen.queryByText(/\[需配置\]/)).toBeNull();
    expect(screen.queryByText(/未配置 API Key/)).toBeNull();
  });

  it('即使大模型精翻接口异常返回未配置或超时，智能推荐也绝不冲刷抹除已有的优质在线机翻', async () => {
    vi.spyOn(tauriService, 'cmdTranslatePhrasesStyled').mockResolvedValue([
      {
        original: 'Normal Map',
        translated: '法线贴图 (先锋)',
        sourceTier: 'Bing Edge ⚡',
      },
    ]);

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockImplementation(async (params: any) => {
      if (params.skipLlm) {
        return {
          original: params.text,
          detectedLang: 'en',
          mainTranslation: '法线贴图 (优质机翻)',
          engines: [
            {
              engineName: 'Google 翻译 (官方通道)',
              translated: '法线贴图 (优质机翻)',
              sourceTier: 'Online Fallback',
            },
          ],
        };
      }
      if (params.forcedEngine === 'llm') {
        // 模拟大模型端点返回待配置错误卡片
        return {
          original: params.text,
          detectedLang: 'en',
          mainTranslation: '[未配置 API Key · 点击前往设置]',
          engines: [
            {
              engineName: '🤖 AI 深度翻译 (DeepSeek)',
              translated: '[未配置 API Key · 点击前往设置]',
              sourceTier: 'LLM (Config Required)',
            },
          ],
        };
      }
      return {
        original: params.text,
        detectedLang: 'en',
        mainTranslation: '法线贴图',
        engines: [],
      };
    });

    const settingsWithBrokenLlm = {
      ...DEFAULT_SETTINGS,
      enableLlmProgressiveRefine: true,
      llmConfig: {
        id: 'test-llm',
        provider: 'Custom',
        apiKey: 'dummy-key',
        model: 'deepseek-chat',
        endpoint: 'https://api.openai.com/v1',
        enabled: true,
      },
    };

    render(<DualPaneTranslator settings={settingsWithBrokenLlm} initialText="Normal Map" />);

    // 等待 Stage-1 完成并且 Stage-2 完成
    await waitFor(() => {
      const matches = screen.getAllByText(/法线贴图 \(优质机翻\)/);
      expect(matches.length).toBeGreaterThan(0);
    });

    // 稍作等待以确保 Stage-2 执行完毕
    await new Promise((r) => setTimeout(r, 100));

    // 核心断言：优质机翻仍然保留在主屏，绝对不能被 [未配置 API Key] 冲刷！
    const matchesAfter = screen.getAllByText(/法线贴图 \(优质机翻\)/);
    expect(matchesAfter.length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[需配置\]/)).toBeNull();
  });

  it('点击「智能推荐」标签按钮时，能精确选中有效非重试机翻引擎', async () => {
    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue({
      original: 'Metalness',
      detectedLang: 'en',
      mainTranslation: '金属度贴图',
      engines: [
        {
          engineName: '🤖 AI 深度翻译 (DeepSeek)',
          translated: '[未配置 API Key · 点击前往设置]',
          sourceTier: 'LLM (Config Required)',
        },
        {
          engineName: '微软 Bing 翻译',
          translated: '金属度贴图',
          sourceTier: 'Online Fallback',
        },
      ],
    });

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="Metalness" />);

    await waitFor(() => {
      expect(screen.getByText('智能推荐')).toBeDefined();
    });

    const autoBtn = screen.getByText('智能推荐');
    fireEvent.click(autoBtn);

    // 应当选中有效引擎，并在主区展示有效译文
    await waitFor(() => {
      const matches = screen.getAllByText('金属度贴图');
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
