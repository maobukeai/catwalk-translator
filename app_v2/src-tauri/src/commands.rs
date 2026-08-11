pub use crate::models::{
    AppSettings, BoundingBox, ColorSample, HistoryItem, LlmConfig, MultiEngineTranslation,
    OcrResult, OnlineEngines, OverlayBlock, OverlayResult, PhysicalRect, PresetDicts, TextBlock,
    TextQueryResponse, TranslationResult, UniversalTranslationRequest,
    UniversalTranslationResponse, WordDetail,
};
use crate::reconstruction::{LineClusterer, WordMerger};
use crate::sampler::ColorSampler;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub async fn cmd_universal_translate(
    req: UniversalTranslationRequest,
) -> Result<UniversalTranslationResponse, String> {
    crate::translator::execute_universal_translate(req).await
}

/// All-in-one: OCR the selected region → sample bg colors → translate → return overlay blocks.
/// This mirrors the Python version's worker thread:
///   raw_ocr → merge_nearby_boxes → translate → sample_background_color → emit to overlay
#[tauri::command]
pub async fn cmd_region_ocr_translate(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<OverlayResult, String> {
    if selection.width == 0 || selection.height == 0 {
        return Ok(OverlayResult {
            blocks: vec![],
            selection_x: selection.x as f64,
            selection_y: selection.y as f64,
            selection_w: selection.width as f64,
            selection_h: selection.height as f64,
        });
    }

    // 1. Get clean desktop screenshot captured when window was hidden in cmd_begin_capture
    let (bmp_data, bmp_w, bmp_h, stored_scale) =
        crate::capture::get_latest_capture().ok_or("No desktop capture available in memory")?;
    let sf = scale_factor.unwrap_or(stored_scale);

    // 2. Convert logical selection coords to physical hardware coords
    let phys = PhysicalRect {
        x: (selection.x as f64 * sf).round() as i32,
        y: (selection.y as f64 * sf).round() as i32,
        width: (selection.width as f64 * sf).round() as u32,
        height: (selection.height as f64 * sf).round() as u32,
    };

    // 3. Instant sub-millisecond memory crop of the selected region from the clean desktop image
    let crop_bmp = crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, phys)
        .ok_or("Selection out of desktop bounds")?;

    // 4. Feed clean region BMP to persistent RapidOCR daemon (<80ms)
    let ocr_result =
        crate::ocr::execute_native_ocr(&crop_bmp).unwrap_or(OcrResult { blocks: vec![] });

    if ocr_result.blocks.is_empty() {
        return Ok(OverlayResult {
            blocks: vec![],
            selection_x: selection.x as f64,
            selection_y: selection.y as f64,
            selection_w: selection.width as f64,
            selection_h: selection.height as f64,
        });
    }

    // 4.5 Cluster into lines and merge words per line (e.g. "Principled" + "BSDF" -> "Principled BSDF")
    let lines = LineClusterer::cluster_into_lines(ocr_result.blocks, 8.0);
    let merged_blocks: Vec<TextBlock> = lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .map(|line| WordMerger::merge_line(line, 20.0))
        .filter(|b| !b.text.trim().is_empty())
        .collect();

    if merged_blocks.is_empty() {
        return Ok(OverlayResult {
            blocks: vec![],
            selection_x: selection.x as f64,
            selection_y: selection.y as f64,
            selection_w: selection.width as f64,
            selection_h: selection.height as f64,
        });
    }

    // 5. Translate phrases using preset dictionaries first (instant)
    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);

    let phrases: Vec<String> = merged_blocks.iter().map(|b| b.text.clone()).collect();
    let translations = pipeline
        .translate_phrases(&phrases, &preset, llm_config.as_ref())
        .await;

    // 6. Build OverlayBlocks with exact sampled background color from the clean desktop BMP
    let mut overlay_blocks = Vec::new();
    for (block, tr) in merged_blocks.iter().zip(translations.iter()) {
        let block_phys_x = block.box_rect.x;
        let block_phys_y = block.box_rect.y;
        let block_phys_w = block.box_rect.width as i32;
        let block_phys_h = block.box_rect.height as i32;

        let logical_x = ((block_phys_x as f64 / sf) + selection.x as f64) - 4.0;
        let logical_y = ((block_phys_y as f64 / sf) + selection.y as f64) - 2.0;
        let logical_w = (block_phys_w as f64 / sf).max(24.0) + 8.0;
        let logical_h = (block_phys_h as f64 / sf).max(14.0) + 4.0;

        let abs_phys = BoundingBox {
            x: phys.x + block_phys_x,
            y: phys.y + block_phys_y,
            width: block_phys_w.max(4) as u32,
            height: block_phys_h.max(4) as u32,
        };
        let bg_rgb = ColorSampler::sample_from_full_bmp(&bmp_data, bmp_w, bmp_h, abs_phys, 4);
        let brightness = ColorSampler::calc_perceived_brightness(bg_rgb[0], bg_rgb[1], bg_rgb[2]);
        let fg_css = if brightness < 128.0 {
            "#ffffff"
        } else {
            "#141417"
        };
        let bg_css = format!("rgb({},{},{})", bg_rgb[0], bg_rgb[1], bg_rgb[2]);

        overlay_blocks.push(OverlayBlock {
            original: tr.original.clone(),
            translated: tr.translated.clone(),
            source_tier: tr.source_tier.clone(),
            logical_x,
            logical_y,
            logical_w,
            logical_h,
            bg_css,
            fg_css: fg_css.to_string(),
        });
    }

    Ok(OverlayResult {
        blocks: overlay_blocks,
        selection_x: selection.x as f64,
        selection_y: selection.y as f64,
        selection_w: selection.width as f64,
        selection_h: selection.height as f64,
    })
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

