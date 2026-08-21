import { describe, it, expect } from 'vitest';
import { resolveAABBCollisions, calculateTooltipPosition } from '../services/overlayLayout';
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

    it('ignores tiny overlaps below threshold (overlapX <= 8 or overlapY <= minH * 0.4)', () => {
      // Horizontal overlap is only 6px (<= 8)
      const block1 = createMockBlock('1', 50, 100, 100, 30); // X: [50, 150]
      const block2 = createMockBlock('2', 144, 110, 100, 30); // X: [144, 244], overlapX = 6
      const resolvedX = resolveAABBCollisions([block1, block2], 800, 600, 4);
      expect(resolvedX[1].logicalY).toBe(110); // unchanged

      // Vertical overlap is only 5px (<= 30 * 0.4 = 12)
      const block3 = createMockBlock('3', 50, 100, 100, 30); // Y: [100, 130]
      const block4 = createMockBlock('4', 50, 125, 100, 30); // Y: [125, 155], overlapY = 5
      const resolvedY = resolveAABBCollisions([block3, block4], 800, 600, 4);
      expect(resolvedY[1].logicalY).toBe(125); // unchanged
    });

    it('compresses blocks upward if bottom overflow occurs', () => {
      // Container height is 200
      // block1: Y=100, H=50 -> bottom is 150
      // block2: Y=120, H=50 -> overlapY = 30 > 50*0.4=20. After push, Y2 = 154, bottom = 204 (overflows 200 by 4)
      const block1 = createMockBlock('1', 50, 100, 100, 50);
      const block2 = createMockBlock('2', 50, 120, 100, 50);
      
      const resolved = resolveAABBCollisions([block1, block2], 800, 200, 4);
      expect(resolved).toHaveLength(2);
      
      // Without compression: block1=100, block2=154 (overflow = 204 - 200 = 4)
      // Compression pushes block1 by (1/2)*4 = 2 -> Y1 = 98
      // Compression pushes block2 by (2/2)*4 = 4 -> Y2 = 150
      expect(resolved[0].logicalY).toBe(98);
      expect(resolved[1].logicalY).toBe(150);
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

  describe('calculateTooltipPosition', () => {
    it('places tooltip on top when space is sufficient', () => {
      const block = { logicalX: 100, logicalY: 100, logicalW: 80, logicalH: 20 };
      const pos = calculateTooltipPosition(block, 800, 600, 120, 40);
      
      expect(pos.placement).toBe('top');
      // y should be: block.logicalY - tooltipH - 8 = 100 - 40 - 8 = 52
      expect(pos.y).toBe(52);
      // x should be centered: 100 + (80 - 120)/2 = 80
      expect(pos.x).toBe(80);
    });

    it('flips tooltip to bottom when top space is insufficient (< 10px)', () => {
      const block = { logicalX: 100, logicalY: 30, logicalW: 80, logicalH: 20 };
      // tooltipH is 40. candidateY = 30 - 40 - 8 = -18 (which is < 10)
      const pos = calculateTooltipPosition(block, 800, 600, 120, 40);
      
      expect(pos.placement).toBe('bottom');
      // y should be: block.logicalY + block.logicalH + 8 = 30 + 20 + 8 = 58
      expect(pos.y).toBe(58);
    });

    it('clamps tooltip X coordinate to screen boundaries', () => {
      // Near left boundary
      const blockLeft = { logicalX: 10, logicalY: 100, logicalW: 20, logicalH: 20 };
      const posLeft = calculateTooltipPosition(blockLeft, 800, 600, 100, 30);
      // Centered X would be: 10 + (20 - 100)/2 = -30
      // Clamped to minimum 8
      expect(posLeft.x).toBe(8);

      // Near right boundary
      const blockRight = { logicalX: 770, logicalY: 100, logicalW: 20, logicalH: 20 };
      const posRight = calculateTooltipPosition(blockRight, 800, 600, 100, 30);
      // Centered X would be: 770 + (20 - 100)/2 = 730
      // Max boundary: 800 - 100 - 8 = 692
      expect(posRight.x).toBe(692);
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
