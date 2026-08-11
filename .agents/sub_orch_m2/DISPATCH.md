## 2026-08-08T17:04:50Z

You are sub_orch_m2_gen1, the Sub-Orchestrator for Milestone 2 (M2: High-DPI Capture & RapidOCR ONNX Engine).

Working directory: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\sub_orch_m2
Original user request path: c:\Users\20269\Desktop\项目文件夹\翻译软件\ORIGINAL_REQUEST.md
Scope document: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\sub_orch_m2\SCOPE.md
Project document: c:\Users\20269\Desktop\项目文件夹\翻译软件\PROJECT.md

Read ORIGINAL_REQUEST.md, SCOPE.md, and PROJECT.md.

Your objective is to drive Milestone 2 to completion using the Iteration Loop:
1. Spawn 3 Explorers (`teamwork_preview_explorer`) to analyze:
   - Multi-monitor screen capture & DPI scale factor mapping (<1px error across 1.0x, 1.25x, 1.5x, 2.0x DPI) in `app_v2/src-tauri/src/capture.rs`.
   - Native Rust ONNX Runtime (`ort`) RapidOCR inference engine setup (`app_v2/src-tauri/src/ocr.rs`) loading PP-OCRv4 detection (`ch_PP-OCRv4_det_infer.onnx`) & recognition (`ch_PP-OCRv4_rec_infer.onnx`) models (~15.5MB) in `app_v2/src-tauri/assets/models/`.
   - Line clustering & word merging algorithm in `app_v2/src-tauri/src/reconstruction.rs`.
   - Connecting real OCR pipeline to `cmd_capture_and_ocr` in `app_v2/src-tauri/src/commands.rs`.
2. Synthesize Explorer reports and spawn a Worker (`teamwork_preview_worker`) to implement the full functional code and unit/integration tests in `app_v2/src-tauri/`.
   - Worker MUST run `cargo test --manifest-path app_v2/src-tauri/Cargo.toml` and `npm --prefix app_v2 test -- --run` and report results.
   - MANDATORY INTEGRITY WARNING in worker dispatch:
     "DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected."
3. Spawn 2 Reviewers (`teamwork_preview_reviewer`), 2 Challengers (`teamwork_preview_challenger`), and 1 Forensic Auditor (`teamwork_preview_auditor`).
4. Evaluate the Gate in `GATE_STATUS.md`.
5. When ALL pass (Build/tests pass, Reviewers APPROVE, Challengers confirm, Auditor CLEAN), update `GATE_STATUS.md`, set M2 status to `DONE` in `SCOPE.md`, `progress.md`, and `PROJECT.md`.
6. Report completion to parent via `send_message`.
