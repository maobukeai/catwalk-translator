import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { Dock } from '../components/Dock';
import { HistoryPanel } from '../components/Vocabulary/HistoryPanel';
import { matchesHotkey } from '../services/hotkeys';
import { cmdSnapRegion } from '../services/tauri';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { OverlayResult, CaptureSession } from '../services/types';

const MOCK_PAYLOAD = { width: 1920, height: 1080, scaleFactor: 1.0 };
const BASE_CMDS = ['cmd_show_overlay', 'cmd_close_overlay'] as const;

function wireOverlayHarness(translateDelayMs = 0) {
  const calls: Array<{ cmd: string; args: any }> = [];
  (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string, args?: any): any => {
    calls.push({ cmd, args });
    if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
    if (BASE_CMDS.some((k) => k === cmd)) return Promise.resolve(undefined);
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
      const translations = [
        { original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset (BLENDER)' },
      ];
      if (translateDelayMs > 0) {
        return new Promise((res) => setTimeout(() => res(translations), translateDelayMs));
      }
      return Promise.resolve(translations);
    }
    return Promise.resolve(undefined);
  });
  return calls;
}

async function mouseSelection() {
  const container = document.querySelector('.fixed.inset-0')!;
  fireEvent.mouseDown(container, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.mouseMove(container, { clientX: 400, clientY: 200 });
  fireEvent.mouseUp(container);
  // v2.4: release freezes the rect into adjust mode — confirm with Enter
  fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
}

describe('shared hotkey matcher (services/hotkeys)', () => {
  const kev = (init: Partial<KeyboardEvent> & { key: string }) =>
    new KeyboardEvent('keydown', {
      bubbles: true,
      key: init.key,
      code: init.code,
      ctrlKey: !!init.ctrlKey,
      altKey: !!init.altKey,
      shiftKey: !!init.shiftKey,
      metaKey: !!init.metaKey,
    } as KeyboardEventInit);

  it('matches Ctrl+Alt+D exactly', () => {
    expect(matchesHotkey(kev({ key: 'd', code: 'KeyD', ctrlKey: true, altKey: true }), 'Ctrl+Alt+D')).toBe(true);
  });

  it('matches F4 without modifiers', () => {
    expect(matchesHotkey(kev({ key: 'F4', code: 'F4' }), 'F4')).toBe(true);
  });

  it('rejects when a modifier is missing or extra', () => {
    expect(matchesHotkey(kev({ key: 'd', code: 'KeyD', ctrlKey: true }), 'Ctrl+Alt+D')).toBe(false);
    expect(matchesHotkey(kev({ key: 'd', code: 'KeyD', ctrlKey: true, altKey: true, shiftKey: true }), 'Ctrl+Alt+D')).toBe(false);
  });

  it('rejects empty hotkey strings', () => {
    expect(matchesHotkey(kev({ key: 'd', code: 'KeyD' }), '')).toBe(false);
  });
});

describe('capture overlay upgrade regressions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('passes the overlay viewport dims to cmd_region_ocr_layout for DPI-safe geometry', async () => {
    createMockIpcHarness();
    const calls = wireOverlayHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await mouseSelection();

    await waitFor(() => {
      const layoutCall = calls.find((c) => c.cmd === 'cmd_region_ocr_layout');
      expect(layoutCall).toBeDefined();
    });

    const layoutCall = calls.find((c) => c.cmd === 'cmd_region_ocr_layout')!;
    expect(layoutCall.args.overlayWidth).toBe(window.innerWidth);
    expect(layoutCall.args.overlayHeight).toBe(window.innerHeight);
  });

  it('renders OCR text immediately, then swaps in the stage-2 translation progressively', async () => {
    createMockIpcHarness();
    wireOverlayHarness(250); // hold stage-2 back so the pending original is observable
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await mouseSelection();
    expect(await screen.findByText('Roughness')).toBeInTheDocument(); // OCR original shows instantly

    await waitFor(() => {
      expect(screen.getByText('粗糙度')).toBeInTheDocument(); // translation takes over
    }, { timeout: 2000 });
  });

  it('F4 does NOT close the overlay while it is pinned, and closes after unlock', async () => {
    createMockIpcHarness();
    wireOverlayHarness();
    (window as any).__TAURI_INTERNALS__ = {};
    const onClose = vi.fn();

    render(<CaptureOverlay isOpen={true} onClose={onClose} />);
    await screen.findByText(/猫步划词/);

    // Draw a selection so the toolbar is displayed
    await mouseSelection();

    // Pin via Ctrl+P
    fireEvent(window, new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }));
    await waitFor(() => expect(screen.getByTitle(/已置顶固定/)).toBeInTheDocument());

    // F4 while pinned → must stay open
    fireEvent(window, new KeyboardEvent('keydown', { key: 'F4', code: 'F4', bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    // Unlock, then F4 closes
    fireEvent(window, new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }));
    fireEvent(window, new KeyboardEvent('keydown', { key: 'F4', code: 'F4', bubbles: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('v2.2 feature upgrades: snap / style / collapse / replay', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('double-click smart snap invokes cmd_snap_region and processes the snapped rect', async () => {
    createMockIpcHarness();
    const calls = wireOverlayHarness();
    (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string, args?: any): any => {
      calls.push({ cmd, args });
      if (cmd === 'cmd_begin_capture') return Promise.resolve(MOCK_PAYLOAD);
      if (BASE_CMDS.some((k) => k === cmd)) return Promise.resolve(undefined);
      if (cmd === 'cmd_snap_region') {
        return Promise.resolve({ x: 40, y: 40, width: 220, height: 64 });
      }
      if (cmd === 'cmd_region_ocr_layout') {
        return Promise.resolve({
          blocks: [],
          selectionX: args?.selection?.x ?? 40,
          selectionY: args?.selection?.y ?? 40,
          selectionW: args?.selection?.width ?? 220,
          selectionH: args?.selection?.height ?? 64,
        } as OverlayResult);
      }
      return Promise.resolve(undefined);
    });
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    const container = document.querySelector('.fixed.inset-0')!;
    fireEvent.doubleClick(container, { clientX: 120, clientY: 60 });

    await waitFor(() => {
      expect(screen.getByText(/已智能吸附文本段落/)).toBeInTheDocument();
    });
    await waitFor(() => {
      const snapCall = calls.find((c) => c.cmd === 'cmd_snap_region');
      expect(snapCall).toBeDefined();
    });
    const layoutCall = calls.find((c) => c.cmd === 'cmd_region_ocr_layout');
    expect(layoutCall).toBeDefined();
    expect(layoutCall!.args.selection.x).toBe(40);
    expect(layoutCall!.args.selection.width).toBe(220);
  });

  it('cmdSnapRegion falls back to a deterministic rect outside Tauri', async () => {
    delete (window as any).__TAURI_INTERNALS__;
    const rect = await cmdSnapRegion(300, 200, 1.0);
    expect(rect).not.toBeNull();
    expect(rect!.width).toBeGreaterThan(0);
    expect(rect!.height).toBeGreaterThan(0);
  });

  it('translation style selector updates the persisted setting', async () => {
    createMockIpcHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    const initial = useSettingsStore.getState().settings.translationStyle;
    useSettingsStore.getState().setTranslationStyle('terminology');
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.translationStyle).toBe('terminology');
    });
    // restore
    useSettingsStore.getState().setTranslationStyle(initial || 'free');
  });

  it('dock renders all navigation targets and marks the active one', async () => {
    createMockIpcHarness();

    render(
      <Dock
        activeTab="translate"
        onTabChange={vi.fn()}
        onTriggerCapture={vi.fn()}
        onTriggerClipboard={vi.fn()}
        onTriggerSpotlight={vi.fn()}
        onOpenCheatSheet={vi.fn()}
      />
    );

    // 四个功能入口 + 截图 CTA 均可按 aria-label 命中
    for (const label of ['翻译器', 'AI 对话', '生词本', '系统设置', '划词翻译']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    // 激活态落在「翻译器」上
    expect(screen.getByRole('button', { name: '翻译器' }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: 'AI 对话' }).getAttribute('data-active')).toBe('false');
  });

  it('HistoryPanel lists capture sessions and opens the replay modal', async () => {
    const session: CaptureSession = {
      id: 'sess_test_1',
      timestamp: '2026/8/16 18:00:00',
      targetLang: 'zh-CN',
      engine: 'auto',
      blocks: [
        {
          original: 'Principled BSDF',
          translated: '原理化 BSDF',
          sourceTier: 'Preset (BLENDER)',
          logicalX: 10,
          logicalY: 10,
          logicalW: 120,
          logicalH: 24,
          bgCss: 'rgb(20,24,30)',
          fgCss: '#ffffff',
        },
      ],
    };

    createMockIpcHarness();
    (getActiveHarness()!.invokeMock as any).mockImplementation((cmd: string): any => {
      if (cmd === 'cmd_get_capture_sessions') return Promise.resolve([session]);
      if (cmd === 'cmd_get_history') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    (window as any).__TAURI_INTERNALS__ = {};

    render(<HistoryPanel />);
    expect(await screen.findByText('划词回放')).toBeInTheDocument();
    expect(await screen.findByText(/1 场截图翻译可重看/)).toBeInTheDocument();

    const row = screen.getByText('2026/8/16 18:00:00').closest('div.cursor-pointer')!;
    fireEvent.click(row);

    expect(await screen.findByText(/划词回放 · 2026\/8\/16 18:00:00/)).toBeInTheDocument();
    expect(screen.getAllByText('原理化 BSDF').length).toBeGreaterThanOrEqual(2); // replay card + text list
    expect(screen.getByText('复制全部')).toBeInTheDocument();
    expect(screen.getByText('导出 TXT')).toBeInTheDocument();
  });
});

describe('frosted glass toggle fix', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('re-enabling blur on a solid theme restores the default 24px amount', async () => {
    createMockIpcHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    // Simulate the solid-dark preset: blur off + 0px amount
    useSettingsStore.getState().setAppearance({ enableBlur: false, blurAmount: 0 });
    expect(useSettingsStore.getState().settings.appearance?.blurAmount).toBe(0);

    // Toggling the switch back on must restore a visible amount
    useSettingsStore.getState().setEnableBlur(true);
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.appearance?.enableBlur).toBe(true);
    });
    expect(useSettingsStore.getState().settings.appearance?.blurAmount).toBe(24);

    // restore defaults for other suites
    useSettingsStore.getState().setAppearance({ enableBlur: true, blurAmount: 24 });
  });

  it('appearance changes persist immediately via cmd_save_settings', async () => {
    createMockIpcHarness();
    (window as any).__TAURI_INTERNALS__ = {};
    const harness = getActiveHarness()!;

    useSettingsStore.getState().setEnableBlur(true);

    await waitFor(() => {
      // Assert on the vi.fn call log: custom mockImplementations from earlier
      // suites replace the recording switch, but mock.calls always records.
      const saveCall = (harness.invokeMock.mock.calls as any[]).find(
        (c) => c[0] === 'cmd_save_settings'
      );
      expect(saveCall).toBeDefined();
      expect(saveCall![1].settings.appearance.enableBlur).toBe(true);
    });
  });
});

