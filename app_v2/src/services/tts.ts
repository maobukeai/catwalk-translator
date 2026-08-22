import { useSettingsStore } from '../stores/useSettingsStore';

/**
 * 共享 TTS 朗读入口：全部朗读调用点统一走这里，语速跟随设置中心的
 * ttsRate（0.5~2.0，默认 1.0）。开始新朗读前先取消上一段。
 */
export function speakText(
  text: string,
  opts?: { lang?: string; rate?: number; onEnd?: () => void }
): void {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = opts?.lang || 'en-US';
  const settingsRate = useSettingsStore.getState().settings.ttsRate;
  utterance.rate =
    opts?.rate ??
    (typeof settingsRate === 'number' && settingsRate > 0 ? settingsRate : 1.0);
  if (opts?.onEnd) {
    utterance.onend = opts.onEnd;
    utterance.onerror = opts.onEnd;
  }
  window.speechSynthesis.speak(utterance);
}
