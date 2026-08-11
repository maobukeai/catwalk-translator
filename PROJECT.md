# Project: CG AI Screenshot Translator (Tauri 2.0 + React 19 + RapidOCR ONNX)

## Architecture
- **Desktop Container**: Tauri 2.0 (Rust) + Tokio async runtime.
- **Frontend App**: React 19 + Vite 7 + TailwindCSS 4 + Zustand + Lucide Icons. Dark mode & Fluent Design styling.
- **OCR Engine**: Native Rust ONNX Runtime (`ort` crate v2.x, CPU EP) running PP-OCRv4 DBNet detection & SVTR recognition models (~15.5MB).
- **Coordinate Mapper**: PhysicalPosition / PhysicalSize & Monitor `scale_factor()` DPI scaling transformer (<1px error across multi-monitors).
- **Translation Pipeline**: Multi-Tier Engine (Preset JSON Dictionaries -> CG Fallback Dict -> LLM APIs [DeepSeek/OpenAI/Ollama] -> Free Online APIs [Google/MyMemory]).
- **Overlay System**: Dual-layer hybrid overlay (Layer 1 Canvas 2D selection/mask + Layer 2 React DOM interactive translation cards).

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

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Tauri 2.0 Infra & UI Skeleton | Setup Tauri 2.0 app, React 19 settings UI, Fluent/Dark theme, system tray, global hotkeys | none | DONE |
| 2 | M2: High-DPI Capture & RapidOCR ONNX Engine | Implement Rust multi-monitor capture, DPI scale factor coordinate mapper, ONNX `ort` RapidOCR engine & line reconstructor | M1 | DONE |
| 3 | M3: Multi-Tier Translation Pipeline & Dictionaries | Implement CG dicts (Blender/Substance/Unity JSONs), LLM APIs bridge, Online API fallbacks, tier selector | M1 | DONE |
| 4 | M4: Color Sampler & Interactive Canvas/Web Overlay | Rust background color sampler & contrast calculator, React 19 Canvas 2D + DOM overlay card component | M2, M3 | DONE |
| 5 | M5: E2E Testing, Adversarial Hardening & Portable Build | 100% E2E test pass (cargo test + npm test), Tier 5 adversarial hardening, portable EXE build <40MB, startup <500ms | M1, M2, M3, M4 | IN_PROGRESS (S1 portable PASSED: 39.8MB, 151.5ms cold-start; S2 E2E + S3 hardening pending) |


## Interface Contracts
### Rust Backend ↔ React Frontend (Tauri IPC Commands)
- `cmd_capture_and_ocr(selection: PhysicalRect) -> Result<OcrResult, String>`
- `cmd_translate_phrases(phrases: Vec<String>, preset: String, llm_config: Option<LlmConfig>) -> Result<Vec<TranslationResult>, String>`
- `cmd_sample_colors(image_crop: Vec<u8>, boxes: Vec<BoundingBox>) -> Result<Vec<ColorSample>, String>`
- `cmd_save_settings(settings: AppSettings) -> Result<(), String>`
- `cmd_get_settings() -> Result<AppSettings, String>`

## Code Layout
```
app_v2/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── capture.rs       # Multi-monitor screenshot & DPI coordinate mapper
│   │   ├── ocr.rs           # RapidOCR ONNX ort inference engine
│   │   ├── reconstruction.rs# Line clustering & word merging algorithm
│   │   ├── translator.rs    # Multi-tier translation pipeline & JSON dict loader
│   │   ├── sampler.rs       # Outer ring median RGB sampler & brightness calculation
│   │   └── commands.rs      # Tauri IPC command handlers
│   ├── assets/
│   │   ├── models/          # ch_PP-OCRv4_det_infer.onnx, ch_PP-OCRv4_rec_infer.onnx, ppocr_keys_v1.txt
│   │   └── dicts/           # blender.json, substance.json, unity.json
│   ├── Cargo.toml
│   └── tauri.conf.json
└── src/
    ├── components/
    │   ├── Settings/        # Dark / Fluent Settings Dashboard
    │   ├── Overlay/         # Canvas 2D selection & React DOM translation overlay
    │   └── Common/          # Buttons, Inputs, Tooltips
    ├── stores/              # Zustand state management
    ├── services/            # Tauri IPC wrappers
    ├── App.tsx
    └── main.tsx
```
