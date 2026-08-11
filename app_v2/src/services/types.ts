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
  /** CSS rgba() background color sampled from desktop */
  bgCss: string;
  /** '#ffffff' or '#141417' */
  fgCss: string;
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

export type ThemeMode = 'fluent-dark' | 'dark' | 'light' | 'system';
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
}

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

