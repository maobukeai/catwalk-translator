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
    // 整数像素位置：AABB 推挤/上压产生的分数坐标会让文字亚像素渲染发虚
    b.logicalY = Math.round(Math.max(0, Math.min(containerHeight - bh, b.logicalY)));
  }

  return resolved;
}