describe('capture overlay v2.3: Enter fullscreen / R repeat / W watch', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('Enter selects the full screen and processes it', async () => {
    createMockIpcHarness();
    const calls = wireOverlayHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'cmd_show_overlay')).toBe(true);
    });

    fireEvent(window, new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));

    await waitFor(() => {
      const layoutCall = calls.find((c) => c.cmd === 'cmd_region_ocr_layout');
      expect(layoutCall).toBeDefined();
    });
    const layoutCall = calls.find((c) => c.cmd === 'cmd_region_ocr_layout')!;
    expect(layoutCall.args.selection.x).toBe(0);
    expect(layoutCall.args.selection.y).toBe(0);
    expect(layoutCall.args.selection.width).toBe(window.innerWidth);
    expect(layoutCall.args.selection.height).toBe(window.innerHeight);
  });

  it('R repeats the last selection rect after returning to selecting', async () => {
    createMockIpcHarness();
    const calls = wireOverlayHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await mouseSelection(); // 100,100 → 400,200
    await waitFor(() => {
      expect(screen.getByText('粗糙度')).toBeInTheDocument();
    });
    const firstCall = calls.find((c) => c.cmd === 'cmd_region_ocr_layout')!;

    // Return to selecting phase (tiny drag resets, not pinned)
    const container = document.querySelector('.fixed.inset-0')!;
    fireEvent.mouseDown(container, { clientX: 250, clientY: 150, button: 0 });
    fireEvent.mouseUp(container);

    fireEvent(window, new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));

    await waitFor(() => {
      const layoutCalls = calls.filter((c) => c.cmd === 'cmd_region_ocr_layout');
      expect(layoutCalls.length).toBeGreaterThanOrEqual(2);
    });
    const secondCall = calls.filter((c) => c.cmd === 'cmd_region_ocr_layout')[1];
    expect(secondCall.args.selection).toEqual(firstCall.args.selection);
  });

  it('W toggles region watch mode on and off with feedback', async () => {
    createMockIpcHarness();
    wireOverlayHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await mouseSelection();
    const confirmBtn = screen.queryByTestId('btn-tool-confirm');
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }
    await waitFor(() => {
      expect(screen.getByText('粗糙度')).toBeInTheDocument();
    });

    // W on
    fireEvent(window, new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    expect(await screen.findByText(/区域监控已开启/)).toBeInTheDocument();

    // W off
    fireEvent(window, new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    await waitFor(() => {
      expect(screen.getByText(/已停止区域监控/)).toBeInTheDocument();
    });
  });
});

