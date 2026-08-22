pub use crate::models::{
    AppSettings, BoundingBox, CaptureSession, CaptureSessionBlock, ColorSample, HistoryItem,
    LlmConfig, MultiEngineTranslation, OcrResult, OnlineEngines, OverlayBlock, OverlayResult,
    PhysicalRect, PresetDicts, TextBlock, TextQueryResponse, TranslationResult,
    UniversalTranslationRequest, UniversalTranslationResponse, WordDetail,
};
use std::sync::Mutex;
use tauri::{Manager, State};


// 命令按领域拆分到子模块,统一从这里 re-export,lib.rs 注册表无需感知拆分
pub use crate::commands_capture::*;
pub use crate::commands_chat::*;
pub use crate::commands_history::*;
#[tauri::command]
pub async fn cmd_universal_translate(
    state: State<'_, AppState>,
    req: UniversalTranslationRequest,
) -> Result<UniversalTranslationResponse, String> {
    let glossary = state
        .settings
        .lock()
        .ok()
        .map(|s| crate::translator::glossary_from_settings(&s.custom_dict_items))
        .unwrap_or_default();
    crate::translator::execute_universal_translate(req, &glossary).await
}


use std::fs;
use std::path::PathBuf;

pub fn get_app_config_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    if let Ok(dir) = app_handle.path().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        return dir;
    }
    let fallback = std::env::temp_dir().join("cg_translator_config");
    let _ = fs::create_dir_all(&fallback);
    fallback
}

/// 把前端 canvas 生成的 PNG dataURL 保存到 图片库/猫步翻译/exports/（译文导出图片）。
#[tauri::command]
pub async fn cmd_save_export_png(
    app_handle: tauri::AppHandle,
    data_url: String,
    suggested_name: String,
) -> Result<String, String> {
    use base64::Engine as _;
    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("仅支持 PNG dataURL")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("PNG 解码失败: {}", e))?;
    if bytes.len() < 100 {
        return Err("导出内容为空".to_string());
    }
    let dir = pictures_export_dir(&app_handle);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建导出目录失败: {}", e))?;
    let safe = suggested_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let name = if safe.is_empty() {
        format!("export_{}.png", crate::backup::backup_timestamp_string())
    } else {
        format!("{}_{}.png", safe, crate::backup::backup_timestamp_string())
    };
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| format!("写入 PNG 失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

fn pictures_export_dir(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    app_handle
        .path()
        .picture_dir()
        .map(|d| d.join("猫步翻译").join("exports"))
        .unwrap_or_else(|_| std::env::temp_dir().join("maobu_exports"))
}

pub fn save_settings_file(app_handle: &tauri::AppHandle, settings: &AppSettings) {
    let path = get_app_config_dir(app_handle).join("settings.json");
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        if let Err(e) = fs::write(&path, json) {
            // 设置（含 API Key）落盘失败必须留下痕迹，否则用户会误以为已保存成功
            eprintln!("[settings] 写入失败 {}: {}", path.display(), e);
        }
    } else {
        eprintln!("[settings] 序列化失败: {:?}", path);
    }
}

pub fn load_settings_file(app_handle: &tauri::AppHandle) -> AppSettings {
    let path = get_app_config_dir(app_handle).join("settings.json");
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
    }
    let default_s = AppSettings::default();
    save_settings_file(app_handle, &default_s);
    default_s
}

pub fn save_history_file(app_handle: &tauri::AppHandle, history: &[HistoryItem]) {
    let path = get_app_config_dir(app_handle).join("history.json");
    if let Ok(json) = serde_json::to_string_pretty(history) {
        if let Err(e) = fs::write(&path, json) {
            eprintln!("[history] 写入失败 {}: {}", path.display(), e);
        }
    }
}

pub fn load_history_file(app_handle: &tauri::AppHandle) -> Vec<HistoryItem> {
    let path = get_app_config_dir(app_handle).join("history.json");
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(hist) = serde_json::from_str::<Vec<HistoryItem>>(&content) {
                return hist;
            }
        }
    }
    vec![]
}

pub fn save_capture_sessions_file(app_handle: &tauri::AppHandle, sessions: &[CaptureSession]) {
    let path = get_app_config_dir(app_handle).join("capture_sessions.json");
    if let Ok(json) = serde_json::to_string_pretty(sessions) {
        if let Err(e) = fs::write(&path, json) {
            eprintln!("[capture_sessions] 写入失败 {}: {}", path.display(), e);
        }
    }
}

fn load_capture_sessions_file(app_handle: &tauri::AppHandle) -> Vec<CaptureSession> {
    let path = get_app_config_dir(app_handle).join("capture_sessions.json");
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str::<Vec<CaptureSession>>(&content) {
                return s;
            }
        }
    }
    vec![]
}

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub history: Mutex<Vec<HistoryItem>>,
    pub capture_sessions: Mutex<Vec<CaptureSession>>,
}

