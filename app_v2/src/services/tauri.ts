import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  BoundingBox,
  ColorSample,
  LlmConfig,
  OcrResult,
  PhysicalRect,
  TranslationResult,
} from './types';

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

const MOCK_STORAGE_KEY = 'cg_translator_settings_v2';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'fluent-dark',
  hotkey: 'Ctrl+Alt+D',
  defaultPreset: 'blender',
  llmConfig: {
    provider: 'DeepSeek',
    apiKey: '',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  },
  translationTiers: ['Preset Dictionary', 'LLM API', 'Online Fallback'],
  presetDicts: {
    blender: true,
    substance: true,
    unity: true,
    unreal: true,
    maya: true,
    houdini: true,
  },
  onlineEngines: {
    google: true,
    myMemory: true,
  },
};

/// Trigger backend-driven screen capture:
/// Rust hides the window, waits 150ms, takes GDI screenshot, stores BMP globally, returns payload
export async function cmdBeginCapture(): Promise<import('./types').ScreenCapturePayload> {
  if (isTauri()) {
    return await invoke<import('./types').ScreenCapturePayload>('cmd_begin_capture');
  }
  return {
    dataUrl: '',
    width: window.screen.width || 1920,
    height: window.screen.height || 1080,
    scaleFactor: window.devicePixelRatio || 1.0,
  };
}

export const cmdStartScreenCapture = cmdBeginCapture;

/// Show the window in full-screen overlay mode (called after capture payload arrives)
export async function cmdShowOverlay(): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_show_overlay');
  }
}

/// Restore the window to normal main-window size (called when overlay is closed)
export async function cmdCloseOverlay(restoreMain?: boolean): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_close_overlay', { restoreMain: restoreMain ?? null });
  }
}

export async function cmdCaptureAndOcr(
  selection: PhysicalRect,
  scaleFactor?: number
): Promise<OcrResult> {
  if (isTauri()) {
    const args: Record<string, any> = { selection };
    if (scaleFactor !== undefined && scaleFactor !== null) {
      args.scaleFactor = scaleFactor;
    }
    return await invoke<OcrResult>('cmd_capture_and_ocr', args);
  }
  return {
    blocks: [
      {
        text: 'Principled BSDF',
        confidence: 0.98,
        boxRect: { x: selection.x + 10, y: selection.y + 10, width: 120, height: 24 },
      },
      {
        text: 'Roughness',
        confidence: 0.95,
        boxRect: { x: selection.x + 10, y: selection.y + 40, width: 80, height: 20 },
      },
    ],
  };
}

/// All-in-one: OCR selection → sample bg colors → translate → return overlay blocks.
export async function cmdRegionOcrTranslate(
  selection: import('./types').PhysicalRect,
  scaleFactor: number,
  preset: string,
  llmConfig?: import('./types').LlmConfig | null
): Promise<import('./types').OverlayResult> {
  if (isTauri()) {
    return await invoke<import('./types').OverlayResult>('cmd_region_ocr_translate', {
      selection,
      scaleFactor,
      preset,
      llmConfig: llmConfig ?? null,
    });
  }

  // Web Browser Mock Fallback (Demonstration mode)
  const mockBlock: import('./types').OverlayBlock = {
    original: 'Principled BSDF (Selection Test)',
    translated: '原理化 BSDF 材质节点 (划词测试)',
    sourceTier: `Preset (${preset.toUpperCase()})`,
    logicalX: selection.x + 4,
    logicalY: selection.y + 4,
    logicalW: Math.max(selection.width - 8, 160),
    logicalH: Math.max(selection.height - 8, 28),
    bgCss: 'rgba(20, 20, 26, 0.94)',
    fgCss: '#38bdf8',
  };

  return {
    blocks: [mockBlock],
    selectionX: selection.x,
    selectionY: selection.y,
    selectionW: selection.width,
    selectionH: selection.height,
  };
}

