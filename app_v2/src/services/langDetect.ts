/**
 * Unicode-range heuristic for picking a speechSynthesis voice language.
 * The OCR pipeline does not report a detected language, so we guess from the
 * character blocks present in the source text — good enough for TTS picking
 * the right voice (ja/ko/zh disambiguation included).
 */
export function detectSpeechLang(text: string): string {
  if (!text) return 'en-US';
  // Hiragana / Katakana → Japanese
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja-JP';
  // Hangul syllables / Jamo → Korean
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(text)) return 'ko-KR';
  // CJK ideographs (no kana) → Chinese
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  // Cyrillic → Russian
  if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU';
  return 'en-US';
}
