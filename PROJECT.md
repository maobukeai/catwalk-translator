# Project: CG AI Screenshot Translator (Tauri 2.0 + React 19 + RapidOCR ONNX)

## Architecture
- **Desktop Container**: Tauri 2.0 (Rust) + Tokio async runtime. Single-frameless-window design: the main window doubles as the full-screen capture overlay (`cmd_show_overlay`), plus a Spotlight mini-window and a pin (钉图) window.
- **Frontend App**: React 19 + Vite 7 + TailwindCSS 4 + Zustand + Lucide Icons. Liquid-Glass light/dark theming via CSS variables (`useAppTheme`).
- **OCR Engine**: three tiers — native Rust ONNX (`ort` crate, PP-OCRv3/v4/v5 det+rec, downloaded on demand), Windows WinRT OCR (zero-model), and a legacy RapidOCR Python daemon fallback. Routing via the `ocr_engine` setting ("auto" | "onnx" | "winrt").
- **Coordinate Mapper**: "BMP size ÷ overlay viewport size" geometric self-calibration (see `logical_selection_to_physical`), DPI hints only as fallback — correct across mixed-DPI multi-monitor setups.
- **Translation Pipeline**: Multi-Tier Engine (Preset JSON Dictionaries → General Dict → LLM APIs [DeepSeek/OpenAI/Ollama/智谱/Custom] → Free Online APIs [Google/Bing/有道/DeepL/腾讯/MyMemory/百度]), with a FIFO translation memo (500 entries) that skips the network for unchanged watch-region text.
- **Overlay System**: single React overlay (selection mask + in-place translated cards). Cards render on top of "erased patches" — per-block background-interpolation PNGs built by `inpaint.rs` (dual-axis lerp, neighbour-clamped) — with AABB collision avoidance and real glyph-colour sampling.
- **Backup & Sync**: `backup.rs` zips settings/history/capture-sessions with a manifest (local auto-backup thread + retention); `webdav.rs` syncs them to any WebDAV service (坚果云 et al.) with PROPFIND/MKCOL/PUT/GET/DELETE and cloud retention cleanup.
- **Auto Update**: GitHub Releases checker + downloader (`updater.rs`).
- **Persistence**: `%APPDATA%\com.maobukeai.catwalk\` — `settings.json` / `history.json` / `capture_sessions.json` / `backups/` / `models/` / `offline_models/`. All writes go through in-memory `AppState` (Mutex) + immediate full-file rewrite.

## Feature Inventory
Every feature from requirements and existing codebase analysis is assigned to a milestone below:
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | F1. Modern Desktop Container & UI | Tauri 2.0 shell, React 19 Fluent/Dark UI, Settings Panel, System Tray, Global Hotkeys | M1 | R1, ORIGINAL_REQUEST |
| 2 | F2. High-DPI Capture & Coordinate Engine | Multi-monitor screen capture, PhysicalPosition/PhysicalSize scale_factor mapping (<1px error) | M2 | R2, A1 |
| 3 | F3. RapidOCR ONNX & Reconstruction Engine | Rust `ort` ONNX Runtime, DBNet det + SVTR rec, text line clustering, word merging | M2 | R2 |
| 4 | F4. Multi-Tier Translation Engine & CG Dictionaries | Preset dicts (blender.json, substance.json, unity.json), LLM API (DeepSeek/OpenAI/Ollama), Online Fallback API | M3 | R3, A1 |
| 5 | F5. Color Sampling & Canvas/Web Overlay | Outer ring 4px median RGB background sampler, perceived brightness contrast text, React DOM cards | M4 | R1, R2 |
| 6 | F6. E2E Test Suite & Adversarial Hardening | Category-Partition, BVA, Pairwise, Workload E2E tests (cargo test + npm test) | M5 | R4, A2 |
| 7 | F7. Vocabulary & Review | 生词本 history, favourites, Leitner flashcard review, Anki/CSV export, capture-session replay | — | post-M5 |
| 8 | F8. AI Chat & TTS | Multi-model LLM chat (streaming), TTS speech, translation-style control (直译/意译/术语) | — | post-M5 |
| 9 | F9. Backup & WebDAV Sync | Local auto-backup + retention, zip export/import, WebDAV cloud sync with retention cleanup | — | post-M5 |
| 10 | F10. Auxiliary | Pin window (钉图), clipboard silent translate + clipboard history, general dictionary, network diagnose, auto-update, proxy settings, always-on-top | — | post-M5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|------|-------|-------|-------------|--------|
| 1 | M1: Tauri 2.0 Infra & UI Skeleton | Setup Tauri 2.0 app, React 19 settings UI, Fluent/Dark theme, system tray, global hotkeys | none | DONE |
| 2 | M2: High-DPI Capture & RapidOCR ONNX Engine | Implement Rust multi-monitor capture, DPI scale factor coordinate mapper, ONNX `ort` RapidOCR engine & line reconstructor | M1 | DONE |
| 3 | M3: Multi-Tier Translation Pipeline & Dictionaries | Implement CG dicts (Blender/Substance/Unity JSONs), LLM APIs bridge, Online API fallbacks, tier selector | M1 | DONE |
| 4 | M4: Color Sampler & Interactive Canvas/Web Overlay | Rust background color sampler & contrast calculator, React 19 Canvas 2D + DOM overlay card component | M2, M3 | DONE |
| 5 | M5: E2E Testing, Adversarial Hardening & Portable Build | 100% E2E test pass (cargo test + npm test), Tier 5 adversarial hardening, portable EXE build <40MB, startup <500ms | M1, M2, M3, M4 | IN_PROGRESS (S1 portable PASSED: 39.8MB, 151.5ms cold-start; S2 E2E + S3 hardening pending) |

## Interface Contracts
### Rust Backend ↔ React Frontend (Tauri IPC)
The canonical command registry is the `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (~50 commands). Command groups by module:

