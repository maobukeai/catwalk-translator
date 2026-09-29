import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { OverlayBlockCard, OverlayErasePlate, measureTextWidth } from '../components/Overlay/OverlayBlockCard';
import { YoudaoResultPanel } from '../components/Overlay/YoudaoResultPanel';
import { estimateDenseProseFontSizes, estimateDenseRowFontHeights, estimateSafeErasePadding, resolveAABBCollisions } from '../services/overlayLayout';
import type { OverlayBlock } from '../services/types';
import heading from '../../src-tauri/tests/fixtures/password_heading_crop.png';
import dialog from '../../src-tauri/tests/fixtures/password_dialog_dense.png';
import blender from '../../src-tauri/tests/fixtures/blender_toolbar.png';
import terminal from '../../src-tauri/tests/fixtures/windows_terminal_dense.png';
import bubble from '../../src-tauri/tests/fixtures/green_chat_bubble.png';
import denseSource from '../../src-tauri/tests/fixtures/dense_chinese_prose_source.png';
import denseBadResult from '../../src-tauri/tests/fixtures/dense_chinese_prose_bad_overlay.png';
import terminalRealOcr from './generated/terminal_real_ocr.json';
import headingRealOcr from './generated/heading_real_ocr.json';
import dialogRealOcr from './generated/dialog_real_ocr.json';
import bubbleRealOcr from './generated/bubble_real_ocr.json';
import denseRealOcr from './generated/dense_real_ocr.json';
import blenderRealOcr from './generated/blender_real_ocr.json';

// Development-only page: pnpm dev, then open /overlay-visual.html and inspect
// the exact-size source screenshot with rendered OCR/translation cards. Keep
// these cases aligned with the real regression images rather than mock boxes.
const make = (original: string, translated: string, x: number, y: number, w: number, h: number, bgCss: string, fgCss = '#111111'): OverlayBlock => ({
  original, translated, logicalX: x, logicalY: y, logicalW: w, logicalH: h,
  bgCss, fgCss, sourceTier: '视觉验收样例',
});
const realTerminalTranslated = (terminalRealOcr as OverlayBlock[]).map((block) => ({
  ...block,
  translated: block.original.startsWith('Running DevCommand')
    ? '正在运行开发命令（cargo run --no-default-features --color always --）'
    : block.original.startsWith('[*] 正在检测')
    ? '[*] Checking and releasing port 1420 and old processes'
    : block.original.startsWith('Finished dev profile')
    ? '开发构建已完成，优化与调试目标用时 1 分 28 秒'
    : '',
}));

