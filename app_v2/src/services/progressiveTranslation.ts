import { cmdTranslatePhrasesStyled } from './tauri';
import type { LlmConfig, TranslationResult } from './types';

export const FAST_TRANSLATION_TIMEOUT_MS = 12_000;
export const LLM_TRANSLATION_TIMEOUT_MS = 30_000;
export const TRANSLATION_FAILURE_TIER = '翻译失败·点击重试';
export const TRANSLATION_TIMEOUT_TIER = '翻译失败·超时·点击重试';

export interface ProgressiveTranslationOptions {
  preset: string;
  llmConfig?: LlmConfig | null;
  style?: 'literal' | 'free' | 'terminology';
  targetLang?: string | null;
  onResult?: (index: number, result: TranslationResult) => void;
  /** Becomes true when a capture has been replaced or its overlay closed. */
  isStale?: () => boolean;
  /** One deadline for the entire queue, including time waiting for a slot. */
  timeoutMs?: number;
  /** Fast-path requests use four phrases by default; forced online retries use one. */
  batchSize?: number;
  request?: typeof cmdTranslatePhrasesStyled;
}

/** Bound IPC waits as well as network waits; a late rejection is still observed. */
export function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs = 30_000,
  message = '操作超时，请重试',
): Promise<T> {
  const duration = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 30_000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), duration);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Small concurrent batches let the overlay display early translations without
 * waiting for its slowest text. LLM requests retain the whole capture's context.
 * Tauri IPC cannot be aborted, so expired requests are ignored and no queued
 * requests are started after expiry or after the capture becomes stale.
 */
export function translatePhrasesProgressively(
  phrases: string[],
  options: ProgressiveTranslationOptions,
): Promise<TranslationResult[]> {
  const results = phrases.map((original): TranslationResult => ({
    original,
    translated: '',
    sourceTier: TRANSLATION_FAILURE_TIER,
  }));
  if (phrases.length === 0 || options.isStale?.()) return Promise.resolve(results);

  const indices = new Map<string, number[]>();
  phrases.forEach((phrase, index) => {
    const existing = indices.get(phrase);
    if (existing) existing.push(index);
    else indices.set(phrase, [index]);
  });
  const unique = [...indices.keys()];
  const fastBatchSize = Number.isFinite(options.batchSize)
    ? Math.max(1, Math.floor(options.batchSize!))
    : 4;
  const batchSize = options.llmConfig ? unique.length : fastBatchSize;
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += batchSize) {
    batches.push(unique.slice(start, start + batchSize));
  }
  const defaultTimeout = options.llmConfig
    ? LLM_TRANSLATION_TIMEOUT_MS
    : FAST_TRANSLATION_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(0, options.timeoutMs!)
    : defaultTimeout;
  const expiresAt = Date.now() + timeoutMs;
  const request = options.request ?? cmdTranslatePhrasesStyled;

  return new Promise<TranslationResult[]>((resolve) => {
    const settled = phrases.map(() => false);
    let nextBatch = 0;
    let active = 0;
    let closed = false;

    const notify = (index: number) => {
      try {
        options.onResult?.(index, results[index]);
      } catch (error) {
        // A rendering callback must not prevent the remaining queue settling.
        console.warn('Progressive translation result callback failed:', error);
      }
    };
    const finish = (reportFailures: boolean) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (reportFailures) {
        for (let index = 0; index < results.length; index += 1) {
          if (options.isStale?.()) break;
          if (!settled[index]) {
            results[index] = { ...results[index], sourceTier: TRANSLATION_TIMEOUT_TIER };
            notify(index);
          }
        }
      }
      resolve(results);
    };
    const canContinue = () => {
      if (closed) return false;
      if (options.isStale?.()) { finish(false); return false; }
      if (Date.now() >= expiresAt) { finish(true); return false; }
      return true;
    };
    const timer = setTimeout(() => finish(true), timeoutMs);

    const acceptBatch = (
      batch: string[],
      response: TranslationResult[],
      failureTier = TRANSLATION_FAILURE_TIER,
    ) => {
      if (!canContinue()) return;
      const usableResponse = Array.isArray(response)
        ? response.filter((result) => result && typeof result.original === 'string')
        : [];
      const byOriginal = new Map(usableResponse.map((result) => [result.original, result]));
      for (const phrase of batch) {
        const candidate = byOriginal.get(phrase);
        const value = candidate && typeof candidate.translated === 'string'
          && candidate.translated.trim()
          ? { ...candidate, original: phrase }
          : { original: phrase, translated: '', sourceTier: failureTier };
        for (const index of indices.get(phrase)!) {
          if (!canContinue()) return;
          results[index] = { ...value };
          settled[index] = true;
          notify(index);
        }
      }
    };

    const schedule = () => {
      if (!canContinue()) return;
      while (active < 4 && nextBatch < batches.length && canContinue()) {
        const batch = batches[nextBatch++];
        active += 1;
        // Check again at invocation time, in case another capture replaced this
        // one before the queued microtask had a chance to start the IPC call.
        void Promise.resolve().then(() => {
          if (!canContinue()) return [];
          return request(batch, options.preset, options.llmConfig, options.style, options.targetLang);
        }).then(
          (response) => acceptBatch(batch, response),
          (error) => acceptBatch(batch, [], /timeout|timed out|超时/i.test(String(error))
            ? TRANSLATION_TIMEOUT_TIER : TRANSLATION_FAILURE_TIER),
        ).finally(() => {
          active -= 1;
          if (!canContinue()) return;
          if (nextBatch >= batches.length && active === 0) finish(false);
          else schedule();
        });
      }
    };
    schedule();
  });
}
