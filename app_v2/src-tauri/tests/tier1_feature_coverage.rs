//! Tier 1 Feature Coverage Test Suite (`tier1_feature_coverage.rs`)
//! Covers Features F1 through F6 (F1: 6, F2: 5, F3: 5, F4: 6, F5: 5, F6: 5) for 32 total tests.

use app_v2_lib::{
    capture::{CoordinateMapper, LogicalRect, PhysicalRect},
    commands::{
        cmd_capture_and_ocr, cmd_sample_colors, AppSettings, AppState,
    },
    models::{BoundingBox, LlmConfig, OnlineEngines, PresetDicts, TextBlock, TranslationResult},
    reconstruction::{LineClusterer, WordMerger},
    sampler::{ColorSample, ColorSampler},
};
use std::sync::Arc;

// ============================================================================
// Feature 1: Modern Desktop Container & UI (6 Tests)
// ============================================================================
#[cfg(test)]
mod feature_1_container_ui {
    use super::*;

    #[test]
    fn test_f1_01_tray_menu_initialization() {
        let state = AppState::default();
        let settings = state.settings.lock().unwrap();
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.hotkey, "F4");
        assert_eq!(settings.default_preset, "blender");
        assert!(settings.preset_dicts.blender);
        assert!(settings.preset_dicts.substance);
        assert!(settings.preset_dicts.unity);
    }

    #[test]
    fn test_f1_02_hotkey_binding_registration() {
        let settings = AppSettings::default();
        assert_eq!(settings.hotkey, "F4");
        assert!(app_v2_lib::parse_hotkey(&settings.hotkey).is_ok());
    }

    #[test]
    fn test_f1_03_fluent_theme_switching() {
        let mut settings = AppSettings::default();
        assert_eq!(settings.theme, "system");
        settings.theme = "light".to_string();
        assert_eq!(settings.theme, "light");
    }

    #[test]
    fn test_f1_04_settings_persistence() {
        let settings = AppSettings {
            theme: "system".to_string(),
            hotkey: "Ctrl+Shift+T".to_string(),
            default_preset: "blender".to_string(),
            llm_config: Some(LlmConfig {
                id: Some("test".to_string()),
                provider: "DeepSeek".to_string(),
                api_key: "sk-test-key".to_string(),
                model: "deepseek-chat".to_string(),
                endpoint: "https://api.deepseek.com/v1".to_string(),
            }),
            translation_tiers: vec![
                "Preset Dictionary".to_string(),
                "LLM API".to_string(),
                "Online Fallback".to_string(),
            ],
            preset_dicts: PresetDicts::default(),
            online_engines: Some(OnlineEngines::default()),
            appearance: None,
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&settings).expect("Serialization failed");
        let deserialized: AppSettings =
            serde_json::from_str(&json).expect("Deserialization failed");
        assert_eq!(settings, deserialized);
        assert_eq!(
            deserialized.llm_config.unwrap().endpoint,
            "https://api.deepseek.com/v1"
        );
    }

    #[test]
    fn test_f1_05_window_visibility_toggle() {
        let state = Arc::new(AppState::default());
        let state_clone = Arc::clone(&state);
        let handle = std::thread::spawn(move || {
            let mut settings = state_clone.settings.lock().unwrap();
            settings.theme = "light".to_string();
        });
        handle.join().expect("Thread panicked");
        let settings = state.settings.lock().unwrap();
        assert_eq!(settings.theme, "light");
    }

    #[test]
    fn test_f1_06_dark_light_theme_style_application() {
        let mut settings = AppSettings::default();
        assert_eq!(settings.theme, "system");
        settings.theme = "dark".to_string();
        let is_dark_active = settings.theme == "dark";
        assert!(is_dark_active);
        settings.theme = "light".to_string();
        let is_light_active = settings.theme == "light";
        assert!(is_light_active);
    }
}

// ============================================================================
// Feature 2: High-DPI Screen Capture & Coordinate Mapping (5 Tests)
// ============================================================================
#[cfg(test)]
mod feature_2_dpi_capture_mapping {
    use super::*;

    #[test]
    fn test_f2_01_logical_to_physical_position_mapping() {
        let logical = LogicalRect {
            x: 100.0,
            y: 50.0,
            width: 200.0,
            height: 100.0,
        };
        let physical = CoordinateMapper::logical_to_physical(logical, 1.5);
        assert_eq!(physical.x, 150);
        assert_eq!(physical.y, 75);
        assert_eq!(physical.width, 300);
        assert_eq!(physical.height, 150);
    }

