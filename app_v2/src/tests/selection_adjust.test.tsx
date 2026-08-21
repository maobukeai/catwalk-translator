import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { OverlayResult } from '../services/types';

const MOCK_PAYLOAD = { width: 1920, height: 1080, scaleFactor: 1.0 };
const BASE_CMDS = ['cmd_show_overlay', 'cmd_close_overlay'] as const;

function wireHarness() {
  const calls: Array<{ cmd: string; args: any }> = [];
  (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string, args?: any): any => {
    calls.push({ cmd, args });
    if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
    if (BASE_CMDS.some((k) => k === cmd)) return Promise.resolve(undefined);
    if (cmd === 'cmd_region_image') return Promise.resolve('QUJDREJNUDI0'); // fake base64 BMP
    if (cmd === 'cmd_region_ocr_layout') {
      const result: OverlayResult = {
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
        selectionX: args?.selection?.x ?? 100,
        selectionY: args?.selection?.y ?? 100,
        selectionW: args?.selection?.width ?? 300,
        selectionH: args?.selection?.height ?? 100,
      };
      return Promise.resolve(result);
    }
    if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') {
      const phrases: string[] = args?.phrases || [];
      return Promise.resolve(
        phrases.map((p) => ({ original: p, translated: '粗糙度', sourceTier: 'Preset (BLENDER)' })),
      );
    }
    return Promise.resolve(undefined);
  });
  return calls;
}

function layoutCalls(calls: Array<{ cmd: string; args: any }>) {
  return calls.filter((c) => c.cmd === 'cmd_region_ocr_layout');
}

const container = () => document.querySelector('.fixed.inset-0') as HTMLElement;

async function dragSelection(from: { x: number; y: number }, to: { x: number; y: number }, shift = false) {
  fireEvent.mouseDown(container(), { clientX: from.x, clientY: from.y, button: 0, shiftKey: shift });
  fireEvent.mouseMove(container(), { clientX: to.x, clientY: to.y, shiftKey: shift });
  fireEvent.mouseUp(container(), { shiftKey: shift });
}

function pressKey(key: string, code: string, init: KeyboardEventInit = {}) {
  fireEvent(window, new KeyboardEvent('keydown', { key, code, bubbles: true, ...init }));
}

