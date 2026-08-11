# React/TypeScript Tier 1 Test Structure & Environment Analysis Report

**Author**: Explorer Subagent (`e2e_m1_explorer_2`)  
**Target Directory**: `app_v2/src/`  
**Target Test File**: `app_v2/src/tests/tier1_features.test.tsx`  
**Milestone**: M1 - React Frontend Test Suite & Testing Framework Configuration  
**Date**: 2026-08-09  

---

## 1. Observation

### 1.1 `app_v2/package.json` Configuration State
Direct inspection of `app_v2/package.json` reveals:
- **Existing Dependencies** (lines 12-21): `@tauri-apps/api` (^2), `@tauri-apps/plugin-opener` (^2), `clsx` (^2.1.1), `lucide-react` (^1.30.0), `react` (^19.1.0), `react-dom` (^19.1.0), `tailwind-merge` (^3.6.0), `zustand` (^5.0.14).
- **Existing DevDependencies** (lines 22-32): `@tauri-apps/cli` (^2), `@types/react` (^19.1.8), `@types/react-dom` (^19.1.6), `@vitejs/plugin-react` (^4.6.0), `autoprefixer` (^10.5.4), `postcss` (^8.5.26), `tailwindcss` (^4.3.3), `typescript` (~5.8.3), `vite` (^7.0.4).
- **Existing Scripts** (lines 6-11):
  ```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  }
  ```
- **Missing Elements**:
  - No `"test"` script is currently present in `scripts`.
  - Testing runner framework dependencies are missing in `devDependencies`: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and `jsdom`.

### 1.2 `app_v2/vite.config.ts` Configuration State
Direct inspection of `app_v2/vite.config.ts` (lines 1-33) reveals:
- Vite plugin configuration for `@vitejs/plugin-react` and Tauri dev server settings.
- **Missing Elements**:
  - Lacks Vitest inline type reference header (`/// <reference types="vitest" />`).
  - Lacks `test` configuration block specifying test environment (`jsdom` or `happy-dom`), setup file path (`src/tests/harness/setup.ts`), and match patterns (`src/tests/**/*.test.{ts,tsx}`).

### 1.3 `app_v2/tsconfig.json` Configuration State
Direct inspection of `app_v2/tsconfig.json` (lines 1-26) reveals:
- `"include": ["src"]`, `"jsx": "react-jsx"`, `"moduleResolution": "bundler"`.
- **Missing Elements**:
  - Lacks `"types": ["vitest/globals", "@testing-library/jest-dom"]` in `compilerOptions`, which will cause TypeScript errors on Vitest global functions (`describe`, `it`, `expect`, `vi`, `beforeEach`) and DOM matchers (`toBeInTheDocument()`).

### 1.4 `app_v2/src/` Directory Structure State
Inspection of `app_v2/src` shows:
- `App.tsx`: Initial Tauri starter template with `greet` command invocation.
- `main.tsx`, `App.css`, `assets/`, `vite-env.d.ts`.
- Empty placeholder directories: `components/`, `services/`, `store/`, `types/`, `services/__tests__/`.
- No existing tests currently exist under `app_v2/src/tests/`.

### 1.5 Test Infra Matrix & IPC Contract Specification
From `TEST_INFRA.md` (lines 8-30) and `PROJECT.md` (lines 31-38):
- **Target Command**: `npm --prefix app_v2 test -- --run` (or `npx vitest run`).
- **Tier 1 Feature Matrix**: Exactly **32 tests** required across features F1 through F6:
  - **F1 (Modern Desktop Container & UI)**: 6 tests
  - **F2 (High-DPI Capture & Coordinate Engine)**: 5 tests
  - **F3 (RapidOCR ONNX & Line Reconstruction)**: 5 tests
  - **F4 (Multi-Tier Translation Engine & CG Dicts)**: 6 tests
  - **F5 (Color Sampler & Canvas/Web Overlay)**: 5 tests
  - **F6 (E2E Test Suite & Verification Harness)**: 5 tests
