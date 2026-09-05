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
  /** 截图瞬间检测到的前台 3D/CG 软件（自动切换词库用） */
  detectedApp?: { preset: string; appName: string } | null;
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
  /** Real rendered width for AABB collision (nowrap text can overflow logicalW) */
  aabbW?: number;
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
  name?: string;
  provider: string;
  apiKey: string;
  model: string;
  endpoint: string;
  enabled?: boolean;
  availableModels?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  isReasoningCollapsed?: boolean;
  timestamp: string;
  model?: string;
  mode?: string;
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

export interface AiExampleSentence {
  en: string;
  zh: string;
}

export interface AiCollocation {
  phrase: string;
  trans: string;
}

export interface AiWordContext {
  examples: AiExampleSentence[];
  collocations: AiCollocation[];
  usageTip?: string;
  modelUsed?: string;
  timestamp?: number;
}

export interface AiStyleRewrite {
  style: 'formal' | 'technical' | 'casual';
  styleLabel: string;
  iconName: string;
  text: string;
}

export interface AiVocabularyItem {
  word: string;
  phonetic?: string;
  pos?: string;
  meaning: string;
}

export interface AiDeepTranslationAnalysis {
  rewrites: AiStyleRewrite[];
  vocabulary: AiVocabularyItem[];
  examples: AiExampleSentence[];
  modelUsed?: string;
  timestamp?: number;
}

