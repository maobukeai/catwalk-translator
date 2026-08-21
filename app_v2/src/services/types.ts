export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenCapturePayload {
  dataUrl: string;
  width: number;
  height: number;
  scaleFactor: number;
}


export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBlock {
  text: string;
  confidence: number;
  boxRect: BoundingBox;
}

export interface OcrResult {
  blocks: TextBlock[];
}

/** One translated text block for in-place overlay rendering */
export interface OverlayBlock {
  original: string;
  translated: string;
  sourceTier: string;
  /** Logical (CSS) pixel position on screen */
  logicalX: number;
  logicalY: number;
  logicalW: number;
  logicalH: number;
  /** Height used for AABB collision avoidance if different from logicalH */
  aabbH?: number;
  /** CSS rgba() background color sampled from desktop */
  bgCss: string;
  /** Real sampled ink colour (rgb() string) or high-contrast fallback */
  fgCss: string;
  /** Base64 PNG: the padded OCR box with glyphs erased (background
   *  continuation). Used as the card background so the original text is
   *  "removed" and the card blends into the real screen pixels. */
  patchPng?: string;
  /** Logical (CSS) rect of the patch (padded OCR box, absolute on screen) */
  patchX?: number;
  patchY?: number;
  patchW?: number;
  patchH?: number;
  /** Frontend-only: stage-2 translation failed for this block (shows retry). */
  translationFailed?: boolean;
}

export interface OverlayResult {
  blocks: OverlayBlock[];
  selectionX: number;
  selectionY: number;
  selectionW: number;
  selectionH: number;
}

export interface LlmConfig {
  id?: string;
  provider: string;
  apiKey: string;
  model: string;
  endpoint: string;
  availableModels?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: string;
}

export interface TranslationResult {
  original: string;
  translated: string;
  sourceTier: string;
}

export interface ColorSample {
  boxRect: BoundingBox;
  backgroundRgb: [number, number, number];
  textColor: string;
}

export interface PresetDicts {
  blender: boolean;
  substance: boolean;
  unity: boolean;
  unreal: boolean;
  maya: boolean;
  houdini: boolean;
}

export interface WordDetail {
  phoneticUs: string;
  phoneticUk: string;
  pos: string;
  definition: string;
  examples: string[];
  cgDomainNote: string;
}

export interface MultiEngineTranslation {
  engineName: string;
  translated: string;
  sourceTier: string;
}

export interface TextQueryResponse {
  original: string;
  wordDetail: WordDetail | null;
  results: MultiEngineTranslation[];
}

export interface HistoryItem {
  id: string;
  original: string;
  translated: string;
  sourceTier: string;
  timestamp: string;
  isFavorite: boolean;
}

export interface OnlineEngines {
  google?: boolean;
  bing?: boolean;
  youdao?: boolean;
  deepl?: boolean;
  myMemory?: boolean;
  baidu?: boolean;
  tencent?: boolean;
  [key: string]: boolean | undefined;
}

export type ThemeMode = 'system' | 'light' | 'dark' | 'fluent-dark';
export type FontFamilyOption = 'system' | 'yahei' | 'segoe' | 'inter' | 'mono';
export type FontSizeOption = 'small' | 'medium' | 'large' | 'xlarge';

export interface AppearanceSettings {
  theme: ThemeMode;
  enableBlur: boolean;       // 开启磨砂玻璃
  blurAmount: number;        // 0 to 40 px 高斯模糊程度
  enableTransparency?: boolean; // 兼容旧配置
  windowOpacity?: number;      // 兼容旧配置
  fontFamily: FontFamilyOption;
  fontSize: FontSizeOption;
}

export interface CustomDictItem {
  id: string;
  original: string;
  translated: string;
  category: string;
  note?: string;
  createdAt: string;
}

export interface OfflineModelSettings {
  installed: boolean;
  activeModelId: string;
  enabled: boolean;
  installedModelIds?: string[];
  modelName: string;
  sizeMB: number;
  downloadDate?: string;
}

