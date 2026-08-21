//! Empirical Challenger Stress Tests for Rust Models, Serde camelCase Mappings, Mutex Thread Safety, and IPC Command Stubs

use app_v2_lib::{
    commands::{cmd_capture_and_ocr, cmd_sample_colors, cmd_translate_phrases, AppState},
    models::{
        AppSettings, BoundingBox, ColorSample, LlmConfig, OcrResult, PhysicalRect, TextBlock,
        TranslationResult,
    },
};
use std::sync::Arc;

// ============================================================================
// 1. Serde camelCase Serialization & Deserialization Tests
// ============================================================================
#[test]
fn test_serde_camel_case_physical_rect() {
    let rect = PhysicalRect {
        x: 10,
        y: -20,
        width: 1920,
        height: 1080,
    };
    let json = serde_json::to_string(&rect).unwrap();
    assert_eq!(json, r#"{"x":10,"y":-20,"width":1920,"height":1080}"#);

    let deserialized: PhysicalRect = serde_json::from_str(&json).unwrap();
    assert_eq!(rect, deserialized);
}

#[test]
fn test_serde_camel_case_text_block_and_ocr_result() {
    let block = TextBlock {
        text: "Principled BSDF".to_string(),
        confidence: 0.985,
        box_rect: BoundingBox {
            x: 100,
            y: 200,
            width: 300,
            height: 50,
        },
    };
    let ocr = OcrResult {
        blocks: vec![block],
    };

    let json = serde_json::to_string(&ocr).unwrap();
    // Check camelCase key `boxRect`
    assert!(json.contains(r#""boxRect":{"x":100,"y":200,"width":300,"height":50}"#));

    let deserialized: OcrResult = serde_json::from_str(&json).unwrap();
    assert_eq!(ocr, deserialized);
}

#[test]
fn test_serde_camel_case_llm_config() {
    let config = LlmConfig {
        id: Some("test".to_string()),
        provider: "DeepSeek".to_string(),
        api_key: "sk-123456".to_string(),
        model: "deepseek-chat".to_string(),
        endpoint: "https://api.deepseek.com/v1".to_string(),
    };

    let json = serde_json::to_string(&config).unwrap();
    // Check camelCase key `apiKey`
    assert!(json.contains(r#""apiKey":"sk-123456""#));
    assert!(json.contains(r#""provider":"DeepSeek""#));
    assert!(json.contains(r#""endpoint":"https://api.deepseek.com/v1""#));

    let deserialized: LlmConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(config, deserialized);
}

#[test]
fn test_serde_camel_case_translation_result() {
    let tr = TranslationResult {
        original: "Roughness".to_string(),
        translated: "粗糙度".to_string(),
        source_tier: "blender".to_string(),
    };

    let json = serde_json::to_string(&tr).unwrap();
    // Check camelCase key `sourceTier`
    assert!(json.contains(r#""sourceTier":"blender""#));

    let deserialized: TranslationResult = serde_json::from_str(&json).unwrap();
    assert_eq!(tr, deserialized);
}

#[test]
fn test_serde_camel_case_color_sample() {
    let cs = ColorSample {
        box_rect: BoundingBox {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        },
        background_rgb: [30, 40, 50],
        text_color: "#FFFFFF".to_string(),
    };

    let json = serde_json::to_string(&cs).unwrap();
    // Check camelCase keys `boxRect`, `backgroundRgb`, `textColor`
    assert!(json.contains(r#""boxRect":{"x":0,"y":0,"width":10,"height":10}"#));
    assert!(json.contains(r#""backgroundRgb":[30,40,50]"#));
    assert!(json.contains(r##""textColor":"#FFFFFF""##));

    let deserialized: ColorSample = serde_json::from_str(&json).unwrap();
    assert_eq!(cs, deserialized);
}

#[test]
fn test_serde_camel_case_app_settings_full_roundtrip() {
    let settings = AppSettings::default();
    let json = serde_json::to_string_pretty(&settings).unwrap();

    // Verify all camelCase field names in JSON string
    assert!(json.contains(r#""defaultPreset": "blender""#));
    assert!(json.contains(r#""llmConfig": {"#));
    assert!(json.contains(r#""apiKey": ""#));
    assert!(json.contains(r#""translationTiers": ["#));
    assert!(json.contains(r#""presetDicts": {"#));

    let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(settings, deserialized);
}

#[test]
fn test_serde_app_settings_null_optional_llm_config() {
    let mut settings = AppSettings::default();
    settings.llm_config = None;

    let json = serde_json::to_string(&settings).unwrap();
    assert!(json.contains(r#""llmConfig":null"#));

    let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(settings, deserialized);
    assert!(deserialized.llm_config.is_none());
}

// ============================================================================
// 2. Mutex & Thread Safety Tests for AppState
// ============================================================================
#[test]
fn test_app_state_concurrent_thread_safety() {
    let app_state = Arc::new(AppState::default());
    let mut handles = vec![];

    // Spawn 20 concurrent threads mutating and reading settings
    for i in 0..20 {
        let state_clone = Arc::clone(&app_state);
        let handle = std::thread::spawn(move || {
            let mut lock = state_clone.settings.lock().unwrap();
            lock.hotkey = format!("Ctrl+Alt+F{}", i);
            lock.theme = if i % 2 == 0 {
                "dark".to_string()
            } else {
                "light".to_string()
            };
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.join().unwrap();
    }

    let final_lock = app_state.settings.lock().unwrap();
    assert!(final_lock.hotkey.starts_with("Ctrl+Alt+F"));
    assert!(final_lock.theme == "dark" || final_lock.theme == "light");
}

#[test]
fn test_app_state_mutex_poison_resilience_check() {
    let state = AppState::default();

    // Intentionally panic inside a thread while holding the Mutex lock to poison it
    let state_arc = Arc::new(state);
    let state_clone = Arc::clone(&state_arc);

    let _ = std::thread::spawn(move || {
        let _guard = state_clone.settings.lock().unwrap();
        panic!("Simulated worker thread crash while holding lock!");
    })
    .join();

    // Check how lock() behaves when mutex is poisoned
    let lock_res = state_arc.settings.lock();
    assert!(
        lock_res.is_err(),
        "Mutex lock should return Err on poisoned state"
    );
}

// ============================================================================
// 3. Async IPC Command Signature & Behavior Tests
// ============================================================================
#[test]
fn test_ipc_cmd_capture_and_ocr_stub() {
    tauri::async_runtime::block_on(async {
        let selection = PhysicalRect {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
        };
        let result = cmd_capture_and_ocr(selection, None, None, None).await;
        assert!(result.is_ok());
        let ocr = result.unwrap();
        assert!(!ocr.blocks.is_empty());
        assert_eq!(ocr.blocks[0].text, "Artificial Intelligence");
    });
}

#[test]
fn test_ipc_cmd_translate_phrases_stub() {
    tauri::async_runtime::block_on(async {
        let phrases = vec![
            "Subsurface Scattering".to_string(),
            "Normal Map".to_string(),
        ];
        let preset = "blender".to_string();
        let result = cmd_translate_phrases(phrases.clone(), preset.clone(), None).await;

        assert!(result.is_ok());
        let list = result.unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].original, "Subsurface Scattering");
        assert_eq!(list[0].translated, "次表面散射");
        assert_eq!(list[0].source_tier, "blender");
    });
}

#[test]
fn test_ipc_cmd_sample_colors_stub() {
    tauri::async_runtime::block_on(async {
        let boxes = vec![BoundingBox {
            x: 10,
            y: 20,
            width: 50,
            height: 30,
        }];
        let result = cmd_sample_colors(vec![], boxes.clone()).await;

        assert!(result.is_ok());
        let samples = result.unwrap();
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].box_rect, boxes[0]);
        assert_eq!(samples[0].background_rgb, [42, 42, 42]);
        assert_eq!(samples[0].text_color, "#FFFFFF");
    });
}

#[test]
fn test_async_tokio_concurrency_stress_test() {
    tauri::async_runtime::block_on(async {
        let mut tasks = vec![];
        for i in 0..50 {
            let task = tauri::async_runtime::spawn(async move {
                let rect = PhysicalRect {
                    x: i,
                    y: i,
                    width: 100,
                    height: 100,
                };
                let ocr_res = cmd_capture_and_ocr(rect, None, None, None).await;
                assert!(ocr_res.is_ok());

                let phrases = vec![format!("Phrase {}", i)];
                let trans_res = cmd_translate_phrases(phrases, "blender".to_string(), None).await;
                assert!(trans_res.is_ok());

                let boxes = vec![BoundingBox {
                    x: i,
                    y: i,
                    width: 10,
                    height: 10,
                }];
                let color_res = cmd_sample_colors(vec![0; 4], boxes).await;
                assert!(color_res.is_ok());
            });
            tasks.push(task);
        }

        for task in tasks {
            task.await.unwrap();
        }
    });
}
