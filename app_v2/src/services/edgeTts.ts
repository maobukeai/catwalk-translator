/**
 * 微软 Edge-TTS 神经网络高保真语音合成服务
 * 基于微软 Edge 官方公开的 WebSocket 协议直连，提供免 Key、极速、广播级真实人声
 */

// 语种与微软精选神经网络发音人映射表
const EDGE_VOICE_MAP: Record<string, string> = {
  'zh-cn': 'zh-CN-XiaoxiaoNeural', // 晓晓 (经典温暖自然主播女声)
  'zh': 'zh-CN-XiaoxiaoNeural',
  'zh-tw': 'zh-TW-HsiaoChenNeural',
  'zh-hk': 'zh-HK-HiuMaanNeural',
  'en-us': 'en-US-JennyNeural',     // Jenny (自然纯正美式女声)
  'en': 'en-US-JennyNeural',
  'en-gb': 'en-GB-SoniaNeural',     // Sonia (英式优雅女声)
  'ja-jp': 'ja-JP-NanamiNeural',    // Nanami (自然地道日式女声)
  'ja': 'ja-JP-NanamiNeural',
  'ko-kr': 'ko-KR-SunHiNeural',     // SunHi (韩语自然女声)
  'ko': 'ko-KR-SunHiNeural',
  'fr-fr': 'fr-FR-DeniseNeural',
  'fr': 'fr-FR-DeniseNeural',
  'de-de': 'de-DE-KatjaNeural',
  'de': 'de-DE-KatjaNeural',
  'ru-ru': 'ru-RU-SvetlanaNeural',
  'ru': 'ru-RU-SvetlanaNeural',
  'es-es': 'es-ES-ElviraNeural',
  'es': 'es-ES-ElviraNeural',
};

export function selectEdgeVoice(lang?: string): string {
  const norm = (lang || 'en-US').toLowerCase().replace('_', '-');
  return EDGE_VOICE_MAP[norm] || EDGE_VOICE_MAP[norm.split('-')[0]] || 'en-US-JennyNeural';
}

function formatRate(rate?: number): string {
  if (!rate || Math.abs(rate - 1.0) < 0.05) return '+0%';
  const pct = Math.round((rate - 1.0) * 100);
  return pct >= 0 ? '+' + pct + '%' : pct + '%';
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let activeAudio: HTMLAudioElement | null = null;
let activeWs: WebSocket | null = null;

export function stopCurrentEdgeAudio(): void {
  if (activeWs) {
    try {
      activeWs.close();
    } catch (_) {}
    activeWs = null;
  }
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio.src = '';
    } catch (_) {}
    activeAudio = null;
  }
}

export interface EdgeTtsOptions {
  lang?: string;
  voice?: string;
  rate?: number;
  timeoutMs?: number;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

/**
 * 通过 Edge-TTS 协议合成音频并直接播放
 * @returns Promise<void> 合成并开始播放时 resolve，若网络失败则 reject 触发本地兜底
 */
export function playEdgeTts(text: string, opts?: EdgeTtsOptions): Promise<void> {
  stopCurrentEdgeAudio();

  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve();

  const voice = opts?.voice || selectEdgeVoice(opts?.lang);
  const lang = opts?.lang || voice.split('-').slice(0, 2).join('-');
  const rateStr = formatRate(opts?.rate);
  const timeoutMs = opts?.timeoutMs || 2800;

  return new Promise((resolve, reject) => {
    let settled = false;
    const audioChunks: Uint8Array[] = [];

    const connectionId = generateUuid().replace(/-/g, '');
    const wsUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EA654081830082481A391A5E&ConnectionId=' + connectionId;

    let ws: WebSocket;
    try {
      if (typeof WebSocket === 'undefined') {
        return reject(new Error('WebSocket not supported in current environment'));
      }
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      activeWs = ws;
    } catch (e) {
      return reject(e);
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (_) {}
        reject(new Error('Edge-TTS connection timeout'));
      }
    }, timeoutMs);

    ws.onopen = () => {
      if (settled) return;

      const dateStr = new Date().toISOString();
      const configMsg =
        'X-Timestamp:' + dateStr + '\r\n' +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: 'false',
                  wordBoundaryEnabled: 'false',
                },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        });
      ws.send(configMsg);

      const reqId = generateUuid().replace(/-/g, '');
      const ssml =
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + lang + "'>" +
        "<voice name='" + voice + "'>" +
        "<prosody pitch='+0Hz' rate='" + rateStr + "'>" +
        escapeXml(trimmed) +
        '</prosody></voice></speak>';

      const ssmlMsg =
        'X-RequestId:' + reqId + '\r\n' +
        'Content-Type:application/ssml+xml\r\n' +
        'X-Timestamp:' + dateStr + '\r\n' +
        'Path:ssml\r\n\r\n' +
        ssml;
      ws.send(ssmlMsg);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          clearTimeout(timer);
          try { ws.close(); } catch (_) {}

          if (audioChunks.length === 0) {
            if (!settled) {
              settled = true;
              reject(new Error('Edge-TTS returned 0 audio chunks'));
            }
            return;
          }

          // 合并二进制块并生成可播放的 blob 链接
          const blob = new Blob(audioChunks, { type: 'audio/mp3' });
          const audioUrl = URL.createObjectURL(blob);
          const audio = new Audio(audioUrl);
          activeAudio = audio;

          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            activeAudio = null;
            opts?.onEnd?.();
          };

          audio.onerror = (e) => {
            URL.revokeObjectURL(audioUrl);
            activeAudio = null;
            opts?.onError?.(e);
          };

          audio.play().then(() => {
            if (!settled) {
              settled = true;
              resolve();
            }
          }).catch((err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
        }
      } else if (event.data instanceof ArrayBuffer) {
        // 二进制音频帧: 前 2 字节存储 16-bit headerLen，跳过 header 即为纯 MP3 数据
        const buffer = event.data;
        if (buffer.byteLength > 2) {
          const view = new DataView(buffer);
          const headerLen = view.getInt16(0);
          const dataOffset = headerLen + 2;
          if (buffer.byteLength > dataOffset) {
            audioChunks.push(new Uint8Array(buffer, dataOffset));
          }
        }
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    ws.onclose = () => {
      clearTimeout(timer);
      if (!settled && audioChunks.length === 0) {
        settled = true;
        reject(new Error('Edge-TTS connection closed unexpectedly'));
      }
    };
  });
}
