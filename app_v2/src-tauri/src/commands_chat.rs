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
    } else {
        // Cloudflare AI Gateway /openai 兼容层适配：支持 /v1beta/models 与 /v1beta/openai/models 自动探测
        if clean_base.ends_with("/openai") {
            let stripped = clean_base.strip_suffix("/openai").unwrap_or(&clean_base);
            candidate_urls.push(format!("{}/models", stripped));
            candidate_urls.push(format!("{}/models", clean_base));
        }

        if is_google_gemini {
            if clean_base.ends_with("/v1beta") || clean_base.ends_with("/v1") {
                candidate_urls.push(format!("{}/models", clean_base));
            } else {
                candidate_urls.push(format!("{}/v1beta/models", clean_base));
                candidate_urls.push(format!("{}/v1/models", clean_base));
                candidate_urls.push(format!("{}/models", clean_base));
            }
            if api_key.starts_with("AIza") {
                candidate_urls.push("https://generativelanguage.googleapis.com/v1beta/models".to_string());
            }
        } else {
            candidate_urls.push(format!("{}/models", clean_base));
            if !clean_base.ends_with("/v1") {
                candidate_urls.push(format!("{}/v1/models", clean_base));
            }
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

        // 注入鉴权请求头：原生 Google API 使用 x-goog-api-key；Cloudflare / OpenAI 代理同时附带 Bearer
        if !api_key.is_empty() {
            if is_google_gemini && !clean_base.contains("openai") && !clean_base.contains("cloudflare") {
                req = req
                    .header("x-goog-api-key", &api_key)
                    .header("api-key", &api_key);
            } else {
                req = req
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("x-goog-api-key", &api_key)
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

/// 流式增量事件：done=false 携带一段增量文本与思考思路增量；done=true 表示流结束。
#[derive(Clone, Serialize)]
pub struct ChatStreamDelta {
    pub delta: String,
    pub reasoning: Option<String>,
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

use crate::translator::is_gemini_model_or_provider;

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

    let is_google_gemini = is_gemini_model_or_provider(&config.provider, &model_name, &raw_ep);

    // 1. Separate base path and query parameters
    let (base_path, query_str) = match raw_ep.find('?') {
        Some(pos) => (&raw_ep[..pos], Some(&raw_ep[pos + 1..])),
        None => (raw_ep.as_str(), None),
    };

    let clean_base = base_path.trim_end_matches('/').to_string();

    // Candidate chat endpoints in priority order
    let mut candidate_urls = Vec::new();

    // 1. 若用户填写的 URL 本身就已经包含具体端点路径（/chat/completions 或 :generateContent），最优先保留原样
    if raw_ep.contains("/chat/completions") || raw_ep.contains(":generateContent") {
        candidate_urls.push(raw_ep.clone());
    } else if clean_base.ends_with("/openai") || clean_base.ends_with("/v1") || clean_base.ends_with("/v2") || clean_base.ends_with("/v4") {
        // 用户显式配置了形如 .../v1beta/openai 或 .../v1 基础路径
        candidate_urls.push(format!("{}/chat/completions", clean_base));
    }

    if is_google_gemini {
        // Strip suffixes to get base root hostname (e.g. https://generativelanguage.googleapis.com)
        let mut root = clean_base.as_str();
        for s in ["/chat/completions", "/completions", "/openai", "/models", "/v1beta", "/v1"] {
            if let Some(stripped) = root.strip_suffix(s) {
                root = stripped;
            }
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
    } else {
        let mut b = clean_base.as_str();
        if let Some(stripped) = b.strip_suffix("/chat/completions") {
            b = stripped;
        }
        if let Some(stripped) = b.strip_suffix("/completions") {
            b = stripped;
        }
        let b = b.trim_end_matches('/');

        if b.ends_with("/v1") || b.ends_with("/openai") {
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

/// 拼接最终 URL（查询串 + Google 专属 key 参数）
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
        if final_url.contains("googleapis.com")
            || final_url.contains("google-ai-studio")
            || final_url.contains(":generateContent")
            || final_url.contains(":streamGenerateContent")
        {
            if final_url.contains('?') {
                final_url = format!("{}&key={}", final_url, plan.api_key);
            } else {
                final_url = format!("{}?key={}", final_url, plan.api_key);
            }
        }
    }
    final_url
}

/// 附加鉴权头
fn apply_chat_auth(
    mut req: reqwest::RequestBuilder,
    plan: &ChatEndpointPlan,
    is_native_gemini: bool,
) -> reqwest::RequestBuilder {
    if !plan.api_key.is_empty() {
        if is_native_gemini {
            // 原生 Gemini :generateContent / :streamGenerateContent 严禁附带 Bearer 头，否则会报 401 ACCESS_TOKEN_TYPE_UNSUPPORTED
            req = req
                .header("x-goog-api-key", &plan.api_key)
                .header("api-key", &plan.api_key);
        } else {
            // OpenAI 兼容端点（如 /chat/completions 或 Cloudflare AI Gateway）必须附带 Authorization: Bearer
            req = req
                .header("Authorization", format!("Bearer {}", plan.api_key))
                .header("api-key", &plan.api_key);
            if plan.is_google_gemini {
                req = req.header("x-goog-api-key", &plan.api_key);
            }
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
    } else {
        let mut b = serde_json::json!({
            "model": plan.model_name,
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 4096,
        });
        if stream {
            b["stream"] = serde_json::json!(true);
        }
        b
    }
}

/// 从完整 JSON 响应中提取回复文本（OpenAI / Gemini / Ollama 三种格式）
fn extract_chat_reply(json: &serde_json::Value) -> Option<String> {
    let first_choice = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first());

    if let Some(msg) = first_choice.and_then(|first| first.get("message")) {
        let content = msg.get("content").and_then(|val| val.as_str()).unwrap_or("").trim();
        let reasoning = msg.get("reasoning_content")
            .or_else(|| msg.get("reasoning"))
            .and_then(|val| val.as_str())
            .unwrap_or("")
            .trim();

        if !reasoning.is_empty() && !content.is_empty() {
            return Some(format!("<think>\n{}\n</think>\n\n{}", reasoning, content));
        } else if !content.is_empty() {
            return Some(content.to_string());
        } else if !reasoning.is_empty() {
            return Some(format!("<think>\n{}\n</think>", reasoning));
        }
    }

    if let Some(candidates) = json.get("candidates").and_then(|c| c.as_array()).and_then(|arr| arr.first()) {
        if let Some(parts) = candidates.get("content").and_then(|cnt| cnt.get("parts")).and_then(|p| p.as_array()) {
            let mut thought_str = String::new();
            let mut text_str = String::new();
            for part in parts {
                if let Some(t) = part.get("text").and_then(|val| val.as_str()) {
                    if !t.is_empty() {
                        let is_thought = part.get("thought").and_then(|val| val.as_bool()).unwrap_or(false);
                        if is_thought {
                            thought_str.push_str(t);
                        } else {
                            text_str.push_str(t);
                        }
                    }
                }
            }
            if !thought_str.is_empty() && !text_str.is_empty() {
                return Some(format!("<think>\n{}\n</think>\n\n{}", thought_str.trim(), text_str.trim()));
            } else if !text_str.is_empty() {
                return Some(text_str);
            } else if !thought_str.is_empty() {
                return Some(format!("<think>\n{}\n</think>", thought_str.trim()));
            }
        }
    }

    if let Some(res_str) = json.get("response").and_then(|v| v.as_str()) {
        if !res_str.trim().is_empty() {
            return Some(res_str.to_string());
        }
    }

    None
}

/// 统一解析并格式化 HTTP 错误，提取服务商上游返回的具体错误说明（如模型不存在、配额耗尽等）
fn format_http_error(
    status_code: u16,
    err_body: &str,
    req_url: &str,
    model_name: &str,
    api_key: &str,
) -> (String, bool) {
    let mut extracted_msg = String::new();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(err_body) {
        if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
            extracted_msg = msg.to_string();
        } else if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
            extracted_msg = msg.to_string();
        } else if let Some(arr) = v.as_array() {
            if let Some(msg) = arr.first().and_then(|item| item.get("error")).and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                extracted_msg = msg.to_string();
            }
        }
    }

    let is_informative = !extracted_msg.is_empty();
    let detail = if is_informative {
        extracted_msg
    } else {
        truncate_utf8(err_body, 220).to_string()
    };

    let formatted = if status_code == 404 && (detail.to_lowercase().contains("not found") || detail.to_lowercase().contains("model")) {
        format!(
            "HTTP 404 错误: 模型 \"{}\" 在当前服务商接口中不存在或不受支持 ({}) (请求路径: {})",
            model_name,
            detail,
            redact_secret(req_url, api_key)
        )
    } else if status_code == 401 || status_code == 403 {
        format!(
            "HTTP {} 鉴权错误: API Key 无效或未授权 ({}) (请求路径: {})",
            status_code,
            detail,
            redact_secret(req_url, api_key)
        )
    } else {
        format!(
            "HTTP {} 错误: {} (请求路径: {})",
            status_code,
            detail,
            redact_secret(req_url, api_key)
        )
    };

    (formatted, is_informative)
}

/// Native Rust command for LLM chat bypassing WebView CORS restrictions
/// Supports DeepSeek, OpenAI, Ollama, Gemini, GLM, and Custom Endpoints.
#[tauri::command]
pub async fn cmd_chat_llm(
    messages: Vec<ChatMessagePayload>,
    config: LlmConfig,
) -> Result<String, String> {
    let plan = plan_chat_endpoints(&config)?;

    let client = crate::translator::create_http_client(65000);

    let mut last_err = String::new();

    for target_url in &plan.candidate_urls {
        let final_url = finalize_chat_url(&plan, target_url);

        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = build_chat_body(&plan, &messages, is_native_gemini_endpoint, false);

        let req = apply_chat_auth(client.post(&final_url), &plan, is_native_gemini_endpoint);

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
            let (formatted_err, is_informative) = format_http_error(
                status_code,
                &err_body,
                &final_url,
                &plan.model_name,
                &plan.api_key,
            );
            if last_err.is_empty() || is_informative {
                last_err = formatted_err;
            }
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

    let client = crate::translator::create_http_client(65000);

    let mut last_err = String::new();

    for target_url in &plan.candidate_urls {
        let final_url = finalize_chat_url(&plan, target_url);
        let is_native_gemini_endpoint = final_url.contains(":generateContent");

        let req_url = if is_native_gemini_endpoint {
            let mut u = final_url.replace(":generateContent", ":streamGenerateContent");
            if !u.contains("alt=sse") {
                if u.contains('?') {
                    u = format!("{}&alt=sse", u);
                } else {
                    u = format!("{}?alt=sse", u);
                }
            }
            u
        } else {
            final_url.clone()
        };

        let body = build_chat_body(&plan, &messages, is_native_gemini_endpoint, !is_native_gemini_endpoint);

        let req = apply_chat_auth(client.post(&req_url), &plan, is_native_gemini_endpoint);

        let res = match req.json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!(
                    "网络连接失败 (无法连接到 {}): {}",
                    redact_secret(&req_url, &plan.api_key),
                    e
                );
                continue;
            }
        };

        let status = res.status();
        if !status.is_success() {
            let status_code = status.as_u16();
            let err_body = res.text().await.unwrap_or_default();
            let (formatted_err, is_informative) = format_http_error(
                status_code,
                &err_body,
                &req_url,
                &plan.model_name,
                &plan.api_key,
            );
            if last_err.is_empty() || is_informative {
                last_err = formatted_err;
            }
            continue;
        }

        let is_sse = is_native_gemini_endpoint
            || res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.contains("text/event-stream") || v.contains("stream"))
                .unwrap_or(false);

        if is_sse {
            let mut stream = res.bytes_stream();
            let mut buf = String::new();
            let mut full = String::new();
            let mut full_reasoning = String::new();
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
                while let Some(pos) = buf.find('\n') {
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
                        // 1. OpenAI 兼容流式解析 (choices[0].delta)
                        let delta_obj = v
                            .get("choices")
                            .and_then(|c| c.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|first| first.get("delta"));

                        let mut content_opt = delta_obj
                            .and_then(|delta| delta.get("content").and_then(|c| c.as_str()))
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string());

                        let mut reasoning_opt = delta_obj
                            .and_then(|delta| {
                                delta.get("reasoning_content")
                                    .or_else(|| delta.get("reasoning"))
                                    .and_then(|c| c.as_str())
                            })
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string());

                        // 2. Gemini 原生 SSE 流式解析 (candidates[0].content.parts[*])
                        if content_opt.is_none() && reasoning_opt.is_none() {
                            if let Some(candidate) = v.get("candidates").and_then(|c| c.as_array()).and_then(|arr| arr.first()) {
                                if let Some(parts) = candidate.get("content").and_then(|cnt| cnt.get("parts")).and_then(|p| p.as_array()) {
                                    let mut g_content = String::new();
                                    let mut g_reasoning = String::new();
                                    for part in parts {
                                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                            if !text.is_empty() {
                                                let is_thought = part.get("thought").and_then(|val| val.as_bool()).unwrap_or(false);
                                                if is_thought {
                                                    g_reasoning.push_str(text);
                                                } else {
                                                    g_content.push_str(text);
                                                }
                                            }
                                        }
                                    }
                                    if !g_content.is_empty() {
                                        content_opt = Some(g_content);
                                    }
                                    if !g_reasoning.is_empty() {
                                        reasoning_opt = Some(g_reasoning);
                                    }
                                }
                            }
                        }

                        if content_opt.is_some() || reasoning_opt.is_some() {
                            let c_str = content_opt.unwrap_or_default();
                            let _ = on_delta.send(ChatStreamDelta {
                                delta: c_str.clone(),
                                reasoning: reasoning_opt.clone(),
                                done: false,
                            });
                            if !c_str.is_empty() {
                                full.push_str(&c_str);
                            }
                            if let Some(r) = reasoning_opt {
                                full_reasoning.push_str(&r);
                            }
                        }
                    }
                }
            }

            if !full.trim().is_empty() || !full_reasoning.trim().is_empty() {
                let _ = on_delta.send(ChatStreamDelta {
                    delta: String::new(),
                    reasoning: None,
                    done: true,
                });
                if !full_reasoning.trim().is_empty() && !full.trim().is_empty() {
                    return Ok(format!("<think>\n{}\n</think>\n\n{}", full_reasoning.trim(), full));
                } else if !full.trim().is_empty() {
                    return Ok(full);
                } else {
                    return Ok(format!("<think>\n{}\n</think>", full_reasoning.trim()));
                }
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
                reasoning: None,
                done: false,
            });
            let _ = on_delta.send(ChatStreamDelta {
                delta: String::new(),
                reasoning: None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plan_chat_endpoints_google_gemini() {
        let config = LlmConfig {
            id: Some("gemini".to_string()),
            provider: "Google Gemini".to_string(),
            api_key: "AIzaTestKey123".to_string(),
            model: "gemini-3.5-flash-lite".to_string(),
            endpoint: "https://gateway.ai.cloudflare.com/v1/user/gemini-proxy/google-ai-studio/v1beta/openai".to_string(),
            enabled: Some(true),
        };

        let plan = plan_chat_endpoints(&config).unwrap();
        assert!(plan.is_google_gemini);
        assert_eq!(
            plan.candidate_urls[0],
            "https://gateway.ai.cloudflare.com/v1/user/gemini-proxy/google-ai-studio/v1beta/openai/chat/completions"
        );
        assert!(plan.candidate_urls.iter().any(|u| u.contains(":generateContent")));

        let final_url = finalize_chat_url(&plan, &plan.candidate_urls[0]);
        assert!(final_url.contains("key=AIzaTestKey123"));
    }

    #[test]
    fn test_plan_chat_endpoints_deepseek_proxy_not_hijacked() {
        let config = LlmConfig {
            id: Some("deepseek".to_string()),
            provider: "DeepSeek".to_string(),
            api_key: "AIzaTestKey123".to_string(),
            model: "deepseek-v4-flash".to_string(),
            endpoint: "https://gateway.ai.cloudflare.com/v1/user/gemini-proxy/google-ai-studio/v1beta/openai".to_string(),
            enabled: Some(true),
        };

        let plan = plan_chat_endpoints(&config).unwrap();
        // 关键断言：非 Google 厂商（DeepSeek）绝对不得被识别为 is_google_gemini，即使网关名为 gemini-proxy 或 Key 为 AIza
        assert!(!plan.is_google_gemini);
        assert_eq!(
            plan.candidate_urls[0],
            "https://gateway.ai.cloudflare.com/v1/user/gemini-proxy/google-ai-studio/v1beta/openai/chat/completions"
        );
        assert!(!plan.candidate_urls.iter().any(|u| u.contains(":generateContent")));

        // 绝不强行注入 ?key=
        let final_url = finalize_chat_url(&plan, &plan.candidate_urls[0]);
        assert!(!final_url.contains("key="));
    }

    #[test]
    fn test_plan_chat_endpoints_agnes_proxy_not_hijacked() {
        let config = LlmConfig {
            id: Some("agnes".to_string()),
            provider: "Agnes".to_string(),
            api_key: "AIzaTestKey123".to_string(),
            model: "agnes-2.5-flash".to_string(),
            endpoint: "https://gateway.ai.cloudflare.com/v1/user/gemini-proxy/google-ai-studio/v1beta/openai".to_string(),
            enabled: Some(true),
        };

        let plan = plan_chat_endpoints(&config).unwrap();
        assert!(!plan.is_google_gemini);
        assert_eq!(
            plan.candidate_urls[0],
            "https://gateway.ai.cloudflare.com/v1/user/gemini-proxy/google-ai-studio/v1beta/openai/chat/completions"
        );
        assert!(!plan.candidate_urls.iter().any(|u| u.contains(":generateContent")));
    }

    #[test]
    fn test_format_http_error_model_not_found() {
        let err_json = r#"{"error":{"code":404,"message":"models/agnes-2.5-flash is not found for API version v1main","status":"NOT_FOUND"}}"#;
        let (formatted, is_informative) = format_http_error(
            404,
            err_json,
            "https://gateway.ai.cloudflare.com/v1/test/openai/chat/completions",
            "agnes-2.5-flash",
            "mock-key",
        );

        assert!(is_informative);
        assert!(formatted.contains("模型 \"agnes-2.5-flash\" 在当前服务商接口中不存在或不受支持"));
        assert!(formatted.contains("models/agnes-2.5-flash is not found"));
    }
}