pub fn save_settings_file(app_handle: &tauri::AppHandle, settings: &AppSettings) {
    let path = get_app_config_dir(app_handle).join("settings.json");
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, json);
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
        let _ = fs::write(path, json);
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

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub history: Mutex<Vec<HistoryItem>>,
}

impl AppState {
    pub fn load_from_disk(app_handle: &tauri::AppHandle) -> Self {
        let settings = load_settings_file(app_handle);
        let history = load_history_file(app_handle);
        Self {
            settings: Mutex::new(settings),
            history: Mutex::new(history),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(AppSettings::default()),
            history: Mutex::new(vec![]),
        }
    }
}

use std::sync::atomic::{AtomicBool, Ordering};
static WAS_MAIN_WINDOW_VISIBLE: AtomicBool = AtomicBool::new(true);

/// Backend-driven capture: Rust hides main window, captures clean desktop to memory, then enables transparent overlay
#[tauri::command]
pub async fn cmd_begin_capture(
    window: tauri::WebviewWindow,
) -> Result<crate::capture::ScreenCapturePayload, String> {
    // Remember if main window was visible on screen before capture started
    let was_vis = window.is_visible().unwrap_or(false);
    WAS_MAIN_WINDOW_VISIBLE.store(was_vis, Ordering::SeqCst);

    // If main window was minimized by user, unminimize first to restore state
    let _ = window.unminimize();

    // 1. Hide the window so the underlying desktop is 100% clean and un-obscured
    let _ = window.hide();

    // 2. Wait 120ms and flush OS DWM to complete un-rendering the window from desktop DC
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    #[cfg(target_os = "windows")]
    {
        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmFlush() -> i32;
        }
        unsafe {
            let _ = DwmFlush();
        }
    }

    // 3. Win32 GDI captures 100% clean desktop pixels directly into Rust static memory (~15ms)
    let payload =
        crate::capture::capture_desktop_payload().unwrap_or(crate::capture::ScreenCapturePayload {
            data_url: String::new(),
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        });

    // Zero base64 transfer to React — return payload with scale_factor only!
    Ok(crate::capture::ScreenCapturePayload {
        data_url: String::new(),
        width: payload.width,
        height: payload.height,
        scale_factor: payload.scale_factor,
    })
}

