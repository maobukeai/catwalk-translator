//! LLM 相关命令:模型列表拉取(/models)、普通对话与流式对话
//! (多端点兼容、鉴权注入、响应解析与密钥脱敏)。

use crate::models::LlmConfig;

/// Native Rust command to query /models endpoint over network bypassing WebView CORS restrictions.
#[tauri::command]
pub async fn cmd_fetch_llm_models(
    endpoint: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let raw_input = endpoint.trim().to_string();
    if raw_input.is_empty() {
        return Err("API 接口地址不能为空".to_string());
    }

    // 1. Separate base path and existing query string
    let (base_path, query_str) = match raw_input.find('?') {
        Some(pos) => (&raw_input[..pos], Some(&raw_input[pos + 1..])),
        None => (raw_input.as_str(), None),
    };

    let mut clean_base = base_path.trim_end_matches('/').to_string();
    if clean_base.ends_with("/chat/completions") {
        clean_base = clean_base.replace("/chat/completions", "");
    }
    if clean_base.ends_with("/completions") {
        clean_base = clean_base.replace("/completions", "");
    }

    let is_google_gemini = clean_base.contains("google")
        || clean_base.contains("gemini")
        || clean_base.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    // 2. Build candidate network URLs for listing models in priority order
    let mut candidate_urls = Vec::new();

    if clean_base.ends_with("/models") {
        candidate_urls.push(clean_base.clone());
    } else if is_google_gemini {
        if clean_base.ends_with("/v1beta") || clean_base.ends_with("/v1") {
            candidate_urls.push(format!("{}/models", clean_base));
        } else {
            // For Cloudflare AI Gateway / Google AI Studio base URLs, /v1beta/models MUST be tried first!
            candidate_urls.push(format!("{}/v1beta/models", clean_base));
            candidate_urls.push(format!("{}/v1/models", clean_base));
            candidate_urls.push(format!("{}/models", clean_base));
        }
    } else {
        candidate_urls.push(format!("{}/models", clean_base));
        if !clean_base.ends_with("/v1") {
            candidate_urls.push(format!("{}/v1/models", clean_base));
        }
    }

    // 3. Prepare reqwest client with 15s timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("无法初始化网络客户端: {}", e))?;

    let mut last_error = String::new();

    // 4. Try candidate URLs in priority sequence
    for target_base in candidate_urls {
        let mut final_url = target_base.clone();

        // Preserve existing query params if any
        if let Some(qs) = query_str {
            if !qs.is_empty() {
                if final_url.contains('?') {
                    final_url = format!("{}&{}", final_url, qs);
                } else {
                    final_url = format!("{}?{}", final_url, qs);
                }
            }
        }

        // For Gemini / Google API, append ?key=
        if is_google_gemini && !api_key.is_empty() && !final_url.contains("key=") {
            if final_url.contains('?') {
                final_url = format!("{}&key={}", final_url, api_key);
            } else {
                final_url = format!("{}?key={}", final_url, api_key);
            }
        }

        let mut req = client.get(&final_url);

        // IMPORTANT CRITICAL FIX:
        // DO NOT send Authorization: Bearer header for Gemini/Google API keys (starting with AIza)!
        // Google AI Studio treats Bearer headers as OAuth 2 tokens and returns 401 Unauthorized!
        if !api_key.is_empty() {
            if is_google_gemini {
                req = req
                    .header("x-goog-api-key", &api_key)
                    .header("api-key", &api_key);
            } else {
                req = req
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("api-key", &api_key);
            }
        }

        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!(
                    "网络请求无法连接到: {} ({})",
                    redact_secret(&final_url, &api_key),
                    e
                );
                continue;
            }
        };

        let status = res.status();
        let status_code = status.as_u16();

        if !status.is_success() {
            let err_body = res.text().await.unwrap_or_default();
            let short_body = truncate_utf8(&err_body, 150);
            last_error = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code,
                short_body,
                redact_secret(&final_url, &api_key)
            );
            continue;
        }

        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_error = format!(
                    "接口返回无效 JSON ({}) 路径: {}",
                    e,
                    redact_secret(&final_url, &api_key)
                );
                continue;
            }
        };

        let mut models = Vec::new();

        // Parse OpenAI format {"data": [...]}
        if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
            for m in data {
                let id_str = if let Some(s) = m.get("id").and_then(|v| v.as_str()) {
                    Some(s)
                } else if let Some(s) = m.get("name").and_then(|v| v.as_str()) {
                    Some(s)
                } else {
                    m.as_str()
                };

                if let Some(id) = id_str {
                    let clean = id.trim_start_matches("models/").to_string();
                    if !clean.is_empty() && !models.contains(&clean) {
                        models.push(clean);
                    }
                }
            }
        }

        // Parse Gemini / Google format {"models": [...]}
        if models.is_empty() {
            if let Some(data) = json.get("models").and_then(|v| v.as_array()) {
                for m in data {
                    let id_str = if let Some(s) = m.get("name").and_then(|v| v.as_str()) {
                        Some(s)
                    } else if let Some(s) = m.get("id").and_then(|v| v.as_str()) {
                        Some(s)
                    } else {
                        m.as_str()
                    };

                    if let Some(id) = id_str {
                        let clean = id.trim_start_matches("models/").to_string();
                        if !clean.is_empty() && !models.contains(&clean) {
                            models.push(clean);
                        }
                    }
                }
            }
        }

        if !models.is_empty() {
            return Ok(models);
        } else {
            last_error = format!(
                "接口 (200 OK) 返回成功但未找到模型字段。路径: {}",
                final_url
            );
        }
    }

    Err(if last_error.is_empty() {
        "无法获取可用模型，请检查 API Key 和接口地址".to_string()
    } else {
        format!("拉取失败: {}", last_error)
    })
}

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessagePayload {
    pub role: String,
    pub content: String,
}

