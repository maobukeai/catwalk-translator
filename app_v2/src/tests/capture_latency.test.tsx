import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { memoKey, memoPut } from '../components/Overlay/translationMemo';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createMockIpcHarness } from './harness/tauriIpcMock';
import type { OverlayResult, TranslationResult } from '../services/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function layout(phrases: string[]): OverlayResult {
  return {
    selectionX: 100, selectionY: 100, selectionW: 600, selectionH: 400,
    blocks: phrases.map((original, index) => ({
      original, translated: '', sourceTier: 'OCR',
      logicalX: 100, logicalY: 100 + index * 35, logicalW: 200, logicalH: 24,
      bgCss: '#202020', fgCss: '#ffffff',
    })),
  };
}

function translations(phrases: string[]): TranslationResult[] {
  return phrases.map((original) => ({ original, translated: `译文 ${original}`, sourceTier: 'Online' }));
}

const originalSettings = useSettingsStore.getState().settings;

function wire(ocr: () => Promise<OverlayResult>, translate: (phrases: string[]) => Promise<TranslationResult[]>) {
  const harness = createMockIpcHarness();
  const fallback = harness.invokeMock.getMockImplementation()!;
  harness.invokeMock.mockImplementation((cmd: string, args?: any) => {
    if (cmd === 'cmd_begin_capture') return Promise.resolve({ width: 1920, height: 1080, scaleFactor: 1 });
    if (cmd === 'cmd_show_overlay' || cmd === 'cmd_close_overlay') return Promise.resolve();
    if (cmd === 'cmd_region_ocr_layout') return ocr();
    if (cmd === 'cmd_translate_phrases_styled') return translate(args.phrases);
    return fallback(cmd, args);
  });
  (window as any).__TAURI_INTERNALS__ = {};
  return harness;
}

async function open() {
  const rendered = render(<CaptureOverlay isOpen onClose={vi.fn()} />);
  // The idle screen also uses a crosshair; finish capture/show IPC before
  // sending the drag, otherwise the idle phase deliberately ignores it.
  await act(async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); });
  await waitFor(() => expect(rendered.container.querySelector<HTMLElement>('.fixed.inset-0')?.style.cursor).toBe('crosshair'));
  return rendered;
}

function select() {
  const target = document.querySelector('.fixed.inset-0')!;
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(target, { clientX: 700, clientY: 500 });
  fireEvent.mouseUp(target);
}