- `commands.rs` — settings (`cmd_get/save_settings`), translation (`cmd_translate_phrases[_styled]`, `cmd_universal_translate`, `cmd_query_text`), offline engine wrappers, window/exit.
- `commands_capture.rs` — `cmd_begin_capture` / `cmd_show_overlay` / `cmd_close_overlay`, `cmd_region_ocr_layout` / `cmd_region_ocr_translate` / `cmd_capture_and_ocr`, `cmd_watch_tick`, `cmd_snap_region`, `cmd_hover_lookup`, `cmd_copy/save_region_image`, `cmd_image_ocr_translate`, `cmd_sample_colors`.
- `commands_chat.rs` — `cmd_fetch_llm_models`, `cmd_chat_llm`, `cmd_chat_llm_stream`.
- `commands_history.rs` — history CRUD (`cmd_get/add/toggle_favorite/delete/clear_history`), `cmd_export_anki`, capture-session CRUD.
- `backup.rs` / `webdav.rs` — local backup CRUD + export/import (base64), WebDAV test/upload/list/restore/delete.
- `offline_models.rs`, `updater.rs`, `diagnose.rs`, `general_dict.rs`, `clipboard_history.rs`, `pin.rs` — self-contained feature commands.

Conventions: every command returns `Result<T, String>`; Rust structs use `#[serde(rename_all = "camelCase")]`; the frontend mirror types live in `src/services/types.ts` and wrappers in `src/services/tauri.ts` (browser/test fallback included); new commands must also get a safe-default branch in `src/tests/harness/tauriIpcMock.ts`.