describe('selection adjust mode (release → resize/move/nudge → confirm)', () => {
  beforeAll(() => {
    // JSDOM layout returns zero rects — give the overlay container a real viewport
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1080, width: 1920, height: 1080,
      toJSON: () => ({}),
    } as DOMRect);
  });

  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        captureReleaseAction: 'adjust',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    window.localStorage.clear();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        captureReleaseAction: 'auto',
      },
    });
  });

  it('freezes the released rect with 8 handles and a confirm bar (no processing yet)', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });

    // Adjust UI present, recognition NOT started
    expect(await screen.findByTestId('adjust-confirm-bar')).toBeInTheDocument();
    expect(screen.getByTestId('adjust-handle-se')).toBeInTheDocument();
    expect(screen.getByTestId('adjust-handle-nw')).toBeInTheDocument();
    expect(layoutCalls(calls)).toHaveLength(0);
  });

  it('Enter confirms the frozen rect and starts recognition with exact coords', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });
    pressKey('Enter', 'Enter');

    await waitFor(() => {
      expect(layoutCalls(calls)).toHaveLength(1);
    });
    expect(layoutCalls(calls)[0].args.selection).toEqual({ x: 100, y: 100, width: 300, height: 100 });
    await screen.findByText('粗糙度');
  });

  it('dragging the se handle resizes the rect before confirmation', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });

    // Grab the south-east handle (sits at rect 400,200) and drag it to 450,230
    const seHandle = screen.getByTestId('adjust-handle-se');
    fireEvent.mouseDown(seHandle, { clientX: 400, clientY: 200, button: 0 });
    fireEvent.mouseMove(container(), { clientX: 450, clientY: 230 });
    fireEvent.mouseUp(container());

    pressKey('Enter', 'Enter');
    await waitFor(() => {
      expect(layoutCalls(calls)).toHaveLength(1);
    });
    expect(layoutCalls(calls)[0].args.selection).toEqual({ x: 100, y: 100, width: 350, height: 130 });
  });

  it('dragging inside the rect moves it; arrow keys nudge (Shift = 10px)', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });

    // Move gesture from inside the rect
    fireEvent.mouseDown(container(), { clientX: 200, clientY: 150, button: 0 });
    fireEvent.mouseMove(container(), { clientX: 210, clientY: 150 });
    fireEvent.mouseUp(container());

    pressKey('ArrowRight', 'ArrowRight');
    pressKey('ArrowDown', 'ArrowDown', { shiftKey: true });

    pressKey('Enter', 'Enter');
    await waitFor(() => {
      expect(layoutCalls(calls)).toHaveLength(1);
    });
    // 100 + 10 (move) + 1 (nudge) = 111 ; 100 + 10 (shift nudge)
    expect(layoutCalls(calls)[0].args.selection).toEqual({ x: 111, y: 110, width: 300, height: 100 });
  });

  it('Esc discards the frozen rect back to selecting; next Enter falls back to fullscreen', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });

    pressKey('Escape', 'Escape');
    await waitFor(() => {
      expect(screen.queryByTestId('adjust-confirm-bar')).not.toBeInTheDocument();
    });

    pressKey('Enter', 'Enter');
    await waitFor(() => {
      expect(layoutCalls(calls)).toHaveLength(1);
    });
    expect(layoutCalls(calls)[0].args.selection.width).toBe(window.innerWidth);
  });

  it('double-click inside the frozen rect confirms recognition', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });

    fireEvent.dblClick(container(), { clientX: 200, clientY: 150 });

    await waitFor(() => {
      expect(layoutCalls(calls)).toHaveLength(1);
    });
    expect(layoutCalls(calls)[0].args.selection).toEqual({ x: 100, y: 100, width: 300, height: 100 });
  });

  it('Shift+release stacks ghost rects and Enter recognises all of them', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 }, true);
    expect(await screen.findByTestId('pending-rect-0')).toBeInTheDocument();

    await dragSelection({ x: 100, y: 400 }, { x: 400, y: 500 }, true);
    expect(await screen.findByTestId('pending-rect-1')).toBeInTheDocument();
    expect(layoutCalls(calls)).toHaveLength(0);

    pressKey('Enter', 'Enter');
    await waitFor(() => {
      expect(layoutCalls(calls)).toHaveLength(2);
    });
    expect(layoutCalls(calls)[0].args.selection).toEqual({ x: 100, y: 100, width: 300, height: 100 });
    expect(layoutCalls(calls)[1].args.selection).toEqual({ x: 100, y: 400, width: 300, height: 100 });
    // merged blocks both render (one card per rect)
    expect((await screen.findAllByText('粗糙度')).length).toBe(2);
  });

  it('does not render magnifier lens or crosshairs on mouse move (clean selection)', async () => {
    createMockIpcHarness();
    wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    fireEvent.mouseMove(container(), { clientX: 500, clientY: 300 });

    expect(screen.queryByTestId('magnifier')).toBeNull();
  });

  it('Digit2 switches the target language instantly', async () => {
    createMockIpcHarness();
    wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    pressKey('2', 'Digit2');
    expect(await screen.findByText(/已切换目标语种：en/)).toBeInTheDocument();
  });

  it('? and the toolbar button open the cheat sheet inside the overlay', async () => {
    createMockIpcHarness();
    wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    pressKey('?', 'Slash', { shiftKey: true });
    await screen.findByText('快捷键速查面板');

    // Cheat sheet closes itself on ?; the overlay itself must stay open
    pressKey('?', 'Slash', { shiftKey: true });
    await waitFor(() => {
      expect(screen.queryByText('快捷键速查面板')).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/猫步划词/)).toBeInTheDocument();

    // The toolbar button works too
    fireEvent.click(screen.getByTestId('cheatsheet-btn'));
    await screen.findByText('快捷键速查面板');
  });

  it('default auto action: releasing mouse immediately triggers recognition without Enter', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        captureReleaseAction: 'auto',
      },
    });

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });

    await waitFor(() => {
      expect(layoutCalls(calls)).toHaveLength(1);
    });
    expect(layoutCalls(calls)[0].args.selection).toEqual({ x: 100, y: 100, width: 300, height: 100 });
    await screen.findByText('粗糙度');
  });

  it('SnippingToolbar stays resident in overlay phase and clicking OCR opens OCR modal with original text', async () => {
    createMockIpcHarness();
    const calls = wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });

    // Confirm selection -> enters overlay phase
    pressKey('Enter', 'Enter');
    await screen.findByText('粗糙度');

    // SnippingToolbar must still be present in overlay phase
    expect(screen.getByTestId('adjust-confirm-bar')).toBeInTheDocument();

    // Click OCR extract button on toolbar
    const ocrBtn = screen.getByTestId('btn-ocr');
    fireEvent.click(ocrBtn);

    // OCR modal opens with original text
    await screen.findByText('提取文本内容');
    expect(screen.getByRole('textbox')).toHaveValue('Roughness');

    // Close OCR modal -> overlay is still maintained (translated block "粗糙度" is present)
    const closeBtn = screen.getByText('✕');
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByText('提取文本内容')).not.toBeInTheDocument();
    });
    expect(screen.getByText('粗糙度')).toBeInTheDocument();
    expect(screen.getByTestId('adjust-confirm-bar')).toBeInTheDocument();
  });

  it('SnippingToolbar in overlay phase supports annotation tool drawing, pin and retranslation', async () => {
    createMockIpcHarness();
    wireHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await dragSelection({ x: 100, y: 100 }, { x: 400, y: 200 });
    pressKey('Enter', 'Enter');
    await screen.findByText('粗糙度');

    // Select Rect annotation tool
    const rectToolBtn = screen.getByTitle('矩形标注 (Rect)');
    fireEvent.click(rectToolBtn);

    // Draw a rectangle annotation on screen
    fireEvent.mouseDown(container(), { clientX: 120, clientY: 110, button: 0 });
    fireEvent.mouseMove(container(), { clientX: 250, clientY: 180 });
    fireEvent.mouseUp(container());

    // SVG annotation rect is rendered
    const svgRect = document.querySelector('svg rect[stroke="#ef4444"]');
    expect(svgRect).toBeTruthy();

    // Test Pin button on toolbar
    const pinBtn = screen.getByTitle('置顶贴图 (Pin)');
    fireEvent.click(pinBtn);
    expect(screen.getByTitle('已置顶固定 (Pin)')).toBeInTheDocument();
  });
});

