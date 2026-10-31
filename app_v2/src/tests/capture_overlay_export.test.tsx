import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';

const originalSettings = useSettingsStore.getState().settings;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as any).__TAURI_INTERNALS__;
  useSettingsStore.setState({ settings: originalSettings });
});

async function open(options: { failSvg?: boolean; emptySource?: boolean; secondBlock?: boolean; selectionWidth?: number; firstBlockY?: number; renderedHeight?: number } = {}) {
  useSettingsStore.setState({ settings: { ...originalSettings, captureReleaseAction: 'auto', overlayViewMode: 'cover', enableLlmProgressiveRefine: false } });
  const sources: string[] = [];
  if (options.renderedHeight) {
    vi.stubGlobal('ResizeObserver', class {
      active = true;
      constructor(private callback: (entries: unknown[]) => void) {}
      observe(el: HTMLElement) {
        if (el.matches('.overlay-block')) queueMicrotask(() => {
          if (this.active) this.callback([{ target: el, contentRect: { width: 160, height: options.renderedHeight } }]);
        });
      }
      disconnect() { this.active = false; }
    });
  }
  vi.stubGlobal('Image', class {
    width = 450; height = 150;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(value: string) {
      sources.push(value);
      queueMicrotask(() => options.failSvg && value.startsWith('data:image/svg') ? this.onerror?.() : this.onload?.());
    }
  });
  const ctx = document.createElement('canvas').getContext('2d')!;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,EXPORT');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isRoot = this.matches('.fixed.inset-0');
    const x = isRoot ? 0 : parseFloat(this.style.left) || 0;
    const y = isRoot ? 0 : parseFloat(this.style.top) || 0;
    const width = isRoot ? 1024 : parseFloat(this.style.width) || 160;
    const height = isRoot ? 768 : this.matches('.overlay-block') && options.renderedHeight
      ? options.renderedHeight : parseFloat(this.style.height) || 40;
    return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) };
  });
  createMockIpcHarness();
  const invoke = getActiveHarness()!.invokeMock;
  const blocks = ['Original label', ...(options.secondBlock ? ['Second label'] : [])].map((original, i) => ({
    original, translated: '', sourceTier: 'OCR', logicalX: 100, logicalY: (options.firstBlockY ?? 100) + i * 40,
    logicalW: 160, logicalH: 24, bgCss: '#0c0c0c', fgCss: '#56d9dc',
    patchPng: 'AA==', patchX: 98, patchY: (options.firstBlockY ?? 100) - 2 + i * 40, patchW: 164, patchH: 28,
  }));
  invoke.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === 'cmd_begin_capture') return { width: 1536, height: 1152, scaleFactor: 1.5 };
    if (cmd === 'cmd_region_ocr_layout') return { blocks, selectionX: 100, selectionY: 100, selectionW: options.selectionWidth ?? 300, selectionH: 100 };
    if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') return args.phrases.map((original: string) => ({ original, translated: original === 'Original label' ? '实际译文' : '第二段译文', sourceTier: 'Online' }));
    if (cmd === 'cmd_region_image') return options.emptySource ? '' : 'BITMAP';
    if (cmd === 'cmd_copy_composed_image' || cmd === 'cmd_copy_region_image') return true;
    if (cmd === 'cmd_save_composed_image') return 'C:/test/export.png';
    return undefined;
  });
  (window as any).__TAURI_INTERNALS__ = {};
  const { container } = render(<CaptureOverlay isOpen onClose={() => {}} />);
  const root = container.querySelector<HTMLElement>('.fixed.inset-0')!;
  await waitFor(() => expect(root.style.cursor).toBe('crosshair'));
  fireEvent.mouseDown(root, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.mouseMove(root, { clientX: 100 + (options.selectionWidth ?? 300), clientY: 200 });
  fireEvent.mouseUp(root);
  fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
  const text = await screen.findByText('实际译文');
  return { card: text.closest('.overlay-block') as HTMLElement, invoke, sources, ctx, container };
}