export interface AppSettings {
  theme: string;
  hotkey: string;
  hotkeyEnabled?: boolean;
  spotlightHotkey?: string;
  clipboardHotkey?: string;
  toggleWindowHotkey?: string;
  captureHotkeyEnabled?: boolean;
  spotlightHotkeyEnabled?: boolean;
  clipboardHotkeyEnabled?: boolean;
  toggleWindowHotkeyEnabled?: boolean;
  defaultPreset: string;
  captureEngine?: string;
  llmConfig: LlmConfig | null;
  llmConfigs?: LlmConfig[];
  translationTiers: string[];
  presetDicts: PresetDicts;
  onlineEngines?: OnlineEngines;
  appearance?: AppearanceSettings;
  customDictItems?: CustomDictItem[];
  offlineModel?: OfflineModelSettings;
  overlayViewMode?: 'cover' | 'tooltip' | 'panel';
  enableAabbAvoidance?: boolean;
  /** LLM translation style: literal (直译) | free (意译) | terminology (术语优先) */
  translationStyle?: 'literal' | 'free' | 'terminology';
  /** Collapsed icon-only sidebar */
  sidebarCollapsed?: boolean;
  /** Selection release behaviour: 'adjust' = release freezes the rect for
   *  resize/move/nudge before recognition; 'auto' = release recognises at once. */
  captureReleaseAction?: 'auto' | 'adjust';
  /** Region-watch (W) refresh interval in ms, clamped to 1000–10000. */
  watchIntervalMs?: number;
  /** Passive clipboard watch: translate any copied text automatically (off by default). */
  clipboardWatchEnabled?: boolean;
  /** OCR engine preference: 'auto' | 'onnx' | 'winrt' */
  ocrEngine?: 'auto' | 'onnx' | 'winrt';
  /** Selected ONNX OCR model version: 'v3' | 'v4' | 'v5' */
  ocrVersion?: 'v3' | 'v4' | 'v5';
  /** Primary translation engine: 'auto' | 'dict' | 'llm' | 'online' */
  primaryTranslationEngine?: 'auto' | 'dict' | 'llm' | 'online';
  /** 百度翻译开放平台 AppID（免费注册，每月 100 万字符）*/
  baiduAppId?: string;
  /** 百度翻译开放平台密钥 */
  baiduSecret?: string;
  /** DeepL 官方免费 API Key（每月 50 万字符）*/
  deeplApiKey?: string;
  /** 自定义 DeepLX 自建服务地址，如 http://localhost:1188/translate */
  deeplCustomUrl?: string;
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

/** One in-place card of a saved capture session (positions are overlay-logical px). */
export interface CaptureSessionBlock {
  original: string;
  translated: string;
  sourceTier: string;
  logicalX: number;
  logicalY: number;
  logicalW: number;
  logicalH: number;
  bgCss: string;
  fgCss: string;
}

/** A full screen-capture translation session, replayable in the main window. */
export interface CaptureSession {
  id: string;
  timestamp: string;
  targetLang: string;
  engine: string;
  blocks: CaptureSessionBlock[];
}

export type LanguageCode =
  | 'auto'
  | 'zh-CN'
  | 'zh-TW'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru';

export interface LanguageOption {
  code: LanguageCode;
  name: string;
}

export interface UniversalTranslationRequest {
  text: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  preset?: string;
  llmConfig?: LlmConfig | null;
  presetDicts?: PresetDicts;
  onlineEngines?: OnlineEngines;
  translationTiers?: string[];
  /** Translation style hint for LLM tiers: literal | free | terminology */
  style?: 'literal' | 'free' | 'terminology';
  forcedEngine?: string;
  baiduAppId?: string;
  baiduSecret?: string;
  deeplApiKey?: string;
  deeplCustomUrl?: string;
}

export type UniversalTranslateParams = UniversalTranslationRequest;

export interface UniversalTranslationResponse {
  original: string;
  detectedLang: string;
  mainTranslation: string;
  wordDetail?: WordDetail | null;
  engines: MultiEngineTranslation[];
}

export interface OcrEngineStatus {
  /** idle | warming | ready | failed */
  status: string;
  detail: string;
}

