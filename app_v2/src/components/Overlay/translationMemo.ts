import type { TranslationResult } from '../../services/types';

/** Translation memo: identical (text, targetLang, preset, style) hits skip the
 *  network entirely — region-watch re-translations of unchanged text are
 *  instant and the cards never flash. Bounded FIFO eviction at 500 entries. */
const TRANSLATION_MEMO = new Map<string, TranslationResult>();
const TRANSLATION_MEMO_MAX = 500;

export function memoKey(
  text: string,
  lang: string,
  preset: string,
  style?: string,
  glossaryFp?: string
) {
  // glossaryFp:自定义词库指纹——术语强制表变化后旧缓存自然失效
  return `${text}||${lang}||${preset}||${style || ''}||${glossaryFp || ''}`;
}

export function memoGet(key: string): TranslationResult | undefined {
  return TRANSLATION_MEMO.get(key);
}

export function memoPut(key: string, tr: TranslationResult) {
  if (TRANSLATION_MEMO.size >= TRANSLATION_MEMO_MAX) {
    const oldest = TRANSLATION_MEMO.keys().next().value;
    if (oldest !== undefined) TRANSLATION_MEMO.delete(oldest);
  }
  TRANSLATION_MEMO.set(key, tr);
}

/** Test hook: the module-level memo leaks across test cases otherwise. */
export function __clearTranslationMemoForTests() {
  TRANSLATION_MEMO.clear();
}
