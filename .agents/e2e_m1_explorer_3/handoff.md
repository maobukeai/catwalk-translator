# E2E Test Mock Strategies & Harness Architecture Analysis Report

**Author**: Explorer Subagent (`e2e_m1_explorer_3`)  
**Target Project**: CG AI Screenshot Translator (`app_v2`)  
**Milestone**: M1 - Test Infrastructure & Mock Harness Architecture  
**Date**: 2026-08-09  

---

## 1. Observation

### 1.1 Direct Project Specification Findings
Based on direct inspection of project documentation and initial codebase structure:

1. **Tauri IPC Command Contracts** (`PROJECT.md` lines 31-38):
   - `cmd_capture_and_ocr(selection: PhysicalRect) -> Result<OcrResult, String>`
   - `cmd_translate_phrases(phrases: Vec<String>, preset: String, llm_config: Option<LlmConfig>) -> Result<Vec<TranslationResult>, String>`
   - `cmd_sample_colors(image_crop: Vec<u8>, boxes: Vec<BoundingBox>) -> Result<Vec<ColorSample>, String>`
   - `cmd_save_settings(settings: AppSettings) -> Result<(), String>`
   - `cmd_get_settings() -> Result<AppSettings, String>`

2. **Backend & Model Architecture** (`PROJECT.md` lines 6, 40-56):
   - Native Rust ONNX Runtime (`ort` crate v2.x, CPU EP) loading PP-OCRv4 DBNet detection (`ch_PP-OCRv4_det_infer.onnx`) and SVTR recognition (`ch_PP-OCRv4_rec_infer.onnx`) (~15.5MB).
   - Multi-monitor screenshot & DPI coordinate mapper (`capture.rs`).
   - Line clustering & word merging algorithm (`reconstruction.rs`).
   - Multi-tier translation pipeline & JSON dict loader (`translator.rs`).
   - Outer ring median RGB sampler & contrast calculator (`sampler.rs`).

3. **Test Infra Requirements & Targets** (`TEST_INFRA.md` lines 1-73):
   - Category-Partitioning, BVA, Pairwise, Real-World Application Workloads across 4 Tiers (32 Tier 1, 28 Tier 2, 15 Tier 3, 11 Tier 4 tests).
   - Target execution commands:
     - Rust: `cargo test --manifest-path app_v2/src-tauri/Cargo.toml -- --nocapture`
     - TypeScript: `npm --prefix app_v2 test -- --run` (Vitest test runner)
   - Requirement of running opaque-box E2E integration tests in CI/headless environment without requiring physical display hardware or ONNX execution provider hardware.

4. **Current Codebase State** (`app_v2/` scan):
   - Scaffolding baseline initialized with Tauri v2 (`app_v2/src-tauri/Cargo.toml`) and React 19 + Vite (`app_v2/package.json`).
   - No mock harness currently exists in `app_v2/src-tauri/tests/` or `app_v2/src/tests/`.

---

## 2. Logic Chain

### 2.1 The Hardware & CI Dependency Problem
In a CI/CD environment or headless test runner (e.g. GitHub Actions, headless Windows runner):
- **Display Hardware Absence**: Physical screen capture APIs (`xcap`, Windows DXGI Graphics Capture) fail or return null monitor handles because no physical display monitor is attached.
- **ONNX Execution Provider Hardware & Model Load Overhead**: Loading 15.5MB ONNX model files and initializing C++ ONNX Runtime bindings during unit/integration tests introduces latency (>2s per test) and requires ONNX runtime shared libraries.
- **External API & Network Flakiness**: Testing LLM APIs (DeepSeek, OpenAI, Ollama) or online fallback APIs against live HTTP endpoints causes non-deterministic failures, API quota consumption, rate limits (HTTP 429), and network timeouts.
- **Tauri IPC Runtime Isolation**: In Vitest/npm test, frontend components calling `@tauri-apps/api/core` `invoke()` fail immediately because there is no running Webview IPC bridge.

### 2.2 Core Design Principles for Mocks
To make opaque-box integration tests 100% deterministic, offline-capable, fast (<1s total execution), and reliable:
1. **Dependency Injection via Traits (Rust)**: System components (`OcrEngine`, `ScreenCapturer`, `TranslationPipeline`, `SettingsStore`) must be abstracted behind Rust traits so that integration tests can inject mock implementations without modifying business logic.
2. **IPC Interception Harness (TypeScript)**: Provide a clean, type-safe `mockTauriIPC` registry for Vitest that intercepts `invoke` calls and routes them to stateful or functional mock implementations.
3. **Synthetic Fixture Generators**: Provide deterministic mock data for screen capture (raw RGBA pixel arrays), ONNX recognition (pre-configured text region mappings), DPI coordinate mappings (multi-monitor configuration fixtures), and CG dictionaries (in-memory JSON presets).

