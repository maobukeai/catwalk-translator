# Analysis & Handoff Report — React/TypeScript Tier 1 Test Suite & Harness Refactoring

- **Agent ID**: `e2e_m1_it2_explorer_react`
- **Role**: Explorer subagent (React / TypeScript Specialist)
- **Target Files**: `app_v2/src/tests/tier1_features.test.tsx` & `app_v2/src/tests/harness/tauriIpcMock.ts`
- **Context**: Forensic audit failure remediation (Iterative Phase 2)

---

## 1. Observation

### 1.1 `tier1_features.test.tsx` Audit Findings
1. **Zero Imports from Application Code**:
   - `app_v2/src/tests/tier1_features.test.tsx` (lines 1–12) imports `@testing-library/react`, `vitest`, `react`, `@tauri-apps/api/core`, and `./harness/tauriIpcMock`.
   - It does **NOT** import `SettingsDashboard.tsx` (`app_v2/src/components/Settings/SettingsDashboard.tsx`), `useSettingsStore.ts` (`app_v2/src/stores/useSettingsStore.ts`), or IPC service wrappers (`app_v2/src/services/tauri.ts`).
2. **Inlined Local Functions & Dummy Components**:
   - Lines 31–215 define 15 local domain functions (`logicalToPhysical`, `normalizeSelection`, `clampToScreen`, `validateCropBox`, `validateOcrTensorInput`, `clusterLines`, `mergeWordBoxes`, `formatLlmPayload`, `resolveTranslationTier`, `calculateMedianRgb`, `calculatePerceivedBrightness`, `getContrastTextColor`, `generateTestReport`, `generateMockOcrResult`, `loadMockDictionaries`) directly in the test file.
   - Lines 218–245 define a dummy React component `SimpleOverlayCard` inside the test file.
   - The 32 tests in `tier1_features.test.tsx` test these local dummy functions/components instead of testing production code in `app_v2/src/`.
3. **Tautological Assertions**:
   - Tests assert on local variables mutated inside test callbacks (e.g. `let trayState = { visible: true }; trayState.visible = !trayState.visible; expect(trayState.visible).toBe(false)`).

### 1.2 `tauriIpcMock.ts` Type Contract Mismatch
1. **Outdated `AppSettings` Interface**:
   - In `app_v2/src/tests/harness/tauriIpcMock.ts` (lines 3–10):
     ```ts
     export interface AppSettings {
       theme: 'dark' | 'light' | 'fluent';
       presetDict: 'blender' | 'substance' | 'unity';
       llmProvider: 'deepseek' | 'openai' | 'ollama';
       apiKey: string;
       hotkey: string;
       autoTranslate: boolean;
     }
     ```
   - In contrast, the canonical application interface in `app_v2/src/services/types.ts` is:
     ```ts
     export interface AppSettings {
       theme: string;
       hotkey: string;
       defaultPreset: string;
       llmConfig: LlmConfig | null;
       translationTiers: string[];
       presetDicts: PresetDicts;
     }
     ```
2. **Data Model Divergence**:
   - `TextBlock` in `tauriIpcMock.ts` uses `box` instead of `boxRect`.
   - `ColorSample` in `tauriIpcMock.ts` uses `bg_rgb` and `text_color` instead of `boxRect`, `backgroundRgb`, and `textColor`.
   - This type mismatch prevents real application components (`SettingsDashboard`) and Zustand stores (`useSettingsStore`) from consuming mock IPC responses without runtime exceptions.

### 1.3 Production Bug Identified in `SettingsDashboard.tsx`
- In `app_v2/src/components/Settings/SettingsDashboard.tsx` (lines 73–81):
  ```ts
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    const defaults = PROVIDER_DEFAULT_ENDPOINTS[newProvider] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
    setLlmConfig({
      provider: newProvider,
      endpoint: settings.llmConfig?.endpoint || defaults.endpoint,
      model: settings.llmConfig?.model || defaults.model,
    });
  };
  ```
