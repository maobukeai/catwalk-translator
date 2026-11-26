import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';
import * as tauriService from '../services/tauri';
import type { AppSettings, UniversalTranslationResponse } from '../services/types';

describe('DualPaneTranslator 渠道秒切与固定渠道防阻塞测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('已加载多引擎译文后切换任意渠道，0ms 本地瞬间切换且绝不重复发起翻译请求', async () => {
    const mockResponse: UniversalTranslationResponse = {
      original: '你好',
      detectedLang: 'zh-CN',
      mainTranslation: 'Hello (Bing)',
      engines: [
        {
          engineName: '微软 Bing 翻译',
          translated: 'Hello (Bing)',
          sourceTier: 'Online Fallback',
        },
        {
          engineName: 'Google 翻译 (官方通道)',
          translated: 'Hello (Google)',
          sourceTier: 'Online Fallback',
        },
        {
          engineName: 'DeepL 极速通道',
          translated: 'Hello (DeepL)',
          sourceTier: 'Online Fallback',
        },
      ],
    };

    const translateSpy = vi
      .spyOn(tauriService, 'cmdUniversalTranslate')
      .mockResolvedValue(mockResponse);
    vi.spyOn(tauriService, 'cmdTranslatePhrasesStyled').mockResolvedValue([
      {
        original: '你好',
        translated: 'Hello (Bing)',
        sourceTier: 'Bing Edge ⚡',
      },
    ]);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="你好" />);

    await waitFor(() => {
      expect(screen.getAllByText('Hello (Google)').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Hello (DeepL)').length).toBeGreaterThanOrEqual(1);
    });

    const callCountAfterLoad = translateSpy.mock.calls.length;

    // 切换到 Google
    fireEvent.click(screen.getByText('Google').closest('button')!);
    expect(screen.queryByText('正在汇聚多引擎与术语译文...')).toBeNull();
    expect(screen.getAllByText('Hello (Google)').length).toBeGreaterThanOrEqual(2);
    expect(translateSpy.mock.calls.length).toBe(callCountAfterLoad);

    // 切换到 DeepL
    fireEvent.click(screen.getByText('DeepL').closest('button')!);
    expect(screen.queryByText('正在汇聚多引擎与术语译文...')).toBeNull();
    expect(screen.getAllByText('Hello (DeepL)').length).toBeGreaterThanOrEqual(2);
    expect(translateSpy.mock.calls.length).toBe(callCountAfterLoad);

    // 切回 智能推荐，且右栏底部应明确显示实际优选源
    fireEvent.click(screen.getByText('智能推荐').closest('button')!);
    expect(screen.queryByText('正在汇聚多引擎与术语译文...')).toBeNull();
    expect(screen.getAllByText('Hello (Bing)').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('智能优选 · Bing · 已汇聚 3 源')).toBeInTheDocument();
    expect(translateSpy.mock.calls.length).toBe(callCountAfterLoad);

    // 点击底部多源引擎对照卡片，应同步更新顶部对应渠道高亮并零请求切换
    const deeplCardHeading = screen.getByText('DeepL 极速通道');
    fireEvent.click(deeplCardHeading.closest('div.group')!);
    expect(localStorage.getItem('maobu_preferred_engine')).toBe('DeepL');
    expect(screen.getByText('DeepL').closest('button')?.className).toContain('text-white');
    expect(translateSpy.mock.calls.length).toBe(callCountAfterLoad);
  });

  it('固定非 AI 渠道时触发单渠道快通道秒出，且 Stage-1 强制 skipLlm=true 不被慢速大模型卡住', async () => {
    localStorage.setItem('maobu_preferred_engine', 'Google');

    const settingsWithLlm: AppSettings = {
      ...DEFAULT_SETTINGS,
      enableLlmProgressiveRefine: true,
      llmConfig: {
        id: 'test-deepseek',
        provider: 'DeepSeek',
        model: 'deepseek-chat',
        apiKey: 'sk-test-valid',
        endpoint: 'https://api.deepseek.com/v1',
        enabled: true,
      },
    };

    const calls: any[] = [];
    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockImplementation(async (params: any) => {
      calls.push(params);
      if (params.forcedEngine === 'Google' && params.skipLlm === true) {
        return {
          original: params.text,
          detectedLang: 'zh-CN',
          mainTranslation: 'Hello fast Google',
          engines: [
            {
              engineName: 'Google 翻译 (官方通道)',
              translated: 'Hello fast Google',
              sourceTier: 'Online Fallback',
            },
          ],
        };
      }
      if (!params.forcedEngine && params.skipLlm === true) {
        await new Promise((r) => setTimeout(r, 80));
        return {
          original: params.text,
          detectedLang: 'zh-CN',
          mainTranslation: 'Hello Bing',
          engines: [
            {
              engineName: '微软 Bing 翻译',
              translated: 'Hello Bing',
              sourceTier: 'Online Fallback',
            },
            {
              engineName: 'Google 翻译 (官方通道)',
              translated: 'Hello Stage1 Google',
              sourceTier: 'Online Fallback',
            },
          ],
        };
      }
      if (params.forcedEngine === 'llm') {
        await new Promise((r) => setTimeout(r, 120));
        return {
          original: params.text,
          detectedLang: 'zh-CN',
          mainTranslation: 'Hello slow LLM',
          engines: [
            {
              engineName: 'AI 深度翻译 (deepseek-chat)',
              translated: 'Hello slow LLM',
              sourceTier: 'LLM API',
            },
          ],
        };
      }
      return {
        original: params.text,
        detectedLang: 'zh-CN',
        mainTranslation: 'Unexpected blocking call',
        engines: [],
      };
    });

    render(<DualPaneTranslator settings={settingsWithLlm} initialText="你好" />);

    // Stage-0 固定通道极速秒出
    await waitFor(() => {
      expect(screen.getAllByText('Hello fast Google').length).toBeGreaterThanOrEqual(1);
    });

    // Stage-1 与 Stage-2 先后完成
    await waitFor(
      () => {
        expect(screen.getByText('Hello slow LLM')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // 绝不应以 skipLlm: false 发起阻塞式全量请求
    expect(calls.some((c) => !c.forcedEngine && c.skipLlm === false)).toBe(false);
    expect(calls.some((c) => c.forcedEngine === 'Google' && c.skipLlm === true)).toBe(true);

    // Stage-2 完成后，仍保持用户固定的 Google 选中态与主区译文，不被大模型或 Bing 劫持
    expect(screen.getByText('Google').closest('button')?.className).toContain('text-white');
    expect(screen.getAllByText('Hello Stage1 Google').length).toBeGreaterThanOrEqual(2);
  });
});
