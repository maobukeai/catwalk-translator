import { describe, it, expect } from 'vitest';
import { estimateDenseProseColumnWidths, estimateDenseProseFontSizes, estimateDenseRowFontHeights, estimateSafeErasePadding, getOverlayCardMaxWidth, resolveAABBCollisions } from '../services/overlayLayout';
import { OverlayBlock } from '../services/types';
import { toTranslucentBg, toSolidBg, isLightBg, getCardTextColor } from '../components/Overlay/OverlayBlockCard';

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

  describe('selection width budget', () => {
    it('bounds a bubble by its selection rather than the whole desktop', () => {
      expect(getOverlayCardMaxWidth({ logicalX: 41, logicalW: 355, layoutRight: 417 }, 1920)).toBe(376);
    });

    it('uses absolute CSS coordinates at a nonzero capture origin', () => {
      expect(getOverlayCardMaxWidth({ logicalX: 641, logicalW: 355, layoutRight: 1017 }, 1920)).toBe(376);
    });

    it('keeps a narrower column boundary and the current viewport limit', () => {
      const block = { logicalX: 41, logicalW: 355, layoutRight: 417, layoutMaxWidth: 260 };
      expect(getOverlayCardMaxWidth(block, 1920)).toBe(260);
      expect(getOverlayCardMaxWidth(block, 250)).toBe(189);
    });

    it('recomputes remaining width after automatic positioning but allows an explicit drag out', () => {
      const block = { logicalX: 41, logicalW: 355, layoutRight: 417 };
      expect(getOverlayCardMaxWidth(block, 1920, 81)).toBe(336);
      expect(getOverlayCardMaxWidth(block, 1920, 450, true)).toBe(584);
      expect(getOverlayCardMaxWidth({ ...block, layoutMaxWidth: 260 }, 1920, 450, true)).toBe(260);
    });

    it('does not replace a narrow remaining selection with the old 40px minimum', () => {
      expect(getOverlayCardMaxWidth({ logicalX: 405, logicalW: 12, layoutRight: 417 }, 1920)).toBe(12);
    });

    it('leaves callers without a valid selection boundary on the existing path', () => {
      for (const layoutRight of [undefined, NaN, Infinity]) {
        expect(getOverlayCardMaxWidth({ logicalX: 41, logicalW: 355, layoutRight }, 1920)).toBe(584);
      }
    });
  });

  describe('estimateDenseRowFontHeights', () => {
    it('uses one readable source-size reference for a dense dark terminal, not per-fragment sizes', () => {
      const blocks = Array.from({ length: 15 }, (_, i) => ({
        original: i % 3 === 0 ? '> cargo run --no-default-features' : `[OCR] Running task ${i}`,
        logicalX: 16, logicalY: 45 + i * 20, logicalW: 290,
        logicalH: [17, 19, 21][i % 3], bgCss: 'rgb(12,12,12)',
      }));
      const heights = estimateDenseRowFontHeights(blocks);
      expect(new Set(heights.map((height) => Math.round(height * 10)))).toEqual(new Set([224]));
      // A sparse dark toolbar is a different scene and keeps its own box sizes.
      expect(estimateDenseRowFontHeights(blocks.slice(0, 5))).toEqual([17, 19, 21, 17, 19]);
    });

    it('dampens oversized OCR boxes within a dense row without changing normal peers', () => {
      const heights = estimateDenseRowFontHeights([
        { original: '文件编辑', logicalY: 20, logicalH: 18 },
        { original: '渲染', logicalY: 22, logicalH: 11 },
        { original: '窗口帮助', logicalY: 25, logicalH: 11 },
      ]);
      expect(heights[0]).toBeCloseTo(13.2);
      expect(heights[1]).toBe(11);
      expect(heights[2]).toBe(11);
    });

    it('caps a clear two-block outlier but preserves ordinary two-size rows', () => {
      const noisy = estimateDenseRowFontHeights([
        { original: '0', logicalY: 100, logicalH: 33 },
        { original: '用户透视', logicalY: 100, logicalH: 12 },
      ]);
      expect(noisy[0]).toBeCloseTo(14.4);
      expect(noisy[1]).toBe(12);

      const mixed = estimateDenseRowFontHeights([
        { original: 'File', logicalY: 100, logicalH: 16 },
        { original: 'Edit', logicalY: 100, logicalH: 12 },
      ]);
      expect(mixed).toEqual([16, 12]);
    });

    it('does not normalize headings on separate rows or isolated blocks', () => {
      expect(estimateDenseRowFontHeights([
        { original: 'Application title', logicalY: 8, logicalH: 24 },
        { original: 'File Edit View', logicalY: 32, logicalH: 12 },
      ])).toEqual([24, 12]);
      expect(estimateDenseRowFontHeights([
        { original: 'Heading', logicalY: 8, logicalH: 30 },
      ])).toEqual([30]);
    });

    it('preserves a heading beside a separate toolbar at the same vertical position', () => {
      const blocks = [
        { original: 'Document settings', logicalX: 24, logicalY: 20, logicalW: 360, logicalH: 42 },
        { original: 'Save', logicalX: 720, logicalY: 20, logicalW: 40, logicalH: 15 },
        { original: 'Share', logicalX: 780, logicalY: 21, logicalW: 46, logicalH: 16 },
      ];
      expect(estimateDenseRowFontHeights(blocks)).toEqual([42, 15, 16]);
    });

    it('does not let a distant panel resize compact labels in another region', () => {
      const blocks = [
        { original: '账户设置', logicalX: 24, logicalY: 20, logicalW: 110, logicalH: 28 },
        { original: '确定', logicalX: 740, logicalY: 20, logicalW: 40, logicalH: 14 },
        { original: '取消', logicalX: 800, logicalY: 21, logicalW: 40, logicalH: 14 },
      ];
      expect(estimateDenseRowFontHeights(blocks)).toEqual([28, 14, 14]);
    });

    it('still normalizes a shuffled toolbar through adjacent peers with small top-edge jitter', () => {
      const blocks = [
        { original: '文件', logicalX: 20, logicalY: 20, logicalW: 32, logicalH: 12 },
        { original: '编辑', logicalX: 65, logicalY: 24, logicalW: 32, logicalH: 12 },
        { original: '渲染', logicalX: 110, logicalY: 21, logicalW: 32, logicalH: 21 },
        { original: '窗口', logicalX: 155, logicalY: 23, logicalW: 32, logicalH: 12 },
      ];
      const heights = estimateDenseRowFontHeights([blocks[3], blocks[0], blocks[2], blocks[1]]);
      expect([heights[0], heights[1], heights[3]]).toEqual([12, 12, 12]);
      expect(heights[2]).toBeCloseTo(14.4);
    });

    it('keeps neighbouring lines of one paragraph at a consistent font height', () => {
      const heights = estimateDenseRowFontHeights([
        { original: '我继续处理上轮留下的可复现问题，先从英文标题和工具栏入手。', logicalX: 51, logicalY: 146, logicalW: 732, logicalH: 15 },
        { original: '再做局部改动和跨场景回归；已经通过的中文正文也要检查。', logicalX: 50, logicalY: 168, logicalW: 504, logicalH: 18 },
        { original: '另一段正文有自己的字号，不能被上一段拖着改变。', logicalX: 50, logicalY: 244, logicalW: 746, logicalH: 23 },
      ]);
      expect(heights[0]).toBeCloseTo(16.5);
      expect(heights[1]).toBeCloseTo(16.5);
      expect(heights[2]).toBe(23);
    });
  });

  describe('estimateDenseProseFontSizes', () => {
    it('keeps paragraph membership after noisy source heights are normalized', () => {
      const input = [
        { ...createMockBlock('a', 30, 80, 410, 18), original: '这是一段较长的中文正文第一行，应该和下面的同栏文字使用相同字号', translated: 'A long translation '.repeat(10) },
        { ...createMockBlock('b', 30, 111, 400, 23), original: '这是同一段正文的下一行，识别框稍高也不应让它在归一后脱离段落', translated: 'The next line.' },
      ];
      const heights = estimateDenseRowFontHeights(input);
      expect(heights).toEqual([20.5, 20.5]);
      const sizes = estimateDenseProseFontSizes(input, heights, 1100, (text, font) => text.length * font * 0.55);
      expect(sizes[0]).toBeDefined();
      expect(sizes[1]).toBe(sizes[0]);
    });

    it('keeps interleaved columns internally consistent without sharing font fits', () => {
      const blocks = [
        { ...createMockBlock('left-a', 30, 80, 410, 18), original: '左侧第一行是一段较长的中文正文，原位显示应保持本栏的字号和行距', translated: 'Long translated text '.repeat(12) },
        { ...createMockBlock('right-a', 570, 82, 440, 25), original: '右侧第一行属于另一栏的中文正文，应保持独立的文字大小和布局', translated: 'A short right-column translation.' },
        { ...createMockBlock('left-b', 31, 105, 390, 20), original: '左侧第二行继续上面的正文内容，不能因为右侧插入文字就失去分组', translated: 'The left paragraph continues.' },
        { ...createMockBlock('right-b', 570, 116, 440, 27), original: '右侧第二行应当与同栏第一行使用相同字号，同时保留左右两栏差异', translated: 'The right paragraph continues.' },
      ];
      const verify = (input: OverlayBlock[]) => {
        const heights = estimateDenseRowFontHeights(input);
        const sizes = estimateDenseProseFontSizes(input, heights, 1100, (text, font) => text.length * font * 0.55);
        const byText = new Map(input.map((block, i) => [block.original, { height: heights[i], size: sizes[i] }]));
        const [a, b, c, d] = blocks.map((block) => byText.get(block.original)!);
        expect([a.height, c.height]).toEqual([19, 19]);
        expect([b.height, d.height]).toEqual([26, 26]);
        expect(a.size).toBeDefined();
        expect(a.size).toBe(c.size);
        expect(b.size).toBe(d.size);
        expect(b.size).toBeGreaterThan(a.size!);
      };
      verify(blocks);
      verify([blocks[3], blocks[1], blocks[2], blocks[0]]);
    });

    it('allows another column between paragraph lines but respects an intervening same-column control', () => {
      const first = { ...createMockBlock('first', 30, 40, 430, 22), original: '这是一段较长正文的第一行，需要继续和下面的同栏正文共享字号', translated: 'A long first line '.repeat(8) };
      const last = { ...createMockBlock('last', 30, 68, 410, 22), original: '这是同一个段落的第二行正文，应该按本栏的位置找到它的上一行', translated: 'The paragraph continues.' };
      const control = createMockBlock('control', 570, 54, 100, 16);
      const unrelated = [first, control, last];
      const unrelatedSizes = estimateDenseProseFontSizes(unrelated, estimateDenseRowFontHeights(unrelated), 1100, (text, font) => text.length * font * 0.55);
      expect(unrelatedSizes[0]).toBeDefined();
      expect(unrelatedSizes[0]).toBe(unrelatedSizes[2]);
      const interrupted = [first, { ...control, logicalX: 30 }, last];
      expect(estimateDenseProseFontSizes(interrupted, estimateDenseRowFontHeights(interrupted), 1100, () => 200))
        .toEqual([undefined, undefined, undefined]);
    });

    it('does not flatten a two-line display heading to paragraph size', () => {
      const blocks = [
        { ...createMockBlock('title-a', 35, 58, 949, 54), original: "You'll stay signed in on these devices after", translated: '更改密码后，你仍会在这些设备上保持登录状态' },
        { ...createMockBlock('title-b', 41, 130, 558, 51), original: 'changing your password:', translated: '，无需重新登录：' },
      ];
      const heights = estimateDenseRowFontHeights(blocks);
      expect(estimateDenseProseFontSizes(blocks, heights, 1050, (text, font) => text.length * font))
        .toEqual([undefined, undefined]);
    });

    it('shares the fitted size across close prose rows but not a distant paragraph', () => {
      const blocks = [
        { ...createMockBlock('heading', 40, 17, 436, 25), original: '这是一行中文正文，长度足够并且和下面几行使用同样字号。', translated: '' },
        { ...createMockBlock('a', 41, 56, 736, 23), original: '这是第一段的第一行中文正文，每一行必须采用相同的字号。', translated: 'This is a long translated first paragraph line with extra words.' },
        { ...createMockBlock('b', 40, 78, 524, 24), original: '这是第一段的第二行中文正文，虽然检测框宽度不同字号仍要一致。', translated: 'Short second line.' },
        { ...createMockBlock('c', 40, 114, 749, 24), original: '这是第二段的第一行中文正文，段落间距应该阻止跨段字号归一。', translated: 'Another paragraph.' },
        { ...createMockBlock('d', 42, 139, 598, 20), original: '这是第二段的第二行中文正文，检测框的高度稍有不同但字号仍要相同。', translated: 'Another translated second line.' },
        { ...createMockBlock('far', 40, 245, 700, 30), original: '这是一段远离上方正文的其它内容，不应该被上面的字号带着改变。', translated: 'Distant content.' },
      ];
      const heights = estimateDenseRowFontHeights(blocks);
      const sizes = estimateDenseProseFontSizes(blocks, heights, 1200, (text, font) => text.length * font);
      // The 39px first gap and 36px paragraph gap are larger than normal
      // line spacing. They must not share the later paragraph's fitted size.
      expect(sizes[0]).toBeUndefined();
      expect(sizes[1]).toBe(sizes[2]);
      expect(sizes[3]).toBe(sizes[4]);
      expect(sizes[5]).toBeUndefined();
    });

    it('does not let a long translation in one paragraph shrink the next paragraph', () => {
      const blocks = [
        { ...createMockBlock('a', 40, 56, 736, 23), original: '这是第一段的第一行中文正文，每一行使用同样字号并保持原图的段落结构。', translated: 'A much longer translation '.repeat(18) },
        { ...createMockBlock('b', 40, 78, 524, 24), original: '这是第一段的第二行中文正文，保持连贯并继续填满这一行文字。', translated: 'Short line.' },
        { ...createMockBlock('c', 40, 114, 749, 24), original: '这是第二段的第一行中文正文，不应继承第一段的缩放及换行结果。', translated: 'The next paragraph starts here.' },
        { ...createMockBlock('d', 42, 139, 598, 20), original: '这是第二段的第二行中文正文，继续沿用自己的字号与宽度预算。', translated: 'And continues on the second line.' },
      ];
      const heights = estimateDenseRowFontHeights(blocks);
      const sizes = estimateDenseProseFontSizes(blocks, heights, 1200, (text, font) => text.length * font * 0.65);
      expect(sizes[0]).toBe(sizes[1]);
      expect(sizes[2]).toBe(sizes[3]);
      expect(sizes[2]).toBeGreaterThan(sizes[0]!);
    });

    it('does not apply paragraph fitting to compact toolbar labels', () => {
      const blocks = [
        createMockBlock('file', 20, 25, 40, 17),
        createMockBlock('edit', 70, 25, 40, 17),
      ];
      expect(estimateDenseProseFontSizes(blocks, [17, 17], 800, () => 100)).toEqual([undefined, undefined]);
    });

    it('does not make a short terminal status row inherit a path row’s shrinkage', () => {
      const blocks = [
        { ...createMockBlock('compile', 36, 482, 864, 20),
          original: 'Compiling MaobuTranslator v0.3.14 (C:\\Users\\20269\\Desktop\\project\\app_v2\\src-tauri)',
          translated: '正在编译 MaobuTranslator（C:\\Users\\20269\\Desktop\\project\\app_v2\\src-tauri）' },
        { ...createMockBlock('finished', 48, 502, 603, 19),
          original: "Finished 'dev' profile [optimized + debuginfo] target(s) in 1m 28s",
          translated: '开发构建已完成，用时 1 分 28 秒' },
      ];
      const heights = estimateDenseRowFontHeights(blocks);
      expect(estimateDenseProseFontSizes(blocks, heights, 1200, (text, font) => text.length * font))
        .toEqual([undefined, undefined]);
    });

    it('does not shrink every row to 9px for one unusually long translation', () => {
      const blocks = [
        { ...createMockBlock('a', 40, 56, 730, 24), original: '这是一行很长的中文正文，需要在原位保持可读字号而不是过度缩小。', translated: 'A very long translated line '.repeat(12) },
        { ...createMockBlock('b', 40, 80, 600, 24), original: '这是它的下一行中文正文，也必须和上面保持一致的字号。', translated: 'Short translation.' },
      ];
      const sizes = estimateDenseProseFontSizes(blocks, [24, 24], 1200, (text, font) => text.length * font);
      expect(sizes[0]).toBe(sizes[1]);
      expect(sizes[0]).toBeGreaterThanOrEqual(13);
    });

    it('keeps a short final line of a mixed-language chat bubble at the first line size', () => {
      const blocks = [
        { ...createMockBlock('bubble-a', 38, 19, 365, 23), original: '我们将 Gemini Omni 1.1 Flash 和一套全新的创意控制工', translated: 'We are bringing Gemini Omni 1.1 Flash and a new suite of creative tools' },
        { ...createMockBlock('bubble-b', 38, 42, 171, 22), original: '具集成到 vids.new 中', translated: 'to vids.new.' },
      ];
      const heights = estimateDenseRowFontHeights(blocks);
      const sizes = estimateDenseProseFontSizes(blocks, heights, 1200, (text, font) => text.length * font * 0.75);
      expect(heights[0]).toBe(heights[1]);
      expect(sizes[0]).toBe(sizes[1]);
      expect(sizes[1]).toBeGreaterThanOrEqual(11);
    });

    it('does not absorb a short control label after a finished sentence', () => {
      const blocks = [
        { ...createMockBlock('body', 38, 19, 365, 23), original: '这是一段已经结束的较长正文，不应把下面的短按钮拉进正文。', translated: 'This paragraph has ended.' },
        { ...createMockBlock('button', 38, 42, 171, 22), original: '确认更改密码操作', translated: 'Confirm' },
      ];
      const sizes = estimateDenseProseFontSizes(blocks, [23, 22], 1200, (text, font) => text.length * font);
      expect(sizes).toEqual([undefined, undefined]);
    });

    it('keeps the paragraph font when a capture edge requires wrapping', () => {
      const blocks = [
        { ...createMockBlock('bubble-a', 38, 19, 365, 23), original: '我们将 Gemini Omni 1.1 Flash 和一套全新的创意控制工', translated: 'We are bringing Gemini Omni 1.1 Flash and a new suite of creative tools' },
        { ...createMockBlock('bubble-b', 38, 42, 171, 22), original: '具集成到 vids.new 中', translated: 'to vids.new.' },
      ];
      const heights = estimateDenseRowFontHeights(blocks);
      const measure = (text: string, font: number) => text.length * font * 0.5;
      expect(estimateDenseProseFontSizes(blocks.map(block => ({ ...block, layoutRight: 280 })), heights, 1200, measure))
        .toEqual(estimateDenseProseFontSizes(blocks, heights, 1200, measure));
    });
  });

  describe('estimateDenseProseColumnWidths', () => {
    const paragraph = (id: string, x: number, y: number) => [
      { ...createMockBlock(`${id}-a`, x, y, 410, 22), original: '这是正文段落的第一行，需要保留本栏宽度并且避免挤走另一栏文字' },
      { ...createMockBlock(`${id}-b`, x + 1, y + 28, 390, 22), original: '这是正文段落的第二行，应当与上一行使用同样的栏宽进行换行' },
    ];

    it('constrains concurrent columns to their own source envelope regardless of OCR order', () => {
      const [a, b] = paragraph('left', 30, 80);
      const [c, d] = paragraph('right', 570, 82);
      const input = [d, a, c, b];
      expect(estimateDenseProseColumnWidths(input, estimateDenseRowFontHeights(input)))
        .toEqual([409, 410, 410, 409]);
      expect(input.map((block) => block.logicalW)).toEqual([390, 410, 410, 390]);
    });

    it('does not treat vertically separate paragraphs or wide overlapping text as columns', () => {
      for (const right of [paragraph('lower', 570, 200), paragraph('indented', 60, 82)]) {
        const input = [...paragraph('left', 30, 80), ...right];
        expect(estimateDenseProseColumnWidths(input, estimateDenseRowFontHeights(input)))
          .toEqual([undefined, undefined, undefined, undefined]);
      }
    });

    it('leaves single-column paragraphs and sparse toolbars on the existing width path', () => {
      const input = [...paragraph('single', 30, 80), createMockBlock('save', 600, 82, 40, 16), createMockBlock('share', 670, 82, 40, 16)];
      expect(estimateDenseProseColumnWidths(input, estimateDenseRowFontHeights(input)))
        .toEqual([undefined, undefined, undefined, undefined]);
    });

    it('moves only the next line in the same column when the constrained card wraps', () => {
      const input = [...paragraph('left', 30, 80), ...paragraph('right', 570, 82)];
      const widths = estimateDenseProseColumnWidths(input, estimateDenseRowFontHeights(input));
      const resolved = resolveAABBCollisions(input.map((block, i) => ({
        ...block, layoutMaxWidth: widths[i], aabbW: widths[i], aabbH: i === 0 ? 55 : block.logicalH,
      })), 1100, 300);
      const byText = new Map(resolved.map((block) => [block.translated, block]));
      expect(byText.get(input[1].translated)?.logicalY).toBe(139);
      expect(byText.get(input[2].translated)?.logicalY).toBe(82);
      expect(byText.get(input[3].translated)?.logicalY).toBe(110);
    });
  });

  describe('estimateSafeErasePadding', () => {
    it('preserves the full safety margin around an isolated title', () => {
      expect(estimateSafeErasePadding([{ logicalX: 40, logicalY: 50, logicalW: 600, logicalH: 48 }]))
        .toEqual([{ left: 5, right: 5, top: 8, bottom: 8 }]);
    });

    it('keeps dense rows from erasing the adjacent glyphs', () => {
      const pads = estimateSafeErasePadding([
        { logicalX: 40, logicalY: 56, logicalW: 730, logicalH: 23 },
        { logicalX: 41, logicalY: 78, logicalW: 520, logicalH: 24 },
      ]);
      expect(pads[0].bottom).toBe(0);
      expect(pads[1].top).toBe(0);
    });

    it('shares narrow horizontal gaps between toolbar labels without painting neighbours', () => {
      const pads = estimateSafeErasePadding([
        { logicalX: 28, logicalY: 28, logicalW: 32, logicalH: 17 },
        { logicalX: 63, logicalY: 28, logicalW: 36, logicalH: 17 },
        { logicalX: 102, logicalY: 28, logicalW: 42, logicalH: 17 },
      ]);
      expect(pads[0].right).toBe(1);
      expect(pads[1].left).toBe(1);
      expect(pads[1].right).toBe(1);
      expect(pads[2].left).toBe(1);
    });
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

    it('preserves horizontal alignment for same-row menu items via elastic avoidance and scaling', () => {
      // 3 menu items on the same baseline (y=20, h=24)
      // "File" (x=10, w=40), "Edit" (x=55, w=40), "View" (x=100, w=40)
      // When translated to wider text, "File" renders aabbW=60, overlapping "Edit"
      const menuFile = { ...createMockBlock('file', 10, 20, 40, 24), aabbW: 60 };
      const menuEdit = { ...createMockBlock('edit', 55, 20, 40, 24), aabbW: 60 };
      const menuView = { ...createMockBlock('view', 100, 20, 40, 24), aabbW: 60 };

      const resolved = resolveAABBCollisions([menuFile, menuEdit, menuView], 800, 600, 4);
      expect(resolved).toHaveLength(3);

      // They must STAY on the same horizontal row (y=20), NOT break into vertical stairs
      expect(resolved[0].logicalY).toBe(20);
      expect(resolved[1].logicalY).toBe(20);
      expect(resolved[2].logicalY).toBe(20);

      // And elastically avoid each other horizontally:
      // menuFile ends at 10 + 60 = 70. menuEdit shifts to 70 + 4 = 74.
      // menuEdit ends at 74 + 60 = 134. menuView shifts to 134 + 4 = 138.
      expect(resolved[0].logicalX).toBe(10);
      expect(resolved[1].logicalX).toBe(74);
      expect(resolved[2].logicalX).toBe(138);
    });

    it('keeps a long Blender-style toolbar on one row through transitive neighbours', () => {
      const toolbar = [10, 70, 130, 190, 250].map((x, i) => ({
        ...createMockBlock(String(i), x, 28, 40, 18), aabbW: 70,
      }));
      // OCR order can differ from horizontal visual order.
      const scrambled = [toolbar[0], toolbar[4], toolbar[1], toolbar[3], toolbar[2]];
      const resolved = resolveAABBCollisions(scrambled, 800, 114);
      const byX = [...resolved].sort((a, b) => a.logicalX - b.logicalX);
      expect(byX.map((block) => block.logicalY)).toEqual([28, 28, 28, 28, 28]);
      for (let i = 1; i < byX.length; i++) {
        expect(byX[i].logicalX).toBeGreaterThanOrEqual(byX[i - 1].logicalX + 70 + 4);
      }
    });

    it('does not merge nearby controls from different physical rows into a toolbar', () => {
      const upper = { ...createMockBlock('upper', 10, 28, 40, 18), aabbW: 70 };
      const lower = { ...createMockBlock('lower', 70, 38, 40, 18), aabbW: 70 };
      const resolved = resolveAABBCollisions([upper, lower], 800, 114);
      expect(resolved[0].logicalY).toBe(28);
      expect(resolved[1].logicalY).toBe(50);
    });

    it('does not elastically shift wide prose fragments as though they were menu buttons', () => {
      const left = { ...createMockBlock('left-prose', 20, 100, 300, 25), aabbW: 390 };
      const right = { ...createMockBlock('right-prose', 340, 100, 300, 25), aabbW: 390 };
      const resolved = resolveAABBCollisions([left, right], 1000, 600);
      expect(resolved.map((block) => block.logicalX)).toEqual([20, 340]);
    });

    it('applies overflow compression to the real logical width used by the card', () => {
      const a = { ...createMockBlock('a', 10, 20, 80, 24), aabbW: 180 };
      const b = { ...createMockBlock('b', 100, 20, 80, 24), aabbW: 180 };
      const resolved = resolveAABBCollisions([a, b], 260, 200, 4);
      expect(resolved[0].logicalW).toBeLessThan(180);
      expect(resolved[1].logicalW).toBeLessThan(180);
      expect(resolved[1].logicalX + (resolved[1].aabbW ?? 0)).toBeLessThanOrEqual(260);
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
      expect(isLightBg('rgb(20, 24, 30)', '#000000')).toBe(false);
      expect(isLightBg('rgb(20, 24, 30)', '#ffffff')).toBe(false);
      expect(isLightBg('#14181e', 'rgb(0,0,0)')).toBe(false);
      expect(getCardTextColor('rgb(20, 24, 30)', '#000000')).toBe('#ffffff');
      expect(getCardTextColor('#14181e', 'rgb(0,0,0)')).toBe('#ffffff');
      expect(getCardTextColor('rgb(240,240,240)', '#000000')).toBe('#000000');
    });
  });
});