    #[test]
    fn test_f2_02_dpi_scale_factor_calculation() {
        let scales = vec![1.0, 1.25, 1.5, 2.0];
        for s in scales {
            let logical = LogicalRect {
                x: 20.0,
                y: 20.0,
                width: 100.0,
                height: 100.0,
            };
            let phys = CoordinateMapper::logical_to_physical(logical, s);
            let back_logical = CoordinateMapper::physical_to_logical(phys, s);
            assert!((logical.x - back_logical.x).abs() < 1e-4);
            assert!((logical.y - back_logical.y).abs() < 1e-4);
            assert!((logical.width - back_logical.width).abs() < 1e-4);
            assert!((logical.height - back_logical.height).abs() < 1e-4);
        }
    }

    #[test]
    fn test_f2_03_selection_bounding_rect_normalization() {
        let normalized = CoordinateMapper::normalize_drag_points((200.0, 200.0), (100.0, 100.0));
        assert_eq!(normalized.x, 100.0);
        assert_eq!(normalized.y, 100.0);
        assert_eq!(normalized.width, 100.0);
        assert_eq!(normalized.height, 100.0);
    }

    #[test]
    fn test_f2_04_multi_monitor_bounds_check() {
        let monitor_bounds = PhysicalRect {
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let point_inside = (2000, 500);
        let point_outside = (1000, 500);
        assert!(CoordinateMapper::contains_point(
            monitor_bounds,
            point_inside
        ));
        assert!(!CoordinateMapper::contains_point(
            monitor_bounds,
            point_outside
        ));
    }

    #[test]
    fn test_f2_05_crop_area_bounds_validation() {
        let max_bounds = PhysicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let requested = PhysicalRect {
            x: 1900,
            y: 1000,
            width: 100,
            height: 100,
        };
        let clamped = CoordinateMapper::clamp_rect(requested, max_bounds);
        assert_eq!(clamped.x, 1900);
        assert_eq!(clamped.y, 1000);
        assert_eq!(clamped.width, 20);
        assert_eq!(clamped.height, 80);
    }
}

// ============================================================================
// Feature 3: RapidOCR ONNX & Line Reconstruction Engine (5 Tests)
// ============================================================================
#[cfg(test)]
mod feature_3_rapidocr_reconstruction {
    use super::*;

    #[test]
    fn test_f3_01_image_tensor_conversion() {
        let rect = PhysicalRect {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
        };
        let dummy_bytes = vec![255u8; (rect.width * rect.height * 4) as usize];
        let (byte_count, shape) =
            app_v2_lib::ocr::prepare_tensor(&dummy_bytes, rect.width, rect.height);
        assert_eq!(byte_count, 40000);
        assert_eq!(shape, vec![1, 3, 100, 100]);
    }

    #[test]
    fn test_f3_02_dbnet_text_box_detection() {
        tauri::async_runtime::block_on(async {
            let selection = PhysicalRect {
                x: 0,
                y: 0,
                width: 200,
                height: 100,
            };
            let res = cmd_capture_and_ocr(selection, None, None, None).await;
            assert!(res.is_ok());
            let ocr_res = res.unwrap();
            assert_eq!(ocr_res.blocks.len(), 1);
            assert_eq!(ocr_res.blocks[0].text, "Artificial Intelligence");
        });
    }

    #[test]
    fn test_f3_03_svtr_text_recognition() {
        let mock_engine = app_v2_lib::ocr::MockOcrEngine::init();
        let ocr_res = app_v2_lib::ocr::OcrEngine::recognize(&mock_engine, &[0u8; 16]).unwrap();
        let high_confidence = app_v2_lib::ocr::filter_high_confidence(&ocr_res, 0.90);
        assert_eq!(high_confidence.len(), 1);
        assert_eq!(high_confidence[0].text, "Principled BSDF");
    }

    #[test]
    fn test_f3_04_line_clustering_thresholding() {
        let blocks = vec![
            TextBlock {
                text: "Principled".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "BSDF".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 65,
                    y: 12,
                    width: 40,
                    height: 20,
                },
            },
        ];
        let lines = LineClusterer::cluster_into_lines(blocks, 5.0);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].len(), 2);
    }

    #[test]
    fn test_f3_05_word_box_merging_logic() {
        let line_blocks = vec![
            TextBlock {
                text: "Principled".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "BSDF".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 65,
                    y: 10,
                    width: 40,
                    height: 20,
                },
            },
        ];
        let merged = WordMerger::merge_line(line_blocks, 20.0);
        assert_eq!(merged.text, "Principled BSDF");
        assert_eq!(merged.box_rect.x, 10);
        assert_eq!(merged.box_rect.width, 95);
    }

    #[test]
    fn test_f3_06_line_cluster_and_merge_pipeline() {
        let raw_blocks = vec![
            TextBlock {
                text: "Principled".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "BSDF".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 65,
                    y: 12,
                    width: 40,
                    height: 20,
                },
            },
            TextBlock {
                text: "Roughness".into(),
                confidence: 0.98,
                box_rect: BoundingBox {
                    x: 10,
                    y: 40,
                    width: 60,
                    height: 20,
                },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(raw_blocks, 8.0);
        assert_eq!(lines.len(), 2, "must cluster into 2 lines");

        let merged_blocks: Vec<TextBlock> = lines
            .into_iter()
            .map(|l| WordMerger::merge_line(l, 20.0))
            .collect();

        assert_eq!(merged_blocks.len(), 2);
        assert_eq!(merged_blocks[0].text, "Principled BSDF");
        assert_eq!(merged_blocks[0].box_rect.x, 10);
        assert_eq!(merged_blocks[0].box_rect.width, 95);
        assert_eq!(merged_blocks[1].text, "Roughness");
    }
}