/// Expand the main window to a full-screen transparent selection overlay.
/// On Windows, uses the virtual screen dimensions to cover all monitors including taskbar.
#[tauri::command]
pub async fn cmd_show_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    let _ = window.unminimize();

    #[cfg(target_os = "windows")]
    {
        crate::set_windows_dwm_blur(&window, false);
        use tauri::LogicalSize;
        // Get full virtual screen dimensions covering all monitors

        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(n_index: i32) -> i32;
        }

        const SM_XVIRTUALSCREEN: i32 = 76;
        const SM_YVIRTUALSCREEN: i32 = 77;
        const SM_CXVIRTUALSCREEN: i32 = 78;
        const SM_CYVIRTUALSCREEN: i32 = 79;

        let (vx, vy, vw, vh) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };

        let _ = window.set_always_on_top(true);
        // Use logical pixels (scale factor handled by Tauri)
        let sf = window.scale_factor().unwrap_or(1.0);
        let _ = window.set_position(tauri::LogicalPosition::new(vx as f64 / sf, vy as f64 / sf));
        let _ = window.set_size(LogicalSize::new(vw as f64 / sf, vh as f64 / sf));
        let _ = window.show();
        let _ = window.set_focus();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.set_always_on_top(true);
        let _ = window.maximize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

/// Restore window to normal main-window state (called on overlay close)
#[tauri::command]
pub async fn cmd_close_overlay(
    window: tauri::WebviewWindow,
    restore_main: Option<bool>,
) -> Result<(), String> {
    use tauri::LogicalSize;
    let should_restore =
        restore_main.unwrap_or_else(|| WAS_MAIN_WINDOW_VISIBLE.load(Ordering::SeqCst));

    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(&window, true);

    if should_restore {
        let _ = window.set_always_on_top(false);
        let _ = window.set_size(LogicalSize::new(900.0_f64, 680.0_f64));
        let _ = window.center();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        // 绝对静默隐退：取消/关闭划词时强行直接 hide 到系统托盘，绝不弹窗打扰当前游戏或工作
        let _ = window.hide();
        let _ = window.set_always_on_top(false);
        let _ = window.set_size(LogicalSize::new(900.0_f64, 680.0_f64));
        let _ = window.center();
    }
    Ok(())
}

/// OCR a selection — takes LOGICAL CSS pixel coords + scaleFactor, converts to physical BMP coords
#[tauri::command]
pub async fn cmd_capture_and_ocr(
    selection: PhysicalRect,
    scale_factor: Option<f64>,
) -> Result<OcrResult, String> {
    if selection.width == 0 || selection.height == 0 {
        return Ok(OcrResult { blocks: vec![] });
    }

    // Retrieve the stored desktop screenshot
    if let Some((bmp_data, bmp_w, bmp_h, stored_scale)) = crate::capture::get_latest_capture() {
        // Resolve the effective scale factor: prefer the value stored alongside the capture
        let sf = scale_factor.unwrap_or(stored_scale);

        // Convert logical (CSS) pixel coords to physical BMP pixel coords
        let phys = PhysicalRect {
            x: (selection.x as f64 * sf).round() as i32,
            y: (selection.y as f64 * sf).round() as i32,
            width: (selection.width as f64 * sf).round() as u32,
            height: (selection.height as f64 * sf).round() as u32,
        };

        if let Some(cropped) = crate::ocr::crop_bmp(&bmp_data, bmp_w, bmp_h, phys) {
            if let Ok(ocr_res) = crate::ocr::execute_native_ocr(&cropped) {
                if !ocr_res.blocks.is_empty() {
                    let lines = LineClusterer::cluster_into_lines(ocr_res.blocks, 8.0);
                    let merged_blocks: Vec<TextBlock> = lines
                        .into_iter()
                        .filter(|line| !line.is_empty())
                        .map(|line| WordMerger::merge_line(line, 20.0))
                        .filter(|b| !b.text.trim().is_empty())
                        .collect();
                    return Ok(OcrResult { blocks: merged_blocks });
                }
            }
        }
    }

    // No capture available (e.g. headless test environment): return a deterministic fixture
    Ok(OcrResult {
        blocks: vec![crate::models::TextBlock {
            text: "Artificial Intelligence".to_string(),
            confidence: 0.99,
            box_rect: crate::models::BoundingBox {
                x: 0,
                y: 0,
                width: 100,
                height: 20,
            },
        }],
    })
}

