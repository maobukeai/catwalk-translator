# Handoff Report — Codebase Exploration & Rust/Tauri 2.0 Migration Analysis

## 1. Observation

### 1.1 Existing Python Codebase Files & Line Quotes
- **`main.py`**:
  - Line 29-33: `self.ocr_engine = OCREngine()`, `self.reconstructor = TextReconstructor()`, `self.sampler = BackgroundSampler()`, `self.translator = Translator(default_preset=TranslationPreset.GENERAL)`.
  - Line 90-93: Global hotkeys registered via `pynput.keyboard.GlobalHotKeys` for `'<ctrl>+<alt>+d'` and `'<f4>'`.
- **`core/ocr.py`**:
  - Line 8: `self.engine = RapidOCR()`.
  - Line 27-36: Calls `self.engine(img_bgr)` returning `[box, text, score]` where `box` is 4-point polygon `[[x1,y1],[x2,y2],[x3,y3],[x4,y4]]`.
- **`core/reconstruction.py`**:
  - Line 4-7: `TextReconstructor(horizontal_gap_ratio=0.8, vertical_overlap_ratio=0.5)`.
  - Line 48: Merges OCR bounding boxes into lines if vertical distance `< avg_height * 0.5`.
  - Line 75-77: Merges adjacent words into phrases if horizontal gap `gap_x <= allowable_gap (avg_height * 0.8)`.
- **`core/translator.py`**:
  - Line 17-61 (`blender_dict`): 44 terms including `"principled bsdf": "原理化BSDF"`, `"subsurface scattering": "次表面散射"`, `"roughness": "粗糙度"`.
  - Line 64-92 (`substance_dict`): 27 terms including `"ambient occlusion": "环境光遮蔽"`, `"fill layer": "填充图层"`, `"bake mesh maps": "烘焙网格贴图"`.
  - Line 95-105 (`unity_dict`): 9 terms including `"albedo": "漫反射/基础色"`, `"zwrite": "深度写入"`.
  - Line 125-144: Priority pipeline: Active Preset Dict -> Any CG Preset Dict -> Online Google Free API -> Online MyMemory API -> Raw Text fallback.
- **`core/capture.py`**:
  - Line 29-37: Captures screen using `QApplication.primaryScreen().grabWindow(0)` and `showFullScreen()`.
  - Line 94: `cropped_pixmap = self.full_screen_pixmap.copy(selection_rect)` — passes logical `selection_rect` to `full_screen_pixmap` (which contains physical pixels on high-DPI display, causing DPI offset/scaling bug).
- **`core/sampler.py`**:
  - Line 22-39: Samples 4px outer ring surrounding text box (`outer_crop`), calculates `median_rgb` to isolate background color.
  - Line 43-49: Brightness `0.299*R + 0.587*G + 0.114*B`; sets text color to `#ffffff` if dark bg or `#141419` if light bg.
- **`core/overlay.py` & `core/layout.py`**:
  - `LayoutEngine.compute_fitting_font` (layout.py:8-30): Iterates font sizes from max down to min size using `QFontMetrics` fitting box bounds.
  - `OverlayWidget` (overlay.py:14-36): Frameless, translucent top-most window (`WA_TranslucentBackground`). Draws rounded rects with sampled background color.

### 1.2 Target Project Structure (`app_v2`)
- **`app_v2/package.json`**: React 19 / Vite 7 / TailwindCSS 4 / Tauri API 2.
- **`app_v2/src-tauri/Cargo.toml`**: Tauri v2, Serde, Serde_json dependencies.

---

## 2. Logic Chain

1. **Observation 1.1** shows the exact functionality and data flow of the Python implementation: Screen capture -> RapidOCR bounding box detection -> `TextReconstructor` line/word merging -> Multi-tier dictionary & API translation -> `BackgroundSampler` edge median color sampling -> `LayoutEngine` font fitting -> `OverlayWidget` rendering.
2. **Observation 1.1 (capture.py:94)** highlights the DPI coordinate bug in PyQt: `grabWindow(0)` returns physical pixels, but Qt selection rect uses logical points. In high-DPI environments (125%, 150%, 200%), directly passing logical rects to physical pixel pixmaps causes misaligned selection crops.
3. Therefore, migrating to Tauri 2.0 (Rust) requires using Tauri's native `PhysicalPosition` / `PhysicalSize` and `scale_factor` to guarantee exact sub-pixel precision across multi-monitor & high-DPI setups.
4. **Observation 1.1 (translator.py)** shows that dictionary terms (Blender, Substance, Unity) are currently hardcoded Python dictionaries. To support modular dictionary management in Rust/Tauri, these terms must be extracted into static/dynamic JSON files (`blender.json`, `substance.json`, `unity.json`).
5. **Observation 1.2** confirms that `app_v2` has been initialized as a Tauri 2.0 + React 18 skeleton. The Rust backend can natively execute RapidOCR via the `ort` ONNX Runtime crate, process image sampling and phrase reconstruction, while React 18 manages the Fluent/Dark settings UI and overlay display.

---

## 3. Caveats

- **ONNX Model Weights**: The existing Python project relies on `rapidocr_onnxruntime` package which auto-downloads ONNX model weights (`ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`) at runtime into Python site-packages/user home. In Rust, these model files must either be bundled as Tauri resources or downloaded on first run.
- **Multi-Monitor Screen Capture**: Python's `primaryScreen().grabWindow(0)` only captures the primary screen. In Rust/Tauri 2.0, multi-monitor screenshot support via `xcap` / `screenshots` crate or native Win32 APIs should be utilized to cover all connected displays seamlessly.

---

## 4. Conclusion

The existing CG AI Screenshot Translator codebase provides a complete, working algorithm blueprint (OCR -> line reconstruction -> term mapping -> color sampling -> overlay layout).

For the Tauri 2.0 (Rust) + React 18 migration:
1. **Dictionaries**: Convert hardcoded Python dicts into `assets/dicts/*.json` files.
2. **Rust Backend (`src-tauri/src`)**:
   - `ocr.rs`: RapidOCR inference via `ort` crate.
   - `reconstruction.rs`: Port line clustering & horizontal phrase merging.
   - `sampler.rs`: Port outer ring median color sampling & perceived brightness logic.
   - `translator.rs`: Multi-tier pipeline (Preset JSON -> CG fallback -> LLM API -> Online API).
   - `capture.rs`: Multi-monitor physical pixel screen capture & DPI scale factor coordinate mapper.
3. **React Frontend (`src/`)**:
   - Fluent Design / Dark Mode configuration dashboard & preset selector.
   - Canvas/Web overlay rendering for original in-place text replacement.

---

## 5. Verification Method

To verify this analysis independently:
1. **Inspect Python core files**: Read `main.py`, `core/*.py`, `scratch/*.py` to verify algorithm details quoted in Section 1.
2. **Inspect Migration Target**: Check `app_v2/package.json` and `app_v2/src-tauri/Cargo.toml` to verify Tauri 2.0 skeleton.
3. **Inspect Detailed Analysis**: Read `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_1\codebase_analysis.md`.
