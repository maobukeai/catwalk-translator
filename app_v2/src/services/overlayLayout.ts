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

/** Clamp fallback erasure to the space halfway to neighbouring OCR boxes. */
export function estimateSafeErasePadding(
  blocks: Array<Pick<OverlayBlock, 'logicalX' | 'logicalY' | 'logicalW' | 'logicalH'>>,
): Array<{ left: number; right: number; top: number; bottom: number }> {
  return blocks.map((block, index) => {
    const padding = { left: 5, right: 5, top: 8, bottom: 8 };
    const x1 = block.logicalX, x2 = x1 + block.logicalW;
    const y1 = block.logicalY, y2 = y1 + block.logicalH;
    for (let j = 0; j < blocks.length; j++) {
      if (j === index) continue;
      const other = blocks[j];
      const ox1 = other.logicalX, ox2 = ox1 + other.logicalW;
      const oy1 = other.logicalY, oy2 = oy1 + other.logicalH;
      const overlapX = Math.min(x2, ox2) - Math.max(x1, ox1);
      const overlapY = Math.min(y2, oy2) - Math.max(y1, oy1);
      if (overlapX > Math.min(block.logicalW, other.logicalW) * 0.25) {
        if (oy2 <= y1) padding.top = Math.min(padding.top, Math.max(0, Math.floor((y1 - oy2) / 2)));
        else if (oy1 >= y2) padding.bottom = Math.min(padding.bottom, Math.max(0, Math.floor((oy1 - y2) / 2)));
        else if (oy1 < y1) padding.top = 0;
        else if (oy1 > y1) padding.bottom = 0;
      }
      if (overlapY > Math.min(block.logicalH, other.logicalH) * 0.35) {
        if (ox2 <= x1) padding.left = Math.min(padding.left, Math.max(0, Math.floor((x1 - ox2) / 2)));
        else if (ox1 >= x2) padding.right = Math.min(padding.right, Math.max(0, Math.floor((ox1 - x2) / 2)));
        else if (ox1 < x1) padding.left = 0;
        else if (ox1 > x1) padding.right = 0;
      }
    }
    return padding;
  });
}

function denseProseGroups(
  blocks: Array<Pick<OverlayBlock, 'original' | 'logicalY' | 'logicalH'> & Partial<Pick<OverlayBlock, 'logicalX' | 'logicalW'>>>,
  heights: number[],
): number[][] {
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[a].logicalY - blocks[b].logicalY);
  // Commands and file paths are independent console rows, not a wrapped
  // paragraph. Sharing one width-fitted font with the next log entry makes
  // ordinary short rows shrink merely because a neighbouring path is long.
  const codeLike = (text: string) => /[A-Za-z]:\\|\\(?:src-tauri|target)\\|(?:^|\s)>\s*(?:npm|cargo|app_v\d)|--[a-z][\w-]{2,}/i.test(text);
  const isLongRow = (i: number) => (blocks[i].logicalW ?? 0) >= 280
    // This grouping is for body prose. A two-line display heading can have
    // the same X alignment and spacing, but must keep its title-sized font.
    && heights[i] <= 32
    && !blocks[i].original.includes('\n')
    && !codeLike(blocks[i].original)
    && blocks[i].original.replace(/\s/g, '').length >= 26;
  const groups: number[][] = [];
  let active: number[] | undefined;
  for (const index of order) {
    const previousIndex = active?.[active.length - 1];
    if (previousIndex !== undefined) {
      const previous = blocks[previousIndex];
      const current = blocks[index];
      const referenceH = Math.max(heights[previousIndex], heights[index]);
      const deltaY = current.logicalY - previous.logicalY;
      const continuation = !isLongRow(index)
        && heights[index] <= 32
        && (current.logicalW ?? 0) >= 80
        && current.original.replace(/\s/g, '').length >= 8
        && !/[。！？.!?;:：]\s*$/.test(previous.original);
      if (Math.abs((current.logicalX ?? 0) - (previous.logicalX ?? 0)) <= 24
        && referenceH / Math.max(1, Math.min(heights[previousIndex], heights[index])) <= 1.3
        // A long row after a paragraph gap is a new paragraph even when its
        // left edge and font height match. Allowing 1.7x joined separate
        // paragraphs in the real dense Chinese screenshot and made one long
        // translation shrink unrelated lines through the shared font fit.
        && deltaY >= referenceH * 0.8 && deltaY <= referenceH * 1.4
        && (isLongRow(index) || continuation)) {
        active!.push(index);
        continue;
      }
    }
    active = isLongRow(index) ? [index] : undefined;
    if (active) groups.push(active);
  }
  return groups.filter((group) => group.length >= 2);
}