export async function cmdTranslatePhrases(
  phrases: string[],
  preset: string,
  llmConfig?: LlmConfig | null
): Promise<TranslationResult[]> {
  if (isTauri()) {
    return await invoke<TranslationResult[]>('cmd_translate_phrases', {
      phrases,
      preset,
      llmConfig: llmConfig || null,
    });
  }
  const dict: Record<string, string> = {
    'Principled BSDF': '原理化 BSDF',
    'Roughness': '粗糙度',
    'Metallic': '金属度',
    'Base Color': '基础颜色',
    'Normal': '法线',
  };
  return phrases.map((p) => ({
    original: p,
    translated: dict[p] || `[Mock Translation] ${p}`,
    sourceTier: dict[p] ? preset : 'Online Fallback',
  }));
}

export async function cmdSampleColors(
  imageCrop: Uint8Array | number[],
  boxes: BoundingBox[]
): Promise<ColorSample[]> {
  if (isTauri()) {
    const bytesArray = Array.isArray(imageCrop) ? imageCrop : Array.from(imageCrop);
    return await invoke<ColorSample[]>('cmd_sample_colors', {
      imageCrop: bytesArray,
      boxes,
    });
  }
  return boxes.map((box) => ({
    boxRect: box,
    backgroundRgb: [30, 30, 35],
    textColor: '#FFFFFF',
  }));
}

export async function cmdSaveSettings(settings: AppSettings): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_save_settings', { settings });
    return;
  }
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(settings));
}

export async function cmdGetSettings(): Promise<AppSettings> {
  if (isTauri()) {
    return await invoke<AppSettings>('cmd_get_settings');
  }
  const cached = localStorage.getItem(MOCK_STORAGE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Fallback if corrupted
    }
  }
  return DEFAULT_SETTINGS;
}

export function detectLanguage(text: string): { detected: import('./types').LanguageCode; suggestedTarget: import('./types').LanguageCode } {
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  const hasJapanese = /[\u3040-\u30ff]/.test(text);
  const hasKorean = /[\uac00-\ud7af]/.test(text);

  if (hasChinese) {
    return { detected: 'zh-CN', suggestedTarget: 'en' };
  }
  if (hasJapanese) {
    return { detected: 'ja', suggestedTarget: 'zh-CN' };
  }
  if (hasKorean) {
    return { detected: 'ko', suggestedTarget: 'zh-CN' };
  }
  return { detected: 'en', suggestedTarget: 'zh-CN' };
}

export async function fetchGoogleTranslate(
  text: string,
  from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const cleanFrom = from === 'auto' ? 'auto' : from.split('-')[0];
  const cleanTo = to === 'zh-CN' ? 'zh-CN' : to === 'zh-TW' ? 'zh-TW' : to.split('-')[0];
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${cleanFrom}&tl=${cleanTo}&dt=t&dt=bd&q=${encodeURIComponent(
    text
  )}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Google API error ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json) && Array.isArray(json[0])) {
    return json[0].map((item: any) => item[0]).filter(Boolean).join('');
  }
  throw new Error('Invalid Google translate response');
}

export async function fetchBingTranslate(
  text: string,
  from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const cleanFrom = from === 'auto' ? 'auto-detect' : from;
  const cleanTo = to === 'zh-CN' ? 'zh-Hans' : to === 'zh-TW' ? 'zh-Hant' : to;
  // 微软必应公共快速翻译通道
  const url = `https://edge.microsoft.com/translate/auth`;
  try {
    const authRes = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const token = await authRes.text();
    if (token) {
      const transUrl = `https://api-edge.cognitive.microsofttranslator.com/translate?from=${cleanFrom}&to=${cleanTo}&api-version=3.0&includeSentenceLength=true`;
      const transRes = await fetch(transUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([{ Text: text }]),
        signal: AbortSignal.timeout(5000),
      });
      if (transRes.ok) {
        const transJson = await transRes.json();
        const result = transJson?.[0]?.translations?.[0]?.text;
        if (result) return result;
      }
    }
  } catch {
    // 降级使用备用安全通道
  }
  throw new Error('Bing translate unavailable');
}

