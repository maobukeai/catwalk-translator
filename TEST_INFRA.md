# E2E Test Infra: CG AI Screenshot Translator

## Test Philosophy
- **Requirement-Driven & Opaque-Box**: Derived strictly from `ORIGINAL_REQUEST.md` requirements and `PROJECT.md` specification features, independent of internal implementation code structure.
- **Systematic Design**: Built using Category-Partitioning, Boundary Value Analysis (BVA), Pairwise Combinatorial Testing, and Real-World Application Workload Scenarios.
- **Coverage Target**: 100% feature verification across Tiers 1-4 with zero false positives.

## Feature Inventory & Test Matrix
| # | Feature | Source | Tier 1 Tests | Tier 2 Tests | Tier 3 Tests | Tier 4 Tests |
|---|---------|--------|:------------:|:------------:|:------------:|:------------:|
| F1 | Modern Desktop Container & UI (Tauri 2.0 shell, React 18 UI, Fluent/Dark Theme, System Tray, Hotkeys) | R1 | 6 | 4 | 2 | 2 |
| F2 | High-DPI Screen Capture & Coordinate Mapping (Multi-monitor, PhysicalPosition, DPI scale_factor mapping <1px) | R2, A1 | 5 | 5 | 3 | 2 |
| F3 | RapidOCR ONNX & Line Reconstruction Engine (Rust `ort` ONNX PP-OCRv4, DBNet det + SVTR rec, text clustering) | R2 | 5 | 5 | 3 | 2 |
| F4 | Multi-Tier Translation Engine & CG Dictionaries (Preset Dicts, LLM API, Online Fallbacks) | R3, A1 | 6 | 6 | 3 | 3 |
| F5 | Outer Ring Median RGB Color Sampler & Interactive Canvas/Web Overlay (Perceived brightness contrast) | R1, R2 | 5 | 4 | 2 | 2 |
| F6 | E2E Test Suite & Verification Harness (cargo test + vitest / npm test integration) | R4, A2 | 5 | 4 | 2 | 2 |
| **Total** | | | **32** | **28** | **15** | **11** |

---

## Test Architecture

### 1. Test Runners & Commands
- **Rust Backend Integration & Unit Tests**:
  - Location: `app_v2/src-tauri/tests/`
  - Command: `cargo test --manifest-path app_v2/src-tauri/Cargo.toml -- --nocapture`
- **React Frontend & Integration Tests**:
  - Location: `app_v2/src/tests/`
  - Command: `npm --prefix app_v2 test -- --run` (or `vitest run`)

### 2. Tier Breakdown & Methodology

#### Tier 1 — Feature Coverage (>=5 tests per feature across F1-F6)
- **F1 (Container & UI)**: Tray menu initialization, hotkey binding registration, Fluent theme switching, settings persistence, window visibility toggle, dark/light theme style application.
- **F2 (DPI Capture & Mapping)**: Logical to physical position mapping, DPI scale factor calculation (1.0x, 1.25x, 1.5x, 2.0x), selection bounding rect normalization, multi-monitor bounds check, crop area bounds validation.
- **F3 (RapidOCR ONNX & Reconstruction)**: Image tensor conversion, DBNet text box detection, SVTR text recognition, line clustering thresholding, word box merging logic.
- **F4 (Multi-Tier Translation)**: Preset CG dictionary exact lookup (Blender/Substance/Unity), LLM API query formatter, Online API fallback sequence, tier priority resolution, translation cache store/retrieve, batch phrase processing.
- **F5 (Color Sampler & Overlay)**: Outer ring 4px median RGB calculation, perceived brightness formula ($Y = 0.299R + 0.587G + 0.114B$), contrast text color decision (black/white), overlay card positioning, interactive card event handling.
- **F6 (Harness & Integration)**: Mock IPC pipeline verification, test report formatter, environment check, mock ONNX engine initialization, mock dict loader integrity.

#### Tier 2 — Boundary & Corner Cases
- **Empty & Extremes**: Empty image crop (0x0px), zero-length text input, maximum long text string (10,000+ chars), missing dictionary files, invalid JSON dict format.
- **DPI Extremes**: 100% (1.0x), 125% (1.25x), 150% (1.5x), 200% (2.0x) scaling on non-standard monitor resolutions (e.g. 3840x2160, 2560x1440, mixed DPI dual-monitor setup).
- **Network & API Failures**: LLM API timeout fallback, HTTP 429 rate limit fallback, offline network fallback to local CG dictionary, malformed LLM JSON response recovery.

#### Tier 3 — Cross-Feature Combinations
- Hotkey Trigger -> Screen Capture -> RapidOCR Text Extraction -> CG Dictionary Match -> Overlay Card Positioning E2E pipeline.
- High-DPI (150%) Multi-Monitor Selection -> Coordinate Scaler -> Color Sampler -> Perceived Brightness Text Color Calculation -> React Overlay Render.
- Multi-Tier Cascade: Preset Dict Miss -> LLM API Network Failure -> Online API Fallback -> UI Card Render.

#### Tier 4 — Real-World Application Workload Scenarios
- **Scenario 1: Blender 4.x UI Translation**: Translating complex Shader Editor UI elements ("Principled BSDF", "Subsurface Scattering", "Roughness", "Anisotropic Tangent").
- **Scenario 2: Substance Painter UI Translation**: Translating Fill Layer & Smart Material shelf items ("Height Range", "AO Mixing Mode", "Curvature Blur Radius").
- **Scenario 3: Unity 6 Engine Inspector Translation**: Translating Inspector component properties ("NavMesh Surface", "RigidBody Interpolate", "Skinned Mesh Renderer Bounds").

---

## Output Target Directory Structure
```
app_v2/
├── src-tauri/
│   └── tests/
│       ├── tier1_feature_coverage.rs
│       ├── tier2_boundary_corner.rs
│       ├── tier3_cross_feature.rs
│       └── tier4_real_world_workloads.rs
└── src/
    └── tests/
        ├── tier1_features.test.tsx
        ├── tier2_boundaries.test.tsx
        ├── tier3_combinations.test.tsx
        └── tier4_workloads.test.tsx
```
