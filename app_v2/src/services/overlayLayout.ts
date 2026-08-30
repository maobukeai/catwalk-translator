import { OverlayBlock } from './types';

/**
 * Resolves overlapping translated cards so glyphs can never visually stack.
 *
 * Collision boxes use the REAL rendered size when the card reported one
 * (aabbH / aabbW via ResizeObserver), falling back to the OCR logical box —
 * rendered text is typically 1.1–1.3× taller than the OCR box (font fit ×
 * 1.2 line-height) and can overflow horizontally, so logical-only boxes let
 * neighbours overlap.
 *
 * Pass 1 pushes colliding cards downward (top-down, cascading). Any
 * intersection ≥ COLLISION_EPS both axes counts — the old "40% of the smaller
 * height" tolerance is exactly what let half-overlapping lines stay stacked.
 * <3px jitter stays untouched so inflated DBNet boxes don't cascade-drift a
 * dense paragraph.
 *
 * Pass 2 handles bottom overflow by pulling the chain upward while preserving
 * ≥ margin gaps between vertically adjacent cards (the old proportional
 * subtraction closed gaps to negative values, re-stacking dense bottoms).
 * Only when the whole chain is taller than the container can overlap remain —
 * physically unsolvable without shrinking text.
 */
const COLLISION_EPS = 3;

/** Horizontal intersection of two blocks (> COLLISION_EPS → same column band). */
function overlapXOf<T extends OverlayBlock>(getW: (b: T) => number, a: T, b: T): number {
  return (
    Math.min(a.logicalX + getW(a), b.logicalX + getW(b)) - Math.max(a.logicalX, b.logicalX)
  );
}

export function resolveAABBCollisions<T extends OverlayBlock>(
  blocks: T[],
  containerWidth: number,
  containerHeight: number,
  margin = 4
): T[] {
  if (blocks.length === 0) return [];

  const getH = (b: T) => Math.max(b.aabbH ?? 0, b.logicalH);
  const getW = (b: T) => Math.max(b.aabbW ?? 0, b.logicalW);

  // Sort blocks by logicalY ascending
  const resolved = blocks.map((b) => ({ ...b })).sort((a, b) => a.logicalY - b.logicalY);
  const n = resolved.length;

  // 1. Top-down push operator (cascading: pushed cards re-check earlier cards)
  for (let j = 0; j < n; j++) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < j; i++) {
        const bi = resolved[i];
        const bj = resolved[j];

        const hi = getH(bi);
        const hj = getH(bj);

        const overlapX = overlapXOf(getW, bi, bj);
        const overlapY = Math.min(bi.logicalY + hi, bj.logicalY + hj) - Math.max(bi.logicalY, bj.logicalY);

        if (overlapX > COLLISION_EPS && overlapY > COLLISION_EPS) {
          const newY = bi.logicalY + hi + margin;
          if (newY > bj.logicalY) {
            resolved[j].logicalY = newY;
            changed = true;
          }
        }
      }
    }
  }

  // 2. Bottom overflow: pull the chain upward, gap-preserving (≥ margin) —
  // unlike proportional subtraction this can never re-introduce overlaps.
  // Constraint direction freezes the post-push vertical order: live positions
  // may invert while pulling (a card can end up above an earlier one), and the
  // frozen order keeps every horizontally-overlapping pair constrained
  // exactly once (the lower of the two clears the upper's top). Bottom-most
  // first, so each final position bounds everything above it. Multi-column
  // safe: only pairs sharing a column band (overlapX > eps) chain together.
  const snapY = resolved.map((b) => b.logicalY);
  const order = resolved.map((_, idx) => idx).sort((a, b) => snapY[b] - snapY[a]);
  for (const idx of order) {
    const bi = resolved[idx];
    const hi = getH(bi);
    let limitBottom = containerHeight;
    for (let j = 0; j < n; j++) {
      if (j === idx || snapY[j] <= snapY[idx]) continue;
      const bj = resolved[j];
      if (overlapXOf(getW, bi, bj) > COLLISION_EPS) {
        limitBottom = Math.min(limitBottom, bj.logicalY - margin);
      }
    }
    if (bi.logicalY + hi > limitBottom) {
      bi.logicalY = limitBottom - hi;
    }
  }

  // 3. Final clamp: nothing above the top edge; integer pixels (fractional
  // coordinates render as blurry subpixel text). Rounding jitter ≤1px is
  // absorbed by the 4px margin. When the whole chain cannot fit the screen
  // the top rows may exceed upward — unavoidable without shrinking text.
  for (let i = 0; i < n; i++) {
    resolved[i].logicalY = Math.round(Math.max(0, resolved[i].logicalY));
  }

  return resolved;
}
