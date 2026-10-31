import React, { useRef, useState } from 'react';
import { drawOverlaySnapshot, serializeOverlayRegion } from '../services/overlaySnapshot';
import { estimateDenseRowFontHeights } from '../services/overlayLayout';
import { getCardTextColor, toSolidBg } from '../components/Overlay/OverlayBlockCard';
import type { OverlayBlock } from '../services/types';

/** Development-only export round trip. The legacy preview reproduces the
 * former canvas path explicitly; it is not an installed-app screenshot. */
export function OverlaySnapshotPreview({ image, width, height, blocks, children }: {
  image: string; width: number; height: number; blocks: OverlayBlock[]; children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [showLegacy, setShowLegacy] = useState(false);
  const [result, setResult] = useState<{ current: string; legacy?: string }>();
  const [status, setStatus] = useState('');
  const generate = async () => {
    if (!rootRef.current) return;
    setStatus('正在合成');
    setResult(undefined);
    try {
      const svg = serializeOverlayRegion(rootRef.current, { x: 0, y: 0, width, height });
      const source = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('样本底图加载失败'));
        img.src = image;
      });
      if (source.naturalWidth !== width || source.naturalHeight !== height) {
        throw new Error(`验收尺寸不匹配：原图 ${source.naturalWidth}×${source.naturalHeight}，配置 ${width}×${height}`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      await drawOverlaySnapshot(ctx, svg, canvas.width, canvas.height);
      const current = canvas.toDataURL('image/png');
      let legacy: string | undefined;
      if (showLegacy) {
        // Exact former production assumptions: source boxes, 600 weight,
        // translated text only, single fillText constrained to source width.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        const heights = estimateDenseRowFontHeights(blocks);
        blocks.forEach((block, index) => {
          ctx.fillStyle = toSolidBg(block.bgCss, block.fgCss);
          ctx.fillRect(block.logicalX * scale, block.logicalY * scale, block.logicalW * scale, block.logicalH * scale);
          if (!block.translated) return;
          ctx.font = `600 ${Math.round(Math.max(11, heights[index] * 0.72) * scale)}px "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif`;
          ctx.fillStyle = getCardTextColor(block.bgCss, block.fgCss);
          ctx.textBaseline = 'top';
          ctx.fillText(block.translated, (block.logicalX + 2) * scale, (block.logicalY + 2) * scale, block.logicalW * scale);
        });
        legacy = canvas.toDataURL('image/png');
      }
      setResult({ current, legacy });
      setStatus(`已合成 ${canvas.width} × ${canvas.height} PNG；未写剪贴板或保存到图片库`);
    } catch (error) { setStatus(`失败：${String(error)}`); }
  };
  return <>
    <p style={{ margin: 0, fontSize: 12 }}>当前屏幕卡片（可拖动卡片后再生成预览）</p>
    <div ref={rootRef} style={{ position: 'relative', width, height, flex: `0 0 ${width}px`, backgroundImage: `url(${image})` }}>
      {children}
    </div>
    <div style={{ fontSize: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
      <button disabled={status === '正在合成'} style={{ border: '1px solid #74839b', padding: '3px 8px' }} onClick={() => void generate()}>生成当前原位导出预览</button>
      <label>输出像素倍率 <select disabled={status === '正在合成'} aria-label="输出像素倍率" style={{ color: '#111', background: '#fff' }} value={scale} onChange={e => { setScale(Number(e.target.value)); setResult(undefined); setStatus(''); }}>
        <option value={1}>100%</option><option value={1.25}>125%</option><option value={1.5}>150%</option>
      </select></label>
      <label><input disabled={status === '正在合成'} type="checkbox" checked={showLegacy} onChange={e => { setShowLegacy(e.target.checked); setResult(undefined); setStatus(''); }} /> 对比旧导出算法</label>
    </div>
    {status && <p role="status" style={{ margin: 0, fontSize: 12 }}>{status}</p>}
    {result?.legacy && <><p style={{ margin: 0, fontSize: 12 }}>旧算法复现：固定字重、源框压缩，未使用屏幕卡片布局</p><img alt="旧导出算法复现" src={result.legacy} width={width} height={height} style={{ width, height, maxWidth: 'none' }} /></>}
    {result && <><p style={{ margin: 0, fontSize: 12 }}>当前导出 PNG：与上方实际卡片对照（像素倍率不代表真实跨 DPI 验收）</p><img alt="当前原位导出预览" src={result.current} width={width} height={height} style={{ width, height, maxWidth: 'none' }} /></>}
  </>;
}