- **Bug**: When switching `provider` (e.g. from DeepSeek to OpenAI), `settings.llmConfig?.endpoint` is already set (`https://api.deepseek.com/v1`). The expression `settings.llmConfig?.endpoint || defaults.endpoint` evaluates to the existing string, preventing the endpoint from updating to OpenAI's default (`https://api.openai.com/v1`). Same for `model`.

---

## 2. Logic Chain

1. **Why Refactoring `tauriIpcMock.ts` is Required**:
   - Real components (`SettingsDashboard`) and stores (`useSettingsStore`) call `cmdGetSettings` and `cmdSaveSettings` expecting the canonical `AppSettings` interface from `app_v2/src/services/types.ts`.
   - Aligning `tauriIpcMock.ts` by importing `AppSettings`, `OcrResult`, `ColorSample`, `TranslationResult`, `LlmConfig`, and `PresetDicts` directly from `../../services/types` ensures full type safety and contract compatibility.

2. **Why Refactoring `tier1_features.test.tsx` is Required**:
   - The test suite must test actual application code rather than self-declared dummy functions and components.
   - Completely deleting the 15 local inline helper functions and `SimpleOverlayCard` dummy component eliminates circular tautology.
   - Importing `SettingsDashboard`, `useSettingsStore`, and `services/tauri.ts` allows testing real UI rendering, user interaction, Zustand state changes, and IPC mock invocations.

3. **Concrete Test Mapping Strategy for Tier 1 Features (32 Tests)**:

   - **Feature F1: Modern Desktop Container & UI (6 Tests)**:
     - `F1-1`: Render `<SettingsDashboard />`, verify initial layout title ("CG AI Screenshot Translator") and header controls.
     - `F1-2`: Test hotkey recording mode on `<SettingsDashboard />` using `fireEvent.click` on Record button and `fireEvent.keyDown` with modifier keys (`Ctrl+Alt+Shift+K`), verifying `useSettingsStore.getState().settings.hotkey` updates.
     - `F1-3`: Test reset settings button interaction on `<SettingsDashboard />` when state is dirty, confirming store state reverts to initial values.
     - `F1-4`: Test `saveSettings` action on `<SettingsDashboard />` by changing input fields and clicking Save Settings, verifying IPC mock intercepts `cmd_save_settings` with the updated payload.
     - `F1-5`: Test initial loading state on `<SettingsDashboard />` when `fetchSettings` is in flight (`isLoading: true`).
     - `F1-6`: Test dark mode background and CSS styling on rendered container elements.

   - **Feature F2: High-DPI Capture & Coordinate Engine (5 Tests)**:
     - `F2-1` to `F2-5`: Invoke `cmdCaptureAndOcr({ x: 100, y: 200, width: 300, height: 150 })` from `app_v2/src/services/tauri.ts`. Verify IPC harness `getActiveHarness()!.state.invokedCommands` receives the correct `selection` physical rect and returns structured `OcrResult` with `boxRect`.

   - **Feature F3: RapidOCR ONNX & Line Reconstruction Engine (5 Tests)**:
     - `F3-1` to `F3-5`: Test `cmdCaptureAndOcr` responses. Verify block bounding rect (`boxRect`), confidence metrics, block text array handling, and coordinate bounding structures.

   - **Feature F4: Multi-Tier Translation Engine & CG Dictionaries (6 Tests)**:
     - `F4-1` to `F4-6`: Invoke `cmdTranslatePhrases(['Principled BSDF', 'AO Mixing Mode', 'Unknown Term'], 'blender', llmConfig)` from `app_v2/src/services/tauri.ts`. Verify exact dictionary phrase lookup, fallback responses, and `useSettingsStore.getState().moveTier` tier reordering action.

   - **Feature F5: Color Sampler & Settings Controls (5 Tests)**:
     - `F5-1` to `F5-5`: Test `cmdSampleColors(new Uint8Array([1, 2, 3]), [boxRect])` from `app_v2/src/services/tauri.ts`. Test API key show/hide password toggle on `<SettingsDashboard />` via eye icon button. Test preset dictionary toggle switches (`blender`, `substance`, `unity`) on `<SettingsDashboard />`.

   - **Feature F6: E2E Test Suite & Harness Verification (5 Tests)**:
     - `F6-1` to `F6-5`: Test IPC mock command recording (`invokedCommands`), `cmdGetSettings` / `cmdSaveSettings` IPC round-trip, Zustand store state reset (`resetSettings`), and clean toast notification management (`clearToast`).

