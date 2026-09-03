import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { detectSpeechLang } from '../services/langDetect';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { OverlayResult } from '../services/types';

const MOCK_PAYLOAD = { width: 1920, height: 1080, scaleFactor: 1.0 };
const BASE_CMDS = ['cmd_show_overlay', 'cmd_close_overlay'] as const;

const TWO_BLOCK_LAYOUT: OverlayResult = {
  blocks: [
    { original: 'Subsurface Scattering', translated: '', sourceTier: 'OCR', logicalX: 100, logicalY: 100, logicalW: 180, logicalH: 22, bgCss: 'rgb(20,20,20)', fgCss: '#ffffff' },
    { original: 'Roughness', translated: '', sourceTier: 'OCR', logicalX: 100, logicalY: 130, logicalW: 120, logicalH: 22, bgCss: 'rgb(30,30,30)', fgCss: '#ffffff' },
  ],
  selectionX: 100,
  selectionY: 90,
  selectionW: 300,
  selectionH: 100,
};

function wireHarness() {
  const calls: Array<{ cmd: string; args: any }> = [];
  (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string, args?: any): any => {
    calls.push({ cmd, args });
    if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
    if (BASE_CMDS.some((k) => k === cmd)) return Promise.resolve(undefined);
    if (cmd === 'cmd_region_image') return Promise.resolve('');
    if (cmd === 'cmd_region_ocr_layout' || cmd === 'cmd_watch_tick') {
      return Promise.resolve({ ...TWO_BLOCK_LAYOUT, blocks: TWO_BLOCK_LAYOUT.blocks.map((b) => ({ ...b })) });
    }
    if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') {
      const phrases: string[] = args?.phrases || [];
      const dict: Record<string, string> = {
        'Subsurface Scattering': '次表面散射',
        Roughness: '粗糙度',
      };
      return Promise.resolve(
        phrases.map((p) => ({ original: p, translated: dict[p] || `[译]${p}`, sourceTier: 'Preset' })),
      );
    }
    if (cmd === 'cmd_copy_region_image') return Promise.resolve(true);
    if (cmd === 'cmd_save_region_image') return Promise.resolve('C:/Users/x/Pictures/猫步翻译/截图翻译_123.png');
    return Promise.resolve(undefined);
  });
  return calls;
}

const container = () => document.querySelector('.fixed.inset-0') as HTMLElement;