- **Tauri IPC Command Contracts**:
  - `cmd_capture_and_ocr(selection: PhysicalRect) -> Result<OcrResult, String>`
  - `cmd_translate_phrases(phrases: Vec<String>, preset: String, llm_config: Option<LlmConfig>) -> Result<Vec<TranslationResult>, String>`
  - `cmd_sample_colors(image_crop: Vec<u8>, boxes: Vec<BoundingBox>) -> Result<Vec<ColorSample>, String>`
  - `cmd_save_settings(settings: AppSettings) -> Result<(), String>`
  - `cmd_get_settings() -> Result<AppSettings, String>`

---

## 2. Logic Chain

### 2.1 Testing Stack Selection & Setup Strategy
Vite 7 is used as the frontend bundler. Vitest is the native testing solution for Vite applications because it shares the same transformation pipeline, plugins, and `vite.config.ts`.
To enable DOM testing of React 19 components without a live browser window:
1. **Runner**: `vitest`
2. **DOM Environment**: `jsdom` (or `happy-dom`)
3. **Component Utilities**: `@testing-library/react` & `@testing-library/user-event`
4. **DOM Assertions**: `@testing-library/jest-dom`

#### Required `package.json` Modifications:
- Add script: `"test": "vitest run"`
- Add `devDependencies`:
  - `vitest`: `^3.0.0`
  - `@testing-library/react`: `^16.0.0`
  - `@testing-library/jest-dom`: `^6.6.0`
  - `@testing-library/user-event`: `^14.5.0`
  - `jsdom`: `^26.0.0`

#### Required `vite.config.ts` Modification:
```typescript
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  // ... existing server config ...
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/harness/setup.ts"],
    include: ["src/tests/**/*.test.{ts,tsx}"],
  },
}));
```

#### Required `tsconfig.json` Modification:
```json
"compilerOptions": {
  ...
  "types": ["vitest/globals", "@testing-library/jest-dom"]
}
```

---

### 2.2 IPC Mock Harness Architecture (`app_v2/src/tests/harness/`)
Because React tests run inside Node/Jsdom without a live Tauri Rust background process, invoking `@tauri-apps/api/core` `invoke()` will fail unless mocked.

#### File 1: `app_v2/src/tests/harness/tauriIpcMock.ts`
```typescript
import { vi } from 'vitest';

export interface AppSettings {
  theme: 'dark' | 'light' | 'fluent';
  presetDict: 'blender' | 'substance' | 'unity';
  llmProvider: 'deepseek' | 'openai' | 'ollama';
  apiKey: string;
  hotkey: string;
  autoTranslate: boolean;
}

export interface MockIPCState {
  settings: AppSettings;
  ocrResult: any;
  translationMap: Record<string, string>;
  colorSamples: any[];
  invokedCommands: Array<{ cmd: string; args: any }>;
}

export function createMockIpcHarness(initialState?: Partial<MockIPCState>) {
  const state: MockIPCState = {
    settings: {
      theme: 'dark',
      presetDict: 'blender',
      llmProvider: 'deepseek',
      apiKey: 'sk-test-key',
      hotkey: 'Ctrl+Alt+D',
      autoTranslate: true,
      ...initialState?.settings,
    },
    translationMap: {
      'Principled BSDF': '原理化 BSDF',
      'Subsurface Scattering': '次表面散射',
      'Roughness': '粗糙度',
      'AO Mixing Mode': 'AO 混合模式',
      'NavMesh Surface': '网格导航表面',
      ...initialState?.translationMap,
    },
    ocrResult: initialState?.ocrResult ?? {
      blocks: [
        {
          text: 'Principled BSDF',
          confidence: 0.99,
          box: { x: 100, y: 50, width: 140, height: 24 },
        },
      ],
    },
    colorSamples: initialState?.colorSamples ?? [
      { bg_rgb: [42, 42, 42], text_color: '#FFFFFF', is_dark: true },
    ],
    invokedCommands: [],
  };

  const invokeMock = vi.fn(async (cmd: string, args?: any) => {
    state.invokedCommands.push({ cmd, args });
    switch (cmd) {
      case 'cmd_get_settings':
        return { ...state.settings };
      case 'cmd_save_settings':
        state.settings = { ...state.settings, ...args.settings };
        return null;
      case 'cmd_capture_and_ocr':
        return state.ocrResult;
      case 'cmd_translate_phrases': {
        const phrases: string[] = args?.phrases || [];
        return phrases.map((p) => ({
          original: p,
          translated: state.translationMap[p] || `[Mock LLM] ${p}`,
          sourceTier: state.translationMap[p] ? 'preset_dict' : 'llm',
        }));
      }
      case 'cmd_sample_colors':
        return state.colorSamples;
      default:
        throw new Error(`Unhandled IPC command: ${cmd}`);
    }
  });

  vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
  }));

  return { state, invokeMock };
}
```

