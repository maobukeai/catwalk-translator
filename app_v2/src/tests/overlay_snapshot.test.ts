import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawOverlaySnapshot, serializeOverlayRegion } from '../services/overlaySnapshot';

function bounds(node: HTMLElement, x: number, y: number, width: number, height: number) {
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
    x, y, left: x, top: y, width, height, right: x + width, bottom: y + height,
    toJSON: () => ({}),
  });
}

function fixture() {
  const root = document.createElement('div');
  document.body.append(root);
  bounds(root, 50, 70, 1250, 625);
  Object.defineProperties(root, { clientWidth: { value: 1000 }, clientHeight: { value: 500 } });
  const plate = document.createElement('div');
  plate.setAttribute('data-overlay-erase-plate', '');
  plate.style.cssText = 'position:absolute;z-index:190;background-color:rgb(12,12,12);background-image:url("data:image/png;base64,AA==");';
  bounds(plate, 150, 170, 400, 50);
  const card = document.createElement('div');
  card.className = 'overlay-block';
  card.style.cssText = 'position:absolute;display:flex;flex-direction:column;z-index:210;font-size:18px;font-weight:400;line-height:21px;font-family:Test Font;white-space:pre-wrap;color:rgb(21,180,12);box-shadow:0 0 8px blue;';
  bounds(card, 175, 195, 375, 100);
  const main = document.createElement('span');
  main.setAttribute('data-overlay-main-text', '');
  main.textContent = 'A long translated line\nwith its actual wrapping';
  main.style.opacity = '0.8';
  card.append(main);
  root.append(plate, card);
  return { root, plate, card, main };
}