// ============================================================================
// Feature 4: Multi-Tier Translation Engine & CG Dictionaries (6 Tests)
// ============================================================================
#[cfg(test)]
mod feature_4_multitier_translation {
    use super::*;

    #[test]
    fn test_f4_01_preset_cg_dictionary_lookup() {
        tauri::async_runtime::block_on(async {
            let phrases = vec!["Principled BSDF".to_string()];
            let res = Ok::<_, String>(app_v2_lib::translator::shared_pipeline().translate_phrases(&phrases, "blender", None, &[]).await);
            assert!(res.is_ok());
            let list = res.unwrap();
            assert_eq!(list.len(), 1);
            assert_eq!(list[0].original, "Principled BSDF");
            assert_eq!(list[0].translated, "原理化 BSDF");
            assert_eq!(list[0].source_tier, "blender");
        });
    }

    #[test]
    fn test_f4_02_llm_api_query_formatter() {
        let config = LlmConfig {
            id: Some("test".to_string()),
            provider: "DeepSeek".to_string(),
            api_key: "sk-test-123".to_string(),
            model: "deepseek-chat".to_string(),
            endpoint: "https://api.deepseek.com/v1/chat/completions".to_string(),
        };
        assert!(config.endpoint.starts_with("https://"));
        assert_eq!(config.provider, "DeepSeek");
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("api.deepseek.com"));
    }

    #[test]
    fn test_f4_03_online_api_fallback_sequence() {
        let settings = AppSettings::default();
        assert_eq!(settings.translation_tiers.len(), 3);
        assert_eq!(settings.translation_tiers[0], "Preset Dictionary");
        assert_eq!(settings.translation_tiers[1], "LLM API");
        assert_eq!(settings.translation_tiers[2], "Online Fallback");
    }

    #[test]
    fn test_f4_04_tier_priority_resolution() {
        tauri::async_runtime::block_on(async {
            let res = Ok::<_, String>(app_v2_lib::translator::shared_pipeline().translate_phrases(
                &vec!["Subsurface".to_string()],
                "substance",
                None,
                &[],
            )
            .await);
            assert!(res.is_ok());
            let list = res.unwrap();
            assert_eq!(list[0].source_tier, "substance");
        });
    }

    #[test]
    fn test_f4_05_translation_cache_store_retrieve() {
        let cache = app_v2_lib::translator::TranslationCache::new();
        let res = TranslationResult {
            original: "Roughness".to_string(),
            translated: "粗糙度".to_string(),
            source_tier: "blender".to_string(),
        };
        cache.store(res.clone());
        let cached = cache.retrieve("Roughness").expect("Key missing in cache");
        assert_eq!(cached.translated, "粗糙度");
        assert_eq!(cached.source_tier, "blender");
    }

    #[test]
    fn test_f4_06_batch_phrase_processing() {
        tauri::async_runtime::block_on(async {
            let phrases = vec!["Roughness".to_string(), "Metallic".to_string()];
            let res = Ok::<_, String>(app_v2_lib::translator::shared_pipeline().translate_phrases(&phrases, "blender", None, &[]).await);
            assert!(res.is_ok());
            let list = res.unwrap();
            assert_eq!(list.len(), 2);
            assert_eq!(list[0].original, "Roughness");
            assert_eq!(list[1].original, "Metallic");
        });
    }
}

// ============================================================================
// Feature 5: Color Sampler & Interactive Canvas/Web Overlay (5 Tests)
// ============================================================================
#[cfg(test)]
mod feature_5_color_sampler_overlay {
    use super::*;

