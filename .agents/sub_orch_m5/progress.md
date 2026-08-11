# Progress — Milestone 5 Sub-Orchestrator (S1 portable build)

## Current Status
Last visited: 2026-08-11T13:46:00+08:00
Status: **S1 DONE — Gate PASSED (verified by parent brain)**

## Iteration Status
Current iteration: 1 / 1 (S1 release portable build). Antigravity executor
deleg_aed00a38 completed the code changes but was killed mid-summary by
session-storage write failure / max_iterations before it could write this doc.
The parent brain independently re-verified all numbers below from disk.

## Checks performed (parent-verified, not just executor self-report)
- [x] Rust regression: `cargo test --manifest-path Cargo.toml` → 101 passed / 0 failed
- [x] React regression: `npm --prefix app_v2 test -- --run` → 73 passed / 0 failed
- [x] `tsc --noEmit`: clean; `npm run build`: ✓
- [x] Release build: `cargo build --release` → succeeded, exe rebuilt 13:37
- [x] Portable footprint measured from target/release: **exe 26.7MB + 3 ONNX 13.1MB + dicts ~0MB = 39.8MB** (<40MB ✅, margin ~0.2MB tight)
- [x] Cold start measured 3× via process-readiness: **157.3 / 146.3 / 151.5 ms, median 151.5ms** (<500ms ✅)
- [x] OCR model bundling: `ch_PP-OCRv3_det_infer.onnx`, `ch_PP-OCRv3_rec_infer.onnx`, `ch_ppocr_mobile_v2.0_cls_infer.onnx`, `general_ui_dict.json` all copied into `target/release/models/` & `assets/offline/` — matches the runtime's `resolve_models_dir()` which looks in exe-dir `models/`

## Remaining M5 work (not done this step)
- [ ] S2: E2E tests (截图→OCR→翻译→浮层)
- [ ] S3: 对抗加固
- [ ] S4: 全量回归 + 真人桌面实测 + 微信交付
- [ ] Consider tightening the 0.2MB margin (e.g. reduce windows/ort footprint) for a safer <40MB