/// 流式增量事件：done=false 携带一段增量文本；done=true 表示流结束（delta 为空）。
#[derive(Clone, Serialize)]
pub struct ChatStreamDelta {
    pub delta: String,
    pub done: bool,
}

/// 端点规划：把用户填写的 Base URL 展开为按优先级排列的候选请求地址。
struct ChatEndpointPlan {
    candidate_urls: Vec<String>,
    query_str: Option<String>,
    is_google_gemini: bool,
    api_key: String,
    model_name: String,
}

/// 按 UTF-8 字符边界截断字符串。直接字节切片会在多字节字符（如中文）
/// 中间切开导致 panic，服务商返回的中文错误体经常超过截断长度。
pub fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes.min(s.len());
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

/// 把错误信息里出现的 API key 替换为 ***，避免密钥随弹窗/截图外泄。
pub fn redact_secret(text: &str, secret: &str) -> String {
    if secret.len() < 8 {
        text.to_string()
    } else {
        text.replace(secret, "***")
    }
}

fn plan_chat_endpoints(config: &LlmConfig) -> Result<ChatEndpointPlan, String> {
    let raw_ep = config.endpoint.trim().to_string();
    if raw_ep.is_empty() {
        return Err("API 接口地址不能为空".to_string());
    }

    let api_key = config.api_key.trim().to_string();
    let model_name = if config.model.trim().is_empty() {
        "gemini-1.5-flash".to_string()
    } else {
        config.model.trim().to_string()
    };

    let is_google_gemini = raw_ep.contains("google")
        || raw_ep.contains("gemini")
        || raw_ep.contains("googleapis.com")
        || raw_ep.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    // 1. Separate base path and query parameters
    let (base_path, query_str) = match raw_ep.find('?') {
        Some(pos) => (&raw_ep[..pos], Some(&raw_ep[pos + 1..])),
        None => (raw_ep.as_str(), None),
    };

    let clean_base = base_path.trim_end_matches('/').to_string();

    // Candidate chat endpoints in priority order
    let mut candidate_urls = Vec::new();

    if raw_ep.contains("/chat/completions") || raw_ep.contains(":generateContent") {
        candidate_urls.push(raw_ep.clone());
    }

    if is_google_gemini {
        // Strip suffixes to get base root hostname (e.g. https://generativelanguage.googleapis.com)
        let mut root = clean_base.as_str();
        if let Some(stripped) = root.strip_suffix("/chat/completions") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/completions") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/openai") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/models") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/v1beta") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/v1") {
            root = stripped;
        }
        let root = root.trim_end_matches('/');

        // Google AI Studio official OpenAI-compatible endpoint (supports SSE stream & standard chat completions)
        candidate_urls.push(format!("{}/v1beta/openai/chat/completions", root));
        // Google AI Studio native REST endpoint
        candidate_urls.push(format!(
            "{}/v1beta/models/{}:generateContent",
            root, model_name
        ));
        candidate_urls.push(format!(
            "{}/models/{}:generateContent",
            root, model_name
        ));
        candidate_urls.push(format!("{}/v1/chat/completions", root));
        candidate_urls.push(format!("{}/chat/completions", root));
    } else {
        let mut b = clean_base.as_str();
        if let Some(stripped) = b.strip_suffix("/chat/completions") {
            b = stripped;
        }
        if let Some(stripped) = b.strip_suffix("/completions") {
            b = stripped;
        }
        let b = b.trim_end_matches('/');

        if b.ends_with("/v1") {
            candidate_urls.push(format!("{}/chat/completions", b));
            candidate_urls.push(b.to_string());
        } else {
            candidate_urls.push(format!("{}/v1/chat/completions", b));
            candidate_urls.push(format!("{}/chat/completions", b));
        }

        if b.contains("localhost") || b.contains("127.0.0.1") {
            candidate_urls.push(format!("{}/api/chat", b));
        }
    }

    // Deduplicate candidate_urls while preserving order
    let mut seen = std::collections::HashSet::new();
    candidate_urls.retain(|url| seen.insert(url.clone()));

    Ok(ChatEndpointPlan {
        candidate_urls,
        query_str: query_str.map(|s| s.to_string()),
        is_google_gemini,
        api_key,
        model_name,
    })
}

