import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  document.documentElement.style.removeProperty('--app-font-family');
  vi.restoreAllMocks();
});

it('reuses measured text widths but invalidates them when the application font changes', async () => {
  vi.resetModules();
  const measureText = vi.fn(() => ({ width: 400 }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText } as unknown as CanvasRenderingContext2D);
  const { measureTextWidth } = await import('../components/Overlay/OverlayBlockCard');
  document.documentElement.style.setProperty('--app-font-family', 'FontA');
  expect(measureTextWidth('same text', 20)).toBe(80);
  expect(measureTextWidth('same text', 40)).toBe(160);
  expect(measureText).toHaveBeenCalledTimes(1);
  document.documentElement.style.setProperty('--app-font-family', 'FontB');
  expect(measureTextWidth('same text', 20)).toBe(80);
  expect(measureText).toHaveBeenCalledTimes(2);
});
