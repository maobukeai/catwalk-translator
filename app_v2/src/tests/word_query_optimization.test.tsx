import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SearchPanel } from '../components/MainWindow/SearchPanel';
import * as tauriService from '../services/tauri';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { AppSettings, TextQueryResponse } from '../services/types';

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

describe('Word Query & SearchPanel Optimization Test Suite', () => {
  beforeEach(() => {
    (window as any).__TAURI_INTERNALS__ = {};
    createMockIpcHarness();
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    cleanup();
    vi.restoreAllMocks();
  });

  it('cmdQueryText automatically uses targetLang: "auto" and suppresses phonetics for Chinese input', async () => {
    const harness = getActiveHarness()!;

    const res = await tauriService.cmdQueryText('你好', 'blender', null);

    const univCall = harness.state.invokedCommands.find(
      (c) => c.cmd === 'cmd_universal_translate'
    );
    expect(univCall).toBeDefined();
    expect(univCall?.args?.req?.targetLang).toBe('auto');
    expect(univCall?.args?.req?.text).toBe('你好');

    expect(res.original).toBe('你好');
    expect(res.wordDetail).not.toBeNull();
    // Chinese queries should never show phonetics
    expect(res.wordDetail?.phoneticUs).toBe('');
    expect(res.wordDetail?.phoneticUk).toBe('');
    expect(res.wordDetail?.pos).toBe('常用词条 / 表达');
    expect(res.wordDetail?.definition).toBe('Hello');
    // Context sentences should be natural bilingual expressions
    expect(res.wordDetail?.examples[0]).toContain('你好');
    expect(res.wordDetail?.examples[1]).toContain('Hello');
    expect(res.wordDetail?.examples[0]).not.toContain('This feature utilizes');
  });

  it('cmdQueryText retrieves real IPA phonetics for English input if available', async () => {
    const harness = getActiveHarness()!;
    harness.state.translationMap['roughness'] = '粗糙度';
    (harness.state as any).generalDictEntries = {
      roughness: {
        word: 'roughness',
        phonetic: 'ˈrʌfnəs',
        definitions: ['n. 粗糙度, 凹凸不平'],
      },
    };

    const res = await tauriService.cmdQueryText('roughness', 'blender', null);

    expect(res.wordDetail).not.toBeNull();
    expect(res.wordDetail?.phoneticUs).toBe('/ ˈrʌfnəs /');
    expect(res.wordDetail?.phoneticUk).toBe('[ ˈrʌfnəs ]');
    expect(res.wordDetail?.pos).toBe('n.');
    expect(res.wordDetail?.definition).toBe('粗糙度');
    expect(res.wordDetail?.examples[0]).toContain('roughness');
    expect(res.wordDetail?.examples[1]).toContain('粗糙度');
  });

  it('SearchPanel does not render dangling "美 " or "英 " when phonetics are empty', async () => {
    const mockQueryRes: TextQueryResponse = {
      original: '你好',
      wordDetail: {
        phoneticUs: '',
        phoneticUk: '',
        pos: '常用词条 / 表达',
        definition: 'Hello',
        examples: [
          '中文语境：日常交流与软件界面中的常用词汇“你好”。',
          '英文释义：Corresponding English expression is "Hello"。',
        ],
        cgDomainNote: '多源对照 [BLENDER]',
      },
      results: [
        { engineName: 'Google 翻译', translated: 'Hello', sourceTier: 'Online Fallback' },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue({
      original: '你好',
      detectedLang: 'zh-CN',
      mainTranslation: 'Hello',
      engines: [
        { engineName: 'Google 翻译', translated: 'Hello', sourceTier: 'Online Fallback' },
      ],
    });
    vi.spyOn(tauriService, 'cmdQueryText').mockResolvedValue(mockQueryRes);
    vi.spyOn(tauriService, 'cmdGetHistory').mockResolvedValue([]);

    render(<SearchPanel settings={DEFAULT_SETTINGS} />);

    const input = screen.getByPlaceholderText(/输入词条、CG 材质术语或短语/);
    fireEvent.change(input, { target: { value: '你好' } });

    const searchBtn = screen.getByRole('button', { name: /查询词条/ });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Hello').length).toBeGreaterThanOrEqual(1);
    });

    // Should display pos
    expect(screen.getByText('常用词条 / 表达')).toBeInTheDocument();

    // Should NOT display dangling "美 " or "英 "
    expect(screen.queryByText(/^美\s*$/)).toBeNull();
    expect(screen.queryByText(/^英\s*$/)).toBeNull();
    expect(screen.queryByText(/This feature utilizes/)).toBeNull();
  });

  describe('fetchAiWordContext API & Caching', () => {
    const mockLlmConfig = {
      provider: 'openai' as const,
      model: 'deepseek-chat',
      apiKey: 'sk-test-12345',
      endpoint: 'https://api.deepseek.com/v1',
      temperature: 0.3,
      maxTokens: 1000,
    };

    beforeEach(() => {
      localStorage.clear();
    });

    it('returns null if word is empty or config is missing', async () => {
      expect(await tauriService.fetchAiWordContext('', 'main')).toBeNull();
      expect(await tauriService.fetchAiWordContext('roughness', '粗糙度', null)).toBeNull();
    });

    it('successfully parses LLM response with think tags and markdown fences', async () => {
      const mockRawContent = `<think>
Analyzing roughness in Blender 3D context...
</think>
\`\`\`json
{
  "examples": [
    { "en": "Increase the roughness value to create a matte surface.", "zh": "调大粗糙度数值以获得哑光表面效果。" },
    { "en": "Roughness map controls the micro-facet reflections.", "zh": "粗糙度贴图控制微表面高光反射。" }
  ],
  "collocations": [
    { "phrase": "roughness map", "trans": "粗糙度贴图" },
    { "phrase": "surface roughness", "trans": "表面粗糙度" }
  ],
  "usageTip": "PBR 材质流程中取值 0.0 为完全镜面，1.0 为完全漫反射哑光。"
}
\`\`\``;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: mockRawContent } }],
        }),
      } as any);

      const res = await tauriService.fetchAiWordContext(
        'roughness',
        '粗糙度',
        mockLlmConfig,
        'blender'
      );

      expect(res).not.toBeNull();
      expect(res?.examples).toHaveLength(2);
      expect(res?.examples[0].en).toBe('Increase the roughness value to create a matte surface.');
      expect(res?.examples[0].zh).toBe('调大粗糙度数值以获得哑光表面效果。');
      expect(res?.collocations).toHaveLength(2);
      expect(res?.collocations?.[0].phrase).toBe('roughness map');
      expect(res?.usageTip).toContain('PBR 材质流程中');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Verify cached in localStorage
      const cached = localStorage.getItem('maobu_ai_ctx_blender_roughness');
      expect(cached).not.toBeNull();
      expect(JSON.parse(cached!).examples[0].en).toBe(res?.examples[0].en);

      // Second call without bypassCache should hit localStorage without calling fetch
      const cachedRes = await tauriService.fetchAiWordContext(
        'roughness',
        '粗糙度',
        mockLlmConfig,
        'blender'
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(cachedRes?.examples[0].en).toBe(res?.examples[0].en);

      // Third call with bypassCache should call fetch again
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: mockRawContent } }],
        }),
      } as any);
      await tauriService.fetchAiWordContext(
        'roughness',
        '粗糙度',
        mockLlmConfig,
        'blender',
        true
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('gracefully handles fetch failure or invalid JSON without crashing', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
      const res = await tauriService.fetchAiWordContext('roughness', '粗糙度', mockLlmConfig);
      expect(res).toBeNull();
    });
  });

  describe('SearchPanel AI Context UI Integration', () => {
    const settingsWithLlm: AppSettings = {
      ...DEFAULT_SETTINGS,
      llmConfig: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-active-key',
        endpoint: 'https://api.openai.com/v1',
      },
    };

    const mockWordResult: TextQueryResponse = {
      original: 'specular',
      wordDetail: {
        phoneticUs: '/ ˈspɛkjələr /',
        phoneticUk: '[ ˈspɛkjʊlə ]',
        pos: 'adj. / n.',
        definition: '镜面的；高光反射',
        examples: [
          'The specular highlight depends on the light source angle.',
          '镜面高光取决于光源角度。',
        ],
        cgDomainNote: 'CG 材质 [BLENDER]',
      },
      results: [
        { engineName: 'Blender 内置词典', translated: '镜面反射', sourceTier: 'Preset Dictionary' },
      ],
    };

    it('renders unconfigured guide banner and triggers onOpenSettings when LLM not configured', async () => {
      const handleOpenSettings = vi.fn();
      vi.spyOn(tauriService, 'cmdQueryText').mockResolvedValue(mockWordResult);
      vi.spyOn(tauriService, 'cmdGetHistory').mockResolvedValue([]);

      render(<SearchPanel settings={DEFAULT_SETTINGS} onOpenSettings={handleOpenSettings} />);

      const input = screen.getByPlaceholderText(/输入词条、CG 材质术语或短语/);
      fireEvent.change(input, { target: { value: 'specular' } });
      fireEvent.click(screen.getByRole('button', { name: /查询词条/ }));

      await waitFor(() => {
        expect(screen.getByText('连接 AI 大模型，即可自动解锁专业地道例句、高频短语搭配与深度语境辨析')).toBeInTheDocument();
      });

      const guideBanner = screen.getByText('连接 AI 大模型，即可自动解锁专业地道例句、高频短语搭配与深度语境辨析').closest('button');
      expect(guideBanner).not.toBeNull();
      fireEvent.click(guideBanner!);
      expect(handleOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('renders AI context cards and handles collocation drill-down search', async () => {
      vi.spyOn(tauriService, 'cmdQueryText').mockResolvedValue(mockWordResult);
      vi.spyOn(tauriService, 'cmdGetHistory').mockResolvedValue([]);

      // Mock fetchAiWordContext
      const mockAiContext = {
        examples: [
          { en: 'Adjust the specular value for glass material.', zh: '调节玻璃材质的高光值。' },
          { en: 'Specular reflection creates direct highlights.', zh: '镜面反射会产生直射高光。' },
        ],
        collocations: [
          { phrase: 'specular highlight', trans: '镜面高光' },
          { phrase: 'specular map', trans: '高光贴图' },
        ],
        usageTip: '在 Blender 原理化 BSDF 中，高光度控制菲涅尔反射强弱。',
        modelUsed: 'gpt-4o',
        timestamp: Date.now(),
      };
      vi.spyOn(tauriService, 'fetchAiWordContext').mockResolvedValue(mockAiContext);

      render(<SearchPanel settings={settingsWithLlm} />);

      const input = screen.getByPlaceholderText(/输入词条、CG 材质术语或短语/);
      fireEvent.change(input, { target: { value: 'specular' } });
      fireEvent.click(screen.getByRole('button', { name: /查询词条/ }));

      // Rich AI context should render
      await waitFor(() => {
        expect(screen.getByText('调节玻璃材质的高光值。')).toBeInTheDocument();
      });

      expect(screen.getByText('镜面高光')).toBeInTheDocument();
      expect(screen.getByText('高光贴图')).toBeInTheDocument();
      expect(screen.getByText(/在 Blender 原理化 BSDF 中/)).toBeInTheDocument();

      // Click collocation chip "specular highlight"
      const chipBtn = screen.getByTitle('查询短语: specular highlight');
      expect(chipBtn).toBeInTheDocument();
      fireEvent.click(chipBtn);

      // Input value should update to 'specular highlight'
      await waitFor(() => {
        expect((input as HTMLInputElement).value).toBe('specular highlight');
      });
    });
  });
});

