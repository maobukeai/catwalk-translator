import type { OverlayBlock, TranslationResult } from './types';

export interface PipelineDiagnosticsData {
  captureMs?: number;
  ocrLayoutMs?: number;
  firstPaintMs?: number;
  translationMs?: number;
  aiRefineMs?: number;
  memoHits?: number;
  total?: number;
  failure?: 'timeout' | 'rate_limit' | 'network' | 'unavailable';
}

/** Keep provider URLs, API keys and server error bodies out of the overlay. */
export function classifyTranslationFailure(error: unknown): NonNullable<PipelineDiagnosticsData['failure']> {
  const message = String(error).toLowerCase();
  if (/429|rate.limit|quota|额度|限流/.test(message)) return 'rate_limit';
  if (/timeout|timed.out|超时/.test(message)) return 'timeout';
  if (/network|connect|fetch|dns|网络|连接/.test(message)) return 'network';
  return 'unavailable';
}

export const failureLabel: Record<NonNullable<PipelineDiagnosticsData['failure']>, string> = {
  timeout: '请求超时',
  rate_limit: '额度或限流',
  network: '网络连接失败',
  unavailable: '翻译通道不可用',
};

/** A provider name in an error tier is not evidence that the LLM translated. */
export function isSuccessfulLlmTier(tier: string): boolean {
  const value = tier.toLowerCase();
  if (/error|config.required|quota|fallback|retry|失败|兜底/.test(value)) return false;
  return /llm api|ai 精翻|deepseek|openai|ollama|gemini|claude|qwen|通义|千问|glm|moonshot|kimi|groq|siliconflow/.test(value);
}

/** Rust preserves the original text on total failure; that is not a success. */
export function hasUsableTranslation(result: Pick<TranslationResult, 'translated' | 'sourceTier'> | null | undefined): boolean {
  if (!result?.translated?.trim()) return false;
  return !/翻译失败|untranslated|auth error|quota error|config required|online \(retry\)|online \(unconfigured\)/i.test(result.sourceTier || '');
}

export function summarizeTranslationSources(blocks: Pick<OverlayBlock, 'sourceTier' | 'translationFailed'>[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const name = block.translationFailed ? '翻译失败' : (block.sourceTier || '来源未注明');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