/// 拼接最终 URL（查询串 + Gemini key 参数）
fn finalize_chat_url(plan: &ChatEndpointPlan, target_url: &str) -> String {
    let mut final_url = target_url.to_string();
    if let Some(qs) = &plan.query_str {
        if !qs.is_empty() {
            if final_url.contains('?') {
                final_url = format!("{}&{}", final_url, qs);
            } else {
                final_url = format!("{}?{}", final_url, qs);
            }
        }
    }

    if plan.is_google_gemini && !plan.api_key.is_empty() && !final_url.contains("key=") {
        if final_url.contains('?') {
            final_url = format!("{}&key={}", final_url, plan.api_key);
        } else {
            final_url = format!("{}?key={}", final_url, plan.api_key);
        }
    }
    final_url
}

/// 附加鉴权头
fn apply_chat_auth(mut req: reqwest::RequestBuilder, plan: &ChatEndpointPlan) -> reqwest::RequestBuilder {
    if !plan.api_key.is_empty() {
        if plan.is_google_gemini {
            req = req
                .header("x-goog-api-key", &plan.api_key)
                .header("api-key", &plan.api_key);
            if !plan.api_key.starts_with("AIza") {
                req = req.header("Authorization", format!("Bearer {}", plan.api_key));
            }
        } else {
            req = req
                .header("Authorization", format!("Bearer {}", plan.api_key))
                .header("api-key", &plan.api_key);
        }
    }
    req
}

/// 构造请求体：OpenAI 兼容（可选 stream）或 Gemini 原生
fn build_chat_body(
    plan: &ChatEndpointPlan,
    messages: &[ChatMessagePayload],
    native_gemini: bool,
    stream: bool,
) -> serde_json::Value {
    if native_gemini {
        let contents: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                let role = if m.role == "user" { "user" } else { "model" };
                serde_json::json!({
                    "role": role,
                    "parts": [{ "text": m.content }]
                })
            })
            .collect();
        serde_json::json!({ "contents": contents })
    } else if stream {
        serde_json::json!({
            "model": plan.model_name,
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 2000,
            "stream": true,
        })
    } else {
        serde_json::json!({
            "model": plan.model_name,
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 2000,
        })
    }
}

/// 从完整 JSON 响应中提取回复文本（OpenAI / Gemini / Ollama 三种格式）
fn extract_chat_reply(json: &serde_json::Value) -> Option<String> {
    if let Some(content) = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.get(0))
        .and_then(|first| first.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|val| val.as_str())
    {
        if !content.trim().is_empty() {
            return Some(content.to_string());
        }
    }

    if let Some(text) = json
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.get(0))
        .and_then(|first| first.get("content"))
        .and_then(|cnt| cnt.get("parts"))
        .and_then(|parts| parts.as_array())
        .and_then(|arr| arr.get(0))
        .and_then(|part| part.get("text"))
        .and_then(|val| val.as_str())
    {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }

    if let Some(res_str) = json.get("response").and_then(|v| v.as_str()) {
        if !res_str.trim().is_empty() {
            return Some(res_str.to_string());
        }
    }

    None
}

/// Native Rust command for LLM chat bypassing WebView CORS restrictions
/// Supports DeepSeek, OpenAI, Ollama, Gemini, GLM, and Custom Endpoints.
#[tauri::command]
pub async fn cmd_chat_llm(
    messages: Vec<ChatMessagePayload>,
    config: LlmConfig,
) -> Result<String, String> {
    let plan = plan_chat_endpoints(&config)?;

    let client = crate::translator::create_http_client(35000);

    let mut last_err = String::new();

    for target_url in &plan.candidate_urls {
        let final_url = finalize_chat_url(&plan, target_url);

        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = build_chat_body(&plan, &messages, is_native_gemini_endpoint, false);

        let req = apply_chat_auth(client.post(&final_url), &plan);

        let res = match req.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!(
                    "网络连接失败 (无法连接到 {}): {}",
                    redact_secret(&final_url, &plan.api_key),
                    e
                );
                continue;
            }
        };

        let status = res.status();
        let status_code = status.as_u16();

        if !status.is_success() {
            let err_body = res.text().await.unwrap_or_default();
            let short_body = truncate_utf8(&err_body, 220);
            last_err = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code,
                short_body,
                redact_secret(&final_url, &plan.api_key)
            );
            continue;
        }

        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_err = format!(
                    "接口返回无效 JSON ({}) 路径: {}",
                    e,
                    redact_secret(&final_url, &plan.api_key)
                );
                continue;
            }
        };

        if let Some(content) = extract_chat_reply(&json) {
            return Ok(content);
        }

        last_err = format!("接口成功 (200 OK) 但未能解析出消息文本。原始响应: {}", json);
    }

    Err(if last_err.is_empty() {
        "AI 对话服务暂时不可用，请检查网络与接口配置".to_string()
    } else {
        last_err
    })
}

