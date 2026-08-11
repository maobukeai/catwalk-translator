// Real-model integration test for the Rust-native ONNX OCR engine.
// Requires the PP-OCRv3 models under src-tauri/models/ and runs the full
// det -> cls -> rec pipeline against a synthetic BMP. Marked #[ignore] so
// normal `cargo test` runs skip it; run explicitly with:
//
//   cargo test --test onnx_real_model -- --ignored --nocapture

#[test]
#[ignore = "requires PP-OCRv3 onnx models on disk"]
fn onnx_engine_recognizes_synthetic_bmp() {
    // Skipped unless the models dir is present (CI / offline machines).
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let models = std::path::Path::new(&manifest).join("models");
    if !models.join("ch_PP-OCRv3_det_infer.onnx").exists() {
        eprintln!("[skip] ONNX models not found under {}", models.display());
        return;
    }
    std::env::set_var("CATWALK_OCR_MODELS_DIR", &models);

    let bmp = std::fs::read(models.join("test_image.bmp")).expect("test bitmap");
    let engine = app_v2_lib::onnx_ocr::OnnxOcrEngine::new();
    assert!(engine.ensure_loaded().is_ok(), "engine must load with models present");

    let res = engine.recognize_bmp(&bmp).expect("pipeline must run");
    let texts: Vec<String> = res.blocks.iter().map(|b| b.text.clone()).collect();
    let joined = texts.join(" ");
    assert!(
        joined.contains("Roughness") || joined.contains("roughness"),
        "expected Roughness line, got: {}", joined
    );
}