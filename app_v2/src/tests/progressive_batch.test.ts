import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAST_TRANSLATION_TIMEOUT_MS,
  LLM_TRANSLATION_TIMEOUT_MS,
  TRANSLATION_FAILURE_TIER,
  TRANSLATION_TIMEOUT_TIER,
  translatePhrasesProgressively,
  withDeadline,
} from '../services/progressiveTranslation';
import type { LlmConfig, TranslationResult } from '../services/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function translations(phrases: string[]): TranslationResult[] {
  return phrases.map((original) => ({ original, translated: `译:${original}`, sourceTier: '在线' }));
}

async function flush() {
  // Advance Promise continuations without advancing the deadline timer.
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('capture progressive phrase batches', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes a completed batch before another slower batch finishes', async () => {
    const phrases = Array.from({ length: 8 }, (_, index) => `text${index}`);
    const first = deferred<TranslationResult[]>();
    const second = deferred<TranslationResult[]>();
    const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onResult = vi.fn();
    const task = translatePhrasesProgressively(phrases, { preset: 'auto', request, onResult });
    await flush();
    second.resolve(translations(phrases.slice(4)));
    await flush();
    expect(onResult.mock.calls.map(([index]) => index)).toEqual([4, 5, 6, 7]);
    first.resolve(translations(phrases.slice(0, 4)));
    expect(await task).toEqual(translations(phrases));
    expect(onResult).toHaveBeenCalledTimes(8);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs at most four batches of four, then refills completed slots', async () => {
    const phrases = Array.from({ length: 24 }, (_, index) => `text${index}`);
    const pending = phrases.map(() => deferred<TranslationResult[]>());
    const request = vi.fn((batch: string[]) => pending[Number(batch[0].slice(4)) / 4].promise);
    const task = translatePhrasesProgressively(phrases, { preset: 'auto', request });
    await flush();
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.map(([batch]) => batch.length)).toEqual([4, 4, 4, 4]);
    pending[1].resolve(translations(phrases.slice(4, 8)));
    await flush();
    expect(request).toHaveBeenCalledTimes(5);
    pending[0].resolve(translations(phrases.slice(0, 4)));
    await flush();
    expect(request).toHaveBeenCalledTimes(6);
    for (let index = 2; index < 6; index += 1) {
      pending[index].resolve(translations(phrases.slice(index * 4, index * 4 + 4)));
    }
    expect(await task).toEqual(translations(phrases));
  });

  it('deduplicates network phrases while preserving every original index', async () => {
    const phrases = ['a', 'b', 'a', 'c', 'd', 'b', 'e'];
    const request = vi.fn(async (batch: string[]) => translations(batch).reverse());
    const onResult = vi.fn();
    const results = await translatePhrasesProgressively(phrases, { preset: 'blender', request, onResult });
    expect(request.mock.calls.flatMap(([batch]) => batch)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(results).toEqual(translations(phrases));
    expect(onResult).toHaveBeenCalledTimes(phrases.length);
    expect(onResult.mock.calls.map(([index]) => index).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('returns explicit retry results for errors, missing items and blank translations', async () => {
    const phrases = ['a', 'b', 'c', 'd', 'e'];
    const request = vi.fn()
      .mockResolvedValueOnce([
        ...translations(['a']),
        { original: 'c', translated: '  ', sourceTier: '在线' },
        ...translations(['d']),
      ])
      .mockRejectedValueOnce(new Error('offline'));
    const onResult = vi.fn();
    const results = await translatePhrasesProgressively(phrases, { preset: 'auto', request, onResult });
    for (const index of [1, 2, 4]) {
      expect(results[index]).toEqual({ original: phrases[index], translated: '', sourceTier: TRANSLATION_FAILURE_TIER });
    }
    expect(results[3]).toEqual(translations(['d'])[0]);
    expect(onResult).toHaveBeenCalledTimes(5);
  });

  it('uses one hard deadline, stops queued requests, and ignores late results', async () => {
    const phrases = Array.from({ length: 24 }, (_, index) => `text${index}`);
    const pending = deferred<TranslationResult[]>();
    const request = vi.fn(() => pending.promise);
    const onResult = vi.fn();
    const task = translatePhrasesProgressively(phrases, { preset: 'auto', request, onResult });
    await flush();
    expect(request).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(FAST_TRANSLATION_TIMEOUT_MS);
    const results = await task;
    expect(results.every((result) => result.sourceTier === TRANSLATION_TIMEOUT_TIER)).toBe(true);
    expect(onResult).toHaveBeenCalledTimes(24);
    pending.resolve(translations(phrases));
    await flush();
    expect(request).toHaveBeenCalledTimes(4);
    expect(onResult).toHaveBeenCalledTimes(24);
    expect(results.every((result) => result.translated === '')).toBe(true);
  });

  it('treats malformed IPC arrays and missing IPC responses as settled failures', async () => {
    const phrases = Array.from({ length: 12 }, (_, index) => `text${index}`);
    const request = vi.fn().mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([null, {}, 'bad', { original: 'text8', translated: 42 }]);
    const onResult = vi.fn();
    const results = await translatePhrasesProgressively(phrases, { preset: 'auto', request, onResult });
    expect(results.every((result) => result.sourceTier === TRANSLATION_FAILURE_TIER)).toBe(true);
    expect(onResult).toHaveBeenCalledTimes(12);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves previously accepted results intact when the remaining queue times out', async () => {
    const phrases = Array.from({ length: 8 }, (_, index) => `text${index}`);
    const request = vi.fn().mockResolvedValueOnce(translations(phrases.slice(0, 4)))
      .mockReturnValueOnce(new Promise(() => {}));
    const onResult = vi.fn();
    const task = translatePhrasesProgressively(phrases, { preset: 'auto', request, onResult });
    await flush();
    await vi.advanceTimersByTimeAsync(FAST_TRANSLATION_TIMEOUT_MS);
    const results = await task;
    expect(results.slice(0, 4)).toEqual(translations(phrases.slice(0, 4)));
    expect(results.slice(4).every((result) => result.translated === '')).toBe(true);
    expect(onResult).toHaveBeenCalledTimes(8);
  });

  it('does not start, publish, or update a stale capture', async () => {
    const phrases = Array.from({ length: 24 }, (_, index) => `text${index}`);
    const pending = deferred<TranslationResult[]>();
    let stale = false;
    const request = vi.fn(() => pending.promise);
    const onResult = vi.fn();
    const task = translatePhrasesProgressively(phrases, {
      preset: 'auto', request, onResult, isStale: () => stale,
    });
    await flush();
    stale = true;
    pending.resolve(translations(phrases));
    const results = await task;
    await flush();
    expect(request).toHaveBeenCalledTimes(4);
    expect(onResult).not.toHaveBeenCalled();
    expect(results.every((result) => result.translated === '')).toBe(true);
    request.mockClear();
    await translatePhrasesProgressively(phrases, { preset: 'auto', request, isStale: () => true });
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks staleness again before invocation and between result callbacks', async () => {
    let stale = false;
    const request = vi.fn(async (batch: string[]) => translations(batch));
    const onResult = vi.fn(() => { stale = true; });
    const task = translatePhrasesProgressively(['a', 'b', 'c', 'd', 'e'], {
      preset: 'auto', request, onResult, isStale: () => stale,
    });
    expect((await task)[0].translated).toBe('译:a');
    expect(onResult).toHaveBeenCalledTimes(1);
    request.mockClear();
    stale = false;
    const replaced = translatePhrasesProgressively(['a'], {
      preset: 'auto', request, isStale: () => stale,
    });
    stale = true;
    await replaced;
    expect(request).not.toHaveBeenCalled();
  });

  it('settles a stale stalled capture at its deadline without publishing failures', async () => {
    let stale = false;
    const request = vi.fn(() => new Promise<TranslationResult[]>(() => {}));
    const onResult = vi.fn();
    const task = translatePhrasesProgressively(['a'], {
      preset: 'auto', request, onResult, isStale: () => stale,
    });
    await flush();
    stale = true;
    await vi.advanceTimersByTimeAsync(FAST_TRANSLATION_TIMEOUT_MS);
    expect((await task)[0].sourceTier).toBe(TRANSLATION_FAILURE_TIER);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('retains LLM capture context in one deduplicated batch and uses the longer deadline', async () => {
    const llmConfig: LlmConfig = { provider: 'test', endpoint: 'test', apiKey: 'test', model: 'test' };
    const request = vi.fn(() => new Promise<TranslationResult[]>(() => {}));
    const task = translatePhrasesProgressively(['a', 'b', 'a', 'c', 'd', 'e'], {
      preset: 'blender', llmConfig, style: 'terminology', targetLang: 'ja', request,
    });
    const completed = vi.fn();
    task.then(completed);
    await flush();
    expect(request).toHaveBeenCalledExactlyOnceWith(
      ['a', 'b', 'c', 'd', 'e'], 'blender', llmConfig, 'terminology', 'ja',
    );
    await vi.advanceTimersByTimeAsync(FAST_TRANSLATION_TIMEOUT_MS);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LLM_TRANSLATION_TIMEOUT_MS - FAST_TRANSLATION_TIMEOUT_MS);
    expect((await task).every((result) => result.sourceTier === TRANSLATION_TIMEOUT_TIER)).toBe(true);
  });

  it('supports single-phrase online retry batches and recognizes upstream timeouts', async () => {
    const request = vi.fn().mockRejectedValue(new Error('request timeout'));
    const task = translatePhrasesProgressively(['a', 'b', 'c', 'd', 'e'], {
      preset: 'auto', request, batchSize: 1,
    });
    expect((await task).every((result) => result.sourceTier === TRANSLATION_TIMEOUT_TIER)).toBe(true);
    expect(request.mock.calls.map(([batch]) => batch)).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
  });

  it('settles empty captures without requests', async () => {
    const request = vi.fn();
    expect(await translatePhrasesProgressively([], { preset: 'auto', request })).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('normalizes invalid deadlines and batch sizes without starting expired requests', async () => {
    const request = vi.fn(async (batch: string[]) => translations(batch));
    const expired = await translatePhrasesProgressively(['a'], { preset: 'auto', request, timeoutMs: -1 });
    expect(expired[0].sourceTier).toBe(TRANSLATION_TIMEOUT_TIER);
    expect(request).not.toHaveBeenCalled();
    expect(await translatePhrasesProgressively(['a', 'b'], {
      preset: 'auto', request, timeoutMs: NaN, batchSize: NaN,
    })).toEqual(translations(['a', 'b']));
    expect(request.mock.calls[0][0]).toEqual(['a', 'b']);
    request.mockClear();
    await translatePhrasesProgressively(['a', 'b'], { preset: 'auto', request, batchSize: -1 });
    expect(request.mock.calls.map(([batch]) => batch)).toEqual([['a'], ['b']]);
  });
});

describe('IPC operation deadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rejects a stalled IPC wait and observes a late underlying rejection', async () => {
    const operation = deferred<string>();
    const bounded = withDeadline(operation.promise, 30_000, 'OCR 超时，请重试');
    const rejection = expect(bounded).rejects.toThrow('OCR 超时，请重试');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    operation.reject(new Error('late IPC rejection'));
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer when the IPC operation succeeds or rejects promptly', async () => {
    expect(await withDeadline(Promise.resolve('done'))).toBe('done');
    await expect(withDeadline(Promise.reject(new Error('OCR failed')))).rejects.toThrow('OCR failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes non-finite deadline durations', async () => {
    const operation = deferred<string>();
    const bounded = withDeadline(operation.promise, NaN);
    const rejection = expect(bounded).rejects.toThrow('操作超时，请重试');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });
});