export async function fetchYoudaoTranslate(
  text: string,
  from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const cleanTo = to === 'zh-CN' ? 'zh-CHS' : to;
  const cleanFrom = from === 'auto' ? 'auto' : from;
  const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(
    text
  )}&doctype=json&keyfrom=web&model=smart&le=eng`;
  
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (res.ok) {
      const json = await res.json();
      // 提取有道词典释义或翻译
      const trans = json?.web_trans?.['web-translation']?.[0]?.trans?.[0]?.value ||
                    json?.ec?.word?.[0]?.trs?.[0]?.tr?.[0]?.l?.i?.[0] ||
                    json?.fanyi?.tran;
      if (trans) return typeof trans === 'string' ? trans : JSON.stringify(trans);
    }
  } catch {
    // fallback
  }

  // 备用有道接口
  const fallbackUrl = `https://aidemo.youdao.com/trans?q=${encodeURIComponent(text)}&from=${cleanFrom}&to=${cleanTo}`;
  const fbRes = await fetch(fallbackUrl, { signal: AbortSignal.timeout(4500) });
  if (fbRes.ok) {
    const fbJson = await fbRes.json();
    if (fbJson?.translation?.[0]) return fbJson.translation[0];
  }
  throw new Error('Youdao translate unavailable');
}

export async function fetchDeepLTranslate(
  text: string,
  _from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const targetLang = to.startsWith('zh') ? 'ZH' : to.toUpperCase();
  // DeepL 公共快速网关通道
  const url = `https://deeplx.vercel.app/translate`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        source_lang: 'auto',
        target_lang: targetLang,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data) return json.data;
      if (json?.target_text) return json.target_text;
    }
  } catch {
    // fallback
  }
  throw new Error('DeepL channel temporarily unavailable');
}

export async function fetchMyMemoryTranslate(
  text: string,
  from: string = 'en',
  to: string = 'zh'
): Promise<string> {
  const cleanFrom = from === 'auto' ? 'en' : from.split('-')[0];
  const cleanTo = to === 'zh-CN' || to === 'zh-TW' ? 'zh' : to.split('-')[0];
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    text
  )}&langpair=${cleanFrom}|${cleanTo}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`MyMemory API error ${res.status}`);
  const json = await res.json();
  if (json?.responseData?.translatedText) {
    return json.responseData.translatedText;
  }
  throw new Error('Invalid MyMemory response');
}

export async function fetchBaiduTranslate(
  text: string,
  from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const cleanTo = to === 'zh-CN' ? 'zh' : to.split('-')[0];
  const cleanFrom = from === 'auto' ? 'auto' : from.split('-')[0];
  const url = `https://fanyi.baidu.com/transapi?from=${cleanFrom}&to=${cleanTo}&query=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (res.ok) {
    const json = await res.json();
    if (json?.data?.[0]?.dst) return json.data[0].dst;
  }
  throw new Error('Baidu translate unavailable');
}

export async function fetchTencentTranslate(
  text: string,
  _from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const cleanTo = to === 'zh-CN' ? 'zh' : to.split('-')[0];
  const url = `https://transmart.qq.com/api/imt`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      header: { fn: 'auto_translation' },
      type: 'plain',
      model_category: 'normal',
      text_list: [text],
      source: { lang: 'auto' },
      target: { lang: cleanTo },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (res.ok) {
    const json = await res.json();
    if (json?.auto_translation?.[0]) return json.auto_translation[0];
  }
  throw new Error('Tencent translate unavailable');
}

export async function fetchLlmTranslate(
  text: string,
  to: string,
  config: LlmConfig
): Promise<string> {
  if (!config.apiKey && !config.endpoint.includes('localhost') && !config.endpoint.includes('127.0.0.1')) {
    throw new Error('LLM API Key not provided');
  }
  const endpoint = config.endpoint.endsWith('/')
    ? `${config.endpoint}chat/completions`
    : `${config.endpoint}/chat/completions`;

  const prompt = `You are a professional, accurate translator. Translate the following text into ${to}. Preserve formatting, code, numbers, and technical terms accurately. Return ONLY the translated text without explanations.\n\n${text}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`LLM API error ${res.status}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.trim() || '';
}

