import { invoke } from '@tauri-apps/api/core';
import { APP_VERSION, compareVersions } from '../version';
import { DEFAULT_SETTINGS } from './defaultSettings';
import type {
  AppSettings,
  BoundingBox,
  ColorSample,
  LlmConfig,
  OcrResult,
  PhysicalRect,
  TranslationResult,
  BackupEntry,
  RemoteBackupEntry,
  RestoreSummary,
} from './types';

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

const MOCK_STORAGE_KEY = 'cg_translator_settings_v2';

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
export async function cmdExitApp(): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_exit_app');
  } else {
    console.log('[Browser Mode] cmdExitApp called');
  }
}

export async function cmdHideMainWindow(): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('cmd_hide_main_window');
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().hide();
      } catch (err) {
        console.warn('Hide window error:', err);
      }
    }
  } else {
    console.log('[Browser Mode] cmdHideMainWindow called');
  }
}

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
  scaleFactor?: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<OcrResult> {
  if (isTauri()) {
    const args: Record<string, any> = { selection };
    if (scaleFactor !== undefined && scaleFactor !== null) {
      args.scaleFactor = scaleFactor;
    }
    if (overlayWidth) args.overlayWidth = overlayWidth;
    if (overlayHeight) args.overlayHeight = overlayHeight;
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

/// Stage-1 fast path (progressive UX): OCR + layout + background sampling only,
/// no translation. The overlay renders these blocks instantly with the original
/// text while stage-2 (`cmdTranslatePhrases`) runs in the background.
export async function cmdRegionOcrLayout(
  selection: import('./types').PhysicalRect,
  scaleFactor: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<import('./types').OverlayResult> {
  if (isTauri()) {
    return await invoke<import('./types').OverlayResult>('cmd_region_ocr_layout', {
      selection,
      scaleFactor,
      overlayWidth: overlayWidth ?? null,
      overlayHeight: overlayHeight ?? null,
    });
  }

  // Web Browser Mock Fallback (Demonstration mode)
  const mockBlock: import('./types').OverlayBlock = {
    original: 'Principled BSDF (Selection Test)',
    translated: '',
    sourceTier: 'OCR',
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

/// All-in-one: OCR selection → sample bg colors → translate → return overlay blocks.
/// overlayWidth/overlayHeight are the overlay window's CSS viewport dimensions — the
/// backend derives the exact physical-per-logical scale from BMP÷viewport geometry,
/// immune to mixed-DPI multi-monitor devicePixelRatio mismatches.
export async function cmdRegionOcrTranslate(
  selection: import('./types').PhysicalRect,
  scaleFactor: number,
  preset: string,
  llmConfig?: import('./types').LlmConfig | null,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<import('./types').OverlayResult> {
  if (isTauri()) {
    return await invoke<import('./types').OverlayResult>('cmd_region_ocr_translate', {
      selection,
      scaleFactor,
      preset,
      llmConfig: llmConfig ?? null,
      overlayWidth: overlayWidth ?? null,
      overlayHeight: overlayHeight ?? null,
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

/// Style-aware phrase batch used by the capture overlay stage-2:
/// forwards the user's translation style into LLM prompts.
export async function cmdTranslatePhrasesStyled(
  phrases: string[],
  preset: string,
  llmConfig?: LlmConfig | null,
  style?: 'literal' | 'free' | 'terminology'
): Promise<TranslationResult[]> {
  if (isTauri()) {
    return await invoke<TranslationResult[]>('cmd_translate_phrases_styled', {
      phrases,
      preset,
      llmConfig: llmConfig || null,
      style: style ?? null,
    });
  }
  return cmdTranslatePhrases(phrases, preset, llmConfig);
}

/// Double-click smart snap: OCR around a logical click point and return the
/// tight paragraph rect in logical overlay px (or null when no text found).
export async function cmdSnapRegion(
  x: number,
  y: number,
  scaleFactor: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (isTauri()) {
    return await invoke<{ x: number; y: number; width: number; height: number } | null>(
      'cmd_snap_region',
      {
        x,
        y,
        scaleFactor,
        overlayWidth: overlayWidth ?? null,
        overlayHeight: overlayHeight ?? null,
      }
    );
  }
  // Browser fallback: a small deterministic rect around the click
  return { x: Math.max(x - 80, 0), y: Math.max(y - 14, 0), width: 160, height: 28 };
}

/// Crop a small region of the last desktop capture and return it as a base64
/// BMP payload (empty string when unavailable — e.g. browser/demo mode).
/// Powers the selection magnifier lens and the frozen-frame hover lookup.
export async function cmdRegionImage(
  selection: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('cmd_region_image', {
      selection,
      scaleFactor,
      overlayWidth: overlayWidth ?? null,
      overlayHeight: overlayHeight ?? null,
    });
  }
  return '';
}

/// Region-watch tick: quietly refresh the live region into the stored BMP
/// (overlay never hides — no flicker) and re-run stage-1 OCR. Errors let the
/// caller fall back to the legacy begin/show refresh path.
export async function cmdWatchTick(
  selection: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<import('./types').OverlayResult> {
  return await invoke<import('./types').OverlayResult>('cmd_watch_tick', {
    selection,
    scaleFactor,
    overlayWidth: overlayWidth ?? null,
    overlayHeight: overlayHeight ?? null,
  });
}

/// Copy the selected region image to the Windows clipboard (CF_DIB).
export async function cmdCopyRegionImage(
  selection: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<boolean> {
  return await invoke<boolean>('cmd_copy_region_image', {
    selection,
    scaleFactor,
    overlayWidth: overlayWidth ?? null,
    overlayHeight: overlayHeight ?? null,
  });
}

/// Save the selected region image as PNG under Pictures/猫步翻译/, returning
/// the absolute path.
export async function cmdSaveRegionImage(
  selection: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<string> {
  return await invoke<string>('cmd_save_region_image', {
    selection,
    scaleFactor,
    overlayWidth: overlayWidth ?? null,
    overlayHeight: overlayHeight ?? null,
  });
}

export interface HoverLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/// Frozen-frame hover lookup: OCR the neighborhood of a logical cursor point
/// and return the exact text line under it (null when not over text).
export async function cmdHoverLookup(
  x: number,
  y: number,
  scaleFactor: number,
  overlayWidth?: number,
  overlayHeight?: number
): Promise<HoverLine | null> {
  if (isTauri()) {
    return await invoke<HoverLine | null>('cmd_hover_lookup', {
      x,
      y,
      scaleFactor,
      overlayWidth: overlayWidth ?? null,
      overlayHeight: overlayHeight ?? null,
    });
  }
  // Browser fallback: a deterministic line for demos/tests
  return { text: 'Artificial Intelligence', x: Math.max(x - 80, 0), y: Math.max(y - 14, 0), width: 160, height: 28 };
}

export interface OfflineModelStatus {
  id: string;
  version?: string;
  name: string;
  fileName: string;
  installed: boolean;
  sizeBytes: number;
  approxBytes: number;
}

/// Installed state + sizes of local PP-OCRv3 / PP-OCRv4 / PP-OCRv5 OCR models.
export async function cmdOfflineModelsStatus(): Promise<OfflineModelStatus[]> {
  if (isTauri()) {
    return await invoke<OfflineModelStatus[]>('cmd_offline_models_status');
  }
  return [
    { id: 'ppocrv3-det', version: 'v3', name: 'PP-OCRv3 文本检测', fileName: 'ch_PP-OCRv3_det_infer.onnx', installed: true, sizeBytes: 4_700_000, approxBytes: 4_700_000 },
    { id: 'ppocrv3-rec', version: 'v3', name: 'PP-OCRv3 文本识别', fileName: 'ch_PP-OCRv3_rec_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 10_800_000 },
    { id: 'ppocrv3-cls', version: 'v3', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 1_400_000 },
    { id: 'ppocrv4-det', version: 'v4', name: 'PP-OCRv4 文本检测', fileName: 'ch_PP-OCRv4_det_infer.onnx', installed: true, sizeBytes: 4_700_000, approxBytes: 4_700_000 },
    { id: 'ppocrv4-rec', version: 'v4', name: 'PP-OCRv4 文本识别', fileName: 'ch_PP-OCRv4_rec_infer.onnx', installed: true, sizeBytes: 10_800_000, approxBytes: 10_800_000 },
    { id: 'ppocrv4-cls', version: 'v4', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 1_400_000, approxBytes: 1_400_000 },
    { id: 'ppocrv5-det', version: 'v5', name: 'PP-OCRv5 文本检测', fileName: 'ch_PP-OCRv5_det_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 4_900_000 },
    { id: 'ppocrv5-rec', version: 'v5', name: 'PP-OCRv5 文本识别', fileName: 'ch_PP-OCRv5_rec_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 11_200_000 },
    { id: 'ppocrv5-cls', version: 'v5', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 1_400_000 },
  ];
}

/// Get current active ONNX OCR engine version ("v3", "v4", or "v5").
export async function cmdGetActiveOcrVersion(): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('cmd_get_active_ocr_version');
  }
  return 'v4';
}

/// Hot-switch active ONNX OCR model version.
export async function cmdSwitchOcrVersion(version: string): Promise<boolean> {
  if (isTauri()) {
    return await invoke<boolean>('cmd_switch_ocr_version', { version });
  }
  return true;
}

/** Stream-download one OCR model (progress via `model-download-progress` events). */
export async function cmdDownloadOfflineModel(id: string): Promise<boolean> {
  return await invoke<boolean>('cmd_download_offline_model', { id });
}

/** Delete a downloaded OCR model file from the app-data directory (Windows file locks released first). */
export async function cmdDeleteOfflineModel(id: string): Promise<boolean> {
  return await invoke<boolean>('cmd_delete_offline_model', { id });
}

/// ─── Capture session replay storage ─────────────────────────────────────────
const MOCK_SESSIONS_KEY = 'cg_translator_capture_sessions_v1';

export async function cmdSaveCaptureSession(
  session: import('./types').CaptureSession
): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_save_capture_session', { session });
    return;
  }
  const current = await cmdGetCaptureSessions();
  const updated = [session, ...current.filter((s) => s.id !== session.id)].slice(0, 50);
  localStorage.setItem(MOCK_SESSIONS_KEY, JSON.stringify(updated));
}

export async function cmdGetCaptureSessions(): Promise<import('./types').CaptureSession[]> {
  if (isTauri()) {
    return await invoke<import('./types').CaptureSession[]>('cmd_get_capture_sessions');
  }
  const cached = localStorage.getItem(MOCK_SESSIONS_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // corrupted cache — fall through to empty
    }
  }
  return [];
}

export async function cmdClearCaptureSessions(): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_clear_capture_sessions');
    return;
  }
  localStorage.removeItem(MOCK_SESSIONS_KEY);
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

/// Toggle native Windows DWM Acrylic blur on the main window at runtime.
export async function cmdSetWindowBlur(enable: boolean, isDark?: boolean): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_set_window_blur', { enable, isDark: isDark ?? true });
  }
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

export interface OfflineEngineStatus {
  installed: boolean;
  modelId: string;
  modelName: string;
  version: string;
  dictEntries: number;
  storageBytes: number;
  engineKind: string;
  path: string;
}

const MOCK_OFFLINE_KEY = 'mock-offline-engine';

function mockOfflineStatus(): OfflineEngineStatus {
  const installed = localStorage.getItem(MOCK_OFFLINE_KEY) === 'installed';
  return {
    installed,
    modelId: 'offline-phrase-dict-v1',
    modelName: '离线词条引擎 v1',
    version: installed ? '1.0.0' : '',
    dictEntries: installed ? 238 : 0,
    storageBytes: installed ? 18432 : 0,
    engineKind: 'phrase-dict',
    path: '(browser mock)',
  };
}

export async function cmdOfflineStatus(): Promise<OfflineEngineStatus> {
  if (isTauri()) {
    return await invoke<OfflineEngineStatus>('cmd_offline_status');
  }
  return mockOfflineStatus();
}

export async function cmdOfflineInstall(): Promise<OfflineEngineStatus> {
  if (isTauri()) {
    return await invoke<OfflineEngineStatus>('cmd_offline_install');
  }
  localStorage.setItem(MOCK_OFFLINE_KEY, 'installed');
  return mockOfflineStatus();
}

export async function cmdOfflineUninstall(): Promise<OfflineEngineStatus> {
  if (isTauri()) {
    return await invoke<OfflineEngineStatus>('cmd_offline_uninstall');
  }
  localStorage.removeItem(MOCK_OFFLINE_KEY);
  return mockOfflineStatus();
}

export interface ImageTranslateBlock {
  original: string;
  translated: string;
  sourceTier: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bgCss: string;
  fgCss: string;
}

export interface ImageTranslateResponse {
  imageWidth: number;
  imageHeight: number;
  blocks: ImageTranslateBlock[];
}

/// Translate a pasted/dropped image via the local OCR + multi-tier pipeline.
export async function cmdImageOcrTranslate(
  imageBase64: string,
  preset: string,
  llmConfig: import('./types').LlmConfig | null
): Promise<ImageTranslateResponse> {
  if (isTauri()) {
    return await invoke<ImageTranslateResponse>('cmd_image_ocr_translate', {
      imageBase64,
      preset,
      llmConfig: llmConfig ?? null,
    });
  }
  // Browser/demo fallback: pretend one line of text was recognised.
  return {
    imageWidth: 800,
    imageHeight: 400,
    blocks: [
      {
        original: 'Roughness',
        translated: '粗糙度',
        sourceTier: '浏览器演示',
        confidence: 0.98,
        x: 40,
        y: 60,
        width: 220,
        height: 34,
        bgCss: 'rgb(30,32,38)',
        fgCss: '#ffffff',
      },
    ],
  };
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

export function isValidTranslation(orig: string, candidate: string): boolean {
  const cand = candidate.trim();
  const origTrim = orig.trim();
  if (!cand || !origTrim) {
    return false;
  }

  const origLower = origTrim.toLowerCase();
  const candLower = cand.toLowerCase();

  // 1. URL 投毒/风控跳转拦截：若原文非 URL，但译文包含 URL 协议、域名或已知风控特征（如 linux.do / t.me 等）
  const origHasUrl = origLower.includes('http://') || origLower.includes('https://') || origLower.includes('www.');
  if (!origHasUrl) {
    if (
      candLower.includes('http://') ||
      candLower.includes('https://') ||
      candLower.includes('linux.do') ||
      candLower.includes('t.me/') ||
      candLower.includes('github.com') ||
      candLower.includes('deeplx') ||
      candLower.includes('fanyi.baidu.com') ||
      candLower.includes('bing.com') ||
      (candLower.startsWith('www.') && cand.includes('.'))
    ) {
      return false;
    }
  }

  // 2. HTML 标签 / 网页错误拦截：若原文无 HTML 标记但译文包含 HTML 结构
  const origHasHtml = origLower.includes('<html') || origLower.includes('<!doctype') || origLower.includes('<body');
  if (!origHasHtml) {
    if (
      candLower.includes('<!doctype') ||
      candLower.includes('<html') ||
      candLower.includes('<body') ||
      candLower.includes('<script') ||
      candLower.includes('<head') ||
      candLower.includes('<div') ||
      candLower.includes('</span>') ||
      candLower.includes('</p>')
    ) {
      return false;
    }
  }

  // 3. 常见 JSON 报错格式拦截
  if ((cand.startsWith('{') && cand.endsWith('}')) || (cand.startsWith('[') && cand.endsWith(']'))) {
    if (
      candLower.includes('"code":') ||
      candLower.includes('"error":') ||
      candLower.includes('"message":') ||
      candLower.includes('"msg":')
    ) {
      return false;
    }
  }

  // 4. 常见接口限流/风控/网关错误提示关键词拦截
  const errorKeywords = [
    'too many requests',
    'rate limit',
    'ratelimit',
    'ip has been blocked',
    'ip blocked',
    'frequency limit',
    'unauthorized',
    'access denied',
    'service unavailable',
    'gateway timeout',
    'bad gateway',
    'internal server error',
    'cf-ray',
    'error code:',
    '请求过于频繁',
    '访问过于频繁',
    '频率超限',
    '接口受限',
    '风控拦截',
    '配额不足',
    '429 too many',
    '403 forbidden',
    '502 bad gateway',
    '504 gateway',
  ];
  for (const kw of errorKeywords) {
    if (candLower.includes(kw) && !origLower.includes(kw)) {
      return false;
    }
  }

  return true;
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
    const full = json[0].map((item: any) => item[0]).filter(Boolean).join('');
    if (full && isValidTranslation(text, full)) {
      return full;
    }
  }
  throw new Error('Invalid Google translate response');
}

export async function fetchBingTranslate(
  text: string,
  from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const cleanFrom = from === 'auto' ? '' : from.startsWith('zh') ? 'zh-Hans' : from.startsWith('en') ? 'en' : from;
  const cleanTo = to.startsWith('zh') ? 'zh-Hans' : to.startsWith('en') ? 'en' : to;

  // 方案 A：通过 Edge Translation 官方免密 API (极快且稳定)
  try {
    const authRes = await fetch('https://edge.microsoft.com/translate/auth', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (authRes.ok) {
      const token = (await authRes.text()).trim();
      if (token) {
        let transUrl = `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${cleanTo}&includeSentenceLength=true`;
        if (cleanFrom && cleanFrom !== 'auto') {
          transUrl += `&from=${cleanFrom}`;
        }
        const transRes = await fetch(transUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
          },
          body: JSON.stringify([{ Text: text }]),
          signal: AbortSignal.timeout(4000),
        });
        if (transRes.ok) {
          const transJson = await transRes.json();
          const result = transJson?.[0]?.translations?.[0]?.text;
          if (result && typeof result === 'string' && isValidTranslation(text, result)) {
            return result;
          }
        }
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
      if (trans && typeof trans === 'string' && isValidTranslation(text, trans)) {
        return trans;
      }
    }
  } catch {
    // fallback
  }

  // 备用有道接口
  const fallbackUrl = `https://aidemo.youdao.com/trans?q=${encodeURIComponent(text)}&from=${cleanFrom}&to=${cleanTo}`;
  const fbRes = await fetch(fallbackUrl, { signal: AbortSignal.timeout(4500) });
  if (fbRes.ok) {
    const fbJson = await fbRes.json();
    if (fbJson?.translation?.[0] && isValidTranslation(text, fbJson.translation[0])) {
      return fbJson.translation[0];
    }
  }
  throw new Error('Youdao translate unavailable');
}

export async function fetchDeepLTranslate(
  text: string,
  from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const targetLang = to.startsWith('zh') ? 'ZH' : to.toUpperCase();
  const sourceLang = from === 'auto' ? 'AUTO' : from.startsWith('zh') ? 'ZH' : from.toUpperCase();

  const nodes = [
    'https://api.deeplx.org/translate',
    'https://deepl.aurorain.cn/translate',
    'https://deeplx.mingming.dev/translate',
    'https://deepl.trsoft.top/translate',
    'https://deepl.fun/translate',
  ];

  for (const url of nodes) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          source_lang: sourceLang,
          target_lang: targetLang,
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const json = await res.json();
        // 强校验 code === 200 (若存在 code 字段，必须为 200)
        const codeOk = json.code === undefined || json.code === 200 || json.code === '200';
        if (codeOk) {
          const candidate = json.data || json.target_text || json.translation || json.translatedText;
          if (candidate && typeof candidate === 'string' && isValidTranslation(text, candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // try next node
    }
  }

  // 备用 plausibility 云网关通道
  try {
    const cleanFrom = from.startsWith('zh') ? 'zh' : 'auto';
    const cleanTo = to.startsWith('zh') ? 'zh' : 'en';
    const url = `https://translate.plausibility.cloud/translate?sl=${cleanFrom}&tl=${cleanTo}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const json = await res.json();
      const candidate = json.translation || json.translatedText || json.data;
      if (candidate && typeof candidate === 'string' && isValidTranslation(text, candidate)) {
        return candidate;
      }
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
  const translated = json?.responseData?.translatedText;
  if (translated && typeof translated === 'string' && isValidTranslation(text, translated)) {
    return translated;
  }
  throw new Error('Invalid MyMemory response');
}

export async function fetchBaiduTranslate(
  text: string,
  from: string = 'auto',
  to: string = 'zh-CN'
): Promise<string> {
  const cleanTo = to.startsWith('zh') ? 'zh' : to.startsWith('en') ? 'en' : to.split('-')[0];
  const cleanFrom = from === 'auto' ? 'auto' : from.startsWith('zh') ? 'zh' : from.startsWith('en') ? 'en' : from.split('-')[0];

  // 方案 A: 升级为句子级正式接口 fanyi.baidu.com/transapi
  try {
    const params = new URLSearchParams({
      from: cleanFrom,
      to: cleanTo,
      query: text,
    });
    const res = await fetch('https://fanyi.baidu.com/transapi', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://fanyi.baidu.com/',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        const fullDst = json.data
          .map((item: any) => item?.dst)
          .filter(Boolean)
          .join('\n');
        if (fullDst && isValidTranslation(text, fullDst)) {
          return fullDst;
        }
      }
    }
  } catch {
    // fallback to sug
  }

  // 方案 B: 降级回退单词提示接口 fanyi.baidu.com/sug
  try {
    const sugParams = new URLSearchParams({ kw: text });
    const sugRes = await fetch('https://fanyi.baidu.com/sug', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: sugParams.toString(),
      signal: AbortSignal.timeout(3000),
    });
    if (sugRes.ok) {
      const json = await sugRes.json();
      if (Array.isArray(json?.data)) {
        for (const item of json.data) {
          if (item?.v && isValidTranslation(text, item.v)) {
            return item.v;
          }
        }
      }
    }
  } catch {
    // fallback
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
    const trans = json?.auto_translation?.[0];
    if (trans && typeof trans === 'string' && isValidTranslation(text, trans)) {
      return trans;
    }
  }
  throw new Error('Tencent translate unavailable');
}

export async function fetchLlmTranslate(
  text: string,
  to: string,
  config: LlmConfig,
  style?: 'literal' | 'free' | 'terminology'
): Promise<{ trans: string; tier: string }> {
  const provider = config.provider || 'AI';
  const isLocal = config.endpoint.includes('localhost') || config.endpoint.includes('127.0.0.1');
  if (!config.apiKey && !isLocal) {
    return {
      trans: '[未配置 API Key · 点击前往设置]',
      tier: 'LLM (Config Required)',
    };
  }
  const endpoint = config.endpoint.endsWith('/')
    ? `${config.endpoint}chat/completions`
    : `${config.endpoint}/chat/completions`;

  const styleDirective =
    style === 'literal'
      ? ' Translate literally, staying close to the source wording and structure.'
      : style === 'terminology'
      ? ' Prioritize standard CG/3D industry terminology and keep term translations consistent.'
      : style === 'free'
      ? ' Translate naturally and idiomatically for maximum fluency.'
      : '';
  const prompt = `You are a professional, accurate translator. Translate the following text into ${to}.${styleDirective} Preserve formatting, code, numbers, and technical terms accurately. Return ONLY the translated text without explanations.\n\n${text}`;

  try {
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
    if (res.status === 401 || res.status === 403) {
      return {
        trans: '[API Key 无效或已过期 · 点击检查设置]',
        tier: 'LLM (Auth Error)',
      };
    }
    if (res.status === 429 || res.status === 402) {
      return {
        trans: '[API 额度不足或被限流 · 请检查账户配额]',
        tier: 'LLM (Quota Error)',
      };
    }
    if (!res.ok) throw new Error(`LLM API error ${res.status}`);
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content?.trim() || '';
    return {
      trans: content,
      tier: 'LLM API',
    };
  } catch (err: any) {
    return {
      trans: '[网络连接超时 / 点击重试]',
      tier: 'Online (Retry)',
    };
  }
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

  const forced = req.forcedEngine?.toLowerCase().trim();
  const isForced = !!forced && forced !== 'auto';

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

  const tasks: Promise<{ name: string; trans: string; tier: string }>[] = [];

  // Google
  if ((forced && (forced.includes('google') || forced.includes('谷歌'))) || (!isForced && online.google !== false)) {
    tasks.push(
      fetchGoogleTranslate(trimmed, actualSource, actualTarget)
        .then((res) => ({ name: 'Google 翻译 (官方通道)', trans: res, tier: 'Online Fallback' }))
        .catch(() => ({ name: 'Google 翻译 (官方通道)', trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // Bing
  if ((forced && (forced.includes('bing') || forced.includes('必应'))) || (!isForced && online.bing)) {
    tasks.push(
      fetchBingTranslate(trimmed, actualSource, actualTarget)
        .then((res) => ({ name: '微软 Bing 翻译', trans: res, tier: 'Online Fallback' }))
        .catch(() => ({ name: '微软 Bing 翻译', trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // Youdao
  if ((forced && (forced.includes('youdao') || forced.includes('有道'))) || (!isForced && online.youdao)) {
    tasks.push(
      fetchYoudaoTranslate(trimmed, actualSource, actualTarget)
        .then((res) => ({ name: '网易有道翻译', trans: res, tier: 'Online Fallback' }))
        .catch(() => ({ name: '网易有道翻译', trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // DeepL
  const isDeeplConfigured = !!req.deeplApiKey?.trim() || !!req.deeplCustomUrl?.trim();
  if ((forced && forced.includes('deepl')) || (!isForced && online.deepl && isDeeplConfigured)) {
    tasks.push(
      fetchDeepLTranslate(trimmed, actualSource, actualTarget)
        .then((res) => ({ name: 'DeepL 极速通道', trans: res, tier: 'Online Fallback' }))
        .catch(() => ({ name: 'DeepL 极速通道', trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // MyMemory
  if ((forced && (forced.includes('mymemory') || forced.includes('my_memory') || forced.includes('记忆库'))) || (!isForced && online.myMemory)) {
    tasks.push(
      fetchMyMemoryTranslate(trimmed, actualSource, actualTarget)
        .then((res) => ({ name: 'MyMemory 翻译记忆库', trans: res, tier: 'Online Fallback' }))
        .catch(() => ({ name: 'MyMemory 翻译记忆库', trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // Baidu
  const isBaiduConfigured = !!req.baiduAppId?.trim() && !!req.baiduSecret?.trim();
  if ((forced && (forced.includes('baidu') || forced.includes('百度'))) || (!isForced && online.baidu && isBaiduConfigured)) {
    tasks.push(
      fetchBaiduTranslate(trimmed, actualSource, actualTarget)
        .then((res) => ({ name: '百度通用翻译', trans: res, tier: 'Online Fallback' }))
        .catch(() => ({ name: '百度通用翻译', trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // Tencent
  if ((forced && (forced.includes('tencent') || forced.includes('腾讯'))) || (!isForced && online.tencent)) {
    tasks.push(
      fetchTencentTranslate(trimmed, actualSource, actualTarget)
        .then((res) => ({ name: '腾讯交互翻译', trans: res, tier: 'Online Fallback' }))
        .catch(() => ({ name: '腾讯交互翻译', trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // LLM API
  const isLlmConfigured = !!req.llmConfig && (
    !req.llmConfig.endpoint?.trim() ? false :
    (req.llmConfig.endpoint.includes('localhost') || req.llmConfig.endpoint.includes('127.0.0.1')) ||
    !!req.llmConfig.apiKey?.trim()
  );
  const runLlm = (forced && (forced.includes('llm') || forced.includes('ai') || forced.includes('openai') || forced.includes('deepseek') || forced.includes('ollama') || forced.includes('glm') || forced.includes('custom'))) || (!isForced && isLlmConfigured);
  if (runLlm && req.llmConfig) {
    const provider = req.llmConfig.provider || 'AI';
    tasks.push(
      fetchLlmTranslate(trimmed, actualTarget, req.llmConfig, req.style)
        .then((res) => ({ name: `🤖 AI 深度翻译 (${provider})`, trans: res.trans, tier: res.tier }))
        .catch(() => ({ name: `🤖 AI 深度翻译 (${provider})`, trans: '[网络连接超时 / 点击重试]', tier: 'Online (Retry)' }))
    );
  }

  // 并发等待所有开启的在线引擎完成（绝不丢弃任何卡片）
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

  const isRetryStatus = (e: import('./types').MultiEngineTranslation) =>
    e.sourceTier === 'Online (Retry)' ||
    e.sourceTier === 'LLM (Config Required)' ||
    e.sourceTier === 'LLM (Auth Error)' ||
    e.sourceTier === 'LLM (Quota Error)' ||
    e.translated.includes('点击重试') ||
    e.translated.includes('网络连接超时') ||
    e.translated.includes('未配置 API Key') ||
    e.translated.includes('API Key 无效') ||
    e.translated.includes('额度不足');

  const isRetryTranslation = (text: string) =>
    !text ||
    text.includes('点击重试') ||
    text.includes('网络连接超时') ||
    text.includes('未配置 API Key') ||
    text.includes('API Key 无效') ||
    text.includes('额度不足');

  // 优先保证有效 AI 大模型翻译 (LLM API) 排在最前，其次词库、其他有效在线翻译，待配置/鉴权错误/重试项排在最后
  engines.sort((a, b) => {
    const rank = (e: import('./types').MultiEngineTranslation) => {
      if (e.sourceTier === 'LLM API' && !isRetryStatus(e)) return 0;
      if ((e.sourceTier === 'Preset Dictionary' || e.sourceTier === 'Offline Dict') && !isRetryStatus(e)) return 1;
      if (!isRetryStatus(e)) return 2;
      if (e.sourceTier === 'LLM (Config Required)' || e.sourceTier === 'LLM (Auth Error)' || e.sourceTier === 'LLM (Quota Error)') return 3;
      return 4;
    };
    return rank(a) - rank(b);
  });

  // 3. 根据 forcedEngine 或 translationTiers 确定综合优选 mainTranslation
  let mainTranslation = '';
  if (forced && forced !== 'auto') {
    const matchedEngine = engines.find((e) => {
      const name = e.engineName.toLowerCase();
      const tier = e.sourceTier.toLowerCase();
      return (
        name.includes(forced) ||
        tier.includes(forced) ||
        (forced === 'dict' && tier.includes('preset')) ||
        (forced === 'llm' && (tier.includes('llm') || name.includes('ai'))) ||
        (forced === 'openai' && (name.includes('openai') || tier.includes('llm'))) ||
        (forced === 'deepseek' && (name.includes('deepseek') || tier.includes('llm')))
      );
    });
    if (matchedEngine) {
      mainTranslation = matchedEngine.translated;
      const idx = engines.indexOf(matchedEngine);
      if (idx > 0) {
        engines.splice(idx, 1);
        engines.unshift(matchedEngine);
      }
    }
  }

  // 智能优先挑选首个有效且非重试态的翻译结果
  if (isRetryTranslation(mainTranslation)) {
    const tiers = req.translationTiers || ['Preset Dictionary', 'LLM API', 'Online Fallback'];
    for (const tier of tiers) {
      const matchedEngine = engines.find((e) => e.sourceTier === tier && !isRetryStatus(e));
      if (matchedEngine) {
        mainTranslation = matchedEngine.translated;
        break;
      }
    }
  }

  if (isRetryTranslation(mainTranslation)) {
    const valid = engines.find((e) => !isRetryStatus(e));
    if (valid) {
      mainTranslation = valid.translated;
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
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
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
  const historyList = Array.isArray(current) ? current : [];
  localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(historyList.filter((i) => i.id !== id)));
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
  const historyList = Array.isArray(current) ? current : [];
  const existing = historyList.find((i) => i.original === text);
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
  const historyList = Array.isArray(current) ? current : [];
  const updated = [item, ...historyList.filter((i) => i.original !== item.original)];
  localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(updated.slice(0, 100)));
}

export async function cmdToggleFavorite(id: string): Promise<boolean> {
  if (isTauri()) {
    return await invoke<boolean>('cmd_toggle_favorite', { id });
  }
  const current = await cmdGetHistory();
  const historyList = Array.isArray(current) ? current : [];
  let favState = false;
  const updated = historyList.map((item) => {
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

/** Rust cmd_chat_llm_stream 推送的流式增量事件 */
export interface ChatStreamDelta {
  delta: string;
  done: boolean;
}

/**
 * 流式 LLM 对话：每收到一段增量文本就回调 onDelta；返回完整回复。
 * 非流式端点（Gemini 原生等）由 Rust 侧合并为单次 onDelta。
 * 浏览器/JSDOM mock 模式下模拟打字机分块推送。
 */
export async function cmdChatLlmStream(
  messages: { role: string; content: string }[],
  config: import('./types').LlmConfig,
  onDelta: (text: string) => void
): Promise<string> {
  if (isTauri()) {
    const { Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<ChatStreamDelta>();
    channel.onmessage = (msg) => {
      if (msg && !msg.done && msg.delta) onDelta(msg.delta);
    };
    return await invoke<string>('cmd_chat_llm_stream', {
      messages,
      config,
      onDelta: channel,
    });
  }

  // JSDOM / Browser Mock：打字机式分块推送
  const full = await cmdChatLlm(messages, config);
  const chunkSize = 6;
  for (let i = 0; i < full.length; i += chunkSize) {
    onDelta(full.slice(i, i + chunkSize));
    await new Promise((r) => setTimeout(r, 12));
  }
  return full;
}

export interface UpdateAssetInfo {
  name: string;
  url: string;
  size: number;
  sha256?: string | null;
}

export interface UpdateInfo {
  version: string;
  release_date: string;
  download_url: string;
  sha256?: string | null;
  release_notes: string;
  assets: UpdateAssetInfo[];
}

export interface UpdateCheckResult {
  latest?: UpdateInfo | null;
  has_update: boolean;
  current_version: string;
  error?: string | null;
}

export interface AppInfo {
  name: string;
  version: string;
  repo_url: string;
}

export async function cmdCheckAppUpdate(): Promise<UpdateCheckResult> {
  if (isTauri()) {
    return await invoke<UpdateCheckResult>('cmd_check_app_update');
  }
  // Browser / JSDOM fallback
  try {
    const res = await fetch('https://api.github.com/repos/maobukeai/catwalk-translator/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) {
      if (res.status === 404) {
        return {
          latest: null,
          has_update: false,
          current_version: APP_VERSION,
          error: '未找到已发布的 Release 版本 (404)',
        };
      }
      return {
        latest: null,
        has_update: false,
        current_version: APP_VERSION,
        error: `GitHub API 返回 HTTP ${res.status}`,
      };
    }
    const json = await res.json();
    const tag = String(json.tag_name || '').replace(/^[vV]/, '');
    const has_update = compareVersions(tag, APP_VERSION) > 0;
    return {
      latest: {
        version: tag || APP_VERSION,
        release_date: json.published_at || '',
        download_url: json.html_url || 'https://github.com/maobukeai/catwalk-translator/releases',
        release_notes: json.body || '',
        assets: (json.assets || []).map((a: any) => ({
          name: a.name,
          url: a.browser_download_url,
          size: a.size || 0,
          sha256: null,
        })),
      },
      has_update,
      current_version: APP_VERSION,
      error: null,
    };
  } catch (err) {
    return {
      latest: null,
      has_update: false,
      current_version: APP_VERSION,
      error: `检查更新失败: ${String(err)}`,
    };
  }
}

export async function cmdGetAppInfo(): Promise<AppInfo> {
  if (isTauri()) {
    return await invoke<AppInfo>('cmd_get_app_info');
  }
  return {
    name: '猫步翻译',
    version: APP_VERSION,
    repo_url: 'https://github.com/maobukeai/catwalk-translator',
  };
}


// ── 备份与同步（backup.rs / webdav.rs）──

/** 浏览器/测试环境下的备份功能统一降级文案 */
const backupDesktopOnly = '备份功能仅在桌面端可用';

export async function cmdCreateBackup(): Promise<BackupEntry> {
  if (isTauri()) {
    return await invoke<BackupEntry>('cmd_create_backup');
  }
  throw new Error(backupDesktopOnly);
}

export async function cmdListBackups(): Promise<BackupEntry[]> {
  if (isTauri()) {
    return await invoke<BackupEntry[]>('cmd_list_backups');
  }
  return [];
}

export async function cmdDeleteBackup(name: string): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_delete_backup', { name });
    return;
  }
  throw new Error(backupDesktopOnly);
}

export async function cmdRestoreBackup(name: string): Promise<RestoreSummary> {
  if (isTauri()) {
    return await invoke<RestoreSummary>('cmd_restore_backup', { name });
  }
  throw new Error(backupDesktopOnly);
}

export async function cmdOpenBackupDir(): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_open_backup_dir');
    return;
  }
  throw new Error(backupDesktopOnly);
}

/** 导出当前数据为备份 zip（base64），由前端转 Blob 下载 */
export async function cmdExportBackupBase64(): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('cmd_export_backup_base64');
  }
  throw new Error(backupDesktopOnly);
}

/** 从 base64 备份包导入并覆盖当前数据 */
export async function cmdImportBackupBase64(data: string): Promise<RestoreSummary> {
  if (isTauri()) {
    return await invoke<RestoreSummary>('cmd_import_backup_base64', { data });
  }
  throw new Error(backupDesktopOnly);
}

/** WebDAV 连接测试（直传表单值，无需先保存），成功返回如 "连接成功（230 ms）"。
 *  password 传空字符串表示沿用已保存密码。 */
export async function cmdWebdavTest(url: string, username: string, password: string): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('cmd_webdav_test', { url, username, password });
  }
  throw new Error(backupDesktopOnly);
}

export interface WebdavUploadResult {
  name: string;
  sizeBytes: number;
  deletedOld: number;
}

export async function cmdWebdavUpload(): Promise<WebdavUploadResult> {
  if (isTauri()) {
    return await invoke<WebdavUploadResult>('cmd_webdav_upload');
  }
  throw new Error(backupDesktopOnly);
}

export async function cmdWebdavList(): Promise<RemoteBackupEntry[]> {
  if (isTauri()) {
    return await invoke<RemoteBackupEntry[]>('cmd_webdav_list');
  }
  return [];
}

export async function cmdWebdavRestore(name: string): Promise<RestoreSummary> {
  if (isTauri()) {
    return await invoke<RestoreSummary>('cmd_webdav_restore', { name });
  }
  throw new Error(backupDesktopOnly);
}

export async function cmdWebdavDelete(name: string): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_webdav_delete', { name });
    return;
  }
  throw new Error(backupDesktopOnly);
}

// ── 开机自启（tauri-plugin-autostart；OS 级注册表/启动项状态，不落 settings.json） ──

export async function cmdGetAutoStart(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    return await isEnabled();
  } catch (err) {
    console.warn('查询开机自启状态失败:', err);
    return false;
  }
}

export async function cmdSetAutoStart(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const plugin = await import('@tauri-apps/plugin-autostart');
  if (enabled) {
    await plugin.enable();
  } else {
    await plugin.disable();
  }
}

// ── 贴图（Pin）：译文卡片钉在桌面置顶小窗 ──

export async function cmdOpenPin(payload: import('./types').PinPayload): Promise<void> {
  if (!isTauri()) {
    console.warn('贴图为桌面端功能，浏览器演示环境不可用');
    return;
  }
  await invoke('cmd_open_pin', { payload });
}

export async function cmdGetPinPayload(id: string): Promise<import('./types').PinPayload | null> {
  if (!isTauri()) return null;
  return await invoke<import('./types').PinPayload | null>('cmd_get_pin_payload', { id });
}

export async function cmdClosePin(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('cmd_close_pin', { id });
}

// ── 网络诊断 ──────────────────────────────────────────────────────────────

export interface DiagItem {
  name: string;
  kind: string;
  ok: boolean;
  skipped: boolean;
  latencyMs: number;
  detail: string;
}

export async function cmdNetworkDiagnose(): Promise<DiagItem[]> {
  if (isTauri()) {
    return await invoke<DiagItem[]>('cmd_network_diagnose');
  }
  // 浏览器演示：返回模拟结果
  return [
    { name: 'Google 翻译', kind: 'engine', ok: true, skipped: false, latencyMs: 320, detail: 'HTTP 200 (演示)' },
    { name: '代理链路', kind: 'proxy', ok: true, skipped: false, latencyMs: 0, detail: '浏览器演示环境' },
  ];
}

// ── 通用离线词典（ECDICT） ────────────────────────────────────────────────

export interface GeneralDictStatus {
  installed: boolean;
  entries: number;
  installedAt: string;
}

export interface GeneralDictHit {
  word: string;
  phonetic: string;
  definitions: string[];
}

export async function cmdGeneralDictStatus(): Promise<GeneralDictStatus> {
  if (isTauri()) return await invoke<GeneralDictStatus>('cmd_general_dict_status');
  return { installed: false, entries: 0, installedAt: '' };
}

export async function cmdGeneralDictLookup(word: string): Promise<GeneralDictHit | null> {
  if (isTauri()) return await invoke<GeneralDictHit | null>('cmd_general_dict_lookup', { word });
  return null;
}

export async function cmdGeneralDictUninstall(): Promise<void> {
  if (isTauri()) await invoke('cmd_general_dict_uninstall');
}

/// 安装（下载 63MB + 解析），onProgress 为增量回调（channel 方式与 LLM 流一致）
export async function cmdGeneralDictInstall(
  onProgress: (downloaded: number, total: number, phase: string, detail: string) => void
): Promise<GeneralDictStatus> {
  if (!isTauri()) {
    throw new Error('词典下载为桌面端功能，浏览器演示环境不可用');
  }
  const { Channel } = await import('@tauri-apps/api/core');
  const channel = new Channel<{ downloaded: number; total: number; phase: string; detail: string }>();
  channel.onmessage = (msg) => onProgress(msg.downloaded, msg.total, msg.phase, msg.detail);
  return await invoke<GeneralDictStatus>('cmd_general_dict_install', { onProgress: channel });
}

// ── 剪贴板翻译历史 ────────────────────────────────────────────────────────

export interface ClipboardHistoryEntry {
  original: string;
  translated: string;
  sourceTier: string;
  timestamp: string;
  atMs: number;
}

export async function cmdGetClipboardHistory(): Promise<ClipboardHistoryEntry[]> {
  if (isTauri()) return await invoke<ClipboardHistoryEntry[]>('cmd_get_clipboard_history');
  return [];
}

export async function cmdClearClipboardHistory(): Promise<void> {
  if (isTauri()) await invoke('cmd_clear_clipboard_history');
}

// ── 译文导出图片 ──────────────────────────────────────────────────────────

export async function cmdSaveExportPng(dataUrl: string, suggestedName: string): Promise<string> {
  if (!isTauri()) throw new Error('导出图片为桌面端功能，浏览器演示环境不可用');
  return await invoke<string>('cmd_save_export_png', { dataUrl, suggestedName });
}

// ── 无感查词浮窗(lookup_monitor.rs)──

export async function cmdGetLookupPayload(): Promise<unknown | null> {
  if (isTauri()) {
    return await invoke('cmd_get_lookup_payload');
  }
  return null;
}

export async function cmdHideLookupPopup(): Promise<void> {
  if (isTauri()) {
    await invoke('cmd_hide_lookup_popup');
  }
}
