## 2026-08-09T00:47:49Z

You are worker_m1_r2_1 (teamwork_preview_worker).
Working directory: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\worker_m1_r2_1

Your task is to execute the complete remediation strategy for Milestone 1 (Iteration 2).

Read the following reference documents first:
- ORIGINAL_REQUEST.md: c:\Users\20269\Desktop\项目文件夹\翻译软件\ORIGINAL_REQUEST.md
- Scope document: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\sub_orch_m1\SCOPE.md
- Project document: c:\Users\20269\Desktop\项目文件夹\翻译软件\PROJECT.md
- Rust Explorer Handoff: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\e2e_m1_it2_explorer_rust\handoff.md
- React Explorer Handoff: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\e2e_m1_it2_explorer_react\handoff.md

REMEDIATION ACTION ITEMS:

1. Rust Visibility & Re-exports (`app_v2/src-tauri`):
   - In `app_v2/src-tauri/src/capture.rs`: Make `pub use crate::models::PhysicalRect;` public on Line 1.
   - In `app_v2/src-tauri/src/commands.rs`: Make `pub use crate::models::{AppSettings, BoundingBox, ColorSample, LlmConfig, OcrResult, PhysicalRect, TranslationResult};` public on Lines 1-3.

2. Provider Default Endpoint Bug Fix (`app_v2/src/components/Settings/SettingsDashboard.tsx`):
   - Update `handleProviderChange` in `SettingsDashboard.tsx` so that when provider changes (e.g. to OpenAI), `endpoint` and `model` update to `defaults.endpoint` and `defaults.model` (instead of retaining existing `settings.llmConfig?.endpoint`).

3. Non-Tautological Rust Test Suite (`app_v2/src-tauri/tests/tier1_feature_coverage.rs`):
   - Replace the entire content of `app_v2/src-tauri/tests/tier1_feature_coverage.rs` with the non-tautological 32-test suite detailed in Section 4.3 of `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\e2e_m1_it2_explorer_rust\handoff.md`.

4. React Test Suite & Harness Refactoring (`app_v2/src`):
   - Refactor `app_v2/src/tests/harness/tauriIpcMock.ts` to import canonical types (`AppSettings`, `OcrResult`, `ColorSample`, `TranslationResult`, `LlmConfig`, `PresetDicts`) from `../../services/types` and update default mock state to match.
   - Refactor `app_v2/src/tests/tier1_features.test.tsx` to completely remove all inlined helper functions (`logicalToPhysical`, `clusterLines`, `mergeWordBoxes`, etc.) and local dummy components (`SimpleOverlayCard`).
   - In `tier1_features.test.tsx`, import real components (`SettingsDashboard`), stores (`useSettingsStore`), and services (`services/tauri.ts`). Re-implement all 32 tests to test real React components, Zustand store state transitions, and IPC service wrappers.

5. Build & Test Verification:
   - Run `cargo test --manifest-path app_v2/src-tauri/Cargo.toml`
   - Run `npm --prefix app_v2 test -- --run`
   - Ensure ALL tests pass cleanly with exit code 0.