export async function cmdUniversalTranslate(
  req: import('./types').UniversalTranslationRequest
): Promise<import('./types').UniversalTranslationResponse> {
  const trimmed = req.text.trim();
  if (!trimmed) {
    return {
      original: '',
      detectedLang: 'en',
      mainTranslation: '',
      engines: [],
    };
  }

  // 1. 优先调用 Rust 原生后端管道（reqwest 原生并发，完全无浏览器 CORS 跨域限制！）
  if (isTauri()) {
    try {
      const resp = await invoke<import('./types').UniversalTranslationResponse>(
        'cmd_universal_translate',
        { req }
      );
      if (resp && resp.engines && resp.engines.length > 0) {
        return resp;
      }
    } catch (err) {
      console.warn('Rust cmd_universal_translate fallback to frontend:', err);
    }
  }

  // 2. 纯网页开发模式 Fallback
  const { detected, suggestedTarget } = detectLanguage(trimmed);
  const actualSource = req.sourceLang === 'auto' ? detected : req.sourceLang;
  let actualTarget = req.targetLang === 'auto' ? suggestedTarget : req.targetLang;

  // 智能同语种翻转
  if ((actualSource.startsWith('zh') && actualTarget.startsWith('zh')) ||
      (actualSource.startsWith('en') && actualTarget.startsWith('en'))) {
    actualTarget = actualSource.startsWith('zh') ? 'en' : 'zh-CN';
  }

  const engines: import('./types').MultiEngineTranslation[] = [];

  // 1. 本地专业词库匹配（仅在对应词典开关开启时才检索）
  const dicts = req.presetDicts || { blender: true, substance: true, unity: true, unreal: true, maya: true, houdini: true };
  const isAnyDictEnabled = dicts.blender || dicts.substance || dicts.unity;

  if (isAnyDictEnabled && trimmed.split(/\s+/).length <= 6) {
    const cgDict: Record<string, { trans: string; tier: string }> = {
      'Principled BSDF': { trans: '原理化 BSDF 材质节点', tier: '通用基础词典' },
      'Roughness': { trans: '粗糙度', tier: '专业术语词典' },
      'Metallic': { trans: '金属度', tier: '专业术语词典' },
      'Base Color': { trans: '基础颜色 / 漫反射基色', tier: '通用基础词典' },
      'Normal': { trans: '法线', tier: '专业术语词典' },
      'Subsurface Scattering': { trans: '次表面散射 (SSS)', tier: '专业术语词典' },
      'Ambient Occlusion': { trans: '环境光遮蔽 (AO)', tier: '专业术语词典' },
      'Specular': { trans: '高光反射', tier: '专业术语词典' },
      'Emission': { trans: '自发光', tier: '通用基础词典' },
      'Displacement': { trans: '置换贴图', tier: '专业术语词典' },
      'Transmission': { trans: '透射 / 玻璃折射', tier: '专业术语词典' },
      'Viewport Shading': { trans: '视图着色模式', tier: '常用短语词典' },
      'Nanite': { trans: '虚拟化微多边形几何体', tier: '专业术语词典' },
      'Lumen': { trans: '全局动态光照与漫反射反射系统', tier: '专业术语词典' },
    };

    const match = cgDict[trimmed];
    if (match) {
      const isMatchEnabled =
        (match.tier === '通用基础词典' && dicts.blender) ||
        (match.tier === '专业术语词典' && dicts.substance) ||
        (match.tier === '常用短语词典' && dicts.unity);

      if (isMatchEnabled) {
        engines.push({
          engineName: `本地专业词库 (${match.tier})`,
          translated: match.trans,
          sourceTier: 'Preset Dictionary',
        });
      }
    }
  }

  // 2. 并行并发调用所有用户已开启的在线翻译引擎
  const online = req.onlineEngines || {
    google: true,
    bing: true,
    youdao: true,
    deepl: false,
    myMemory: false,
    baidu: false,
    tencent: false,
  };

  const tasks: Promise<{ name: string; trans: string; tier: string } | null>[] = [];

  // Google
  if (online.google !== false) {
    tasks.push(
      fetchGoogleTranslate(trimmed, actualSource, actualTarget)
        .then((res) => (res ? { name: 'Google 翻译 (官方通道)', trans: res, tier: 'Online Fallback' } : null))
        .catch(() => null)
    );
  }

  // Bing
  if (online.bing) {
    tasks.push(
      fetchBingTranslate(trimmed, actualSource, actualTarget)
        .then((res) => (res ? { name: '微软 Bing 翻译', trans: res, tier: 'Online Fallback' } : null))
        .catch(() => null)
    );
  }

  // Youdao
  if (online.youdao) {
    tasks.push(
      fetchYoudaoTranslate(trimmed, actualSource, actualTarget)
        .then((res) => (res ? { name: '网易有道翻译', trans: res, tier: 'Online Fallback' } : null))
        .catch(() => null)
    );
  }

  // DeepL
  if (online.deepl) {
    tasks.push(
      fetchDeepLTranslate(trimmed, actualSource, actualTarget)
        .then((res) => (res ? { name: 'DeepL 极速通道', trans: res, tier: 'Online Fallback' } : null))
        .catch(() => null)
    );
  }

  // MyMemory
  if (online.myMemory) {
    tasks.push(
      fetchMyMemoryTranslate(trimmed, actualSource, actualTarget)
        .then((res) => (res ? { name: 'MyMemory 翻译记忆库', trans: res, tier: 'Online Fallback' } : null))
        .catch(() => null)
    );
  }

  // Baidu
  if (online.baidu) {
    tasks.push(
      fetchBaiduTranslate(trimmed, actualSource, actualTarget)
        .then((res) => (res ? { name: '百度通用翻译', trans: res, tier: 'Online Fallback' } : null))
        .catch(() => null)
    );
  }

  // Tencent
  if (online.tencent) {
    tasks.push(
      fetchTencentTranslate(trimmed, actualSource, actualTarget)
        .then((res) => (res ? { name: '腾讯交互翻译', trans: res, tier: 'Online Fallback' } : null))
        .catch(() => null)
    );
  }

  // LLM API
  if (req.llmConfig && (req.llmConfig.apiKey || req.llmConfig.endpoint.includes('localhost') || req.llmConfig.endpoint.includes('127.0.0.1'))) {
    tasks.push(
      fetchLlmTranslate(trimmed, actualTarget, req.llmConfig)
        .then((res) => (res ? { name: `AI 深度翻译 (${req.llmConfig?.provider})`, trans: res, tier: 'LLM API' } : null))
        .catch(() => null)
    );
  }

  // 并发等待所有开启的在线引擎完成
  const results = await Promise.allSettled(tasks);
  for (const item of results) {
    if (item.status === 'fulfilled' && item.value) {
      engines.push({
        engineName: item.value.name,
        translated: item.value.trans,
        sourceTier: item.value.tier,
      });
    }
  }

  // 3. 根据用户设置的 translationTiers 确定综合优选 mainTranslation
  const tiers = req.translationTiers || ['Preset Dictionary', 'LLM API', 'Online Fallback'];
  let mainTranslation = '';

  for (const tier of tiers) {
    const matchedEngine = engines.find((e) => e.sourceTier === tier);
    if (matchedEngine) {
      mainTranslation = matchedEngine.translated;
      break;
    }
  }

  if (!mainTranslation && engines.length > 0) {
    mainTranslation = engines[0].translated;
  }

  if (!mainTranslation && engines.length === 0) {
    mainTranslation = '⚠️ 未开启任何翻译源或网络未连接，请在「系统设置」中开启本地词库或在线翻译引擎。';
  }

  return {
    original: trimmed,
    detectedLang: actualSource,
    mainTranslation,
    engines,
  };
}