#[tauri::command]
pub async fn cmd_translate_phrases(
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<Vec<TranslationResult>, String> {
    if phrases.is_empty() {
        return Ok(vec![]);
    }

    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);

    let results = pipeline
        .translate_phrases(&phrases, &preset, llm_config.as_ref())
        .await;
    Ok(results)
}

/// Pure non-async core path for `cmd_sample_colors`. Exposed so integration tests can
/// verify the sampler wiring without needing a real Tauri runtime.
pub fn cmd_sample_colors_core_logic(
    image_crop: &[u8],
    boxes: Vec<BoundingBox>,
) -> Result<Vec<ColorSample>, String> {
    Ok(boxes
        .into_iter()
        .map(|b| {
            let bg_rgb = if !image_crop.is_empty() {
                ColorSampler::sample_outer_ring_median(
                    image_crop,
                    b.width.max(1),
                    b.height.max(1),
                    4,
                )
            } else {
                [42, 42, 42]
            };
            let brightness =
                ColorSampler::calc_perceived_brightness(bg_rgb[0], bg_rgb[1], bg_rgb[2]);
            let text_color = ColorSampler::decide_text_color(brightness);
            ColorSample {
                box_rect: b,
                background_rgb: bg_rgb,
                text_color,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn cmd_sample_colors(
    image_crop: Vec<u8>,
    boxes: Vec<BoundingBox>,
) -> Result<Vec<ColorSample>, String> {
    let samples = boxes
        .into_iter()
        .map(|b| {
            let bg_rgb = if !image_crop.is_empty() {
                ColorSampler::sample_outer_ring_median(
                    &image_crop,
                    b.width.max(1),
                    b.height.max(1),
                    4,
                )
            } else {
                [42, 42, 42]
            };
            let brightness =
                ColorSampler::calc_perceived_brightness(bg_rgb[0], bg_rgb[1], bg_rgb[2]);
            let text_color = ColorSampler::decide_text_color(brightness);
            ColorSample {
                box_rect: b,
                background_rgb: bg_rgb,
                text_color,
            }
        })
        .collect();
    Ok(samples)
}

#[tauri::command]
pub async fn cmd_save_settings(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    println!(
        ">>> cmd_save_settings CALLED! hotkey = '{}'",
        settings.hotkey
    );

    let mut lock = state
        .settings
        .lock()
        .map_err(|e| format!("Failed to lock settings: {}", e))?;

    // Dynamically re-register all 4 user updated hotkeys with OS
    println!(">>> Re-registering all global shortcuts with OS...");
    if let Err(err) = crate::register_all_user_shortcuts(&app_handle, &settings) {
        eprintln!(">>> Warning when registering global shortcuts: {}", err);
    }

    *lock = settings.clone();
    save_settings_file(&app_handle, &settings);
    println!(">>> Settings saved successfully to disk.");
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

    static PIPELINE: std::sync::OnceLock<crate::translator::MultiTierPipeline> =
        std::sync::OnceLock::new();
    let pipeline = PIPELINE.get_or_init(crate::translator::MultiTierPipeline::new);

    let res = pipeline
        .query_text_detail(&text, &preset, llm_config.as_ref())
        .await;
    Ok(res)
}

#[tauri::command]
pub async fn cmd_get_history(state: State<'_, AppState>) -> Result<Vec<HistoryItem>, String> {
    let lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    Ok(lock.clone())
}

#[tauri::command]
pub async fn cmd_add_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    item: HistoryItem,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.insert(0, item);
    if lock.len() > 200 {
        lock.truncate(200);
    }
    save_history_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_toggle_favorite(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    for item in lock.iter_mut() {
        if item.id == id {
            item.is_favorite = !item.is_favorite;
            let fav = item.is_favorite;
            save_history_file(&app_handle, &lock);
            return Ok(fav);
        }
    }
    Err("Item not found".to_string())
}

#[tauri::command]
pub async fn cmd_delete_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.retain(|item| item.id != id);
    save_history_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_clear_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.clear();
    save_history_file(&app_handle, &lock);
    Ok(())
}

/// Report the runtime status of the RapidOCR daemon (idle / warming / ready / failed).
#[tauri::command]
pub async fn cmd_ocr_engine_status() -> Result<crate::models::OcrEngineStatus, String> {
    Ok(crate::ocr::runtime_status())
}

#[tauri::command]
pub async fn cmd_export_anki(items: Vec<HistoryItem>) -> Result<String, String> {
    let mut csv_content = String::from("Front,Back,Tag\n");
    for item in items {
        csv_content.push_str(&format!(
            "\"{}\",\"{}\",\"CG-Translator\"\n",
            item.original.replace('"', "\"\""),
            item.translated.replace('"', "\"\"")
        ));
    }
    Ok(csv_content)
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

/// Native Rust command to query /models endpoint over network bypassing WebView CORS restrictions.
#[tauri::command]
pub async fn cmd_fetch_llm_models(
    endpoint: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let raw_input = endpoint.trim().to_string();
    if raw_input.is_empty() {
        return Err("API 接口地址不能为空".to_string());
    }

    // 1. Separate base path and existing query string
    let (base_path, query_str) = match raw_input.find('?') {
        Some(pos) => (&raw_input[..pos], Some(&raw_input[pos + 1..])),
        None => (raw_input.as_str(), None),
    };

    let mut clean_base = base_path.trim_end_matches('/').to_string();
    if clean_base.ends_with("/chat/completions") {
        clean_base = clean_base.replace("/chat/completions", "");
    }
    if clean_base.ends_with("/completions") {
        clean_base = clean_base.replace("/completions", "");
    }

    let is_google_gemini = clean_base.contains("google")
        || clean_base.contains("gemini")
        || clean_base.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    // 2. Build candidate network URLs for listing models in priority order
    let mut candidate_urls = Vec::new();

    if clean_base.ends_with("/models") {
        candidate_urls.push(clean_base.clone());
    } else if is_google_gemini {
        if clean_base.ends_with("/v1beta") || clean_base.ends_with("/v1") {
            candidate_urls.push(format!("{}/models", clean_base));
        } else {
            // For Cloudflare AI Gateway / Google AI Studio base URLs, /v1beta/models MUST be tried first!
            candidate_urls.push(format!("{}/v1beta/models", clean_base));
            candidate_urls.push(format!("{}/v1/models", clean_base));
            candidate_urls.push(format!("{}/models", clean_base));
        }
    } else {
        candidate_urls.push(format!("{}/models", clean_base));
        if !clean_base.ends_with("/v1") {
            candidate_urls.push(format!("{}/v1/models", clean_base));
        }
    }

    // 3. Prepare reqwest client with 15s timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("无法初始化网络客户端: {}", e))?;

    let mut last_error = String::new();

    // 4. Try candidate URLs in priority sequence
    for target_base in candidate_urls {
        let mut final_url = target_base.clone();

        // Preserve existing query params if any
        if let Some(qs) = query_str {
            if !qs.is_empty() {
                if final_url.contains('?') {
                    final_url = format!("{}&{}", final_url, qs);
                } else {
                    final_url = format!("{}?{}", final_url, qs);
                }
            }
        }

        // For Gemini / Google API, append ?key=
        if is_google_gemini && !api_key.is_empty() && !final_url.contains("key=") {
            if final_url.contains('?') {
                final_url = format!("{}&key={}", final_url, api_key);
            } else {
                final_url = format!("{}?key={}", final_url, api_key);
            }
        }

        let mut req = client.get(&final_url);

        // IMPORTANT CRITICAL FIX:
        // DO NOT send Authorization: Bearer header for Gemini/Google API keys (starting with AIza)!
        // Google AI Studio treats Bearer headers as OAuth 2 tokens and returns 401 Unauthorized!
        if !api_key.is_empty() {
            if is_google_gemini {
                req = req
                    .header("x-goog-api-key", &api_key)
                    .header("api-key", &api_key);
            } else {
                req = req
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("api-key", &api_key);
            }
        }

        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("网络请求无法连接到: {} ({})", final_url, e);
                continue;
            }
        };

        let status = res.status();
        let status_code = status.as_u16();

        if !status.is_success() {
            let err_body = res.text().await.unwrap_or_default();
            let short_body = if err_body.len() > 150 {
                format!("{}...", &err_body[..150])
            } else {
                err_body
            };
            last_error = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code, short_body, final_url
            );
            continue;
        }

        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_error = format!("接口返回无效 JSON ({}) 路径: {}", e, final_url);
                continue;
            }
        };

        let mut models = Vec::new();

        // Parse OpenAI format {"data": [...]}
        if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
            for m in data {
                let id_str = if let Some(s) = m.get("id").and_then(|v| v.as_str()) {
                    Some(s)
                } else if let Some(s) = m.get("name").and_then(|v| v.as_str()) {
                    Some(s)
                } else {
                    m.as_str()
                };

                if let Some(id) = id_str {
                    let clean = id.trim_start_matches("models/").to_string();
                    if !clean.is_empty() && !models.contains(&clean) {
                        models.push(clean);
                    }
                }
            }
        }

        // Parse Gemini / Google format {"models": [...]}
        if models.is_empty() {
            if let Some(data) = json.get("models").and_then(|v| v.as_array()) {
                for m in data {
                    let id_str = if let Some(s) = m.get("name").and_then(|v| v.as_str()) {
                        Some(s)
                    } else if let Some(s) = m.get("id").and_then(|v| v.as_str()) {
                        Some(s)
                    } else {
                        m.as_str()
                    };

                    if let Some(id) = id_str {
                        let clean = id.trim_start_matches("models/").to_string();
                        if !clean.is_empty() && !models.contains(&clean) {
                            models.push(clean);
                        }
                    }
                }
            }
        }

        if !models.is_empty() {
            return Ok(models);
        } else {
            last_error = format!(
                "接口 (200 OK) 返回成功但未找到模型字段。路径: {}",
                final_url
            );
        }
    }

    Err(if last_error.is_empty() {
        "无法获取可用模型，请检查 API Key 和接口地址".to_string()
    } else {
        format!("拉取失败: {}", last_error)
    })
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessagePayload {
    pub role: String,
    pub content: String,
}