const region = { x: 80, y: 90, width: 400, height: 200 };
function parse(svg: string | null) {
  expect(svg).not.toBeNull();
  const xml = new DOMParser().parseFromString(svg!, 'image/svg+xml');
  expect(xml.querySelector('parsererror')).toBeNull();
  return { xml, layer: xml.querySelector('foreignObject > div')! };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('in-place export snapshots', () => {
  it.each([
    { side: 'left', x: 78, y: 100 }, { side: 'top', x: 100, y: 88 },
    { side: 'right', x: 190, y: 100 }, { side: 'bottom', x: 100, y: 230 },
    { side: 'entirely outside after dragging', x: 600, y: 100 },
  ])('refuses to silently cut visible text at the $side edge', ({ x, y }) => {
    const { root, card } = fixture();
    // These rects have a nonzero origin and a 1.25 CSS transform. Crop checks
    // must convert them back to root coordinates before comparing boundaries.
    bounds(card, 50 + x * 1.25, 70 + y * 1.25, 375, 100);
    expect(() => serializeOverlayRegion(root, region)).toThrow('原位文字超出选区');
  });

  it('ignores hidden overflowing cards while still including their visible source plate', () => {
    const { root, card } = fixture();
    bounds(card, 950, 195, 375, 100);
    card.style.visibility = 'hidden';
    expect(parse(serializeOverlayRegion(root, region)).layer.children).toHaveLength(1);
  });

  it('allows subpixel rounding at the crop but not a visibly clipped row', () => {
    const { root, card } = fixture();
    bounds(card, 50 + 100 * 1.25, 70 + 210.5 * 1.25, 375, 100);
    expect(() => serializeOverlayRegion(root, region)).not.toThrow();
    bounds(card, 50 + 100 * 1.25, 70 + 212 * 1.25, 375, 100);
    expect(() => serializeOverlayRegion(root, region)).toThrow('原位文字超出选区');
  });

  it('uses actual moved/resized card geometry and type instead of source OCR boxes', () => {
    const { root } = fixture();
    const { xml, layer } = parse(serializeOverlayRegion(root, region));
    const card = layer.children[1] as HTMLElement;
    expect(xml.documentElement.getAttribute('viewBox')).toBe('0 0 400 200');
    expect(card.style.left).toBe('20px');
    expect(card.style.top).toBe('10px');
    expect(card.style.width).toBe('300px');
    expect(card.style.height).toBe('80px');
    expect(card.style.fontSize).toBe('18px');
    expect(card.style.fontWeight).toBe('400');
    expect(card.style.whiteSpace).toBe('pre-wrap');
    expect(card.style.fontFamily).toContain('Test Font');
    expect(card.style.color).toBe('rgb(21, 180, 12)');
  });

  it('retains source erasures at their own positions and below pinned cards', () => {
    const { root } = fixture();
    const { layer } = parse(serializeOverlayRegion(root, region));
    const plate = layer.children[0] as HTMLElement;
    expect(plate.style.left).toBe('0px');
    expect(plate.style.top).toBe('-10px');
    expect(plate.style.width).toBe('320px');
    expect(plate.style.backgroundImage).toContain('data:image/png;base64,AA==');
    expect(plate.style.zIndex).toBe('190');
    expect((layer.children[1] as HTMLElement).style.zIndex).toBe('210');
    expect((layer as HTMLElement).style.overflow).toBe('hidden');
  });

  it('exports the actual original/bilingual text without transient controls or animations', () => {
    const { root, card, main } = fixture();
    main.textContent = '原文 <tag> & "quoted"';
    const secondary = document.createElement('span');
    secondary.setAttribute('data-overlay-secondary-text', '');
    secondary.style.cssText = 'opacity:0.72;font-size:12px;';
    secondary.textContent = 'Secondary text';
    card.prepend(secondary);
    const shimmer = document.createElement('span');
    shimmer.className = 'overlay-shimmer';
    shimmer.textContent = 'loading-only';
    const retry = document.createElement('button');
    retry.textContent = '重试';
    card.append(shimmer, retry);
    const toolbar = document.createElement('button');
    toolbar.textContent = '工具栏';
    root.append(toolbar);
    const { layer } = parse(serializeOverlayRegion(root, region));
    const exported = layer.children[1] as HTMLElement;
    expect(exported.textContent).toBe('Secondary text原文 <tag> & "quoted"');
    expect(exported.children).toHaveLength(2);
    expect((exported.children[0] as HTMLElement).style.opacity).toBe('0.72');
    expect((exported.children[1] as HTMLElement).style.opacity).toBe('1');
    expect(exported.style.boxShadow).toBe('');
    expect(main.style.opacity).toBe('0.8');
    expect(card.contains(retry)).toBe(true);
  });

  it('freezes the click-time content and never exports unrelated remote backgrounds', () => {
    const { root, card, main } = fixture();
    card.style.backgroundImage = 'url("https://example.invalid/remote.png")';
    const snapshot = serializeOverlayRegion(root, region);
    main.textContent = 'Later translation';
    const { layer } = parse(snapshot);
    expect(layer.textContent).not.toContain('Later translation');
    expect(snapshot).not.toContain('example.invalid');
  });

  it('does not invent cover cards for hidden or panel-only content', () => {
    const { root, card, plate } = fixture();
    card.style.display = 'none';
    plate.style.visibility = 'hidden';
    expect(serializeOverlayRegion(root, region)).toBeNull();
    root.replaceChildren(document.createElement('section'));
    expect(serializeOverlayRegion(root, region)).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid crop width %s', (width) => {
    const { root } = fixture();
    expect(() => serializeOverlayRegion(root, { ...region, width })).toThrow('导出选区尺寸无效');
  });
});

describe('snapshot rasterization', () => {
  function imageMock(outcome: 'load' | 'error' | 'timeout') {
    const sources: string[] = [];
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(value: string) {
        sources.push(value);
        if (outcome !== 'timeout') queueMicrotask(() => outcome === 'load' ? this.onload?.() : this.onerror?.());
      }
    });
    return sources;
  }

  it('draws a self-contained snapshot at the physical capture size without compressing text', async () => {
    const sources = imageMock('load');
    const ctx = { drawImage: vi.fn(), fillText: vi.fn() } as unknown as CanvasRenderingContext2D;
    await drawOverlaySnapshot(ctx, '<svg>中文 &amp;</svg>', 600, 300);
    expect(decodeURIComponent(sources[0].split(',')[1])).toBe('<svg>中文 &amp;</svg>');
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 600, 300);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('does not create an image for an empty in-place layer', async () => {
    const sources = imageMock('load');
    await drawOverlaySnapshot({} as CanvasRenderingContext2D, null, 600, 300);
    expect(sources).toEqual([]);
  });

  it('rejects image errors instead of silently exporting the untranslated source', async () => {
    imageMock('error');
    await expect(drawOverlaySnapshot({} as CanvasRenderingContext2D, '<svg/>', 600, 300)).rejects.toThrow('原位图片合成失败');
  });

  it('bounds image decoding time instead of leaving copy/save pending forever', async () => {
    vi.useFakeTimers();
    imageMock('timeout');
    const result = drawOverlaySnapshot({} as CanvasRenderingContext2D, '<svg/>', 600, 300);
    const check = expect(result).rejects.toThrow('原位图片合成超时');
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
  });
});