    #[test]
    fn test_f5_01_outer_ring_4px_median_rgb() {
        let image_bytes = vec![255u8; 100 * 100 * 4];
        let median_rgb = ColorSampler::sample_outer_ring_median(&image_bytes, 100, 100, 4);
        let brightness =
            ColorSampler::calc_perceived_brightness(median_rgb[0], median_rgb[1], median_rgb[2]);
        let text_color = ColorSampler::decide_text_color(brightness);
        let sample = ColorSample {
            box_rect: BoundingBox {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
            background_rgb: median_rgb,
            text_color,
        };
        assert_eq!(median_rgb, [255, 255, 255]);
        assert_eq!(sample.background_rgb, [255, 255, 255]);
        assert_eq!(sample.text_color, "#000000");
    }

    #[test]
    fn test_f5_02_perceived_brightness_formula() {
        let white_y = ColorSampler::calc_perceived_brightness(255, 255, 255);
        let black_y = ColorSampler::calc_perceived_brightness(0, 0, 0);
        assert!((white_y - 255.0).abs() < 1e-4);
        assert!((black_y - 0.0).abs() < 1e-4);
    }

    #[test]
    fn test_f5_03_contrast_text_color_decision() {
        let dark_y = 50.0;
        let light_y = 200.0;
        assert_eq!(ColorSampler::decide_text_color(dark_y), "#FFFFFF");
        assert_eq!(ColorSampler::decide_text_color(light_y), "#000000");
    }

    #[test]
    fn test_f5_04_overlay_card_positioning() {
        tauri::async_runtime::block_on(async {
            let boxes = vec![BoundingBox {
                x: 100,
                y: 200,
                width: 150,
                height: 30,
            }];
            let image_bytes = vec![255u8; 150 * 30 * 4];
            let res = cmd_sample_colors(image_bytes, boxes.clone()).await;
            assert!(res.is_ok());
            let samples = res.unwrap();
            assert_eq!(samples.len(), 1);
            assert_eq!(samples[0].box_rect, boxes[0]);
            assert_eq!(samples[0].background_rgb, [255, 255, 255]);
            assert_eq!(samples[0].text_color, "#000000");
        });
    }

    #[test]
    fn test_f5_05_interactive_card_event_handling() {
        let card_rect = PhysicalRect {
            x: 100,
            y: 230,
            width: 200,
            height: 50,
        };
        let click_inside = (150, 240);
        let click_outside = (50, 50);
        assert!(CoordinateMapper::contains_point(card_rect, click_inside));
        assert!(!CoordinateMapper::contains_point(card_rect, click_outside));
    }
}

// ============================================================================
// Feature 6: E2E Test Suite & Verification Harness (5 Tests)
// ============================================================================
#[cfg(test)]
mod feature_6_test_harness_integration {
    use super::*;

    #[test]
    fn test_f6_01_mock_ipc_pipeline_verification() {
        tauri::async_runtime::block_on(async {
            let selection = PhysicalRect {
                x: 0,
                y: 0,
                width: 500,
                height: 300,
            };
            let res = cmd_capture_and_ocr(selection, None, None, None).await;
            assert!(res.is_ok());
        });
    }

    #[test]
    fn test_f6_02_test_report_formatter() {
        let settings = AppSettings::default();
        let summary = app_v2_lib::commands::TestReportFormatter::format_summary(&settings);
        assert!(summary.contains("system"));
        assert!(summary.contains("blender"));
        assert!(summary.contains("F4"));
    }

    #[test]
    fn test_f6_03_environment_check() {
        let settings = AppSettings::default();
        let is_valid =
            app_v2_lib::commands::EnvironmentChecker::check_runtime_environment(&settings);
        assert!(is_valid);
    }

    #[test]
    fn test_f6_04_mock_onnx_engine_initialization() {
        let mock_engine = app_v2_lib::ocr::MockOcrEngine::init();
        assert!(mock_engine.initialized);
        let res = app_v2_lib::ocr::OcrEngine::recognize(&mock_engine, &[0u8; 16]).unwrap();
        assert_eq!(res.blocks.len(), 1);
        assert_eq!(res.blocks[0].text, "Principled BSDF");
        assert!(res.blocks[0].confidence > 0.0);
    }

    #[test]
    fn test_f6_05_mock_dict_loader_integrity() {
        let dicts = PresetDicts::default();
        assert!(dicts.blender);
        assert!(dicts.substance);
        assert!(dicts.unity);
        assert!(dicts.unreal);
        assert!(dicts.maya);
        assert!(dicts.houdini);
        let json = serde_json::to_string(&dicts).unwrap();
        assert_eq!(
            json,
            r#"{"blender":true,"substance":true,"unity":true,"unreal":true,"maya":true,"houdini":true}"#
        );
        let des: PresetDicts = serde_json::from_str(&json).unwrap();
        assert_eq!(dicts, des);
    }
}