#### File 2: `app_v2/src/tests/harness/setup.ts`
```typescript
import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';
import { createMockIpcHarness } from './tauriIpcMock';

beforeEach(() => {
  vi.clearAllMocks();
  createMockIpcHarness();
});
```

---

### 2.3 Tier 1 Test Suite Design (`app_v2/src/tests/tier1_features.test.tsx`)

The test file `tier1_features.test.tsx` must contain **32 tests** partitioned into 6 `describe` blocks matching features F1 through F6:

```
tier1_features.test.tsx
├── describe('F1: Modern Desktop Container & UI', () => { 6 tests })
├── describe('F2: High-DPI Capture & Coordinate Engine', () => { 5 tests })
├── describe('F3: RapidOCR ONNX & Line Reconstruction Engine', () => { 5 tests })
├── describe('F4: Multi-Tier Translation Engine & CG Dictionaries', () => { 6 tests })
├── describe('F5: Color Sampler & Canvas/Web Overlay', () => { 5 tests })
└── describe('F6: E2E Test Suite & Harness Verification', () => { 5 tests })
```

#### Detailed Test Specification Breakdown:

##### Block 1: `F1: Modern Desktop Container & UI` (6 Tests)
1. **F1-1: System Tray Menu Initialization & Toggle Handling**
   - Verify system tray state handler initializes with default menu items (Capture, Settings, Quit) and toggles visibility on event.
2. **F1-2: Global Hotkey Binding Registration & Execution**
   - Test hotkey handler registration for `"Ctrl+Alt+D"` and verify hotkey trigger fires capture action.
3. **F1-3: Fluent UI Theme Switcher Mode Toggling**
   - Test switching theme between `'dark'`, `'light'`, and `'fluent'`, verifying active theme state in store.
4. **F1-4: Settings Persistence via IPC and Store**
   - Call `cmd_save_settings` via store action, verify `invoke('cmd_save_settings')` is called with payload and store updates.
5. **F1-5: Settings Dashboard Window Visibility Toggle**
   - Render Settings modal/view, verify visibility state toggles between open (`true`) and closed (`false`).
6. **F1-6: Dark Mode CSS Class Application on Document Root**
   - Verify root container DOM element receives `"dark"` CSS class name when dark mode is enabled.

##### Block 2: `F2: High-DPI Capture & Coordinate Engine` (5 Tests)
1. **F2-1: Logical to Physical Coordinate Conversion Accuracy**
   - Verify coordinate scaler transforms `LogicalRect({ x: 100, y: 200, width: 300, height: 150 })` at `1.5x` DPI to `PhysicalRect({ x: 150, y: 300, width: 450, height: 225 })` with exact precision (<1px error).
2. **F2-2: Multi-DPI Scale Factor Application (1.0x, 1.25x, 1.5x, 2.0x)**
   - Test scaling identical logical bounds across 1.0x, 1.25x, 1.5x, 2.0x scale factors.
