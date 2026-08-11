//! Comprehensive Unit & Integration Tests for M3 Multi-Tier Translation Pipeline & CG Dictionaries

use app_v2_lib::{
    commands::cmd_translate_phrases,
    models::{LlmConfig, TranslationResult},
    translator::{CgDictionaryEngine, MultiTierPipeline, TranslationCache},
};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

// ============================================================================
// 1. Dictionary Lookup Accuracy Tests
// ============================================================================
#[test]
fn test_m3_dict_exact_match_all_presets() {
    let engine = CgDictionaryEngine::new();

    // Blender terms
    let res_b = engine.lookup("Principled BSDF", "blender");
    assert_eq!(
        res_b,
        Some(("原理化 BSDF".to_string(), "blender".to_string()))
    );

    let res_subsurf = engine.lookup("Subsurface Scattering", "blender");
    assert_eq!(
        res_subsurf,
        Some(("次表面散射".to_string(), "blender".to_string()))
    );

    // Substance terms
    let res_s = engine.lookup("AO Mixing Mode", "substance");
    assert_eq!(
        res_s,
        Some(("AO混合模式".to_string(), "substance".to_string()))
    );

    // Unity terms
    let res_u = engine.lookup("NavMesh Surface", "unity");
    assert_eq!(
        res_u,
        Some(("NavMesh 表面".to_string(), "unity".to_string()))
    );

    // Unreal Engine 5 terms
    let res_ue = engine.lookup("Nanite", "unreal");
    assert_eq!(
        res_ue,
        Some((
            "Nanite 虚拟化微多边形几何体".to_string(),
            "unreal".to_string()
        ))
    );

    // Maya terms
    let res_maya = engine.lookup("Bifrost", "maya");
    assert_eq!(
        res_maya,
        Some((
            "Bifrost 流体与粒子程序化图表".to_string(),
            "maya".to_string()
        ))
    );

    // Houdini terms
    let res_hou = engine.lookup("Vellum", "houdini");
    assert_eq!(
        res_hou,
        Some((
            "Vellum 软体/布料/流体解算器".to_string(),
            "houdini".to_string()
        ))
    );
}

#[test]
fn test_m3_query_text_detail_word_card() {
    tauri::async_runtime::block_on(async {
        let pipeline = MultiTierPipeline::new();
        let res = pipeline.query_text_detail("Nanite", "unreal", None).await;
        assert_eq!(res.original, "Nanite");
        assert!(res.word_detail.is_some());
        let detail = res.word_detail.unwrap();
        assert!(detail.definition.contains("Nanite"));
        assert!(!detail.examples.is_empty());
        assert!(!res.results.is_empty());
    });
}

#[test]
fn test_m3_dict_case_insensitive_lookup() {
    let pipeline = MultiTierPipeline::new();

    // Uppercase
    let res1 = pipeline.lookup_dict("PRINCIPLED BSDF", "blender");
    assert_eq!(
        res1,
        Some(("原理化 BSDF".to_string(), "blender".to_string()))
    );

    // Lowercase
    let res2 = pipeline.lookup_dict("roughness", "blender");
    assert_eq!(res2, Some(("粗糙度".to_string(), "blender".to_string())));

    // Mixed case
    let res3 = pipeline.lookup_dict("Ao MiXiNg MoDe", "substance");
    assert_eq!(
        res3,
        Some(("AO混合模式".to_string(), "substance".to_string()))
    );
}

#[test]
fn test_m3_dict_trim_whitespace_sanitization() {
    let pipeline = MultiTierPipeline::new();

    let res1 = pipeline.lookup_dict("   Normal Map  \n", "blender");
    assert_eq!(res1, Some(("法线贴图".to_string(), "blender".to_string())));

    let res2 = pipeline.lookup_dict("\t  Subsurface Scattering  ", "blender");
    assert_eq!(
        res2,
        Some(("次表面散射".to_string(), "blender".to_string()))
    );
}

// ============================================================================
// 2. Fallback Chain & Cache Tests
// ============================================================================
#[test]
fn test_m3_cg_fallback_tier2_cross_lookup() {
    let pipeline = MultiTierPipeline::new();

    // Look up "AO Mixing Mode" (which is in substance.json) while active preset is "blender"
    let res = pipeline.lookup_dict("AO Mixing Mode", "blender");
    assert_eq!(
        res,
        Some(("AO混合模式".to_string(), "substance".to_string()))
    );
}

