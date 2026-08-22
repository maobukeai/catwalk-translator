import { cmdSaveExportPng } from './tauri';

/** 把译文渲染成分享卡片 PNG 并保存到 图片库/猫步翻译/exports/ */
export interface ExportLine {
  original: string;
  translated: string;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 4
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = ch;
      if (lines.length >= maxLines) return lines;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * 渲染双语卡片：深色玻璃质感 + 强调色侧栏 + 标题 + 每行「原文（暗）/ 译文（亮）」。
 * 2x 缩放保证高分屏清晰。成功返回保存路径。
 */
export async function exportTranslationImage(opts: {
  title: string;
  lines: ExportLine[];
}): Promise<string> {
  const { title, lines } = opts;
  if (!lines.length) throw new Error('没有可导出的译文');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 Canvas 渲染');

  const W = 760;
  const PAD = 32;
  const CONTENT_W = W - PAD * 2 - 10; // 10 = 侧栏缩进
  const ORIG_FONT = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
  const TRANS_FONT = '600 15px "Segoe UI", "Microsoft YaHei", sans-serif';
  const TITLE_FONT = '700 16px "Segoe UI", "Microsoft YaHei", sans-serif';

  // 预排版：计算总高
  type Row = { orig: string[]; trans: string[] };
  const rows: Row[] = lines.map((l) => {
    ctx.font = ORIG_FONT;
    const orig = wrapText(ctx, l.original || ' ', CONTENT_W, 2);
    ctx.font = TRANS_FONT;
    const trans = wrapText(ctx, l.translated || ' ', CONTENT_W, 3);
    return { orig, trans };
  });

  const headerH = 56;
  const rowH = rows.reduce(
    (acc, r) => acc + r.orig.length * 19 + r.trans.length * 23 + 18,
    0
  );
  const H = Math.max(220, headerH + rowH + PAD);

  // 2x 高清渲染
  canvas.width = W * 2;
  canvas.height = H * 2;
  ctx.scale(2, 2);

  // 背景
  ctx.fillStyle = '#12141b';
  ctx.fillRect(0, 0, W, H);
  // 顶部强调渐变条
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#38bdf8');
  grad.addColorStop(1, '#818cf8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 4);
  // 侧栏
  ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
  roundRect(ctx, PAD, headerH - 8, 3, H - headerH - PAD + 8, 2);
  ctx.fill();

  // 标题
  ctx.fillStyle = '#e4e4e7';
  ctx.font = TITLE_FONT;
  ctx.textBaseline = 'top';
  ctx.fillText(title || '猫步翻译', PAD, 26);
  ctx.fillStyle = '#52525b';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('猫步翻译 · MaobuTranslator', W - PAD, 32);
  ctx.textAlign = 'left';

  // 内容行
  let y = headerH;
  for (const r of rows) {
    ctx.font = ORIG_FONT;
    ctx.fillStyle = '#71717a';
    for (const line of r.orig) {
      ctx.fillText(line, PAD + 12, y);
      y += 19;
    }
    ctx.font = TRANS_FONT;
    ctx.fillStyle = '#fafafa';
    for (const line of r.trans) {
      ctx.fillText(line, PAD + 12, y);
      y += 23;
    }
    y += 18;
  }

  // 底部水印
  ctx.fillStyle = '#3f3f46';
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.fillText(new Date().toLocaleString(), PAD, H - 22);

  const dataUrl = canvas.toDataURL('image/png');
  return await cmdSaveExportPng(dataUrl, 'translation');
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
