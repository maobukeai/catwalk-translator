import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OverlayBlockCard, OverlayErasePlate } from '../components/Overlay/OverlayBlockCard';
import type { OverlayBlock } from '../services/types';

describe('overlay erased-patch coverage', () => {
  it('follows a small interior collision correction and returns exactly to its source', () => {
    const block: OverlayBlock = {
      original: 'A row', translated: '一行', sourceTier: 'OCR',
      logicalX: 40, logicalY: 100, logicalW: 120, logicalH: 20,
      sourceX: 40, sourceY: 100, bgCss: '#fff', fgCss: '#111',
    };
    const props = { blockIndex: 0, onClose: () => {}, isPinned: false, onTogglePin: () => {} };
    const { container, rerender } = render(<OverlayBlockCard {...props} block={block} />);
    const card = container.querySelector<HTMLElement>('.overlay-block')!;
    rerender(<OverlayBlockCard {...props} block={{ ...block, logicalY: 99 }} />);
    expect(card.style.top).toBe('99px');
    rerender(<OverlayBlockCard {...props} block={block} />);
    expect(card.style.top).toBe('100px');
  });

  it('applies a 2px boundary correction instead of discarding it as watch jitter', () => {
    const block: OverlayBlock = {
      original: 'A row', translated: '一行', sourceTier: 'OCR',
      logicalX: 40, logicalY: 180, logicalW: 120, logicalH: 20,
      layoutTop: 100, layoutBottom: 200, bgCss: '#fff', fgCss: '#111',
    };
    const props = { blockIndex: 0, onClose: () => {}, isPinned: false, onTogglePin: () => {} };
    const { container, rerender } = render(<OverlayBlockCard {...props} block={block} />);
    const card = container.querySelector<HTMLElement>('.overlay-block')!;
    rerender(<OverlayBlockCard {...props} block={{ ...block, logicalY: 178, aabbH: 22 }} />);
    expect(card.style.top).toBe('178px');
    // Small interior OCR jitter still uses the previous stable position.
    rerender(<OverlayBlockCard {...props} block={{ ...block, logicalY: 179 }} />);
    expect(card.style.top).toBe('178px');
  });

  it('retains an explicit drag when new boundary metadata arrives', () => {
    const block: OverlayBlock = {
      original: 'A row', translated: '一行', sourceTier: 'OCR',
      logicalX: 40, logicalY: 180, logicalW: 120, logicalH: 20,
      layoutTop: 100, layoutBottom: 200, bgCss: '#fff', fgCss: '#111',
    };
    const props = { blockIndex: 0, onClose: () => {}, isPinned: false, onTogglePin: () => {} };
    const { container, rerender } = render(<OverlayBlockCard {...props} block={block} />);
    const card = container.querySelector<HTMLElement>('.overlay-block')!;
    fireEvent.mouseDown(card, { clientX: 40, clientY: 180, button: 0 });
    fireEvent.mouseMove(card, { clientX: 40, clientY: 240 });
    fireEvent.mouseUp(card);
    rerender(<OverlayBlockCard {...props} block={{ ...block, logicalY: 178, aabbH: 22 }} />);
    expect(card.style.top).toBe('240px');
  });

  it('reports a small height increase that crosses the edge without replacing the observer', () => {
    let notify: ((entries: Array<{ contentRect: { width: number; height: number } }>) => void) | undefined;
    const created = vi.fn();
    class FakeRO {
      constructor(callback: typeof notify) { notify = callback; created(); }
      observe() {}
      disconnect() {}
    }
    const previous = globalThis.ResizeObserver;
    (globalThis as any).ResizeObserver = FakeRO;
    try {
      const block: OverlayBlock = {
        original: 'A row', translated: '一行', sourceTier: 'OCR',
        logicalX: 40, logicalY: 180, logicalW: 120, logicalH: 20,
        layoutTop: 100, layoutBottom: 200, bgCss: '#fff', fgCss: '#111',
      };
      const onRenderedSize = vi.fn();
      render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} onRenderedSize={onRenderedSize} />);
      act(() => notify?.([{ contentRect: { width: 120, height: 20 } }]));
      act(() => notify?.([{ contentRect: { width: 120, height: 21 } }]));
      expect(onRenderedSize).toHaveBeenLastCalledWith(0, { width: 120, height: 21 });
      act(() => notify?.([{ contentRect: { width: 120, height: 21.2 } }]));
      expect(onRenderedSize).toHaveBeenCalledTimes(2);
      expect(created).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.ResizeObserver = previous;
    }
  });

  it('preserves a common fractional fitted size on both long and short paragraph lines', () => {
    const base: OverlayBlock = {
      original: '原文', translated: 'A long translated paragraph', sourceTier: 'OCR',
      logicalX: 41, logicalY: 20, logicalW: 355, logicalH: 20, layoutRight: 417,
      bgCss: '#9cf09f', fgCss: '#111111',
    };
    const { container } = render(<>
      <OverlayBlockCard block={base} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} proseFontSize={11.51} />
      <OverlayBlockCard block={{ ...base, translated: 'Short end.', logicalY: 41, logicalW: 149 }} blockIndex={1} onClose={() => {}} isPinned={false} onTogglePin={() => {}} proseFontSize={11.51} />
    </>);
    expect(Array.from(container.querySelectorAll<HTMLElement>('.overlay-block'), card => card.style.fontSize)).toEqual(['11.5px', '11.5px']);
  });

  it('wraps at a capture boundary without lowering the common paragraph font', () => {
    const block: OverlayBlock = {
      original: '原文', translated: 'A translated line at the selection edge', sourceTier: 'OCR',
      logicalX: 641, logicalY: 20, logicalW: 355, logicalH: 20, layoutRight: 1017,
      bgCss: '#9cf09f', fgCss: '#111111',
    };
    const { container, rerender } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} proseFontSize={12} viewportWidth={1920} />);
    const card = container.querySelector('.overlay-block') as HTMLElement;
    expect(card.style.maxWidth).toBe('376px');
    expect(card.style.whiteSpace).toBe('pre-wrap');
    expect(card.style.fontSize).toBe('12px');
    rerender(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} proseFontSize={12} scale={1.5} viewportWidth={1920} />);
    expect(card.style.fontSize).toBe('18px');
    expect(card.style.maxWidth).toBe('376px');
    expect(card.style.whiteSpace).toBe('pre-wrap');
  });

  it('keeps manual drag available beyond the capture boundary without moving source erasure', () => {
    const block: OverlayBlock = {
      original: '原文', translated: 'Translation', sourceTier: 'OCR',
      logicalX: 41, logicalY: 20, logicalW: 355, logicalH: 20, layoutRight: 417,
      sourceX: 41, sourceY: 20, sourceW: 355, sourceH: 20,
      bgCss: '#9cf09f', fgCss: '#111111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    const card = container.querySelector('.overlay-block') as HTMLElement;
    fireEvent.mouseDown(card, { clientX: 41, clientY: 20, button: 0 });
    fireEvent.mouseMove(card, { clientX: 500, clientY: 20 });
    fireEvent.mouseUp(card);
    expect(card.style.left).toBe('500px');
    expect(parseFloat(card.style.maxWidth)).toBeGreaterThan(40);
    const erase = card.querySelector(':scope > div[aria-hidden]') as HTMLElement;
    expect(parseFloat(card.style.left) + parseFloat(erase.style.left)).toBe(36);
  });

  it('unlocks nowrap after user zoom even when no selection boundary is supplied', () => {
    // The shared canvas stub yields 100px width at the reference 100px font.
    const block: OverlayBlock = {
      original: 'Hello', translated: 'Hello', sourceTier: 'OCR',
      logicalX: 0, logicalY: 20, logicalW: 80, logicalH: 80,
      bgCss: '#ffffff', fgCss: '#111111',
    };
    const props = { block, blockIndex: 0, onClose: () => {}, isPinned: false, onTogglePin: () => {}, viewportWidth: 100 };
    const { container, rerender } = render(<OverlayBlockCard {...props} />);
    const card = container.querySelector('.overlay-block') as HTMLElement;
    expect(card.style.whiteSpace).toBe('nowrap');
    rerender(<OverlayBlockCard {...props} scale={2} />);
    expect(card.style.whiteSpace).toBe('pre-wrap');
    expect(card.style.maxWidth).toBe('80px');
  });

  const originalOnly: OverlayBlock = {
    original: '[OCR] 正在检测并释放端口', translated: '', sourceTier: 'OCR',
    logicalX: 20, logicalY: 40, logicalW: 300, logicalH: 22,
    bgCss: '#0c0c0c', fgCss: '#56d9dc',
  };

  it('does not shade static OCR text or claim it is still translating', () => {
    const { container } = render(<OverlayBlockCard block={originalOnly} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} />);
    expect(container.querySelector('.overlay-shimmer')).toBeNull();
    expect(container.querySelector('[data-overlay-main-text]')).not.toHaveClass('opacity-80');
    expect(container.querySelector('.overlay-block')?.getAttribute('title')).toContain('暂无译文');
  });

  it('shows pending feedback only while an unfinished translation is actually running', () => {
    const props = { block: originalOnly, blockIndex: 0, onClose: () => {}, isPinned: false, onTogglePin: () => {} };
    const { container, rerender } = render(<OverlayBlockCard {...props} translationPending />);
    expect(container.querySelector('.overlay-shimmer')).not.toBeNull();
    expect(container.querySelector('[data-overlay-main-text]')).toHaveClass('opacity-80');
    rerender(<OverlayBlockCard {...props} translationPending={false} />);
    expect(container.querySelector('.overlay-shimmer')).toBeNull();
    rerender(<OverlayBlockCard {...props} translationPending block={{ ...originalOnly, translated: 'Checking and releasing ports' }} />);
    expect(container.querySelector('.overlay-shimmer')).toBeNull();
  });

  it('keeps original view fully readable even while translation is running', () => {
    const { container } = render(<OverlayBlockCard block={originalOnly} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} translationPending viewMode="original" />);
    expect(container.querySelector('.overlay-shimmer')).toBeNull();
    expect(container.querySelector('[data-overlay-main-text]')).not.toHaveClass('opacity-80');
  });

  it('does not show a loading animation for a failed empty translation', () => {
    const { container } = render(<OverlayBlockCard block={{ ...originalOnly, translationFailed: true }} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} translationPending onRetry={() => {}} />);
    expect(container.querySelector('.overlay-shimmer')).toBeNull();
    expect(screen.getByRole('button', { name: '重试此段翻译' })).toBeInTheDocument();
    expect(container.querySelector('.overlay-block')?.getAttribute('title')).toContain('翻译失败');
  });

  it('uses an opaque card background when zoomed text outgrows its patch', () => {
    // The shared canvas stub measures 100px at the 100px reference font, i.e.
    // 20px at this card's initial font. Put the patch edge between the base
    // and zoomed width. Replacing getContext here would be order-dependent:
    // another card may already have initialized the shared measurement cache.
    const block: OverlayBlock = {
      original: 'HelloWorld',
      translated: 'HelloWorld',
      sourceTier: 'OCR',
      logicalX: 100,
      logicalY: 100,
      logicalW: 20,
      logicalH: 30,
      bgCss: '#eeeeee',
      fgCss: '#111111',
      patchPng: 'AA==',
      patchX: 98,
      patchY: 98,
      patchW: 24,
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

  it('keeps a column-bounded paragraph within its lane even when the user enlarges it', () => {
    const block: OverlayBlock = {
      original: '这是一行需要按栏宽换行的中文正文，不应侵入另一栏或推动另一栏文字',
      translated: 'A much longer translated paragraph '.repeat(10),
      sourceTier: 'OCR', logicalX: 30, logicalY: 100, logicalW: 410, logicalH: 22,
      layoutMaxWidth: 410, bgCss: '#fff', fgCss: '#111',
    };
    const { container, rerender } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} viewportWidth={1100} proseFontSize={13} />);
    const card = () => container.querySelector('.overlay-block') as HTMLElement;
    expect(card().style.maxWidth).toBe('410px');
    expect(card().style.whiteSpace).toBe('pre-wrap');
    rerender(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} viewportWidth={350} proseFontSize={13} scale={1.5} />);
    expect(card().style.maxWidth).toBe('300px');
    expect(card().style.whiteSpace).toBe('pre-wrap');
  });

  it('lets a short paragraph continuation use the confirmed column width', () => {
    const block: OverlayBlock = {
      original: '这是本段的简短末行', translated: 'A translated continuation of the same paragraph.',
      sourceTier: 'OCR', logicalX: 30, logicalY: 130, logicalW: 120, logicalH: 22,
      layoutMaxWidth: 410, bgCss: '#fff', fgCss: '#111',
    };
    const { container } = render(<OverlayBlockCard block={block} blockIndex={0} onClose={() => {}} isPinned={false} onTogglePin={() => {}} viewportWidth={1100} proseFontSize={13} />);
    expect((container.querySelector('.overlay-block') as HTMLElement).style.maxWidth).toBe('410px');
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
