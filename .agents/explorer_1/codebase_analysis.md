# Technical Exploration Report: CG AI Screenshot Translator Codebase Analysis

## 1. Executive Summary & Architectural Overview

This report provides a comprehensive technical exploration of the existing Python/PyQt CG AI Screenshot Translator codebase (`main.py`, `core/`, `scratch/`) and assesses the migration path to a modern, high-performance desktop application built with **Tauri 2.0 (Rust) + React 18 + RapidOCR ONNX (`ort`)**.

### Existing System Architecture (Python / PyQt6)
```
+-----------------------------------------------------------------------------------+
|                                 main.py (GUI App)                                 |
|  - SystemTrayIcon (Qt Context Menu) & pynput Global Hotkeys (Ctrl+Alt+D, F4)       |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                        core/capture.py (ScreenCaptureWidget)                      |
|  - Fullscreen transparent overlay, mouse drag area selection, image cropping       |
+----------------------------------------+------------------------------------------+
                                         | emits (PIL.Image, offset_x, offset_y)
                                         v
+-----------------------------------------------------------------------------------+
|                          Worker Thread (Processing Pipeline)                       |
|                                                                                   |
| 1. core/ocr.py (OCREngine via RapidOCR)                                          |
|    -> Detects bounding boxes (4-point polygons) & raw text                       |
|                                                                                   |
| 2. core/reconstruction.py (TextReconstructor)                                     |
|    -> Merges adjacent word boxes horizontally on the same line into phrases       |
|                                                                                   |
| 3. core/translator.py (Translator)                                                |
|    -> Matches active CG preset (Blender/Substance/Unity dict) or online API      |
|                                                                                   |
| 4. core/sampler.py (BackgroundSampler)                                            |
|    -> Samples surrounding border pixels to extract median RGB & dark/light status  |
+----------------------------------------+------------------------------------------+
                                         | emits (items_with_styles, offset_x, offset_y)
                                         v
+-----------------------------------------------------------------------------------+
|                         core/overlay.py (OverlayWidget)                           |
|  - Renders dynamic rounded background rects & auto-fitting Chinese text overlays   |
|    using core/layout.py (LayoutEngine) font metrics calculation                   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Comprehensive Codebase Deep-Dive

### 2.1 Entry Point & App Lifecycle (`main.py`)
- **App Instance**: Instantiates `PyQt6.QtWidgets.QApplication` with `setQuitOnLastWindowClosed(False)` to run persistently in system tray.
- **System Tray (`init_tray_icon`)**: Dynamically draws a 32x32 rounded blue icon with `"CG"` text using `QPainter`. Menu items allow setting dictionary preset (`Blender`, `Substance Painter`, `General`), triggering manual capture, or quitting.
- **Global Hotkey (`init_hotkey`)**: Spawns a daemon thread running `pynput.keyboard.GlobalHotKeys` listening to `<ctrl>+<alt>+d` and `<f4>`. Hotkey handlers trigger `SignalBus.trigger_capture_signal` which Qt marshals to `start_capture()`.
- **Async Execution**: Screenshot handling initiates a background worker thread (`threading.Thread`) to perform OCR, line merging, dictionary translation, and color sampling asynchronously, preventing Qt GUI freezes. Signals report results back to `show_overlay()`.

### 2.2 OCR Engine & Line Reconstruction (`core/ocr.py` & `core/reconstruction.py`)
- **OCR Detection (`core/ocr.py:10-37`)**:
  - Utilizes `rapidocr_onnxruntime.RapidOCR`.
  - Converts input `PIL.Image` (RGB) to BGR OpenCV `numpy` array.
  - Returns bounding boxes as 4-point polygons `[[x1,y1], [x2,y2], [x3,y3], [x4,y4]]`, detected raw text strings, and confidence scores (0.0 to 1.0).
- **Phrase Reconstruction (`core/reconstruction.py:8-118`)**:
  - Raw OCR outputs often fragment contiguous phrases (e.g. `"Base"` and `"Color"` into separate boxes).
  - `TextReconstructor` clusters items into horizontal line groups based on vertical overlap (`vertical_overlap_ratio=0.5` against `center_y`).
  - Sorts words within lines by `min_x` and merges adjacent boxes if `gap_x <= avg_height * 0.8`.
  - Merged items combine text with spaces (`"Base Color"`), calculate bounding envelope box `[min_x, min_y, max_x, max_y]`, and average confidence scores.

### 2.3 Multi-Tier Translation Pipeline & Dictionary Formats (`core/translator.py`)
- **Preset Mode (`TranslationPreset`)**: Supports `BLENDER`, `SUBSTANCE`, `UNITY`, `GENERAL`.
- **Hardcoded CG Terms Dictionaries**:
  - `blender_dict` (44 terms): e.g. `"principled bsdf"` -> `"原理化BSDF"`, `"subsurface scattering"` -> `"次表面散射"`, `"roughness"` -> `"粗糙度"`, `"metallic"` -> `"金属度"`, `"displacement"` -> `"置换贴图"`, `"color ramp"` -> `"渐变节点"`, `"subdivision surface"` -> `"细分曲面"`.
  - `substance_dict` (27 terms): e.g. `"ambient occlusion"` -> `"环境光遮蔽"`, `"fill layer"` -> `"填充图层"`, `"bake mesh maps"` -> `"烘焙网格贴图"`, `"smart material"` -> `"智能材质"`.
  - `unity_dict` (9 terms): e.g. `"albedo"` -> `"漫反射/基础色"`, `"smoothness"` -> `"平滑度"`, `"zwrite"` -> `"深度写入"`.
- **Resolution Order (`translate_text:117-144`)**:
  1. Exact lower-case match in active preset dictionary.
  2. Exact lower-case match in any available CG preset dictionary (fallback across CG domains).
  3. Online Fallback Tier 1: Google Free API (`https://translate.googleapis.com/translate_a/single?client=gtx`).
  4. Online Fallback Tier 2: MyMemory API (`https://api.mymemory.translated.net/get`).
  5. Default Fallback: Original raw text.

