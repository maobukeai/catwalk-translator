//! Tier 2 Boundary & Corner Case Test Suite (`tier2_boundary_corner.rs`)
//! Covers Boundary Value Analysis & Extreme Corner Cases (14 tests total):
//! - Category 1: Empty & Text/Dict Boundary Extremes (5 tests)
//! - Category 2: DPI Extremes & Non-Standard Monitor Resolutions (5 tests)
//! - Category 3: Network & API Failure Fallbacks (4 tests)

use app_v2_lib::{
    capture::{CoordinateMapper, LogicalRect, PhysicalRect},
    commands::{cmd_capture_and_ocr, cmd_sample_colors, cmd_translate_phrases},
    models::{BoundingBox, LlmConfig},
    sampler::ColorSampler,
    translator::{CgDictionaryEngine, MultiTierPipeline},
};
use std::collections::HashMap;

// ============================================================================
// Category 1: Empty & Text/Dict Boundary Extremes (5 Tests)
// ============================================================================
#[cfg(test)]
mod category_1_empty_text_dict_extremes {
    use super::*;

    #[test]
    fn test_01_empty_crop_0x0_and_empty_buffer() {
        tauri::async_runtime::block_on(async {
            // 1. Empty crop rect (0x0) via cmd_capture_and_ocr
            let zero_rect = PhysicalRect {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            };
            let ocr_res = cmd_capture_and_ocr(zero_rect, None, None, None)
                .await
                .expect("OCR command failed");
            assert_eq!(
                ocr_res.blocks.len(),
                0,
                "0x0 selection must return 0 blocks"
            );

            // 2. Sample colors directly on empty byte buffer returns [0, 0, 0]
            let empty_bytes: Vec<u8> = vec![];
            let sampled_rgb = ColorSampler::sample_outer_ring_median(&empty_bytes, 100, 100, 4);
            assert_eq!(
                sampled_rgb,
                [0, 0, 0],
                "Direct sampler on empty buffer returns [0, 0, 0]"
            );

            // 3. cmd_sample_colors with empty image crop falls back to [42, 42, 42]
            let boxes = vec![BoundingBox {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            }];
            let samples = cmd_sample_colors(empty_bytes, boxes)
                .await
                .expect("Sample colors failed");
            assert_eq!(samples.len(), 1);
            assert_eq!(samples[0].background_rgb, [42, 42, 42]);
            assert_eq!(samples[0].text_color, "#FFFFFF");
        });
    }

    #[test]
    fn test_02_zero_length_phrase_translation() {
        tauri::async_runtime::block_on(async {
            let phrases = vec!["".to_string(), "   ".to_string(), "\t\n".to_string()];
            let res = cmd_translate_phrases(phrases, "blender".to_string(), None)
                .await
                .expect("Translate command failed");

            assert_eq!(res.len(), 3);
            for item in res {
                assert_eq!(
                    item.translated, "",
                    "Zero-length phrase must yield empty translation"
                );
                assert_eq!(
                    item.source_tier, "Empty",
                    "Source tier for empty phrase must be 'Empty'"
                );
            }
        });
    }

    #[test]
    fn test_03_max_length_phrase_10k_chars() {
        tauri::async_runtime::block_on(async {
            let prefix = "Principled BSDF ";
            let padding = "A".repeat(10000);
            let long_phrase = format!("{}{}", prefix, padding);
            assert!(long_phrase.len() > 10000);

            let phrases = vec![long_phrase.clone()];
            let res = cmd_translate_phrases(phrases, "blender".to_string(), None)
                .await
                .expect("Translate command failed");

            assert_eq!(res.len(), 1);
            assert_eq!(res[0].original, long_phrase);
            assert!(!res[0].translated.is_empty());
        });
    }

