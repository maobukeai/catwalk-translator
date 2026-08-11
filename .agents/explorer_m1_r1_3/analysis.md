# Analysis Report: IPC Contracts, TypeScript Service Layer & Build Verification Plan (M1)

**Agent**: `explorer_m1_r1_3` (teamwork_preview_explorer)  
**Milestone**: M1 (Tauri 2.0 Infra & UI Skeleton)  
**Target Files**: `app_v2/src/services/types.ts`, `app_v2/src/services/tauri.ts`  
**Date**: 2026-08-09  

---

## 1. Executive Summary

This report establishes the IPC contract specification, 1:1 Rust ↔ TypeScript type mappings, service layer wrapper architecture (`@tauri-apps/api/core`), mock fallback strategy for browser environments, and a robust verification plan for Milestone 1.

Key findings & environment check:
- **Environment Prerequisites**: Node.js (`v24.14.0`), npm (`11.9.0`), rustc (`1.95.0`), cargo (`1.95.0`) are all installed and fully operational.
- **Baseline Verification**: Running `npm run build` in `app_v2/` succeeds in 470ms with zero errors. Running `cargo check` in `app_v2/src-tauri/` succeeds in 0.24s with zero errors.
- **Contract Alignment**: The 5 Tauri IPC commands specified in `PROJECT.md` and `SCOPE.md` (`cmd_capture_and_ocr`, `cmd_translate_phrases`, `cmd_sample_colors`, `cmd_save_settings`, `cmd_get_settings`) are mapped 1:1 to TypeScript interfaces using `camelCase` field naming convention matching Rust's `#[serde(rename_all = "camelCase")]`.

---

## 2. Environment & Workspace Verification

| Tool / Runtime | Workspace Status | Target Command |
| -------------- | ---------------- | -------------- |
| **Node.js** | v24.14.0 (OK) | `node -v` |
| **npm** | 11.9.0 (OK) | `npm run build` |
| **rustc** | 1.95.0 (OK) | `rustc --version` |
| **cargo** | 1.95.0 (OK) | `cargo check` |
| **Tauri CLI** | `@tauri-apps/cli` ^2.0 (OK) | `npm run tauri -- --version` |

---

## 3. Interface Contract Specification (1:1 Rust ↔ TS Mapping)

All Rust IPC structs use `#[serde(rename_all = "camelCase")]`. Below is the complete mapping table between Rust types and TypeScript definitions.

| Command Name | Rust Parameters | Rust Return Type | TypeScript Method | TypeScript Return Type |
| ------------ | --------------- | ---------------- | ----------------- | ---------------------- |
| `cmd_capture_and_ocr` | `selection: PhysicalRect` | `Result<OcrResult, String>` | `captureAndOcr(selection: PhysicalRect)` | `Promise<OcrResult>` |
| `cmd_translate_phrases` | `phrases: Vec<String>, preset: String, llm_config: Option<LlmConfig>` | `Result<Vec<TranslationResult>, String>` | `translatePhrases(phrases: string[], preset: string, llmConfig?: LlmConfig)` | `Promise<TranslationResult[]>` |
| `cmd_sample_colors` | `image_crop: Vec<u8>, boxes: Vec<BoundingBox>` | `Result<Vec<ColorSample>, String>` | `sampleColors(imageCrop: Uint8Array \| number[], boxes: BoundingBox[])` | `Promise<ColorSample[]>` |
| `cmd_save_settings` | `settings: AppSettings` | `Result<(), String>` | `saveSettings(settings: AppSettings)` | `Promise<void>` |
| `cmd_get_settings` | *(None)* | `Result<AppSettings, String>` | `getSettings()` | `Promise<AppSettings>` |

---

## 4. Proposed `app_v2/src/services/types.ts`

```typescript
/**
 * IPC Data Contracts matching Rust backend models in `app_v2/src-tauri/src/models.rs`
 */

/**
 * Screen selection rectangle in physical pixels.
 */
export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bounding box for recognized text items or sampling regions.
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Single recognized text block item from OCR engine.
 */
export interface OcrItem {
  id: string;
  text: string;
  confidence: number;
  box: BoundingBox;
}

/**
 * Result returned by `cmd_capture_and_ocr`.
 */
export interface OcrResult {
  items: OcrItem[];
  imageWidth: number;
  imageHeight: number;
  executionTimeMs: number;
}

/**
 * Supported LLM service providers.
 */
export type LlmProvider = 'deepseek' | 'openai' | 'ollama' | 'custom';

/**
 * Configuration for LLM translation provider.
 */
export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/**
 * Translation pipeline tier options.
 */
export type TranslationTier = 'preset' | 'llm' | 'online';

/**
 * Individual phrase translation result.
 */
export interface TranslationResult {
  original: string;
  translated: string;
  tierUsed: TranslationTier;
  confidence: number;
}

/**
 * Sampled outer-ring background color and contrast text color.
 */
export interface ColorSample {
  box: BoundingBox;
  backgroundColorHex: string;
  textColorHex: string;
  isLightBg: boolean;
}

/**
 * Preset dictionary toggle states.
 */
export interface PresetDicts {
  blender: boolean;
  substance: boolean;
  unity: boolean;
}

/**
 * Global application settings stored in configuration.
 */
export interface AppSettings {
  globalHotkey: string;
  llmConfig: LlmConfig;
  translationTiers: TranslationTier[];
  presetDicts: PresetDicts;
  autoCopyTranslation: boolean;
  launchAtStartup: boolean;
}
```