## Code Layout
```
app_v2/
├── src-tauri/src/
│   ├── lib.rs               # module registry, window/tray setup, hotkeys, generate_handler!
│   ├── commands.rs          # AppState + persistence + settings/translate commands (re-exports submodules)
│   ├── commands_capture.rs  # 截图/选区/OCR 区域/overlay 窗口/watch 命令 + 几何映射
│   ├── commands_chat.rs     # LLM 模型列表/对话/流式对话
│   ├── commands_history.rs  # 生词本历史/截图会话/Anki 导出
│   ├── capture.rs           # GDI 全虚拟屏截图 + 区域静默刷新(watch 用)
│   ├── ocr.rs / onnx_ocr.rs # OCR 引擎路由 / ONNX det+rec 推理
│   ├── reconstruction.rs    # 行聚类(邻居感知)与词合并(多行 \n 拆分)
│   ├── inpaint.rs           # 抹除补丁(双向插值 + 邻块钳制)、文字色采样
│   ├── sampler.rs           # 外环中值背景色采样
│   ├── translator.rs        # 多级翻译流水线、LLM/在线引擎桥接
│   ├── backup.rs / webdav.rs# 本地备份/导出导入 / WebDAV 云同步
│   ├── offline.rs / offline_models.rs  # 离线词条引擎 / OCR 模型下载管理
│   ├── clipboard_watch.rs / clipboard_history.rs  # 被动剪贴板监听 / 剪贴板历史
│   ├── general_dict.rs / pin.rs / diagnose.rs / app_detect.rs / updater.rs
│   └── models.rs            # 所有 IPC 数据结构(camelCase serde)
└── src/
    ├── components/
    │   ├── MainWindow/      # DualPaneTranslator(主翻译视图)、AiChatPanel、SearchPanel、AboutPanel
    │   ├── Overlay/         # CaptureOverlay(状态机)、OverlayBlockCard、SnippingToolbar、
    │   │                    # YoudaoResultPanel、translationMemo、CheatSheetModal
    │   ├── Settings/        # SettingsDashboard(外壳:导航/保存栏/Toast)+ panels/
    │   │   │                # AppearancePanel/HotkeyPanel/OnlinePanel/DictsPanel/
    │   │   │                # PreferencePanel + useLlmPanelState(共享 LLM hook)
    │   │   └── BackupSyncPanel.tsx / OcrModelsCard.tsx
    │   ├── Vocabulary/      # HistoryPanel(生词本/复习/回放)
    │   ├── Pin/  Common/    # 钉图窗口 / 共享控件
    ├── stores/useSettingsStore.ts   # Zustand(applyPatch 统一 patch 模式)
    ├── services/            # tauri.ts(IPC 封装)、types.ts、defaultSettings.ts(单一来源)、
    │                        # hotkeys、tts、langDetect、overlayLayout(AABB)、exportImage
    ├── hooks/               # useAppTheme、useOcrStatus
    └── tests/               # 27 个 vitest 文件(~221 用例)+ harness/tauriIpcMock.ts
```

## Extension Guide
### Add a Tauri command
1. Implement `#[tauri::command] pub async fn cmd_xxx(...) -> Result<T, String>` in the matching domain module (`commands_capture/chat/history` or a feature module); new structs go in `models.rs` with `#[serde(rename_all = "camelCase")]`.
2. `commands.rs` re-exports the domain modules — feature modules need explicit `pub use` or direct `module::cmd_xxx` in `lib.rs`'s `generate_handler!`.
3. Frontend: add the wrapper in `services/tauri.ts` (keep the `isTauri()` browser fallback) and types in `services/types.ts`; add a safe-default branch in `tests/harness/tauriIpcMock.ts`.

### Add a settings section
Create `components/Settings/panels/XxxPanel.tsx` (own local state + `useSettingsStore` subscription), register it in `SettingsDashboard`'s `categories` array and render block. Shared cross-panel logic belongs in a hook (see `useLlmPanelState`).

### Add a settings field
Add the field to `models.rs::AppSettings` (`Option<T>` + `#[serde(default)]`, update `Default`) and `types.ts::AppSettings`; normalize defaults in `useSettingsStore.fetchSettings`; expose a one-line `setXxx: (v) => applyPatch({ xxx: v })` action.

### Verification loop
`cargo check` + `cargo test --lib` (src-tauri) · `npx tsc --noEmit` + `npm test` (app_v2).