const cases: Array<{ name: string; image: string; width: number; height: number; blocks: OverlayBlock[]; collision?: boolean; expandedIndex?: number; expandedHeight?: number }> = [
  {
    name: '真实 OCR · 英文大标题与实际擦除补丁', image: heading, width: 1050, height: 203,
    collision: true, blocks: (headingRealOcr as OverlayBlock[]).map((block, index) => ({
      ...block, translated: index === 0 ? '更改密码后，你仍会在这些设备上保持登录状态' : '，无需重新登录：',
    })),
  },
  {
    name: '真实 OCR · 密集弹窗原文、按钮与擦除补丁', image: dialog, width: 1105, height: 570,
    collision: true, blocks: dialogRealOcr as OverlayBlock[],
  },
  {
    name: '真实 OCR · 气泡中译英与实际擦除补丁', image: bubble, width: 429, height: 82,
    collision: true, blocks: (bubbleRealOcr as OverlayBlock[]).map((block, index) => ({
      ...block, translated: index === 0
        ? 'We are bringing Gemini Omni 1.1 Flash and a new suite of creative tools'
        : 'to vids.new.',
    })),
  },
  {
    name: '真实 OCR · 密集中文正文原文与实际擦除补丁', image: denseSource, width: 807, height: 171,
    collision: true, blocks: denseRealOcr as OverlayBlock[],
  },
  {
    name: '真实 OCR · Blender 多行工具栏与实际擦除补丁', image: blender, width: 886, height: 114,
    collision: true, blocks: blenderRealOcr as OverlayBlock[],
  },
  {
    name: '大字英文标题 · 两行', image: heading, width: 1050, height: 203,
    blocks: [
      make("You'll stay signed in on these devices after", '更改密码后，你仍会在这些设备上保持登录状态', 38, 62, 945, 50, '#e8eef7'),
      make('changing your password:', '，无需重新登录：', 35, 132, 572, 50, '#e8eef7'),
    ],
  },
  {
    name: '弹窗 · 标题、正文、按钮混排', image: dialog, width: 1105, height: 570,
    blocks: [
      make("You'll stay signed in on these devices after", '更改密码后，你仍会在这些设备上保持登录状态', 35, 40, 955, 56, '#e8eef7'),
      make('changing your password:', '，无需重新登录：', 35, 110, 565, 55, '#e8eef7'),
      make('The device you are on now', '你当前使用的设备', 67, 215, 410, 30, '#e8eef7'),
      make('Android', '安卓设备', 67, 273, 156, 30, '#e8eef7'),
    ],
  },
  {
    name: 'Blender · 密集工具栏', image: blender, width: 886, height: 114,
    blocks: [
      make('File', '文件', 28, 28, 32, 17, '#161616'),
      make('Edit', '编辑', 65, 28, 36, 17, '#161616'),
      make('Render', '渲染', 104, 28, 42, 17, '#161616'),
      make('Window', '窗口', 151, 28, 42, 17, '#161616'),
      make('Help', '帮助', 198, 28, 32, 17, '#161616'),
    ],
  },
  {
    name: '深色终端 · 部分 OCR 漏行的已知遮挡反例', image: terminal, width: 1115, height: 608,
    blocks: [
      make('* 后端热重载 [Cargo Watch]: 修改 Rust 代码自动重新编译并重载', 'Backend hot reload [Cargo Watch]: automatically rebuild and reload Rust code.', 30, 43, 555, 24, '#0c0c0c', '#56d9dc'),
      make('VITE v7.3.6 ready in 239 ms', 'VITE v7.3.6 已就绪，用时 239 ms', 31, 386, 273, 24, '#0c0c0c', '#cecece'),
      make('→ Local: http://localhost:1420/', '→ 本地地址：http://localhost:1420/', 31, 425, 318, 23, '#0c0c0c', '#51b7ea'),
      make('Compiling MaobuTranslator v0.3.14 (C:\\Users\\20269\\Desktop\\项目文件夹\\翻译软件\\app_v2\\src-tauri)', '正在编译 MaobuTranslator v0.3.14（C:\\Users\\20269\\Desktop\\项目文件夹\\翻译软件\\app_v2\\src-tauri）', 40, 479, 870, 22, '#0c0c0c', '#c9c9c9'),
      make("Finished 'dev' profile [optimized + debuginfo] target(s) in 1m 28s", '开发构建已完成，优化与调试目标用时 1 分 28 秒', 45, 501, 640, 22, '#0c0c0c', '#c9c9c9'),
    ],
  },
  {
    name: '深色终端 · 完整日志行密度与相邻卡片避让', image: terminal, width: 1115, height: 608,
    collision: true,
    blocks: [
      make('* 后端热重载 [Cargo Watch]: 修改 Rust 代码自动重新编译并重载', 'Backend hot reload [Cargo Watch]: rebuild and reload Rust code automatically.', 30, 45, 541, 19, '#0c0c0c', '#56d9dc'),
      make('[*] 正在检测并释放 1420 端口与历史进程', '[*] Checking and releasing port 1420 and old processes', 18, 102, 336, 18, '#0c0c0c', '#56d9dc'),
      make('[OK] 端口 1420/1421 与运行环境已完全清理完毕，准备启动！', '[OK] Ports 1420/1421 and the runtime are clear; ready to start.', 13, 121, 498, 20, '#0c0c0c', '#41df33'),
      make('[*] 正在启动热重载开发调试服务', '[*] Starting hot-reload development server', 18, 160, 263, 18, '#0c0c0c', '#56d9dc'),
      make('> app_v2@0.3.14 tauri', '> app_v2@0.3.14 tauri', 16, 217, 191, 19, '#0c0c0c', '#56d9dc'),
      make('> tauri dev', '> tauri dev', 16, 237, 101, 16, '#0c0c0c', '#56d9dc'),
      make('Running BeforeDevCommand (`npm run dev`)', 'Running BeforeDevCommand (`npm run dev`)', 54, 274, 353, 19, '#0c0c0c', '#d0d0d0'),
      make('> app_v2@0.3.14 dev', '> app_v2@0.3.14 dev', 16, 312, 175, 19, '#0c0c0c', '#d0d0d0'),
      make('> vite', '> vite', 16, 332, 58, 16, '#0c0c0c', '#d0d0d0'),
      make('VITE v7.3.6 ready in 239 ms', 'VITE v7.3.6 已就绪，用时 239 ms', 31, 388, 260, 18, '#0c0c0c', '#cecece'),
      make('→ Local: http://localhost:1420/', '→ 本地地址：http://localhost:1420/', 30, 427, 308, 16, '#0c0c0c', '#51b7ea'),
      make('Running DevCommand (`cargo run --no-default-features --color always`)', 'Running DevCommand (`cargo run --no-default-features --color always`)', 55, 445, 621, 19, '#0c0c0c', '#cecece'),
      make('Info Watching C:\\Users\\20269\\Desktop\\项目文件夹\\翻译软件\\app_v2\\src-tauri for changes', 'Info Watching C:\\Users\\20269\\Desktop\\项目文件夹\\翻译软件\\app_v2\\src-tauri for changes', 82, 463, 776, 20, '#0c0c0c', '#cecece'),
      make('Compiling MaobuTranslator v0.3.14 (C:\\Users\\20269\\Desktop\\项目文件夹\\翻译软件\\app_v2\\src-tauri)', '正在编译 MaobuTranslator v0.3.14（C:\\Users\\20269\\Desktop\\项目文件夹\\翻译软件\\app_v2\\src-tauri）', 36, 482, 864, 20, '#0c0c0c', '#cecece'),
      make("Finished 'dev' profile [optimized + debuginfo] target(s) in 1m 28s", '开发构建已完成，优化与调试目标用时 1 分 28 秒', 48, 502, 603, 19, '#0c0c0c', '#cecece'),
      make("Running 'target\\debug\\MaobuTranslator.exe'", "Running 'target\\debug\\MaobuTranslator.exe'", 54, 520, 381, 20, '#0c0c0c', '#cecece'),
      make('[OCR] WinRT 预热完成 — 首次截图即时响应', '[OCR] WinRT 预热完成 — 首次截图即时响应', 15, 539, 352, 19, '#0c0c0c', '#cecece'),
      make('[OCR] EP 基准：DirectML 6.7ms vs CPU 8.0ms → 选用 CPU 多线程', '[OCR] EP 基准：DirectML 6.7ms vs CPU 8.0ms → 选用 CPU 多线程', 15, 558, 543, 19, '#0c0c0c', '#cecece'),
      make('[OCR] Rust 原生 ONNX 引擎已就绪并完成图预热', '[OCR] Rust 原生 ONNX 引擎已就绪并完成图预热', 13, 577, 617, 20, '#0c0c0c', '#cecece'),
    ],
  },
  {
    name: '绿色聊天气泡 · 中英混排与尖角', image: bubble, width: 429, height: 82,
    collision: true, expandedIndex: 0, expandedHeight: 31,
    blocks: [
      make('我们将 Gemini Omni 1.1 Flash 和一套全新的创意控制工', 'We are bringing Gemini Omni 1.1 Flash and a new suite of creative tools', 38, 19, 365, 23, '#9cf09f'),
      make('具集成到 vids.new 中', 'to vids.new.', 38, 42, 171, 22, '#9cf09f'),
    ],
  },
  {
    name: '深色终端 · PP-OCRv6 Tiny 实际分组与插值抹除补丁',
    image: terminal, width: 1115, height: 608,
    collision: true,
    blocks: terminalRealOcr as OverlayBlock[],
  },
  {
    name: '深色终端 · 真实 OCR 框与补丁上的长短译文混排',
    image: terminal, width: 1115, height: 608,
    collision: true,
    blocks: realTerminalTranslated,
  },
  {
    name: '密集中文正文 · 原位显示原文', image: denseSource, width: 807, height: 171,
    blocks: [
      make('这轮优化已完成，并重新生成了0.3.15安装包；我没有替你安装。', '', 40, 17, 436, 25, '#ffffff'),
      make('原位翻译修复了短译文覆盖长原文时的残字，并加入真实截图视觉验收页；翻译失败现在会明确显示并支持单段重', '', 41, 56, 736, 23, '#ffffff'),
      make('试。另增加了分阶段耗时与翻译来源诊断、文字测量缓存，以及常用设置快捷入口。', '', 40, 78, 524, 24, '#ffffff'),
      make('验证结果：前端398/398项测试、Rust 200项测试通过，桌面安装包构建成功。视觉样本不能证明所有软件、字体和缩', '', 40, 114, 749, 24, '#ffffff'),
      make('放比例都完美；你常用的复杂场景仍值得用新安装包实测。本次目标累计用时约1小时29分钟。', '', 42, 139, 598, 20, '#ffffff'),
    ],
  },
  {
    name: '密集正文 · 长译文下推时原文仍留在原位擦除', image: denseSource, width: 807, height: 171,
    collision: true, expandedIndex: 1, expandedHeight: 44,
    blocks: [
      make('这轮优化已完成，并重新生成了0.3.15安装包；我没有替你安装。', '', 40, 17, 436, 25, '#ffffff'),
      make('原位翻译修复了短译文覆盖长原文时的残字，并加入真实截图视觉验收页；翻译失败现在会明确显示并支持单段重', 'In-place translation removes leftover source glyphs and adds visual checks; a failed translation can now be retried for one segment without losing the rest of the layout.', 41, 56, 736, 23, '#ffffff'),
      make('试。另增加了分阶段耗时与翻译来源诊断、文字测量缓存，以及常用设置快捷入口。', 'It also reports timing and translation sources, caches text measurements, and provides shortcuts for common settings.', 40, 78, 524, 24, '#ffffff'),
      make('验证结果：前端398/398项测试、Rust 200项测试通过，桌面安装包构建成功。视觉样本不能证明所有软件、字体和缩', '', 40, 114, 749, 24, '#ffffff'),
      make('放比例都完美；你常用的复杂场景仍值得用新安装包实测。本次目标累计用时约1小时29分钟。', '', 42, 139, 598, 20, '#ffffff'),
    ],
  },
];

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 20, height: '100vh', boxSizing: 'border-box', overflowY: 'auto', background: '#18202b', color: '#f5f6f8', fontFamily: 'Segoe UI, Microsoft YaHei UI, sans-serif' }}>
    <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>原位覆盖视觉验收 · 真实截图 1:1</h1>
    <p style={{ fontSize: 12, color: '#bfc8d4' }}>每组先显示原图，再在同一截图上绘制译文。重点检查字号、换行、残留原文与相邻控件遮挡。</p>
    {cases.map((item) => {
      const heights = estimateDenseRowFontHeights(item.blocks);
      const fontSizes = estimateDenseProseFontSizes(item.blocks, heights, 1200, measureTextWidth);
      const erasePadding = estimateSafeErasePadding(item.blocks);
      const sourceBlocks = item.blocks.map((block, i) => ({
        ...block, erasePadding: erasePadding[i],
        sourceX: block.logicalX, sourceY: block.logicalY, sourceW: block.logicalW, sourceH: block.logicalH,
        fontLineHeight: heights[i], proseFontSize: fontSizes[i],
        aabbH: item.collision && i === item.expandedIndex ? item.expandedHeight : block.logicalH,
      }));
      const visibleBlocks = item.collision
        ? resolveAABBCollisions(sourceBlocks, 1200, item.height)
        : sourceBlocks;
      return (
      <section key={item.name} style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{item.name}</h2>
        <div style={{ display: 'grid', gap: 6, overflowX: 'auto' }}>
          <img src={item.image} width={item.width} height={item.height} alt={`${item.name} 原图`} />
          <div style={{ position: 'relative', width: item.width, height: item.height, flex: `0 0 ${item.width}px`, backgroundImage: `url(${item.image})` }}>
            {visibleBlocks.map((block, index) => <OverlayErasePlate key={`erase:${index}`} block={block} />)}
            {visibleBlocks.map((block, index) => (
              <OverlayBlockCard key={index} block={block} blockIndex={index}
                fontLineHeight={block.fontLineHeight}
                proseFontSize={block.proseFontSize}
                viewportWidth={Math.max(1200, item.width)}
                externalErase
                isPinned={false} onClose={() => {}} onTogglePin={() => {}} />
            ))}
          </div>
        </div>
      </section>
      );
    })}
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>密集中文段落 · 手动面板对照（非默认）</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'start', marginBottom: 12 }}>
        <img src={denseSource} width={807} height={171} alt="密集中文原图" />
        <img src={denseBadResult} width={822} height={193} alt="旧版失真覆盖结果" />
      </div>
      <div style={{ position: 'relative', width: 900, height: 720, background: '#fff' }}>
        <img src={denseSource} width={807} height={171} alt="保留原图" />
        <YoudaoResultPanel
          blocks={[
            make('这轮优化已完成，并重新生成了安装包；我没有替你安装。', 'The optimization is complete and a new installer has been built. I have not installed it for you.', 48, 18, 420, 24, '#fff'),
            make('原位翻译修复了短译文覆盖长原文时的残字，并加入视觉验收。', 'The in-place translation fixes leftover source text and adds visual regression checks.', 48, 57, 721, 20, '#fff'),
            make('验证结果：前端测试通过，桌面安装包构建成功。', 'Verification: frontend tests passed and the desktop installer built successfully.', 48, 116, 733, 21, '#fff'),
          ]}
          selectionX={0} selectionY={0} selectionW={807} selectionH={171}
          isLight translating={false} hoverIndex={null} targetLang="auto"
          onHover={() => {}} onCopyText={() => {}} onSpeech={() => {}}
          onRetranslate={() => {}} onSwitchMode={() => {}} onPin={() => {}}
          onExportImage={() => {}} onClose={() => {}}
        />
      </div>
    </section>
  </main>,
);
