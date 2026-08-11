## 2026-08-08T17:05:17Z
You are e2e_m1_it3_worker_rust (teamwork_preview_test_writer).
Your working directory is: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\e2e_m1_it3_worker_rust

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Read these specification files first:
- c:\Users\20269\Desktop\项目文件夹\翻译软件\ORIGINAL_REQUEST.md
- c:\Users\20269\Desktop\项目文件夹\翻译软件\PROJECT.md
- c:\Users\20269\Desktop\项目文件夹\翻译软件\TEST_INFRA.md

MUST READ EXPLORER REMEDIATION PLAN:
- c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\e2e_m1_it3_explorer\analysis.md
- c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\e2e_m1_it3_explorer\handoff.md

Your Task:
Implement the complete technical remediation plan for the Rust backend and Tier 1 test suite:
1. Dictionary Files: Create/verify `app_v2/src-tauri/assets/dicts/blender.json`, `substance.json`, `unity.json` containing standard term mappings (e.g. `"Principled BSDF": "原理化 BSDF"`, `"Subsurface Scattering": "次表面散射"`, `"Roughness": "粗糙度"`, `"Anisotropic Tangent": "各向异性切线"`).
2. Backend Code Updates:
   - `app_v2/src-tauri/src/translator.rs`: Implement `CgDictionaryEngine` with preset JSON dictionary lookups and `TranslationCache`.
   - `app_v2/src-tauri/src/sampler.rs`: Implement real outer ring border pixel extraction and median RGB channel sorting in `sample_outer_ring_median` (returning `[255, 255, 255]` for pure white pixels) and contrast text color calculation ($Y = 0.299R + 0.587G + 0.114B$, returning `#000000` for light background and `#FFFFFF` for dark background).
   - `app_v2/src-tauri/src/commands.rs`: Wire `cmd_translate_phrases` to `CgDictionaryEngine`, `cmd_sample_colors` to `ColorSampler`, and `cmd_capture_and_ocr` to valid `OcrResult` generation.
   - `app_v2/src-tauri/src/ocr.rs`: Add any required helper structures (`prepare_tensor`, `MockOcrEngine`).
3. Test Suite Code Updates (`app_v2/src-tauri/tests/tier1_feature_coverage.rs`):
   - Replace tautologies in `test_f3_01`, `test_f3_03`, `test_f4_05`, `test_f6_02`, `test_f6_03`, `test_f6_04` with genuine calls to backend module functions (`prepare_tensor`, `MockOcrEngine`, `TranslationCache`, `TestReportFormatter`, `EnvironmentChecker`).
   - Fix `test_f4_01` to assert exact Chinese translated string `"原理化 BSDF"` for `"Principled BSDF"`.
   - Fix `test_f5_01` to assert exact `[255, 255, 255]` background RGB and `#000000` text color for pure white input.

4. Run Verification:
   - Run `cargo test --manifest-path app_v2/src-tauri/Cargo.toml -- --nocapture`
   - Confirm all 32 tests pass with 0 exit code.

Write your implementation details and verification output to `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\e2e_m1_it3_worker_rust\handoff.md`.
Send a completion message to orchestrator when done.
