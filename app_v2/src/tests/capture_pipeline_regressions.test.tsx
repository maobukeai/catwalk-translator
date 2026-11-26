import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { CaptureOverlay, __clearTranslationMemoForTests } from '../components/Overlay/CaptureOverlay';
import { memoGet, memoKey } from '../components/Overlay/translationMemo';
import { shouldRefineCandidate } from '../services/pipelineDiagnostics';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { OverlayResult } from '../services/types';

const BASE_LAYOUT: OverlayResult = {
  blocks: [
    {
      original: 'Open recent project settings',
      translated: '',
      sourceTier: 'OCR',
      logicalX: 110,
      logicalY: 110,
      logicalW: 220,
      logicalH: 24,
      bgCss: 'rgb(28,28,28)',
      fgCss: '#ffffff',
    },
    {
      original: '设置',
      translated: '',
      sourceTier: 'OCR',
      logicalX: 110,
      logicalY: 145,
      logicalW: 60,
      logicalH: 24,
      bgCss: 'rgb(28,28,28)',
      fgCss: '#ffffff',
    },
  ],
  selectionX: 100,
  selectionY: 100,
  selectionW: 360,
  selectionH: 140,
};

describe('Capture translation pipeline regressions', () => {
  beforeEach(() => {
    createMockIpcHarness();
    __clearTranslationMemoForTests();
    useSettingsStore.setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        captureReleaseAction: 'auto',
        enableLlmProgressiveRefine: true,
        customDictItems: [],
        llmConfig: {
          id: 'deepseek-1',
          provider: 'DeepSeek',
          endpoint: 'https://api.deepseek.com/v1/chat/completions',
          apiKey: 'sk-test-1234',
          model: 'deepseek-chat',
          enabled: true,
        },
        llmConfigs: [
          {
            id: 'deepseek-1',
            provider: 'DeepSeek',
            endpoint: 'https://api.deepseek.com/v1/chat/completions',
            apiKey: 'sk-test-1234',
            model: 'deepseek-chat',
            enabled: true,
          },
        ],
      },
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('shouldRefineCandidate skips target-language, dict, identifier, and already AI-refined blocks', () => {
    expect(shouldRefineCandidate({ original: '设置', sourceTier: '目标语言' })).toBe(false);
    expect(shouldRefineCandidate({ original: 'Roughness', sourceTier: 'custom_dict' })).toBe(false);
    expect(shouldRefineCandidate({ original: 'v2.0', sourceTier: '标识符透传' })).toBe(false);
    expect(shouldRefineCandidate({ original: 'Mesh', sourceTier: '离线词库' })).toBe(false);
    expect(shouldRefineCandidate({ original: 'Hello', sourceTier: 'deepseek-chat AI 精翻 ✨' })).toBe(false);
    expect(shouldRefineCandidate({ original: 'Hello', sourceTier: 'AI 精翻 ✨ (DeepSeek)' })).toBe(false);
    expect(shouldRefineCandidate({ original: 'Hello', sourceTier: 'LLM API (DeepSeek)' })).toBe(false);
    expect(shouldRefineCandidate({ original: 'Open settings', sourceTier: 'Online Fallback' })).toBe(true);
    expect(shouldRefineCandidate({ original: 'Open settings', sourceTier: '翻译失败·点击重试' })).toBe(true);
  });

  it('does not hijack main window, updates capture session in place, caches stage-3 AI result, and skips target-lang blocks', async () => {
    const savedSessions: any[] = [];
    const refineCalls: string[][] = [];
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'cmd_begin_capture') return { width: 1920, height: 1080, scaleFactor: 1.0 };
      if (cmd === 'cmd_show_overlay' || cmd === 'cmd_close_overlay') return undefined;
      if (cmd === 'cmd_region_image') return '';
      if (cmd === 'cmd_region_ocr_layout') {
        return { ...BASE_LAYOUT, blocks: BASE_LAYOUT.blocks.map((b) => ({ ...b })) };
      }
      if (cmd === 'cmd_translate_phrases_styled') {
        return [
          { original: 'Open recent project settings', translated: '打开最近项目设置', sourceTier: 'Online Fallback' },
          { original: '设置', translated: '设置', sourceTier: '目标语言' },
        ];
      }
      if (cmd === 'cmd_llm_batch_refine') {
        refineCalls.push(args.phrases);
        return { 'Open recent project settings': '打开最近项目的设置' };
      }
      if (cmd === 'cmd_save_capture_session') {
        savedSessions.push(args.session);
        return undefined;
      }
      return undefined;
    });

    (window as any).__TAURI_INTERNALS__ = {};
    const onSendToMainWindow = vi.fn();
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} onSendToMainWindow={onSendToMainWindow} />);

    await screen.findByText(/猫步划词/);
    const root = document.querySelector('.fixed.inset-0') as HTMLElement;
    await act(async () => {});
    fireEvent.mouseDown(root, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(root, { clientX: 460, clientY: 240 });
    fireEvent.mouseUp(root);

    await screen.findByText('打开最近项目的设置');
    await waitFor(() => expect(savedSessions.length).toBe(2));

    // 1. Main window editor must NOT be overwritten/double-fired automatically
    expect(onSendToMainWindow).not.toHaveBeenCalled();

    // 2. Stage-3 must NOT send "目标语言" blocks back to LLM
    expect(refineCalls).toEqual([['Open recent project settings']]);

    // 3. Stage-2 and Stage-3 must share the exact same session ID so history has no duplicate
    expect(savedSessions[0].id).toBe(savedSessions[1].id);
    expect(savedSessions[1].blocks[0].translated).toBe('打开最近项目的设置');

    // 4. Stage-3 result must be written into TranslationMemo
    const style = useSettingsStore.getState().settings.translationStyle;
    const preset = useSettingsStore.getState().settings.defaultPreset || 'blender';
    const cached = memoGet(memoKey('Open recent project settings', 'auto', preset, style, ''));
    expect(cached?.translated).toBe('打开最近项目的设置');
    expect(cached?.sourceTier).toContain('AI 精翻');
  });

  it('preserves negative virtual-desktop coordinates when pinning from a left/above monitor', async () => {
    const pinPayloads: any[] = [];
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'cmd_begin_capture') return { width: 3840, height: 1080, scaleFactor: 1.0 };
      if (cmd === 'cmd_show_overlay' || cmd === 'cmd_close_overlay') return undefined;
      if (cmd === 'cmd_region_image') return '';
      if (cmd === 'cmd_region_ocr_layout') {
        return {
          ...BASE_LAYOUT,
          blocks: [{ ...BASE_LAYOUT.blocks[0] }],
        };
      }
      if (cmd === 'cmd_translate_phrases_styled') {
        return [{ original: 'Open recent project settings', translated: '打开最近项目设置', sourceTier: 'Bing' }];
      }
      if (cmd === 'cmd_open_pin') {
        pinPayloads.push(args.payload);
        return undefined;
      }
      return undefined;
    });

    vi.spyOn(window, 'screenX', 'get').mockReturnValue(-1920);
    vi.spyOn(window, 'screenY', 'get').mockReturnValue(-120);
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    const root = document.querySelector('.fixed.inset-0') as HTMLElement;
    await act(async () => {});
    fireEvent.mouseDown(root, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(root, { clientX: 460, clientY: 240 });
    fireEvent.mouseUp(root);

    const card = await screen.findByText('打开最近项目设置');
    fireEvent.contextMenu(card);
    const pinSingleBtn = await screen.findByText('📌 贴图此卡片');
    fireEvent.click(pinSingleBtn);

    await waitFor(() => expect(pinPayloads.length).toBe(1));
    expect(pinPayloads[0].x).toBe(-1920 + 110);
    expect(pinPayloads[0].y).toBe(-120 + 110 + 24);
  });
});