3. **F2-3: Selection Rect Normalization (Non-negative Dimensions)**
   - Test dragging selection rect in reverse direction (e.g. start `x: 300, y: 400`, end `x: 100, y: 200`), verifying output rect is normalized to `x: 100, y: 200, width: 200, height: 200`.
4. **F2-4: Multi-Monitor Boundary Check & Clamping**
   - Test selection box extending past primary monitor bounds, verifying bounds check clamps rect inside display screen area.
5. **F2-5: Crop Box Bounds Validation**
   - Test zero-width or zero-height crop rect, verifying validator rejects invalid crop dimensions.

##### Block 3: `F3: RapidOCR ONNX & Line Reconstruction Engine` (5 Tests)
1. **F3-1: OCR Preprocessing & Tensor Input Struct Validation**
   - Verify image crop payload metadata (width, height, channels) formatted correctly for IPC.
2. **F3-2: DBNet Text Box Region Parser**
   - Parse `OcrResult` response blocks from IPC, verifying text box bounding rect coordinates `(x, y, width, height)` are extracted correctly.
3. **F3-3: SVTR Text Recognition String & Confidence Parsing**
   - Verify extracted text strings match recognised labels and confidence scores are $\ge 0.0$ and $\le 1.0$.
4. **F3-4: Line Clustering Algorithm Grouping**
   - Test grouping multiple text region blocks on the same Y-axis baseline into a single text line cluster.
5. **F3-5: Word Box Horizontal Merging Logic**
   - Test combining horizontally adjacent word boxes (e.g., `"Principled"` and `"BSDF"`) with a single space separator when gap is below threshold.

##### Block 4: `F4: Multi-Tier Translation Engine & CG Dictionaries` (6 Tests)
1. **F4-1: Preset CG Dictionary Exact Match (Blender Terms)**
   - Test exact dictionary lookup for Blender term `"Principled BSDF"`, verifying translation returns `"原理化 BSDF"` with source `"preset_dict"`.
2. **F4-2: Preset CG Dictionary Exact Match (Substance & Unity Terms)**
   - Test lookup for `"AO Mixing Mode"` -> `"AO 混合模式"` and `"NavMesh Surface"` -> `"网格导航表面"`.
3. **F4-3: LLM API Request Payload Formatting**
   - Test formatting API payload for LLM tier with model choice (`deepseek-chat`), temperature, and prompt structure.
4. **F4-4: Online Translation API Fallback Cascade**
   - Test fallback sequence when preset lookup misses and LLM fails/times out, executing online API fallback.
5. **F4-5: Multi-Tier Priority Resolution**
   - Verify cascade order strictly adheres to: `Preset Dict` -> `CG Fallback Dict` -> `LLM API` -> `Online Fallback`.
6. **F4-6: Translation Store & Memory Cache**
   - Test caching translated phrases in Zustand store so repeat OCR selections avoid redundant API calls.

##### Block 5: `F5: Color Sampler & Canvas/Web Overlay` (5 Tests)
1. **F5-1: Outer Ring 4px Median RGB Color Calculation**
   - Test calculation of median background RGB color from 4px outer border pixels around text box.
2. **F5-2: Perceived Brightness Formula Evaluation**
   - Test perceived brightness formula $Y = 0.299R + 0.587G + 0.114B$ for light sample `(240, 240, 240)` ($Y \approx 240$) and dark sample `(30, 30, 30)` ($Y \approx 30$).
3. **F5-3: Contrast Text Color Decision Logic**
   - Verify decision logic outputs text color `'#FFFFFF'` for dark background ($Y < 128$) and `'#000000'` for light background ($Y \ge 128$).
4. **F5-4: React Overlay Card CSS Absolute Positioning**
   - Verify React DOM overlay translation card computes inline style `top`, `left`, `width`, `height` matching OCR bounding rect in logical coordinates.
5. **F5-5: Interactive Card Event Handling**
   - Test user interaction events: click card to copy translation text, mouse hover to expand full phrase view.

