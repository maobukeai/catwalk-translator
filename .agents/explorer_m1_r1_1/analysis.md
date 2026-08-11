# Technical Analysis & Setup Plan: Milestone 1 Tauri 2.0 Rust Backend Infrastructure

## 1. Executive Summary
This document presents the detailed architectural analysis and implementation specification for Milestone 1 (M1) of the **CG AI Screenshot Translator**.
The goal of M1 is to establish a solid desktop application infrastructure using **Tauri 2.0 (Rust backend)** and **React 18 (Vite + TailwindCSS frontend)** in `app_v2/`, implementing system tray support, global hotkey registration, app settings management, and the required 5 Tauri IPC command stubs defined in `PROJECT.md § Interface Contracts`.

---

## 2. Existing Repository Audit

### 2.1 Directory Layout & Legacy Codebase
- **Root Directory (`/`)**:
  - `PROJECT.md`: System design, feature inventory, IPC contracts, directory layout.
  - `ORIGINAL_REQUEST.md`: System requirements (R1–R4) and acceptance criteria (A1–A2).
  - `TEST_INFRA.md`: Testing strategy and verification framework.
  - Legacy Python codebase (`main.py`, `core/capture.py`, `core/ocr.py`, `core/translator.py`, `core/sampler.py`, `core/overlay.py`): Reference implementations for OCR pipeline, color sampling, and UI overlays.
- **`app_v2/` (Modern Application Base)**:
  - `app_v2/package.json`: Vite + React + TypeScript configuration.
  - `app_v2/src-tauri/Cargo.toml`: Tauri v2 crate dependencies (currently minimal).
  - `app_v2/src-tauri/tauri.conf.json`: Tauri v2 config file.
  - `app_v2/src-tauri/capabilities/default.json`: Windows capabilities and plugin permissions.
  - `app_v2/src-tauri/src/`: Contains basic template files `main.rs` and `lib.rs` with default `greet` command.

---

## 3. Tauri 2.0 Dependency & Configuration Plan

### 3.1 Cargo Dependencies (`app_v2/src-tauri/Cargo.toml`)
To support global hotkeys, system tray, JSON serialization, and asynchronous state handling, the `Cargo.toml` manifest should be updated as follows:

```toml
[package]
name = "app_v2"
version = "0.1.0"
description = "CG AI Screenshot Translator - Tauri 2.0 Application"
authors = ["CG Translator Team"]
edition = "2021"

[lib]
name = "app_v2_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-opener = "2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
```

### 3.2 Application Configuration (`app_v2/src-tauri/tauri.conf.json`)
The application window specifications, product naming, and security context must be configured:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "CG AI Screenshot Translator",
  "version": "0.1.0",
  "identifier": "com.cgtranslator.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "CG AI Screenshot Translator",
        "width": 950,
        "height": 680,
        "resizable": true,
        "visible": true,
        "center": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### 3.3 Permissions (`app_v2/src-tauri/capabilities/default.json`)
Include permissions for `core:default`, `opener:default`, and `global-shortcut:default`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "global-shortcut:default"
  ]
}
```

---

## 4. Rust Backend Code Structure (`app_v2/src-tauri/src/`)

### 4.1 File Hierarchy Plan
```
app_v2/src-tauri/src/
├── main.rs          # Entry point delegating execution to app_v2_lib::run()
├── lib.rs           # Tauri App builder, system tray setup, global shortcut listener, IPC handler registration
├── models.rs        # Complete Rust data structures (AppSettings, PhysicalRect, OcrResult, LlmConfig, etc.)
└── commands.rs      # IPC command stubs adhering to PROJECT.md § Interface Contracts
```

---

## 5. Data Structures Specification (`models.rs`)

All structs must derive `Serialize`, `Deserialize`, `Debug`, `Clone` with `#[serde(rename_all = "camelCase")]` to ensure seamless JSON interop with TypeScript interfaces.

```rust
use serde::{Deserialize, Serialize};

/// Physical rectangle representation for screen selection and OCR ROI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Bounding box representation for detected text elements.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Individual text item recognized by OCR engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrItem {
    pub text: String,
    pub confidence: f32,
    pub box_rect: BoundingBox,
}

/// Aggregated OCR output structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub items: Vec<OcrItem>,
    pub full_text: String,
}

/// Configuration payload for LLM API integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub provider: String,   // e.g. "DeepSeek", "OpenAI", "Ollama"
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
}

/// Result returned from translation pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub original: String,
    pub translated: String,
    pub source_tier: String, // e.g. "Preset", "LLM", "OnlineFallback"
}

/// Sampled background and computed foreground text colors for overlay rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSample {
    pub bg_color: String,   // Hex string, e.g. "#1e1e2e"
    pub text_color: String, // Calculated high-contrast text color, e.g. "#ffffff"
}

/// Toggle switches for preset dictionary domains.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetDicts {
    pub blender: bool,
    pub substance: bool,
    pub unity: bool,
}

/// Application setting state structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub hotkey: String,
    pub llm_config: LlmConfig,
    pub translation_tier_preference: String, // "PresetFirst", "LLMFirst", etc.
    pub preset_dicts: PresetDicts,
    pub dark_mode: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey: "Ctrl+Alt+D".to_string(),
            llm_config: LlmConfig {
                provider: "DeepSeek".to_string(),
                api_key: "".to_string(),
                endpoint: "https://api.deepseek.com/v1".to_string(),
                model: "deepseek-chat".to_string(),
            },
            translation_tier_preference: "PresetFirst".to_string(),
            preset_dicts: PresetDicts {
                blender: true,
                substance: true,
                unity: true,
            },
            dark_mode: true,
        }
    }
}

/// Thread-safe application state wrapper.
pub struct AppState {
    pub settings: std::sync::Mutex<AppSettings>,
}
```