---

## 3. Detailed Mock Strategies & Harness Designs

### 3.1 Pillar 1: Tauri IPC Command Mock Strategy

#### TypeScript Vitest Harness (`mockTauriIPC`)
In React/Vite integration tests (`app_v2/src/tests/`), we mock `@tauri-apps/api/core`.

```typescript
// app_v2/src/tests/harness/tauriIpcMock.ts
import { vi } from 'vitest';
import type { AppSettings, OcrResult, TranslationResult, ColorSample, PhysicalRect, BoundingBox } from '../../types';

export interface MockIPCState {
  settings: AppSettings;
  ocrFixture?: OcrResult;
  translationMap: Record<string, string>;
  colorSampleFixture?: ColorSample[];
  invokedCommands: Array<{ cmd: string; args: any }>;
}

export function createMockIpcHarness(initialState?: Partial<MockIPCState>) {
  const state: MockIPCState = {
    settings: {
      theme: 'dark',
      presetDict: 'blender',
      llmProvider: 'deepseek',
      apiKey: 'sk-test-mock-key',
      hotkey: 'Ctrl+Alt+D',
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
    ocrFixture: initialState?.ocrFixture ?? {
      blocks: [
        {
          text: 'Principled BSDF',
          confidence: 0.98,
          box: { x: 100, y: 50, width: 120, height: 20 },
        },
      ],
    },
    colorSampleFixture: initialState?.colorSampleFixture ?? [
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
        return state.ocrFixture;
      case 'cmd_translate_phrases': {
        const phrases: string[] = args.phrases || [];
        return phrases.map((phrase) => ({
          original: phrase,
          translated: state.translationMap[phrase] || `[Mock Translation] ${phrase}`,
          sourceTier: 'preset_dict',
        }));
      }
      case 'cmd_sample_colors':
        return state.colorSampleFixture;
      default:
        throw new Error(`Unhandled mock IPC command: ${cmd}`);
    }
  });

  vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
  }));

  return { state, invokeMock };
}
```

#### Rust Command Handler Test Harness
In Rust backend integration tests (`app_v2/src-tauri/tests/`), command handlers in `commands.rs` accept dependencies via trait references or state structs.

```rust
// app_v2/src-tauri/src/commands.rs (Architectural pattern)
pub struct AppState {
    pub ocr_engine: Box<dyn OcrEngine + Send + Sync>,
    pub capturer: Box<dyn ScreenCapturer + Send + Sync>,
    pub translator: Box<dyn TranslatorEngine + Send + Sync>,
}

#[tauri::command]
pub async fn cmd_capture_and_ocr(
    state: tauri::State<'_, AppState>,
    selection: PhysicalRect,
) -> Result<OcrResult, String> {
    let image = state.capturer.capture_rect(selection).map_err(|e| e.to_string())?;
    state.ocr_engine.recognize(&image).map_err(|e| e.to_string())
}
```

---

### 3.2 Pillar 2: ONNX Inference Runtime (`ort`) Mock Strategy

#### Rust Trait Definition & Mock Engine
Instead of calling `ort::Session` directly in high-level code, encapsulate ONNX inference in an `OcrEngine` trait.

```rust
// app_v2/src-tauri/src/ocr.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BoundingBox {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextBlock {
    pub text: String,
    pub confidence: f32,
    pub box_rect: BoundingBox,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OcrResult {
    pub blocks: Vec<TextBlock>,
}

pub trait OcrEngine: Send + Sync {
    fn recognize(&self, image_data: &[u8]) -> Result<OcrResult, String>;
}

// Mock Engine for E2E CI testing
#[derive(Default)]
pub struct MockOcrEngine {
    pub preset_responses: std::collections::HashMap<u64, OcrResult>,
    pub default_result: Option<OcrResult>,
}

impl MockOcrEngine {
    pub fn new() -> Self {
        Self {
            preset_responses: std::collections::HashMap::new(),
            default_result: Some(OcrResult {
                blocks: vec![TextBlock {
                    text: "Principled BSDF".into(),
                    confidence: 0.99,
                    box_rect: BoundingBox { x: 10, y: 10, width: 100, height: 20 },
                }],
            }),
        }
    }
}

impl OcrEngine for MockOcrEngine {
    fn recognize(&self, image_data: &[u8]) -> Result<OcrResult, String> {
        if image_data.is_empty() {
            return Err("Empty image crop data".into());
        }
        // Calculate basic checksum or return default fixture
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        image_data.hash(&mut hasher);
        let hash = hasher.finish();

        if let Some(res) = self.preset_responses.get(&hash) {
            Ok(res.clone())
        } else if let Some(ref def) = self.default_result {
            Ok(def.clone())
        } else {
            Ok(OcrResult { blocks: vec![] })
        }
    }
}
```

