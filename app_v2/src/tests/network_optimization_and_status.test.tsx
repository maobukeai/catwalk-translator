import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import { fetchLlmTranslate } from '../services/tauri';
import * as tauriService from '../services/tauri';
import type { AppSettings, UniversalTranslationResponse } from '../services/types';

describe('Network Optimization & Fine-Grained Status Distinction Test Suite', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const defaultSettings: AppSettings = {
    theme: 'dark',
    hotkey: 'Alt+Q',
    defaultPreset: 'blender',
    llmConfig: {
      provider: 'DeepSeek',
      apiKey: '',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
    },
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
      youdao: true,
      deepl: true,
      myMemory: true,
      baidu: true,
      tencent: true,
    },
    translationTiers: ['Preset Dictionary', 'LLM API', 'Online Fallback'],
    translationStyle: 'literal',
  };

  it('renders blue [需配置] badge and [⚙️ 前往配置] button when LLM API Key is not configured', async () => {
    const onOpenSettings = vi.fn();

    const mockResponse: UniversalTranslationResponse = {
      original: 'Principled BSDF',
      detectedLang: 'en',
      mainTranslation: '原理化 BSDF',
      engines: [
        {
          engineName: '本地专业词库 (blender)',
          translated: '原理化 BSDF',
          sourceTier: 'Preset Dictionary',
        },
        {
          engineName: '🤖 AI 深度翻译 (DeepSeek)',
          translated: '[未配置 API Key · 点击前往设置]',
          sourceTier: 'LLM (Config Required)',
        },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockResponse);

    render(
      <DualPaneTranslator
        settings={defaultSettings}
        initialText="Principled BSDF"
        onOpenSettings={onOpenSettings}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('[需配置]')).toBeInTheDocument();
    });

    const configBtns = screen.getAllByRole('button', { name: /前往配置/i });
    expect(configBtns.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(configBtns[0]);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('renders rose [鉴权失败] badge when LLM returns Auth Error', async () => {
    const mockResponse: UniversalTranslationResponse = {
      original: 'Subdivision Surface',
      detectedLang: 'en',
      mainTranslation: '细分曲面',
      engines: [
        {
          engineName: '本地专业词库 (blender)',
          translated: '细分曲面',
          sourceTier: 'Preset Dictionary',
        },
        {
          engineName: '🤖 AI 深度翻译 (DeepSeek)',
          translated: '[API Key 无效或已过期 · 点击检查设置]',
          sourceTier: 'LLM (Auth Error)',
        },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockResponse);

    render(
      <DualPaneTranslator
        settings={defaultSettings}
        initialText="Subdivision Surface"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('[鉴权失败]')).toBeInTheDocument();
    });
  });

  it('fetchLlmTranslate accurately returns LLM (Config Required) when apiKey is empty', async () => {
    const res = await fetchLlmTranslate('Roughness', 'zh-CN', {
      provider: 'DeepSeek',
      apiKey: '',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
    });

    expect(res.tier).toBe('LLM (Config Required)');
    expect(res.trans).toBe('[未配置 API Key · 点击前往设置]');
  });
});