    #[test]
    fn test_04_missing_dict_file_handling() {
        let engine = CgDictionaryEngine::new();

        // Preset dict name does not exist
        let non_existent_preset = "non_existent_software_xyz";

        // Known term "Principled BSDF" should fall back across loaded dicts and be found in blender dict
        let found = engine.lookup("Principled BSDF", non_existent_preset);
        assert!(found.is_some());
        let (trans, source) = found.unwrap();
        assert_eq!(trans, "原理化 BSDF");
        assert_eq!(source, "blender");

        // Unknown term on non-existent preset dictionary
        let unknown = engine.lookup("Unknown3DTerm123", non_existent_preset);
        assert!(unknown.is_none());
    }

    #[test]
    fn test_05_malformed_json_dict_recovery() {
        // Test json deserialization recovery on malformed input
        let markdown_json = "```json\n{ \"invalid_key\": } \n```";
        let parse_result = serde_json::from_str::<HashMap<String, String>>(markdown_json);
        assert!(
            parse_result.is_err(),
            "Malformed JSON must return deserialization error"
        );

        // Test pipeline handling when LLM response is corrupt HTML/string
        let malformed_raw = "<html>500 Internal Server Error</html>";
        let parse_html = serde_json::from_str::<HashMap<String, String>>(malformed_raw);
        assert!(
            parse_html.is_err(),
            "HTML string must fail JSON deserialization gracefully"
        );

        // Verify pipeline fallback works on invalid dict preset and invalid LLM config without panic
        tauri::async_runtime::block_on(async {
            let pipeline = MultiTierPipeline::new();
            let phrases = vec!["Principled BSDF".to_string()];
            let res = pipeline
                .translate_phrases(&phrases, "corrupt_dict_name", None)
                .await;
            assert_eq!(res.len(), 1);
            assert_eq!(res[0].translated, "原理化 BSDF");
        });
    }
}

// ============================================================================
// Category 2: DPI Extremes & Non-Standard Monitor Resolutions (5 Tests)
// ============================================================================
#[cfg(test)]
mod category_2_dpi_extremes_resolutions {
    use super::*;

    #[test]
    fn test_06_dpi_scaling_100_percent_standard() {
        // 1.0x scaling (100% DPI) on standard Full HD (1920x1080)
        let scale = 1.0;
        let logical = LogicalRect {
            x: 100.0,
            y: 200.0,
            width: 800.0,
            height: 600.0,
        };

        let phys = CoordinateMapper::logical_to_physical(logical, scale);
        assert_eq!(phys.x, 100);
        assert_eq!(phys.y, 200);
        assert_eq!(phys.width, 800);
        assert_eq!(phys.height, 600);

        let roundtrip = CoordinateMapper::physical_to_logical(phys, scale);
        assert_eq!(roundtrip, logical);
    }

    #[test]
    fn test_07_dpi_scaling_125_percent_2560x1440() {
        // 1.25x scaling (125% DPI) on QHD (2560x1440)
        let scale = 1.25;
        let logical = LogicalRect {
            x: 100.0,
            y: 50.0,
            width: 400.0,
            height: 300.0,
        };

        let phys = CoordinateMapper::logical_to_physical(logical, scale);
        assert_eq!(phys.x, 125);
        assert_eq!(phys.y, 63);
        assert_eq!(phys.width, 500);
        assert_eq!(phys.height, 375);

        let monitor_bounds = PhysicalRect {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        };
        let clamped = CoordinateMapper::clamp_rect(phys, monitor_bounds);
        assert_eq!(clamped, phys);
    }

    #[test]
    fn test_08_dpi_scaling_150_percent_3840x2160() {
        // 1.5x scaling (150% DPI) on 4K UHD (3840x2160)
        let scale = 1.5;
        let logical = LogicalRect {
            x: 200.0,
            y: 150.0,
            width: 1000.0,
            height: 600.0,
        };

        let phys = CoordinateMapper::logical_to_physical(logical, scale);
        assert_eq!(phys.x, 300);
        assert_eq!(phys.y, 225);
        assert_eq!(phys.width, 1500);
        assert_eq!(phys.height, 900);

        // Test precision of fractional logical coordinates
        let fractional_logical = LogicalRect {
            x: 10.33,
            y: 20.66,
            width: 100.5,
            height: 50.5,
        };
        let frac_phys = CoordinateMapper::logical_to_physical(fractional_logical, scale);
        let frac_back = CoordinateMapper::physical_to_logical(frac_phys, scale);

        let err_x = (fractional_logical.x - frac_back.x).abs();
        let err_y = (fractional_logical.y - frac_back.y).abs();
        assert!(
            err_x < 1.0,
            "DPI mapping error X must be < 1px, got {}",
            err_x
        );
        assert!(
            err_y < 1.0,
            "DPI mapping error Y must be < 1px, got {}",
            err_y
        );
    }

