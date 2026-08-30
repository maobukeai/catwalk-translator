import { describe, it, expect } from 'vitest';
import { resolveAABBCollisions } from '../services/overlayLayout';
import { OverlayBlock } from '../services/types';
import { toTranslucentBg, toSolidBg, isLightBg } from '../components/Overlay/OverlayBlockCard';

describe('overlayLayout AABB Collision & Tooltip Algorithms', () => {
  const createMockBlock = (id: string, x: number, y: number, w: number, h: number): OverlayBlock => ({
    original: `original-${id}`,
    translated: `translated-${id}`,
    sourceTier: 'test',
    logicalX: x,
    logicalY: y,
    logicalW: w,
    logicalH: h,
    bgCss: 'rgba(0, 0, 0, 0.8)',
    fgCss: '#ffffff',
  });

  describe('resolveAABBCollisions', () => {
    it('does not modify coordinates of a single block that fits', () => {
      const block = createMockBlock('1', 50, 100, 100, 30);
      const resolved = resolveAABBCollisions([block], 800, 600);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].logicalY).toBe(100);
      expect(resolved[0].logicalX).toBe(50);
    });

    it('resolves vertical overlap by pushing subsequent blocks down', () => {
      // Two blocks at the same X and overlapping on Y
      const block1 = createMockBlock('1', 50, 100, 100, 30);
      const block2 = createMockBlock('2', 60, 110, 100, 30); // overlaps block1 on Y (overlap 20 > 30*0.4=12) and X (90 > 8)
      
      const resolved = resolveAABBCollisions([block1, block2], 800, 600, 4);
      expect(resolved).toHaveLength(2);
      // block1 should remain at 100
      expect(resolved[0].logicalY).toBe(100);
      // block2 should be pushed to 100 + 30 + 4 = 134
      expect(resolved[1].logicalY).toBe(134);
    });

    it('does not push if they do not overlap horizontally', () => {
      const block1 = createMockBlock('1', 50, 100, 100, 30);
      const block2 = createMockBlock('2', 200, 110, 100, 30); // overlaps on Y, but X is far away
      
      const resolved = resolveAABBCollisions([block1, block2], 800, 600);
      expect(resolved).toHaveLength(2);
      expect(resolved[0].logicalY).toBe(100);
      expect(resolved[1].logicalY).toBe(110);
    });

    it('ignores sub-glyph jitter below the 3px threshold', () => {
      // Horizontal overlap is only 2px (<= 3)
      const block1 = createMockBlock('1', 50, 100, 100, 30); // X: [50, 150]
      const block2 = createMockBlock('2', 148, 110, 100, 30); // X: [148, 248], overlapX = 2
      const resolvedX = resolveAABBCollisions([block1, block2], 800, 600, 4);
      expect(resolvedX[1].logicalY).toBe(110); // unchanged

      // Vertical overlap is only 2px (<= 3)
      const block3 = createMockBlock('3', 50, 100, 100, 30); // Y: [100, 130]
      const block4 = createMockBlock('4', 50, 128, 100, 30); // Y: [128, 158], overlapY = 2
      const resolvedY = resolveAABBCollisions([block3, block4], 800, 600, 4);
      expect(resolvedY[1].logicalY).toBe(128); // unchanged
    });

    it('pushes on a small partial overlap the old 40% tolerance left stacked', () => {
      // 6px vertical intersection (< 30*0.4 = 12) used to be tolerated — the
      // exact "text stacked together" complaint. Any real overlap must push.
      const block1 = createMockBlock('1', 50, 100, 200, 30); // Y: [100, 130]
      const block2 = createMockBlock('2', 50, 124, 200, 30); // Y: [124, 154], overlapY = 6
      const resolved = resolveAABBCollisions([block1, block2], 800, 600, 4);
      expect(resolved[0].logicalY).toBe(100);
      expect(resolved[1].logicalY).toBe(134); // 100 + 30 + 4
    });

    it('uses aabbW for horizontal collision when the rendered card is wider', () => {
      // logicalW says the cards do not overlap horizontally (150 < 200), but
      // block1 really renders 260px wide (nowrap overflow) — block2 must move.
      const block1 = { ...createMockBlock('1', 50, 100, 100, 30), aabbW: 260 }; // X: [50, 310]
      const block2 = createMockBlock('2', 200, 105, 100, 30); // X: [200, 300]
      const resolved = resolveAABBCollisions([block1, block2], 800, 600, 4);
      expect(resolved[0].logicalY).toBe(100);
      expect(resolved[1].logicalY).toBe(134); // 100 + 30 + 4
    });

    it('pulls an overflowing multi-column chain up while preserving margins', () => {
      // Container height 200. Same-column chain A→B→C overflows after the push
      // pass; the pull-up must keep exact 4px gaps and clamp to the bottom.
      // D sits in another column: it only clamps to the container, never gets
      // dragged by (or drags) the chain.
      const blockA = createMockBlock('A', 50, 100, 100, 60); // Y: [100, 160]
      const blockB = createMockBlock('B', 50, 150, 100, 60); // pushed to 164 → bottom 224
      const blockC = createMockBlock('C', 50, 220, 100, 60); // pushed to 228 → bottom 288
      const blockD = createMockBlock('D', 400, 190, 50, 20); // other column, bottom 210
      const resolved = resolveAABBCollisions([blockA, blockB, blockC, blockD], 800, 200, 4);
      const byId = (id: string) => resolved.find((b) => b.original === `original-${id}`)!;
      expect(byId('A').logicalY).toBe(12); // 76 - 4 - 60
      expect(byId('B').logicalY).toBe(76); // 140 - 4 - 60
      expect(byId('C').logicalY).toBe(140); // 200 - 60
      expect(byId('D').logicalY).toBe(180); // 200 - 20, untouched by the chain
      // Margins between chain cards stay exactly `margin`
      expect(byId('B').logicalY - (byId('A').logicalY + 60)).toBe(4);
      expect(byId('C').logicalY - (byId('B').logicalY + 60)).toBe(4);
      expect(byId('C').logicalY + 60).toBeLessThanOrEqual(200);
    });

    it('compresses blocks upward if bottom overflow occurs', () => {
      // Container height is 200
      // block1: Y=100, H=50 -> bottom is 150
      // block2: Y=120, H=50 -> overlapY = 30. After push, Y2 = 154, bottom = 204 (overflows 200 by 4)
      const block1 = createMockBlock('1', 50, 100, 100, 50);
      const block2 = createMockBlock('2', 50, 120, 100, 50);

      const resolved = resolveAABBCollisions([block1, block2], 800, 200, 4);
      expect(resolved).toHaveLength(2);

      // Pull-up pass clamps block2 to the container bottom (150), then pulls
      // block1 up to keep the exact 4px margin (96) — no negative gaps.
      expect(resolved[0].logicalY).toBe(96);
      expect(resolved[1].logicalY).toBe(150);
      expect(resolved[1].logicalY - (resolved[0].logicalY + 50)).toBe(4);
      expect(resolved[1].logicalY + resolved[1].logicalH).toBeLessThanOrEqual(200);
    });

    it('clamps coordinates to container boundary [0, containerHeight - h]', () => {
      const block = createMockBlock('1', 50, 580, 100, 40); // partially overflows 600 height
      const resolved = resolveAABBCollisions([block], 800, 600);
      expect(resolved[0].logicalY).toBe(560); // 600 - 40
    });

    it('uses aabbH when provided to push collision boundaries while preserving logicalH', () => {
      // block1 logicalH is 20, but rendered aabbH is 40
      const block1 = { ...createMockBlock('1', 50, 100, 100, 20), aabbH: 40 };
      const block2 = { ...createMockBlock('2', 50, 110, 100, 20), aabbH: 20 };
      const resolved = resolveAABBCollisions([block1, block2], 800, 600, 4);
      expect(resolved).toHaveLength(2);
      expect(resolved[0].logicalH).toBe(20);
      expect(resolved[0].aabbH).toBe(40);
      // block2 should be pushed past block1's aabbH: 100 + 40 + 4 = 144
      expect(resolved[1].logicalY).toBe(144);
      expect(resolved[1].logicalH).toBe(20);
    });
  });

  describe('Overlay card styling helpers: toSolidBg, toTranslucentBg & isLightBg', () => {
    it('toSolidBg transforms sampled colors into 100% opaque solid background to prevent bleed-through', () => {
      expect(toSolidBg('rgb(20, 24, 30)')).toBe('rgb(20, 24, 30)');
      expect(toSolidBg('rgba(20, 24, 30, 0.5)')).toBe('rgb(20, 24, 30)');
      expect(toSolidBg('#14181e')).toBe('#14181e');
      expect(toSolidBg('#ffffff')).toBe('#ffffff');
      expect(toSolidBg('#fff')).toBe('#ffffff');
      expect(toSolidBg('#ffffff80')).toBe('#ffffff');
      expect(toSolidBg('hsl(210, 50%, 60%)')).toBe('hsl(210, 50%, 60%)');
      expect(toSolidBg('hsla(210, 50%, 60%, 0.5)')).toBe('hsl(210, 50%, 60%)');
      expect(toSolidBg(undefined)).toBe('#0d1117');
      expect(toSolidBg('')).toBe('#0d1117');
      expect(toSolidBg('transparent')).toBe('#0d1117');
      expect(toSolidBg(undefined, '#000000')).toBe('#ffffff');
      expect(toSolidBg('transparent', '#000000')).toBe('#ffffff');
    });

    it('toTranslucentBg transforms rgb/hex/hsl colors into frosted translucent rgba', () => {
      expect(toTranslucentBg('rgb(20, 24, 30)')).toBe('rgba(20, 24, 30, 0.78)');
      expect(toTranslucentBg('rgb(20,24,30)', 0.85)).toBe('rgba(20, 24, 30, 0.85)');
      expect(toTranslucentBg('rgba(20, 24, 30, 0.5)', 0.78)).toBe('rgba(20, 24, 30, 0.78)');
      expect(toTranslucentBg('#14181e')).toBe('rgba(20, 24, 30, 0.78)');
      expect(toTranslucentBg('#ffffff')).toBe('rgba(255, 255, 255, 0.78)');
      expect(toTranslucentBg('#fff')).toBe('rgba(255, 255, 255, 0.78)');
      expect(toTranslucentBg('hsl(210, 50%, 60%)')).toBe('hsla(210, 50%, 60%, 0.78)');
      expect(toTranslucentBg(undefined)).toBe('rgba(18, 24, 38, 0.78)');
      expect(toTranslucentBg('')).toBe('rgba(18, 24, 38, 0.78)');
      expect(toTranslucentBg('transparent')).toBe('rgba(18, 24, 38, 0.78)');
    });

    it('isLightBg correctly detects light vs dark backgrounds for translucent borders', () => {
      expect(isLightBg('rgb(20, 24, 30)')).toBe(false);
      expect(isLightBg('#14181e')).toBe(false);
      expect(isLightBg('rgb(240, 240, 240)')).toBe(true);
      expect(isLightBg('#ffffff')).toBe(true);
      expect(isLightBg('#fff')).toBe(true);
      expect(isLightBg(undefined, '#000000')).toBe(true);
      expect(isLightBg('rgb(20, 24, 30)', '#000000')).toBe(true);
      expect(isLightBg('rgb(20, 24, 30)', '#ffffff')).toBe(false);
    });
  });
});
