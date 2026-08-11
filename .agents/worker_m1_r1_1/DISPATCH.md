## 2026-08-08T16:23:47Z
You are worker_m1_r1_1 (teamwork_preview_worker).
Your working directory is `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\worker_m1_r1_1`.
Please create your working directory metadata files as needed.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY INPUT FILES TO READ FIRST:
- ORIGINAL_REQUEST.md: `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\ORIGINAL_REQUEST.md`
- PROJECT.md: `c:\Users\20269\Desktop\项目文件夹\翻译软件\PROJECT.md`
- SCOPE.md: `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\sub_orch_m1\SCOPE.md`
- Explorer 1 Handoff (Rust Tauri Infra): `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_m1_r1_1\handoff.md`
- Explorer 2 Handoff (React Fluent UI): `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_m1_r1_2\handoff.md`
- Explorer 3 Handoff (IPC & Types): `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_m1_r1_3\handoff.md`

Objective:
Implement Milestone 1: Tauri 2.0 Infra & React 18 UI Skeleton in `app_v2/`.

Deliverables to implement:
1. Rust Backend (`app_v2/src-tauri/`):
   - Update `Cargo.toml` and `tauri.conf.json` for Tauri 2.0 with `tauri-plugin-global-shortcut`, tray menu, capabilities.
   - Implement `src-tauri/src/models.rs` containing `AppSettings`, `PhysicalRect`, `OcrResult`, `LlmConfig`, `TranslationResult`, `BoundingBox`, `ColorSample`.
   - Implement `src-tauri/src/commands.rs` containing all 5 Tauri IPC command stubs matching `PROJECT.md § Interface Contracts`:
     - `cmd_capture_and_ocr`
     - `cmd_translate_phrases`
     - `cmd_sample_colors`
     - `cmd_save_settings`
     - `cmd_get_settings`
   - Implement `src-tauri/src/lib.rs` and `src-tauri/src/main.rs` with System Tray setup (menu: Show Settings, Toggle Hotkey, Quit) and global hotkey listener (`Ctrl+Alt+D`).
2. React 18 Frontend (`app_v2/src/`):
   - `src/services/types.ts`: TypeScript type definitions matching Rust models 1:1 (`camelCase` serialized).
   - `src/services/tauri.ts`: IPC wrapper service invoking `@tauri-apps/api/core` with browser mock fallback.
   - `src/stores/useSettingsStore.ts`: Zustand store managing settings state, dirty tracking, async sync with backend.
   - `src/components/Settings/`: Fluent Design & Dark Mode Settings Dashboard:
     - Shortcut key configuration (`Ctrl+Alt+D` default).
     - LLM API key, provider (DeepSeek / OpenAI / Ollama / Custom), and endpoint configuration.
     - Translation tier preference reordering (Preset -> LLM -> Online Fallback).
     - Preset dictionary toggle switches (Blender, Substance, Unity).
3. Verification:
   - Run `npm run build` inside `app_v2/`.
   - Run `cargo check` inside `app_v2/src-tauri/`.
   - Verify that builds succeed without errors.

Write your changes summary and handoff report to `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\worker_m1_r1_1\handoff.md`. Communicate back when complete.