describe('screenshot latency and stalled requests', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: {
      ...originalSettings, captureReleaseAction: 'auto', overlayViewMode: 'cover',
      enableLlmProgressiveRefine: true, llmConfigs: [], llmConfig: null,
      defaultPreset: 'blender', captureEngine: 'auto', translationStyle: 'literal', customDictItems: [],
    } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as any).__TAURI_INTERNALS__;
    useSettingsStore.setState({ settings: originalSettings });
  });

  it('displays completed translations while another batch still waits', async () => {
    const phrases = Array.from({ length: 8 }, (_, index) => `Latency sentence ${index}`);
    const pending = deferred<TranslationResult[]>();
    wire(async () => layout(phrases), async (batch) => batch.includes(phrases[0]) ? pending.promise : translations(batch));
    const { container } = await open();
    select();
    await screen.findByText(`译文 ${phrases[4]}`);
    expect(screen.queryByText(`译文 ${phrases[0]}`)).toBeNull();
    expect(container.querySelectorAll('.overlay-shimmer')).toHaveLength(4);
    await act(async () => { pending.resolve(translations(phrases.slice(0, 4))); await pending.promise; });
    await screen.findByText(`译文 ${phrases[0]}`);
    expect(container.querySelector('.overlay-shimmer')).toBeNull();
  });

  it('displays memo hits immediately without waiting for misses', async () => {
    const phrases = ['Cached screenshot sentence', 'Pending screenshot sentence'];
    const settings = useSettingsStore.getState().settings;
    const cached = translations([phrases[0]])[0];
    memoPut(memoKey(phrases[0], 'auto', 'blender', settings.translationStyle, ''), cached);
    const pending = deferred<TranslationResult[]>();
    const translate = vi.fn(() => pending.promise);
    wire(async () => layout(phrases), translate);
    await open();
    select();
    await screen.findByText(cached.translated);
    expect(translate).toHaveBeenCalledWith([phrases[1]]);
    await act(async () => { pending.resolve(translations([phrases[1]])); await pending.promise; });
  });

  it('ends a stalled translation with a retry button and ignores its late result', async () => {
    const phrase = 'Stalled screenshot sentence';
    const pending = deferred<TranslationResult[]>();
    wire(async () => layout([phrase]), () => pending.promise);
    const { container } = await open();
    vi.useFakeTimers();
    select();
    await act(async () => {});
    expect(container.querySelector('.overlay-shimmer')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(12_100); });
    expect(container.querySelector('.overlay-shimmer')).toBeNull();
    expect(screen.getByRole('button', { name: '重试此段翻译' })).toBeInTheDocument();
    await act(async () => { pending.resolve(translations([phrase])); await pending.promise; });
    expect(screen.queryByText(`译文 ${phrase}`)).toBeNull();
  });

  it('does not let a late first translation replace a newly selected engine', async () => {
    const phrase = 'Switch engine screenshot sentence';
    const pending = deferred<TranslationResult[]>();
    const harness = wire(async () => layout([phrase]), () => pending.promise);
    const fallback = harness.invokeMock.getMockImplementation()!;
    harness.invokeMock.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'cmd_universal_translate') return Promise.resolve({
        original: phrase, detectedLang: 'en', mainTranslation: '新的 Google 译文',
        engines: [{ translated: '新的 Google 译文', sourceTier: 'Google', engineName: 'Google' }],
      });
      return fallback(cmd, args);
    });
    await open();
    select();
    const engine = await screen.findByTitle('切换翻译引擎 (Tab)');
    fireEvent.change(engine, { target: { value: 'google' } });
    await screen.findByText('新的 Google 译文');
    await act(async () => { pending.resolve(translations([phrase])); await pending.promise; });
    expect(screen.getByText('新的 Google 译文')).toBeInTheDocument();
    expect(screen.queryByText(`译文 ${phrase}`)).toBeNull();
  });

  it('uses the configured paid online channel for the first screenshot and its retry', async () => {
    const phrase = 'Configured screenshot channel sentence';
    useSettingsStore.setState({ settings: {
      ...useSettingsStore.getState().settings,
      captureEngine: 'deepl', deeplApiKey: 'test-key', deeplCustomUrl: 'https://example.test/v2/translate',
      onlineEngines: { deepl: true },
    } });
    const styled = vi.fn(async (batch: string[]) => translations(batch));
    const harness = wire(async () => layout([phrase]), styled);
    const fallback = harness.invokeMock.getMockImplementation()!;
    let calls = 0;
    harness.invokeMock.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'cmd_universal_translate') {
        calls += 1;
        expect(args.req).toMatchObject({ forcedEngine: 'deepl', deeplApiKey: 'test-key', deeplCustomUrl: 'https://example.test/v2/translate' });
        return Promise.resolve({ original: phrase, detectedLang: 'en', mainTranslation: calls === 1 ? '' : '付费通道重试译文',
          engines: calls === 1 ? [] : [{ translated: '付费通道重试译文', sourceTier: 'DeepL', engineName: 'DeepL' }],
        });
      }
      return fallback(cmd, args);
    });
    await open();
    select();
    fireEvent.click(await screen.findByRole('button', { name: '重试此段翻译' }));
    await screen.findByText('付费通道重试译文');
    expect(calls).toBe(2);
    expect(styled).not.toHaveBeenCalled();
  });

  it('clears the previous language when retranslation fails instead of keeping stale text', async () => {
    const phrase = 'Failed language switch screenshot sentence';
    let calls = 0;
    wire(async () => layout([phrase]), async (batch) => {
      calls += 1;
      return calls === 1 ? translations(batch) : [];
    });
    await open();
    select();
    await screen.findByText(`译文 ${phrase}`);
    fireEvent.change(screen.getByTitle('切换目标语种'), { target: { value: 'ja' } });
    await screen.findByRole('button', { name: '重试此段翻译' });
    expect(screen.queryByText(`译文 ${phrase}`)).toBeNull();
    expect(screen.getByTitle('切换目标语种')).toHaveValue('ja');
  });

  it('returns from stalled OCR with an actionable retry instead of spinning forever', async () => {
    const pending = deferred<OverlayResult>();
    wire(() => pending.promise, async (batch) => translations(batch));
    const { container } = await open();
    vi.useFakeTimers();
    select();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    expect(screen.queryByTestId('processing-label')).toBeNull();
    expect(screen.getByTestId('action-toast')).toHaveTextContent('文字识别超时');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    await act(async () => { pending.resolve(layout(['Too late OCR'])); await pending.promise; });
    expect(container.querySelector('.overlay-block')).toBeNull();
  });

  it('ignores a smart snap that returns after the capture has been reopened', async () => {
    const pending = deferred<{ x: number; y: number; width: number; height: number }>();
    const ocr = vi.fn(async () => layout(['New selection']));
    const harness = wire(ocr, async (batch) => translations(batch));
    const fallback = harness.invokeMock.getMockImplementation()!;
    harness.invokeMock.mockImplementation((cmd: string, args?: any) => cmd === 'cmd_snap_region'
      ? pending.promise : fallback(cmd, args));
    const { rerender, container } = await open();
    fireEvent.doubleClick(container.querySelector('.fixed.inset-0')!, { clientX: 140, clientY: 160 });
    await waitFor(() => expect(harness.invokeMock).toHaveBeenCalledWith('cmd_snap_region', expect.anything()));
    rerender(<CaptureOverlay isOpen={false} onClose={vi.fn()} />);
    rerender(<CaptureOverlay isOpen onClose={vi.fn()} />);
    await act(async () => { pending.resolve({ x: 50, y: 50, width: 150, height: 100 }); await pending.promise; });
    expect(ocr).not.toHaveBeenCalled();
    expect(container.querySelector('.overlay-block')).toBeNull();
  });

  it('keeps AI refinement active across a watch poll with an unchanged frame', async () => {
    const phrase = 'Unchanged watched screenshot sentence';
    const pending = deferred<Record<string, string>>();
    useSettingsStore.setState({ settings: {
      ...useSettingsStore.getState().settings,
      llmConfigs: [{ id: 'local', provider: 'Local', model: 'test', apiKey: '', endpoint: 'http://localhost:11434/v1' }],
    } });
    const frame = layout([phrase]);
    const harness = wire(async () => frame, async (batch) => translations(batch));
    const fallback = harness.invokeMock.getMockImplementation()!;
    harness.invokeMock.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'cmd_llm_batch_refine') return pending.promise;
      if (cmd === 'cmd_watch_tick') return Promise.resolve(frame);
      return fallback(cmd, args);
    });
    await open();
    select();
    await screen.findByText(/AI 正在深度润色精翻/);
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW' });
    await act(async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); });
    await act(async () => { pending.resolve({ [phrase]: '监控期间完成的精翻' }); await pending.promise; });
    expect(screen.getByText('监控期间完成的精翻')).toBeInTheDocument();
    expect(screen.queryByText(/AI 正在深度润色精翻/)).toBeNull();
  });
});