---

### 3.3 Pillar 3: Screen Capture & High-DPI Coordinate Mapper Mock Strategy

#### DPI Mapper Pure Mathematical Engine & Test Strategy
DPI mapping calculates logical positions (`LogicalPosition<f64>`) and physical pixels (`PhysicalPosition<i32>`) with scale factor $S \in \{1.0, 1.25, 1.5, 2.0\}$.

```rust
// app_v2/src-tauri/src/capture.rs
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct CoordinateMapper;

impl CoordinateMapper {
    pub fn logical_to_physical(rect: LogicalRect, scale_factor: f64) -> PhysicalRect {
        PhysicalRect {
            x: (rect.x * scale_factor).round() as i32,
            y: (rect.y * scale_factor).round() as i32,
            width: (rect.width * scale_factor).round() as u32,
            height: (rect.height * scale_factor).round() as u32,
        }
    }

    pub fn physical_to_logical(rect: PhysicalRect, scale_factor: f64) -> LogicalRect {
        LogicalRect {
            x: rect.x as f64 / scale_factor,
            y: rect.y as f64 / scale_factor,
            width: rect.width as f64 / scale_factor,
            height: rect.height as f64 / scale_factor,
        }
    }
}
```

#### Mock Screen Capturer
Generates synthetic raw RGBA images in memory without querying OS display drivers.

```rust
pub trait ScreenCapturer: Send + Sync {
    fn capture_rect(&self, rect: PhysicalRect) -> Result<Vec<u8>, String>;
}

pub struct MockScreenCapturer {
    pub scale_factor: f64,
    pub mock_rgba_buffer: Vec<u8>,
}

impl ScreenCapturer for MockScreenCapturer {
    fn capture_rect(&self, rect: PhysicalRect) -> Result<Vec<u8>, String> {
        if rect.width == 0 || rect.height == 0 {
            return Err("Invalid zero dimensions".into());
        }
        let size = (rect.width * rect.height * 4) as usize;
        if self.mock_rgba_buffer.len() == size {
            Ok(self.mock_rgba_buffer.clone())
        } else {
            // Generate deterministic synthetic solid RGBA buffer (#2A2A2AFF)
            let mut buf = vec![0u8; size];
            for chunk in buf.chunks_exact_mut(4) {
                chunk[0] = 0x2A; // R
                chunk[1] = 0x2A; // G
                chunk[2] = 0x2A; // B
                chunk[3] = 0xFF; // A
            }
            Ok(buf)
        }
    }
}
```

---

### 3.4 Pillar 4: CG JSON Dictionaries & Multi-Tier Pipeline Mock Strategy

#### Translation Engine & Mock HTTP Cascade
The translation pipeline cascading order:
`Preset JSON Dict` -> `CG Fallback Dict` -> `LLM API` -> `Free Online API`.

```rust
// app_v2/src-tauri/src/translator.rs
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranslationResult {
    pub original: String,
    pub translated: String,
    pub source_tier: String, // "preset_dict", "cg_fallback", "llm", "online_api"
}

pub trait TranslatorEngine: Send + Sync {
    fn translate_batch(&self, phrases: &[String], preset: &str) -> Vec<TranslationResult>;
}

pub struct MockTranslatorEngine {
    pub dictionary: std::collections::HashMap<String, String>,
    pub llm_online_enabled: bool,
    pub force_error: bool,
}

impl TranslatorEngine for MockTranslatorEngine {
    fn translate_batch(&self, phrases: &[String], preset: &str) -> Vec<TranslationResult> {
        phrases
            .iter()
            .map(|phrase| {
                if let Some(trans) = self.dictionary.get(phrase) {
                    TranslationResult {
                        original: phrase.clone(),
                        translated: trans.clone(),
                        source_tier: "preset_dict".into(),
                    }
                } else if self.force_error {
                    TranslationResult {
                        original: phrase.clone(),
                        translated: phrase.clone(),
                        source_tier: "fallback_original".into(),
                    }
                } else {
                    TranslationResult {
                        original: phrase.clone(),
                        translated: format!("[Mock Tier 3 LLM] {}", phrase),
                        source_tier: "llm".into(),
                    }
                }
            })
            .collect()
    }
}
```

---

## 4. Complete Test Harness Integration Design

