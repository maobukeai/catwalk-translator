import { describe, expect, it } from 'vitest';
import { resolveAABBCollisions } from '../services/overlayLayout';
import type { OverlayBlock } from '../services/types';

const block = (id: string, y: number, renderedHeight: number, x = 50): OverlayBlock => ({
  original: `Paragraph ${id}: a sufficiently long sentence, not a toolbar label.`,
  translated: `Translation ${id}`, sourceTier: 'test', bgCss: '#fff', fgCss: '#111',
  logicalX: x, logicalY: y, logicalW: 260, logicalH: 20, aabbH: renderedHeight,
  sourceX: x, sourceY: y, sourceW: 260, sourceH: 20,
  patchX: x - 2, patchY: y - 2, patchW: 264, patchH: 24,
});

describe('in-place vertical selection bounds', () => {
  it('uses nearby selection space instead of overflowing into the rest of the desktop', () => {
    const input = [block('a', 130, 45), block('b', 180, 45)];
    const result = resolveAABBCollisions(input, 1200, 900, 4, { top: 100, bottom: 200 });
    expect(result.map(row => row.logicalY)).toEqual([106, 155]);
    expect(result[1].logicalY + result[1].aabbH!).toBe(200);
    expect(input.map(row => row.logicalY)).toEqual([130, 180]);
  });

  it('leaves a fitting paragraph in its source position', () => {
    const input = [block('a', 120, 25), block('b', 160, 25)];
    expect(resolveAABBCollisions(input, 1200, 900, 4, { top: 100, bottom: 220 }))
      .toEqual(input);
  });

  it('never clamps an impossible chain into overlapping rows at the selection top', () => {
    const result = resolveAABBCollisions([block('b', 140, 50), block('a', 110, 50)], 1200, 900, 4, { top: 100, bottom: 160 });
    expect(result.map(row => row.logicalY)).toEqual([100, 154]);
    expect(result.map(row => row.aabbH)).toEqual([50, 50]);
    expect(result.map(row => row.translated)).toEqual(['Translation a', 'Translation b']);
    expect(result[1].logicalY + result[1].aabbH!).toBeGreaterThan(160);
  });

  it('also preserves spacing when a chain is taller than the entire viewport', () => {
    const result = resolveAABBCollisions([block('a', 10, 90), block('b', 80, 90), block('c', 160, 90)], 1200, 160);
    expect(result.map(row => row.logicalY)).toEqual([0, 94, 188]);
  });

  it('does not let an oversized left column move an independent right column', () => {
    const input = [block('a', 100, 90), block('b', 170, 90), block('c', 150, 25, 550)];
    const result = resolveAABBCollisions(input, 1200, 900, 4, { top: 60, bottom: 200 });
    expect(result.find(row => row.translated === 'Translation c')!.logicalY).toBe(150);
    expect(result.find(row => row.translated === 'Translation a')!.logicalY).toBe(60);
    expect(result.find(row => row.translated === 'Translation b')!.logicalY).toBe(154);
  });

  it('preserves an oversized card instead of shrinking or clipping its text', () => {
    const input = block('tall', 130, 110);
    expect(resolveAABBCollisions([input], 1200, 900, 4, { top: 100, bottom: 160 })[0])
      .toEqual({ ...input, logicalY: 100 });
  });

  it('keeps fractional rendered heights inside the crop and retains the minimum gap', () => {
    const result = resolveAABBCollisions([block('a', 130, 26.375), block('b', 153, 26.375)], 1200, 900, 4, { top: 100.25, bottom: 170.5 });
    expect(result[0].logicalY).toBeGreaterThanOrEqual(100.25);
    expect(result[1].logicalY - result[0].logicalY - 26.375).toBeGreaterThanOrEqual(4);
    expect(result[1].logicalY + 26.375).toBeLessThanOrEqual(170.5);
  });

  it('preserves OCR geometry and erase anchors after moving display cards', () => {
    const input = [block('a', 130, 45), block('b', 180, 45)];
    const result = resolveAABBCollisions(input, 1200, 900, 4, { top: 100, bottom: 200 });
    for (let i = 0; i < result.length; i++) {
      const { logicalY: _sourceY, ...source } = input[i];
      const { logicalY: _displayY, ...display } = result[i];
      expect(display).toEqual(source);
    }
  });

  it.each([
    { top: NaN, bottom: 200 }, { top: 100, bottom: Infinity },
    { top: 300, bottom: 200 }, { top: 900, bottom: 1000 },
    { top: 100.2, bottom: 100.8 },
  ])('falls back to the viewport for invalid bounds: %j', bounds => {
    const input = [block('a', 830, 90)];
    expect(resolveAABBCollisions(input, 1200, 900, 4, bounds))
      .toEqual(resolveAABBCollisions(input, 1200, 900));
  });

  it('fits varied feasible multi-column chains without changing their text or size', () => {
    let seed = 1747;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let sample = 0; sample < 100; sample++) {
      const input: OverlayBlock[] = [];
      for (let column = 0; column < 3; column++) {
        for (let row = 0; row < 6; row++) {
          input.push(block(`${column}-${row}`, 300 + row * 30 + random() * 10, 20 + random() * 20, 20 + column * 310));
        }
      }
      const result = resolveAABBCollisions(input, 1200, 900, 4, { top: 100, bottom: 500 });
      for (let column = 0; column < 3; column++) {
        const rows = result.filter(row => row.logicalX === 20 + column * 310).sort((a, b) => a.logicalY - b.logicalY);
        expect(rows).toHaveLength(6);
        rows.forEach((row, index) => {
          expect(row.logicalY).toBeGreaterThanOrEqual(100);
          expect(row.logicalY + row.aabbH!).toBeLessThanOrEqual(500);
          if (index > 0) expect(row.logicalY - rows[index - 1].logicalY - rows[index - 1].aabbH!).toBeGreaterThanOrEqual(4);
          const source = input.find(candidate => candidate.original === row.original)!;
          expect(row.translated).toBe(source.translated);
          expect(row.aabbH).toBe(source.aabbH);
          expect(row.logicalH).toBe(source.logicalH);
        });
      }
    }
  });
});
