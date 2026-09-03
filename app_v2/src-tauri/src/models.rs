use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBlock {
    pub text: String,
    pub confidence: f32,
    pub box_rect: BoundingBox,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub blocks: Vec<TextBlock>,
}

fn default_true_opt() -> Option<bool> {
    Some(true)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    /// Unique identifier for this model entry in the multi-model pool.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub endpoint: String,
    /// 是否启用该模型（默认 true，关闭后不参与翻译）
    #[serde(default = "default_true_opt", skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            id: None,
            provider: "DeepSeek".to_string(),
            api_key: String::new(),
            model: "deepseek-chat".to_string(),
            endpoint: "https://api.deepseek.com/v1".to_string(),
            enabled: Some(true),
        }
    }
}

impl LlmConfig {
    pub fn new(provider: &str, api_key: &str, model: &str, endpoint: &str) -> Self {
        Self {
            id: Some(format!(
                "llm-{}-{}",
                provider.to_lowercase().replace(' ', "-"),
                model
            )),
            provider: provider.to_string(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            endpoint: endpoint.to_string(),
            enabled: Some(true),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSample {
    pub box_rect: BoundingBox,
    pub background_rgb: [u8; 3],
    pub text_color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetDicts {
    pub blender: bool,
    pub substance: bool,
    pub unity: bool,
    pub unreal: bool,
    pub maya: bool,
    pub houdini: bool,
}

impl Default for PresetDicts {
    fn default() -> Self {
        Self {
            blender: true,
            substance: true,
            unity: true,
            unreal: true,
            maya: true,
            houdini: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordDetail {
    pub phonetic_us: String,
    pub phonetic_uk: String,
    pub pos: String,
    pub definition: String,
    pub examples: Vec<String>,
    pub cg_domain_note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiEngineTranslation {
    pub engine_name: String,
    pub translated: String,
    pub source_tier: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextQueryResponse {
    pub original: String,
    pub word_detail: Option<WordDetail>,
    pub results: Vec<MultiEngineTranslation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub original: String,
    pub translated: String,
    pub source_tier: String,
    pub timestamp: String,
    pub is_favorite: bool,
}

/// One in-place card of a saved capture session (positions are overlay-logical px).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSessionBlock {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
    pub logical_x: f64,
    pub logical_y: f64,
    pub logical_w: f64,
    pub logical_h: f64,
    pub bg_css: String,
    pub fg_css: String,
}

/// A full screen-capture translation session, replayable in the main window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSession {
    pub id: String,
    pub timestamp: String,
    pub target_lang: String,
    pub engine: String,
    pub blocks: Vec<CaptureSessionBlock>,
}

/// Runtime status of the native RapidOCR daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrEngineStatus {
    /// idle | warming | ready | failed
    pub status: String,
    pub detail: String,
}

/// Filesystem-backed status of the offline phrase-dictionary engine
/// (see `offline.rs`). Every field reflects real on-disk state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineModelStatus {
    pub installed: bool,
    pub model_id: String,
    pub model_name: String,
    pub version: String,
    pub dict_entries: usize,
    pub storage_bytes: u64,
    pub engine_kind: String,
    pub path: String,
}

/// A single translated text block for the in-place overlay.
/// Positions are in LOGICAL (CSS) pixels so the frontend can place divs directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayBlock {
    /// Original detected text
    pub original: String,
    /// Best translation
    pub translated: String,
    /// Which engine / tier produced the translation
    pub source_tier: String,
    /// Logical (CSS) pixel rect of this block on screen
    pub logical_x: f64,
    pub logical_y: f64,
    pub logical_w: f64,
    pub logical_h: f64,
    /// Sampled background colour as CSS rgba() string, e.g. "rgba(30,32,38,0.94)"
    pub bg_css: String,
    /// Foreground (text) colour: real sampled ink colour or "#ffffff"/"#141417" fallback
    pub fg_css: String,
    /// Base64-encoded PNG patch: the padded OCR box with its glyphs erased by
    /// background interpolation, so the overlay card can "remove" the original
    /// text and blend into the real screen pixels. None when patch building
    /// failed (frontend falls back to the solid bg_css rectangle).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_png: Option<String>,
    /// Logical (CSS) rect of the patch on screen (padded OCR box, absolute).
    #[serde(default)]
    pub patch_x: f64,
    #[serde(default)]
    pub patch_y: f64,
    #[serde(default)]
    pub patch_w: f64,
    #[serde(default)]
    pub patch_h: f64,
}

/// Full result of one region-OCR-translate pass
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayResult {
    pub blocks: Vec<OverlayBlock>,
    /// Logical pixel bounding box of the entire selection
    pub selection_x: f64,
    pub selection_y: f64,
    pub selection_w: f64,
    pub selection_h: f64,
}

/// One translated text line of a pasted/dropped image.
/// Coordinates are pixels in the source image's own space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTranslateBlock {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
    pub confidence: f32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub bg_css: String,
    pub fg_css: String,
    #[serde(default)]
    pub patch_png: Option<String>,
    #[serde(default)]
    pub patch_x: f64,
    #[serde(default)]
    pub patch_y: f64,
    #[serde(default)]
    pub patch_w: f64,
    #[serde(default)]
    pub patch_h: f64,
}

/// Result of translating a user-supplied image (paste or drag-drop).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTranslateResponse {
    pub image_width: u32,
    pub image_height: u32,
    pub blocks: Vec<ImageTranslateBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineEngines {
    pub google: Option<bool>,
    pub bing: Option<bool>,
    pub youdao: Option<bool>,
    pub deepl: Option<bool>,
    pub my_memory: Option<bool>,
    pub baidu: Option<bool>,
    pub tencent: Option<bool>,
    pub lingva: Option<bool>,
    pub caiyun: Option<bool>,
    pub urban: Option<bool>,
    pub volcengine: Option<bool>,
    pub yandex: Option<bool>,
}

impl Default for OnlineEngines {
    fn default() -> Self {
        Self {
            google: Some(true),
            bing: Some(true),
            youdao: Some(true),
            deepl: Some(false),
            my_memory: Some(false),
            baidu: Some(false),
            tencent: Some(false),
            lingva: Some(false),
            caiyun: Some(false),
            urban: Some(false),
            volcengine: Some(false),
            yandex: Option::from(false),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UniversalTranslationRequest {
    pub text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub preset: Option<String>,
    pub llm_config: Option<LlmConfig>,
    #[serde(default)]
    pub llm_configs: Option<Vec<LlmConfig>>,
    pub preset_dicts: Option<PresetDicts>,
    pub online_engines: Option<OnlineEngines>,
    pub translation_tiers: Option<Vec<String>>,
    /// Translation style hint for LLM tiers: "literal" | "free" | "terminology".
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub forced_engine: Option<String>,
    /// 百度翻译开放平台 AppID（官方免费 API，每月 100 万字符）
    #[serde(default)]
    pub baidu_app_id: Option<String>,
    /// 百度翻译开放平台密钥（与 AppID 配合使用）
    #[serde(default)]
    pub baidu_secret: Option<String>,
    /// DeepL 官方免费 API Key（deepl.com 注册，每月 50 万字符）
    #[serde(default)]
    pub deepl_api_key: Option<String>,
    /// 自定义 DeepLX 自建服务地址（如 http://localhost:1188/translate）
    #[serde(default)]
    pub deepl_custom_url: Option<String>,
    /// 字节跳动火山翻译 AccessKey ID
    #[serde(default)]
    pub volcengine_access_key: Option<String>,
    /// 字节跳动火山翻译 Secret Access Key
    #[serde(default)]
    pub volcengine_secret_key: Option<String>,
    /// Yandex Translate API Key
    #[serde(default)]
    pub yandex_api_key: Option<String>,
    /// Yandex Folder ID
    #[serde(default)]
    pub yandex_folder_id: Option<String>,
    /// 是否跳过大模型（用于首屏 150ms 闪电竞速机翻快通道）
    #[serde(default)]
    pub skip_llm: Option<bool>,
}

pub type UniversalTranslateParams = UniversalTranslationRequest;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniversalTranslationResponse {
    pub original: String,
    pub detected_lang: String,
    pub main_translation: String,
    pub engines: Vec<MultiEngineTranslation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    #[serde(default = "default_true")]
    pub enable_blur: bool,
    #[serde(default = "default_blur_amount")]
    pub blur_amount: u8,
    #[serde(default = "default_true")]
    pub enable_transparency: bool,
    #[serde(default = "default_window_opacity")]
    pub window_opacity: u8,
    pub font_family: String,
    pub font_size: String,
}

fn default_true() -> bool {
    true
}
fn default_blur_amount() -> u8 {
    24
}
fn default_window_opacity() -> u8 {
    85
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            enable_blur: true,
            blur_amount: 24,
            enable_transparency: true,
            window_opacity: 85,
            font_family: "system".to_string(),
            font_size: "medium".to_string(),
        }
    }
}

/// 本地备份设置：定期自动备份、保留策略与最近备份时间。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    #[serde(default)]
    pub auto_backup_enabled: Option<bool>,
    /// 自动备份间隔（小时），默认 24。
    #[serde(default)]
    pub interval_hours: Option<u32>,
    /// 本地最多保留的备份份数，超过后淘汰最旧；0 = 不限制，默认 10。
    #[serde(default)]
    pub max_local_backups: Option<u32>,
    /// 最近一次备份时间（epoch 毫秒）。
    #[serde(default)]
    pub last_backup_at_ms: Option<u64>,
    /// 备份包含的内容项清单（"settings" | "api_keys" | "custom_dict" | "history" | "capture_sessions"）。
    #[serde(default)]
    pub included_items: Option<Vec<String>>,
}

/// WebDAV 云同步配置（如坚果云 https://dav.jiangguoyun.com/dav/）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavConfig {
    /// 服务地址，需以 http(s) 开头。
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    /// 应用密码，与现有引擎 API Key 一致明文保存在 settings.json。
    #[serde(default)]
    pub password: Option<String>,
    /// 远端目录（可多级，如 MaobuTranslator），默认 MaobuTranslator。
    #[serde(default)]
    pub remote_dir: Option<String>,
    /// 云端备份保留天数，超过后上传时自动清理，默认 15。
    #[serde(default)]
    pub retention_days: Option<u32>,
    /// 最近一次上传时间（epoch 毫秒）。
    #[serde(default)]
    pub last_upload_at_ms: Option<u64>,
    /// 最近一次上传的备份文件名。
    #[serde(default)]
    pub last_upload_name: Option<String>,
    /// 最近一次从云端恢复的时间（epoch 毫秒）。
    #[serde(default)]
    pub last_restore_at_ms: Option<u64>,
}

/// 默认 OCR 过滤规则集:时间/日期/纯数字百分比/游戏数值条/URL。
/// 用户在设置中自定义规则后整体替换。
pub const DEFAULT_OCR_FILTER_RULES: &[&str] = &[
    r"^\d{1,2}:\d{2}(:\d{2})?$",                 // 时间 12:34 / 12:34:56
    r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$",          // 日期 2026-08-22
    r"^\d+([.,]\d+)?%?$",                          // 纯数字/百分比
    r"^(?i)(HP|MP|SP|EXP|Stamina)\s*[:：]?\s*\d+(/\d+)?%?$", // 游戏数值条
    r"^https?://\S+$",                              // URL
    r"(?i)^(live|直播中|rec)\s*$",                     // 直播角标
];

/// 用户自定义词库词条。作为术语强制表参与所有翻译:
/// 精确命中直接短路出结果,未命中的短语会把相关术语注入 LLM prompt。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomDictItem {
    #[serde(default)]
    pub id: String,
    pub original: String,
    pub translated: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

// 注意：tts_rate 为 f32，不可派生 Eq，仅保留 PartialEq
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub hotkey: String,
    pub spotlight_hotkey: Option<String>,
    pub clipboard_hotkey: Option<String>,
    pub toggle_window_hotkey: Option<String>,
    pub capture_hotkey_enabled: Option<bool>,
    pub spotlight_hotkey_enabled: Option<bool>,
    pub clipboard_hotkey_enabled: Option<bool>,
    pub toggle_window_hotkey_enabled: Option<bool>,
    pub default_preset: String,
    pub llm_config: Option<LlmConfig>,
    /// Multi-model configuration pool. The active model is mirrored in `llm_config`.
    #[serde(default)]
    pub llm_configs: Vec<LlmConfig>,
    pub translation_tiers: Vec<String>,
    pub preset_dicts: PresetDicts,
    pub online_engines: Option<OnlineEngines>,
    pub appearance: Option<AppearanceSettings>,
    /// Capture-overlay engine choice persisted from the frontend selector.
    #[serde(default)]
    pub capture_engine: Option<String>,
    /// 'cover' | 'panel' overlay result presentation.
    #[serde(default)]
    pub overlay_view_mode: Option<String>,
    #[serde(default)]
    pub enable_aabb_avoidance: Option<bool>,
    /// 'literal' | 'free' | 'terminology'.
    #[serde(default)]
    pub translation_style: Option<String>,
    #[serde(default)]
    pub sidebar_collapsed: Option<bool>,
    /// Selection release behaviour: 'adjust' (resize before recognising) | 'auto'.
    #[serde(default)]
    pub capture_release_action: Option<String>,
    /// Region-watch refresh interval in ms (1000–10000, default 3000).
    #[serde(default)]
    pub watch_interval_ms: Option<u32>,
    /// Passive clipboard watch: translate any copied text automatically.
    #[serde(default)]
    pub clipboard_watch_enabled: Option<bool>,
    /// OCR engine preference: "auto" | "onnx" | "winrt"
    #[serde(default)]
    pub ocr_engine: Option<String>,
    /// Selected ONNX OCR model version: "v3" | "v4" | "v5" | "v6" | "v6t"
    #[serde(default)]
    pub ocr_version: Option<String>,
    /// Primary translation engine: "auto" | "dict" | "llm" | "online"
    #[serde(default)]
    pub primary_translation_engine: Option<String>,
    /// 百度翻译开放平台 AppID（官方免费 API，每月 100 万字符）
    #[serde(default)]
    pub baidu_app_id: Option<String>,
    /// 百度翻译开放平台密钥（与 AppID 配合使用）
    #[serde(default)]
    pub baidu_secret: Option<String>,
    /// DeepL 官方免费 API Key（deepl.com 注册，每月 50 万字符）
    #[serde(default)]
    pub deepl_api_key: Option<String>,
    /// 自定义 DeepLX 自建服务地址（如 http://localhost:1188/translate）
    #[serde(default)]
    pub deepl_custom_url: Option<String>,
    /// Window close action: "ask" | "minimize" | "exit" (default "ask")
    #[serde(default)]
    pub close_action: Option<String>,
    /// Mini window (Spotlight) close action: "hide" | "minimize"
    #[serde(default)]
    pub mini_window_close_action: Option<String>,
    /// 主窗口置顶显示（默认关闭）
    #[serde(default)]
    pub always_on_top: Option<bool>,
    /// 手动代理开关：开启后使用 proxy_url，优先于系统代理自动探测
    #[serde(default)]
    pub proxy_enabled: Option<bool>,
    /// 手动代理地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080
    #[serde(default)]
    pub proxy_url: Option<String>,
    /// TTS 朗读语速 (0.5 ~ 2.0，默认 1.0)，由前端 Web Speech API 消费
    #[serde(default)]
    pub tts_rate: Option<f32>,
    /// 截图划词时自动识别前台 3D/CG 软件并切换对应专业词库（默认开启）
    #[serde(default)]
    pub auto_detect_preset: Option<bool>,
    /// OCR 内容过滤:命中规则的识别块(时间戳/纯数字/水印等)不参与翻译(默认开启)
    #[serde(default)]
    pub ocr_filter_enabled: Option<bool>,
    /// 过滤规则(正则,整行匹配一条;无效正则自动跳过)。空 = 使用默认规则集。
    #[serde(default)]
    pub ocr_filter_rules: Option<Vec<String>>,
    /// 无感查词①:在任何应用中拖选/双击选中文字后自动弹出翻译浮窗(默认关闭)
    #[serde(default)]
    pub selection_lookup_enabled: Option<bool>,
    /// 无感查词②:按住修饰键悬停屏幕文字即弹出词卡(默认关闭)
    #[serde(default)]
    pub hover_lookup_enabled: Option<bool>,
    /// 悬停取词的修饰键:"ctrl" | "alt" | "shift"(默认 "ctrl")
    #[serde(default)]
    pub hover_lookup_modifier: Option<String>,
    /// 本地备份设置（自动备份 / 保留策略）
    #[serde(default)]
    pub backup_settings: Option<BackupSettings>,
    /// WebDAV 云同步配置
    #[serde(default)]
    pub webdav_config: Option<WebdavConfig>,
    /// 快慢双流渐进翻译：在线引擎并发大竞速秒出结果，大模型异步精翻无缝升级替换
    #[serde(default)]
    pub enable_llm_progressive_refine: Option<bool>,
    /// 优质生词智能甄选收藏：自动识别专业 3D/CG 术语与 AI 精翻高价值表达并加入收藏
    #[serde(default)]
    pub auto_favorite_quality_terms: Option<bool>,
    /// 用户自定义词库(术语强制表):前端 CRUD,随 settings.json 持久化
    #[serde(default)]
    pub custom_dict_items: Vec<CustomDictItem>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            hotkey: "F4".to_string(),
            spotlight_hotkey: Some("Alt+Space".to_string()),
            clipboard_hotkey: Some("Ctrl+Shift+C".to_string()),
            toggle_window_hotkey: Some("Alt+Q".to_string()),
            capture_hotkey_enabled: Some(true),
            spotlight_hotkey_enabled: Some(false),
            clipboard_hotkey_enabled: Some(false),
            toggle_window_hotkey_enabled: Some(false),
            default_preset: "blender".to_string(),
            auto_detect_preset: Some(true),
            enable_llm_progressive_refine: Some(true),
            auto_favorite_quality_terms: Some(true),
            ocr_filter_enabled: Some(true),
            ocr_filter_rules: None,
            selection_lookup_enabled: Some(false),
            hover_lookup_enabled: Some(false),
            hover_lookup_modifier: Some("ctrl".to_string()),
            llm_config: Some(LlmConfig::new(
                "DeepSeek",
                "",
                "deepseek-chat",
                "https://api.deepseek.com/v1",
            )),
            llm_configs: vec![
                LlmConfig::new(
                    "DeepSeek",
                    "",
                    "deepseek-chat",
                    "https://api.deepseek.com/v1",
                ),
                LlmConfig::new("OpenAI", "", "gpt-4o-mini", "https://api.openai.com/v1"),
                LlmConfig::new("Ollama", "", "llama3", "http://localhost:11434/v1"),
                LlmConfig::new(
                    "智谱 GLM",
                    "",
                    "glm-4-flash",
                    "https://open.bigmodel.cn/api/paas/v4",
                ),
                LlmConfig::new(
                    "Custom",
                    "",
                    "custom-model",
                    "https://api.custom-llm.com/v1",
                ),
            ],
            translation_tiers: vec![
                "Preset Dictionary".to_string(),
                "LLM API".to_string(),
                "Online Fallback".to_string(),
            ],
            preset_dicts: PresetDicts::default(),
            online_engines: Some(OnlineEngines::default()),
            appearance: Some(AppearanceSettings::default()),
            capture_engine: None,
            overlay_view_mode: None,
            enable_aabb_avoidance: None,
            translation_style: None,
            sidebar_collapsed: None,
            capture_release_action: Some("auto".to_string()),
            watch_interval_ms: Some(3000),
            clipboard_watch_enabled: Some(false),
            ocr_engine: None,
            // 默认档：v6Tiny —— 划词/小图实测 100% 全对且最快（平均 7.3ms/张，
            // v4 为 14.3ms）；未装模型时引擎会自动回退到已安装的版本。
            ocr_version: Some("v6t".to_string()),
            primary_translation_engine: None,
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
            close_action: Some("ask".to_string()),
            mini_window_close_action: Some("hide".to_string()),
            always_on_top: Some(false),
            proxy_enabled: Some(false),
            proxy_url: None,
            tts_rate: Some(1.0),
            backup_settings: None,
            webdav_config: None,
            custom_dict_items: Vec::new(),
        }
    }
}
