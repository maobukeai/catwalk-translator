import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CaptureOverlay } from '../components/Overlay/CaptureOverlay';

// Mock Tauri APIs
vi.mock('../services/tauri', () => ({
  cmdBeginCapture: vi.fn().mockResolvedValue({ width: 1920, height: 1080, scale_factor: 1.0, is_desktop: true }),
  cmdShowOverlay: vi.fn().mockResolvedValue(undefined),
  cmdCloseOverlay: vi.fn().mockResolvedValue(undefined),
  cmdRegionOcrLayout: vi.fn().mockResolvedValue({ blocks: [], selectionX: 0, selectionY: 0, selectionW: 100, selectionH: 100 }),
  cmdWatchTick: vi.fn().mockResolvedValue(null),
  cmdCopyRegionImage: vi.fn().mockResolvedValue(undefined),
  cmdSaveRegionImage: vi.fn().mockResolvedValue(undefined),
  cmdSaveComposedImage: vi.fn().mockResolvedValue(undefined),
  cmdCopyComposedImage: vi.fn().mockResolvedValue(undefined),
  cmdGetRegionImageBase64: vi.fn().mockResolvedValue('data:image/png;base64,mock'),
  cmdHoverLookup: vi.fn().mockResolvedValue(null),
  cmdTranslatePhrasesStyled: vi.fn().mockResolvedValue([]),
  cmdLlmBatchRefine: vi.fn().mockResolvedValue([]),
  cmdUniversalTranslate: vi.fn().mockResolvedValue({ translated: 'test', sourceTier: 'Online' }),
  cmdSnapRegion: vi.fn().mockResolvedValue(null),
  cmdSaveCaptureSession: vi.fn().mockResolvedValue(undefined),
  cmdOpenPin: vi.fn().mockResolvedValue(undefined),
  saveTranslationHistory: vi.fn().mockResolvedValue(undefined),
  isTauri: () => false,
}));

describe('CaptureOverlay Hook Invariants and Lifecycle Stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders and transitions smoothly between isOpen=false and isOpen=true without React Hook errors', () => {
    const onClose = vi.fn();
    const onSendToMainWindow = vi.fn();

    // 1. Initially closed (isOpen = false)
    const { rerender, container } = render(
      <CaptureOverlay
        isOpen={false}
        openInHoverMode={false}
        onClose={onClose}
        onSendToMainWindow={onSendToMainWindow}
      />
    );
    expect(container.innerHTML).toBe('');

    // 2. Open overlay (isOpen = true) - Must NOT throw "Rendered more hooks than during the previous render"
    expect(() => {
      rerender(
        <CaptureOverlay
          isOpen={true}
          openInHoverMode={false}
          onClose={onClose}
          onSendToMainWindow={onSendToMainWindow}
        />
      );
    }).not.toThrow();

    // Verify overlay container rendered
    expect(container.firstChild).not.toBeNull();

    // 3. Close overlay again (isOpen = false) - Must NOT throw "Rendered fewer hooks"
    expect(() => {
      rerender(
        <CaptureOverlay
          isOpen={false}
          openInHoverMode={false}
          onClose={onClose}
          onSendToMainWindow={onSendToMainWindow}
        />
      );
    }).not.toThrow();
    expect(container.innerHTML).toBe('');

    // 4. Re-open overlay again (isOpen = true)
    expect(() => {
      rerender(
        <CaptureOverlay
          isOpen={true}
          openInHoverMode={false}
          onClose={onClose}
          onSendToMainWindow={onSendToMainWindow}
        />
      );
    }).not.toThrow();
    expect(container.firstChild).not.toBeNull();
  });
});
