pub mod capture;
pub mod commands;
pub mod models;
pub mod ocr;
pub mod onnx_ocr;
pub mod reconstruction;
pub mod sampler;
pub mod translator;

use commands::AppState;
use std::str::FromStr;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn parse_code_string(s: &str) -> Option<Code> {
    let s_upper = s.to_uppercase();
    if let Ok(c) = Code::from_str(&s_upper) {
        return Some(c);
    }
    if let Ok(c) = Code::from_str(&format!("Key{}", s_upper)) {
        return Some(c);
    }
    if let Ok(c) = Code::from_str(&format!("Digit{}", s_upper)) {
        return Some(c);
    }
    if s_upper.len() == 1 {
        let ch = s_upper.chars().next().unwrap();
        if ch >= 'A' && ch <= 'Z' {
            return Code::from_str(&format!("Key{}", ch)).ok();
        }
        if ch >= '0' && ch <= '9' {
            return Code::from_str(&format!("Digit{}", ch)).ok();
        }
    }
    None
}

pub fn parse_hotkey(hotkey_str: &str) -> Result<Shortcut, String> {
    if let Ok(s) = Shortcut::from_str(hotkey_str) {
        return Ok(s);
    }

    let parts: Vec<&str> = hotkey_str.split('+').collect();
    let mut mods = Modifiers::empty();
    let mut code: Option<Code> = None;

    for part in parts {
        let p = part.trim();
        match p.to_uppercase().as_str() {
            "CTRL" | "CONTROL" => mods |= Modifiers::CONTROL,
            "ALT" => mods |= Modifiers::ALT,
            "SHIFT" => mods |= Modifiers::SHIFT,
            "WIN" | "SUPER" | "META" => mods |= Modifiers::SUPER,
            other => {
                code = parse_code_string(other);
            }
        }
    }

    if let Some(c) = code {
        let modifier_opt = if mods.is_empty() { None } else { Some(mods) };
        Ok(Shortcut::new(modifier_opt, c))
    } else {
        Err(format!("Could not parse key code from: {}", hotkey_str))
    }
}

