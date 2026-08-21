import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';

const MOCK_PAYLOAD = { width: 1920, height: 1080, scaleFactor: 1.0 };
const BASE_CMDS = ['cmd_show_overlay', 'cmd_close_overlay'] as const;

function wireHoverHarness() {
  const calls: Array<{ cmd: string; args: any }> = [];
  (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string, args?: any): any => {
    calls.push({ cmd, args });
    if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
    if (BASE_CMDS.some((k) => k === cmd)) return Promise.resolve(undefined);
    if (cmd === 'cmd_region_image') return Promise.resolve('');
    if (cmd === 'cmd_hover_lookup') {
      return Promise.resolve({ text: 'Principled BSDF', x: 200, y: 300, width: 120, height: 20 });
    }
    if (cmd === 'cmd_universal_translate') {
      return Promise.resolve({
        mainTranslation: '原理化 BSDF',
        engines: [{ sourceTier: 'Preset (BLENDER)', translated: '原理化 BSDF' }],
      });
    }
    return Promise.resolve(undefined);
  });
  return calls;
}

const container = () => document.querySelector('.fixed.inset-0') as HTMLElement;

function pressKey(key: string, code: string, init: KeyboardEventInit = {}) {
  fireEvent(window, new KeyboardEvent('keydown', { key, code, bubbles: true, ...init }));
}

describe('frozen-frame hover lookup (H / Ctrl+Alt+H)', () => {
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1080, width: 1920, height: 1080,
      toJSON: () => ({}),
    } as DOMRect);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it('H toggles into hover mode with the hint bar', async () => {
    wireHoverHarness();
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    pressKey('h', 'KeyH');
    expect(await screen.findByTestId('hover-hint')).toBeInTheDocument();
    // Hint bar explains the interaction
    expect(screen.getByText(/光标停在文字上自动翻译/)).toBeInTheDocument();

    // H again returns to the selection mode
    pressKey('h', 'KeyH');
    await waitFor(() => {
      expect(screen.queryByTestId('hover-hint')).not.toBeInTheDocument();
    });
  });

  it('resting the cursor recognises the line and shows a translated bubble', async () => {
    const calls = wireHoverHarness();
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    pressKey('h', 'KeyH');
    await screen.findByTestId('hover-hint');

    // Move the cursor and rest: 180ms debounce → lookup → translate
    fireEvent.mouseMove(container(), { clientX: 260, clientY: 310 });

    const bubble = await screen.findByTestId('hover-bubble');
    expect(bubble.textContent).toContain('Principled BSDF');
    expect(bubble.textContent).toContain('原理化 BSDF');
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'cmd_hover_lookup')).toBe(true);
      expect(calls.some((c) => c.cmd === 'cmd_universal_translate')).toBe(true);
    });
  });

  it('pinning the bubble keeps the entry as a card; the bubble closes', async () => {
    wireHoverHarness();
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    pressKey('h', 'KeyH');
    await screen.findByTestId('hover-hint');

    fireEvent.mouseMove(container(), { clientX: 260, clientY: 310 });
    await screen.findByTestId('hover-bubble');

    fireEvent.click(screen.getByTitle('钉住此词条'));
    expect(await screen.findByTestId('pinned-lookup-0')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('hover-bubble')).not.toBeInTheDocument();
    });

    // The pinned entry can be removed again
    fireEvent.click(screen.getByTitle('移除此词条'));
    await waitFor(() => {
      expect(screen.queryByTestId('pinned-lookup-0')).not.toBeInTheDocument();
    });
  });

  it('openInHoverMode opens straight into hover mode (global Ctrl+Alt+H path)', async () => {
    wireHoverHarness();
    (window as any).__TAURI_INTERNALS__ = {};
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} openInHoverMode={true} />);
    expect(await screen.findByTestId('hover-hint')).toBeInTheDocument();
  });
});