4. **Fix Strategy for `SettingsDashboard.tsx` Provider Selection Bug**:
   - Modify `handleProviderChange` in `app_v2/src/components/Settings/SettingsDashboard.tsx`:
     ```ts
     const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
       const newProvider = e.target.value;
       const defaults = PROVIDER_DEFAULT_ENDPOINTS[newProvider] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
       setLlmConfig({
         provider: newProvider,
         endpoint: defaults.endpoint,
         model: defaults.model,
       });
     };
     ```
   - In `tier1_features.test.tsx`, add test assertion for provider selection change (`fireEvent.change(providerSelect, { target: { value: 'OpenAI' } })`) to verify that selecting "OpenAI" updates endpoint to `https://api.openai.com/v1` and model to `gpt-4o-mini`.

---

## 3. Caveats

1. **Backend vs Frontend Responsibility**:
   - Certain algorithmic helpers in the old test file (`logicalToPhysical`, `clusterLines`, `mergeWordBoxes`, `calculateMedianRgb`) were mock reimplementations of Rust backend code (`capture.rs`, `reconstruction.rs`, `sampler.rs`). On the frontend, React components and stores interact with Rust via `services/tauri.ts` IPC calls. Refactoring `tier1_features.test.tsx` to test frontend services, stores, and components aligns with the frontend test suite scope.
2. **Execution Context**:
   - `vitest` runs in JSDOM environment. Global objects such as `localStorage` and `window` are available. When testing Tauri IPC commands, `(window as any).__TAURI_INTERNALS__ = {}` triggers the Tauri IPC route, which is intercepted by `tauriIpcMock.ts`.

---

## 4. Conclusion

The concrete fix plan comprises 3 core action items:
1. **Update `app_v2/src/tests/harness/tauriIpcMock.ts`**:
   - Replace local interface declarations with direct imports from `../../services/types`.
   - Update mock default state (`settings`, `ocrResult`, `colorSamples`) to match canonical types.
2. **Fix Provider Default Endpoint Bug in `SettingsDashboard.tsx`**:
   - Update `handleProviderChange` to set `endpoint` and `model` to `defaults.endpoint` and `defaults.model`.
3. **Refactor `app_v2/src/tests/tier1_features.test.tsx`**:
   - Completely remove inlined helper functions and dummy `SimpleOverlayCard` component.
   - Import real components (`SettingsDashboard`), stores (`useSettingsStore`), and services (`services/tauri.ts`).
   - Re-implement all 32 tests to perform real UI interactions and state assertions using `@testing-library/react` and `fireEvent`.

---

## 5. Verification Method

To verify the implementation once executed by the implementer:

1. **Run Frontend Test Suite**:
   ```powershell
   npm --prefix app_v2 test -- --run
   ```
   *Expected Output*: All tests pass (32 tests in `tier1_features.test.tsx` + 20 tests in `empirical_validation.test.tsx` = 52 passing tests).

2. **Verify Zero Facade Code**:
   Inspect `app_v2/src/tests/tier1_features.test.tsx`:
   - Confirm NO local functions like `logicalToPhysical`, `clusterLines`, `SimpleOverlayCard` exist inside `tier1_features.test.tsx`.
   - Confirm explicit imports from `../components/Settings/SettingsDashboard`, `../stores/useSettingsStore`, and `../services/tauri`.

3. **Verify Type Alignment**:
   Inspect `app_v2/src/tests/harness/tauriIpcMock.ts`:
   - Confirm `AppSettings` is imported from `../../services/types`.