#[test]
fn test_m3_translation_cache_rwlock_concurrency() {
    let cache = Arc::new(TranslationCache::new());
    let mut handles = vec![];

    for i in 0..10 {
        let cache_clone = Arc::clone(&cache);
        let handle = std::thread::spawn(move || {
            let tr = TranslationResult {
                original: format!("Term_{}", i),
                translated: format!("译文_{}", i),
                source_tier: "TestTier".to_string(),
            };
            cache_clone.store(tr);
            let retrieved = cache_clone.retrieve(&format!("Term_{}", i));
            assert!(retrieved.is_some());
            assert_eq!(retrieved.unwrap().translated, format!("译文_{}", i));
        });
        handles.push(handle);
    }

    for h in handles {
        h.join().unwrap();
    }
}

// ============================================================================
// 3. Mock LLM Server Tier 3 & Fallback Tests
// ============================================================================
#[test]
fn test_m3_mock_llm_api_tier3_successful_batch_translation() {
    tauri::async_runtime::block_on(async {
        // Start a mock local TCP server simulating LLM HTTP API endpoint
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = socket.read(&mut buf).await;

                let response_body = serde_json::json!({
                    "choices": [
                        {
                            "message": {
                                "content": "{\"Custom Term XYZ\": \"自定义术语 XYZ\"}"
                            }
                        }
                    ]
                })
                .to_string();

                let http_response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = socket.write_all(http_response.as_bytes()).await;
                let _ = socket.flush().await;
                let _ = socket.shutdown().await;
            }
        });

        let pipeline = MultiTierPipeline::new();
        let config = LlmConfig {
            id: Some("test".to_string()),
            provider: "DeepSeek".to_string(),
            api_key: "sk-mock-key".to_string(),
            model: "deepseek-chat".to_string(),
            endpoint: format!("http://{}", addr),
        };

        let phrases = vec!["Custom Term XYZ".to_string()];
        let results = pipeline
            .translate_phrases(&phrases, "blender", Some(&config))
            .await;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original, "Custom Term XYZ");
        assert_eq!(results[0].translated, "自定义术语 XYZ");
        assert_eq!(results[0].source_tier, "LLM API (DeepSeek)");
    });
}

#[test]
fn test_m3_mock_llm_timeout_fallback_transition() {
    tauri::async_runtime::block_on(async {
        // Start a mock TCP server that delays response to trigger 4s timeout
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                // Sleep 5 seconds to exceed the 4s timeout limit
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                let _ = socket.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await;
            }
        });

        let pipeline = MultiTierPipeline::new();
        let config = LlmConfig {
            id: Some("test".to_string()),
            provider: "Ollama".to_string(),
            api_key: "".to_string(),
            model: "llama3".to_string(),
            endpoint: format!("http://{}", addr),
        };

        let phrases = vec!["Unmatched Timeout Phrase".to_string()];
        let results = pipeline
            .translate_phrases(&phrases, "blender", Some(&config))
            .await;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original, "Unmatched Timeout Phrase");
        // Must fallback cleanly after timeout without panicking
        assert!(!results[0].translated.is_empty());
    });
}

// ============================================================================
// 4. IPC Command Validation & Resilience Tests
// ============================================================================
#[test]
fn test_m3_ipc_cmd_translate_phrases_empty_and_whitespace_input() {
    tauri::async_runtime::block_on(async {
        // Empty vector
        let res_empty = cmd_translate_phrases(vec![], "blender".to_string(), None).await;
        assert!(res_empty.is_ok());
        assert!(res_empty.unwrap().is_empty());

        // Whitespace vector
        let res_space =
            cmd_translate_phrases(vec!["   ".to_string()], "blender".to_string(), None).await;
        assert!(res_space.is_ok());
        let list = res_space.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].translated, "");
    });
}

#[test]
fn test_m3_ipc_cmd_translate_phrases_invalid_preset_resilience() {
    tauri::async_runtime::block_on(async {
        let phrases = vec!["Principled BSDF".to_string()];
        // Invalid preset name "nonexistent_engine" -> should fallback to searching remaining dicts (find in blender.json)
        let res = cmd_translate_phrases(phrases, "nonexistent_engine".to_string(), None).await;
        assert!(res.is_ok());
        let list = res.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].translated, "原理化 BSDF");
        assert_eq!(list[0].source_tier, "blender");
    });
}