### 2.4 Color Sampling, Screenshot & Overlay Mechanics (`core/capture.py`, `core/sampler.py`, `core/layout.py`, `core/overlay.py`)
- **Screen Selection (`core/capture.py`)**:
  - `ScreenCaptureWidget` creates a frameless, top-level overlay window spanning `screen.virtualGeometry()`.
  - Captures fullscreen via `QApplication.primaryScreen().grabWindow(0)`.
  - Darkens screen with semi-transparent black mask (`rgba(0,0,0,100)`), highlights user selection box with cyan borders (`rgb(0,200,255)`), crops pixmap, converts to PIL RGBA image, and passes `(pil_img, offset_x, offset_y)`.
- **DPI Handling & Issues Identified**:
  - `screen.grabWindow(0)` captures physical device pixels, whereas `screen.virtualGeometry()` and Qt widgets use logical point coordinates.
  - In `capture.py:94`, `full_screen_pixmap.copy(selection_rect)` passes logical coordinates into a physical pixel pixmap. On displays with DPI scale != 100% (e.g. 125%, 150%), this causes selection misalignment and incorrect crop dimensions!
- **Background Color Sampling (`core/sampler.py:9-56`)**:
  - Pads text bounding box outwards by 4 pixels (`padding=4`).
  - Extracts outer ring border pixels (top, bottom, left, right edges).
  - Computes `median_rgb` to ignore outlier text pixels or noise.
  - Computes perceived brightness: `brightness = 0.299*R + 0.587*G + 0.114*B`.
  - Determines background color (RGB with alpha 240) and high-contrast text color (White for dark background, Dark Charcoal `#141419` for light background).
- **Auto-fitting Layout (`core/layout.py:8-30`)**:
  - `LayoutEngine` iterates font sizes from max allowed down to min (8pt to 40pt) using `QFontMetrics` to fit target box dimensions (`text_w <= target_w * 0.98` and `text_h <= target_h * 0.98`).
- **Overlay Window (`core/overlay.py`)**:
  - `OverlayWidget` creates a translucent top-most window enclosing all detected text boxes with 20px padding.
  - Draws rounded background rects (`QPainterPath.addRoundedRect(rect, 4, 4)`), subtle border outlines, and centered translated text.

---

## 3. Rust / Tauri 2.0 Migration Mapping & Blueprint

To satisfy requirements R1-R4 and acceptance criteria A1-A2, the Python codebase components are mapped to Tauri 2.0 (Rust backend) + React 18 frontend:

| Component / Function | Python Implementation | Rust / Tauri 2.0 Strategy | Migration Details & Target Files |
|---|---|---|---|
| **App Shell & UI** | PyQt6 `QApplication` | Tauri 2.0 Desktop Container + React 18 (Vite + TailwindCSS) | `app_v2/src/App.tsx`, `app_v2/src/components/` (Settings panel, Preset switcher, Floating Overlay canvas) |
| **System Tray & Hotkey** | `QSystemTrayIcon`, `pynput` thread | `tauri::tray::TrayIconBuilder`, `tauri-plugin-global-shortcut` | Setup in `app_v2/src-tauri/src/lib.rs` |
| **Screen Capture & DPI** | `ScreenCaptureWidget` (`grabWindow`) | `xcap` / `screenshots` crate or Tauri multi-window screenshot capture + `PhysicalPosition` / `PhysicalSize` scale factor | Rust backend commands in `app_v2/src-tauri/src/capture.rs` |
| **OCR Backend** | `rapidocr_onnxruntime` | Native Rust `ort` (ONNX Runtime crate) running RapidOCR models (`det` & `rec`) | `app_v2/src-tauri/src/ocr.rs` |
| **Text Merging** | `TextReconstructor` (`np.array`) | Rust struct `TextReconstructor` with line clustering & bounding box math | `app_v2/src-tauri/src/reconstruction.rs` |
| **Color Sampler** | `BackgroundSampler` (`numpy`) | Rust struct `BackgroundSampler` reading `image::RgbImage` edge medians | `app_v2/src-tauri/src/sampler.rs` |
| **Translation Engine** | `Translator` (hardcoded dicts + urllib) | Multi-tier Rust engine (`HashMap` preset dicts + LLM DeepSeek/OpenAI/Ollama + reqwest Google/DeepL) | `app_v2/src-tauri/src/translator.rs` & `app_v2/src-tauri/assets/dicts/*.json` |
| **Overlay Render** | `OverlayWidget` (PyQt QPainter) | Tauri frameless transparent overlay window or webview Canvas rendering | `app_v2/src/components/OverlayView.tsx` |

---

## 4. Key Artifacts & Assets to Migrate

1. **Dictionaries**:
   - Extract hardcoded Python dictionaries (`blender_dict`, `substance_dict`, `unity_dict`) into structured JSON files:
     - `app_v2/src-tauri/assets/dicts/blender.json`
     - `app_v2/src-tauri/assets/dicts/substance.json`
     - `app_v2/src-tauri/assets/dicts/unity.json`
2. **RapidOCR ONNX Models**:
   - `ch_PP-OCRv4_det_infer.onnx`
   - `ch_PP-OCRv4_rec_infer.onnx`
   - `ppocr_keys_v1.txt`
3. **Application Configuration JSON**:
   - Define config schema for hotkeys, active translation preset, API endpoints (DeepSeek, OpenAI, Ollama), custom terms, and UI theme settings.
