# 5-Component Handoff Report: Specification Mining for CG AI Screenshot Translator v2.0

## 1. Observation

- **Dispatch Assignment & User Request**:
  - `ORIGINAL_REQUEST.md` (lines 1-38): Specifies migration of Python CG AI Translator to Tauri 2.0 (Rust) + React 18 + RapidOCR ONNX (`ort`). Highlights requirements R1-R4 and Acceptance Criteria A1-A2.
- **Legacy Python Codebase Analysis**:
  - `main.py`: Entry point using `PyQt6.QtWidgets.QApplication`, `QSystemTrayIcon`, `pynput.keyboard.GlobalHotKeys` (`Ctrl+Alt+D`, `F4`), daemon worker threads.
  - `core/ocr.py`: Initializes `RapidOCR()` engine, converts PIL image to BGR numpy array, returns bounding polygons `[[x1,y1],[x2,y2],[x3,y3],[x4,y4]]`, text, and confidence scores.
  - `core/reconstruction.py`: `TextReconstructor` clusters OCR output by `center_y` (vertical overlap threshold = 0.5) and merges adjacent horizontal words if `gap_x <= avg_height * 0.8`.
  - `core/translator.py`: Defines dictionary presets (`BLENDER` with 44 terms, `SUBSTANCE` with 27 terms, `UNITY` with 9 terms, `GENERAL`). Implements multi-tier fallback: Current Preset -> All Presets -> Google API -> MyMemory API -> Raw Text.
  - `core/sampler.py`: `BackgroundSampler` outer-ring pixel extraction (`padding=4`), median RGB calculation, perceived brightness threshold `brightness < 128` (dark vs light background text color decision).
  - `core/layout.py`: `LayoutEngine` font metric fitting loop from max size down to 8pt, verifying `text_w <= target_w * 0.98` and `text_h <= target_h * 0.98`.
  - `core/overlay.py`: `OverlayWidget` frameless translucent window, rendering rounded rectangles (`addRoundedRect`) and centered translated text.
  - `core/capture.py:94`: Highlighted DPI scaling issue in legacy Python (`screen.grabWindow(0)` vs `selection_rect` logical coordinates).
- **Target Container `app_v2` Setup**:
  - `app_v2/package.json`: React 19, `@tauri-apps/api^2`, `@tauri-apps/plugin-opener^2`, TailwindCSS 4, Zustand 5, Vite 7.
  - `app_v2/src-tauri/Cargo.toml`: Tauri 2, `serde`, `serde_json`.

## 2. Logic Chain

1. **Observation**: Legacy Python implementation provides explicit algorithms for text line merging, color sampling, preset lookup, and dynamic layout. `ORIGINAL_REQUEST.md` specifies replacing Python with native Rust ONNX runtime (`ort`) and React 18 frontend.
2. **DPI Mapping Logic**: Physical screenshot capture dimensions differ from logical screen window points when DPI scale != 100%. To achieve acceptance criterion A1 (< 1px alignment error), Rust backend must scale logical rect to physical coordinates before cropping (`physical_rect = logical_rect * scale_factor`), and scale physical bounding polygons back to logical window coordinates for overlay positioning (`logical_pos = physical_pos / scale_factor`).
3. **Translation Multi-Tier Pipeline Logic**: Preset dictionaries (Blender, Substance, Unity) handle CG term precision locally (offline). When terms miss, LLM REST endpoints (DeepSeek/OpenAI/Ollama) or traditional fallback APIs (Google/DeepL) process long sentences. Timeout protection (3s) ensures network failures fail-safe to original raw text.
4. **Packaging & Performance Logic**: Total executable bundle size constraint (<= 40MB) and launch speed (< 500ms) require ONNX model quantization/compression and native compilation via Cargo release flags (`opt-level = "z"`, `strip = true`).

## 3. Caveats

- The current `app_v2/src-tauri/Cargo.toml` contains baseline dependencies; additional crates (`ort`, `image`, `reqwest`, `tauri-plugin-global-shortcut`) will need to be declared during implementation.
- RapidOCR ONNX model weights (`ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`) must be placed in `app_v2/src-tauri/models/` and bundled into the binary or release assets.

## 4. Conclusion

All functional, UI/UX, OCR, coordinate mapping, translation pipeline, performance, and acceptance specifications have been mined and fully documented in `spec_analysis.md`. The feature discovery table (F1-F15) and edge case matrix (E1-E12) provide an complete foundation for subsequent implementation and verification phases.

## 5. Verification Method

- **Specification Verification**:
  - Read `.agents/spec_miner_1/spec_analysis.md` and verify all 15 discovered features (F1-F15) and 12 edge cases (E1-E12) match the requirements in `ORIGINAL_REQUEST.md` and Python legacy codebase `main.py` / `core/*`.
- **Workspace Layout Verification**:
  - Confirm presence of `DISPATCH.md`, `BRIEFING.md`, `progress.md`, `spec_analysis.md`, and `handoff.md` within `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\spec_miner_1`.
