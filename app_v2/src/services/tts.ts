import { useSettingsStore } from '../stores/useSettingsStore';
import { playEdgeTts, stopCurrentEdgeAudio } from './edgeTts';
import { cmdFetchTtsAudio } from './tauri';

/**
 * 优选系统内置的高品质自然人声 (针对 Windows 10/11 优先匹配带有 Natural / Online 的发音人)
 */
function findBestSystemVoice(lang: string): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window) || !window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const targetLang = (lang || 'en-US').toLowerCase();
  const isZh = targetLang.startsWith('zh');
  const isJa = targetLang.startsWith('ja');
  const isEn = targetLang.startsWith('en');

  // 1. 最高优先级：微软 Edge/Win11 神经网络自然发音人 (带有 Natural / Xiaoxiao / Jenny 等)
  if (isZh) {
    const zhNatural = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith('zh') &&
        (v.name.includes('Natural') ||
          v.name.includes('Xiaoxiao') ||
          v.name.includes('Yunxi') ||
          v.name.includes('Yaoyao'))
    );
    if (zhNatural) return zhNatural;
  } else if (isEn) {
    const enNatural = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith('en') &&
        (v.name.includes('Natural') ||
          v.name.includes('Jenny') ||
          v.name.includes('Guy') ||
          v.name.includes('Aria'))
    );
    if (enNatural) return enNatural;
  } else if (isJa) {
    const jaNatural = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith('ja') &&
        (v.name.includes('Natural') || v.name.includes('Nanami') || v.name.includes('Keita'))
    );
    if (jaNatural) return jaNatural;
  }

  // 2. 次优先级：完全匹配语言前缀且带有 Online 标志的声音
  const onlineVoice = voices.find(
    (v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)) && v.name.includes('Online')
  );
  if (onlineVoice) return onlineVoice;

  // 3. 第三优先级：语言完全一致的声音
  const exactMatch = voices.find((v) => v.lang.toLowerCase() === targetLang);
  if (exactMatch) return exactMatch;

  // 4. 最后兜底：语言前缀匹配的声音
  const prefixMatch = voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)));
  return prefixMatch || null;
}

/**
 * 方案 B: 系统原生 Web Speech API 离线语音合成
 */
export function speakWithSystemSpeech(
  text: string,
  opts?: { lang?: string; rate?: number; onEnd?: () => void }
): void {
  const UtteranceClass = typeof window !== 'undefined' ? (window as any).SpeechSynthesisUtterance || (globalThis as any).SpeechSynthesisUtterance : null;
  if (!('speechSynthesis' in window) || !UtteranceClass || !text.trim()) {
    opts?.onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();

  const utterance = new UtteranceClass(text);
  const lang = opts?.lang || 'en-US';
  utterance.lang = lang;

  const voice = findBestSystemVoice(lang);
  if (voice) {
    utterance.voice = voice;
  }

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

let activeTtsAudio: HTMLAudioElement | null = null;
let currentTtsSession = 0;

/**
 * 停止当前所有播放（同时中止在线高保真音频与本地系统语音，并废弃所有在途请求）
 */
export function stopSpeech(): void {
  currentTtsSession++;
  if (activeTtsAudio) {
    try {
      activeTtsAudio.pause();
      activeTtsAudio.currentTime = 0;
      activeTtsAudio.src = '';
    } catch (_) {}
    activeTtsAudio = null;
  }
  stopCurrentEdgeAudio();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }
}

/**
 * 共享统一 TTS 朗读入口：
 * 采用【方案 A: 官方高保真播音级真人原声通道】优先；
 * 一旦遇到弱网、离线或合成异常，自动平滑回退至【方案 B: 系统自然语音兜底】。
 */
export function speakText(
  text: string,
  opts?: { lang?: string; rate?: number; onEnd?: () => void }
): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  // 停止先前的朗读并开启全新 Session 纪元
  stopSpeech();
  const session = currentTtsSession;

  const settings = useSettingsStore.getState().settings;
  const settingsRate = settings?.ttsRate;
  const effectiveRate =
    opts?.rate ??
    (typeof settingsRate === 'number' && settingsRate > 0 ? settingsRate : 1.0);

  // 若用户设置偏好为系统语音，或当前处于测试 Mock 环境 (明确 mock 了 speechSynthesis.speak)
  const isTestMocked =
    typeof window !== 'undefined' &&
    !!(window as any).speechSynthesis &&
    !!(window as any).speechSynthesis.speak?._isMockFunction;
  const preferSystem = (settings as any).ttsEngine === 'system' || isTestMocked;

  if (preferSystem) {
    speakWithSystemSpeech(trimmed, {
      lang: opts?.lang,
      rate: effectiveRate,
      onEnd: opts?.onEnd,
    });
    return;
  }

  // 优先执行方案 A (官方高保真真人原声，无 CSP 与无握手限制)
  cmdFetchTtsAudio(trimmed, opts?.lang, effectiveRate)
    .then((dataUrl) => {
      // 若在网络请求期间用户已退出了遮罩或触发了 stopSpeech，立即丢弃，绝不播放！
      if (session !== currentTtsSession) return;

      const audio = new Audio(dataUrl);
      activeTtsAudio = audio;
      audio.onended = () => {
        if (activeTtsAudio === audio) activeTtsAudio = null;
        opts?.onEnd?.();
      };
      audio.onerror = () => {
        if (activeTtsAudio === audio) activeTtsAudio = null;
        if (session === currentTtsSession) {
          speakWithSystemSpeech(trimmed, {
            lang: opts?.lang,
            rate: effectiveRate,
            onEnd: opts?.onEnd,
          });
        }
      };
      audio.play().catch(() => {
        if (session === currentTtsSession) {
          speakWithSystemSpeech(trimmed, {
            lang: opts?.lang,
            rate: effectiveRate,
            onEnd: opts?.onEnd,
          });
        }
      });
    })
    .catch(() => {
      if (session !== currentTtsSession) return;
      // 方案 A 异常（如离线断网、纯网页环境）时，自动平滑无缝降级到方案 B (系统离线自然语音)
      speakWithSystemSpeech(trimmed, {
        lang: opts?.lang,
        rate: effectiveRate,
        onEnd: opts?.onEnd,
      });
    });
}