async function openWithResult() {
  const calls = wireHarness();
  (window as any).__TAURI_INTERNALS__ = {};
  render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
  await screen.findByText(/猫步划词/);
  fireEvent.mouseDown(container(), { clientX: 100, clientY: 100, button: 0 });
  fireEvent.mouseMove(container(), { clientX: 400, clientY: 200 });
  fireEvent.mouseUp(container());
  fireEvent(window, new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  await screen.findByText('次表面散射');
  await screen.findByText('粗糙度');
  return calls;
}

function pressKey(key: string, code: string, init: KeyboardEventInit = {}) {
  fireEvent(window, new KeyboardEvent('keydown', { key, code, bubbles: true, ...init }));
}

describe('result reading experience (view cycle / selectable / zoom / active card / TTS / image)', () => {
  let speakMock: ReturnType<typeof vi.fn>;
  let utterances: Array<{ text: string; lang: string }>;

  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1080, width: 1920, height: 1080,
      toJSON: () => ({}),
    } as DOMRect);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    utterances = [];
    speakMock = vi.fn((u: { text: string; lang: string }) => utterances.push({ text: u.text, lang: u.lang }));
    (window as any).speechSynthesis = { cancel: vi.fn(), speak: speakMock };
    (window as any).SpeechSynthesisUtterance = class {
      text: string;
      lang: string;
      constructor(text: string) { this.text = text; this.lang = ''; }
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it('O cycles translated → original → bilingual across all cards', async () => {
    await openWithResult();

    // Start: translations shown
    expect(screen.getByText('次表面散射')).toBeInTheDocument();

    pressKey('o', 'KeyO');
    // Original mode: source text replaces the translation
    await screen.findByText('Subsurface Scattering');
    expect(screen.queryByText('次表面散射')).not.toBeInTheDocument();

    pressKey('o', 'KeyO');
    // Bilingual: both original (small) and translation visible
    await screen.findByText('次表面散射');
    expect(screen.getByText('Subsurface Scattering')).toBeInTheDocument();
  });

  it('view mode buttons on SnippingToolbar switch view modes (translated/original/bilingual)', async () => {
    await openWithResult();

    // Click '原' button on SnippingToolbar
    const origBtn = await screen.findByTestId('view-mode-original');
    fireEvent.click(origBtn);

    await screen.findByText('Roughness');
    expect(screen.queryByText('粗糙度')).not.toBeInTheDocument();

    // Click '双' button on SnippingToolbar
    const biBtn = screen.getByTestId('view-mode-bilingual');
    fireEvent.click(biBtn);
    await screen.findByText('次表面散射');
    expect(screen.getByText('Subsurface Scattering')).toBeInTheDocument();

    // Click '文' button on SnippingToolbar
    const transBtn = screen.getByTestId('view-mode-translated');
    fireEvent.click(transBtn);
    await screen.findByText('粗糙度');
  });

  it('card text is selectable (userSelect text) while the card itself stays draggable', async () => {
    await openWithResult();
    const card = screen.getByText('粗糙度').closest('.overlay-block') as HTMLElement;
    const textSpan = screen.getByText('粗糙度');
    expect(textSpan.style.userSelect).toBe('text');
    expect(card.style.cursor).toBe('move');
  });

  it('Ctrl+wheel and A± buttons on SnippingToolbar zoom the card font within 0.6–2.0×', async () => {
    await openWithResult();
    const card = screen.getByText('粗糙度').closest('.overlay-block') as HTMLElement;
    const before = parseFloat(card.style.fontSize);

    fireEvent.wheel(card, { ctrlKey: true, deltaY: -120 });
    await waitFor(() => {
      expect(parseFloat(card.style.fontSize)).toBeGreaterThan(before);
    });

    const zoomedIn = parseFloat(card.style.fontSize);
    const zoomOutBtn = screen.getByTestId('btn-zoom-out');
    fireEvent.click(zoomOutBtn);
    fireEvent.click(zoomOutBtn);
    await waitFor(() => {
      expect(parseFloat(card.style.fontSize)).toBeLessThan(zoomedIn);
    });

    const zoomInBtn = screen.getByTestId('btn-zoom-in');
    fireEvent.click(zoomInBtn);
    fireEvent.click(zoomInBtn);
    await waitFor(() => {
      expect(parseFloat(card.style.fontSize)).toBeGreaterThan(zoomedIn - 3);
    });
  });

  it('btn-speech on SnippingToolbar and Space key speak the active card', async () => {
    await openWithResult();

    // Hover the second card (Roughness), then click btn-speech
    const card = screen.getByText('粗糙度').closest('.overlay-block') as HTMLElement;
    fireEvent.mouseEnter(card);

    const speechBtn = screen.getByTestId('btn-speech');
    fireEvent.click(speechBtn);

    expect(speakMock).toHaveBeenCalled();
    expect(utterances[utterances.length - 1]?.text).toBe('Roughness');
    expect(utterances[utterances.length - 1]?.lang).toBe('en-US');

    // Space key also speaks
    pressKey(' ', 'Space');
    expect(utterances[utterances.length - 1]?.text).toBe('Roughness');

    // ↑/↓ move the active card without hovering: ↓ from block 0 → block 1
    pressKey('ArrowDown', 'ArrowDown');
    pressKey(' ', 'Space');
    expect(utterances[utterances.length - 1]?.text).toBe('Roughness');
    pressKey('ArrowUp', 'ArrowUp');
    pressKey(' ', 'Space');
    expect(utterances[utterances.length - 1]?.text).toBe('Subsurface Scattering');
  });

  it('btn-speech on SnippingToolbar speaks full text of all blocks when no card is focused', async () => {
    await openWithResult();

    const speechBtn = screen.getByTestId('btn-speech');
    fireEvent.click(speechBtn);

    expect(speakMock).toHaveBeenCalled();
    expect(utterances[utterances.length - 1]?.text).toBe('Subsurface Scattering\nRoughness');
  });

  it('context menu offers region image copy & save (PNG)', async () => {
    const calls = await openWithResult();

    const card = screen.getByText('粗糙度').closest('.overlay-block') as HTMLElement;
    fireEvent.contextMenu(card, { clientX: 220, clientY: 160 });

    const menu = await screen.findByTestId('card-context-menu');
    expect(menu.textContent).toContain('复制选区图片');
    expect(menu.textContent).toContain('保存选区图片');

    fireEvent.click(screen.getByText('📷 复制选区图片'));
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'cmd_copy_region_image')).toBe(true);
    });
    expect(await screen.findByText(/选区图片已复制/)).toBeInTheDocument();

    fireEvent.contextMenu(card, { clientX: 220, clientY: 160 });
    fireEvent.click(screen.getByText('💾 保存选区图片 (PNG)'));
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'cmd_save_region_image')).toBe(true);
    });
  });

  it('rendered card heights join collision avoidance: a tall card pushes the next one down', async () => {
    // Minimal ResizeObserver stub that reports a tall height for the FIRST card
    class FakeRO {
      static instances: FakeRO[] = [];
      cb: (entries: Array<{ contentRect: { height: number } }>) => void;
      idx = FakeRO.instances.length;
      constructor(cb: (entries: Array<{ contentRect: { height: number } }>) => void) {
        this.cb = cb;
        FakeRO.instances.push(this);
      }
      observe() {
        // Card 0 reports 90px tall (vs logicalH 22) — card 1 must be pushed below
        this.cb([{ contentRect: { height: this.idx === 0 ? 90 : 22 } }]);
      }
      disconnect() {}
      unobserve() {}
    }
    (globalThis as any).ResizeObserver = FakeRO;

    try {
      await openWithResult();
      const card1 = screen.getByText('次表面散射').closest('.overlay-block') as HTMLElement;
      const card2 = screen.getByText('粗糙度').closest('.overlay-block') as HTMLElement;
      await waitFor(() => {
        // AABB push: card2 top must sit below card1's reported 90px height
        expect(parseFloat(card2.style.top)).toBeGreaterThanOrEqual(100 + 90 - 1);
      });
      void card1;
    } finally {
      delete (globalThis as any).ResizeObserver;
    }
  });
});

describe('detectSpeechLang (Unicode heuristics)', () => {
  it('maps kana → ja, hangul → ko, CJK → zh, cyrillic → ru, latin → en', () => {
    expect(detectSpeechLang('こんにちは世界')).toBe('ja-JP');
    expect(detectSpeechLang('マテリアル')).toBe('ja-JP');
    expect(detectSpeechLang('안녕하세요')).toBe('ko-KR');
    expect(detectSpeechLang('你好世界')).toBe('zh-CN');
    expect(detectSpeechLang('Привет')).toBe('ru-RU');
    expect(detectSpeechLang('Principled BSDF')).toBe('en-US');
    expect(detectSpeechLang('')).toBe('en-US');
  });
});
