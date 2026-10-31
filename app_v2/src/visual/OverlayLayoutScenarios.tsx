import React from 'react';
import { OverlayBlockCard, OverlayErasePlate, measureTextWidth } from '../components/Overlay/OverlayBlockCard';
import { estimateDenseProseColumnWidths, estimateDenseProseFontSizes, estimateDenseRowFontHeights, estimateSafeErasePadding, resolveAABBCollisions } from '../services/overlayLayout';
import type { OverlayBlock } from '../services/types';

// Deterministic layout fixtures, not OCR accuracy samples. Rendered size
// callbacks exercise the same collision feedback used by CaptureOverlay.
const blocks: Array<OverlayBlock & { sourceFont: number }> = [
  { original: 'Document settings', translated: '文档设置', logicalX: 24, logicalY: 20, logicalW: 360, logicalH: 42, sourceFont: 30 },
  { original: 'Save', translated: '保存', logicalX: 760, logicalY: 20, logicalW: 40, logicalH: 15, sourceFont: 11 },
  { original: 'Share', translated: '分享', logicalX: 820, logicalY: 21, logicalW: 46, logicalH: 16, sourceFont: 11 },
  { original: '左侧正文有独立的排版和字号，长译文也应保持在本栏的范围内', translated: 'The left column has its own layout and font size. A longer translation should wrap inside this column, preserve readable text, and leave the independent paragraph on the right in its original position.', logicalX: 30, logicalY: 100, logicalW: 410, logicalH: 18, sourceFont: 13 },
  { original: 'Independent column: this paragraph keeps its own size', translated: '右侧是独立的一栏，保留自己的文字大小。', logicalX: 570, logicalY: 102, logicalW: 440, logicalH: 25, sourceFont: 17 },
  { original: '左侧下一行继续上面的正文内容，不应因为另一栏而改变字号', translated: 'This line continues the left paragraph at the same size.', logicalX: 31, logicalY: 125, logicalW: 390, logicalH: 20, sourceFont: 13 },
  { original: 'The next line stays aligned with the rest of this column', translated: '下一行继续保持本栏对齐，不被左边的长句挤走。', logicalX: 570, logicalY: 136, logicalW: 440, logicalH: 27, sourceFont: 17 },
].map((block) => ({ ...block, bgCss: '#ffffff', fgCss: '#111111', sourceTier: '合成布局样例（非 OCR 测试）' }));

export const OverlayLayoutScenarios: React.FC = () => {
  const [scale, setScale] = React.useState(1);
  const [sizes, setSizes] = React.useState<Record<number, { width: number; height: number }>>({});
  const reportSize = React.useCallback((index: number, size: { width: number; height: number }) => {
    setSizes((current) => {
      const previous = current[index];
      if (previous && Math.abs(previous.width - size.width) <= 2 && Math.abs(previous.height - size.height) <= 2) return current;
      return { ...current, [index]: size };
    });
  }, []);
  const heights = estimateDenseRowFontHeights(blocks);
  const columnWidths = estimateDenseProseColumnWidths(blocks, heights);
  const layoutBlocks = blocks.map((block, i) => ({ ...block, layoutMaxWidth: columnWidths[i] }));
  const fonts = estimateDenseProseFontSizes(layoutBlocks, heights, 1100, measureTextWidth);
  const padding = estimateSafeErasePadding(blocks);
  const positioned = resolveAABBCollisions(layoutBlocks.map((block, i) => ({
    ...block, __i: i, fontLineHeight: heights[i], proseFontSize: fonts[i],
    sourceX: block.logicalX, sourceY: block.logicalY, sourceW: block.logicalW, sourceH: block.logicalH,
    erasePadding: padding[i], aabbW: sizes[i]?.width, aabbH: sizes[i]?.height,
  })), 1100, 260);

  const canvas = (overlay: boolean) => (
    <div style={{ width: 1100 * scale, height: 260 * scale }}>
      <div data-layout-scene={overlay ? 'overlay' : 'source'} style={{ position: 'relative', width: 1100, height: 260, background: '#fff', color: '#111', transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div style={{ position: 'absolute', left: 530, top: 82, width: 1, height: 156, background: '#dbe3ec' }} />
        {blocks.map((block, i) => <span key={i} style={{ position: 'absolute', left: block.logicalX, top: block.logicalY, height: block.logicalH, display: 'flex', alignItems: 'center', fontSize: block.sourceFont, whiteSpace: 'nowrap' }}>{block.original}</span>)}
        {overlay && positioned.map((block) => <OverlayErasePlate key={`erase:${block.__i}`} block={block} />)}
        {overlay && positioned.map((block) => <OverlayBlockCard key={block.__i} block={block} blockIndex={block.__i}
          fontLineHeight={block.fontLineHeight} proseFontSize={block.proseFontSize}
          viewportWidth={1100} externalErase isPinned={false} onClose={() => {}} onTogglePin={() => {}}
          onRenderedSize={reportSize} />)}
      </div>
    </div>
  );

  return <section style={{ marginBottom: 28 }}>
    <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>合成布局 · 双栏长译文、混合字号与工具按钮</h2>
    <p style={{ fontSize: 12, color: '#bfc8d4' }}>上：参考排版；下：实际卡片组件与碰撞反馈。缩放仅检查渲染，不代表真实屏幕 DPI 或 OCR 准确率。</p>
    <label style={{ display: 'block', fontSize: 12, margin: '8px 0' }}>样例显示比例：
      <select aria-label="样例显示比例" value={scale} onChange={(event) => setScale(Number(event.target.value))} style={{ color: '#111', background: '#fff', marginLeft: 8 }}>
        <option value={1}>100%</option><option value={1.25}>125%</option><option value={1.5}>150%</option>
      </select>
    </label>
    <div style={{ display: 'grid', gap: 6, overflowX: 'auto' }}>{canvas(false)}{canvas(true)}</div>
  </section>;
};