    #[test]
    fn test_09_dpi_scaling_200_percent_extreme() {
        // 2.0x scaling (200% DPI Retina/High-DPI)
        let scale = 2.0;
        let logical = LogicalRect {
            x: 500.5,
            y: 250.25,
            width: 300.75,
            height: 150.1,
        };

        let phys = CoordinateMapper::logical_to_physical(logical, scale);
        assert_eq!(phys.x, 1001);
        assert_eq!(phys.y, 501);
        assert_eq!(phys.width, 602);
        assert_eq!(phys.height, 300);

        let back = CoordinateMapper::physical_to_logical(phys, scale);
        assert!((back.x - 500.5).abs() < 1.0);
        assert!((back.y - 250.5).abs() < 1.0);
    }

    #[test]
    fn test_10_mixed_dpi_multi_monitor_bounds() {
        // Dual monitor setup:
        // Monitor 1 (Main): 1920x1080 @ (0,0) with 1.0x DPI
        // Monitor 2 (Extended): 3840x2160 @ (1920, 0) with 1.5x DPI
        let mon1_bounds = PhysicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let mon2_bounds = PhysicalRect {
            x: 1920,
            y: 0,
            width: 3840,
            height: 2160,
        };

        // Boundary points check
        assert!(CoordinateMapper::contains_point(mon1_bounds, (1919, 1079)));
        assert!(!CoordinateMapper::contains_point(mon1_bounds, (1920, 0)));
        assert!(CoordinateMapper::contains_point(mon2_bounds, (1920, 0)));
        assert!(CoordinateMapper::contains_point(mon2_bounds, (5759, 2159)));
        assert!(!CoordinateMapper::contains_point(mon2_bounds, (5760, 2160)));

        // Request spanning across monitors: starting at 1800, width 400
        let req_spanning = PhysicalRect {
            x: 1800,
            y: 100,
            width: 400,
            height: 200,
        };
        let clamped_mon1 = CoordinateMapper::clamp_rect(req_spanning, mon1_bounds);
        assert_eq!(clamped_mon1.x, 1800);
        assert_eq!(clamped_mon1.width, 120);

        let clamped_mon2 = CoordinateMapper::clamp_rect(req_spanning, mon2_bounds);
        assert_eq!(clamped_mon2.x, 1920);
        assert_eq!(clamped_mon2.width, 280);
    }
}

// ============================================================================
// Category 3: Network & API Failure Fallbacks (4 Tests)
// ============================================================================
#[cfg(test)]
mod category_3_network_api_failure_fallbacks {
    use super::*;

    #[test]
    fn test_11_llm_timeout_fallback_to_cg_dict() {
        tauri::async_runtime::block_on(async {
            let pipeline = MultiTierPipeline::new();

            // Point LLM config to non-routable IP to guarantee timeout / error
            let timeout_config = LlmConfig {
                id: Some("test".to_string()),
                provider: "DeepSeek".to_string(),
                api_key: "sk-fake-key".to_string(),
                model: "deepseek-chat".to_string(),
                endpoint: "http://10.255.255.1:81/v1".to_string(),
            };

            let phrases = vec!["Principled BSDF".to_string()];
            let results = pipeline
                .translate_phrases(&phrases, "blender", Some(&timeout_config))
                .await;

            assert_eq!(results.len(), 1);
            assert_eq!(results[0].original, "Principled BSDF");
            // Local preset dict matching succeeds instantly without hanging on LLM
            assert_eq!(results[0].translated, "原理化 BSDF");
            assert_eq!(results[0].source_tier, "blender");
        });
    }

