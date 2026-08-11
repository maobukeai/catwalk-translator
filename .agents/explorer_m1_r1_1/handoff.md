# Handoff Report: Milestone 1 Tauri 2.0 Rust Backend Infra Plan

## 1. Observation
- **Root Files Inspected**:
  - `PROJECT.md` line 31–38 (IPC contracts), line 40–66 (Code layout)
  - `ORIGINAL_REQUEST.md` line 13–15 (R1 requirements)
  - `sub_orch_m1/SCOPE.md` line 14–36 (M1 deliverables & IPC stubs)
- **`app_v2` Current Setup Inspected**:
  - `app_v2/src-tauri/Cargo.toml` lines 20–25 (Dependencies: `tauri`, `tauri-plugin-opener`, `serde`, `serde_json`)
  - `app_v2/src-tauri/tauri.conf.json` lines 1–35 (Basic configuration for app_v2 window and build paths)
  - `app_v2/src-tauri/capabilities/default.json` lines 6–9 (Permissions: `core:default`, `opener:default`)
  - `app_v2/src-tauri/src/lib.rs` lines 1–15 (Default `greet` command and runner)
  - `app_v2/src-tauri/src/main.rs` lines 1–7 (Main entry delegating to `app_v2_lib::run()`)
- **Legacy Code Base**:
  - Python scripts in `core/` (`capture.py`, `ocr.py`, `translator.py`, `sampler.py`, `overlay.py`) representing legacy features.

---

## 2. Logic Chain
1. **Requirement Mapping**: `SCOPE.md` and `PROJECT.md` require standard Tauri 2.0 desktop shell setup with:
   - System tray menu (`Show Settings`, `Toggle Hotkey`, `Quit`).
   - Global hotkey handler (`tauri-plugin-global-shortcut`, defaulting to `Ctrl+Alt+D`).
   - 5 IPC commands: `cmd_capture_and_ocr`, `cmd_translate_phrases`, `cmd_sample_colors`, `cmd_save_settings`, `cmd_get_settings`.
2. **Dependency Gap**: Existing `Cargo.toml` in `app_v2/src-tauri` lacks `tauri-plugin-global-shortcut`, `tokio`, and `tray-icon` feature for `tauri`. `tauri.conf.json` lacks window styling and `capabilities/default.json` lacks `global-shortcut:default` permission.
3. **Module Architecture Design**:
   - `models.rs`: Defines serde-serializable structs (`PhysicalRect`, `BoundingBox`, `OcrItem`, `OcrResult`, `LlmConfig`, `TranslationResult`, `ColorSample`, `PresetDicts`, `AppSettings`, `AppState`) using `camelCase` renaming to match frontend TypeScript definitions seamlessly.
   - `commands.rs`: Implements thread-safe async IPC command handlers for all 5 endpoints.
   - `lib.rs`: Registers plugins (`tauri-plugin-global-shortcut`, `tauri-plugin-opener`), builds system tray, initializes global hotkey listener (`Ctrl+Alt+D`), manages `AppState`, and registers generate_handler! macro.
   - `main.rs`: Entry point delegating execution to `app_v2_lib::run()`.

---

## 3. Caveats
- **Dependencies Installation**: The implementer agent will need to update `Cargo.toml` and run `cargo check` / `cargo test` in `app_v2/src-tauri/` to ensure all crates compile cleanly.
- **Icon Assets**: Tray icon setup uses `app.default_window_icon()` or standard Tauri icons (`icons/icon.ico` / `32x32.png`); custom tray icons can be updated in M4 if needed.

---

## 4. Conclusion
The technical setup plan for Milestone 1 Rust backend infrastructure (`app_v2/src-tauri/`) is fully specified in `analysis.md`. The design fulfills all IPC contracts, provides modular `models.rs` and `commands.rs` separation, and configures Tauri 2.0 system tray and global hotkey integration cleanly.

---

## 5. Verification Method
To independently verify the implementation once executed by implementer:
1. Navigate to `app_v2/src-tauri/`.
2. Execute `cargo check` to verify zero compilation errors/warnings.
3. Execute `cargo test` to verify model serialization and IPC stub tests pass 100%.
