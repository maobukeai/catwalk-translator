# CG AI Screenshot Translator v2.0 Specification & Mining Report

## Executive Overview

This specification document provides a comprehensive, fine-grained analysis of all explicit and implicit functional requirements, UI/UX aesthetics & layout constraints, OCR & DPI coordinate mapping specifications, multi-tier translation pipeline rules, performance metrics, and acceptance criteria for the **CG AI Screenshot Translator v2.0** desktop application.

The project transitions from a legacy Python/PyQt6 prototype (`main.py`, `core/*`) to a modern **Tauri 2.0 (Rust) + React 18 (Vite + TailwindCSS) + RapidOCR ONNX (`ort`)** native application architecture.

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| F1 | Desktop Container | System Tray Management | Application runs in system tray with custom icon and context menu for quick controls | User mouse click / right-click | Tray menu (Preset switch, Capture trigger, Settings, Exit) | Fallback to default tray icon if custom asset missing | `main.py:42-84`, `ORIGINAL_REQUEST.md:R1` |
| F2 | Desktop Container | Global Hotkey Listener | Listens to system-wide keyboard shortcuts (`Ctrl+Alt+D`, `F4`) to trigger screen capture | Keyboard events across any active window | Emits capture signal to spawn selection overlay | Re-bind or log warning if hotkey registration fails | `main.py:86-96`, `ORIGINAL_REQUEST.md:R1` |
| F3 | UI/UX | Fluent/Dark Settings Panel | React 18 settings interface for managing hotkeys, presets, LLM endpoints, and theme | User mouse/keyboard input | Updated application configuration state (JSON) | Fallback to default config on invalid JSON | `ORIGINAL_REQUEST.md:R1`, `app_v2/src/App.tsx` |
| F4 | UI/UX | Dimmed Screen Selection Overlay | Full-screen dimming overlay (`rgba(0,0,0,0.4)`) with interactive mouse drag rectangle selection | Mouse press, drag, and release | Selected logical rectangle `QRect(x, y, w, h)` | Cancel selection on Right-Click or ESC key | `core/capture.py:27-112`, `ORIGINAL_REQUEST.md:R1` |
| F5 | UI/UX | In-Place Canvas/Web Overlay | Translucent top-most window overlay rendering translated text directly over original screen positions | Positioned items with bounding boxes and translated text | Rendered text blocks with adaptive rounded backgrounds | Gracefully hides overlay on mouse click or ESC key | `core/overlay.py:7-91`, `ORIGINAL_REQUEST.md:R1` |
| F6 | OCR | Native ONNX RapidOCR Engine | End-side ONNX Runtime (`ort` crate) loading RapidOCR `det` and `rec` models | Cropped image buffer (RGB/BGR) | Bounding polygons `[[x1,y1],[x2,y2],[x3,y3],[x4,y4]]`, text, confidence | Returns empty list if no text detected or ONNX error | `core/ocr.py:5-37`, `ORIGINAL_REQUEST.md:R2` |
| F7 | Coordinate Mapping | Physical vs Logical DPI Scaling | Bidirectional conversion between logical screen points and physical screen pixels | `PhysicalPosition`, `PhysicalSize`, DPI `scale_factor` | Physical crop rect & exact logical overlay placement | Ensures alignment error < 1px across mixed-DPI monitors | `core/capture.py:94`, `ORIGINAL_REQUEST.md:R2,A1` |
| F8 | OCR | Phrase Line Reconstruction | Merges horizontally adjacent single-word OCR boxes into contiguous phrase lines | Raw OCR items with bounding boxes | Merged phrase items with unified envelope box & average score | Leaves isolated boxes unmerged if gap > threshold | `core/reconstruction.py:8-118` |
| F9 | Translation | CG Preset Terminology Matching | Case-insensitive lookup against hardcoded CG dictionaries (Blender, Substance, Unity) | Cleaned English phrase string | Chinese CG translation term | Proceeds to Tier 2/3 if term not found in preset | `core/translator.py:12-134`, `ORIGINAL_REQUEST.md:R3` |
| F10 | Translation | Cross-Domain Preset Fallback | If active preset misses, checks all other CG domain dictionaries before web calls | Cleaned English phrase string | Chinese CG translation term | Proceeds to Tier 2/3 if term missing in all presets | `core/translator.py:130-134`, `ORIGINAL_REQUEST.md:R3` |
| F11 | Translation | Multi-Tier API Fallback (LLM & Traditional) | Multi-tier fallback: Preset -> LLM (DeepSeek/OpenAI/Ollama) -> Traditional API (Google/DeepL) | English text string | Translated Chinese string | Returns original text if all network tiers fail/timeout | `core/translator.py:135-176`, `ORIGINAL_REQUEST.md:R3` |
| F12 | Layout | Background Color Edge Sampling | Samples Outer ring border pixels around text box to calculate median background color | Screenshot image & text bounding polygon | Median RGB color, dark/light flag, contrast text color | Defaults to dark gray `#1E2026` if image sampling fails | `core/sampler.py:9-56` |
| F13 | Layout | Dynamic Font Metric Fitting | Calculates largest font size (8pt to 40pt) that fits target bounding box | Text string, box width, box height | Fitted `QFont` / font-size & bounding rectangle | Clamps to minimum 8pt font if box is tiny | `core/layout.py:8-30` |
| F14 | Infra | Circuit Breaker & Safety Net | Timeout handling (3s per tier), graceful network degradation, contract validation | IPC payload / API request | Valid response or fallback value | Circuit breaker triggers fallback without app crash | `ORIGINAL_REQUEST.md:R4` |
| F15 | Build/Packaging | Portable Windows EXE Bundle | Build system produces standalone portable `.exe` bundle (< 40MB) | `cargo build --release` / `tauri build` | Standalone portable executable file | Build failure if dependencies or tests fail | `ORIGINAL_REQUEST.md:A1,A2` |

