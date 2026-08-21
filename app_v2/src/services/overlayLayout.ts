import { OverlayBlock } from './types';

/**
 * Resolves overlapping text blocks using AABB collision detection and top-down push algorithm.
 * If the bottom overflow occurs, it compresses upward and clamps everything to [0, containerHeight - h].
 * Generic in T so callers can attach bookkeeping fields (orig index, rendered
 * height…) that survive the internal sort-and-push.
 */
export function resolveAABBCollisions<T extends OverlayBlock>(
  blocks: T[],
  containerWidth: number,
  containerHeight: number,
  margin = 4
): T[] {
  if (blocks.length === 0) return [];

  const getH = (b: T) => b.aabbH ?? b.logicalH;

  // Sort blocks by logicalY ascending
  const resolved = blocks.map((b) => ({ ...b })).sort((a, b) => a.logicalY - b.logicalY);
  const n = resolved.length;

  // 1. Top-down push operator
  for (let j = 0; j < n; j++) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < j; i++) {
        const bi = resolved[i];
        const bj = resolved[j];

        const hi = getH(bi);
        const hj = getH(bj);

        // AABB intersection check
        const overlapX = Math.min(bi.logicalX + bi.logicalW, bj.logicalX + bj.logicalW) - Math.max(bi.logicalX, bj.logicalX);
        const overlapY = Math.min(bi.logicalY + hi, bj.logicalY + hj) - Math.max(bi.logicalY, bj.logicalY);

        const minH = Math.min(hi, hj);
        if (overlapX > 8 && overlapY > minH * 0.4) {
          const newY = bi.logicalY + hi + margin;
          if (newY > bj.logicalY) {
            resolved[j].logicalY = newY;
            changed = true;
          }
        }
      }
    }
  }

  // 2. Bottom overflow upward compression
  if (n > 0) {
    const lastBlock = resolved[n - 1];
    const bottomLimit = containerHeight;
    const lastH = getH(lastBlock);
    const lastBottom = lastBlock.logicalY + lastH;
    
    if (lastBottom > bottomLimit) {
      const overflow = lastBottom - bottomLimit;
      for (let k = 0; k < n; k++) {
        // Apply compression: k ranges 0 to n-1, so (k + 1)/n ranges up to 1
        resolved[k].logicalY -= ((k + 1) / n) * overflow;
      }
    }
  }

  // 3. Final Boundary Clamp to [0, containerHeight - h]
  for (let i = 0; i < n; i++) {
    const b = resolved[i];
    const bh = getH(b);
    b.logicalY = Math.max(0, Math.min(containerHeight - bh, b.logicalY));
  }

  return resolved;
}

/**
 * Calculates adaptive position for a tooltip relative to a block.
 * Default position is on top of the block. If space is less than 10px, it flips to the bottom.
 * The x-coordinate is centered and clamped to [8, containerWidth - tooltipW - 8].
 */
export function calculateTooltipPosition(
  block: { logicalX: number; logicalY: number; logicalW: number; logicalH: number },
  containerWidth: number,
  containerHeight: number,
  tooltipW: number,
  tooltipH: number
): { x: number; y: number; placement: 'top' | 'bottom' } {
  // Y placement logic
  const candidateY = block.logicalY - tooltipH - 8;
  let placement: 'top' | 'bottom' = 'top';
  let y = candidateY;

  if (candidateY < 10) {
    placement = 'bottom';
    y = block.logicalY + block.logicalH + 8;
  }

  // X placement logic
  const centerX = block.logicalX + (block.logicalW - tooltipW) / 2;
  const minX = 8;
  const maxX = Math.max(8, containerWidth - tooltipW - 8);
  const x = Math.max(minX, Math.min(maxX, centerX));

  // Clamp Y to container boundaries just in case
  const minY = 8;
  const maxY = Math.max(8, containerHeight - tooltipH - 8);
  y = Math.max(minY, Math.min(maxY, y));

  return { x, y, placement };
}
