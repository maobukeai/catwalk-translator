import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OverlayBlockCard, OverlayErasePlate } from '../components/Overlay/OverlayBlockCard';
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

  it('does not draw a second list bullet when the source bullet remains outside the patch', () => {
    const block: OverlayBlock = {
      original: '• The device you are on now', translated: '• 你当前使用的设备',
      sourceTier: 'OCR', logicalX: 66, logicalY: 212, logicalW: 360, logicalH: 37,
      bgCss: '#e8eef7', fgCss: '#111111', preserveLeadingBullet: true,
    };
    const { container, rerender } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    expect((container.querySelector('[data-overlay-main-text]') as HTMLElement).textContent).toBe('你当前使用的设备');
    rerender(<OverlayBlockCard block={{ ...block, preserveLeadingBullet: false }} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    expect((container.querySelector('[data-overlay-main-text]') as HTMLElement).textContent).toBe('• 你当前使用的设备');
  });

  it('covers text extending below the erased patch after a measured wrap', () => {
    const block: OverlayBlock = {
      original: 'Long heading', translated: '很长的译文需要折行显示', sourceTier: 'OCR',
      logicalX: 20, logicalY: 20, logicalW: 120, logicalH: 24,
      aabbH: 48, bgCss: '#e8eef7', fgCss: '#111111',
      patchPng: 'AA==', patchX: 18, patchY: 18, patchW: 124, patchH: 28,
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    expect((container.querySelector('.overlay-block') as HTMLElement).style.backgroundColor).toBe('rgb(232, 238, 247)');
  });

  it('keeps user zoom-out text at the readable 9px floor', () => {
    const block: OverlayBlock = {
      original: 'Small', translated: '小', sourceTier: 'OCR',
      logicalX: 20, logicalY: 20, logicalW: 100, logicalH: 18,
      bgCss: '#ffffff', fgCss: '#111111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} scale={0.6} />);
    expect(parseFloat((container.querySelector('.overlay-block') as HTMLElement).style.fontSize)).toBeGreaterThanOrEqual(9);
  });

  it('uses the captured desktop width in visual fixtures instead of the narrow review pane', () => {
    const block: OverlayBlock = {
      original: 'Compiling MaobuTranslator (C:\\Users\\20269\\Desktop\\project\\src-tauri)',
      translated: '正在编译 MaobuTranslator（C:\\Users\\20269\\Desktop\\project\\src-tauri）',
      sourceTier: 'OCR', logicalX: 40, logicalY: 479, logicalW: 870, logicalH: 22,
      bgCss: '#0c0c0c', fgCss: '#cccccc',
    };
    const { container, rerender } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} viewportWidth={440} />);
    const card = () => container.querySelector('.overlay-block') as HTMLElement;
    expect(card().style.maxWidth).toBe('380px');
    rerender(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} viewportWidth={1200} />);
    expect(card().style.maxWidth).toBe('1140px');
  });

  it('erases the full source box when a translated card has no patch image', () => {
    const block: OverlayBlock = {
      original: 'A long English sentence', translated: '短句', sourceTier: 'OCR',
      logicalX: 20, logicalY: 20, logicalW: 400, logicalH: 45,
      bgCss: '#e8eef7', fgCss: '#111111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    const erase = container.querySelector('.overlay-block > div[aria-hidden]') as HTMLElement;
    expect(erase.style.width).toBe('410px');
    expect(erase.style.height).toBe('61px');
  });

  it('makes a failed individual translation retryable without dragging the card', () => {
    const onRetry = vi.fn();
    const block: OverlayBlock = {
      original: 'Roughness', translated: 'Roughness', sourceTier: '翻译失败·点击重试',
      translationFailed: true, logicalX: 20, logicalY: 20, logicalW: 120, logicalH: 20,
      bgCss: '#ffffff', fgCss: '#111111',
    };
    render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '重试此段翻译' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not bold or shadow long prose when cover mode is chosen manually', () => {
    const block: OverlayBlock = {
      original: '原位翻译修复了短译文覆盖长原文时的残字，并加入视觉验收。',
      translated: 'In-place translation now handles long source sentences.',
      sourceTier: 'LLM', logicalX: 20, logicalY: 20, logicalW: 620, logicalH: 22,
      bgCss: '#ffffff', fgCss: '#111111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    const card = container.querySelector('.overlay-block') as HTMLElement;
    expect(card.style.fontWeight).toBe('400');
    expect(card.style.textShadow).toBe('none');
    expect(card.style.letterSpacing).toBe('0');
  });

  it('keeps dense prose erase plates inside their OCR rows', () => {
    const block: OverlayBlock = {
      original: '原位翻译修复了短译文覆盖长原文时的残字，并加入视觉验收。',
      translated: 'In-place translation now handles long source sentences.',
      sourceTier: 'OCR', logicalX: 40, logicalY: 56, logicalW: 620, logicalH: 22,
      bgCss: '#ffffff', fgCss: '#111111',
      erasePadding: { left: 2, right: 2, top: 0, bottom: 0 },
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} proseFontSize={13} />);
    const card = container.querySelector('.overlay-block') as HTMLElement;
    const erase = card.querySelector(':scope > div[aria-hidden]') as HTMLElement;
    expect(card.style.fontSize).toBe('13px');
    expect(erase.style.top).toBe('0px');
    expect(erase.style.height).toBe('22px');
  });

  it('keeps the safety margin for an isolated large heading', () => {
    const block: OverlayBlock = {
      original: "You'll stay signed in on these devices after",
      translated: '更改密码后，你仍会在这些设备上保持登录状态', sourceTier: 'OCR',
      logicalX: 40, logicalY: 60, logicalW: 940, logicalH: 50,
      bgCss: '#e8eef7', fgCss: '#111111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    const erase = container.querySelector('.overlay-block > div[aria-hidden]') as HTMLElement;
    expect(erase.style.top).toBe('-8px');
    expect(erase.style.height).toBe('66px');
  });

  it('matches a large Latin source heading without enlarging body rows', () => {
    const heading: OverlayBlock = {
      original: "You'll stay signed in on these devices after",
      translated: '更改密码后，你仍会在这些设备上保持登录状态', sourceTier: 'OCR',
      logicalX: 35, logicalY: 58, logicalW: 949, logicalH: 54,
      bgCss: '#e8eef7', fgCss: '#111111',
    };
    const { container, rerender } = render(<OverlayBlockCard block={heading} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} viewportWidth={1050} />);
    const card = () => container.querySelector('.overlay-block') as HTMLElement;
    expect(parseFloat(card().style.fontSize)).toBeGreaterThanOrEqual(41);
    rerender(<OverlayBlockCard block={{ ...heading, logicalH: 24, logicalW: 500 }} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} viewportWidth={1050} />);
    expect(parseFloat(card().style.fontSize)).toBeLessThanOrEqual(17);
  });

  it('leaves the fallback erase plate over the OCR source after collision moves the card', () => {
    const block: OverlayBlock = {
      original: 'A long source sentence', translated: '译文', sourceTier: 'OCR',
      logicalX: 110, logicalY: 136, logicalW: 120, logicalH: 24,
      sourceX: 40, sourceY: 60, sourceW: 390, sourceH: 24,
      bgCss: '#ffffff', fgCss: '#111111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    const card = container.querySelector('.overlay-block') as HTMLElement;
    const erase = card.querySelector(':scope > div[aria-hidden]') as HTMLElement;
    expect(card.style.left).toBe('110px');
    expect(card.style.top).toBe('136px');
    expect(erase.style.left).toBe('-75px');
    expect(erase.style.top).toBe('-84px');
    expect(erase.style.width).toBe('400px');
  });

  it('does not count an absolute erase plate as translated text width', () => {
    let notify: ((entries: Array<{ contentRect: { width: number; height: number } }>) => void) | undefined;
    class FakeRO {
      constructor(cb: typeof notify) { notify = cb; }
      observe() {}
      disconnect() {}
    }
    (globalThis as any).ResizeObserver = FakeRO;
    const onRenderedSize = vi.fn();
    try {
      const block: OverlayBlock = {
        original: 'Long source line', translated: '短译文', sourceTier: 'OCR',
        logicalX: 220, logicalY: 120, logicalW: 100, logicalH: 24,
        sourceX: 20, sourceY: 40, sourceW: 500, sourceH: 24,
        bgCss: '#ffffff', fgCss: '#111111',
      };
      const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} onRenderedSize={onRenderedSize} />);
      const card = container.querySelector('.overlay-block') as HTMLElement;
      const mainText = card.querySelector('[data-overlay-main-text]') as HTMLElement;
      Object.defineProperty(card, 'clientWidth', { value: 120, configurable: true });
      Object.defineProperty(card, 'scrollWidth', { value: 600, configurable: true });
      Object.defineProperty(mainText, 'scrollWidth', { value: 80, configurable: true });
      act(() => notify?.([{ contentRect: { width: 120, height: 24 } }]));
      expect(onRenderedSize).toHaveBeenCalledWith(0, { width: 120, height: 24 });
      expect(card.className).not.toContain('transition-all');
    } finally {
      delete (globalThis as any).ResizeObserver;
    }
  });

  it('renders all source erasure below translated text when the parent owns the plate', () => {
    const block: OverlayBlock = {
      original: 'A long English sentence', translated: '短译文', sourceTier: 'OCR',
      logicalX: 40, logicalY: 60, logicalW: 400, logicalH: 24,
      sourceX: 40, sourceY: 60, sourceW: 400, sourceH: 24,
      erasePadding: { left: 2, right: 2, top: 1, bottom: 1 },
      bgCss: '#e8eef7', fgCss: '#111111',
    };
    const { container } = render(<><OverlayErasePlate block={block} /><OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} externalErase /></>);
    const plate = container.querySelector('[data-overlay-erase-plate]') as HTMLElement;
    const card = container.querySelector('.overlay-block') as HTMLElement;
    expect(plate.style.zIndex).toBe('190');
    expect(card.style.zIndex).toBe('200');
    expect(plate.style.left).toBe('38px');
    expect(plate.style.top).toBe('59px');
    expect(card.querySelector(':scope > div[aria-hidden]')).toBeNull();
    expect(card.style.backgroundColor).toBe('');
  });

  it('styles a short chat-bubble continuation like its paragraph rather than a bold button', () => {
    const block: OverlayBlock = {
      original: '具集成到 vids.new 中', translated: 'to vids.new.', sourceTier: 'OCR',
      logicalX: 38, logicalY: 42, logicalW: 171, logicalH: 22,
      bgCss: '#9cf09f', fgCss: '#111111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={1} onClose={() => {}} isPinned={false} onTogglePin={() => {}} proseFontSize={13} />);
    const card = container.querySelector('.overlay-block') as HTMLElement;
    expect(card.style.fontSize).toBe('13px');
    expect(card.style.fontWeight).toBe('400');
    expect(card.style.letterSpacing).toBe('0');
    expect(card.style.textShadow).toBe('none');
  });

  it('does not force ordinary dialog labels into bold 600-weight text', () => {
    const dialogLabel: OverlayBlock = {
      original: 'The device you are on now', translated: '你当前使用的设备', sourceTier: 'OCR',
      logicalX: 67, logicalY: 215, logicalW: 410, logicalH: 30,
      bgCss: '#e8eef7', fgCss: '#555555',
    };
    const { container, rerender } = render(<OverlayBlockCard block={dialogLabel} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    const card = () => container.querySelector('.overlay-block') as HTMLElement;
    expect(card().style.fontWeight).toBe('400');
    expect(card().style.letterSpacing).toBe('0');
    rerender(<OverlayBlockCard block={{ ...dialogLabel, original: 'File', translated: '文件', logicalW: 32, logicalH: 17 }} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    expect(card().style.fontWeight).toBe('500');
  });
});