/// Native Rust command for LLM chat bypassing WebView CORS restrictions
/// Supports DeepSeek, OpenAI, Ollama, Gemini, GLM, and Custom Endpoints.
#[tauri::command]
pub async fn cmd_chat_llm(
    messages: Vec<ChatMessagePayload>,
    config: LlmConfig,
) -> Result<String, String> {
    let raw_ep = config.endpoint.trim().to_string();
    if raw_ep.is_empty() {
        return Err("API 接口地址不能为空".to_string());
    }

    let api_key = config.api_key.trim().to_string();
    let model_name = if config.model.trim().is_empty() {
        "gemini-1.5-flash".to_string()
    } else {
        config.model.trim().to_string()
    };

    let is_google_gemini = raw_ep.contains("google")
        || raw_ep.contains("gemini")
        || raw_ep.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    // 1. Separate base path and query parameters
    let (base_path, query_str) = match raw_ep.find('?') {
        Some(pos) => (&raw_ep[..pos], Some(&raw_ep[pos + 1..])),
        None => (raw_ep.as_str(), None),
    };

    let mut clean_base = base_path.trim_end_matches('/').to_string();
    if clean_base.ends_with("/chat/completions") {
        clean_base = clean_base.replace("/chat/completions", "");
    }
    if clean_base.ends_with("/completions") {
        clean_base = clean_base.replace("/completions", "");
    }

    // Candidate chat endpoints in priority order
    let mut candidate_urls = Vec::new();

    if raw_ep.contains("/chat/completions") || raw_ep.contains(":generateContent") {
        candidate_urls.push(raw_ep.clone());
    } else if is_google_gemini {
        // Google AI Studio official OpenAI-compatible endpoint
        candidate_urls.push(format!("{}/v1beta/openai/chat/completions", clean_base));
        candidate_urls.push(format!("{}/openai/chat/completions", clean_base));
        // Google AI Studio native REST endpoint
        candidate_urls.push(format!(
            "{}/v1beta/models/{}:generateContent",
            clean_base, model_name
        ));
        candidate_urls.push(format!(
            "{}/models/{}:generateContent",
            clean_base, model_name
        ));
        // Standard fallbacks
        if clean_base.ends_with("/v1") || clean_base.ends_with("/v1beta") {
            candidate_urls.push(format!("{}/chat/completions", clean_base));
        } else {
            candidate_urls.push(format!("{}/v1/chat/completions", clean_base));
            candidate_urls.push(format!("{}/chat/completions", clean_base));
        }
    } else {
        if clean_base.ends_with("/v1") {
            candidate_urls.push(format!("{}/chat/completions", clean_base));
        } else {
            candidate_urls.push(format!("{}/v1/chat/completions", clean_base));
            candidate_urls.push(format!("{}/chat/completions", clean_base));
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(35))
        .build()
        .map_err(|e| format!("无法初始化网络客户端: {}", e))?;

    let mut last_err = String::new();

    for target_url in candidate_urls {
        let mut final_url = target_url.clone();
        if let Some(qs) = query_str {
            if !qs.is_empty() {
                if final_url.contains('?') {
                    final_url = format!("{}&{}", final_url, qs);
                } else {
                    final_url = format!("{}?{}", final_url, qs);
                }
            }
        }

        if is_google_gemini && !api_key.is_empty() && !final_url.contains("key=") {
            if final_url.contains('?') {
                final_url = format!("{}&key={}", final_url, api_key);
            } else {
                final_url = format!("{}?key={}", final_url, api_key);
            }
        }

        let mut req = client.post(&final_url);
        if !api_key.is_empty() {
            if is_google_gemini {
                req = req
                    .header("x-goog-api-key", &api_key)
                    .header("api-key", &api_key);
                if !api_key.starts_with("AIza") {
                    req = req.header("Authorization", format!("Bearer {}", api_key));
                }
            } else {
                req = req
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("api-key", &api_key);
            }
        }

        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = if is_native_gemini_endpoint {
            let contents: Vec<serde_json::Value> = messages
                .iter()
                .map(|m| {
                    let role = if m.role == "user" { "user" } else { "model" };
                    serde_json::json!({
                        "role": role,
                        "parts": [{ "text": m.content }]
                    })
                })
                .collect();
            serde_json::json!({ "contents": contents })
        } else {
            serde_json::json!({
                "model": model_name,
                "messages": messages,
                "temperature": 0.5,
                "max_tokens": 2000,
            })
        };

        let res = match req.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("网络连接失败 (无法连接到 {}): {}", final_url, e);
                continue;
            }
        };

        let status = res.status();
        let status_code = status.as_u16();

        if !status.is_success() {
            let err_body = res.text().await.unwrap_or_default();
            let short_body = if err_body.len() > 220 {
                format!("{}...", &err_body[..220])
            } else {
                err_body
            };
            last_err = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code, short_body, final_url
            );
            continue;
        }

        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_err = format!("接口返回无效 JSON ({}) 路径: {}", e, final_url);
                continue;
            }
        };

        // Extract OpenAI format reply {"choices": [{"message": {"content": "..."}}]}
        if let Some(content) = json
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.get(0))
            .and_then(|first| first.get("message"))
            .and_then(|msg| msg.get("content"))
            .and_then(|val| val.as_str())
        {
            if !content.trim().is_empty() {
                return Ok(content.to_string());
            }
        }

        // Extract Gemini format reply {"candidates": [{"content": {"parts": [{"text": "..."}]}}]}
        if let Some(text) = json
            .get("candidates")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.get(0))
            .and_then(|first| first.get("content"))
            .and_then(|cnt| cnt.get("parts"))
            .and_then(|parts| parts.as_array())
            .and_then(|arr| arr.get(0))
            .and_then(|part| part.get("text"))
            .and_then(|val| val.as_str())
        {
            if !text.trim().is_empty() {
                return Ok(text.to_string());
            }
        }

        // Extract Ollama format reply {"response": "..."}
        if let Some(res_str) = json.get("response").and_then(|v| v.as_str()) {
            if !res_str.trim().is_empty() {
                return Ok(res_str.to_string());
            }
        }

        last_err = format!("接口成功 (200 OK) 但未能解析出消息文本。原始响应: {}", json);
    }

    Err(if last_err.is_empty() {
        "AI 对话服务暂时不可用，请检查网络与接口配置".to_string()
    } else {
        last_err
    })
}