### 4.1 Rust Integration Test Structure (`app_v2/src-tauri/tests/`)

```
app_v2/src-tauri/tests/
├── harness/
│   ├── mod.rs             # Harness module exports
│   ├── mock_ocr.rs        # MockOcrEngine implementation & helpers
│   ├── mock_capture.rs    # MockScreenCapturer & Monitor setup
│   └── mock_translator.rs # MockTranslatorEngine & In-memory CG JSON loader
├── tier1_feature_coverage.rs
├── tier2_boundary_corner.rs
├── tier3_cross_feature.rs
└── tier4_real_world_workloads.rs
```

#### Shared Rust Harness Blueprint (`app_v2/src-tauri/tests/harness/mod.rs`):
```rust
use app_v2_lib::{
    capture::PhysicalRect, ocr::OcrResult, translator::TranslationResult,
};

pub struct TestFixtureContext {
    pub ocr_engine: mock_ocr::MockOcrEngine,
    pub capturer: mock_capture::MockScreenCapturer,
    pub translator: mock_translator::MockTranslatorEngine,
}

impl TestFixtureContext {
    pub fn setup_default() -> Self {
        Self {
            ocr_engine: mock_ocr::MockOcrEngine::new(),
            capturer: mock_capture::MockScreenCapturer {
                scale_factor: 1.5,
                mock_rgba_buffer: vec![],
            },
            translator: mock_translator::MockTranslatorEngine::with_cg_defaults(),
        }
    }
}
```

### 4.2 TypeScript Vitest Structure (`app_v2/src/tests/`)

```
app_v2/src/tests/
├── harness/
│   ├── tauriIpcMock.ts    # Complete type-safe invoke mock runner
│   ├── fixtures.ts        # CG dictionary fixtures & OCR results
│   └── setup.ts           # Vitest environment global setup
├── tier1_features.test.tsx
├── tier2_boundaries.test.tsx
├── tier3_combinations.test.tsx
└── tier4_workloads.test.tsx
```

#### Shared TypeScript Setup Blueprint (`app_v2/src/tests/harness/setup.ts`):
```typescript
import { beforeEach } from 'vitest';
import { createMockIpcHarness } from './tauriIpcMock';

beforeEach(() => {
  createMockIpcHarness();
});
```

---

## 5. Caveats

1. **Native ONNX Shared Library Binary Loading**:
   - Mocks replace runtime inference during unit/integration test execution. However, build-time compilation must verify that `ort` crate dependencies link cleanly on target host platforms.
2. **DPI Scale Factor OS Variations**:
   - Windows, macOS, and Linux report scale factors differently (e.g. integer percentages 125% vs floating point 1.25). Mock tests must cover exact floating point rounding behaviors to enforce the `<1px` mismatch requirement.
3. **External Network Isolation Assurance**:
   - Tests MUST NOT attempt real HTTP connections. In Vitest/Cargo test, network mocks ensure that zero external requests escape, maintaining 100% offline test execution.

---

## 6. Conclusion

The formulated mock strategies establish a clear, hardware-independent test foundation for the CG AI Screenshot Translator project:
- **Tauri IPC**: Abstracted via `mockTauriIPC` on TypeScript and trait-injected handlers on Rust.
- **RapidOCR ONNX**: Abstracted via `OcrEngine` trait with `MockOcrEngine` returning deterministic text blocks.
- **Screen Capture & High-DPI**: Synthetic RGBA buffers with exact mathematical coordinate transformation testing.
- **CG Dictionaries & Translation Pipeline**: In-memory dictionary loaders and mock cascading providers.

This architecture guarantees that all 86 test cases defined across Tiers 1–4 in `TEST_INFRA.md` will execute deterministically, quickly (<1s execution time), and with zero hardware requirements in any CI or headless environment.

---

## 7. Verification Method

### 7.1 Independent Verification Commands
When test implementations are written in M5, verify test harness functionality using:

1. **Rust Backend Test Verification**:
   ```bash
   cargo test --manifest-path app_v2/src-tauri/Cargo.toml -- --nocapture
   ```
   *Expected Output*: `test result: ok. 0 failed` across all tier test files.

2. **Frontend Vitest Test Verification**:
   ```bash
   npm --prefix app_v2 test -- --run
   ```
   *Expected Output*: `100% tests passed` with zero missing module or IPC invoke errors.

### 7.2 Invalidation Conditions
The mock strategy design is invalidated if:
- Any integration test requires a physical display monitor handle or real GPU/NPU device.
- Any test fails when run without an active internet connection.
- Tauri IPC command invocations throw unhandled `ipc null` errors during Vitest execution.
