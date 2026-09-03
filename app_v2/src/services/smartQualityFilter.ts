/**
 * 优质生词智能甄选引擎 (Smart Vocabulary Quality Filter)
 *
 * 自动识别真正具备学习与收藏价值的优质专业术语、行业表达与 AI 精翻短语，
 * 自动拦截纯数字、标点、代码符号与无学习价值的日常极高频功能词。
 */

// 日常极高频、无生词学习价值的基础界面与操作词（即使划选也不自动加星标）
const COMMON_TRIVIAL_WORDS = new Set([
  'ok', 'cancel', 'yes', 'no', 'close', 'open', 'save', 'file', 'edit', 'view',
  'help', 'copy', 'paste', 'cut', 'delete', 'undo', 'redo', 'select', 'clear',
  'back', 'next', 'previous', 'done', 'exit', 'quit', 'settings', 'options',
  'true', 'false', 'null', 'undefined', 'error', 'warning', 'info', 'loading',
  'search', 'find', 'replace', 'start', 'stop', 'play', 'pause', 'resume',
  'left', 'right', 'top', 'bottom', 'center', 'width', 'height', 'size',
  'click', 'press', 'drag', 'drop', 'type', 'key', 'button', 'input', 'output'
]);

export interface QualityEvaluation {
  isQuality: boolean;
  reason?: string;
  category?: 'cg_term' | 'ai_refined' | 'advanced_phrase' | 'glossary_term' | 'trivial';
}

/**
 * 综合评估待保存的翻译文本块是否属于优质内容
 */
export function evaluateTranslationQuality(
  original: string,
  translated: string,
  sourceTier: string
): QualityEvaluation {
  const orig = original.trim();
  const trans = translated.trim();
  const tier = sourceTier || '';

  // 1. 硬性无效内容过滤
  if (!orig || !trans || orig === trans) {
    return { isQuality: false, category: 'trivial', reason: '原文与译文相同或为空' };
  }

  // 纯数字、时间戳、百分比、数值
  if (/^[\d\s.,:%+\-/*#$@!^&()_=[\]{}|\\/<>?]+$/.test(orig)) {
    return { isQuality: false, category: 'trivial', reason: '纯数字或符号' };
  }

  // URL、文件路径、代码包引用
  if (/^(https?:\/\/|[a-zA-Z]:\\|\/|\.\/|import |export )/i.test(orig)) {
    return { isQuality: false, category: 'trivial', reason: '链接或代码路径' };
  }

  // 长度过短（小于 2 个字符）
  if (orig.length < 2) {
    return { isQuality: false, category: 'trivial', reason: '过短无意义字符' };
  }

  const lowerOrig = orig.toLowerCase();

  // 2. 高优先级优质标准 ①：命中用户自定义词库或专业 3D/CG 预置词库
  if (
    tier.includes('custom_dict') ||
    tier.includes('已生词本') ||
    tier.includes('Preset') ||
    tier.includes('词库') ||
    tier.includes('Blender') ||
    tier.includes('Substance') ||
    tier.includes('Maya') ||
    tier.includes('Unity') ||
    tier.includes('Unreal')
  ) {
    return { isQuality: true, category: 'cg_term', reason: '行业专业词库精准命中' };
  }

  // 3. 高优先级优质标准 ②：大模型 AI 深度润色精翻（包含 ✨ 且长度合理）
  if (tier.includes('✨') || tier.includes('AI 精翻') || tier.includes('LLM')) {
    const wordCount = orig.split(/\s+/).length;
    // 短语或有学习价值的精练句子（2 ~ 12 个词）
    if (wordCount >= 2 && wordCount <= 15) {
      return { isQuality: true, category: 'ai_refined', reason: 'AI 深度精翻高价值短语' };
    }
  }

  // 4. 过滤日常极高频操作词（如 'OK', 'Cancel', 'File' 等）
  if (COMMON_TRIVIAL_WORDS.has(lowerOrig)) {
    return { isQuality: false, category: 'trivial', reason: '日常极高频操作词' };
  }

  // 5. 英文专业表达或高阶复合词判定（2 ~ 6 个英文词组成的术语短语，如 "Ambient Occlusion", "Subsurface Scattering"）
  const words = orig.split(/\s+/);
  const isEnglishPhrase = words.every((w) => /^[a-zA-Z0-9_\-']+$/.test(w));
  if (isEnglishPhrase) {
    if (words.length >= 2 && words.length <= 6) {
      return { isQuality: true, category: 'advanced_phrase', reason: '专业英文复合术语/短语' };
    }
    // 优质单生词：长度 >= 5，非日常词汇，译文包含中文深度释义
    if (words.length === 1 && orig.length >= 5 && /[\u4e00-\u9fa5]/.test(trans)) {
      return { isQuality: true, category: 'glossary_term', reason: '高阶核心英文生词' };
    }
  }

  return { isQuality: false, category: 'trivial', reason: '常规普通记录' };
}
