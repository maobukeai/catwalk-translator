import '@testing-library/jest-dom';
import { beforeEach, afterEach, vi } from 'vitest';
import { createMockIpcHarness } from './tauriIpcMock';
import { __clearTranslationMemoForTests } from '../../components/Overlay/CaptureOverlay';

// JSDOM does not implement window.matchMedia (used by useAppTheme and theme
// detection) — provide the standard minimal mock.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // legacy API
      removeListener: vi.fn(), // legacy API
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// Mock Canvas 2D Context for JSDOM
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
    if (contextId === '2d') {
      return {
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray([42, 42, 42, 255]),
        })),
        putImageData: vi.fn(),
        createImageData: vi.fn(),
        setTransform: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        fillText: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        stroke: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        rotate: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        measureText: vi.fn(() => ({ width: 100 })),
        transform: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
      } as any;
    }
    return null;
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  createMockIpcHarness();
});

afterEach(() => {
  // Module-level translation memo would otherwise leak between test cases
  __clearTranslationMemoForTests();
});