/// 流式 LLM 对话：OpenAI 兼容端点走 SSE 增量解析并经 Channel 推送 delta；
/// Gemini 原生端点或不支持流式的端点自动回退为一次性返回（单 delta 发完）。
/// 返回值 = 完整回复文本（与非流式 cmd_chat_llm 一致，便于上层回退）。
#[tauri::command]
pub async fn cmd_chat_llm_stream(
    messages: Vec<ChatMessagePayload>,
    config: LlmConfig,
    on_delta: Channel<ChatStreamDelta>,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let plan = plan_chat_endpoints(&config)?;

    let client = crate::translator::create_http_client(35000);

    let mut last_err = String::new();

    for target_url in &plan.candidate_urls {
        let final_url = finalize_chat_url(&plan, target_url);
        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = build_chat_body(&plan, &messages, is_native_gemini_endpoint, !is_native_gemini_endpoint);

        let req = apply_chat_auth(client.post(&final_url), &plan);

        let res = match req.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!(
                    "网络连接失败 (无法连接到 {}): {}",
                    redact_secret(&final_url, &plan.api_key),
                    e
                );
                continue;
            }
        };

        let status = res.status();
        if !status.is_success() {
            let status_code = status.as_u16();
            let err_body = res.text().await.unwrap_or_default();
            let short_body = truncate_utf8(&err_body, 220);
            last_err = format!(
                "HTTP {} 错误: {} (路径: {})",
                status_code,
                short_body,
                redact_secret(&final_url, &plan.api_key)
            );
            continue;
        }

        let is_sse = !is_native_gemini_endpoint
            && res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.contains("text/event-stream"))
                .unwrap_or(false);

        if is_sse {
            let mut stream = res.bytes_stream();
            let mut buf = String::new();
            let mut full = String::new();
            let mut stream_err: Option<String> = None;

            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        stream_err = Some(format!("流式读取中断: {}", e));
                        break;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&chunk));

                // 逐行解析 SSE：`data: {json}`，`data: [DONE]` 结束
                loop {
                    match buf.find('\n') {
                        Some(pos) => {
                            let line: String = buf.drain(..=pos).collect();
                            let line = line.trim_end();
                            let Some(data) = line.strip_prefix("data:") else {
                                continue;
                            };
                            let data = data.trim();
                            if data.is_empty() || data == "[DONE]" {
                                continue;
                            }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(d) = v
                                    .get("choices")
                                    .and_then(|c| c.as_array())
                                    .and_then(|arr| arr.get(0))
                                    .and_then(|first| first.get("delta"))
                                    .and_then(|delta| delta.get("content"))
                                    .and_then(|c| c.as_str())
                                {
                                    if !d.is_empty() {
                                        let _ = on_delta.send(ChatStreamDelta {
                                            delta: d.to_string(),
                                            done: false,
                                        });
                                        full.push_str(d);
                                    }
                                }
                            }
                        }
                        None => break,
                    }
                }
            }

            if !full.trim().is_empty() {
                let _ = on_delta.send(ChatStreamDelta {
                    delta: String::new(),
                    done: true,
                });
                return Ok(full);
            }
            last_err = stream_err
                .unwrap_or_else(|| "流式响应结束但未产出文本".to_string());
            continue;
        }

        // 非 SSE（Gemini 原生 / 不支持流式）：一次性解析并作为单条 delta 推送
        let json: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => {
                last_err = format!(
                    "接口返回无效 JSON ({}) 路径: {}",
                    e,
                    redact_secret(&final_url, &plan.api_key)
                );
                continue;
            }
        };

        if let Some(content) = extract_chat_reply(&json) {
            let _ = on_delta.send(ChatStreamDelta {
                delta: content.clone(),
                done: false,
            });
            let _ = on_delta.send(ChatStreamDelta {
                delta: String::new(),
                done: true,
            });
            return Ok(content);
        }

        last_err = format!("接口成功 (200 OK) 但未能解析出消息文本。原始响应: {}", json);
    }

    Err(if last_err.is_empty() {
        "AI 对话服务暂时不可用，请检查网络与接口配置".to_string()
    } else {
        last_err
    })
}