impl AppState {
    pub fn load_from_disk(app_handle: &tauri::AppHandle) -> Self {
        let settings = load_settings_file(app_handle);
        let history = load_history_file(app_handle);
        let capture_sessions = load_capture_sessions_file(app_handle);
        Self {
            settings: Mutex::new(settings),
            history: Mutex::new(history),
            capture_sessions: Mutex::new(capture_sessions),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(AppSettings::default()),
            history: Mutex::new(vec![]),
            capture_sessions: Mutex::new(vec![]),
        }
    }
}



#[tauri::command]
pub async fn cmd_translate_phrases(
    state: State<'_, AppState>,
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<Vec<TranslationResult>, String> {
    if phrases.is_empty() {
        return Ok(vec![]);
    }

    let pipeline = crate::translator::shared_pipeline();
    let glossary = state
        .settings
        .lock()
        .ok()
        .map(|s| crate::translator::glossary_from_settings(&s.custom_dict_items))
        .unwrap_or_default();

    let results = pipeline
        .translate_phrases(&phrases, &preset, llm_config.as_ref(), &glossary)
        .await;
    Ok(results)
}

/// Style-aware variant used by the capture overlay: same pipeline as
/// `cmd_translate_phrases` but forwards the user's translation style
/// ("literal" | "free" | "terminology") into LLM prompts.
#[tauri::command]
pub async fn cmd_translate_phrases_styled(
    state: State<'_, AppState>,
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
    style: Option<String>,
) -> Result<Vec<TranslationResult>, String> {
    if phrases.is_empty() {
        return Ok(vec![]);
    }

    let pipeline = crate::translator::shared_pipeline();
    let glossary = state
        .settings
        .lock()
        .ok()
        .map(|s| crate::translator::glossary_from_settings(&s.custom_dict_items))
        .unwrap_or_default();

    let results = pipeline
        .translate_phrases_styled(&phrases, &preset, llm_config.as_ref(), style.as_deref(), &glossary)
        .await;
    Ok(results)
}


/// Decide whether native DWM Acrylic should be ON for the main window.
/// The user's frosted-glass toggle is the single source of truth — any theme
/// can be glassy; theme only picks the color palette.
pub fn glass_enabled_for_settings(settings: &AppSettings) -> bool {
    match &settings.appearance {
        Some(ap) => ap.enable_blur && ap.enable_transparency,
        None => true,
    }
}

/// Decide whether the active theme is a dark theme.
pub fn is_dark_for_settings(settings: &AppSettings) -> bool {
    let theme_str = settings
        .appearance
        .as_ref()
        .map(|a| a.theme.as_str())
        .unwrap_or(settings.theme.as_str());
    !matches!(theme_str, "light" | "fluent-light")
}

/// Toggle native Windows DWM Acrylic blur on the main window at runtime.
#[tauri::command]
pub async fn cmd_set_window_blur(
    window: tauri::WebviewWindow,
    enable: Option<bool>,
    is_dark: Option<bool>,
) -> Result<(), String> {
    let enable = enable.unwrap_or(true);
    let is_dark = is_dark.unwrap_or(true);
    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(&window, enable, is_dark);
    Ok(())
}

/// 设置生效后的运行时副作用：重注册全局快捷键、同步 DWM 模糊、启停剪贴板监听。
/// cmd_save_settings 与备份恢复管线共用。
pub fn apply_settings_side_effects(
    app_handle: &tauri::AppHandle,
    window: Option<&tauri::WebviewWindow>,
    settings: &AppSettings,
) {
    // Dynamically re-register all 4 user updated hotkeys with OS
    if let Err(err) = crate::register_all_user_shortcuts(app_handle, settings) {
        eprintln!(">>> Warning when registering global shortcuts: {}", err);
    }

    // Sync native DWM Acrylic with the freshly saved appearance settings
    if let Some(win) = window {
        #[cfg(target_os = "windows")]
        crate::set_windows_dwm_blur(
            win,
            glass_enabled_for_settings(settings),
            is_dark_for_settings(settings),
        );
    }

    // Passive clipboard watch follows the saved setting (default off)
    if settings.clipboard_watch_enabled.unwrap_or(false) {
        crate::clipboard_watch::start_clipboard_watch(app_handle.clone());
    } else {
        crate::clipboard_watch::stop_clipboard_watch();
    }

    // 无感查词(划词即弹窗 / 悬停取词):任一开启则启动监控线程
    if settings.selection_lookup_enabled.unwrap_or(false)
        || settings.hover_lookup_enabled.unwrap_or(false)
    {
        crate::lookup_monitor::start_lookup_monitor(app_handle.clone());
    } else {
        crate::lookup_monitor::stop_lookup_monitor();
    }

    // 手动代理优先于系统代理自动探测；关闭或地址为空时回落自动探测
    let manual_proxy = if settings.proxy_enabled.unwrap_or(false) {
        settings
            .proxy_url
            .clone()
            .filter(|u| !u.trim().is_empty())
    } else {
        None
    };
    crate::translator::set_manual_proxy(manual_proxy);

    // 主窗口置顶跟随设置
    if let Some(win) = window {
        let _ = win.set_always_on_top(settings.always_on_top.unwrap_or(false));
    }
}

#[tauri::command]
pub async fn cmd_save_settings(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    eprintln!(
        ">>> cmd_save_settings CALLED! hotkey = '{}', appearance = {:?}",
        settings.hotkey, settings.appearance
    );

    let mut lock = state
        .settings
        .lock()
        .map_err(|e| format!("Failed to lock settings: {}", e))?;

    let main_window = app_handle.get_webview_window("main");
    apply_settings_side_effects(&app_handle, main_window.as_ref(), &settings);

    *lock = settings.clone();
    save_settings_file(&app_handle, &settings);

    eprintln!(">>> Settings saved successfully to disk.");
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let lock = state
        .settings
        .lock()
        .map_err(|e| format!("Failed to lock settings: {}", e))?;
    Ok(lock.clone())
}

#[tauri::command]
pub async fn cmd_query_text(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    text: String,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<TextQueryResponse, String> {
    if text.trim().is_empty() {
        return Ok(TextQueryResponse {
            original: text,
            word_detail: None,
            results: vec![],
        });
    }

    let pipeline = crate::translator::shared_pipeline();
    let glossary = state
        .settings
        .lock()
        .ok()
        .map(|s| crate::translator::glossary_from_settings(&s.custom_dict_items))
        .unwrap_or_default();

    let mut res = pipeline
        .query_text_detail(&text, &preset, llm_config.as_ref(), &glossary)
        .await;

    // 通用离线词典（ECDICT）增强：CG 词库未命中且是单词/短语时注入离线结果，
    // 并用真实音标与中文释义补全词卡。已安装词典前查普通单词完全离线秒出。
    let cg_dict_hit = res
        .results
        .iter()
        .any(|r| r.engine_name.contains("离线词库") || r.engine_name.contains("通用离线词典 ("));
    if !cg_dict_hit {
        if let Some(hit) = crate::general_dict::lookup(&app_handle, text.trim()) {
            if !hit.definitions.is_empty() {
                let translated = hit.definitions.join("；");
                res.results.insert(
                    0,
                    MultiEngineTranslation {
                        engine_name: "通用离线词典 (ECDICT)".to_string(),
                        translated: translated.clone(),
                        source_tier: "Offline ECDICT".to_string(),
                    },
                );
                if let Some(wd) = res.word_detail.as_mut() {
                    if !hit.phonetic.is_empty() {
                        wd.phonetic_us = format!("/ {} /", hit.phonetic);
                        wd.phonetic_uk = format!("/ {} /", hit.phonetic);
                    }
                    wd.definition = translated;
                    wd.cg_domain_note = "通用离线词典 (ECDICT · 离线可用)".to_string();
                }
            }
        }
    }
    Ok(res)
}

#[tauri::command]
pub async fn cmd_offline_install() -> Result<crate::models::OfflineModelStatus, String> {
    crate::offline::install_offline()
}

#[tauri::command]
pub async fn cmd_offline_uninstall() -> Result<crate::models::OfflineModelStatus, String> {
    crate::offline::uninstall_offline()
}

#[tauri::command]
pub async fn cmd_offline_status() -> Result<crate::models::OfflineModelStatus, String> {
    Ok(crate::offline::status())
}


/// Report the runtime status of the RapidOCR daemon (idle / warming / ready / failed).
#[tauri::command]
pub async fn cmd_ocr_engine_status() -> Result<crate::models::OcrEngineStatus, String> {
    Ok(crate::ocr::runtime_status())
}


pub struct TestReportFormatter;

impl TestReportFormatter {
    pub fn format_summary(settings: &AppSettings) -> String {
        format!(
            "Theme: {}, Preset: {}, Hotkey: {}",
            settings.theme, settings.default_preset, settings.hotkey
        )
    }
}

pub struct EnvironmentChecker;

impl EnvironmentChecker {
    pub fn check_runtime_environment(settings: &AppSettings) -> bool {
        settings.llm_config.is_some() && !settings.translation_tiers.is_empty()
    }
}


#[tauri::command]
pub fn cmd_exit_app(app: tauri::AppHandle) {
    crate::translator::shared_pipeline().cache.save_to_disk();
    app.exit(0);
}
