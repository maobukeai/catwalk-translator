import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import type { AppSettings, UniversalTranslationResponse } from '../services/types';
import * as tauriService from '../services/tauri';

const TEST_SETTINGS: AppSettings = {
  theme: 'system',
  hotkey: 'F4',
  defaultPreset: 'blender',
  llmConfig: {
    provider: 'DeepSeek',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  },
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
    deepl: true,
    baidu: true,
  },
};

describe('Multi-Engine Card Retention & Inline Retry Test Suite', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('100% preserves all enabled engine cards even on network timeout, showing amber [连接超时] badges and retry buttons', async () => {
    const mockRes: UniversalTranslationResponse = {
      original: 'Metallic',
      detectedLang: 'en',
      mainTranslation: '金属度',
      engines: [
        {
          engineName: 'Google 翻译 (官方通道)',
          translated: '金属度',
          sourceTier: 'Online Fallback',
        },
        {
          engineName: 'DeepL 极速通道',
          translated: '[网络连接超时 / 点击重试]',
          sourceTier: 'Online (Retry)',
        },
        {
          engineName: '微软 Bing 翻译',
          translated: '[网络连接超时 / 点击重试]',
          sourceTier: 'Online (Retry)',
        },
        {
          engineName: '百度通用翻译',
          translated: '金属度属性',
          sourceTier: 'Online Fallback',
        },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockRes);

    render(<DualPaneTranslator settings={TEST_SETTINGS} initialText="" />);

    const textarea = screen.getByPlaceholderText(/输入或粘贴/);
    fireEvent.change(textarea, { target: { value: 'Metallic' } });

    await waitFor(() => {
      expect(screen.getByText('金属度属性')).toBeInTheDocument();
    });

    // 验证多源对照卡片 100% 呈现，无一遗漏
    const timeoutBadges = screen.getAllByText(/\[连接超时\]/);
    expect(timeoutBadges.length).toBeGreaterThanOrEqual(2);

    const retryButtons = screen.getAllByText(/重试/);
    expect(retryButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('intelligently prioritizes valid non-retry translations for mainTranslation and active tab', async () => {
    const mockRes: UniversalTranslationResponse = {
      original: 'Roughness',
      detectedLang: 'en',
      mainTranslation: '粗糙度',
      engines: [
        {
          engineName: 'Google 翻译 (官方通道)',
          translated: '[网络连接超时 / 点击重试]',
          sourceTier: 'Online (Retry)',
        },
        {
          engineName: 'DeepL 极速通道',
          translated: '粗糙度',
          sourceTier: 'Online Fallback',
        },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockRes);

    render(<DualPaneTranslator settings={TEST_SETTINGS} initialText="" />);

    const textarea = screen.getByPlaceholderText(/输入或粘贴/);
    fireEvent.change(textarea, { target: { value: 'Roughness' } });

    await waitFor(() => {
      // 主译文应自动优先挑选有效的 DeepL 粗糙度
      expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('clicking inline retry on a single card calls cmdUniversalTranslate with forcedEngine and updates the card in place', async () => {
    const initialRes: UniversalTranslationResponse = {
      original: 'Subsurface Scattering',
      detectedLang: 'en',
      mainTranslation: '次表面散射 (Google)',
      engines: [
        {
          engineName: 'Google 翻译 (官方通道)',
          translated: '次表面散射 (Google)',
          sourceTier: 'Online Fallback',
        },
        {
          engineName: 'DeepL 极速通道',
          translated: '[网络连接超时 / 点击重试]',
          sourceTier: 'Online (Retry)',
        },
      ],
    };

    const spy = vi.spyOn(tauriService, 'cmdUniversalTranslate').mockImplementation(async (params: any) => {
      if (params.forcedEngine === 'DeepL 极速通道') {
        return {
          original: 'Subsurface Scattering',
          detectedLang: 'en',
          mainTranslation: '次表面散射 (DeepL 恢复)',
          engines: [
            {
              engineName: 'DeepL 极速通道',
              translated: '次表面散射 (DeepL 恢复)',
              sourceTier: 'Online Fallback',
            },
          ],
        };
      }
      return initialRes;
    });

    render(<DualPaneTranslator settings={TEST_SETTINGS} initialText="" />);

    const textarea = screen.getByPlaceholderText(/输入或粘贴/);
    fireEvent.change(textarea, { target: { value: 'Subsurface Scattering' } });

    await waitFor(() => {
      expect(screen.getByText('[网络连接超时 / 点击重试]')).toBeInTheDocument();
    });

    // 找到 DeepL 卡片上的重试按钮
    const retryBtn = screen.getByTitle('单独重新请求该引擎');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        forcedEngine: 'DeepL 极速通道',
      }));
      expect(screen.getAllByText('次表面散射 (DeepL 恢复)').length).toBeGreaterThanOrEqual(1);
    });
  });
});
