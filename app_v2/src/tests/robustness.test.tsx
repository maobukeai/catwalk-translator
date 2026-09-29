import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { OverlayResult } from '../services/types';

const MOCK_PAYLOAD = { width: 1920, height: 1080, scaleFactor: 1.0 };
const BASE_CMDS = ['cmd_show_overlay', 'cmd_close_overlay'] as const;

const STANDARD_LAYOUT: OverlayResult = {
  blocks: [
    {
      original: 'Roughness',
      translated: '',
      sourceTier: 'OCR',
      logicalX: 110,
      logicalY: 105,
      logicalW: 140,
      logicalH: 24,
      bgCss: 'rgb(30,30,30)',
      fgCss: '#ffffff',
    },
  ],
  selectionX: 100,
  selectionY: 100,
  selectionW: 300,
  selectionH: 100,
};

type Ctx = { layoutImpl?: (args: any) => any; watchImpl?: (args: any) => any };

function wireHarness(ctx: Ctx = {}) {
  const calls: Array<{ cmd: string; args: any }> = [];
  (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string, args?: any): any => {
    calls.push({ cmd, args });
    if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
    if (BASE_CMDS.some((k) => k === cmd)) return Promise.resolve(undefined);
    if (cmd === 'cmd_region_image') return Promise.resolve('');
    if (cmd === 'cmd_watch_tick' && ctx.watchImpl) return ctx.watchImpl(args);
    if (cmd === 'cmd_region_ocr_layout' || cmd === 'cmd_watch_tick') {
      const impl = ctx.layoutImpl;
      if (impl) return impl(args);
      return Promise.resolve({ ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] });
    }
    if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') {
      return Promise.resolve([
        { original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset (BLENDER)' },
      ]);
    }
    return Promise.resolve(undefined);
  });
  return calls;
}

function countCmd(calls: Array<{ cmd: string }>, cmd: string) {
  return calls.filter((c) => c.cmd === cmd).length;
}

const container = () => document.querySelector('.fixed.inset-0') as HTMLElement;