---

## Edge Cases

| # | Feature | Input / Trigger Condition | Observed / Required Behavior |
|---|---------|---------------------------|------------------------------|
| E1 | Coordinate Mapping | Selection spanning across multi-monitors with different DPI scaling (e.g. 100% Main + 150% Secondary) | Map selection bounds using each monitor's respective physical scale factor; misalignment error must remain < 1px. |
| E2 | Screen Capture | User drags a selection box smaller than 10x10 pixels | Selection is treated as invalid/cancelled; no OCR pipeline triggered, overlay closes gracefully. |
| E3 | Global Hotkey | Hotkey combo (e.g., `Ctrl+Alt+D`) is already registered by another running application | Catch registration error, log warning, keep application running, and allow user re-configuration in settings. |
| E4 | Phrase Reconstruction | Multi-line text block with tight vertical spacing (`vertical_overlap_ratio < 0.5`) | Verify line clustering does not accidentally merge text from line 1 and line 2 into a single horizontal phrase. |
| E5 | Phrase Reconstruction | Words separated by a wide gap (e.g., table columns or distant UI labels) | Gap `gap_x > average_height * 0.8` prevents merging, keeping text boxes distinct. |
| E6 | Translation Pipeline | Network connection lost / offline mode | Preset dict lookup still functions 100% offline; network fallbacks (LLM/Google) fail fast within 3s timeout and return raw text. |
| E7 | Translation Pipeline | Mixed case or custom capitalizations (e.g., `"Principled BSDF"`, `"PRINCIPLED BSDF"`) | Converted to lower-case (`lower_text`) prior to dictionary lookup, successfully matching `"principled bsdf"`. |
| E8 | Color Sampling | Text bounding box sits directly on a gradient background or busy texture | Outer border edge sampling + median RGB filtering cancels out isolated outlier pixels, returning stable background color. |
| E9 | Color Sampling | Extremely bright white background UI (e.g. Substance Painter Light Theme) | `is_dark_bg` evaluates to `false` (`brightness >= 128`), text color switches from white to dark charcoal (`#141419`). |
| E10 | Dynamic Font Fitting | Very long translated phrase inside a narrow bounding box | Iterates down to 8pt minimum font size; if still exceeding, wraps or clips cleanly within box boundaries. |
| E11 | System Tray | User closes main settings window | Window hides while process stays alive in system tray (`setQuitOnLastWindowClosed(False)` equivalent). |
| E12 | Build & Binary Size | Packing ONNX models (`det` & `rec`) into portable EXE | Total executable bundle size must be maintained <= 40MB through ONNX model quantization/compression and strip flags. |

---

## Detailed Requirement Specifications

### Section 1: UI/UX & Desktop Container Requirements (R1)

1. **Framework & Architecture**:
   - Application shell built on **Tauri 2.0** with Rust backend and **React 18** frontend (Vite + TailwindCSS).
   - Responsive, dark-mode Fluent Design aesthetic.
2. **System Tray Integration**:
   - Custom tray icon with context menu containing:
     - Active Dictionary Preset Switcher: `Blender`, `Substance Painter`, `Unity`, `General 3D`.
     - Screen Capture Trigger (`Start Screenshot Translation`).
     - Settings Panel Toggle.
     - Exit Application.
3. **Global Shortcuts**:
   - System-wide hotkey bindings: `Ctrl+Alt+D` and `F4`.
   - Configurable keybindings stored in app configuration (`tauri-plugin-global-shortcut`).
4. **Screen Selection Overlay**:
   - Fullscreen transparent window spanning virtual screen geometry.
   - Darkened mask background (`rgba(0,0,0,0.4)`).
   - High-contrast selection border with cyan accent (`#00C8FF`).
   - ESC key or Right-Click cancels selection.
5. **In-Place Floating Overlay**:
   - Frameless, translucent top-most window.
   - Renders translated Chinese text directly over original source text bounding boxes.
   - Supports 4px rounded background rectangles with dynamic alpha blending.