export async function cmdQueryText(
  text: string,
  preset: string,
  llmConfig?: LlmConfig | null
): Promise<import('./types').TextQueryResponse> {
  const univRes = await cmdUniversalTranslate({
    text,
    sourceLang: 'auto',
    targetLang: 'zh-CN',
    preset,
    llmConfig,
  });

  return {
    original: univRes.original,
    wordDetail: {
      phoneticUs: `/ ${univRes.original.toLowerCase()} /`,
      phoneticUk: `[ ${univRes.original.toLowerCase()} ]`,
      pos: '通用 / 专业术语',
      definition: univRes.mainTranslation,
      examples: [
        `例句: This feature utilizes '${univRes.original}' for enhanced performance.`,
        `中文释义与用法：在专业工作流中使用 ${univRes.mainTranslation}。`,
      ],
      cgDomainNote: `真实多源翻译引擎 [${preset.toUpperCase()}]`,
    },
    results: univRes.engines,
  };
}

const MOCK_HISTORY_KEY = 'cg_translator_history_v2';
const DEFAULT_MOCK_HISTORY: import('./types').HistoryItem[] = [
  {
    id: 'hist_1',
    original: 'Principled BSDF',
    translated: '原理化 BSDF 材质节点',
    sourceTier: 'Blender 词典',
    timestamp: '10:30:15',
    isFavorite: true,
  },
  {
    id: 'hist_2',
    original: 'Nanite',
    translated: 'Nanite 虚拟化微多边形几何体',
    sourceTier: 'Unreal 5 词典',
    timestamp: '11:14:02',
    isFavorite: true,
  },
  {
    id: 'hist_3',
    original: 'Subsurface Scattering',
    translated: '次表面散射',
    sourceTier: 'CG 词典',
    timestamp: '12:05:40',
    isFavorite: false,
  },
];

