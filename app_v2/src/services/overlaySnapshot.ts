/** Snapshot only the rendered in-place layers, not selection chrome/toolbars.
 * The browser remains the text layout engine: a second canvas fillText layout
 * would lose wrapping, source/bilingual view, zoom and user-dragged positions. */
export interface OverlaySnapshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const STYLE_PROPERTIES = [
  'box-sizing', 'display', 'position', 'left', 'top', 'right', 'bottom', 'z-index',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'flex-direction', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items',
  'color', 'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat', 'border-radius',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'font-kerning', 'font-feature-settings', 'font-variation-settings',
  'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'word-break',
  'overflow-wrap', 'text-align', 'text-indent', 'text-transform', 'text-shadow',
  'text-rendering', '-webkit-font-smoothing', 'direction', 'unicode-bidi',
  'opacity', 'overflow',
];

function copyStyle(source: HTMLElement, target: HTMLElement): void {
  const computed = source.ownerDocument.defaultView!.getComputedStyle(source);
  for (const property of STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    // Our erase patches are inline PNGs. No external resource is needed or
    // fetched to export a screenshot, even if unexpected CSS reaches a card.
    if (property === 'background-image' && value !== 'none'
      && !/^url\(["']?data:image\/png;base64,[a-z0-9+/=]+["']?\)$/i.test(value)) continue;
    if (value) target.style.setProperty(property, value);
  }
}

function cloneContent(source: HTMLElement): HTMLElement {
  const clone = source.ownerDocument.createElementNS(XHTML, source.tagName.toLowerCase()) as HTMLElement;
  copyStyle(source, clone);
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      clone.appendChild(source.ownerDocument.createTextNode(child.textContent ?? ''));
    } else if (child instanceof HTMLElement && (
      child.hasAttribute('data-overlay-main-text')
      || child.hasAttribute('data-overlay-secondary-text')
      || (child.tagName === 'DIV' && child.getAttribute('aria-hidden') === 'true')
    )) {
      const content = cloneContent(child);
      // Freeze content, not the transient pending/pop-in animation. Preserve
      // the intentionally lighter secondary source line in bilingual mode.
      if (child.hasAttribute('data-overlay-main-text')) content.style.opacity = '1';
      clone.appendChild(content);
    }
  }
  return clone;
}

/** Region coordinates are CSS pixels relative to the capture root. The SVG is
 * transparent; the caller paints the clean capture underneath, at its native
 * physical resolution. Null means no in-place layers are currently visible
 * (e.g. hidden cards or panel mode), not permission to fabricate an old layout. */
export function serializeOverlayRegion(root: HTMLElement, region: OverlaySnapshotRegion): string | null {
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)
    || region.width <= 0 || region.height <= 0) throw new Error('导出选区尺寸无效');
  const doc = root.ownerDocument;
  const rootRect = root.getBoundingClientRect();
  const rootScaleX = root.clientWidth > 0 ? rootRect.width / root.clientWidth : 1;
  const rootScaleY = root.clientHeight > 0 ? rootRect.height / root.clientHeight : 1;
  if (rootScaleX <= 0 || rootScaleY <= 0) throw new Error('原位显示不可见，请重新截图');
  const layer = doc.createElementNS(XHTML, 'div') as HTMLElement;
  layer.style.cssText = `position:relative;width:${region.width}px;height:${region.height}px;overflow:hidden;`;

  for (const source of root.querySelectorAll<HTMLElement>('[data-overlay-erase-plate], .overlay-block')) {
    const computed = doc.defaultView!.getComputedStyle(source);
    const bounds = source.getBoundingClientRect();
    if (computed.display === 'none' || computed.visibility === 'hidden'
      || bounds.width <= 0 || bounds.height <= 0) continue;
    // Erase patches intentionally extend past OCR boxes and may be clipped;
    // visible text must not be silently truncated. Read the actual DOM here
    // so manual drag, zoom and bilingual content are checked as displayed,
    // rather than trusting the parent's source-based collision coordinates.
    if (source.matches('.overlay-block')) {
      const left = (bounds.left - rootRect.left) / rootScaleX;
      const top = (bounds.top - rootRect.top) / rootScaleY;
      const right = (bounds.right - rootRect.left) / rootScaleX;
      const bottom = (bounds.bottom - rootRect.top) / rootScaleY;
      // Allow subpixel/measurement rounding, not a whole clipped glyph.
      const tolerance = 1;
      if (left < region.x - tolerance || top < region.y - tolerance
        || right > region.x + region.width + tolerance || bottom > region.y + region.height + tolerance) {
        throw new Error('原位文字超出选区，请减小字号或把卡片移回选区后再导出');
      }
    }
    const clone = cloneContent(source);
    clone.style.position = 'absolute';
    clone.style.left = `${(bounds.left - rootRect.left) / rootScaleX - region.x}px`;
    clone.style.top = `${(bounds.top - rootRect.top) / rootScaleY - region.y}px`;
    clone.style.right = 'auto';
    clone.style.bottom = 'auto';
    clone.style.width = `${bounds.width / rootScaleX}px`;
    clone.style.height = `${bounds.height / rootScaleY}px`;
    clone.style.margin = '0';
    layer.appendChild(clone);
  }
  if (!layer.childElementCount) return null;

  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(region.width));
  svg.setAttribute('height', String(region.height));
  svg.setAttribute('viewBox', `0 0 ${region.width} ${region.height}`);
  const content = doc.createElementNS(SVG, 'foreignObject');
  content.setAttribute('width', '100%');
  content.setAttribute('height', '100%');
  content.appendChild(layer);
  svg.appendChild(content);
  return new XMLSerializer().serializeToString(svg);
}

/** Rasterize the already-frozen layout without re-measuring its text. Using a
 * self-contained data SVG (including PNG patches) keeps the canvas origin-clean.
 * Reject on failure so callers do not silently copy an untranslated image. */
export function drawOverlaySnapshot(
  ctx: CanvasRenderingContext2D, svg: string | null, width: number, height: number,
): Promise<void> {
  if (!svg) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('原位图片合成超时，请重试'));
    }, 10_000);
    image.onload = () => {
      clearTimeout(timer);
      try {
        ctx.drawImage(image, 0, 0, width, height);
        resolve();
      } catch (error) { reject(error); }
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error('原位图片合成失败，请重试'));
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