##### Block 6: `F6: E2E Test Suite & Harness Integration` (5 Tests)
1. **F6-1: Mock IPC Pipeline Interceptor Verification**
   - Call `invoke('cmd_get_settings')` and `invoke('cmd_translate_phrases')`, verifying mock harness records invoked command history correctly.
2. **F6-2: Test Report Formatter & Summary Generation**
   - Test helper function that aggregates test result statuses into a summary object `{ total: 32, passed: 32, failed: 0 }`.
3. **F6-3: Integration Environment Health Check**
   - Verify mock IPC bridge is active and responds without missing module or binding errors.
4. **F6-4: Mock ONNX Engine Response Generator**
   - Verify mock ONNX response generator produces deterministic `OcrResult` structures for synthetic input crops.
5. **F6-5: Mock CG Dictionary Asset Loader Integrity**
   - Verify JSON dictionary loader parses Blender, Substance, and Unity preset dictionaries with valid key-value pairs.

---

## 3. Caveats

1. **Unbuilt UI Components & Store Files**:
   - Currently `app_v2/src/components`, `app_v2/src/store`, and `app_v2/src/services` contain empty skeleton folders.
   - The test writer worker should provide clean contract-based unit/integration tests that include pure functions, Zustand store mocks, and component render helpers so tests compile and pass cleanly immediately.
2. **React 19 vs Testing Library Compatibility**:
   - `app_v2/package.json` specifies `"react": "^19.1.0"`. `vitest` + `@testing-library/react@^16` is compatible with React 19. If warnings occur during `npm install`, `--legacy-peer-deps` or standard modern npm resolution handles it cleanly.
3. **JSDOM Canvas API Mocking**:
   - Feature F5 involves Canvas 2D overlay rendering. JSDOM does not implement full HTML5 Canvas 2D context rendering (`getContext('2d')`). The test harness should mock `HTMLCanvasElement.prototype.getContext` with basic stub methods (`fillRect`, `getImageData`, `clearRect`) to prevent runtime crashes.
4. **Tauri Core Module Mocking Scope**:
   - Ensure `vi.mock('@tauri-apps/api/core')` is declared before importing any components or services that invoke Tauri commands.

---

## 4. Conclusion

The React/TypeScript test infrastructure for `app_v2` is well-scoped:
1. **Dependencies & Configuration**: `package.json` needs testing packages (`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`) and `"test": "vitest run"` script. `vite.config.ts` needs the `test` block, and `tsconfig.json` needs `"types": ["vitest/globals", "@testing-library/jest-dom"]`.
2. **Mock Harness**: The `mockTauriIPC` helper cleanly intercepts Tauri `invoke` calls for stateful settings, OCR, translation, and color sampling commands.
3. **Tier 1 Coverage**: `app_v2/src/tests/tier1_features.test.tsx` will house 32 comprehensive tests spanning features F1 to F6 (6 + 5 + 5 + 6 + 5 + 5) covering container UI, DPI scaling, OCR parsing, multi-tier translation, overlay rendering, and harness verification.

---

## 5. Verification Method

### 5.1 Command Line Verification
Once the test writer worker completes installing dependencies, setting up harness files, and creating `app_v2/src/tests/tier1_features.test.tsx`:

1. **Run Vitest Test Suite**:
   ```bash
   npm --prefix app_v2 test -- --run
   ```
   *Alternative direct runner*:
   ```bash
   npx --prefix app_v2 vitest run
   ```

2. **Expected Execution Result**:
   - `Test Files: 1 passed (1)` (`tier1_features.test.tsx`)
   - `Tests: 32 passed (32)`
   - Execution time: `< 2.5s`
   - Exit code: `0`

### 5.2 Invalidation Conditions
- Test suite fails to execute due to missing `vitest` binary or invalid `vite.config.ts` test configuration.
- Any of the 32 tests fails due to unhandled `@tauri-apps/api/core` `invoke` call errors.
- TypeScript compiler (`tsc --noEmit`) reports type errors on `describe`, `it`, `expect`, or `toBeInTheDocument`.