---

## 5. Proposed `app_v2/src/services/tauri.ts`

```typescript
import { invoke } from '@tauri-apps/api/core';
import type {
  PhysicalRect,
  OcrResult,
  LlmConfig,
  TranslationResult,
  BoundingBox,
  ColorSample,
  AppSettings,
} from './types';

/**
 * Helper to check whether the application is running inside a Tauri desktop container.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Default fallback settings used when running outside Tauri or on first run.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  globalHotkey: 'Ctrl+Alt+D',
  llmConfig: {
    provider: 'deepseek',
    apiKey: '',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.3,
    maxTokens: 1024,
  },
  translationTiers: ['preset', 'llm', 'online'],
  presetDicts: {
    blender: true,
    substance: true,
    unity: false,
  },
  autoCopyTranslation: false,
  launchAtStartup: false,
};

const LOCAL_STORAGE_KEY = 'cg_translator_settings';

/**
 * Triggers screen capture and OCR processing on the specified physical rectangle.
 */
export async function captureAndOcr(selection: PhysicalRect): Promise<OcrResult> {
  if (!isTauri()) {
    console.warn('[Tauri IPC Mock] captureAndOcr executed outside Tauri container.');
    return {
      items: [
        {
          id: 'mock-1',
          text: 'Principled BSDF',
          confidence: 0.98,
          box: { x: selection.x + 10, y: selection.y + 10, width: 120, height: 24 },
        },
      ],
      imageWidth: selection.width,
      imageHeight: selection.height,
      executionTimeMs: 15,
    };
  }
  return invoke<OcrResult>('cmd_capture_and_ocr', { selection });
}

/**
 * Translates a list of phrases using the active multi-tier translation pipeline.
 */
export async function translatePhrases(
  phrases: string[],
  preset: string = 'blender',
  llmConfig?: LlmConfig
): Promise<TranslationResult[]> {
  if (!isTauri()) {
    console.warn('[Tauri IPC Mock] translatePhrases executed outside Tauri container.');
    return phrases.map((phrase) => ({
      original: phrase,
      translated: phrase === 'Principled BSDF' ? '原理化 BSDF' : `[Mock] ${phrase}`,
      tierUsed: phrase === 'Principled BSDF' ? 'preset' : 'online',
      confidence: 0.95,
    }));
  }
  return invoke<TranslationResult[]>('cmd_translate_phrases', {
    phrases,
    preset,
    llmConfig: llmConfig ?? null,
  });
}

/**
 * Samples background and contrast text colors for given bounding boxes.
 */
export async function sampleColors(
  imageCrop: Uint8Array | number[],
  boxes: BoundingBox[]
): Promise<ColorSample[]> {
  if (!isTauri()) {
    console.warn('[Tauri IPC Mock] sampleColors executed outside Tauri container.');
    return boxes.map((box) => ({
      box,
      backgroundColorHex: '#1e1e1e',
      textColorHex: '#ffffff',
      isLightBg: false,
    }));
  }
  const cropData = imageCrop instanceof Uint8Array ? Array.from(imageCrop) : imageCrop;
  return invoke<ColorSample[]>('cmd_sample_colors', {
    imageCrop: cropData,
    boxes,
  });
}

/**
 * Retrieves application settings from backend or local storage fallback.
 */
export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    console.warn('[Tauri IPC Mock] getSettings executed outside Tauri container.');
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Failed to parse localStorage settings', e);
    }
    return DEFAULT_SETTINGS;
  }
  return invoke<AppSettings>('cmd_get_settings');
}

/**
 * Saves updated application settings to backend or local storage fallback.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!isTauri()) {
    console.warn('[Tauri IPC Mock] saveSettings executed outside Tauri container.');
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
    return;
  }
  return invoke<void>('cmd_save_settings', { settings });
}
```

---

## 6. Build Verification Plan & Script Integration

To maintain 100% build reliability across iterations:

1. **Frontend Compilation Check**:
   ```bash
   cd app_v2
   npm run build
   ```
   *Pass Criteria*: `tsc` passes with zero type errors; Vite generates `dist/` bundle cleanly.

2. **Backend Rust Check**:
   ```bash
   cd app_v2/src-tauri
   cargo check
   cargo test
   ```
   *Pass Criteria*: `cargo check` outputs zero compilation errors; `cargo test` passes all Rust unit tests.

---

## 7. Next Steps for Implementer

1. Create `app_v2/src/services/types.ts` with the interface definitions above.
2. Create `app_v2/src/services/tauri.ts` wrapping `@tauri-apps/api/core` with fallback mocks.
3. Run `npm run build` in `app_v2/` to verify frontend compilation.
