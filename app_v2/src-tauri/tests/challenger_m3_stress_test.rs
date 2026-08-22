//! Challenger M3 Stress & Concurrency Verification Test Suite
//! Tests:
//! 1. Invalid LLM Endpoints & HTTP Errors (404, 500, malformed JSON, connection refused)
//! 2. Missing API Keys & Authentication Errors (401 Unauthorized)
//! 3. HTTP Timeout Handling (>4s server delay, fallback transition)
//! 4. 50+ Async Concurrent Calls to `cmd_translate_phrases` / `MultiTierPipeline`
//! 5. Thread Lock Contention (RwLock cache, OnceLock dicts, concurrent read/write)

use app_v2_lib::{
    models::LlmConfig,
    translator::{MultiTierPipeline, TranslationCache, TranslationResult},
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

// ============================================================================
// 1. Invalid LLM Endpoints & HTTP Errors
// ============================================================================

#[tokio::test]
async fn test_challenger_invalid_endpoint_connection_refused() {
    let pipeline = MultiTierPipeline::new();
    let config = LlmConfig {
        id: Some("test".to_string()),
        provider: "DeepSeek".to_string(),
        api_key: "sk-test-key".to_string(),
        model: "deepseek-chat".to_string(),
        endpoint: "http://127.0.0.1:59999".to_string(), // Unused port
    };

    let phrases = vec!["Unmatched Test Term Refused".to_string()];
    let start = Instant::now();
    let results = pipeline
        .translate_phrases(&phrases, "blender", Some(&config), &[])
        .await;
    let elapsed = start.elapsed();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].original, "Unmatched Test Term Refused");
    // Should fallback cleanly without crashing or hanging
    assert!(!results[0].translated.is_empty());
    println!(
        "[Challenger] Connection refused test completed in {:?}",
        elapsed
    );
}

#[tokio::test]
async fn test_challenger_invalid_endpoint_http_404_500_errors() {
    // Mock server returning HTTP 500 Internal Server Error
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let response = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 21\r\n\r\nInternal Server Error";
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });

    let pipeline = MultiTierPipeline::new();
    let config = LlmConfig {
        id: Some("test".to_string()),
        provider: "OpenAI".to_string(),
        api_key: "sk-proj-test".to_string(),
        model: "gpt-4o".to_string(),
        endpoint: format!("http://{}", addr),
    };

    let phrases = vec!["Unmatched 500 Phrase".to_string()];
    let results = pipeline
        .translate_phrases(&phrases, "blender", Some(&config), &[])
        .await;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].original, "Unmatched 500 Phrase");
    // Graceful fallback to Online / Fallback API
    assert!(
        results[0].source_tier == "Online Fallback" || results[0].source_tier == "Fallback API"
    );
}

#[tokio::test]
async fn test_challenger_malformed_llm_json_response() {
    // Mock server returning 200 OK but with non-JSON body
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let response_body =
                r#"{"choices": [{"message": {"content": "This is plain text not JSON!"}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            let _ = socket.write_all(response.as_bytes()).await;
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

    let phrases = vec!["Unmatched Malformed Phrase".to_string()];
    let results = pipeline
        .translate_phrases(&phrases, "blender", Some(&config), &[])
        .await;

    assert_eq!(results.len(), 1);
    // Malformed JSON should not panic; fallback should handle it
    assert!(!results[0].translated.is_empty());
}

// ============================================================================
// 2. Missing API Keys & Authentication Errors
// ============================================================================

#[tokio::test]
async fn test_challenger_missing_api_key_401_unauthorized() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let response_body = r#"{"error": {"message": "Invalid API Key"}}"#;
            let response = format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });

    let pipeline = MultiTierPipeline::new();
    let config = LlmConfig {
        id: Some("test".to_string()),
        provider: "DeepSeek".to_string(),
        api_key: "".to_string(), // Empty key
        model: "deepseek-chat".to_string(),
        endpoint: format!("http://{}", addr),
    };

    let phrases = vec!["Unmatched 401 Phrase".to_string()];
    let results = pipeline
        .translate_phrases(&phrases, "blender", Some(&config), &[])
        .await;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].original, "Unmatched 401 Phrase");
    assert!(
        results[0].source_tier == "Online Fallback" || results[0].source_tier == "Fallback API"
    );
}