async function selectAndConfirm() {
  fireEvent.mouseDown(container(), { clientX: 100, clientY: 100, button: 0 });
  fireEvent.mouseMove(container(), { clientX: 400, clientY: 200 });
  fireEvent.mouseUp(container());
  fireEvent(window, new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
}

function pressKey(key: string, code: string, init: KeyboardEventInit = {}) {
  fireEvent(window, new KeyboardEvent('keydown', { key, code, bubbles: true, ...init }));
}

async function openWithResult(ctx: Ctx = {}) {
  const calls = wireHarness(ctx);
  (window as any).__TAURI_INTERNALS__ = {};
  const onClose = vi.fn();
  render(<CaptureOverlay isOpen={true} onClose={onClose} />);
  await screen.findByText(/猫步划词/);
  await waitFor(() => expect(container()?.style?.cursor).toBe('crosshair'));
  await selectAndConfirm();
  const confirmBtn = screen.queryByTestId('adjust-confirm-btn') || screen.queryByTestId('btn-tool-confirm');
  if (confirmBtn) {
    fireEvent.click(confirmBtn);
  }
  await screen.findByText('粗糙度');
  return { calls, onClose };
}

describe('overlay robustness (copy / misclick / retry / escape / context menu / watch)', () => {
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1080, width: 1920, height: 1080,
      toJSON: () => ({}),
    } as DOMRect);
    // JSDOM has no async clipboard API — copyTextSafely awaits writeText
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  beforeEach(() => {
    createMockIpcHarness();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        captureReleaseAction: 'auto',
        overlayViewMode: 'cover',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    window.localStorage.clear();
    useSettingsStore.getState().setWatchIntervalMs(3000);
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        captureReleaseAction: 'auto',
      },
    });
  });

  it('keeps dense prose in the default in-place mode with automatic target language', async () => {
    const proseBlocks = [
      '这轮优化已完成，并重新生成了安装包，我没有替你安装。',
      '原位翻译修复了短译文覆盖长原文时的残字，并加入视觉验收。',
      '验证结果：前端测试通过，桌面安装包构建成功。',
    ].map((original, index) => ({
      ...STANDARD_LAYOUT.blocks[0], original,
      logicalX: 110, logicalY: 105 + index * 28, logicalW: 650, logicalH: 22,
    }));
    wireHarness({ layoutImpl: () => Promise.resolve({
      blocks: proseBlocks, selectionX: 100, selectionY: 100, selectionW: 700, selectionH: 130,
    }) });
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await selectAndConfirm();
    const confirmBtn = screen.queryByTestId('adjust-confirm-btn') || screen.queryByTestId('btn-tool-confirm');
    if (confirmBtn) fireEvent.click(confirmBtn);
    await waitFor(() => expect(document.querySelectorAll('.overlay-block').length).toBe(3));
    expect(document.querySelector('.overlay-panel')).toBeNull();
    expect(screen.getByTitle('切换目标语种')).toHaveValue('auto');
  });

  it('copying all translations keeps the overlay open (no 600ms auto-close)', async () => {
    const { onClose } = await openWithResult();

    pressKey('c', 'KeyC', { ctrlKey: true });
    expect(await screen.findByText(/全部译文已复制/)).toBeInTheDocument();

    // The old behaviour force-closed after 600ms — give it ample time to prove it stays open
    await act(async () => { await new Promise((r) => setTimeout(r, 750)); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('粗糙度')).toBeInTheDocument();
  });

  it('a blank left click no longer wipes the results — it shows a hint instead', async () => {
    await openWithResult();

    fireEvent.mouseDown(container(), { clientX: 700, clientY: 600, button: 0 });
    fireEvent.mouseUp(container());

    expect(await screen.findByText(/按 R 重划上次选区/)).toBeInTheDocument();
    expect(screen.getByText('粗糙度')).toBeInTheDocument();
  });

  it('stage-1 OCR failure surfaces a retry toast; retry re-runs recognition', async () => {
    let fail = false;
    const { calls } = await openWithResult({
      layoutImpl: () => (fail
        ? Promise.reject(new Error('OCR daemon not running'))
        : Promise.resolve({ ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] })),
    });
    // First result already rendered; make the next recognition fail
    await waitFor(() => { expect(countCmd(calls, 'cmd_region_ocr_layout')).toBe(1); });

    fail = true;
    pressKey('r', 'KeyR'); // re-run last region → fails now
    const toast = await screen.findByTestId('action-toast');
    expect(toast.textContent).toContain('识别失败');

    fail = false;
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => { expect(countCmd(calls, 'cmd_region_ocr_layout')).toBe(3); });
    await screen.findByText('粗糙度');
  });

  it('pressing Esc twice within 800ms force-closes even when pinned', async () => {
    const { onClose } = await openWithResult();

    pressKey('p', 'KeyP', { ctrlKey: true }); // pin
    pressKey('Escape', 'Escape');
    expect(await screen.findByText(/再按一次 Esc 强制退出/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    pressKey('Escape', 'Escape');
    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1); });
  });

  it('right-clicking a card opens a context menu instead of closing the overlay', async () => {
    const { onClose } = await openWithResult();

    const card = document.querySelector('.overlay-block') as HTMLElement;
    expect(card).not.toBeNull();
    fireEvent.contextMenu(card, { clientX: 200, clientY: 150 });

    const menu = await screen.findByTestId('card-context-menu');
    expect(menu.textContent).toContain('复制译文');
    expect(menu.textContent).toContain('隐藏此卡片');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('🚫 隐藏此卡片'));
    await waitFor(() => {
      expect(document.querySelector('.overlay-block')).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stage-2 translation failure marks the card with an inline retry that recovers it', async () => {
    let translateFails = true;
    const calls = wireHarness({
      layoutImpl: () => Promise.resolve({ ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] }),
    });
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
      if (cmd === 'cmd_begin_capture') return MOCK_PAYLOAD;
      if (BASE_CMDS.some((k) => k === cmd)) return undefined;
      if (cmd === 'cmd_region_ocr_layout') return { ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] };
      if (cmd === 'cmd_watch_tick') return { ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] };
      if (cmd === 'cmd_region_image') return '';
      if (cmd === 'cmd_translate_phrases_styled') {
        if (translateFails) throw new Error('network down');
        return [{ original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset (BLENDER)' }];
      }
      if (cmd === 'cmd_translate_phrases') {
        return [{ original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset (BLENDER)' }];
      }
      return undefined;
    });
    void calls;
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await selectAndConfirm();

    // Batch translation fails → card context menu shows retry affordance, original kept visible
    expect(await screen.findByText('Roughness')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('Roughness'));
    const retryBtn = await screen.findByText('🔄 重试翻译');
    expect(retryBtn).toBeInTheDocument();

    translateFails = false;
    fireEvent.click(retryBtn);
    await screen.findByText('粗糙度');
  });

  it('does not treat the backend original-text failure sentinel as translated or cacheable', async () => {
    let failed = true;
    wireHarness();
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string): Promise<any> => {
      if (cmd === 'cmd_begin_capture') return MOCK_PAYLOAD;
      if (BASE_CMDS.some((key) => key === cmd)) return undefined;
      if (cmd === 'cmd_region_ocr_layout') return { ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] };
      if (cmd === 'cmd_translate_phrases_styled') return [failed
        ? { original: 'Roughness', translated: 'Roughness', sourceTier: '翻译失败·点击重试' }
        : { original: 'Roughness', translated: '粗糙度', sourceTier: 'Google 官方' }];
      return undefined;
    });
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await waitFor(() => expect(container()?.style?.cursor).toBe('crosshair'));
    await selectAndConfirm();
    const retry = await screen.findByRole('button', { name: '重试此段翻译' });
    expect(screen.getByTestId('pipeline-diagnostics')).toHaveTextContent('1 段翻译失败');
    failed = false;
    fireEvent.click(retry);
    await screen.findByText('粗糙度');
    expect(screen.queryByRole('button', { name: '重试此段翻译' })).not.toBeInTheDocument();
  });

  it('region watch uses the quiet cmd_watch_tick path (no window hide/show cycle)', async () => {
    const { calls } = await openWithResult();
    const beginBefore = countCmd(calls, 'cmd_begin_capture');

    pressKey('w', 'KeyW');
    await waitFor(() => {
      expect(countCmd(calls, 'cmd_watch_tick')).toBeGreaterThanOrEqual(1);
    });
    expect(await screen.findByText(/区域监控中/)).toBeInTheDocument();
    // The legacy flicker path re-ran begin+show every tick — must stay quiet now
    expect(countCmd(calls, 'cmd_begin_capture')).toBe(beginBefore);

    pressKey('w', 'KeyW');
    await screen.findByText(/已停止区域监控/);
  });

  it('treats a resolved but invalid quiet-watch layout as a fallback failure', async () => {
    const { calls } = await openWithResult({ watchImpl: () => Promise.resolve(undefined) });
    const before = countCmd(calls, 'cmd_region_ocr_layout');
    pressKey('w', 'KeyW');
    await waitFor(() => expect(countCmd(calls, 'cmd_watch_tick')).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(countCmd(calls, 'cmd_region_ocr_layout')).toBeGreaterThan(before));
    expect(screen.getByText('粗糙度')).toBeInTheDocument();
    pressKey('w', 'KeyW');
  });

  it('region watch refreshes card geometry when text stays the same but moves', async () => {
    let layoutCall = 0;
    await openWithResult({
      layoutImpl: () => {
        const logicalX = layoutCall++ === 0 ? 110 : 310;
        return Promise.resolve({
          ...STANDARD_LAYOUT,
          blocks: [{ ...STANDARD_LAYOUT.blocks[0], logicalX }],
        });
      },
    });
    const card = document.querySelector('.overlay-block') as HTMLElement;
    expect(card.style.left).toBe('110px');

    pressKey('w', 'KeyW');
    await waitFor(() => {
      expect((document.querySelector('.overlay-block') as HTMLElement).style.left).toBe('310px');
    });
  });

  it('region watch clears stale cards when the watched area becomes empty', async () => {
    let layoutCall = 0;
    await openWithResult({
      layoutImpl: () => Promise.resolve(layoutCall++ === 0
        ? { ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] }
        : { ...STANDARD_LAYOUT, blocks: [] }),
    });
    expect(document.querySelector('.overlay-block')).not.toBeNull();

    pressKey('w', 'KeyW');
    await waitFor(() => {
      expect(document.querySelector('.overlay-block')).toBeNull();
    });
  });

  it('persistent quiet-path failures auto-stop the watch instead of flickering forever', async () => {
    // Shrink the interval so three failures land inside the assertion window
    useSettingsStore.getState().setWatchIntervalMs(1000);
    createMockIpcHarness();
    const calls: Array<{ cmd: string; args: any }> = [];
    (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string, args?: any): any => {
      calls.push({ cmd, args });
      if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
      if (BASE_CMDS.some((k) => k === cmd)) return Promise.resolve(undefined);
      if (cmd === 'cmd_region_image') return Promise.resolve('');
      if (cmd === 'cmd_region_ocr_layout') {
        return Promise.resolve({ ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] });
      }
      if (cmd === 'cmd_watch_tick') {
        return Promise.reject(new Error('quiet capture unavailable'));
      }
      if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') {
        return Promise.resolve([{ original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset (BLENDER)' }]);
      }
      return Promise.resolve(undefined);
    });
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await selectAndConfirm();
    await screen.findByText('粗糙度');

    pressKey('w', 'KeyW');
    await waitFor(() => {
      expect(countCmd(calls, 'cmd_watch_tick')).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });

    // Three consecutive quiet failures → auto-stop with an honest notice
    await waitFor(() => {
      expect(screen.getByText(/静默监控通道不可用/)).toBeInTheDocument();
    }, { timeout: 4500 });
    await waitFor(() => {
      expect(countCmd(calls, 'cmd_watch_tick')).toBeGreaterThanOrEqual(3);
    }, { timeout: 4500 });
  });

  it('cancelling mid-recognition returns to the selection phase and drops the result', async () => {
    createMockIpcHarness();
    const calls = wireHarness({
      layoutImpl: () => new Promise((res) => setTimeout(() => res(
        { ...STANDARD_LAYOUT, blocks: [{ ...STANDARD_LAYOUT.blocks[0] }] } as OverlayResult,
      ), 250)),
    });
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await selectAndConfirm();

    const cancelBtn = await screen.findByTestId('cancel-processing-btn');
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('cancel-processing-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('processing-label')).not.toBeInTheDocument();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    // The late result must not render any cards
    expect(document.querySelector('.overlay-block')).toBeNull();
    void calls;
  });
});
