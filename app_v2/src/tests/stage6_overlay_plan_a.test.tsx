import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SnippingToolbar } from '../components/Overlay/SnippingToolbar';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';
import { YoudaoResultPanel } from '../components/Overlay/YoudaoResultPanel';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { OverlayResult } from '../services/types';

const MOCK_PAYLOAD = { width: 1920, height: 1080, scaleFactor: 1.0 };

function wireOverlay() {
  createMockIpcHarness();
  (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
    if (cmd === 'cmd_begin_capture') return MOCK_PAYLOAD;
    if (cmd === 'cmd_show_overlay' || cmd === 'cmd_close_overlay') return undefined;
    if (cmd === 'cmd_region_image') return '';
    if (cmd === 'cmd_region_ocr_layout') {
      const result: OverlayResult = {
        blocks: [
          {
            original: 'Roughness',
            translated: '',
            sourceTier: 'OCR',
            logicalX: 110,
            logicalY: 110,
            logicalW: 120,
            logicalH: 22,
            bgCss: 'rgb(30,30,30)',
            fgCss: '#ffffff',
          },
        ],
        selectionX: args?.selection?.x ?? 100,
        selectionY: args?.selection?.y ?? 100,
        selectionW: args?.selection?.width ?? 300,
        selectionH: args?.selection?.height ?? 100,
      };
      return result;
    }
    if (cmd === 'cmd_translate_phrases_styled' || cmd === 'cmd_translate_phrases') {
      return [{ original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset' }];
    }
    return undefined;
  });
  (window as any).__TAURI_INTERNALS__ = {};
}

describe('Stage 6 Plan A: Overlay Vision 液态棱镜浮岛升级回归', () => {
  beforeAll(() => {
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
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        captureReleaseAction: 'auto',
      },
    });
  });

  it('SnippingToolbar uses Vision pills and preserves original icon-only second row without extra text labels', () => {
    const { container } = render(
      <SnippingToolbar
        activeTool={null}
        onSelectTool={vi.fn()}
        onTranslate={vi.fn()}
        onOcr={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPin={vi.fn()}
        isPinned={false}
        onSave={vi.fn()}
        onCopy={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const pills = container.querySelectorAll('.overlay-vision-pill');
    expect(pills.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('btn-tool-rect').textContent).toBe('');
    expect(screen.getByTestId('btn-tool-arrow').textContent).toBe('');
    expect(screen.getByTestId('btn-tool-mosaic').textContent).toBe('');
  });

  it('SnippingToolbar animates the view-mode segmented pill slider cleanly across 文 / 原 / 双', () => {
    const baseProps = {
      activeTool: null,
      onSelectTool: vi.fn(),
      onTranslate: vi.fn(),
      onOcr: vi.fn(),
      onUndo: vi.fn(),
      canUndo: false,
      onPin: vi.fn(),
      isPinned: false,
      onSave: vi.fn(),
      onCopy: vi.fn(),
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<SnippingToolbar {...baseProps} viewMode="translated" />);
    const slider = screen.getByTestId('view-mode-slider');
    expect(slider.className).toContain('seg-pill-indicator');
    expect(slider.style.transform).toContain('translate3d(0%, 0, 0)');

    rerender(<SnippingToolbar {...baseProps} viewMode="original" />);
    expect(screen.getByTestId('view-mode-slider').style.transform).toContain('translate3d(100%, 0, 0)');

    rerender(<SnippingToolbar {...baseProps} viewMode="bilingual" />);
    expect(screen.getByTestId('view-mode-slider').style.transform).toContain('translate3d(200%, 0, 0)');
  });

  it('CaptureOverlay renders selection size pill and Vision glass context menu', async () => {
    wireOverlay();
    render(<CaptureOverlay isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/猫步划词/);

    const stage = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.mouseDown(stage, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(stage, { clientX: 400, clientY: 200 });
    fireEvent.mouseUp(stage);

    const sizeBadge = await screen.findByTestId('selection-size-badge');
    expect(sizeBadge.textContent).toContain('300 × 100 px');

    // Confirm translation and open card context menu
    fireEvent.click(screen.getByTestId('adjust-confirm-btn'));
    const card = (await screen.findByText('粗糙度')).closest('.overlay-block') as HTMLElement;
    fireEvent.contextMenu(card, { clientX: 140, clientY: 120 });

    const menu = await screen.findByTestId('card-context-menu');
    expect(menu.className).toContain('vision-modal-shell');
  });

  it('YoudaoResultPanel uses Vision glass shell and hover-links rows cleanly', () => {
    const onHover = vi.fn();
    const { container } = render(
      <YoudaoResultPanel
        blocks={[
          { original: 'Metallic', translated: '金属度', sourceTier: 'Preset', logicalX: 20, logicalY: 20, logicalW: 100, logicalH: 20, bgCss: 'rgb(30,30,30)', fgCss: '#ffffff' },
        ]}
        selectionX={20}
        selectionY={20}
        selectionW={200}
        selectionH={60}
        isLight={false}
        translating={false}
        hoverIndex={0}
        targetLang="zh-CN"
        onHover={onHover}
        onCopyText={vi.fn()}
        onSpeech={vi.fn()}
        onRetranslate={vi.fn()}
        onSwitchMode={vi.fn()}
        onPin={vi.fn()}
        onExportImage={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const panel = container.querySelector('.overlay-panel') as HTMLElement;
    expect(panel.className).toContain('vision-modal-shell');
    const row = container.querySelector('[data-row-index="0"]') as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(onHover).toHaveBeenCalledWith(0);
  });
});
