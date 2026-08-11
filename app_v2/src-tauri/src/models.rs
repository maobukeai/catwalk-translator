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

/// Runtime status of the native RapidOCR daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrEngineStatus {
    /// idle | warming | ready | failed
    pub status: String,
    pub detail: String,
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
    /// Foreground (text) colour: "#ffffff" or "#141417"
    pub fg_css: String,
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniversalTranslationRequest {
    pub text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub preset: Option<String>,
    pub llm_config: Option<LlmConfig>,
    pub preset_dicts: Option<PresetDicts>,
    pub online_engines: Option<OnlineEngines>,
    pub translation_tiers: Option<Vec<String>>,
}

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
            theme: "fluent-dark".to_string(),
            enable_blur: true,
            blur_amount: 24,
            enable_transparency: true,
            window_opacity: 85,
            font_family: "system".to_string(),
            font_size: "medium".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "fluent-dark".to_string(),
            hotkey: "Ctrl+Alt+D".to_string(),
            spotlight_hotkey: Some("Alt+Space".to_string()),
            clipboard_hotkey: Some("Ctrl+Shift+C".to_string()),
            toggle_window_hotkey: Some("Alt+Q".to_string()),
            capture_hotkey_enabled: Some(true),
            spotlight_hotkey_enabled: Some(true),
            clipboard_hotkey_enabled: Some(true),
            toggle_window_hotkey_enabled: Some(true),
            default_preset: "blender".to_string(),
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
        }
    }
}