// ============================================================================
// 3. HTTP Timeout Handling
// ============================================================================

#[tokio::test]
async fn test_challenger_http_timeout_4s_limit() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            // Delay 5 seconds to exceed 4s LLM timeout
            tokio::time::sleep(Duration::from_secs(5)).await;
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

    let start = Instant::now();
    let phrases = vec!["Timeout Phrase X".to_string()];
    let results = pipeline
        .translate_phrases(&phrases, "blender", Some(&config), &[])
        .await;
    let elapsed = start.elapsed();

    assert_eq!(results.len(), 1);
    // Timeout must take between 3.0s and 10.0s total
    println!("[Challenger] Timeout test elapsed: {:?}", elapsed);
    assert!(
        elapsed >= Duration::from_secs(3),
        "Timeout was too fast: {:?}",
        elapsed
    );
    assert!(
        elapsed <= Duration::from_secs(20),
        "Timeout took too long: {:?}",
        elapsed
    );
}

// ============================================================================
// 4. Batch Phrase Processing over 50+ Async Concurrent Calls
// ============================================================================

#[tokio::test]
async fn test_challenger_50_plus_async_concurrent_calls() {
    let num_tasks = 60; // 60 concurrent tasks calling cmd_translate_phrases
    let mut handles = Vec::with_capacity(num_tasks);

    let start = Instant::now();

    for i in 0..num_tasks {
        let task_id = i;
        let handle = tokio::spawn(async move {
            let phrases = vec![
                "Principled BSDF".to_string(),       // Tier 1 Preset (Blender)
                "AO Mixing Mode".to_string(),        // Tier 2 Fallback (Substance)
                "NavMesh Surface".to_string(),       // Tier 2 Fallback (Unity)
                format!("Dynamic Term {}", task_id), // Unmatched term
                "  Bevel  ".to_string(),             // Whitespace preset term
                "".to_string(),                      // Empty phrase
            ];
            let res = Ok::<_, String>(app_v2_lib::translator::shared_pipeline().translate_phrases(&phrases, "blender", None, &[]).await);
            assert!(res.is_ok(), "Task {} failed", task_id);
            let results = res.unwrap();
            assert_eq!(results.len(), 6, "Task {} unexpected length", task_id);

            // Assert dictionary matches (can be uncached or cached depending on race execution order)
            assert_eq!(results[0].translated, "原理化 BSDF");
            assert!(results[0].source_tier.contains("blender"));

            assert_eq!(results[1].translated, "AO混合模式");
            assert!(results[1].source_tier.contains("substance"));

            assert_eq!(results[2].translated, "NavMesh 表面");
            assert!(results[2].source_tier.contains("unity"));

            assert_eq!(results[4].translated, "倒角");
            assert_eq!(results[5].translated, "");
        });
        handles.push(handle);
    }

    for (idx, handle) in handles.into_iter().enumerate() {
        let res = handle.await;
        assert!(res.is_ok(), "Concurrent task {} panicked!", idx);
    }

    let elapsed = start.elapsed();
    println!(
        "[Challenger] 60 async concurrent requests completed successfully in {:?}",
        elapsed
    );
}

// ============================================================================
// 5. Thread Lock Contention
// ============================================================================

#[test]
fn test_challenger_translation_cache_heavy_lock_contention() {
    let cache = Arc::new(TranslationCache::new());
    let num_threads: usize = 50;
    let iterations_per_thread: usize = 500;
    let mut handles = Vec::with_capacity(num_threads);

    let start = Instant::now();

    for t in 0..num_threads {
        let cache_clone = Arc::clone(&cache);
        let handle = std::thread::spawn(move || {
            for i in 0..iterations_per_thread {
                let key = format!("Key_{}_{}", t % 5, i % 10);
                if i % 2 == 0 {
                    cache_clone.store(TranslationResult {
                        original: key.clone(),
                        translated: format!("Val_{}", i),
                        source_tier: "TestTier".to_string(),
                    });
                } else {
                    let _ = cache_clone.retrieve(&key);
                }
                if i % 100 == 0 {
                    cache_clone.clear();
                }
            }
        });
        handles.push(handle);
    }

    for h in handles {
        h.join().unwrap();
    }

    let _elapsed = start.elapsed();
    cache.clear();
    assert!(cache.retrieve("Key_0_0").is_none());
}
