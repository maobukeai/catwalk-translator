import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectEdgeVoice } from '../services/edgeTts';
import * as edgeTtsModule from '../services/edgeTts';
import * as ttsModule from '../services/tts';

import * as tauriModule from '../services/tauri';

describe('双层高保真 TTS 朗读测试套件 (高保真真人原声 + 系统自然语音兜底)', () => {
  const origSpeech = (window as any).speechSynthesis;
  const origUtterance = (window as any).SpeechSynthesisUtterance;
  const origWs = (globalThis as any).WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).WebSocket = class {};
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    (window as any).speechSynthesis = origSpeech;
    (window as any).SpeechSynthesisUtterance = origUtterance;
    (globalThis as any).WebSocket = origWs;
  });

  it('selectEdgeVoice 正确映射不同语言至微软精选神经网络发音人', () => {
    expect(selectEdgeVoice('zh-CN')).toBe('zh-CN-XiaoxiaoNeural');
    expect(selectEdgeVoice('zh')).toBe('zh-CN-XiaoxiaoNeural');
    expect(selectEdgeVoice('en-US')).toBe('en-US-JennyNeural');
    expect(selectEdgeVoice('en')).toBe('en-US-JennyNeural');
    expect(selectEdgeVoice('ja-JP')).toBe('ja-JP-NanamiNeural');
    expect(selectEdgeVoice('ja')).toBe('ja-JP-NanamiNeural');
    expect(selectEdgeVoice('ko-KR')).toBe('ko-KR-SunHiNeural');
  });

  it('speakText 优先调度高保真播音级真人原声通道', async () => {
    const fetchSpy = vi.spyOn(tauriModule, 'cmdFetchTtsAudio').mockResolvedValue('data:audio/mp3;base64,AAAA');
    ttsModule.speakText('Hello world', { lang: 'en-US', rate: 1.2 });

    expect(fetchSpy).toHaveBeenCalledWith('Hello world', 'en-US', 1.2);
  });

  it('speakText 当在线通道失败（离线/弱网/超时）时，自动无缝降级触发系统语音兜底', async () => {
    vi.spyOn(tauriModule, 'cmdFetchTtsAudio').mockRejectedValue(new Error('Network Offline'));
    const speakCalls: any[] = [];
    const speakFn = (u: any) => {
      speakCalls.push(u);
    };
    const cancelSpy = vi.fn();

    class MockUtterance {
      text: string;
      lang = '';
      rate = 1.0;
      voice = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    (window as any).SpeechSynthesisUtterance = MockUtterance;
    (window as any).speechSynthesis = {
      speak: speakFn,
      cancel: cancelSpy,
      getVoices: () => [],
    };

    ttsModule.speakText('测试文本', { lang: 'zh-CN' });

    // 等待 catch 异步微任务触发 fallback
    await new Promise((r) => setTimeout(r, 50));

    expect(speakCalls.length).toBe(1);
    const utterance = speakCalls[0];
    expect(utterance.text).toBe('测试文本');
    expect(utterance.lang).toBe('zh-CN');
  });

  it('stopSpeech 能同时中止 Edge-TTS 与系统语音', () => {
    const stopAudioSpy = vi.spyOn(edgeTtsModule, 'stopCurrentEdgeAudio');
    const cancelSpy = vi.fn();
    (window as any).speechSynthesis = {
      cancel: cancelSpy,
    };

    ttsModule.stopSpeech();
    expect(stopAudioSpy).toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('stopSpeech 在途网络请求返回后立即废弃，不触发播放', async () => {
    let resolveAudio: (val: string) => void = () => {};
    const audioPromise = new Promise<string>((resolve) => {
      resolveAudio = resolve;
    });

    vi.spyOn(tauriModule, 'cmdFetchTtsAudio').mockReturnValue(audioPromise);
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play');

    ttsModule.speakText('待播放长句子', { lang: 'zh-CN' });

    // 用户在音频拉取过程中关闭或退出，触发 stopSpeech
    ttsModule.stopSpeech();

    // 随后网络请求返回
    resolveAudio('data:audio/mp3;base64,AAAA');
    await new Promise((r) => setTimeout(r, 20));

    // 验证音频播放绝未被触发
    expect(playSpy).not.toHaveBeenCalled();
  });
});
