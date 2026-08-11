//! Challenger M3 Empirical Edge Cases & Fallback Transition Tests

use app_v2_lib::{models::LlmConfig, translator::MultiTierPipeline};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[test]
fn test_challenger_case_insensitivity_and_mixed_case() {
    let pipeline = MultiTierPipeline::new();

    // Uppercase exact term
    let res_upper = pipeline.lookup_dict("PRINCIPLED BSDF", "blender");
    assert_eq!(
        res_upper,
        Some(("原理化 BSDF".to_string(), "blender".to_string()))
    );

    // Lowercase exact term
    let res_lower = pipeline.lookup_dict("subsurface scattering", "blender");
    assert_eq!(
        res_lower,
        Some(("次表面散射".to_string(), "blender".to_string()))
    );

    // Mixed case term
    let res_mixed = pipeline.lookup_dict("Ao MiXiNg MoDe", "blender");
    assert_eq!(
        res_mixed,
        Some(("AO混合模式".to_string(), "substance".to_string()))
    );

    // Mixed case Unity term
    let res_unity = pipeline.lookup_dict("nAvMeSh sUrFaCe", "unity");
    assert_eq!(
        res_unity,
        Some(("NavMesh 表面".to_string(), "unity".to_string()))
    );
}

#[test]
fn test_challenger_whitespace_normalization() {
    let pipeline = MultiTierPipeline::new();

    // Leading and trailing spaces + newline
    let res1 = pipeline.lookup_dict("   Roughness \n", "blender");
    assert_eq!(res1, Some(("粗糙度".to_string(), "blender".to_string())));

    // Tabs and spaces
    let res2 = pipeline.lookup_dict("\t  Clearcoat Roughness  \t", "blender");
    assert_eq!(
        res2,
        Some(("清漆粗糙度".to_string(), "blender".to_string()))
    );
}

#[test]
fn test_challenger_cache_key_mismatch_bug_demonstration() {
    tauri::async_runtime::block_on(async {
        let pipeline = MultiTierPipeline::new();

        // 1st call with un-trimmed phrase
        let phrase_with_space = "   Roughness \n".to_string();
        let res1 = pipeline
            .translate_phrases(&[phrase_with_space.clone()], "blender", None)
            .await;
        assert_eq!(res1.len(), 1);
        assert_eq!(res1[0].translated, "粗糙度");
        assert_eq!(res1[0].source_tier, "blender");

        // 2nd call with identical un-trimmed phrase
        let res2 = pipeline
            .translate_phrases(&[phrase_with_space.clone()], "blender", None)
            .await;
        assert_eq!(res2.len(), 1);
        assert_eq!(res2[0].translated, "粗糙度");

        // EMPIRICAL BUG CHECK: Is cache hit achieved?
        let cache_hit = res2[0].source_tier.contains("(Cached)");
        println!(
            "[Empirical Test] Whitespace phrase cache hit on 2nd call: {}",
            cache_hit
        );
        println!(
            "[Empirical Test] Actual source_tier returned: '{}'",
            res2[0].source_tier
        );

        // Check trimmed variant cache hit
        let res3 = pipeline
            .translate_phrases(&["Roughness".to_string()], "blender", None)
            .await;
        let cache_hit_trimmed = res3[0].source_tier.contains("(Cached)");
        println!(
            "[Empirical Test] Trimmed phrase variant cache hit: {}",
            cache_hit_trimmed
        );

        // Assert failure if cache hit failed due to key mismatch bug
        assert!(cache_hit, "CACHE BUG DETECTED: Cache store uses untrimmed original phrase as key while retrieve queries trimmed key!");
    });
}

#[test]
fn test_challenger_4tier_fallback_transitions() {
    tauri::async_runtime::block_on(async {
        let pipeline = MultiTierPipeline::new();

        // Tier 1: Direct Preset Dict match
        let t1_res = pipeline
            .translate_phrases(&["Principled BSDF".to_string()], "blender", None)
            .await;
        assert_eq!(t1_res[0].translated, "原理化 BSDF");
        assert_eq!(t1_res[0].source_tier, "blender");

        // Tier 2: CG Fallback Dict match (Term exists in substance.json, active preset is "blender")
        let t2_res = pipeline
            .translate_phrases(&["AO Mixing Mode".to_string()], "blender", None)
            .await;
        assert_eq!(t2_res[0].translated, "AO混合模式");
        assert_eq!(t2_res[0].source_tier, "substance");

        // Tier 3: LLM API client match via HTTP mock server
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    // Read request
                    let _ = socket.read(&mut buf).await;
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

                    let body = serde_json::json!({
                        "choices": [
                            {
                                "message": {
                                    "content": "{\"Unknown Term LLM\": \"未知术语 LLM\"}"
                                }
                            }
                        ]
                    })
                    .to_string();

                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    let _ = socket.flush().await;
                    let _ = socket.shutdown().await;
                });
            }
        });

        let llm_config = LlmConfig {
            id: Some("test".to_string()),
            provider: "DeepSeek".to_string(),
            api_key: "test-key".to_string(),
            model: "deepseek-chat".to_string(),
            endpoint: format!("http://{}", addr),
        };

        let t3_res = pipeline
            .translate_phrases(
                &["Unknown Term LLM".to_string()],
                "blender",
                Some(&llm_config),
            )
            .await;
        assert_eq!(t3_res[0].translated, "未知术语 LLM");
        assert_eq!(t3_res[0].source_tier, "LLM API (DeepSeek)");

        // Tier 4: Online Fallback API or Untranslated Fallback Tag
        let t4_res = pipeline
            .translate_phrases(&["Unmatched XYZ Term 12345".to_string()], "blender", None)
            .await;
        assert_eq!(t4_res[0].original, "Unmatched XYZ Term 12345");
        assert!(
            t4_res[0].source_tier == "Online Fallback" || t4_res[0].source_tier == "Fallback API",
            "Expected Online Fallback or Fallback API tier, got: '{}'",
            t4_res[0].source_tier
        );
    });
}
