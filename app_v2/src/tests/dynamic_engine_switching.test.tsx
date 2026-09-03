import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import { SnippingToolbar } from '../components/Overlay/SnippingToolbar';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import type { AppSettings, UniversalTranslationResponse, OverlayResult } from '../services/types';
import * as tauriService from '../services/tauri';

describe('Dynamic Engine Switching and Online Channels Persistence Test Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── 1. useSettingsStore Online Engine Persistence ────────────────────────────
  it('setOnlineEngineToggle auto-persists to disk via debouncedSaveSettings within 300ms', async () => {
    const saveSpy = vi.spyOn(tauriService, 'cmdSaveSettings').mockResolvedValue();

    const store = useSettingsStore.getState();
    expect(store.settings.onlineEngines?.deepl).toBeFalsy();

    // Toggle DeepL on
    act(() => {
      useSettingsStore.getState().setOnlineEngineToggle('deepl', true);
    });

    expect(useSettingsStore.getState().settings.onlineEngines?.deepl).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();

    // Advance timer by 350ms to trigger debounce
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        onlineEngines: expect.objectContaining({ deepl: true }),
      })
    );
  });

  it('setAllOnlineEngines auto-persists to disk via debouncedSaveSettings within 300ms', async () => {
    const saveSpy = vi.spyOn(tauriService, 'cmdSaveSettings').mockResolvedValue();

    act(() => {
      useSettingsStore.getState().setAllOnlineEngines('all');
    });

    const engines = useSettingsStore.getState().settings.onlineEngines;
    expect(engines?.deepl).toBe(true);
    expect(engines?.baidu).toBe(true);
    expect(engines?.bing).toBe(true);
    expect(engines?.google).toBe(true);

    expect(saveSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        onlineEngines: expect.objectContaining({
          deepl: true,
          baidu: true,
          bing: true,
        }),
      })
    );
  });

  // ── 2. DualPaneTranslator Dynamic Channels ───────────────────────────────────
  it('DualPaneTranslator dynamically reads enabled channels from settings.onlineEngines and omits unconfigured engines', async () => {
    vi.useRealTimers();
    const customSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      deeplApiKey: 'mock-deepl-key',
      baiduAppId: 'mock-baidu-id',
      baiduSecret: 'mock-baidu-secret',
      onlineEngines: {
        google: true,
        bing: true,
        youdao: false,
        deepl: true,
        baidu: true,
        myMemory: false,
        tencent: false,
      },
    };

    const { unmount } = render(<DualPaneTranslator settings={customSettings} initialText="" />);

    // Placeholder tabs should include configured and enabled channels: Google, Bing, DeepL, 百度
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('Bing')).toBeTruthy();
    expect(screen.getByText('DeepL')).toBeTruthy();
    expect(screen.getByText('百度')).toBeTruthy();
    // Disabled channels should not appear in placeholder tabs
    expect(screen.queryByText('有道')).toBeNull();
    expect(screen.queryByText('MyMemory')).toBeNull();
    expect(screen.queryByText('腾讯')).toBeNull();

    unmount();

    // When unconfigured, DeepL, Baidu, and LLM should NOT appear in placeholder tabs
    const unconfiguredSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      llmConfig: {
        provider: 'DeepSeek',
        apiKey: '',
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/v1',
      },
      deeplApiKey: '',
      deeplCustomUrl: '',
      baiduAppId: '',
      baiduSecret: '',
      onlineEngines: {
        google: true,
        bing: true,
        youdao: false,
        deepl: true,
        baidu: true,
        myMemory: false,
        tencent: false,
      },
    };

    render(<DualPaneTranslator settings={unconfiguredSettings} initialText="" />);
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('Bing')).toBeTruthy();
    expect(screen.queryByText('DeepL')).toBeNull();
    expect(screen.queryByText('百度')).toBeNull();
    expect(screen.queryByText('DeepSeek 深度翻译')).toBeNull();
  });

  // ── 3. SnippingToolbar Categorized Dynamic Optgroups ─────────────────────────
  it('SnippingToolbar shares engineOptions source: full model pool, enabled online channels and enabled dicts', () => {
    vi.useRealTimers();
    const customSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      llmConfigs: [
        { id: '1', provider: 'DeepSeek', model: 'deepseek-chat', apiKey: 'sk-test-deepseek', endpoint: 'https://api.deepseek.com/v1' },
        { id: '2', provider: 'OpenAI', model: 'gpt-4o-mini', apiKey: 'sk-test-openai', endpoint: 'https://api.openai.com/v1' },
        { id: '3', provider: 'CustomUnconfigured', model: 'custom-none', apiKey: '', endpoint: '' },
      ],
      onlineEngines: {
        google: true,
        bing: true,
        youdao: true,
        deepl: true,
        baidu: true,
        myMemory: false,
        tencent: false,
      },
      presetDicts: {
        blender: true,
        substance: true,
        unity: false,
        unreal: false,
        maya: true,
        houdini: false,
      },
    };

    const handleSelectEngine = vi.fn();

    render(
      <SnippingToolbar
        activeTool={null}
        onSelectTool={() => {}}
        onTranslate={() => {}}
        onOcr={() => {}}
        onUndo={() => {}}
        canUndo={false}
        onPin={() => {}}
        isPinned={false}
        onSave={() => {}}
        onCopy={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        selectedEngine="auto"
        onSelectEngine={handleSelectEngine}
        settings={customSettings}
      />
    );

    const select = screen.getByTitle('切换翻译引擎 (Tab)') as HTMLSelectElement;
    expect(select).toBeTruthy();

    // Verify AI group with configured models（仅已配置 Key 的模型会展示，未配置的不出现）
    expect(screen.getByText('🤖 DeepSeek (deepseek-chat)')).toBeTruthy();
    expect(screen.getByText('🤖 OpenAI (gpt-4o-mini)')).toBeTruthy();
    expect(screen.queryByText(/CustomUnconfigured/)).toBeNull();

    // Verify Online group with enabled channels only
    expect(screen.getByText('🚀 DeepL 深度翻译')).toBeTruthy();
    expect(screen.getByText('🐯 百度通用翻译')).toBeTruthy();
    expect(screen.getByText('🌐 Google 官方翻译 (免 Key 极速)')).toBeTruthy();
    expect(screen.queryByText('📚 MyMemory 记忆库')).toBeNull();
    expect(screen.queryByText('🐧 腾讯交互翻译')).toBeNull();

    // Trigger engine switch
    fireEvent.change(select, { target: { value: 'deepl' } });
    expect(handleSelectEngine).toHaveBeenCalledWith('deepl');
  });

  // ── 4. CaptureOverlay In-Place Dynamic Retranslation ─────────────────────────
  it('CaptureOverlay retranslates all cards in-place with forcedEngine when engine is switched in SnippingToolbar', async () => {
    vi.useRealTimers();

    const mockLayout: OverlayResult = {
      blocks: [
        {
          original: 'Subsurface Scattering',
          translated: '次表面散射',
          sourceTier: 'blender',
          logicalX: 50,
          logicalY: 50,
          logicalW: 150,
          logicalH: 30,
          bgCss: '#1a1a1a',
          fgCss: '#ffffff',
        },
      ],
      selectionX: 10,
      selectionY: 10,
      selectionW: 200,
      selectionH: 100,
    };

    vi.spyOn(tauriService, 'isTauri').mockReturnValue(true);
    vi.spyOn(tauriService, 'cmdBeginCapture').mockResolvedValue({
      dataUrl: 'data:image/png;base64,mock',
      width: 1920,
      height: 1080,
      scaleFactor: 1.0,
    });
    const showOverlaySpy = vi.spyOn(tauriService, 'cmdShowOverlay').mockResolvedValue();
    vi.spyOn(tauriService, 'cmdRegionImage').mockResolvedValue('fakebase64');
    vi.spyOn(tauriService, 'cmdRegionOcrLayout').mockResolvedValue(mockLayout);
    vi.spyOn(tauriService, 'cmdTranslatePhrasesStyled').mockResolvedValue([
      { original: 'Subsurface Scattering', translated: '次表面散射', sourceTier: 'blender' },
    ]);

    const translateSpy = vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue({
      original: 'Subsurface Scattering',
      detectedLang: 'en',
      mainTranslation: '次表面散射 (DeepL通道)',
      engines: [
        {
          engineName: 'DeepL 极速通道',
          translated: '次表面散射 (DeepL通道)',
          sourceTier: 'Online Fallback',
        },
      ],
    });

    render(<CaptureOverlay isOpen={true} onClose={() => {}} />);
    await waitFor(() => expect(showOverlaySpy).toHaveBeenCalled());

    // Fast-forward into overlay phase by triggering selection
    const rootContainer = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(rootContainer).toBeTruthy();
    fireEvent.mouseDown(rootContainer, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(rootContainer, { clientX: 200, clientY: 100 });
    fireEvent.mouseUp(rootContainer);

    // If in adjust mode, press Enter to confirm selection
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });

    // Wait for card to appear
    await waitFor(() => {
      expect(screen.getByText('次表面散射')).toBeTruthy();
    });

    // Find the engine dropdown on SnippingToolbar
    const select = screen.getByTitle('切换翻译引擎 (Tab)') as HTMLSelectElement;
    expect(select).toBeTruthy();

    // Switch engine to deepl
    fireEvent.change(select, { target: { value: 'deepl' } });

    // Verify cmdUniversalTranslate was called with forcedEngine: 'deepl'
    await waitFor(() => {
      expect(translateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Subsurface Scattering',
          forcedEngine: 'deepl',
        })
      );
    });

    // Card should now display retranslated text
    await waitFor(() => {
      expect(screen.getByText('次表面散射 (DeepL通道)')).toBeTruthy();
    });
  });
});