export interface WordDetail {
  phoneticUs: string;
  phoneticUk: string;
  pos: string;
  definition: string;
  examples: string[];
  cgDomainNote: string;
  aiContext?: AiWordContext | null;
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
  baiduLlm?: boolean;
  tencent?: boolean;
  lingva?: boolean;
  caiyun?: boolean;
  urban?: boolean;
  volcengine?: boolean;
  yandex?: boolean;
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

/** 本地备份设置：定期自动备份、保留策略与最近备份时间 */
export interface BackupSettings {
  autoBackupEnabled?: boolean;
  /** 自动备份间隔（小时），默认 24 */
  intervalHours?: number;
  /** 本地最多保留份数，超过淘汰最旧；0 = 不限制，默认 10 */
  maxLocalBackups?: number;
  /** 最近一次备份时间（epoch 毫秒） */
  lastBackupAtMs?: number;
  /** 备份包含的内容项清单（'settings' | 'api_keys' | 'custom_dict' | 'history' | 'capture_sessions'） */
  includedItems?: string[];
}

/** WebDAV 云同步配置（如坚果云 https://dav.jiangguoyun.com/dav/） */
export interface WebdavConfig {
  url?: string;
  username?: string;
  /** 应用密码（明文保存于 settings.json，与引擎 API Key 一致）；留空表示未修改 */
  password?: string;
  /** 远端目录，默认 MaobuTranslator */
  remoteDir?: string;
  /** 云端备份保留天数，默认 15 */
  retentionDays?: number;
  lastUploadAtMs?: number;
  lastUploadName?: string;
  lastRestoreAtMs?: number;
}

/** 本地备份列表条目 */
export interface BackupEntry {
  name: string;
  sizeBytes: number;
  createdAtMs: number;
  /** 'auto' | 'manual' */
  source: string;
  /** 备份包中包含的数据项清单 */
  includedItems?: string[];
}

/** WebDAV 远端备份条目 */
export interface RemoteBackupEntry {
  name: string;
  sizeBytes: number;
  /** 服务器 HTTP 日期串，new Date() 可直接解析 */
  modifiedAt?: string;
}

/** 恢复/导入备份的结果摘要 */
export interface RestoreSummary {
  appVersion: string;
  createdAt: string;
  historyCount: number;
  captureSessionCount: number;
  /** 本次实际恢复的数据项清单 */
  restoredItems?: string[];
}

export interface AppSettings {
  theme: string;
  hotkey: string;
  spotlightHotkey?: string;
  clipboardHotkey?: string;
  toggleWindowHotkey?: string;
  quickWindowHotkey?: string;
  captureHotkeyEnabled?: boolean;
  spotlightHotkeyEnabled?: boolean;
  clipboardHotkeyEnabled?: boolean;
  toggleWindowHotkeyEnabled?: boolean;
  quickWindowHotkeyEnabled?: boolean;
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
  /** Selected ONNX OCR model version */
  ocrVersion?: 'v3' | 'v4' | 'v5' | 'v6' | 'v6t';
  /** Primary translation engine: 'auto' | 'dict' | 'llm' | 'online' */
  primaryTranslationEngine?: 'auto' | 'dict' | 'llm' | 'online';
  /** 百度翻译开放平台 AppID（免费注册，每月 100 万字符）*/
  baiduAppId?: string;
  /** 百度翻译开放平台通用版密钥 */
  baiduSecret?: string;
  /** 百度翻译开放平台大模型版专用 API Key (Bearer Token)，留空则使用 baiduSecret */
  baiduLlmApiKey?: string;
  /** 是否通用版与大模型版使用相同密钥 */
  useBaiduSameSecret?: boolean;
  /** DeepL 官方免费 API Key（每月 50 万字符）*/
  deeplApiKey?: string;
  /** 自定义 DeepLX 自建服务地址，如 http://localhost:1188/translate */
  deeplCustomUrl?: string;
  /** 字节跳动火山翻译 AccessKey ID */
  volcengineAccessKey?: string;
  /** 字节跳动火山翻译 Secret Access Key */
  volcengineSecretKey?: string;
  /** Yandex Translate API Key */
  yandexApiKey?: string;
  /** Yandex Folder ID */
  yandexFolderId?: string;
  /** 关闭主窗口时的行为：'ask' (每次询问) | 'minimize' (最小化到系统托盘) | 'exit' (直接退出程序) */
  closeAction?: 'ask' | 'minimize' | 'exit';
  /** Spotlight 查词小窗口关闭行为：'hide' (自动隐藏) | 'minimize' (最小化) */
  miniWindowCloseAction?: 'hide' | 'minimize';
  /** OCR 内容过滤：命中规则的识别块(时间戳/纯数字/水印)不参与翻译 */
  ocrFilterEnabled?: boolean;
  /** 过滤规则(正则，一条一行；空 = 默认规则集) */
  ocrFilterRules?: string[];
  /** 无感查词①：拖选/双击选中文字自动弹翻译浮窗 */
  selectionLookupEnabled?: boolean;
  /** 无感查词②：按住修饰键悬停屏幕文字弹词卡 */
  hoverLookupEnabled?: boolean;
  /** 悬停取词修饰键：'ctrl' | 'alt' | 'shift' */
  hoverLookupModifier?: 'ctrl' | 'alt' | 'shift';
  /** 主窗口置顶显示（默认关闭） */
  alwaysOnTop?: boolean;
  /** 手动代理开关：开启后使用 proxyUrl，优先于系统代理自动探测 */
  proxyEnabled?: boolean;
  /** 手动代理地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
  proxyUrl?: string;
  /** TTS 朗读语速 (0.5 ~ 2.0，默认 1.0) */
  ttsRate?: number;
  /** 截图划词时自动识别前台 3D/CG 软件并切换对应专业词库（默认开启） */
  autoDetectPreset?: boolean;
  /** 快慢双流渐进翻译：在线引擎并发大竞速秒出结果，大模型异步精翻无缝升级替换（默认开启） */
  enableLlmProgressiveRefine?: boolean;
  /** 优质生词智能甄选收藏：自动识别专业 3D/CG 术语与 AI 精翻高价值表达并加入收藏（默认开启） */
  autoFavoriteQualityTerms?: boolean;
  /** 本地备份设置（自动备份 / 保留策略） */
  backupSettings?: BackupSettings;
  /** WebDAV 云同步配置 */
  webdavConfig?: WebdavConfig;
  /** AnkiConnect 本地同步配置 */
  ankiSettings?: AnkiSettings;
}

export interface AnkiSettings {
  enabled?: boolean;
  endpoint?: string;
  deckName?: string;
  modelName?: string;
  autoSyncOnStar?: boolean;
  tags?: string[];
}

export interface AnkiCheckResult {
  connected: boolean;
  version: number;
  decks: string[];
  models: string[];
  message: string;
}

export interface AnkiNotePayload {
  original: string;
  translated: string;
  phonetic?: string;
  context?: string;
  category?: string;
  tags?: string[];
}

export interface AnkiSyncResult {
  total: number;
  added: number;
  skipped: number;
  errors: string[];
}

export interface UserGlossaryEntry {
  id: string;
  source: string;
  target: string;
  category: string;
  note?: string;
  createdAt: number;
}

export interface GlossaryImportSummary {
  totalParsed: number;
  added: number;
  updated: number;
  skipped: number;
  totalAfter: number;
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
  | 'ru'
  | 'it'
  | 'pt'
  | 'nl'
  | 'pl'
  | 'ar'
  | 'th'
  | 'vi'
  | 'id'
  | 'tr'
  | 'hi'
  | 'uk'
  | 'sv'
  | 'cs'
  | 'el'
  | 'he'
  | 'da'
  | 'fi'
  | 'no'
  | 'hu'
  | 'ro'
  | string;

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
  llmConfigs?: LlmConfig[];
  presetDicts?: PresetDicts;
  onlineEngines?: OnlineEngines;
  translationTiers?: string[];
  /** Translation style hint for LLM tiers: literal | free | terminology */
  style?: 'literal' | 'free' | 'terminology';
  forcedEngine?: string;
  baiduAppId?: string;
  baiduSecret?: string;
  baiduLlmApiKey?: string;
  deeplApiKey?: string;
  deeplCustomUrl?: string;
  volcengineAccessKey?: string;
  volcengineSecretKey?: string;
  yandexApiKey?: string;
  yandexFolderId?: string;
  skipLlm?: boolean;
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


/** 贴图卡片中的多引擎对比项 */
export interface PinEngineOption {
  engineName: string;
  translated: string;
  sourceTier: string;
  isError?: boolean;
}

/** 贴图卡片中的单个文本块 */
export interface PinBlock {
  original: string;
  translated: string;
  sourceTier: string;
  wordDetail?: WordDetail | null;
  deepAnalysis?: AiDeepTranslationAnalysis | null;
  engineOptions?: PinEngineOption[];
  selectedEngineName?: string;
  alternatives?: string[];
}

/** 贴图（Pin）窗口内容：位置尺寸为逻辑像素（CSS px） */
export interface PinPayload {
  id: string;
  title: string;
  blocks: PinBlock[];
  x: number;
  y: number;
  width: number;
  height: number;
}