export async function cmdGetHistory(): Promise<import('./types').HistoryItem[]> {
  if (isTauri()) {
    return await invoke<import('./types').HistoryItem[]>('cmd_get_history');
  }
  const cached = localStorage.getItem(MOCK_HISTORY_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Fallback
    }
  }
  return DEFAULT_MOCK_HISTORY;
}

export async function cmdDeleteHistoryEntry(id: string): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_delete_history', { id });
    return;
  }
  const current = await cmdGetHistory();
  localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(current.filter((i) => i.id !== id)));
}

export async function cmdClearHistory(): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_clear_history');
    return;
  }
  localStorage.removeItem(MOCK_HISTORY_KEY);
}

/// Save a translation entry into history, de-duplicating by original text.
export async function saveTranslationHistory(
  original: string,
  translated: string,
  sourceTier: string
): Promise<void> {
  const text = original.trim();
  if (!text || !translated.trim()) return;
  const current = await cmdGetHistory();
  const existing = current.find((i) => i.original === text);
  if (existing) return;
  await cmdAddHistory({
    id: `hist_${Date.now()}`,
    original: text,
    translated,
    sourceTier: sourceTier || 'Online Fallback',
    timestamp: new Date().toLocaleTimeString(),
    isFavorite: false,
  });
}

export async function cmdGetOcrEngineStatus(): Promise<import('./types').OcrEngineStatus> {
  if (isTauri()) {
    return await invoke<import('./types').OcrEngineStatus>('cmd_ocr_engine_status');
  }
  return { status: 'ready', detail: 'Browser Mock — RapidOCR ONNX (演示)' };
}

export async function cmdAddHistory(item: import('./types').HistoryItem): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_add_history', { item });
    return;
  }
  const current = await cmdGetHistory();
  const updated = [item, ...current.filter((i) => i.original !== item.original)];
  localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(updated.slice(0, 100)));
}

export async function cmdToggleFavorite(id: string): Promise<boolean> {
  if (isTauri()) {
    return await invoke<boolean>('cmd_toggle_favorite', { id });
  }
  const current = await cmdGetHistory();
  let favState = false;
  const updated = current.map((item) => {
    if (item.id === id) {
      favState = !item.isFavorite;
      return { ...item, isFavorite: favState };
    }
    return item;
  });
  localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(updated));
  return favState;
}

export async function cmdExportAnki(items: import('./types').HistoryItem[]): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('cmd_export_anki', { items });
  }
  let csv = 'Front,Back,Tag\n';
  items.forEach((item) => {
    csv += `"${item.original.replace(/"/g, '""')}","${item.translated.replace(/"/g, '""')}","CG-Translator"\n`;
  });
  return csv;
}

export async function cmdFetchLlmModels(endpoint: string, apiKey: string): Promise<string[]> {
  if (isTauri()) {
    return await invoke<string[]>('cmd_fetch_llm_models', { endpoint, apiKey });
  }
  return ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o', 'gpt-4o-mini', 'gemini-1.5-flash'];
}

export async function cmdChatLlm(
  messages: { role: string; content: string }[],
  config: import('./types').LlmConfig
): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('cmd_chat_llm', { messages, config });
  }

  // JSDOM / Browser Mock Fallback
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  return `[Mock AI Responding (${config.provider})] 关于 "${lastUserMsg}" 的解答：这是一个专业级提示词解答与对话演示。`;
}

