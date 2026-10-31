import '@testing-library/jest-dom';
import { beforeEach, afterEach, vi } from 'vitest';
import { createMockIpcHarness } from './tauriIpcMock';
import { __clearTranslationMemoForTests, __resetLastSelectionForTests } from '../../components/Overlay/CaptureOverlay';

// ── Async-utility budget ─────────────────────────────────────────────────────
// The suite runs 61 files in parallel on CI runners. The Testing Library default
// (1s) is measured against a single idle file, so under full-suite CPU contention
// a correct-but-slow `findBy*`/`waitFor` occasionally trips it — producing failures
// that vanish when the file is run alone. 8s absorbs CPU contention while staying
// small enough that a genuinely dropped async update still fails the build.
// `@testing-library/dom` is not a direct dependency under pnpm's strict layout,
// so take `configure` from the package we actually declare: @testing-library/react.
import { configure as configureTestingLibrary } from '@testing-library/react';

configureTestingLibrary({
  asyncUtilTimeout: 8000,
});

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
  // `LAST_SELECTION` also lives outside React, so a spec's selection would otherwise
  // persist into the next one and change what the next watch tick observes.
  __resetLastSelectionForTests();
});
