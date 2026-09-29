import React, { useState } from 'react';
import type { OverlayBlock } from '../../services/types';
import { failureLabel, summarizeTranslationSources, type PipelineDiagnosticsData } from '../../services/pipelineDiagnostics';

interface Props {
  data: PipelineDiagnosticsData;
  blocks: OverlayBlock[];
  isLight: boolean;
}

const ms = (value: number | undefined) => value === undefined ? '—' : `${Math.round(value)} ms`;

export const PipelineDiagnostics: React.FC<Props> = ({ data, blocks, isLight }) => {
  const [open, setOpen] = useState(false);
  const sources = summarizeTranslationSources(blocks);
  const failures = blocks.filter((block) => block.translationFailed).length;
  return (
    <div className={`overlay-toolbar absolute bottom-3 right-3 z-[255] max-w-[min(320px,calc(100vw-24px))] rounded-lg border text-[11px] shadow-lg pointer-events-auto ${isLight ? 'bg-white/95 border-slate-300 text-slate-700' : 'bg-slate-950/95 border-white/20 text-slate-200'}`} data-testid="pipeline-diagnostics" onContextMenu={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
        aria-expanded={open}
        aria-label="查看本次识别与翻译诊断"
        className="px-2.5 py-1.5 font-medium cursor-pointer"
      >
        {failures > 0 ? `⚠ ${failures} 段翻译失败` : '本次耗时与来源'} · {ms(data.ocrLayoutMs)} / {ms(data.translationMs)}
      </button>
      {open && (
        <div className="border-t border-current/15 px-2.5 py-2 space-y-1" data-testid="pipeline-diagnostics-details">
          <div>截图准备：{ms(data.captureMs)}</div>
          <div>识别＋排版：{ms(data.ocrLayoutMs)}</div>
          <div>首屏绘制等待：{ms(data.firstPaintMs)}</div>
          <div>首轮翻译：{ms(data.translationMs)}</div>
          {data.aiRefineMs !== undefined && <div>AI 精翻：{ms(data.aiRefineMs)}</div>}
          {data.total !== undefined && <div>复用缓存：{data.memoHits ?? 0}/{data.total} 段</div>}
          {data.failure && <div className="text-amber-500">最近失败：{failureLabel[data.failure]}（可单段重试）</div>}
          <div className="pt-1 font-semibold">实际翻译来源</div>
          {sources.map(({ name, count }) => <div key={name} className="break-all">{name} · {count} 段</div>)}
          <div className="opacity-60">耗时在本机测得；绘制为从提交卡片到下次画帧的等待时间，不等同 GPU 纯绘制耗时。</div>
        </div>
      )}
    </div>
  );
};
