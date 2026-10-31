import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';
import * as api from '../services/tauri';
import type { UniversalTranslationResponse } from '../services/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function result(original: string, translated: string): UniversalTranslationResponse {
  return { original, detectedLang: 'en', mainTranslation: translated,
    engines: [{ engineName: 'Bing', translated, sourceTier: 'Online Fallback' }] };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, 'cmdTranslatePhrasesStyled').mockResolvedValue([]);
  vi.spyOn(api, 'saveTranslationHistory').mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('translation request lifecycle', () => {
  it('keeps a mostly English screenshot targeting Chinese despite a Chinese caption', async () => {
    const text = 'Save your changes before closing the application.\nThe selected objects will be deleted.\n中文界面标签';
    expect(api.detectLanguage(text)).toEqual({ detected: 'en', suggestedTarget: 'zh-CN' });
    expect(api.detectLanguage('変更を保存しますか')).toEqual({ detected: 'ja', suggestedTarget: 'zh-CN' });
    const translate = vi.spyOn(api, 'cmdUniversalTranslate').mockResolvedValue(result(text, '请先保存更改。'));
    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText={text} />);
    await waitFor(() => expect(translate).toHaveBeenCalledWith(expect.objectContaining({ targetLang: 'zh-CN' })));
  });

  it('does not restore a late translation after clearing the input', async () => {
    const pending = deferred<UniversalTranslationResponse>();
    const translate = vi.spyOn(api, 'cmdUniversalTranslate').mockReturnValue(pending.promise);
    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="Old text" />);
    await waitFor(() => expect(translate).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle('清空内容'));
    await act(async () => pending.resolve(result('Old text', '不应恢复的旧译文')));
    expect(screen.queryByText('不应恢复的旧译文')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('rejects an old reply during the new input debounce interval', async () => {
    const pending = deferred<UniversalTranslationResponse>();
    const translate = vi.spyOn(api, 'cmdUniversalTranslate').mockReturnValue(pending.promise);
    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="Old text" />);
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New text' } });
    await act(async () => pending.resolve(result('Old text', '迟到的旧译文')));
    expect(screen.queryByText('迟到的旧译文')).not.toBeInTheDocument();
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('shows the next flash result and retains it if the comparison engines fail', async () => {
    vi.mocked(api.cmdTranslatePhrasesStyled).mockImplementation(async (phrases) =>
      [{ original: phrases[0], translated: phrases[0] === 'First text' ? '第一快译' : '第二快译', sourceTier: 'Bing' }]);
    const next = deferred<UniversalTranslationResponse>();
    vi.spyOn(api, 'cmdUniversalTranslate').mockImplementation((params) => params.text === 'First text'
      ? Promise.resolve(result('First text', '第一完整译文')) : next.promise);
    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="First text" />);
    await screen.findByText('第一完整译文');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second text' } });
    await screen.findByText('第二快译');
    await act(async () => next.resolve({ original: 'Second text', detectedLang: 'en', mainTranslation: '网络连接超时，点击重试',
      engines: [{ engineName: 'Bing', translated: '网络连接超时，点击重试', sourceTier: 'Online (Retry)' }] }));
    expect(screen.getAllByText('第二快译').length).toBeGreaterThan(0);
    expect(screen.queryByText('第一完整译文')).not.toBeInTheDocument();
  });

  it('provides a visible error when translation fails without a usable result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(api, 'cmdUniversalTranslate').mockRejectedValue(new Error('服务不可用'));
    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="Translate this" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('服务不可用');
  });

  it('does not present a failed flash channel echo as a successful translation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(api.cmdTranslatePhrasesStyled).mockResolvedValue([
      { original: 'Untranslated source', translated: 'Untranslated source', sourceTier: '翻译失败·点击重试' },
    ]);
    vi.spyOn(api, 'cmdUniversalTranslate').mockRejectedValue(new Error('服务不可用'));
    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="Untranslated source" />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/⚡ 极速快译/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Untranslated source')).toHaveLength(1);
  });
});