function isDenseTerminalOverlay(
  blocks: Array<Pick<OverlayBlock, 'original' | 'logicalY' | 'logicalH'> & Partial<Pick<OverlayBlock, 'bgCss'>>>,
): boolean {
  if (blocks.length < 12) return false;
  const dark = blocks.filter((block) => {
    const color = block.bgCss?.trim().toLowerCase() ?? '';
    const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb) return Math.max(+rgb[1], +rgb[2], +rgb[3]) <= 55;
    const hex = color.match(/^#([0-9a-f]{6})$/);
    return !!hex && Math.max(...[0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16))) <= 55;
  }).length;
  const cues = blocks.filter((block) => /^(?:>|\[OCR\]|\[\*\])|Running|cargo|https?:\/\/|VITE/.test(block.original)).length;
  const compact = blocks.filter((block) => block.logicalY >= 36
    && block.logicalH >= 12 && block.logicalH <= 28
    && !block.original.includes('\n')).length;
  return dark >= blocks.length * 0.8 && cues >= 2 && compact >= blocks.length * 0.7;
}

/**
 * Estimate a stable per-line source height for font sizing. OCR boxes in a
 * dense toolbar often include inconsistent padding or absorb a nearby glyph;
 * sizing each card directly from that raw height makes one translated label
 * much larger than its neighbours. Use nearby blocks on the same visual row
 * as a local reference, while leaving isolated headings and sparse layouts
 * untouched.
 */
export function estimateDenseRowFontHeights(
  blocks: Array<Pick<OverlayBlock, 'original' | 'logicalY' | 'logicalH'> & Partial<Pick<OverlayBlock, 'logicalX' | 'logicalW' | 'bgCss'>>>
): number[] {
  const heights = blocks.map((block) => {
    const lineCount = Math.max(1, block.original.split(/\r?\n/).filter(Boolean).length);
    return Math.max(1, block.logicalH / lineCount);
  });
  const rows: number[][] = [];
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[a].logicalY - blocks[b].logicalY);

  for (const index of order) {
    const row = rows.find((indices) => {
      const rowYs = indices.map((i) => blocks[i].logicalY);
      const minY = Math.min(...rowYs, blocks[index].logicalY);
      const maxY = Math.max(...rowYs, blocks[index].logicalY);
      return maxY - minY <= 6;
    });
    if (row) row.push(index);
    else rows.push([index]);
  }

  const normalized = [...heights];
  for (const row of rows) {
    if (row.length < 2) continue;
    const sortedHeights = row.map((i) => heights[i]).sort((a, b) => a - b);
    // The lower median resists tall outlier boxes better when a row has an
    // even number of OCR blocks (e.g. one icon-sized false detection).
    const reference = sortedHeights[Math.floor((sortedHeights.length - 1) / 2)];
    for (const index of row) {
      const ratio = heights[index] / reference;
      if (row.length >= 3) {
        normalized[index] = Math.min(
          Math.max(heights[index], reference * 0.8),
          reference * 1.2
        );
      } else if (ratio >= 1.55) {
        // With only two peers, adjust only a clear outlier; ordinary mixed-size
        // labels are too ambiguous to flatten confidently.
        normalized[index] = Math.min(heights[index], reference * 1.2);
      }
    }
  }
  // A paragraph is commonly detected as one box per physical line. DBNet
  // padding may differ by several pixels between those lines even though the
  // source font is uniform. Normalize only neighbouring long rows with the
  // same left margin; do not flatten headings, buttons or unrelated columns.
  for (const group of denseProseGroups(blocks, heights)) {
    const sorted = group.map((i) => normalized[i]).sort((a, b) => a - b);
    const reference = (sorted[Math.floor((sorted.length - 1) / 2)]
      + sorted[Math.floor(sorted.length / 2)]) / 2;
    for (const index of group) {
      normalized[index] = reference;
    }
  }
  // Terminal glyphs occupy more of a detector box than proportional UI text.
  // Use one scene-wide body reference: per-fragment scaling is what produces
  // the user's "one word big, next word small" effect in dense log captures.
  if (isDenseTerminalOverlay(blocks)) {
    const body = normalized.filter((_, i) => blocks[i].logicalY >= 36).sort((a, b) => a - b);
    const reference = body[Math.floor(body.length / 2)];
    if (reference > 0 && body.filter((height) => height >= reference * 0.7
      && height <= reference * 1.3).length >= body.length * 0.8) {
      return normalized.map((height, i) => blocks[i].logicalY >= 36 ? reference * 1.18 : height);
    }
  }
  return normalized;
}