describe('Youdao-style panel display mode', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    useSettingsStore.getState().setOverlayViewMode('cover');
  });

  it('renders dashed outlines + docked result panel instead of cover cards', async () => {
    createMockIpcHarness();
    wireOverlayHarness();
    useSettingsStore.getState().setOverlayViewMode('panel');
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await mouseSelection();
    await waitFor(() => {
      expect(screen.getByText('粗糙度')).toBeInTheDocument();
    });

    // Youdao-style panel exists
    expect(screen.getByText('截图翻译')).toBeInTheDocument();
    expect(screen.getByText('📋 复制译文')).toBeInTheDocument();
    expect(screen.getByText('📄 原文')).toBeInTheDocument();

    // Screen shows dashed outlines, NOT cover cards
    const outlines = document.querySelectorAll('.overlay-outline');
    expect(outlines.length).toBe(1);
    expect(document.querySelector('.overlay-block')).toBeNull();
  });

  it('M toggles between cover mode and panel mode live', async () => {
    createMockIpcHarness();
    wireOverlayHarness();
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await mouseSelection();
    await waitFor(() => {
      expect(screen.getByText('粗糙度')).toBeInTheDocument();
    });

    // Default = cover mode: cards visible, no panel
    expect(document.querySelector('.overlay-block')).not.toBeNull();
    expect(screen.queryByText('截图翻译')).toBeNull();

    // M → panel mode
    fireEvent(window, new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }));
    await waitFor(() => {
      expect(screen.getByText('截图翻译')).toBeInTheDocument();
    });
    expect(document.querySelector('.overlay-block')).toBeNull();

    // M again → back to cover mode
    fireEvent(window, new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }));
    await waitFor(() => {
      expect(document.querySelector('.overlay-block')).not.toBeNull();
    });
    expect(screen.queryByText('截图翻译')).toBeNull();
  });

  it('hovering a panel row highlights the matching screen outline', async () => {
    createMockIpcHarness();
    wireOverlayHarness();
    useSettingsStore.getState().setOverlayViewMode('panel');
    (window as any).__TAURI_INTERNALS__ = {};

    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    await mouseSelection();
    await waitFor(() => {
      expect(screen.getByText('粗糙度')).toBeInTheDocument();
    });

    const row = document.querySelector('[data-row-index="0"]') as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.mouseEnter(row);

    const outline = document.querySelector('.overlay-outline') as HTMLElement;
    expect(outline.style.border).toContain('0.95'); // highlighted border color
    expect(outline.style.boxShadow).toContain('rgba(56,189,248');
  });
});
