import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { OverlayBlockCard } from '../components/Overlay/OverlayBlockCard';
import type { OverlayBlock } from '../services/types';

describe('overlay erased-patch coverage', () => {
  it('uses an opaque card background when zoomed text outgrows its patch', () => {
    // The shared JSDOM canvas stub reports a fixed 100px width for all text.
    // Give this card a plausible 100px-at-20px measured line instead.
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      measureText: () => ({ width: 500 }),
    }) as unknown as CanvasRenderingContext2D);
    const block: OverlayBlock = {
      original: 'HelloWorld',
      translated: 'HelloWorld',
      sourceTier: 'OCR',
      logicalX: 100,
      logicalY: 100,
      logicalW: 100,
      logicalH: 30,
      bgCss: '#eeeeee',
      fgCss: '#111111',
      patchPng: 'AA==',
      patchX: 98,
      patchY: 98,
      patchW: 110,
      patchH: 30,
    };
    const props = {
      block,
      blockIndex: 0,
      onClose: () => {},
      isPinned: false,
      onTogglePin: () => {},
    };
    const view = render(<OverlayBlockCard {...props} scale={1} />);
    const card = () => view.container.querySelector('.overlay-block') as HTMLElement;
    expect(card().style.backgroundColor).toBe('');

    view.rerender(<OverlayBlockCard {...props} scale={1.5} />);
    expect(card().style.backgroundColor).toBe('rgb(238, 238, 238)');
    canvas.mockRestore();
  });
});
