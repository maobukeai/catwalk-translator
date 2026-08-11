## Scope: Milestone 1 - Tauri 2.0 Infra & React 18 UI Skeleton (`app_v2/`) [DONE]

## Architecture
- **Desktop Shell**: Tauri v2 (Rust) with `tauri-plugin-global-shortcut`, system tray, IPC commands.
- **Frontend App**: React 18 + Vite + TailwindCSS + Zustand + Lucide Icons.
- **UI Components**: Dark Mode & Fluent Design settings panel (hotkey config, LLM API key/endpoint config, translation tier preference, preset dict toggle).
- **IPC Interface**: Rust command stubs & TS types matching `PROJECT.md § Interface Contracts`.

## Feature Inventory (M1 Scope)
| # | Feature | Description | Milestone | Status | Source |
|---|---------|-------------|-----------|--------|--------|
| 1 | F1. Modern Desktop Container & UI | Tauri 2.0 shell, React 18 Fluent/Dark UI, Settings Panel, System Tray, Global Hotkeys | M1 | DONE | R1, ORIGINAL_REQUEST |

## Deliverables Checklist
- [x] Complete `app_v2/` Tauri 2.0 + React 18 (Vite + TailwindCSS) project setup.
- [x] Dark mode & Fluent Design settings dashboard:
  - Global shortcut key configuration (default e.g. `Ctrl+Alt+D`).
  - LLM API key, provider (DeepSeek/OpenAI/Ollama), and endpoint URL configuration.
  - Translation tier preference (Preset -> LLM -> Online Fallback).
  - Preset dictionary toggle switches (Blender, Substance, Unity).
- [x] Tauri system tray setup with context menu options (Show Settings, Toggle Hotkey, Quit).
- [x] Global shortcut listener setup using Tauri global shortcut plugin / API.
- [x] Tauri IPC command stubs in Rust (`commands.rs`) and matching TypeScript IPC definitions:
  - `cmd_capture_and_ocr`
  - `cmd_translate_phrases`
  - `cmd_sample_colors`
  - `cmd_save_settings`
  - `cmd_get_settings`

## Interface Contracts (M1 IPC Stubs)
- `cmd_capture_and_ocr(selection: PhysicalRect) -> Result<OcrResult, String>`
- `cmd_translate_phrases(phrases: Vec<String>, preset: String, llm_config: Option<LlmConfig>) -> Result<Vec<TranslationResult>, String>`
- `cmd_sample_colors(image_crop: Vec<u8>, boxes: Vec<BoundingBox>) -> Result<Vec<ColorSample>, String>`
- `cmd_save_settings(settings: AppSettings) -> Result<(), String>`
- `cmd_get_settings() -> Result<AppSettings, String>`
