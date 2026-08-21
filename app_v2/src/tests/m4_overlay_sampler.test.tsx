import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { cmdSampleColors, cmdRegionOcrTranslate } from '../services/tauri';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { OverlayBlock } from '../services/types';

const MOCK_PAYLOAD = { width: 1920, height: 1080, scaleFactor: 1.0 };
const BASE = ['cmd_begin_capture', 'cmd_show_overlay', 'cmd_close_overlay'] as const;
function wireMock(handler: (cmd: string) => any) {
  (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string): any => {
    if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
    if (BASE.some(k => k === cmd)) return Promise.resolve(undefined);
    return handler(cmd);
  });
}

// Mouse the real .fixed.inset-0 container (where onMouseDown/Move/Up live).
async function mouseSelection() {
  const container = document.querySelector('.fixed.inset-0')!;
  fireEvent.mouseDown(container, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.mouseMove(container, { clientX: 400, clientY: 200 });
  fireEvent.mouseUp(container);
  // v2.4: release freezes the rect into adjust mode — confirm with Enter
  fireEvent(window, new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
}

describe('M4 overlay and sampler coverage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('renders selecting guidance when the overlay opens', async () => {
    createMockIpcHarness();
    wireMock(() => Promise.resolve(undefined));
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    expect(await screen.findByText(/猫步划词/)).toBeInTheDocument();
    expect(screen.getByTitle(/按住鼠标左键划框/)).toBeInTheDocument();
    expect(screen.getByTitle(/退出划词/)).toBeInTheDocument();
  });

  it('shows processing state after a selection completes', async () => {
    createMockIpcHarness();
    // Simulate a stage-1 OCR that takes a moment so the processing UI is observable
    wireMock((cmd: string) => {
      if (cmd === 'cmd_region_ocr_layout') {
        return new Promise((res) => setTimeout(() => res({
          blocks: [], selectionX: 0, selectionY: 0, selectionW: 400, selectionH: 100,
        }), 300));
      }
      return Promise.resolve(undefined);
    });
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await mouseSelection();
    await waitFor(() => {
      expect(screen.getByTestId('processing-label')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('renders overlay blocks at in-place coordinates and supports drag repositioning', async () => {
    const layoutBlock: OverlayBlock = {
      original: 'BSDF',
      translated: '',
      sourceTier: 'OCR',
      logicalX: 100,
      logicalY: 80,
      logicalW: 120,
      logicalH: 22,
      bgCss: 'rgb(20,24,30)',
      fgCss: '#FFFFFF',
    };

    createMockIpcHarness();
    wireMock((cmd: string) => {
      if (cmd === 'cmd_region_ocr_layout') {
        return Promise.resolve({
          blocks: [layoutBlock], selectionX: 0, selectionY: 0, selectionW: 400, selectionH: 200,
        });
      }
      if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') {
        return Promise.resolve([
          { original: 'BSDF', translated: 'BSDF 材质', sourceTier: 'preset' },
        ]);
      }
      return Promise.resolve(undefined);
    });
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await mouseSelection();
    const cardText = await screen.findByText('BSDF 材质');
    expect(cardText).toBeInTheDocument();
    const card = cardText.closest('.overlay-block') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.className).toContain('overlay-block');
    // left/top are directly aligned with logicalX/logicalY (pos.x / pos.y) without extra offset
    const beforeLeft = (card as HTMLElement).style.left;
    const beforeTop = (card as HTMLElement).style.top;
    expect(beforeLeft).toBe('100px');
    expect(beforeTop).toBe('80px');
    fireEvent.mouseDown(card, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.mouseMove(card, { clientX: 260, clientY: 240 });
    fireEvent.mouseUp(card);
    // RTL auto-wraps events in act; re-read position after the state settle.
    const afterLeft = (card as HTMLElement).style.left;
    const afterTop = (card as HTMLElement).style.top;
    const dx = parseFloat(afterLeft) - parseFloat(beforeLeft);
    const dy = parseFloat(afterTop) - parseFloat(beforeTop);
    // dragging must move the card by the mouse delta
    expect(dx).toBe(60);
    expect(dy).toBe(40);
  });

  it('shows empty notice when OCR returns no blocks and returns to selecting', async () => {
    createMockIpcHarness();
    wireMock(() => Promise.resolve({
      blocks: [], selectionX: 0, selectionY: 0, selectionW: 400, selectionH: 200,
    }));
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await mouseSelection();
    await waitFor(() => {}, { timeout: 2600 });
    expect(await screen.findByText(/未在选区内识别到清晰文本/)).toBeInTheDocument();
  });

  it('uses dark and light text colors for sampled block backgrounds', async () => {
    const layoutBlocks: OverlayBlock[] = [
      { original: 'dark', translated: '', sourceTier: 'OCR', logicalX: 10, logicalY: 10, logicalW: 80, logicalH: 20, bgCss: 'rgb(20,24,30)', fgCss: '#FFFFFF' },
      { original: 'light', translated: '', sourceTier: 'OCR', logicalX: 120, logicalY: 10, logicalW: 80, logicalH: 20, bgCss: 'rgb(230,232,236)', fgCss: '#000000' },
    ];

    createMockIpcHarness();
    wireMock((cmd: string) => {
      if (cmd === 'cmd_region_ocr_layout') {
        return Promise.resolve({ blocks: layoutBlocks, selectionX: 0, selectionY: 0, selectionW: 400, selectionH: 200 });
      }
      if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') {
        return Promise.resolve([
          { original: 'dark', translated: '白字', sourceTier: 'mock' },
          { original: 'light', translated: '黑字', sourceTier: 'mock' },
        ]);
      }
      return Promise.resolve(undefined);
    });
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await mouseSelection();
    expect(await screen.findByText('白字')).toBeInTheDocument();
    expect(await screen.findByText('黑字')).toBeInTheDocument();
  });

  it('cmdSampleColors returns color samples via the browser fallback path', async () => {
    // browser fallback (no __TAURI_INTERNALS__) returns the deterministic mock sample
    const samples = await cmdSampleColors(new Uint8Array([255, 0, 0, 255]), [
      { x: 10, y: 20, width: 80, height: 30 },
    ]);
    expect(samples.length).toBe(1);
    expect(samples[0].boxRect).toEqual({ x: 10, y: 20, width: 80, height: 30 });
    expect(samples[0].backgroundRgb).toEqual([30, 30, 35]);
    expect(samples[0].textColor).toBe('#FFFFFF');
  });

  it('cmdRegionOcrTranslate falls back to structured overlay result outside Tauri', async () => {
    delete (window as any).__TAURI_INTERNALS__;
    const result = await cmdRegionOcrTranslate({ x: 5, y: 5, width: 120, height: 40 }, 1.0, 'blender');
    expect(result.blocks.length).toBe(1);
    expect(result.blocks[0].translated).toContain('原理化 BSDF');
    expect(result.selectionX).toBe(5);
    expect(result.selectionW).toBe(120);
  });
});
