import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import * as tauriService from '../services/tauri';
import { createMockIpcHarness } from './harness/tauriIpcMock';
import type { AppSettings, UniversalTranslationResponse, AiDeepTranslationAnalysis } from '../services/types';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  hotkey: 'Alt+W',
  defaultPreset: 'blender',
  llmConfig: null,
  translationTiers: ['preset', 'llm', 'online'],
  presetDicts: {
    blender: true,
    substance: true,
    unity: true,
    unreal: true,
    maya: true,
    houdini: true,
  },
  appearance: {
    theme: 'dark',
    enableBlur: true,
    blurAmount: 24,
    fontFamily: 'system',
    fontSize: 'medium',
  },
};

const SETTINGS_WITH_LLM: AppSettings = {
  ...DEFAULT_SETTINGS,
  llmConfig: {
    provider: 'openai',
    model: 'deepseek-chat',
    apiKey: 'sk-test-valid-key',
    endpoint: 'https://api.deepseek.com/v1',
  },
};

describe('DualPaneTranslator Deep Analysis & Refinement Test Suite', () => {
  beforeEach(() => {
    (window as any).__TAURI_INTERNALS__ = {};
    createMockIpcHarness();
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    cleanup();
    vi.restoreAllMocks();
  });

  describe('fetchAiDeepTranslationAnalysis Service Unit Tests', () => {
    it('returns null if input is empty or config is missing', async () => {
      expect(await tauriService.fetchAiDeepTranslationAnalysis('', 'trans', 'zh-CN', 'en', SETTINGS_WITH_LLM.llmConfig)).toBeNull();
      expect(await tauriService.fetchAiDeepTranslationAnalysis('test', '', 'zh-CN', 'en', SETTINGS_WITH_LLM.llmConfig)).toBeNull();
      expect(await tauriService.fetchAiDeepTranslationAnalysis('test', 'trans', 'zh-CN', 'en', null)).toBeNull();
    });

    it('successfully parses LLM JSON with think tags and code blocks and caches result', async () => {
      const mockRawContent = `<think>
Thinking about deep analysis for "正确配置指引"...
</think>
\`\`\`json
{
  "rewrites": [
    { "style": "formal", "styleLabel": "商务正式", "iconName": "Briefcase", "text": "Guidelines for Proper Configuration" },
    { "style": "technical", "styleLabel": "技术规范", "iconName": "Wrench", "text": "Correct Configuration Manual" },
    { "style": "casual", "styleLabel": "地道自然", "iconName": "MessageSquare", "text": "How to set it up right" }
  ],
  "vocabulary": [
    { "word": "configuration", "phonetic": "/kənˌfɪɡjəˈreɪʃn/", "pos": "n.", "meaning": "配置；结构；外形" },
    { "word": "guidelines", "phonetic": "/ˈɡaɪdlaɪnz/", "pos": "n.", "meaning": "指导方针；准则" }
  ],
  "examples": [
    { "en": "Please refer to the documentation for the correct configuration guide.", "zh": "请参考文档以获取正确配置指引。" }
  ]
}
\`\`\``;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: mockRawContent } }],
        }),
      } as any);

      const result = await tauriService.fetchAiDeepTranslationAnalysis(
        '正确配置指引',
        'Correct Configuration Guide',
        'zh-CN',
        'en',
        SETTINGS_WITH_LLM.llmConfig
      );

      expect(result).not.toBeNull();
      expect(result?.rewrites).toHaveLength(3);
      expect(result?.rewrites[0].styleLabel).toBe('商务正式');
      expect(result?.rewrites[0].text).toBe('Guidelines for Proper Configuration');
      expect(result?.vocabulary).toHaveLength(2);
      expect(result?.vocabulary[0].word).toBe('configuration');
      expect(result?.examples).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call should hit localStorage cache
      const cached = await tauriService.fetchAiDeepTranslationAnalysis(
        '正确配置指引',
        'Correct Configuration Guide',
        'zh-CN',
        'en',
        SETTINGS_WITH_LLM.llmConfig
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(cached?.rewrites[0].text).toBe('Guidelines for Proper Configuration');

      // Call with bypassCache should re-fetch
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: mockRawContent } }],
        }),
      } as any);

      await tauriService.fetchAiDeepTranslationAnalysis(
        '正确配置指引',
        'Correct Configuration Guide',
        'zh-CN',
        'en',
        SETTINGS_WITH_LLM.llmConfig,
        true
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('gracefully handles fetch failure or invalid JSON without crashing', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'));
      const res = await tauriService.fetchAiDeepTranslationAnalysis(
        'hello',
        'world',
        'en',
        'zh-CN',
        SETTINGS_WITH_LLM.llmConfig
      );
      expect(res).toBeNull();
    });
  });

  describe('DualPaneTranslator UI Integration Tests', () => {
    const mockTransResponse: UniversalTranslationResponse = {
      original: '正确配置指引',
      detectedLang: 'zh-CN',
      mainTranslation: 'Correct Configuration Guide',
      engines: [
        {
          engineName: 'AI 深度翻译 (deepseek-chat)',
          translated: 'Correct Configuration Guide',
          sourceTier: 'LLM API',
        },
        {
          engineName: '彩云小译',
          translated: 'Guidelines for proper configuration',
          sourceTier: 'Online Fallback',
        },
      ],
    };

    const mockDeepAnalysis: AiDeepTranslationAnalysis = {
      rewrites: [
        { style: 'formal', styleLabel: '商务正式', iconName: 'Briefcase', text: 'Guidelines for Proper Configuration' },
        { style: 'technical', styleLabel: '技术规范', iconName: 'Wrench', text: 'Correct Configuration Specification' },
        { style: 'casual', styleLabel: '地道自然', iconName: 'MessageSquare', text: 'How to configure it correctly' },
      ],
      vocabulary: [
        { word: 'configuration', phonetic: '/kənˌfɪɡjəˈreɪʃn/', pos: 'n.', meaning: '配置；结构' },
        { word: 'specification', phonetic: '/ˌspesɪfɪˈkeɪʃn/', pos: 'n.', meaning: '规范；说明书' },
      ],
      examples: [
        { en: 'Follow the correct configuration guide carefully.', zh: '请仔细遵循正确配置指引。' },
      ],
      modelUsed: 'deepseek-chat',
      timestamp: Date.now(),
    };

    it('renders unconfigured guide banner and navigates to settings when LLM is not configured', async () => {
      const handleOpenSettings = vi.fn();
      vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockTransResponse);

      render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="正确配置指引" onOpenSettings={handleOpenSettings} />);

      await waitFor(() => {
        expect(screen.getByText('Correct Configuration Guide')).toBeInTheDocument();
      });

      const guideBanner = await screen.findByText('连接 AI 大模型，即可自动解锁重点词汇拆解与地道场景例句');
      expect(guideBanner).toBeInTheDocument();

      const bannerButton = guideBanner.closest('button');
      expect(bannerButton).not.toBeNull();
      fireEvent.click(bannerButton!);
      expect(handleOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('renders vocabulary breakdown and authentic context sentences without rewrite clutter', async () => {
      vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockTransResponse);
      vi.spyOn(tauriService, 'fetchAiDeepTranslationAnalysis').mockResolvedValue(mockDeepAnalysis);

      render(<DualPaneTranslator settings={SETTINGS_WITH_LLM} initialText="正确配置指引" />);

      // Wait for primary translation to render
      await waitFor(() => {
        expect(screen.getByText('Correct Configuration Guide')).toBeInTheDocument();
      });

      // Wait for deep analysis to render vocabulary items
      await waitFor(() => {
        expect(screen.getByText('configuration')).toBeInTheDocument();
      });

      // Confirm style rewrites are NOT rendered
      expect(screen.queryByText('商务正式')).toBeNull();
      expect(screen.queryByText('技术规范')).toBeNull();
      expect(screen.queryByText('地道自然')).toBeNull();

      // Check vocabulary items are displayed
      expect(screen.getByText('配置；结构')).toBeInTheDocument();
      expect(screen.getByText('/kənˌfɪɡjəˈreɪʃn/')).toBeInTheDocument();

      // Check context sentence is displayed
      expect(screen.getByText('Follow the correct configuration guide carefully.')).toBeInTheDocument();
      expect(screen.getByText('请仔细遵循正确配置指引。')).toBeInTheDocument();
    });

    it('toggles collapse on Multi-Engine Comparison section', async () => {
      vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockTransResponse);
      render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="正确配置指引" />);

      await waitFor(() => {
        expect(screen.getByText('多源引擎并行对照 (Multi-Engine Comparison)')).toBeInTheDocument();
      });

      expect(screen.getByText('Guidelines for proper configuration')).toBeInTheDocument();

      // Click collapse button
      const collapseBtn = screen.getByTitle('收起对照卡片');
      expect(collapseBtn).toBeInTheDocument();
      fireEvent.click(collapseBtn);

      // Comparison grid should now be collapsed
      expect(screen.queryByText('Guidelines for proper configuration')).toBeNull();

      // Click expand button
      const expandBtn = screen.getByTitle('展开对照卡片');
      expect(expandBtn).toBeInTheDocument();
      fireEvent.click(expandBtn);

      // Comparison grid should be visible again
      expect(screen.getByText('Guidelines for proper configuration')).toBeInTheDocument();
    });
  });
});