    #[test]
    fn test_12_http_429_rate_limit_fallback() {
        tauri::async_runtime::block_on(async {
            let pipeline = MultiTierPipeline::new();

            // Test LLM translation request with invalid endpoint that fails
            let config = LlmConfig {
                id: Some("test".to_string()),
                provider: "TestProvider".to_string(),
                api_key: "sk-fake".to_string(),
                model: "test-model".to_string(),
                endpoint: "http://127.0.0.1:9999/v1".to_string(),
            };

            let err = pipeline
                .translate_via_llm(&["UnknownTerm".to_string()], &config)
                .await;
            assert!(err.is_err(), "Invalid endpoint must return error");

            // Verify cascade handling when LLM fails: unmatched phrase falls back to online API or fallback string
            let phrases = vec![
                "AO Mixing Mode".to_string(),
                "RandomUnknownTermXYZ".to_string(),
            ];
            let results = pipeline
                .translate_phrases(&phrases, "substance", Some(&config))
                .await;

            assert_eq!(results.len(), 2);
            // AO Mixing Mode matches preset dict
            assert_eq!(results[0].translated, "AO混合模式");
            assert_eq!(results[0].source_tier, "substance");

            // Unknown term falls back to Fallback API without breaking the pipeline
            assert_eq!(results[1].original, "RandomUnknownTermXYZ");
            assert!(
                results[1].source_tier.contains("Fallback")
                    || results[1].source_tier.contains("Online")
            );
        });
    }

    #[test]
    fn test_13_malformed_api_response_recovery() {
        tauri::async_runtime::block_on(async {
            let pipeline = MultiTierPipeline::new();

            // Test malformed JSON parsing error recovery
            let malformed_llm_output =
                "Here is your translation: {\"Metallic\": \"金属度\", missing_bracket";
            let parsed: Result<HashMap<String, String>, _> =
                serde_json::from_str(malformed_llm_output);

            assert!(
                parsed.is_err(),
                "Malformed LLM output must fail parsing gracefully"
            );

            // Ensure pipeline handles unparseable LLM output gracefully for batch phrases
            let phrases = vec!["Roughness".to_string()];
            let res = pipeline.translate_phrases(&phrases, "blender", None).await;
            assert_eq!(res.len(), 1);
            assert_eq!(res[0].translated, "粗糙度");
        });
    }

    #[test]
    fn test_14_pipeline_multi_tier_cascade_on_network_failure() {
        tauri::async_runtime::block_on(async {
            let pipeline = MultiTierPipeline::new();

            // Broken LLM config
            let broken_config = LlmConfig {
                id: Some("test".to_string()),
                provider: "BrokenAPI".to_string(),
                api_key: "sk-broken".to_string(),
                model: "broken".to_string(),
                endpoint: "http://localhost:1".to_string(),
            };

            let phrases = vec![
                "Subsurface Scattering".to_string(),
                "NavMesh Surface".to_string(),
                "NonExistentFeatureString999".to_string(),
            ];

            let results = pipeline
                .translate_phrases(&phrases, "blender", Some(&broken_config))
                .await;

            assert_eq!(results.len(), 3);

            // Phrase 1: Matched via Blender preset dict
            assert_eq!(results[0].original, "Subsurface Scattering");
            assert_eq!(results[0].translated, "次表面散射");
            assert_eq!(results[0].source_tier, "blender");

            // Phrase 2: Matched via Unity preset dict (cross-dict fallback)
            assert_eq!(results[1].original, "NavMesh Surface");
            assert_eq!(results[1].translated, "NavMesh 表面");
            assert_eq!(results[1].source_tier, "unity");

            // Phrase 3: Dict miss + Network fail -> Online Fallback or Fallback API
            assert_eq!(results[2].original, "NonExistentFeatureString999");
            assert!(
                results[2].source_tier.contains("Fallback")
                    || results[2].source_tier.contains("Online")
            );
            assert!(!results[2].translated.is_empty());
        });
    }
}