### Section 2: High-Performance Side OCR & DPI Scaling Specifications (R2)

1. **ONNX RapidOCR Engine**:
   - Rust backend native integration via `ort` (ONNX Runtime) crate.
   - Models: PP-OCRv4 detection (`ch_PP-OCRv4_det_infer.onnx`) and recognition (`ch_PP-OCRv4_rec_infer.onnx`).
   - Output format per item:
     - `box`: Polygon vertices `[[x1, y1], [x2, y2], [x3, y3], [x4, y4]]`
     - `text`: Extracted string
     - `score`: Confidence value (float 0.0 - 1.0)
2. **DPI Coordinate & Multi-Monitor Mapping**:
   - Must calculate `physical_rect = logical_rect * scale_factor` when grabbing screen images.
   - Must map detected physical OCR polygons back to logical window coordinates: `logical_pt = physical_pt / scale_factor`.
   - Guaranteed coordinate alignment error **< 1 pixel** across 100%, 125%, 150%, and 200% DPI scales and heterogeneous multi-display setups.
3. **Phrase Line Reconstruction Algorithm**:
   - Sorts detected text items by `center_y`.
   - Clusters items into lines if `abs(item.center_y - line.avg_center_y) < line.avg_height * 0.5`.
   - Sorts items in each line by `min_x`.
   - Merges adjacent items if `gap_x <= avg_height * 0.8`.
   - Output: Enclosing bounding box, concatenated text joined with space (`" "` ), averaged confidence score.

### Section 3: Multi-Tier Translation Pipeline Specifications (R3)

1. **Preset Dictionary Tier (Tier 1 - Offline & Highest Priority)**:
   - Presets: `Blender`, `Substance Painter`, `Unity`, `General 3D`.
   - Hardcoded dictionary datasets (migrated to JSON assets):
     - **Blender Dict**: 44 terms (`principled bsdf` -> `原理化BSDF`, `subsurface scattering` -> `次表面散射`, `color ramp` -> `渐变节点`, `subdivision surface` -> `细分曲面`, etc.)
     - **Substance Dict**: 27 terms (`ambient occlusion` -> `环境光遮蔽`, `fill layer` -> `填充图层`, `bake mesh maps` -> `烘焙网格贴图`, `smart material` -> `智能材质`, etc.)
     - **Unity Dict**: 9 terms (`albedo` -> `漫反射/基础色`, `smoothness` -> `平滑度`, `zwrite` -> `深度写入`, etc.)
   - Case-insensitive exact match priority: Active Preset -> Other Presets -> Online Tiers.
2. **LLM Translation Tier (Tier 2 - Online)**:
   - Configurable REST API connectors for:
     - **DeepSeek** (`https://api.deepseek.com`)
     - **OpenAI** (`https://api.openai.com`)
     - **Ollama** (`http://localhost:11434`)
   - System prompt tailored for 3D/CG software terminology translation.
3. **Traditional API Tier (Tier 3 - Online Fallback)**:
   - Google Translate Free API (`https://translate.googleapis.com/translate_a/single?client=gtx`).
   - DeepL / MyMemory API (`https://api.mymemory.translated.net/get`).
4. **Offline / Network Fault Fallback**:
   - If network tiers time out (> 3000 ms) or return errors, return original source text.

### Section 4: Color Sampling & Dynamic Font Fitting Specifications

1. **Background Color Sampling Algorithm**:
   - Outwards padding `padding = 4px`.
   - Outer ring border extraction (top, bottom, left, right edge pixels).
   - Median RGB computation to filter noise.
   - Perceived brightness calculation: `brightness = 0.299*R + 0.587*G + 0.114*B`.
   - Foreground font color selection:
     - Dark background (`brightness < 128`): Font color White (`#FFFFFF`).
     - Light background (`brightness >= 128`): Font color Dark Charcoal (`#141419`).
   - Background fill color: RGB with opacity 240/255.
2. **Dynamic Font Metric Fitting**:
   - Target bounding box size: `box_w`, `box_h`.
   - Iterates font size down from `max_size = min(box_h * 0.85, 40)` to `min_size = 8`.
   - Condition: `text_width <= box_w * 0.98` AND `text_height <= box_h * 0.98`.
   - Render style: Rounded rectangle background with 4px border radius and 1px stroke border outline.

### Section 5: Architectural Quality, Performance & Acceptance Criteria (A1, A2)

1. **Performance Metrics (A1)**:
   - Portable Windows binary bundle size: **<= 40 MB**.
   - Cold startup launch time: **< 500 ms**.
   - Alignment position error under DPI scaling: **< 1 pixel**.
   - Priority matching rate for Blender/Substance terms: **100%**.
2. **Build & Quality Loop (A2)**:
   - Frontend `npm run build` and `npm run test` pass with 0 errors and 0 warnings.
   - Backend `cargo check` and `cargo test` pass 100%.
   - Automated packaging generates a portable Windows `.exe` executable.