/** Keep physical lines of one paragraph at one size after width fitting. */
export function estimateDenseProseFontSizes(
  blocks: OverlayBlock[], heights: number[], viewportWidth: number,
  measure: (text: string, fontSize: number) => number,
  showOriginal = false,
): (number | undefined)[] {
  const sizes: (number | undefined)[] = blocks.map(() => undefined);
  for (const group of denseProseGroups(blocks, heights)) {
    const baseSizes: number[] = [];
    const fitted = group.map((i) => {
      const block = blocks[i];
      const original = block.original;
      const nonSpace = Math.max(1, original.replace(/\s/g, '').length);
      const cjkCount = (original.match(/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g) || []).length;
      const base = Math.max(10, heights[i]) * (cjkCount / nonSpace > 0.3 ? 0.72 : 0.66);
      baseSizes.push(base);
      const text = (showOriginal ? original : block.translated || original).replace(/\s*\n+\s*/g, ' ').trim();
      const measured = measure(text, base) || text.length * base * (cjkCount / nonSpace > 0.3 ? 1.05 : 0.52);
      const cardMaxWidth = Math.max(40, Math.min(
        Math.max(40, viewportWidth - block.logicalX - 20),
        Math.max(Math.round(block.logicalW * 1.6 + 16), 120),
      ));
      const allowed = Math.min(Math.max(block.logicalW * 1.05, 60), Math.max(cardMaxWidth - 4, 40));
      return measured > allowed ? base * allowed / measured * 0.97 : base;
    });
    const sortedBases = [...baseSizes].sort((a, b) => a - b);
    const medianBase = sortedBases[Math.floor(sortedBases.length / 2)];
    // A single very long translation must not force the whole paragraph to
    // 9px. Keep a source-relative readable floor; overflowing rows wrap and
    // the AABB resolver moves the subsequent cards.
    const commonSize = Math.min(medianBase, Math.max(11, medianBase * 0.78, Math.min(...fitted)));
    for (const i of group) sizes[i] = commonSize;
  }
  return sizes;
}

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

  // ── 0. 横向菜单栏同行弹性避让与微缩 (Horizontal Same-Row Elastic Avoidance & Scaling) ──
  // 针对基线高度完全一致或极其贴近 (<= 4px)、原本沿水平方向并排的菜单项或工具栏按钮，
  // 杜绝因译文稍宽直接被视作纵向冲突下推成阶梯状折行
  // Connected components make adjacency transitive: File→Edit→Render→Window
  // stays one toolbar even when Window is too far from File to be its direct
  // neighbour. Constrain the *whole* component's baseline/height spread so
  // a staircase of OCR boxes cannot accidentally merge separate rows.
  const parent = resolved.map((_, i) => i);
  const rowMinY = resolved.map((b) => b.logicalY);
  const rowMaxY = [...rowMinY];
  const rowMinH = resolved.map(getH);
  const rowMaxH = [...rowMinH];
  const compactControl = (b: T) => b.logicalW <= 220 && b.logicalH <= 36
    && b.original.replace(/\s/g, '').length <= 24;
  const rootOf = (index: number): number => {
    while (parent[index] !== index) index = parent[index];
    return index;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Long paragraph fragments or wide headings are not toolbar controls.
      // Elastic X shifts on those boxes make prose visibly detach from its
      // source even when the OCR itself is correct.
      if (!compactControl(resolved[i]) || !compactControl(resolved[j])) continue;
      const left = resolved[i].logicalX <= resolved[j].logicalX ? resolved[i] : resolved[j];
      const right = left === resolved[i] ? resolved[j] : resolved[i];
      const sideBySide = Math.abs(left.logicalX - right.logicalX) >= Math.min(getW(left), getW(right)) * 0.4;
      const gap = right.logicalX - (left.logicalX + getW(left));
      const nearby = gap <= Math.max(getW(left), getW(right)) * 1.5 + 32;
      if (!sideBySide || !nearby) continue;
      const a = rootOf(i), b = rootOf(j);
      if (a === b) continue;
      const minY = Math.min(rowMinY[a], rowMinY[b]);
      const maxY = Math.max(rowMaxY[a], rowMaxY[b]);
      const minH = Math.min(rowMinH[a], rowMinH[b]);
      const maxH = Math.max(rowMaxH[a], rowMaxH[b]);
      if (maxY - minY > 4 || maxH - minH > 8) continue;
      parent[b] = a;
      rowMinY[a] = minY; rowMaxY[a] = maxY;
      rowMinH[a] = minH; rowMaxH[a] = maxH;
    }
  }
  const rowMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = rootOf(i);
    rowMap.set(root, [...(rowMap.get(root) ?? []), i]);
  }
  const sameRowGroups = [...rowMap.values()].filter((group) => group.length > 1);

  for (const group of sameRowGroups) {
    group.sort((a, b) => resolved[a].logicalX - resolved[b].logicalX);

    // 弹性向右避让
    for (let k = 0; k < group.length - 1; k++) {
      const cur = group[k];
      const next = group[k + 1];
      const rightEdge = resolved[cur].logicalX + getW(resolved[cur]) + margin;
      if (rightEdge > resolved[next].logicalX) {
        resolved[next].logicalX = rightEdge;
      }
    }

    // 若行尾超出容器可用宽度，执行同行等比微缩
    const last = group[group.length - 1];
    const rowRight = resolved[last].logicalX + getW(resolved[last]);
    if (rowRight > containerWidth - margin) {
      const first = group[0];
      const startX = resolved[first].logicalX;
      const availableW = Math.max(40, containerWidth - margin - startX);
      const totalNeeded = rowRight - startX;
      const scale = Math.max(0.65, availableW / totalNeeded);

      let curX = startX;
      for (const idx of group) {
        const origW = getW(resolved[idx]);
        const newW = Math.round(origW * scale);
        resolved[idx].logicalX = Math.round(curX);
        // This is a real layout constraint, not merely a smaller collision
        // claim. OverlayBlockCard derives its font-fit width from logicalW.
        // Updating only aabbW made the algorithm believe cards had shrunk while
        // the DOM kept rendering at the original width and still overlapped.
        resolved[idx].logicalW = newW;
        resolved[idx].aabbW = newW;
        curX += newW + margin;
      }
    }
  }

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
    const width = getW(resolved[i]);
    resolved[i].logicalX = Math.round(
      Math.max(0, Math.min(resolved[i].logicalX, Math.max(0, containerWidth - width)))
    );
  }

  return resolved;
}
