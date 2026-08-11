# Scope: Milestone 2 — High-DPI Capture & RapidOCR ONNX Engine

## Architecture & Responsibilities
- **Multi-Monitor Screenshot & DPI Mapper** (`app_v2/src-tauri/src/capture.rs`): Screen capture for single/multi-monitors, PhysicalPosition / PhysicalSize logic-to-physical and physical-to-logic mapping with <1px coordinate alignment error across 100%, 125%, 150%, 200% DPI scales.
- **RapidOCR ONNX Inference Engine** (`app_v2/src-tauri/src/ocr.rs`): Rust `ort` ONNX Runtime engine loading PP-OCRv4 DBNet detection (`ch_PP-OCRv4_det_infer.onnx`) & SVTR recognition (`ch_PP-OCRv4_rec_infer.onnx`) models (~15.5MB) from `assets/models/`.
- **Line Clustering & Word Merging Algorithm** (`app_v2/src-tauri/src/reconstruction.rs`): Horizontal line clustering, vertical distance thresholding, bounding box coordinate calculation, and word merging.
- **Tauri IPC Command** (`app_v2/src-tauri/src/commands.rs`): Connect `cmd_capture_and_ocr` to execute real OCR pipeline.

## Deliverables & Acceptance Criteria
1. Multi-monitor capture & coordinate mapping accuracy verified (<1px error across scale factors 1.0x, 1.25x, 1.5x, 2.0x).
2. ONNX ONNX Runtime (`ort`) inference engine executing PP-OCRv4 detection and recognition models cleanly.
3. Line clustering and word merging producing coherent text blocks with confidence scores and bounding boxes.
4. `cargo test` passing 100% across unit and integration test suites.
5. Zero facade/dummy implementations; clean Forensic Audit.
