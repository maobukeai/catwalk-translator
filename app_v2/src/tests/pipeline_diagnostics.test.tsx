import { fireEvent, render, screen } from '@testing-library/react';
import { PipelineDiagnostics } from '../components/Overlay/PipelineDiagnostics';
import { classifyTranslationFailure, hasUsableTranslation, isSuccessfulLlmTier, summarizeTranslationSources } from '../services/pipelineDiagnostics';
import type { OverlayBlock } from '../services/types';

const block = (sourceTier: string, translationFailed = false) => ({ sourceTier, translationFailed }) as OverlayBlock;

describe('pipeline diagnostics', () => {
  it('aggregates actual sources and failures across all blocks', () => {
    expect(summarizeTranslationSources([block('Google'), block('Google'), block('词库'), block('OCR', true)]))
      .toEqual([{ name: 'Google', count: 2 }, { name: '词库', count: 1 }, { name: '翻译失败', count: 1 }]);
  });

  it('categorizes failures without exposing provider error bodies', () => {
    expect(classifyTranslationFailure('https://private.example/api?key=secret timeout')).toBe('timeout');
    expect(classifyTranslationFailure('HTTP 429 quota exhausted')).toBe('rate_limit');
    expect(classifyTranslationFailure('DNS connection error')).toBe('network');
  });

  it('does not mislabel an LLM auth failure as a successful model translation', () => {
    expect(isSuccessfulLlmTier('LLM (Auth Error)')).toBe(false);
    expect(isSuccessfulLlmTier('DeepSeek (Quota Error)')).toBe(false);
    expect(isSuccessfulLlmTier('Gemini AI 精翻 ✨')).toBe(true);
    expect(isSuccessfulLlmTier('Qwen LLM API')).toBe(true);
    expect(isSuccessfulLlmTier('Google 翻译')).toBe(false);
  });

  it('does not cache or report the original-text failure sentinel as a translation', () => {
    expect(hasUsableTranslation({ translated: 'original', sourceTier: '翻译失败·点击重试' })).toBe(false);
    expect(hasUsableTranslation({ translated: 'original', sourceTier: 'LLM (Auth Error)' })).toBe(false);
    expect(hasUsableTranslation({ translated: 'UI_Node_1', sourceTier: '标识符透传' })).toBe(true);
    expect(hasUsableTranslation({ translated: '你好', sourceTier: 'Google 官方' })).toBe(true);
  });

  it('shows measured stages, cache reuse and actual source on demand', () => {
    render(<PipelineDiagnostics data={{ captureMs: 31, ocrLayoutMs: 287.8, firstPaintMs: 16, translationMs: 90.1, memoHits: 1, total: 2, failure: 'timeout' }} blocks={[block('Google'), block('OCR', true)]} isLight={false} />);
    fireEvent.click(screen.getByRole('button', { name: '查看本次识别与翻译诊断' }));
    const details = screen.getByTestId('pipeline-diagnostics-details');
    expect(details).toHaveTextContent('截图准备：31 ms');
    expect(details).toHaveTextContent('识别＋排版：288 ms');
    expect(details).toHaveTextContent('首屏绘制等待：16 ms');
    expect(details).toHaveTextContent('首轮翻译：90 ms');
    expect(details).toHaveTextContent('复用缓存：1/2 段');
    expect(details).toHaveTextContent('请求超时');
    expect(details).toHaveTextContent('Google · 1 段');
    expect(details).not.toHaveTextContent('private.example');
  });
});
