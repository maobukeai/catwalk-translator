pub mod app_detect;
pub mod backup;
pub mod capture;
pub mod clipboard_history;
pub mod clipboard_watch;
pub mod diagnose;
pub mod general_dict;
pub mod commands;
pub mod commands_capture;
pub mod commands_chat;
pub mod commands_history;
pub mod inpaint;
pub mod lookup_monitor;
pub mod models;
pub mod ocr;
pub mod offline;
pub mod pin;
pub mod offline_models;
pub mod onnx_ocr;
pub mod reconstruction;
pub mod sampler;
pub mod translator;
pub mod updater;
pub mod webdav;
pub mod anki;
pub mod glossary;

use commands::AppState;
use std::str::FromStr;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn parse_code_string(s: &str) -> Option<Code> {
    let trimmed = s.trim();
    let s_upper = trimmed.to_uppercase();

    // 1. Direct from_str attempts
    if let Ok(c) = Code::from_str(trimmed) {
        return Some(c);
    }
    if let Ok(c) = Code::from_str(&s_upper) {
        return Some(c);
    }

    // 2. Explicit mappings for common names and special keys
    match s_upper.as_str() {
        "SPACE" | "SPACEBAR" => return Some(Code::Space),
        "ENTER" | "RETURN" => return Some(Code::Enter),
        "TAB" => return Some(Code::Tab),
        "ESC" | "ESCAPE" => return Some(Code::Escape),
        "BACKSPACE" => return Some(Code::Backspace),
        "DELETE" | "DEL" => return Some(Code::Delete),
        "INSERT" | "INS" => return Some(Code::Insert),
        "HOME" => return Some(Code::Home),
        "END" => return Some(Code::End),
        "PAGEUP" | "PGUP" => return Some(Code::PageUp),
        "PAGEDOWN" | "PGDN" => return Some(Code::PageDown),
        "UP" | "ARROWUP" | "ARROW_UP" => return Some(Code::ArrowUp),
        "DOWN" | "ARROWDOWN" | "ARROW_DOWN" => return Some(Code::ArrowDown),
        "LEFT" | "ARROWLEFT" | "ARROW_LEFT" => return Some(Code::ArrowLeft),
        "RIGHT" | "ARROWRIGHT" | "ARROW_RIGHT" => return Some(Code::ArrowRight),
        "CAPSLOCK" | "CAPS" => return Some(Code::CapsLock),
        "MINUS" | "-" => return Some(Code::Minus),
        "EQUAL" | "=" => return Some(Code::Equal),
        "COMMA" | "," => return Some(Code::Comma),
        "PERIOD" | "." => return Some(Code::Period),
        "SLASH" | "/" => return Some(Code::Slash),
        "BACKSLASH" | "\\" => return Some(Code::Backslash),
        "SEMICOLON" | ";" => return Some(Code::Semicolon),
        "QUOTE" | "'" => return Some(Code::Quote),
        "BACKQUOTE" | "`" => return Some(Code::Backquote),
        _ => {}
    }

    // 3. Function keys F1-F24
    if let Some(rest) = s_upper.strip_prefix('F') {
        if let Ok(num) = rest.parse::<u8>() {
            if (1..=24).contains(&num) {
                if let Ok(c) = Code::from_str(&format!("F{}", num)) {
                    return Some(c);
                }
            }
        }
    }

    // 4. Letters (KeyA - KeyZ)
    if let Ok(c) = Code::from_str(&format!("Key{}", s_upper)) {
        return Some(c);
    }

    // 5. Digits (Digit0 - Digit9)
    if let Ok(c) = Code::from_str(&format!("Digit{}", s_upper)) {
        return Some(c);
    }

    // 6. Single character fallbacks
    if s_upper.len() == 1 {
        let ch = s_upper.chars().next().unwrap();
        if ch.is_ascii_uppercase() {
            return Code::from_str(&format!("Key{}", ch)).ok();
        }
        if ch.is_ascii_digit() {
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
        let hk = if settings.hotkey.trim().is_empty() {
            "F4"
        } else {
            &settings.hotkey
        };
        match parse_hotkey(hk) {
            Ok(s) => {
                if let Err(err) = app_handle.global_shortcut().register(s) {
                    eprintln!(
                        "[Hotkeys] Failed to register capture hotkey '{}': {}",
                        hk, err
                    );
                }
            }
            Err(err) => {
                eprintln!("[Hotkeys] Could not parse capture hotkey '{}': {}", hk, err);
            }
        }

        // Dual-insurance registration: if settings.hotkey is not "F4", also attempt to register "F4" as fallback capture hotkey
        if !hk.eq_ignore_ascii_case("F4") {
            if let Ok(f4_s) = parse_hotkey("F4") {
                let _ = app_handle.global_shortcut().register(f4_s);
            }
        }
    }

    // 2. Spotlight hotkey
    if settings.spotlight_hotkey_enabled.unwrap_or(false) {
        let hk = settings
            .spotlight_hotkey
            .as_deref()
            .unwrap_or("Alt+Space");
        if !hk.trim().is_empty() {
            match parse_hotkey(hk) {
                Ok(s) => {
                    if let Err(err) = app_handle.global_shortcut().register(s) {
                        eprintln!(
                            "[Hotkeys] Failed to register spotlight hotkey '{}': {}",
                            hk, err
                        );
                    }
                }
                Err(err) => {
                    eprintln!("[Hotkeys] Could not parse spotlight hotkey '{}': {}", hk, err);
                }
            }
        }
    }

    // 3. Clipboard hotkey
    if settings.clipboard_hotkey_enabled.unwrap_or(false) {
        let hk = settings
            .clipboard_hotkey
            .as_deref()
            .unwrap_or("Ctrl+Shift+C");
        if !hk.trim().is_empty() {
            match parse_hotkey(hk) {
                Ok(s) => {
                    if let Err(err) = app_handle.global_shortcut().register(s) {
                        eprintln!(
                            "[Hotkeys] Failed to register clipboard hotkey '{}': {}",
                            hk, err
                        );
                    }
                }
                Err(err) => {
                    eprintln!("[Hotkeys] Could not parse clipboard hotkey '{}': {}", hk, err);
                }
            }
        }
    }

    // 4. Toggle Window hotkey
    if settings.toggle_window_hotkey_enabled.unwrap_or(false) {
        let hk = settings
            .toggle_window_hotkey
            .as_deref()
            .unwrap_or("Alt+W");
        if !hk.trim().is_empty() {
            match parse_hotkey(hk) {
                Ok(s) => {
                    if let Err(err) = app_handle.global_shortcut().register(s) {
                        eprintln!(
                            "[Hotkeys] Failed to register toggle_window hotkey '{}': {}",
                            hk, err
                        );
                    }
                }
                Err(err) => {
                    eprintln!("[Hotkeys] Could not parse toggle_window hotkey '{}': {}", hk, err);
                }
            }
        }
    }

    // 5. Quick lookup window hotkey (default Alt+W, default disabled)
    if settings.quick_window_hotkey_enabled.unwrap_or(false) {
        let hk = settings
            .quick_window_hotkey
            .as_deref()
            .unwrap_or("Alt+W");
        if !hk.trim().is_empty() {
            match parse_hotkey(hk) {
                Ok(s) => {
                    if let Err(err) = app_handle.global_shortcut().register(s) {
                        eprintln!(
                            "[Hotkeys] Failed to register quick_window hotkey '{}': {}",
                            hk, err
                        );
                    }
                }
                Err(err) => {
                    eprintln!("[Hotkeys] Could not parse quick_window hotkey '{}': {}", hk, err);
                }
            }
        }
    }

    // 6. Hover lookup hotkey (fixed Ctrl+Alt+H, opens the overlay in hover mode)
    match parse_hotkey("Ctrl+Alt+H") {
        Ok(s) => {
            if let Err(err) = app_handle.global_shortcut().register(s) {
                eprintln!(
                    "[Hotkeys] Failed to register hover lookup hotkey 'Ctrl+Alt+H': {}",
                    err
                );
            }
        }
        Err(err) => {
            eprintln!("[Hotkeys] Could not parse hover lookup hotkey 'Ctrl+Alt+H': {}", err);
        }
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
                            let wake_window_and_dispatch = |app_h: tauri::AppHandle, event_name: &'static str| {
                                if let Some(window) = app_h.get_webview_window("main") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    let eval_js = format!("window.dispatchEvent(new CustomEvent('{}'))", event_name);
                                    let _ = window.eval(&eval_js);
                                }
                                let app_clone = app_h.clone();
                                tauri::async_runtime::spawn(async move {
                                    // Pulse 1: 0ms
                                    let _ = app_clone.emit(event_name, ());
                                    // Pulse 2: 50ms
                                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                                    let _ = app_clone.emit(event_name, ());
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        let eval_js = format!("window.dispatchEvent(new CustomEvent('{}'))", event_name);
                                        let _ = window.eval(&eval_js);
                                    }
                                    // Pulse 3: 150ms (50ms + 100ms)
                                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                                    let _ = app_clone.emit(event_name, ());
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        let eval_js = format!("window.dispatchEvent(new CustomEvent('{}'))", event_name);
                                        let _ = window.eval(&eval_js);
                                    }
                                });
                            };

                            let dispatch_overlay_event = |app_h: tauri::AppHandle, event_name: &'static str| {
                                if let Some(window) = app_h.get_webview_window("main") {
                                    if !commands::is_overlay_active() {
                                        let was_vis = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
                                        commands::set_was_main_window_visible(was_vis);
                                    }
                                    let eval_js = format!("window.dispatchEvent(new CustomEvent('{}'))", event_name);
                                    let _ = window.eval(&eval_js);
                                }
                                let app_clone = app_h.clone();
                                tauri::async_runtime::spawn(async move {
                                    // Pulse 1: 0ms
                                    let _ = app_clone.emit(event_name, ());
                                    // Pulse 2: 50ms
                                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                                    let _ = app_clone.emit(event_name, ());
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        let eval_js = format!("window.dispatchEvent(new CustomEvent('{}'))", event_name);
                                        let _ = window.eval(&eval_js);
                                    }
                                    // Pulse 3: 150ms (50ms + 100ms)
                                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                                    let _ = app_clone.emit(event_name, ());
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        let eval_js = format!("window.dispatchEvent(new CustomEvent('{}'))", event_name);
                                        let _ = window.eval(&eval_js);
                                    }
                                });
                            };

                            // Match capture hotkey (matches configured hotkey AND F4 fallback)
                            if settings.capture_hotkey_enabled.unwrap_or(true) {
                                let hk = if settings.hotkey.trim().is_empty() {
                                    "F4"
                                } else {
                                    &settings.hotkey
                                };
                                let is_capture_match = match parse_hotkey(hk) {
                                    Ok(s) => s == *shortcut,
                                    Err(_) => false,
                                } || match parse_hotkey("F4") {
                                    Ok(f4_s) => f4_s == *shortcut,
                                    Err(_) => false,
                                };

                                if is_capture_match {
                                    dispatch_overlay_event(app.clone(), "trigger-capture");
                                    return;
                                }
                            }

                            // Match spotlight hotkey
                            if settings.spotlight_hotkey_enabled.unwrap_or(false) {
                                let hk = settings
                                    .spotlight_hotkey
                                    .as_deref()
                                    .unwrap_or("Alt+Space");
                                if !hk.trim().is_empty() {
                                    if let Ok(s) = parse_hotkey(hk) {
                                        if s == *shortcut {
                                            wake_window_and_dispatch(app.clone(), "trigger-spotlight");
                                            return;
                                        }
                                    }
                                }
                            }

                            // Match clipboard hotkey
                            if settings.clipboard_hotkey_enabled.unwrap_or(false) {
                                let hk = settings
                                    .clipboard_hotkey
                                    .as_deref()
                                    .unwrap_or("Ctrl+Shift+C");
                                if !hk.trim().is_empty() {
                                    if let Ok(s) = parse_hotkey(hk) {
                                        if s == *shortcut {
                                            wake_window_and_dispatch(app.clone(), "trigger-clipboard");
                                            return;
                                        }
                                    }
                                }
                            }

                            // Match toggle window hotkey
                            if settings.toggle_window_hotkey_enabled.unwrap_or(false) {
                                let hk = settings
                                    .toggle_window_hotkey
                                    .as_deref()
                                    .unwrap_or("Alt+W");
                                if !hk.trim().is_empty() {
                                    if let Ok(s) = parse_hotkey(hk) {
                                        if s == *shortcut {
                                            if let Some(window) = app.get_webview_window("main") {
                                                let is_vis = window.is_visible().unwrap_or(false);
                                                let is_focused =
                                                    window.is_focused().unwrap_or(false);
                                                if is_vis && is_focused {
                                                    let _ = window.hide();
                                                } else {
                                                    wake_window_and_dispatch(app.clone(), "trigger-toggle-window");
                                                }
                                            } else {
                                                wake_window_and_dispatch(app.clone(), "trigger-toggle-window");
                                            }
                                            return;
                                        }
                                    }
                                }
                            }

                            // Match quick lookup window hotkey
                            if settings.quick_window_hotkey_enabled.unwrap_or(false) {
                                let hk = settings
                                    .quick_window_hotkey
                                    .as_deref()
                                    .unwrap_or("Alt+W");
                                if !hk.trim().is_empty() {
                                    if let Ok(s) = parse_hotkey(hk) {
                                        if s == *shortcut {
                                            let _ = pin::open_or_show_quick_window(&app);
                                            return;
                                        }
                                    }
                                }
                            }

                            // Match the fixed hover-lookup hotkey (Ctrl+Alt+H)
                            if let Ok(s) = parse_hotkey("Ctrl+Alt+H") {
                                if s == *shortcut {
                                    dispatch_overlay_event(app.clone(), "trigger-hover");
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                commands::set_was_main_window_visible(false);
                let _ = window.hide();
            }
        })
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

            // 翻译记忆持久化：启动加载历史缓存（跨重启复用，重复划词零网络延迟）
            translator::set_tm_path(
                commands::get_app_config_dir(app.handle()).join("translation_memory.json"),
            );
            translator::shared_pipeline().cache.load_from_disk();
            translator::shared_pipeline().update_credentials(translator::OnlineCredentials {
                baidu_app_id: current_settings.baidu_app_id.clone(),
                baidu_secret: current_settings.baidu_secret.clone(),
                baidu_llm_api_key: current_settings.baidu_llm_api_key.clone(),
                deepl_api_key: current_settings.deepl_api_key.clone(),
                deepl_custom_url: current_settings.deepl_custom_url.clone(),
                volcengine_access_key: current_settings.volcengine_access_key.clone(),
                volcengine_secret_key: current_settings.volcengine_secret_key.clone(),
                yandex_api_key: current_settings.yandex_api_key.clone(),
                yandex_folder_id: current_settings.yandex_folder_id.clone(),
            });

            // 启动时应用手动代理（优先于系统代理自动探测）
            let manual_proxy = if current_settings.proxy_enabled.unwrap_or(false) {
                current_settings
                    .proxy_url
                    .clone()
                    .filter(|u| !u.trim().is_empty())
            } else {
                None
            };
            translator::set_manual_proxy(manual_proxy);

            // 启动时应用主窗口置顶设置
            if current_settings.always_on_top.unwrap_or(false) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_always_on_top(true);
                }
            }

            // Passive clipboard watch (off by default; purely settings-driven)
            if current_settings.clipboard_watch_enabled.unwrap_or(false) {
                clipboard_watch::start_clipboard_watch(app.handle().clone());
            }

            // 无感查词:划词即弹窗 / 修饰键悬停取词(设置驱动)
            if current_settings.selection_lookup_enabled.unwrap_or(false)
                || current_settings.hover_lookup_enabled.unwrap_or(false)
            {
                lookup_monitor::start_lookup_monitor(app.handle().clone());
            }

            // Periodic local auto-backup (purely settings-driven)
            backup::ensure_auto_backup_thread(app.handle().clone());

            // Local OCR model downloads land in the app-data models directory
            onnx_ocr::set_models_dir_override(
                commands::get_app_config_dir(app.handle()).join("models"),
            );

            if let Some(ref ver) = current_settings.ocr_version {
                onnx_ocr::set_active_version(ver);
            }

            // System Tray setup
            let show_item = MenuItemBuilder::with_id("show_settings", "显示界面").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("猫步翻译软件");

            // 猫步翻译全新苹果极简纯白底主图标 (W1 Aurora Lens White Cat)
            let app_icon_opt =
                tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).ok();

            if let Some(ref icon) = app_icon_opt {
                tray_builder = tray_builder.icon(icon.clone());
            } else if let Some(icon) = app.default_window_icon() {
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
                        crate::translator::shared_pipeline().cache.save_to_disk();
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Enable Windows OS DWM Blur Behind Window for true hardware Acrylic blur,
            // but only when the active theme is a translucent glass theme with blur on.
            if let Some(main_win) = app.get_webview_window("main") {
                if let Some(ref icon) = app_icon_opt {
                    let _ = main_win.set_icon(icon.clone());
                }
                #[cfg(target_os = "windows")]
                crate::set_windows_dwm_blur(
                    &main_win,
                    commands::glass_enabled_for_settings(&current_settings),
                    commands::is_dark_for_settings(&current_settings),
                );
                let _ = main_win.center();
                let _ = main_win.show();
                let _ = main_win.unminimize();
                let _ = main_win.set_focus();
                #[cfg(target_os = "windows")]
                if let Ok(hwnd) = main_win.hwnd() {
                    unsafe {
                        use windows::Win32::UI::WindowsAndMessaging::{BringWindowToTop, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW};
                        use windows::Win32::Foundation::HWND;
                        let h = HWND(hwnd.0 as _);
                        let _ = ShowWindow(h, SW_RESTORE);
                        let _ = ShowWindow(h, SW_SHOW);
                        let _ = BringWindowToTop(h);
                        let _ = SetForegroundWindow(h);
                    }
                }
            }


            // Pre-warm OCR engines in background so first OCR call is instant.
            // Priority: Rust-native ONNX engine (if models exist) → RapidOCR daemon.
            crate::ocr::mark_ocr_warming();
            std::thread::spawn(|| {
                // ── 先预热 WinRT（发一张 1×1 白色 BMP 唤醒系统 OCR 服务）──
                #[cfg(target_os = "windows")]
                {
                    let tiny_bmp = crate::ocr::make_warmup_bmp();
                    match crate::ocr::execute_winrt_ocr(&tiny_bmp) {
                        Ok(_) => eprintln!("[OCR] WinRT 预热完成 — 首次截图即时响应"),
                        Err(e) => eprintln!("[OCR] WinRT 预热跳过: {}", e),
                    }
                }

                if crate::onnx_ocr::model_files_present() {
                    let engine = crate::onnx_ocr::get_engine();
                    match engine.ensure_loaded() {
                        Ok(()) => {
                            let ver = crate::onnx_ocr::get_active_version().to_uppercase();
                            let tiny_bmp = crate::ocr::make_warmup_bmp();
                            let _ = engine.recognize_bmp(&tiny_bmp);
                            eprintln!("[OCR] Rust 原生 ONNX 引擎已就绪并完成图预热 (PP-OCR{}, 无需 Python)", ver);
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
            commands::cmd_region_ocr_layout,
            commands::cmd_region_ocr_translate,
            commands::cmd_region_image,
            commands::cmd_watch_tick,
            commands::cmd_copy_region_image,
            commands::cmd_save_region_image,
            commands::cmd_save_composed_image,
            commands::cmd_copy_composed_image,
            commands::cmd_hover_lookup,
            offline_models::cmd_offline_models_status,
            offline_models::cmd_download_offline_model,
            offline_models::cmd_delete_offline_model,
            offline_models::cmd_get_active_ocr_version,
            offline_models::cmd_switch_ocr_version,
            commands::cmd_translate_phrases_styled,
            commands::cmd_llm_batch_refine,
            commands::cmd_snap_region,
            commands::cmd_save_capture_session,
            commands::cmd_get_capture_sessions,
            commands::cmd_clear_capture_sessions,
            commands::cmd_universal_translate,
            commands::cmd_translate_phrases,
            commands::cmd_sample_colors,
            commands::cmd_set_window_blur,
            commands::cmd_save_settings,
            commands::cmd_get_settings,
            commands::cmd_query_text,
            commands::cmd_get_history,
            commands::cmd_add_history,
            commands::cmd_toggle_favorite,
            commands::cmd_delete_history,
            commands::cmd_delete_history_entries,
            commands::cmd_batch_set_favorite,
            commands::cmd_clear_history,
            commands::cmd_clear_unfavorited_history,
            commands::cmd_ocr_engine_status,
            commands::cmd_export_anki,
            commands::cmd_anki_check_connection,
            commands::cmd_anki_sync_notes,
            commands::cmd_anki_export_file,
            commands::cmd_get_custom_glossary,
            commands::cmd_import_custom_glossary,
            commands::cmd_parse_glossary_text,
            commands::cmd_upsert_custom_glossary_entry,
            commands::cmd_delete_custom_glossary_entry,
            commands::cmd_clear_custom_glossary,
            commands::cmd_export_custom_glossary,
            commands::cmd_fetch_llm_models,
            commands::cmd_chat_llm,
            commands::cmd_chat_llm_stream,
            commands::cmd_offline_install,
            commands::cmd_offline_uninstall,
            commands::cmd_offline_status,
            commands::cmd_image_ocr_translate,
            commands::cmd_exit_app,
            commands::cmd_hide_main_window,
            commands::cmd_show_main_window,
            commands::cmd_fetch_tts_audio,
            lookup_monitor::cmd_get_lookup_payload,
            lookup_monitor::cmd_hide_lookup_popup,
            pin::cmd_open_pin,
            pin::cmd_get_pin_payload,
            pin::cmd_close_pin,
            pin::cmd_open_quick_window,
            pin::cmd_reposition_pin_to_cursor,
            pin::cmd_set_pin_always_on_top,
            diagnose::cmd_network_diagnose,
            general_dict::cmd_general_dict_status,
            general_dict::cmd_general_dict_install,
            general_dict::cmd_general_dict_uninstall,
            general_dict::cmd_general_dict_lookup,
            clipboard_history::cmd_get_clipboard_history,
            clipboard_history::cmd_clear_clipboard_history,
            commands::cmd_save_export_png,
            backup::cmd_create_backup,
            backup::cmd_list_backups,
            backup::cmd_delete_backup,
            backup::cmd_restore_backup,
            backup::cmd_open_backup_dir,
            backup::cmd_export_backup_base64,
            backup::cmd_import_backup_base64,
            webdav::cmd_webdav_test,
            webdav::cmd_webdav_upload,
            webdav::cmd_webdav_list,
            webdav::cmd_webdav_restore,
            webdav::cmd_webdav_delete,
            updater::cmd_check_app_update,
            updater::cmd_get_app_info,
            updater::cmd_open_external_url,
            updater::cmd_download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "windows")]
pub fn set_windows_dwm_blur(window: &tauri::WebviewWindow, enable: bool, is_dark: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};

    if let Ok(raw_hwnd) = window.hwnd() {
        let hwnd = HWND(raw_hwnd.0 as _);
        unsafe {
            // 1. Windows 11 DWM System Backdrop:
            // 38 = DWMWA_SYSTEMBACKDROP_TYPE: 3 = DWMSBT_TRANSIENTWINDOW (Acrylic), 1 = DWMSBT_NONE
            let backdrop_type: u32 = if enable { 3 } else { 1 };
            let hr_backdrop = DwmSetWindowAttribute(
                hwnd,
                DWMWINDOWATTRIBUTE(38),
                &backdrop_type as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );

            // 20 = DWMWA_USE_IMMERSIVE_DARK_MODE: 1 for dark, 0 for light
            let dark_mode: u32 = if is_dark { 1 } else { 0 };
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWINDOWATTRIBUTE(20),
                &dark_mode as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );

            // 34 = DWMWA_BORDER_COLOR: 0xFFFFFFFE = DWMWA_COLOR_NONE (彻底消除 Windows 11 默认的 1px 矩形黑边/灰边)
            let border_color: u32 = 0xFFFFFFFE;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWINDOWATTRIBUTE(34),
                &border_color as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );

            // 33 = DWMWA_WINDOW_CORNER_PREFERENCE: 1 = DWMWCP_DONOTROUND
            // 当禁用 DWM 磨砂时（贴图/浮动透明窗），严禁 DWM 绘制任何直角或次级圆角框，由前端 CSS 圆角完全掌控纯净透明边界
            if !enable {
                let corner_pref: u32 = 1;
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWINDOWATTRIBUTE(33),
                    &corner_pref as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                );
            }

            // 2. Windows 10 SetWindowCompositionAttribute fallback
            if hr_backdrop.is_err() || !enable {
                #[repr(C)]
                struct ACCENT_POLICY {
                    accent_state: u32,
                    accent_flags: u32,
                    gradient_color: u32,
                    animation_id: u32,
                }

                #[repr(C)]
                #[allow(non_camel_case_types, clippy::upper_case_acronyms)]
                struct WINDOWCOMPOSITIONATTRIBDATA {
                    attribute: u32,
                    data: *mut std::ffi::c_void,
                    size_of_data: usize,
                }

                type SetWindowCompositionAttributeFn =
                    unsafe extern "system" fn(HWND, *mut WINDOWCOMPOSITIONATTRIBDATA) -> i32;

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
                            gradient_color: if enable {
                                if is_dark {
                                    0x0112131a
                                } else {
                                    0x01f8fafc
                                }
                            } else {
                                0
                            },
                            animation_id: 0,
                        };

                        let mut data = WINDOWCOMPOSITIONATTRIBDATA {
                            attribute: 19, // WCA_ACCENT_POLICY
                            data: &mut accent as *mut _ as _,
                            size_of_data: std::mem::size_of::<ACCENT_POLICY>(),
                        };

                        let res = set_window_composition_attribute(hwnd, &mut data);
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
                            let _ = set_window_composition_attribute(hwnd, &mut fallback_data);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_windows_dwm_blur(_window: &tauri::WebviewWindow, _enable: bool, _is_dark: bool) {}

pub fn enable_windows_dwm_blur(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    set_windows_dwm_blur(window, true, true);
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
            llm_configs: None,
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
                ..Default::default()
            }),
            translation_tiers: None,
            style: None,
            forced_engine: None,
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
            volcengine_access_key: None,
            volcengine_secret_key: None,
            yandex_api_key: None,
            yandex_folder_id: None,
            ..Default::default()
        };
        let res = translator::execute_universal_translate(req, &[]).await;
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