pub fn register_all_user_shortcuts(
    app_handle: &tauri::AppHandle,
    settings: &models::AppSettings,
) -> Result<(), String> {
    let _ = app_handle.global_shortcut().unregister_all();

    // 1. Capture hotkey
    if settings.capture_hotkey_enabled.unwrap_or(true) {
        if let Ok(s) = parse_hotkey(&settings.hotkey) {
            if let Err(err) = app_handle.global_shortcut().register(s) {
                eprintln!(
                    "[Hotkeys] Failed to register capture hotkey '{}': {}",
                    settings.hotkey, err
                );
            }
        }
    }

    // 2. Spotlight hotkey
    if settings.spotlight_hotkey_enabled.unwrap_or(true) {
        if let Some(ref hk) = settings.spotlight_hotkey {
            if let Ok(s) = parse_hotkey(hk) {
                if let Err(err) = app_handle.global_shortcut().register(s) {
                    eprintln!(
                        "[Hotkeys] Failed to register spotlight hotkey '{}': {}",
                        hk, err
                    );
                }
            }
        }
    }

    // 3. Clipboard hotkey
    if settings.clipboard_hotkey_enabled.unwrap_or(true) {
        if let Some(ref hk) = settings.clipboard_hotkey {
            if let Ok(s) = parse_hotkey(hk) {
                if let Err(err) = app_handle.global_shortcut().register(s) {
                    eprintln!(
                        "[Hotkeys] Failed to register clipboard hotkey '{}': {}",
                        hk, err
                    );
                }
            }
        }
    }

    // 4. Toggle Window hotkey
    if settings.toggle_window_hotkey_enabled.unwrap_or(true) {
        if let Some(ref hk) = settings.toggle_window_hotkey {
            if let Ok(s) = parse_hotkey(hk) {
                if let Err(err) = app_handle.global_shortcut().register(s) {
                    eprintln!(
                        "[Hotkeys] Failed to register toggle_window hotkey '{}': {}",
                        hk, err
                    );
                }
            }
        }
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let settings_opt = match app.try_state::<AppState>() {
                            Some(app_state) => match app_state.settings.lock() {
                                Ok(lock) => Some(lock.clone()),
                                Err(_) => None,
                            },
                            None => None,
                        };

                        if let Some(settings) = settings_opt {
                            // Match capture hotkey
                            if settings.capture_hotkey_enabled.unwrap_or(true) {
                                if let Ok(s) = parse_hotkey(&settings.hotkey) {
                                    if s == *shortcut {
                                        let _ = app.emit("trigger-capture", ());
                                        return;
                                    }
                                }
                            }

                            // Match spotlight hotkey
                            if settings.spotlight_hotkey_enabled.unwrap_or(true) {
                                if let Some(ref hk) = settings.spotlight_hotkey {
                                    if let Ok(s) = parse_hotkey(hk) {
                                        if s == *shortcut {
                                            if let Some(window) = app.get_webview_window("main") {
                                                let _ = window.show();
                                                let _ = window.unminimize();
                                                let _ = window.set_focus();
                                            }
                                            let _ = app.emit("trigger-spotlight", ());
                                            return;
                                        }
                                    }
                                }
                            }

                            // Match clipboard hotkey
                            if settings.clipboard_hotkey_enabled.unwrap_or(true) {
                                if let Some(ref hk) = settings.clipboard_hotkey {
                                    if let Ok(s) = parse_hotkey(hk) {
                                        if s == *shortcut {
                                            let _ = app.emit("trigger-clipboard", ());
                                            return;
                                        }
                                    }
                                }
                            }

                            // Match toggle window hotkey
                            if settings.toggle_window_hotkey_enabled.unwrap_or(true) {
                                if let Some(ref hk) = settings.toggle_window_hotkey {
                                    if let Ok(s) = parse_hotkey(hk) {
                                        if s == *shortcut {
                                            if let Some(window) = app.get_webview_window("main") {
                                                let is_vis = window.is_visible().unwrap_or(false);
                                                let is_focused =
                                                    window.is_focused().unwrap_or(false);
                                                if is_vis && is_focused {
                                                    let _ = window.hide();
                                                } else {
                                                    let _ = window.show();
                                                    let _ = window.unminimize();
                                                    let _ = window.set_focus();
                                                }
                                            }
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Load persistent settings & history from disk
            let app_state = AppState::load_from_disk(app.handle());
            let current_settings = {
                if let Ok(lock) = app_state.settings.lock() {
                    lock.clone()
                } else {
                    models::AppSettings::default()
                }
            };
            app.manage(app_state);

            // Register all 4 global shortcuts with OS
            let _ = register_all_user_shortcuts(app.handle(), &current_settings);

            // System Tray setup
            let show_item = MenuItemBuilder::with_id("show_settings", "显示界面").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("猫步翻译软件");

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show_settings" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Enable Windows OS DWM Blur Behind Window for true hardware Acrylic blur
            if let Some(main_win) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                enable_windows_dwm_blur(&main_win);
            }

            // Pre-warm OCR engines in background so first OCR call is instant.
            // Priority: Rust-native ONNX engine (if models exist) → RapidOCR daemon.
            crate::ocr::mark_ocr_warming();
            std::thread::spawn(|| {
                if crate::onnx_ocr::model_files_present() {
                    let engine = crate::onnx_ocr::get_engine();
                    match engine.ensure_loaded() {
                        Ok(()) => {
                            eprintln!("[OCR] Rust 原生 ONNX 引擎已就绪 (PP-OCRv3, 无需 Python)");
                            crate::ocr::mark_onnx_ready();
                        }
                        Err(e) => {
                            eprintln!("[OCR] ONNX 引擎加载失败, 回退 RapidOCR daemon: {}", e);
                            crate::ocr::mark_onnx_failed();
                        }
                    }
                } else if !crate::onnx_ocr::model_files_present() {
                    eprintln!("[OCR] ONNX 模型缺失, 使用 RapidOCR daemon 预热");
                }
                // Warm the Python daemon only when the Rust engine is unavailable
                if !crate::ocr::onnx_available() {
                    let tiny_bmp = crate::ocr::make_warmup_bmp();
                    let _ = crate::ocr::execute_native_ocr(&tiny_bmp);
                    eprintln!("[OCR] Daemon warm-up complete. First OCR will be instant.");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cmd_begin_capture,
            commands::cmd_show_overlay,
            commands::cmd_close_overlay,
            commands::cmd_capture_and_ocr,
            commands::cmd_region_ocr_translate,
            commands::cmd_universal_translate,
            commands::cmd_translate_phrases,
            commands::cmd_sample_colors,
            commands::cmd_save_settings,
            commands::cmd_get_settings,
            commands::cmd_query_text,
            commands::cmd_get_history,
            commands::cmd_add_history,
            commands::cmd_toggle_favorite,
            commands::cmd_delete_history,
            commands::cmd_clear_history,
            commands::cmd_ocr_engine_status,
            commands::cmd_export_anki,
            commands::cmd_fetch_llm_models,
            commands::cmd_chat_llm
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "windows")]
pub fn set_windows_dwm_blur(window: &tauri::WebviewWindow, enable: bool) {
    use windows::Win32::Foundation::HWND;

    #[repr(C)]
    struct ACCENT_POLICY {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct WINDOWCOMPOSITIONATTRIBDATA {
        attribute: u32,
        data: *mut std::ffi::c_void,
        size_of_data: usize,
    }

    type SetWindowCompositionAttributeFn =
        unsafe extern "system" fn(HWND, *mut WINDOWCOMPOSITIONATTRIBDATA) -> i32;

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            if let Ok(user32) =
                windows::Win32::System::LibraryLoader::LoadLibraryA(windows::core::s!("user32.dll"))
            {
                if let Some(proc) = windows::Win32::System::LibraryLoader::GetProcAddress(
                    user32,
                    windows::core::s!("SetWindowCompositionAttribute"),
                ) {
                    let set_window_composition_attribute: SetWindowCompositionAttributeFn =
                        std::mem::transmute(proc);

                    let mut accent = ACCENT_POLICY {
                        accent_state: if enable { 4 } else { 0 },
                        accent_flags: if enable { 2 } else { 0 },
                        gradient_color: if enable { 0x0112131a } else { 0 },
                        animation_id: 0,
                    };

                    let mut data = WINDOWCOMPOSITIONATTRIBDATA {
                        attribute: 19, // WCA_ACCENT_POLICY
                        data: &mut accent as *mut _ as _,
                        size_of_data: std::mem::size_of::<ACCENT_POLICY>(),
                    };

                    let res = set_window_composition_attribute(HWND(hwnd.0 as _), &mut data);
                    if enable && res == 0 {
                        let mut fallback_accent = ACCENT_POLICY {
                            accent_state: 3,
                            accent_flags: 2,
                            gradient_color: 0,
                            animation_id: 0,
                        };
                        let mut fallback_data = WINDOWCOMPOSITIONATTRIBDATA {
                            attribute: 19,
                            data: &mut fallback_accent as *mut _ as _,
                            size_of_data: std::mem::size_of::<ACCENT_POLICY>(),
                        };
                        let _ =
                            set_window_composition_attribute(HWND(hwnd.0 as _), &mut fallback_data);
                    }
                }
            }
        }
    }
}

pub fn enable_windows_dwm_blur(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    set_windows_dwm_blur(window, true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hotkeys() {
        assert!(parse_hotkey("F4").is_ok());
        assert!(parse_hotkey("Ctrl+Alt+D").is_ok());
        assert!(parse_hotkey("Ctrl+Shift+K").is_ok());
        assert!(parse_hotkey("Alt+F11").is_ok());
    }

    #[tokio::test]
    async fn test_universal_translate_chinese() {
        // Offline-safe: only local preset dictionaries enabled, no network engines.
        let req = models::UniversalTranslationRequest {
            text: "Roughness".to_string(),
            source_lang: "auto".to_string(),
            target_lang: "zh-CN".to_string(),
            preset: Some("blender".to_string()),
            llm_config: None,
            preset_dicts: Some(models::PresetDicts {
                blender: true,
                substance: true,
                unity: true,
                unreal: false,
                maya: false,
                houdini: false,
            }),
            online_engines: Some(models::OnlineEngines {
                google: Some(false),
                bing: Some(false),
                youdao: Some(false),
                deepl: Some(false),
                my_memory: Some(false),
                baidu: Some(false),
                tencent: Some(false),
            }),
            translation_tiers: None,
        };
        let res = translator::execute_universal_translate(req).await;
        assert!(res.is_ok());
        let val = res.unwrap();
        assert!(
            val.engines
                .iter()
                .any(|e| e.engine_name.contains("词库") || e.translated.contains("粗糙度"))
                || val.main_translation == "粗糙度",
            "expected offline dict hit, got: {:?}",
            val.engines
                .iter()
                .map(|e| e.translated.clone())
                .collect::<Vec<_>>()
        );
    }
}
