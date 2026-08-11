# BRIEFING — 2026-08-09T01:25:00Z

## Mission
Investigate Native Rust ONNX Runtime (`ort`) RapidOCR inference engine setup in `app_v2/src-tauri/src/ocr.rs` for PP-OCRv4 detection and recognition models and key dictionary.

## 🔒 My Identity
- Archetype: Explorer
- Roles: Read-only investigation, architecture analysis, evidence chain synthesis, handoff creation
- Working directory: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\teamwork_preview_explorer_m2_2
- Original parent: f2aea20b-84ef-47eb-ade7-f210e54ff2b9
- Milestone: M2 - High-DPI Capture & RapidOCR ONNX Engine

## 🔒 Key Constraints
- Read-only investigation — do NOT implement code modifications to `app_v2/src-tauri/src/` directly
- Produce detailed handoff report in `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\teamwork_preview_explorer_m2_2\handoff.md`

## Current Parent
- Conversation ID: f2aea20b-84ef-47eb-ade7-f210e54ff2b9
- Updated: 2026-08-09T01:25:00Z

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`
  - `.agents/sub_orch_m2/SCOPE.md`
  - `PROJECT.md`
  - `app_v2/src-tauri/Cargo.toml`
  - `app_v2/src-tauri/src/ocr.rs`
  - `app_v2/src-tauri/src/models.rs`
  - `app_v2/src-tauri/src/commands.rs`
  - `app_v2/src-tauri/src/reconstruction.rs`
  - `app_v2/src-tauri/assets/`
- **Key findings**:
  - `app_v2/src-tauri/Cargo.toml` lacks `ort` crate dependency (and image processing crates like `image` or `ndarray`).
  - `app_v2/src-tauri/assets/models/` directory does not currently exist or lacks the ONNX model files (`ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`, `ppocr_keys_v1.txt`).
  - `ocr.rs` currently contains only a `MockOcrEngine` facade returning hardcoded "Principled BSDF".
- **Unexplored areas**:
  - Details of `ort` crate v2.0 API, ONNX input/output shapes for PP-OCRv4 det/rec.
  - Image preprocessing math (resize, padding, mean/std normalization in Rust).
  - DBNet postprocessing algorithm (bitmap binarization, contour finding / box extraction, polygon unclip/expansion, minimum area bounding box).
  - SVTR recognition postprocessing algorithm (CTC greedy decoder using `ppocr_keys_v1.txt`).
  - Thread safety, model initialization pattern, lazy load / static memory management, unit test strategy.

## Key Decisions Made
- Perform deep dive into all 6 investigation topics requested and synthesize into `handoff.md`.

## Artifact Index
- `handoff.md` — Full investigation report and recommended implementation plan.