---

## 6. IPC Command Implementations Plan (`commands.rs`)

Matches `PROJECT.md § Interface Contracts`:

```rust
use crate::models::*;
use tauri::State;

#[tauri::command]
pub async fn cmd_capture_and_ocr(selection: PhysicalRect) -> Result<OcrResult, String> {
    // M1 Stub: Returns mock OCR data
    Ok(OcrResult {
        items: vec![OcrItem {
            text: "Principled BSDF".to_string(),
            confidence: 0.99,
            box_rect: BoundingBox {
                x: selection.x,
                y: selection.y,
                width: selection.width.min(120),
                height: selection.height.min(30),
            },
        }],
        full_text: "Principled BSDF".to_string(),
    })
}

#[tauri::command]
pub async fn cmd_translate_phrases(
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<Vec<TranslationResult>, String> {
    // M1 Stub: Mock translations based on preset dictionary / LLM fallback
    let results = phrases
        .into_iter()
        .map(|phrase| {
            let translated = match phrase.as_str() {
                "Principled BSDF" => "原理化 BSDF (Principled BSDF)".to_string(),
                "Base Color" => "基础颜色 (Base Color)".to_string(),
                "Roughness" => "粗糙度 (Roughness)".to_string(),
                "Metallic" => "金属度 (Metallic)".to_string(),
                _ => format!("[Trans: {}]", phrase),
            };
            TranslationResult {
                original: phrase,
                translated,
                source_tier: if preset.is_empty() { "LLM".to_string() } else { "Preset".to_string() },
            }
        })
        .collect();
    Ok(results)
}

#[tauri::command]
pub async fn cmd_sample_colors(
    _image_crop: Vec<u8>,
    boxes: Vec<BoundingBox>,
) -> Result<Vec<ColorSample>, String> {
    // M1 Stub: Default dark background with crisp white text
    let samples = boxes
        .into_iter()
        .map(|_| ColorSample {
            bg_color: "#1e1e2e".to_string(),
            text_color: "#ffffff".to_string(),
        })
        .collect();
    Ok(samples)
}

#[tauri::command]
pub async fn cmd_save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    let mut lock = state.settings.lock().map_err(|e| e.to_string())?;
    *lock = settings;
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_settings(
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let lock = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}
```

---

## 7. System Tray and Global Hotkey Setup Design (`lib.rs`)

```rust
pub mod commands;
pub mod models;

use models::{AppSettings, AppState};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn setup_system_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_settings = MenuItem::with_id(app, "show_settings", "Show Settings", true, None::<&str>)?;
    let toggle_hotkey = MenuItem::with_id(app, "toggle_hotkey", "Toggle Hotkey", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_settings, &toggle_hotkey, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "show_settings" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "toggle_hotkey" => {
                println!("[System Tray] Toggle hotkey event triggered");
            }
            "quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Setup system tray
            setup_system_tray(app)?;

            // Register global shortcut (Ctrl+Alt+D)
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyD);
            let app_handle = app.handle().clone();

            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    println!("[Global Hotkey] Ctrl+Alt+D pressed");
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("shortcut-triggered", ());
                    }
                }
            })?;

            Ok(())
        })
        .manage(AppState {
            settings: std::sync::Mutex::new(AppSettings::default()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::cmd_capture_and_ocr,
            commands::cmd_translate_phrases,
            commands::cmd_sample_colors,
            commands::cmd_save_settings,
            commands::cmd_get_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 8. Implementation & Verification Roadmap
1. **Dependency Installation**: Update `app_v2/src-tauri/Cargo.toml` and run `cargo check` inside `app_v2/src-tauri/`.
2. **Configuration Updates**: Update `app_v2/src-tauri/tauri.conf.json` and `capabilities/default.json`.
3. **Module Implementation**:
   - Create `app_v2/src-tauri/src/models.rs` with unit tests for serde serialization.
   - Create `app_v2/src-tauri/src/commands.rs` with unit tests for IPC command stubs.
   - Update `app_v2/src-tauri/src/lib.rs` and `app_v2/src-tauri/src/main.rs`.
4. **Verification**: Run `cargo check` and `cargo test` from `app_v2/src-tauri/`. All tests must pass with 0 errors/warnings.
