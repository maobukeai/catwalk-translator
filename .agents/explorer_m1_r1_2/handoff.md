# Handoff Report — Frontend React 18 + Vite + TailwindCSS Structure & Settings UI Design (M1)

**Agent**: explorer_m1_r1_2  
**Target Path**: `app_v2/src/`  
**Date**: 2026-08-09  

---

## 1. Observation

1. **Existing Frontend Dependencies (`app_v2/package.json`)**:
   - `react` (`^19.1.0`), `react-dom` (`^19.1.0`), `vite` (`^7.0.4`), `@vitejs/plugin-react` (`^4.6.0`).
   - `tailwindcss` (`^4.3.3`), `autoprefixer` (`^10.5.4`), `postcss` (`^8.5.26`).
   - `zustand` (`^5.0.14`), `lucide-react` (`^1.30.0`), `clsx` (`^2.1.1`), `tailwind-merge` (`^3.6.0`).
   - `@tauri-apps/api` (`^2`), `@tauri-apps/plugin-opener` (`^2`), `@tauri-apps/cli` (`^2`).
2. **Directory Structure (`app_v2/src/`)**:
   - Existing directories: `components`, `services`, `store`, `types`, `assets`.
   - Existing files: `App.tsx` (default Tauri template), `App.css`, `main.tsx`, `vite-env.d.ts`.
   - Subdirectories `components/`, `services/`, `store/`, and `types/` are currently empty and ready for implementation.
3. **IPC Contracts (`PROJECT.md § Interface Contracts` & `SCOPE.md`)**:
   - `cmd_get_settings() -> AppSettings`
   - `cmd_save_settings(settings: AppSettings) -> ()`
   - `cmd_translate_phrases(phrases: Vec<String>, preset: String, llm_config: Option<LlmConfig>) -> Vec<TranslationResult>`

---

## 2. Logic Chain

1. **Observation**: `app_v2/package.json` contains `react^19.1.0`, `tailwindcss^4.3.3`, `zustand^5.0.14`, and `lucide-react^1.30.0`.
2. **Step 1**: React 19 is backward compatible with React 18 functional components and hooks (`useState`, `useEffect`, `useCallback`, `useMemo`). Vite configuration in `vite.config.ts` uses `@vitejs/plugin-react`.
3. **Step 2**: TailwindCSS v4 uses `@import "tailwindcss";` in `src/index.css`. Adding Fluent Design dark mode CSS variables (`--bg-app`, `--bg-surface`, `--accent-blue`) and acrylic utility classes (`.fluent-glass`, `.fluent-card`, `.fluent-input`) provides a clean Windows 11 style dark UI.
4. **Step 3**: Tauri IPC commands `cmd_get_settings` and `cmd_save_settings` use Rust snake_case formats. Creating `app_v2/src/services/tauriIpc.ts` maps these to TypeScript camelCase `AppSettings` while providing a seamless `localStorage` browser mock fallback when running in standard Vite dev server mode outside Tauri (`!window.__TAURI_INTERNALS__`).
5. **Step 4**: Zustand 5 store `useSettingsStore` centralizes settings state, initial state dirty tracking (`isDirty`), async fetch/save operations, LLM connection testing (`testLlmConnectionApi`), provider switching with default endpoint auto-fill, tier priority reordering, and toast notifications.
6. **Step 5**: The Settings Dashboard visual component hierarchy under `app_v2/src/components/Settings/` isolates tab views (`ShortcutSection`, `LlmConfigSection`, `TierPipelineSection`, `PresetDictSection`) and reusable primitives (`KeyRecorder`, `Switch`, `Input`, `Select`, `Card`, `Button`, `Toast`), enabling clean testability and modular maintenance.

---

## 6. Caveats

- **Tauri Runtime Environment**: When running in standard web browser (`npm run dev`), Tauri IPC calls fall back to `localStorage` mock. Full native hotkey registration requires running inside Tauri container (`npm run tauri dev`).
- **Font Rendering**: Fluent Design defaults to system font stack (`Segoe UI`, system-ui). Text rendering optimization rules are specified in `index.css`.

---

## 4. Conclusion

The React 18 + Vite + TailwindCSS frontend structure for Milestone 1 is completely designed and specified in `analysis.md`. The design fulfills all requirements of `R1` (Modern Desktop Container & Fluent UI) and `SCOPE.md`:
- Detailed data contracts in `app_v2/src/types/settings.ts`.
- IPC service abstraction with dev fallback in `app_v2/src/services/tauriIpc.ts`.
- Zustand store state management in `app_v2/src/store/useSettingsStore.ts`.
- Fluent Design dark UI component tree under `app_v2/src/components/Settings/` and `app_v2/src/components/Common/`.
- Interactive Hotkey Recorder, LLM Configurator with connection test latency badge, Translation Tier Pipeline reordering selector, and CG Dictionary toggles with live dictionary lookup tester.

---

## 5. Verification Method

To independently verify the implementation once coded:

1. **TypeScript Typecheck**:
   ```bash
   cd app_v2
   npm run build
   ```
   *Expected Output*: Clean build with zero TypeScript compilation errors or warnings.

2. **Web Browser Dev & Mock Test**:
   ```bash
   cd app_v2
   npm run dev
   ```
   - Open browser at `http://localhost:1420`.
   - Verify Settings Dashboard loads with dark acrylic theme.
   - Click "Record Shortcut" and press key combo (e.g. `Ctrl+Alt+S`).
   - Switch LLM providers (DeepSeek -> Ollama -> Custom) and check endpoint auto-fill.
   - Click "Test Connection" and verify response latency badge.
   - Reorder translation tiers and toggle dictionary switches.
   - Click "Save Changes" and verify toast notification and `localStorage` update.

3. **Tauri IPC Command Integration Check**:
   Verify `cmd_get_settings` and `cmd_save_settings` payload structures match Rust struct definitions in `src-tauri/src/commands.rs`.