function menu(card: HTMLElement, name: string) {
  fireEvent.contextMenu(card, { clientX: 130, clientY: 120 });
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('real capture overlay copy/save pipeline', () => {
  it('uses rendered height feedback to keep a feasible chain inside an off-origin selection', async () => {
    const { card, container, invoke } = await open({ secondBlock: true, firstBlockY: 130, renderedHeight: 45 });
    await waitFor(() => expect(Array.from(container.querySelectorAll<HTMLElement>('.overlay-block'), el => Number.parseFloat(el.style.top))).toEqual([106, 155]));
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-overlay-erase-plate]'), el => Number.parseFloat(el.style.top))).toEqual([128, 168]);
    menu(card, '🎨 复制 1:1 原位视觉图');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cmd_copy_composed_image', expect.anything()));
  });

  it.each(['copy', 'save'])('reports insufficient selection height before %s without losing text or silently cropping it', async (action) => {
    const { card, container, invoke } = await open({ secondBlock: true, renderedHeight: 60 });
    await waitFor(() => expect(Array.from(container.querySelectorAll<HTMLElement>('.overlay-block'), el => Number.parseFloat(el.style.top))).toEqual([100, 164]));
    expect(screen.getByText('实际译文')).toBeInTheDocument();
    expect(screen.getByText('第二段译文')).toBeInTheDocument();
    menu(card, action === 'copy' ? '🎨 复制 1:1 原位视觉图' : '💾 保存 1:1 原位视觉图 (PNG)');
    await screen.findByText(/原位文字超出选区/);
    const commands = invoke.mock.calls.map(([cmd]) => cmd);
    expect(commands).not.toContain('cmd_copy_composed_image');
    expect(commands).not.toContain('cmd_save_composed_image');
    expect(commands).not.toContain('cmd_copy_region_image');
    expect(commands).not.toContain('cmd_region_image');
  });

  it('rechecks the actual dragged position rather than the parent collision estimate', async () => {
    const { card, invoke } = await open();
    fireEvent.mouseDown(card, { clientX: 110, clientY: 110, button: 0 });
    fireEvent.mouseMove(card, { clientX: 110, clientY: 210 });
    fireEvent.mouseUp(card);
    menu(card, '🎨 复制 1:1 原位视觉图');
    await screen.findByText(/原位文字超出选区/);
    expect(invoke.mock.calls.map(([cmd]) => cmd)).not.toContain('cmd_copy_composed_image');
  });

  it('passes the logical capture edge to visible cards, not the physical bitmap width', async () => {
    const { card } = await open({ selectionWidth: 200 });
    // Selection x=100, width=200 CSS px; the desktop is 1536 physical px wide.
    expect(card.style.maxWidth).toBe('200px');
    expect(card.style.whiteSpace).toBe('pre-wrap');
    // An off-origin card still has only the selected width available.
    expect(parseFloat(card.style.left) + parseFloat(card.style.maxWidth)).toBeLessThanOrEqual(300);
  });

  it.each([
    ['original', '📷', 'Original label', false],
    ['translated', '📷', '实际译文', false],
    ['bilingual', '💾', 'Original label实际译文', true],
  ])('exports displayed %s mode after card zoom/drag', async (mode, action, expected, bilingual) => {
    const { card, invoke, sources, ctx } = await open();
    fireEvent.click(screen.getByTestId(`view-mode-${mode}`));
    fireEvent.wheel(card, { ctrlKey: true, deltaY: -100 });
    fireEvent.mouseDown(card, { clientX: 110, clientY: 110, button: 0 });
    fireEvent.mouseMove(card, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(card);
    const liveFont = card.style.fontSize;
    const isSave = action === '💾';
    menu(card, isSave ? '💾 保存 1:1 原位视觉图 (PNG)' : '🎨 复制 1:1 原位视觉图');
    const command = isSave ? 'cmd_save_composed_image' : 'cmd_copy_composed_image';
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(command, { base64Data: 'data:image/png;base64,EXPORT' }));
    const svg = decodeURIComponent(sources.find(src => src.startsWith('data:image/svg'))!.split(',')[1]);
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const layer = xml.querySelector('foreignObject > div')!;
    const exported = layer.children[1] as HTMLElement;
    expect(exported.textContent).toBe(expected);
    expect(exported.children).toHaveLength(bilingual ? 2 : 1);
    expect(exported.style.left).toBe('40px');
    expect(exported.style.top).toBe('20px');
    expect(exported.style.fontSize).toBe(liveFont);
    expect(exported.style.fontWeight).toBe(card.style.fontWeight);
    expect((layer.children[0] as HTMLElement).style.left).toBe('-2px');
    expect(ctx.drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 450, 150);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('does not resurrect a dismissed card or its source erase plate in the exported image', async () => {
    const { card, invoke, sources, container } = await open({ secondBlock: true });
    menu(card, '🚫 隐藏此卡片');
    expect(container.querySelectorAll('.overlay-block')).toHaveLength(1);
    menu(container.querySelector('.overlay-block')!, '🎨 复制 1:1 原位视觉图');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cmd_copy_composed_image', expect.anything()));
    const svg = decodeURIComponent(sources.find(src => src.startsWith('data:image/svg'))!.split(',')[1]);
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(xml.querySelector('foreignObject > div')!.children).toHaveLength(2);
    expect(xml.documentElement.textContent).toBe('第二段译文');
  });

  it.each([{ failSvg: true }, { emptySource: true }])('reports export failure without falling back to an untranslated copy: %j', async options => {
    const { card, invoke } = await open(options);
    menu(card, '🎨 复制 1:1 原位视觉图');
    await screen.findByText(/图片复制失败/);
    const commands = invoke.mock.calls.map(([cmd]) => cmd);
    expect(commands).not.toContain('cmd_copy_composed_image');
    expect(commands).not.toContain('cmd_copy_region_image');
  });

  it('keeps the explicit clean selection copy separate from composited exports', async () => {
    const { card, invoke, sources } = await open();
    menu(card, '📷 复制选区图片');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cmd_copy_region_image', expect.anything()));
    expect(sources.some(src => src.startsWith('data:image/svg'))).toBe(false);
    expect(invoke.mock.calls.map(([cmd]) => cmd)).not.toContain('cmd_copy_composed_image');
  });
});
