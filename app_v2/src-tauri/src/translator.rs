pub use crate::models::{
    LlmConfig, MultiEngineTranslation, TextQueryResponse, TranslationResult, WordDetail,
};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

static CG_DICTS: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();

/// Windows 系统代理自适应探测：读取注册表 Internet Settings，若开启代理客户端则自动挂载
/// 同时做 100ms TCP 探活，防止代理软件退出后遗留注册表导致全网崩塌（幽灵代理 Bug）
#[cfg(windows)]
pub fn detect_windows_proxy() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet_settings = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let enable: u32 = internet_settings.get_value("ProxyEnable").ok()?;
    if enable == 1 {
        let server: String = internet_settings.get_value("ProxyServer").ok()?;
        let server = server.trim().to_string();
        if !server.is_empty() {
            // 探活：提取 host:port 并做 100ms TCP 连接测试，失败则降级为直连
            let host_port = parse_proxy_to_url(&server)
                .replace("http://", "")
                .replace("https://", "")
                .replace("socks5://", "");
            let alive = std::net::ToSocketAddrs::to_socket_addrs(&host_port.as_str())
                .ok()
                .and_then(|mut addrs| addrs.next())
                .map(|addr| {
                    std::net::TcpStream::connect_timeout(
                        &addr,
                        std::time::Duration::from_millis(100),
                    )
                    .is_ok()
                })
                .unwrap_or(false);
            if alive {
                return Some(server);
            }
        }
    }
    None
}

#[cfg(not(windows))]
pub fn detect_windows_proxy() -> Option<String> {
    None
}

/// 解析 Windows 代理配置字符串（支持 127.0.0.1:7890 或 http=127.0.0.1:7890;https=127.0.0.1:7890 等格式）
pub fn parse_proxy_to_url(proxy_str: &str) -> String {
    let raw = proxy_str.trim();
    let target = if raw.contains('=') {
        let mut chosen = "";
        for part in raw.split(';') {
            let part = part.trim();
            if part.starts_with("https=") {
                chosen = &part[6..];
                break;
            } else if part.starts_with("http=") {
                chosen = &part[5..];
            } else if chosen.is_empty() && part.contains('=') {
                if let Some((_, val)) = part.split_once('=') {
                    chosen = val;
                }
            }
        }
        if chosen.is_empty() { raw } else { chosen }
    } else {
        raw
    };

    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("socks5://") {
        target.to_string()
    } else {
        format!("http://{}", target)
    }
}

/// 创建带系统代理自适应、Cookie Store 与标准 UA 的统一 reqwest Client
pub fn create_http_client(timeout_ms: u64) -> Client {
    let mut builder = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

    if let Some(proxy_str) = detect_windows_proxy() {
        let proxy_url = parse_proxy_to_url(&proxy_str);
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            let proxy = proxy.no_proxy(reqwest::NoProxy::from_string("localhost,127.0.0.1,::1,0.0.0.0"));
            builder = builder.proxy(proxy);
        }
    }

    builder.build().unwrap_or_else(|_| Client::new())
}

/// Extra directive appended to LLM prompts per user-selected translation style:
/// "literal" (直译) | "free" (意译/流畅) | "terminology" (术语优先).
pub fn style_directive(style: Option<&str>) -> &'static str {
    match style {
        Some("literal") => " Style: translate LITERALLY — stay close to the source wording, structure and order; do not paraphrase.",
        Some("terminology") => " Style: TERMINOLOGY FIRST — use the standard CG/3D/software-industry term for technical words, keep term translations consistent across all strings, and keep well-known product names untranslated.",
        Some("free") => " Style: translate naturally and idiomatically — prioritize fluent, readable output over literal fidelity.",
        _ => "",
    }
}

pub fn get_cg_dicts() -> &'static HashMap<String, HashMap<String, String>> {
    CG_DICTS.get_or_init(|| {
        let mut dicts = HashMap::new();
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/blender.json"
        )) {
            dicts.insert("blender".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/substance.json"
        )) {
            dicts.insert("substance".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/unity.json"
        )) {
            dicts.insert("unity".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/unreal.json"
        )) {
            dicts.insert("unreal".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/maya.json"
        )) {
            dicts.insert("maya".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/houdini.json"
        )) {
            dicts.insert("houdini".to_string(), map);
        }
        dicts
    })
}

pub trait TranslatorEngine {
    fn translate_batch(&self, phrases: &[String], preset: &str) -> Vec<TranslationResult>;
}

pub struct CgDictionaryEngine {
    dicts: HashMap<String, HashMap<String, String>>,
}

impl Default for CgDictionaryEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CgDictionaryEngine {
    pub fn new() -> Self {
        let mut dicts = HashMap::new();
        for (k, v) in get_cg_dicts() {
            dicts.insert(k.clone(), v.clone());
        }
        Self { dicts }
    }

    pub fn lookup(&self, phrase: &str, preset: &str) -> Option<(String, String)> {
        let trimmed = phrase.trim();
        if trimmed.is_empty() {
            return None;
        }

        // Priority 1: Check requested preset dictionary
        if let Some(map) = self.dicts.get(preset) {
            if let Some(val) = map.get(trimmed) {
                return Some((val.clone(), preset.to_string()));
            }
            let lower = trimmed.to_lowercase();
            for (k, v) in map {
                if k.to_lowercase() == lower {
                    return Some((v.clone(), preset.to_string()));
                }
            }
        }
        // Priority 2: Fallback search across remaining preset dictionaries
        for (dict_name, map) in &self.dicts {
            if dict_name != preset {
                if let Some(val) = map.get(trimmed) {
                    return Some((val.clone(), dict_name.clone()));
                }
                let lower = trimmed.to_lowercase();
                for (k, v) in map {
                    if k.to_lowercase() == lower {
                        return Some((v.clone(), dict_name.clone()));
                    }
                }
            }
        }
        None
    }
}

impl TranslatorEngine for CgDictionaryEngine {
    fn translate_batch(&self, phrases: &[String], preset: &str) -> Vec<TranslationResult> {
        phrases
            .iter()
            .map(|p| {
                if let Some((translated, tier)) = self.lookup(p, preset) {
                    TranslationResult {
                        original: p.clone(),
                        translated,
                        source_tier: tier,
                    }
                } else {
                    TranslationResult {
                        original: p.clone(),
                        translated: p.clone(),
                        source_tier: "Untranslated".to_string(),
                    }
                }
            })
            .collect()
    }
}

pub struct TranslationCache {
    store: RwLock<HashMap<String, TranslationResult>>,
}

impl Default for TranslationCache {
    fn default() -> Self {
        Self::new()
    }
}

impl TranslationCache {
    pub fn new() -> Self {
        Self {
            store: RwLock::new(HashMap::new()),
        }
    }

    pub fn store(&self, result: TranslationResult) {
        if let Ok(mut lock) = self.store.write() {
            lock.insert(result.original.trim().to_string(), result);
        }
    }

    pub fn retrieve(&self, key: &str) -> Option<TranslationResult> {
        if let Ok(lock) = self.store.read() {
            lock.get(key.trim()).cloned()
        } else {
            None
        }
    }

    pub fn clear(&self) {
        if let Ok(mut lock) = self.store.write() {
            lock.clear();
        }
    }
}

pub struct MultiTierPipeline {
    pub cache: TranslationCache,
    pub client: Client,
}

impl Default for MultiTierPipeline {
    fn default() -> Self {
        Self::new()
    }
}

impl MultiTierPipeline {
    pub fn new() -> Self {
        let client = create_http_client(5000);
        Self {
            cache: TranslationCache::new(),
            client,
        }
    }

    pub fn lookup_dict(&self, phrase: &str, preset: &str) -> Option<(String, String)> {
        let dicts = get_cg_dicts();
        let trimmed = phrase.trim();
        if trimmed.is_empty() {
            return None;
        }

        let has_chinese = trimmed
            .chars()
            .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));

        // Priority 1: Check requested preset dictionary
        if let Some(map) = dicts.get(preset) {
            if has_chinese {
                for (k, v) in map {
                    if v == trimmed || v.contains(trimmed) {
                        return Some((k.clone(), preset.to_string()));
                    }
                }
            } else {
                if let Some(val) = map.get(trimmed) {
                    return Some((val.clone(), preset.to_string()));
                }
                let lower = trimmed.to_lowercase();
                for (k, v) in map {
                    if k.to_lowercase() == lower {
                        return Some((v.clone(), preset.to_string()));
                    }
                }
            }
        }

        // Priority 2: Fallback search across remaining preset dictionaries
        for (dict_name, map) in dicts {
            if dict_name != preset {
                if has_chinese {
                    for (k, v) in map {
                        if v == trimmed || v.contains(trimmed) {
                            return Some((k.clone(), dict_name.clone()));
                        }
                    }
                } else {
                    if let Some(val) = map.get(trimmed) {
                        return Some((val.clone(), dict_name.clone()));
                    }
                    let lower = trimmed.to_lowercase();
                    for (k, v) in map {
                        if k.to_lowercase() == lower {
                            return Some((v.clone(), dict_name.clone()));
                        }
                    }
                }
            }
        }

        None
    }

    pub async fn translate_phrases(
        &self,
        phrases: &[String],
        preset: &str,
        llm_config: Option<&LlmConfig>,
    ) -> Vec<TranslationResult> {
        self.translate_phrases_styled(phrases, preset, llm_config, None)
            .await
    }

    pub async fn translate_phrases_styled(
        &self,
        phrases: &[String],
        preset: &str,
        llm_config: Option<&LlmConfig>,
        style: Option<&str>,
    ) -> Vec<TranslationResult> {
        let mut results: Vec<Option<TranslationResult>> = vec![None; phrases.len()];
        let mut unmatched_indices: Vec<usize> = Vec::new();
        let offline_ready = crate::offline::status().installed;

        for (i, phrase) in phrases.iter().enumerate() {
            let trimmed = phrase.trim();
            if trimmed.is_empty() {
                results[i] = Some(TranslationResult {
                    original: phrase.clone(),
                    translated: String::new(),
                    source_tier: "Empty".to_string(),
                });
                continue;
            }

            // Step 0: Check Cache
            if let Some(cached) = self.cache.retrieve(trimmed) {
                results[i] = Some(TranslationResult {
                    original: phrase.clone(),
                    translated: cached.translated,
                    source_tier: format!("{} (Cached)", cached.source_tier),
                });
                continue;
            }

            // Step 1 & 2: Local Preset Dictionary & CG Fallback Dictionary
            if let Some((translated, source_tier)) = self.lookup_dict(phrase, preset) {
                let res = TranslationResult {
                    original: phrase.clone(),
                    translated,
                    source_tier,
                };
                self.cache.store(res.clone());
                results[i] = Some(res);
                continue;
            }

            // Step 2.5: Offline phrase dictionary — embedded general-UI terms,
            // participates only when the offline engine is installed on disk.
            if offline_ready {
                if let Some(translated) = crate::offline::translate_offline(trimmed) {
                    let res = TranslationResult {
                        original: phrase.clone(),
                        translated,
                        source_tier: "离线词库".to_string(),
                    };
                    self.cache.store(res.clone());
                    results[i] = Some(res);
                    continue;
                }
            }

            unmatched_indices.push(i);
        }

        if unmatched_indices.is_empty() {
            return results.into_iter().map(|r| r.unwrap()).collect();
        }

        let unmatched_phrases: Vec<String> = unmatched_indices
            .iter()
            .map(|&idx| phrases[idx].trim().to_string())
            .collect();

        // Step 3: Tier 3 (LLM API Client)
        if let Some(config) = llm_config {
            if !config.endpoint.is_empty() {
                let llm_res = self.translate_via_llm_with_style(&unmatched_phrases, config, style).await;
                if let Ok(map) = llm_res {
                    if !map.is_empty() {
                        let tier_label = if !config.provider.is_empty() {
                            format!("LLM API ({})", config.provider)
                        } else {
                            "LLM API".to_string()
                        };

                        let mut still_unmatched_indices = Vec::new();
                        for &idx in &unmatched_indices {
                            let p = phrases[idx].trim();
                            if let Some(translated) = map.get(p) {
                                let res = TranslationResult {
                                    original: phrases[idx].clone(),
                                    translated: translated.clone(),
                                    source_tier: tier_label.clone(),
                                };
                                self.cache.store(res.clone());
                                results[idx] = Some(res);
                            } else {
                                still_unmatched_indices.push(idx);
                            }
                        }
                        unmatched_indices = still_unmatched_indices;
                    }
                }
            }
        }

        if unmatched_indices.is_empty() {
            return results.into_iter().map(|r| r.unwrap()).collect();
        }

        // Step 4: Tier 4 (Online Fallback API) — parallel with bounded concurrency.
        // Dense selections used to serialize every unmatched line (N × up-to-3s);
        // now all lines fan out behind a 6-permit semaphore, so wall time ≈ one call.
        let mut online_results: HashMap<usize, String> = HashMap::new();
        if !unmatched_indices.is_empty() {
            let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
            let mut set: tokio::task::JoinSet<(usize, Result<String, String>)> =
                tokio::task::JoinSet::new();

            for &idx in &unmatched_indices {
                let p = phrases[idx].trim().to_string();
                let client = self.client.clone();
                let permits = semaphore.clone();
                set.spawn(async move {
                    let _permit = permits.acquire_owned().await;
                    let res = translate_online_fallback_with(&client, &p).await;
                    (idx, res)
                });
            }

            while let Some(joined) = set.join_next().await {
                if let Ok((idx, Ok(translated))) = joined {
                    online_results.insert(idx, translated);
                }
            }
        }

        let mut still_unmatched = Vec::new();
        for &idx in &unmatched_indices {
            if let Some(translated) = online_results.remove(&idx) {
                let res = TranslationResult {
                    original: phrases[idx].clone(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                };
                self.cache.store(res.clone());
                results[idx] = Some(res);
            } else {
                still_unmatched.push(idx);
            }
        }

        // Final Fallback for remaining phrases
        for idx in still_unmatched {
            let p = &phrases[idx];
            results[idx] = Some(TranslationResult {
                original: p.clone(),
                translated: format!("{} (通用翻译)", p),
                source_tier: "Fallback API".to_string(),
            });
        }

        results.into_iter().map(|r| r.unwrap()).collect()
    }

    pub async fn translate_via_llm(
        &self,
        phrases: &[String],
        config: &LlmConfig,
    ) -> Result<HashMap<String, String>, String> {
        self.translate_via_llm_with_style(phrases, config, None)
            .await
    }

    pub async fn translate_via_llm_with_style(
        &self,
        phrases: &[String],
        config: &LlmConfig,
        style: Option<&str>,
    ) -> Result<HashMap<String, String>, String> {
        let endpoint = config.endpoint.trim_end_matches('/');
        let url = if endpoint.ends_with("/chat/completions") {
            endpoint.to_string()
        } else {
            format!("{}/chat/completions", endpoint)
        };

        let has_chinese = phrases
            .iter()
            .any(|p| p.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)));
        let system_prompt = if has_chinese {
            format!("You are an expert translator. Translate the given Chinese text/terms into natural English. Return ONLY a valid JSON object mapping each original Chinese string to its English translation, without markdown formatting or extra text.{}", style_directive(style))
        } else {
            format!("You are an expert translator. Translate the given foreign/English text/terms into simplified Chinese. Return ONLY a valid JSON object mapping each original string to its simplified Chinese translation, without markdown formatting or extra text.{}", style_directive(style))
        };
        let user_prompt = serde_json::to_string(phrases).unwrap_or_else(|_| "[]".to_string());

        let body = serde_json::json!({
            "model": if config.model.is_empty() { "deepseek-chat" } else { &config.model },
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "temperature": 0.1
        });

        let mut req = self.client.post(&url).json(&body);
        if !config.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", config.api_key));
        }

        let res = tokio::time::timeout(Duration::from_secs(4), req.send())
            .await
            .map_err(|_| "LLM request timed out".to_string())?
            .map_err(|e| format!("LLM network error: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("LLM API status error {}: {}", status, err_text));
        }

        let resp_json: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse LLM response JSON: {}", e))?;

        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "Missing message content in LLM response".to_string())?;

        let cleaned = clean_json_response(content);
        let parsed: HashMap<String, String> = serde_json::from_str(&cleaned)
            .map_err(|e| format!("Failed to deserialize LLM translation map: {}", e))?;

        Ok(parsed)
    }

    pub async fn translate_via_online_fallback(&self, phrase: &str) -> Result<String, String> {
        translate_online_fallback_with(&self.client, phrase).await
    }

    pub async fn query_text_detail(
        &self,
        text: &str,
        preset: &str,
        llm_config: Option<&LlmConfig>,
    ) -> TextQueryResponse {
        let trimmed = text.trim();
        let mut results = Vec::new();

        // 1. Preset Dictionary Lookup
        let dict_lookup = self.lookup_dict(trimmed, preset);
        if let Some((translated, source_tier)) = &dict_lookup {
            results.push(MultiEngineTranslation {
                engine_name: format!("通用离线词典 ({})", source_tier.to_uppercase()),
                translated: translated.clone(),
                source_tier: source_tier.clone(),
            });
        }

        // 2. Online Fallback API (Google Translate)
        if let Ok(online_trans) = self.translate_via_online_fallback(trimmed).await {
            results.push(MultiEngineTranslation {
                engine_name: "Google 翻译".to_string(),
                translated: online_trans,
                source_tier: "Online Fallback".to_string(),
            });
        }

        // 3. LLM API (if configured)
        if let Some(config) = llm_config {
            if !config.endpoint.is_empty() && !config.api_key.is_empty() {
                let phrases = vec![trimmed.to_string()];
                if let Ok(llm_map) = self.translate_via_llm(&phrases, config).await {
                    if let Some(llm_trans) = llm_map.get(trimmed) {
                        let provider_name = if !config.provider.is_empty() {
                            format!("LLM ({})", config.provider)
                        } else {
                            "LLM 大模型".to_string()
                        };
                        results.push(MultiEngineTranslation {
                            engine_name: provider_name,
                            translated: llm_trans.clone(),
                            source_tier: "LLM API".to_string(),
                        });
                    }
                }
            }
        }

        if results.is_empty() {
            results.push(MultiEngineTranslation {
                engine_name: "默认回退引擎".to_string(),
                translated: format!("{} (通用翻译)", trimmed),
                source_tier: "Fallback API".to_string(),
            });
        }

        // Generate WordDetail for single word or term queries
        let word_detail = if dict_lookup.is_some() || trimmed.split_whitespace().count() <= 3 {
            let def = results
                .first()
                .map(|r| r.translated.clone())
                .unwrap_or_default();
            let domain_note = dict_lookup
                .as_ref()
                .map(|(_, tier)| format!("精选离线词库 [{}]", tier))
                .unwrap_or_else(|| "通用术语/词汇".to_string());
            Some(WordDetail {
                phonetic_us: format!("/ {} /", trimmed.to_lowercase()),
                phonetic_uk: format!("[ {} ]", trimmed.to_lowercase()),
                pos: "n. / 通用词汇".to_string(),
                definition: def,
                examples: vec![
                    format!(
                        "Example: Select '{}' in the application settings panel.",
                        trimmed
                    ),
                    format!(
                        "用法说明：在应用程序界面或文档中正确使用 {} 词汇。",
                        trimmed
                    ),
                ],
                cg_domain_note: domain_note,
            })
        } else {
            None
        };

        TextQueryResponse {
            original: trimmed.to_string(),
            word_detail,
            results,
        }
    }
}

fn clean_json_response(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with("```") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() >= 2 {
            let start = if lines[0].starts_with("```") { 1 } else { 0 };
            let end = if lines.last().map_or(false, |l| l.trim().starts_with("```")) {
                lines.len() - 1
            } else {
                lines.len()
            };
            return lines[start..end].join("\n");
        }
    }
    trimmed.to_string()
}

fn urlencoding_encode(s: &str) -> String {
    let mut encoded = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

use crate::models::{UniversalTranslationRequest, UniversalTranslationResponse};

/// 校验守卫函数：严格过滤 URL 投毒/风控跳转链接、HTML 网页错误、JSON 异常体以及限流关键词
pub fn is_valid_translation(orig: &str, candidate: &str) -> bool {
    let cand = candidate.trim();
    let orig_trim = orig.trim();
    if cand.is_empty() || orig_trim.is_empty() {
        return false;
    }

    let orig_lower = orig_trim.to_lowercase();
    let cand_lower = cand.to_lowercase();

    // 1. URL 投毒/风控跳转拦截：若原文非 URL，但译文包含 URL 协议、域名或已知风控特征（如 linux.do / t.me 等）
    let orig_has_url = orig_lower.contains("http://") || orig_lower.contains("https://") || orig_lower.contains("www.");
    if !orig_has_url {
        if cand_lower.contains("http://")
            || cand_lower.contains("https://")
            || cand_lower.contains("linux.do")
            || cand_lower.contains("t.me/")
            || cand_lower.contains("github.com")
            || cand_lower.contains("deeplx")
            || cand_lower.contains("fanyi.baidu.com")
            || cand_lower.contains("bing.com")
            || (cand_lower.starts_with("www.") && cand.contains('.'))
        {
            return false;
        }
    }

    // 2. HTML 标签 / 网页错误拦截：若原文无 HTML 标记但译文包含 HTML 结构
    let orig_has_html = orig_lower.contains("<html") || orig_lower.contains("<!doctype") || orig_lower.contains("<body");
    if !orig_has_html {
        if cand_lower.contains("<!doctype")
            || cand_lower.contains("<html")
            || cand_lower.contains("<body")
            || cand_lower.contains("<script")
            || cand_lower.contains("<head")
            || cand_lower.contains("<div")
            || cand_lower.contains("</span>")
            || cand_lower.contains("</p>")
        {
            return false;
        }
    }

    // 3. 常见 JSON 报错格式拦截
    if (cand.starts_with('{') && cand.ends_with('}')) || (cand.starts_with('[') && cand.ends_with(']')) {
        if cand_lower.contains("\"code\":")
            || cand_lower.contains("\"error\":")
            || cand_lower.contains("\"message\":")
            || cand_lower.contains("\"msg\":")
        {
            return false;
        }
    }

    // 4. 常见接口限流/风控/网关错误提示关键词拦截
    let error_keywords = [
        "too many requests",
        "rate limit",
        "ratelimit",
        "ip has been blocked",
        "ip blocked",
        "frequency limit",
        "unauthorized",
        "access denied",
        "service unavailable",
        "gateway timeout",
        "bad gateway",
        "internal server error",
        "cf-ray",
        "error code:",
        "请求过于频繁",
        "访问过于频繁",
        "频率超限",
        "接口受限",
        "风控拦截",
        "配额不足",
        "429 too many",
        "403 forbidden",
        "502 bad gateway",
        "504 gateway",
    ];
    for kw in &error_keywords {
        if cand_lower.contains(kw) && !orig_lower.contains(kw) {
            return false;
        }
    }

    true
}

fn map_google_lang(code: &str) -> &str {
    match code {
        "auto" => "auto",
        "zh-CN" | "zh" => "zh-CN",
        "zh-TW" | "zh-HK" => "zh-TW",
        "he" => "iw",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_bing_lang(code: &str) -> &str {
    match code {
        "auto" | "" => "",
        "zh-CN" | "zh" => "zh-Hans",
        "zh-TW" | "zh-HK" => "zh-Hant",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_bing_target_lang(code: &str) -> &str {
    match code {
        "zh-CN" | "zh" | "auto" => "zh-Hans",
        "zh-TW" | "zh-HK" => "zh-Hant",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_baidu_lang(code: &str) -> &str {
    match code {
        "auto" => "auto",
        "zh-CN" | "zh" => "zh",
        "zh-TW" | "zh-HK" => "cht",
        "en" => "en",
        "ja" => "jp",
        "ko" => "kor",
        "fr" => "fra",
        "es" => "spa",
        "th" => "th",
        "ar" => "ara",
        "ru" => "ru",
        "pt" => "pt",
        "de" => "de",
        "it" => "it",
        "el" => "el",
        "nl" => "nl",
        "pl" => "pl",
        "da" => "dan",
        "fi" => "fin",
        "cs" => "cs",
        "sv" => "swe",
        "hu" => "hu",
        "ro" => "rom",
        "vi" => "vie",
        "id" => "id",
        "hi" => "hi",
        "uk" => "ukr",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_mymemory_lang(code: &str) -> &str {
    match code {
        "auto" => "en",
        "zh-CN" | "zh" => "zh-CN",
        "zh-TW" | "zh-HK" => "zh-TW",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_deepl_source_lang(code: &str) -> String {
    match code {
        "auto" => "AUTO".to_string(),
        "zh-CN" | "zh" => "ZH".to_string(),
        "zh-TW" | "zh-HK" => "ZH".to_string(),
        "en" => "EN".to_string(),
        other => other.to_uppercase(),
    }
}

fn map_deepl_target_lang(code: &str) -> String {
    match code {
        "zh-CN" | "zh" | "auto" => "ZH".to_string(),
        "zh-TW" | "zh-HK" => "ZH-HANT".to_string(),
        "en" | "en-US" => "EN-US".to_string(),
        "en-GB" => "EN-GB".to_string(),
        "pt" | "pt-BR" => "PT-BR".to_string(),
        "pt-PT" => "PT-PT".to_string(),
        other => other.to_uppercase(),
    }
}

fn get_target_lang_display_name(code: &str) -> &str {
    match code {
        "zh-CN" | "zh" => "Simplified Chinese (简体中文)",
        "zh-TW" | "zh-HK" => "Traditional Chinese (繁體中文)",
        "en" => "English",
        "ja" => "Japanese (日本語)",
        "ko" => "Korean (한국어)",
        "fr" => "French (Français)",
        "de" => "German (Deutsch)",
        "es" => "Spanish (Español)",
        "ru" => "Russian (Русский)",
        "it" => "Italian (Italiano)",
        "pt" => "Portuguese (Português)",
        "nl" => "Dutch (Nederlands)",
        "pl" => "Polish (Polski)",
        "ar" => "Arabic (العربية)",
        "th" => "Thai (ไทย)",
        "vi" => "Vietnamese (Tiếng Việt)",
        "id" => "Indonesian (Bahasa Indonesia)",
        "tr" => "Turkish (Türkçe)",
        "hi" => "Hindi (हिन्दी)",
        "uk" => "Ukrainian (Українська)",
        "sv" => "Swedish (Svenska)",
        "cs" => "Czech (Čeština)",
        "el" => "Greek (Ελληνικά)",
        "he" => "Hebrew (עברית)",
        "da" => "Danish (Dansk)",
        "fi" => "Finnish (Suomi)",
        "no" => "Norwegian (Norsk)",
        "hu" => "Hungarian (Magyar)",
        "ro" => "Romanian (Română)",
        other => other,
    }
}

/// ── Google 翻译 ─────────────────────────────────────────────────────────────
pub async fn translate_google(client: &Client, q: &str, src: &str, tgt: &str) -> Option<String> {
    let clean_src = map_google_lang(src);
    let clean_tgt = map_google_lang(tgt);
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
        clean_src, clean_tgt, urlencoding_encode(q)
    );
    let req = client.get(&url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(4000), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(arr) = json.as_array().and_then(|a| a.get(0)).and_then(|a| a.as_array()) {
                    let mut text = String::new();
                    for item in arr {
                        if let Some(s) = item.get(0).and_then(|v| v.as_str()) {
                            text.push_str(s);
                        }
                    }
                    if is_valid_translation(q, &text) {
                        return Some(text);
                    }
                }
            }
        }
    }
    None
}

/// ── 微软 Bing 必应翻译 (国内直连 cn.bing.com + Edge 免密 API 并发竞速) ──────
pub async fn translate_bing(client: &Client, q: &str, src: &str, tgt: &str) -> Option<String> {
    use futures_util::stream::FuturesUnordered;
    use futures_util::StreamExt;

    let from_lang = map_bing_lang(src);
    let to_lang = map_bing_target_lang(tgt);

    let mut futures = FuturesUnordered::new();

    // 方案 A：Edge Translation 官方免密 API
    {
        let c = client.clone();
        let orig = q.to_string();
        let from_l = from_lang.to_string();
        let to_l = to_lang.to_string();
        futures.push(tokio::spawn(async move {
            let auth_req = c
                .get("https://edge.microsoft.com/translate/auth")
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
                );
            if let Ok(Ok(auth_res)) = tokio::time::timeout(Duration::from_millis(2500), auth_req.send()).await {
                if auth_res.status().is_success() {
                    if let Ok(jwt) = auth_res.text().await {
                        let jwt = jwt.trim();
                        if !jwt.is_empty() {
                            let mut url = format!(
                                "https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to={}&includeSentenceLength=true",
                                to_l
                            );
                            if !from_l.is_empty() && from_l != "auto" {
                                url.push_str(&format!("&from={}", from_l));
                            }
                            let body = serde_json::json!([{ "Text": orig }]);
                            let trans_req = c
                                .post(&url)
                                .header("Authorization", format!("Bearer {}", jwt))
                                .header(
                                    "User-Agent",
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
                                )
                                .header("Content-Type", "application/json")
                                .json(&body);
                            if let Ok(Ok(trans_res)) = tokio::time::timeout(Duration::from_millis(2500), trans_req.send()).await {
                                if trans_res.status().is_success() {
                                    if let Ok(json) = trans_res.json::<serde_json::Value>().await {
                                        if let Some(text) = json
                                            .get(0)
                                            .and_then(|item| item.get("translations"))
                                            .and_then(|t| t.get(0))
                                            .and_then(|t| t.get("text"))
                                            .and_then(|s| s.as_str())
                                        {
                                            if is_valid_translation(&orig, text) {
                                                return Some(text.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    // 方案 B：国内直连 cn.bing.com/ttranslatev3 动态抓取
    {
        let c = client.clone();
        let orig = q.to_string();
        let from_l = from_lang.to_string();
        let to_l = to_lang.to_string();
        futures.push(tokio::spawn(async move {
            let bing_from = if from_l.is_empty() { "auto-detect" } else { &from_l };
            let home_req = c
                .get("https://cn.bing.com/translator")
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                )
                .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
            if let Ok(Ok(home_res)) = tokio::time::timeout(Duration::from_millis(4000), home_req.send()).await {
                if let Ok(html) = home_res.text().await {
                    let ig = html.find("IG:\"").and_then(|pos| {
                        let part = &html[pos + 4..];
                        part.find('"').map(|end| part[..end].to_string())
                    });
                    // 兼容 格式化JS（含空格）和压缩JS（无空格）两种形式
                    let (key, token) = {
                        // 查找 params_AbusePreventionHelper 后紧跟的 [ 符号位置
                        let marker = "params_AbusePreventionHelper";
                        let mut key_str = String::new();
                        let mut token_str = String::new();
                        if let Some(pos) = html.find(marker) {
                            // 跳过变量名，找到第一个 [
                            if let Some(bracket_offset) = html[pos..].find('[') {
                                let after_bracket = &html[pos + bracket_offset + 1..];
                                let items: Vec<&str> = after_bracket.splitn(3, ',').collect();
                                if items.len() >= 2 {
                                    key_str = items[0].trim().to_string();
                                    token_str = items[1].trim().trim_matches('"').to_string();
                                }
                            }
                        }
                        (key_str, token_str)
                    };

                    if let (Some(ig_str), false, false) = (ig, key.is_empty(), token.is_empty()) {
                        let url = format!(
                            "https://cn.bing.com/ttranslatev3?isVertical=1&IG={}&IID=translator.5020.1",
                            ig_str
                        );
                        let form_data = [
                            ("text", orig.as_str()),
                            ("fromLang", bing_from),
                            ("to", to_l.as_str()),
                            ("token", token.as_str()),
                            ("key", key.as_str()),
                        ];
                        let trans_req = c
                            .post(&url)
                            .header("Referer", "https://cn.bing.com/translator")
                            .header(
                                "User-Agent",
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                            )
                            .form(&form_data);
                        if let Ok(Ok(trans_res)) = tokio::time::timeout(Duration::from_millis(4000), trans_req.send()).await {
                            if trans_res.status().is_success() {
                                if let Ok(json) = trans_res.json::<serde_json::Value>().await {
                                    if let Some(text) = json
                                        .get(0)
                                        .and_then(|item| item.get("translations"))
                                        .and_then(|t| t.get(0))
                                        .and_then(|t| t.get("text"))
                                        .and_then(|s| s.as_str())
                                    {
                                        if is_valid_translation(&orig, text) {
                                            return Some(text.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    // 方案 C：国内直连 cn.bing.com/dict 词典接口（短语/术语 100% 极速直连）
    if q.split_whitespace().count() <= 6 {
        let c = client.clone();
        let orig = q.to_string();
        futures.push(tokio::spawn(async move {
            let dict_url = format!(
                "https://cn.bing.com/dict/SerpHoverTrans?q={}",
                urlencoding_encode(&orig)
            );
            let req = c
                .get(&dict_url)
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                )
                .header("Referer", "https://cn.bing.com/dict/");
            if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(2000), req.send()).await {
                if res.status().is_success() {
                    if let Ok(html) = res.text().await {
                        if let Some(start_pos) = html.find("class=\"p1-") {
                            if let Some(tag_end) = html[start_pos..].find('>') {
                                let content_start = start_pos + tag_end + 1;
                                if let Some(end_tag) = html[content_start..].find("</span>") {
                                    let candidate = html[content_start..content_start + end_tag].trim();
                                    if is_valid_translation(&orig, candidate) {
                                        return Some(candidate.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    while let Some(joined) = futures.next().await {
        if let Ok(Some(translated)) = joined {
            return Some(translated);
        }
    }

    None
}

/// ── 网易有道翻译 ────────────────────────────────────────────────────────────
pub async fn translate_youdao(client: &Client, q: &str, _src: &str, _tgt: &str) -> Option<String> {
    // 方案 A: 经典 JSON 接口
    let url = format!("http://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i={}", urlencoding_encode(q));
    let req = client.get(&url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(3500), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(outer_arr) = json.get("translateResult").and_then(|v| v.as_array()) {
                    let mut full_text = String::new();
                    for inner in outer_arr {
                        if let Some(items) = inner.as_array() {
                            for item in items {
                                if let Some(tgt) = item.get("tgt").and_then(|s| s.as_str()) {
                                    full_text.push_str(tgt);
                                }
                            }
                        }
                    }
                    if is_valid_translation(q, &full_text) {
                        return Some(full_text);
                    }
                }
            }
        }
    }

    // 方案 B: 移动端网页接口
    let form_data = [("inputtext", q), ("type", "AUTO")];
    let req2 = client.post("https://m.youdao.com/translate").form(&form_data);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(3500), req2.send()).await {
        if res.status().is_success() {
            if let Ok(html) = res.text().await {
                if let Some(pos) = html.find("translateResult") {
                    if let Some(li_start) = html[pos..].find("<li>") {
                        let content_start = pos + li_start + 4;
                        if let Some(li_end) = html[content_start..].find("</li>") {
                            let trans = html[content_start..content_start + li_end].trim();
                            if is_valid_translation(q, trans) {
                                return Some(trans.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// ── 百度通用翻译 (官方开放平台 API，MD5 签名，国内直连 100% 稳定) ───────────────────────────
/// 免费注册地址：https://fanyi-api.baidu.com/  每月 100 万字符免费额度
pub async fn translate_baidu(
    client: &Client,
    q: &str,
    src: &str,
    tgt: &str,
    app_id: Option<&str>,
    secret: Option<&str>,
) -> MultiEngineTranslation {
    let engine_name = "百度通用翻译".to_string();

    let app_id = match app_id {
        Some(id) if !id.trim().is_empty() => id.trim(),
        _ => {
            return MultiEngineTranslation {
                engine_name,
                translated: "[未配置百度 AppID/密钥 · 点击前往设置]".to_string(),
                source_tier: "Baidu (Config Required)".to_string(),
            };
        }
    };
    let secret = match secret {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => {
            return MultiEngineTranslation {
                engine_name,
                translated: "[未配置百度 AppID/密钥 · 点击前往设置]".to_string(),
                source_tier: "Baidu (Config Required)".to_string(),
            };
        }
    };

    let clean_from = map_baidu_lang(src);
    let clean_to = map_baidu_lang(tgt);

    // MD5 签名：md5(appid + q + salt + secret)
    let salt = "1435660288";
    let sign_input = format!("{}{}{}{}", app_id, q, salt, secret);
    let sign = format!("{:x}", md5::compute(sign_input.as_bytes()));

    let form = [
        ("q", q),
        ("from", clean_from),
        ("to", clean_to),
        ("appid", app_id),
        ("salt", salt),
        ("sign", sign.as_str()),
    ];

    if let Ok(Ok(res)) = tokio::time::timeout(
        Duration::from_millis(5000),
        client
            .post("https://fanyi-api.baidu.com/api/trans/vip/translate")
            .form(&form)
            .send(),
    )
    .await
    {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(trans_result) = json.get("trans_result").and_then(|r| r.as_array()) {
                    let full: String = trans_result
                        .iter()
                        .filter_map(|item| item.get("dst").and_then(|s| s.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n");
                    if is_valid_translation(q, &full) {
                        return MultiEngineTranslation {
                            engine_name,
                            translated: full,
                            source_tier: "Online Fallback".to_string(),
                        };
                    }
                }
                // 鉴权或配额错误
                if let Some(err_code) = json.get("error_code").and_then(|c| c.as_str()) {
                    let msg = match err_code {
                        "52003" | "52001" => "[百度 AppID 无效或未授权 · 请检查设置]".to_string(),
                        "54004" | "54001" => "[百度 API 密钥错误 · 请检查设置]".to_string(),
                        "54005" => "[百度 API 频率超限 · 请稍后重试]".to_string(),
                        _ => format!("[百度 API 错误 (code {}) · 请检查配置]", err_code),
                    };
                    return MultiEngineTranslation {
                        engine_name,
                        translated: msg,
                        source_tier: "Baidu (Auth Error)".to_string(),
                    };
                }
            }
        }
    }

    MultiEngineTranslation {
        engine_name,
        translated: "[百度 API 请求失败 / 点击重试]".to_string(),
        source_tier: "Online (Retry)".to_string(),
    }
}

/// ── MyMemory 全球翻译记忆库 ────────────────────────────────────────────────
pub async fn translate_mymemory(client: &Client, q: &str, src: &str, tgt: &str) -> Option<String> {
    let clean_src = map_mymemory_lang(src);
    let clean_tgt = map_mymemory_lang(tgt);
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}|{}",
        urlencoding_encode(q),
        clean_src,
        clean_tgt
    );
    let req = client.get(&url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(4000), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(text) = json
                    .get("responseData")
                    .and_then(|d| d.get("translatedText"))
                    .and_then(|s| s.as_str())
                {
                    if is_valid_translation(q, text) && text != q {
                        return Some(text.to_string());
                    }
                }
            }
        }
    }
    None
}

/// ── DeepL 翻译 (官方免费 API 或自定义 DeepLX 自建服务，彻底告别失效公共节点) ──────────────
/// 官方免费 API 注册：https://www.deepl.com/pro-api  每月 50 万字符免费额度
/// 自定义 DeepLX 地址示例：http://localhost:1188/translate
pub async fn translate_deepl(
    client: &Client,
    q: &str,
    src: &str,
    tgt: &str,
    api_key: Option<&str>,
    custom_url: Option<&str>,
) -> MultiEngineTranslation {
    let engine_name = "DeepL 极速通道".to_string();
    let clean_src = map_deepl_source_lang(src);
    let clean_tgt = map_deepl_target_lang(tgt);

    // 优先走用户自建 DeepLX 服务
    if let Some(url) = custom_url {
        if !url.trim().is_empty() {
            let body = serde_json::json!({
                "text": q,
                "source_lang": clean_src,
                "target_lang": clean_tgt
            });
            if let Ok(Ok(res)) = tokio::time::timeout(
                Duration::from_millis(5000),
                client
                    .post(url.trim())
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send(),
            )
            .await
            {
                if res.status().is_success() {
                    if let Ok(json) = res.json::<serde_json::Value>().await {
                        let candidate = json
                            .get("data")
                            .or_else(|| json.get("target_text"))
                            .or_else(|| json.get("translation"))
                            .or_else(|| json.get("translatedText"))
                            .and_then(|s| s.as_str());
                        if let Some(trans) = candidate {
                            if is_valid_translation(q, trans) {
                                return MultiEngineTranslation {
                                    engine_name,
                                    translated: trans.to_string(),
                                    source_tier: "Online Fallback".to_string(),
                                };
                            }
                        }
                    }
                }
            }
            return MultiEngineTranslation {
                engine_name,
                translated: "[自定义 DeepLX 服务请求失败 / 点击重试]".to_string(),
                source_tier: "Online (Retry)".to_string(),
            };
        }
    }

    // 官方免费 API（需用户提供 API Key）
    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            let form = [
                ("text", q),
                ("target_lang", clean_tgt.as_str()),
            ];
            if let Ok(Ok(res)) = tokio::time::timeout(
                Duration::from_millis(5000),
                client
                    .post("https://api-free.deepl.com/v2/translate")
                    .header("Authorization", format!("DeepL-Auth-Key {}", key.trim()))
                    .form(&form)
                    .send(),
            )
            .await
            {
                let status = res.status();
                if status.is_success() {
                    if let Ok(json) = res.json::<serde_json::Value>().await {
                        if let Some(trans) = json
                            .get("translations")
                            .and_then(|t| t.as_array())
                            .and_then(|a| a.first())
                            .and_then(|t| t.get("text"))
                            .and_then(|s| s.as_str())
                        {
                            if is_valid_translation(q, trans) {
                                return MultiEngineTranslation {
                                    engine_name,
                                    translated: trans.to_string(),
                                    source_tier: "Online Fallback".to_string(),
                                };
                            }
                        }
                    }
                } else if status.as_u16() == 403 || status.as_u16() == 401 {
                    return MultiEngineTranslation {
                        engine_name,
                        translated: "[DeepL API Key 无效或已过期 · 请检查设置]".to_string(),
                        source_tier: "DeepL (Auth Error)".to_string(),
                    };
                } else if status.as_u16() == 429 || status.as_u16() == 456 {
                    return MultiEngineTranslation {
                        engine_name,
                        translated: "[DeepL 配额已用尽 · 请检查账户额度]".to_string(),
                        source_tier: "DeepL (Quota Error)".to_string(),
                    };
                }
            }
            return MultiEngineTranslation {
                engine_name,
                translated: "[DeepL 官方 API 请求失败 / 点击重试]".to_string(),
                source_tier: "Online (Retry)".to_string(),
            };
        }
    }

    // 均未配置
    MultiEngineTranslation {
        engine_name,
        translated: "[未配置 DeepL API Key 或自建地址 · 点击前往设置]".to_string(),
        source_tier: "DeepL (Config Required)".to_string(),
    }
}

/// ── 腾讯交互翻译 ────────────────────────────────────────────────────────────
pub async fn translate_tencent(client: &Client, q: &str, _src: &str, tgt: &str) -> Option<String> {
    let clean_tgt = if tgt.starts_with("zh") { "zh" } else { "en" };
    let body = serde_json::json!({
        "header": {
            "fn": "auto_translation",
            "client_key": "browser-chrome-124.0.0.0"
        },
        "type": "plain",
        "model_category": "normal",
        "source": {
            "lang": "auto",
            "text_list": [q]
        },
        "target": { "lang": clean_tgt }
    });
    let req = client
        .post("https://transmart.qq.com/api/imt")
        .header("Content-Type", "application/json")
        .json(&body);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(4000), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(trans) = json
                    .get("auto_translation")
                    .and_then(|a| a.get(0))
                    .and_then(|s| s.as_str())
                {
                    if is_valid_translation(q, trans) {
                        return Some(trans.to_string());
                    }
                }
            }
        }
    }
    None
}

/// ── AI 深度翻译 (精细化状态区分: 真实译文 / 未配置 Key / 鉴权失败 / 配额不足 / 连接超时) ──────
pub async fn translate_with_llm(
    client: &Client,
    q: &str,
    target_lang: &str,
    config: &LlmConfig,
    style: Option<&str>,
) -> MultiEngineTranslation {
    let provider = if config.provider.trim().is_empty() {
        "LLM".to_string()
    } else {
        config.provider.trim().to_string()
    };
    let engine_name = format!("🤖 AI 深度翻译 ({})", provider);

    let raw_ep = config.endpoint.trim().to_string();
    let api_key = config.api_key.trim().to_string();
    let is_local = raw_ep.contains("localhost") || raw_ep.contains("127.0.0.1");

    // 精细化状态区分 1: 未配置 API Key（严禁伪报“网络连接超时”）
    if raw_ep.is_empty() || (api_key.is_empty() && !is_local) {
        return MultiEngineTranslation {
            engine_name,
            translated: "[未配置 API Key · 点击前往设置]".to_string(),
            source_tier: "LLM (Config Required)".to_string(),
        };
    }

    let model_name = if config.model.trim().is_empty() {
        "deepseek-chat".to_string()
    } else {
        config.model.trim().to_string()
    };

    let is_google_gemini = raw_ep.contains("google")
        || raw_ep.contains("gemini")
        || raw_ep.contains("googleapis.com")
        || raw_ep.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    let (base_path, query_str) = match raw_ep.find('?') {
        Some(pos) => (&raw_ep[..pos], Some(&raw_ep[pos + 1..])),
        None => (raw_ep.as_str(), None),
    };

    let clean_base = base_path.trim_end_matches('/').to_string();

    let mut candidate_urls = Vec::new();
    if raw_ep.contains("/chat/completions") || raw_ep.contains(":generateContent") {
        candidate_urls.push(raw_ep.clone());
    }

    if is_google_gemini {
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

        candidate_urls.push(format!("{}/v1beta/openai/chat/completions", root));
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

    let mut seen = std::collections::HashSet::new();
    candidate_urls.retain(|url| seen.insert(url.clone()));

    let target_display = get_target_lang_display_name(target_lang);
    let prompt = format!(
        "You are a professional, accurate translator. Translate the following text into {}. Preserve formatting, code, numbers, and technical terms accurately. Return ONLY the translated text without explanations.{}\n\n{}",
        target_display, style_directive(style), q
    );

    let mut last_status_code = 0;

    for target_url in candidate_urls {
        let mut final_url = target_url.clone();
        if let Some(qs) = query_str {
            if !qs.is_empty() {
                if final_url.contains('?') {
                    final_url = format!("{}&{}", final_url, qs);
                } else {
                    final_url = format!("{}?{}", final_url, qs);
                }
            }
        }

        if is_google_gemini && !api_key.is_empty() && !final_url.contains("key=") {
            if final_url.contains('?') {
                final_url = format!("{}&key={}", final_url, api_key);
            } else {
                final_url = format!("{}?key={}", final_url, api_key);
            }
        }

        let mut req = client.post(&final_url);
        if !api_key.is_empty() {
            if is_google_gemini {
                req = req
                    .header("x-goog-api-key", &api_key)
                    .header("api-key", &api_key);
                if !api_key.starts_with("AIza") {
                    req = req.header("Authorization", format!("Bearer {}", api_key));
                }
            } else {
                req = req
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("api-key", &api_key);
            }
        }

        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = if is_native_gemini_endpoint {
            serde_json::json!({
                "contents": [
                    {
                        "role": "user",
                        "parts": [{ "text": prompt }]
                    }
                ]
            })
        } else {
            serde_json::json!({
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3
            })
        };

        if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(8000), req.json(&body).send()).await {
            let status = res.status();
            last_status_code = status.as_u16();

            if status.is_success() {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    // Extract OpenAI format reply
                    if let Some(content) = json
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|arr| arr.get(0))
                        .and_then(|first| first.get("message"))
                        .and_then(|msg| msg.get("content"))
                        .and_then(|val| val.as_str())
                    {
                        if !content.trim().is_empty() {
                            return MultiEngineTranslation {
                                engine_name,
                                translated: content.trim().to_string(),
                                source_tier: "LLM API".to_string(),
                            };
                        }
                    }

                    // Extract Gemini format reply
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
                            return MultiEngineTranslation {
                                engine_name,
                                translated: text.trim().to_string(),
                                source_tier: "LLM API".to_string(),
                            };
                        }
                    }

                    // Extract Ollama response
                    if let Some(res_str) = json.get("response").and_then(|v| v.as_str()) {
                        if !res_str.trim().is_empty() {
                            return MultiEngineTranslation {
                                engine_name,
                                translated: res_str.trim().to_string(),
                                source_tier: "LLM API".to_string(),
                            };
                        }
                    }
                }
            } else if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return MultiEngineTranslation {
                    engine_name,
                    translated: "[API Key 无效或已过期 · 点击检查设置]".to_string(),
                    source_tier: "LLM (Auth Error)".to_string(),
                };
            } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::PAYMENT_REQUIRED {
                return MultiEngineTranslation {
                    engine_name,
                    translated: "[API 额度不足或被限流 · 请检查账户配额]".to_string(),
                    source_tier: "LLM (Quota Error)".to_string(),
                };
            }
        }
    }

    if last_status_code == 401 || last_status_code == 403 {
        MultiEngineTranslation {
            engine_name,
            translated: "[API Key 无效或已过期 · 点击检查设置]".to_string(),
            source_tier: "LLM (Auth Error)".to_string(),
        }
    } else if last_status_code == 429 || last_status_code == 402 {
        MultiEngineTranslation {
            engine_name,
            translated: "[API 额度不足或被限流 · 请检查账户配额]".to_string(),
            source_tier: "LLM (Quota Error)".to_string(),
        }
    } else {
        MultiEngineTranslation {
            engine_name,
            translated: "[网络连接超时 / 点击重试]".to_string(),
            source_tier: "Online (Retry)".to_string(),
        }
    }
}

pub fn is_retry_status(engine: &MultiEngineTranslation) -> bool {
    engine.source_tier == "Online (Retry)"
        || engine.source_tier == "LLM (Config Required)"
        || engine.source_tier == "LLM (Auth Error)"
        || engine.source_tier == "LLM (Quota Error)"
        || engine.translated.contains("点击重试")
        || engine.translated.contains("网络连接超时")
        || engine.translated.contains("未配置 API Key")
        || engine.translated.contains("API Key 无效")
        || engine.translated.contains("额度不足")
}

pub fn is_retry_translation(text: &str) -> bool {
    text.contains("点击重试")
        || text.contains("网络连接超时")
        || text.contains("未配置 API Key")
        || text.contains("API Key 无效")
        || text.contains("额度不足")
}

pub async fn execute_universal_translate(
    req: UniversalTranslationRequest,
) -> Result<UniversalTranslationResponse, String> {
    let trimmed = req.text.trim();
    if trimmed.is_empty() {
        return Ok(UniversalTranslationResponse {
            original: String::new(),
            detected_lang: "en".to_string(),
            main_translation: String::new(),
            engines: vec![],
        });
    }

    let client = create_http_client(5000);

    // 智能双向语种检测
    let has_chinese = trimmed
        .chars()
        .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
    let detected_source = if has_chinese { "zh-CN" } else { "en" };

    let actual_source = if req.source_lang == "auto" {
        detected_source
    } else {
        req.source_lang.as_str()
    };

    let mut actual_target = if req.target_lang == "auto" {
        if actual_source.starts_with("zh") {
            "en"
        } else {
            "zh-CN"
        }
    } else {
        req.target_lang.as_str()
    };

    // 智能同语种防呆：如输入中文而目标也是中文，自动调整为英译；反之亦然
    if (actual_source.starts_with("zh") && actual_target.starts_with("zh"))
        || (actual_source.starts_with("en") && actual_target.starts_with("en"))
    {
        if actual_source.starts_with("zh") {
            actual_target = "en";
        } else {
            actual_target = "zh-CN";
        }
    }

    let forced = req.forced_engine.as_deref().map(|s| s.trim().to_lowercase());
    let is_forced = forced.as_ref().map_or(false, |f| !f.is_empty() && f != "auto");

    let mut engines = Vec::new();

    // 1. 本地离线词典
    let preset = req.preset.as_deref().unwrap_or("blender");
    let dicts_opt = req.preset_dicts.as_ref();
    let is_dict_forced = forced.as_ref().map_or(false, |f| {
        ["blender", "substance", "unity", "unreal", "maya", "houdini", "dict", "preset"].iter().any(|k| f.contains(k))
    });

    if is_dict_forced || (dicts_opt.map_or(true, |dicts| dicts.blender || dicts.substance || dicts.unity || dicts.unreal || dicts.maya || dicts.houdini) && trimmed.split_whitespace().count() <= 8) {
        static PIPELINE: OnceLock<MultiTierPipeline> = OnceLock::new();
        let pipeline = PIPELINE.get_or_init(MultiTierPipeline::new);
        let target_preset = if is_dict_forced {
            forced.as_deref().unwrap_or(preset)
        } else {
            preset
        };
        if let Some((translated, tier)) = pipeline.lookup_dict(trimmed, target_preset) {
            let is_match_enabled = if is_dict_forced {
                true
            } else if let Some(dicts) = dicts_opt {
                match tier.as_str() {
                    "blender" => dicts.blender,
                    "substance" => dicts.substance,
                    "unity" => dicts.unity,
                    "unreal" => dicts.unreal,
                    "maya" => dicts.maya,
                    "houdini" => dicts.houdini,
                    _ => true,
                }
            } else {
                true
            };
            if is_match_enabled {
                engines.push(MultiEngineTranslation {
                    engine_name: format!("本地专业词库 ({})", tier),
                    translated,
                    source_tier: "Preset Dictionary".to_string(),
                });
            }
        }
    }

    // 1.5 离线通用词库（真实文件系统安装状态，安装后参与多源对照）
    let is_offline_forced = forced.as_ref().map_or(false, |f| f.contains("offline") || f.contains("离线"));
    if is_offline_forced || crate::offline::status().installed {
        if let Some(translated) = crate::offline::translate_offline(trimmed) {
            engines.push(MultiEngineTranslation {
                engine_name: "离线词库 (内置引擎)".to_string(),
                translated,
                source_tier: "Offline Dict".to_string(),
            });
        }
    }

    // 2. 并行请求所有开启的在线引擎 (Google, Bing, Youdao, DeepL, MyMemory, Baidu, Tencent)
    let online = req.online_engines.clone().unwrap_or_default();
    let mut tasks = Vec::new();

    // ── 1. Google 翻译 (官方通道) ─────────────────────────────────────────────
    let run_google = forced.as_ref().map_or(false, |f| f.contains("google") || f.contains("谷歌"))
        || (!is_forced && online.google.unwrap_or(true));
    if run_google {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_google(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "Google 翻译 (官方通道)".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "Google 翻译 (官方通道)".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 2. 微软 Bing 必应翻译 ──────────────────────────────────────────────────
    let run_bing = forced.as_ref().map_or(false, |f| f.contains("bing") || f.contains("必应"))
        || (!is_forced && online.bing.unwrap_or(true));
    if run_bing {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_bing(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "微软 Bing 翻译".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "微软 Bing 翻译".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 3. 网易有道翻译 ────────────────────────────────────────────────────────
    let run_youdao = forced.as_ref().map_or(false, |f| f.contains("youdao") || f.contains("有道"))
        || (!is_forced && online.youdao.unwrap_or(true));
    if run_youdao {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_youdao(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "网易有道翻译".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "网易有道翻译".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 4. 百度通用翻译 ────────────────────────────────────────────────────────
    let is_baidu_configured = req
        .baidu_app_id
        .as_deref()
        .map_or(false, |id| !id.trim().is_empty())
        && req
            .baidu_secret
            .as_deref()
            .map_or(false, |s| !s.trim().is_empty());
    let run_baidu = forced.as_ref().map_or(false, |f| f.contains("baidu") || f.contains("百度"))
        || (!is_forced && (online.baidu.unwrap_or(false) || online.baidu == Some(true)) && is_baidu_configured);
    if run_baidu {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        let app_id = req.baidu_app_id.clone();
        let secret = req.baidu_secret.clone();
        tasks.push(tokio::spawn(async move {
            translate_baidu(&c, &q, &src, &tgt, app_id.as_deref(), secret.as_deref()).await
        }));
    }

    // ── 5. MyMemory 全球翻译记忆库 ────────────────────────────────────────────
    let run_mymemory = forced.as_ref().map_or(false, |f| f.contains("mymemory") || f.contains("my_memory") || f.contains("记忆库"))
        || (!is_forced && (online.my_memory.unwrap_or(false) || online.my_memory == Some(true)));
    if run_mymemory {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_mymemory(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "MyMemory 翻译记忆库".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "MyMemory 翻译记忆库".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 6. DeepL 翻译通道 ──────────────────────────────────────────────────
    let is_deepl_configured = req
        .deepl_api_key
        .as_deref()
        .map_or(false, |k| !k.trim().is_empty())
        || req
            .deepl_custom_url
            .as_deref()
            .map_or(false, |u| !u.trim().is_empty());
    let run_deepl = forced.as_ref().map_or(false, |f| f.contains("deepl"))
        || (!is_forced && (online.deepl.unwrap_or(false) || online.deepl == Some(true)) && is_deepl_configured);
    if run_deepl {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        let api_key = req.deepl_api_key.clone();
        let custom_url = req.deepl_custom_url.clone();
        tasks.push(tokio::spawn(async move {
            translate_deepl(&c, &q, &src, &tgt, api_key.as_deref(), custom_url.as_deref()).await
        }));
    }

    // ── 7. 腾讯交互翻译 ────────────────────────────────────────────────────────
    let run_tencent = forced.as_ref().map_or(false, |f| f.contains("tencent") || f.contains("腾讯"))
        || (!is_forced && (online.tencent.unwrap_or(false) || online.tencent == Some(true)));
    if run_tencent {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_tencent(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "腾讯交互翻译".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "腾讯交互翻译".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 8. AI 深度翻译 (DeepSeek / LLM) ────────────────────────────────────────
    let is_llm_configured = req.llm_config.as_ref().map_or(false, |cfg| {
        let ep = cfg.endpoint.trim();
        let is_local = ep.contains("localhost") || ep.contains("127.0.0.1");
        !ep.is_empty() && (!cfg.api_key.trim().is_empty() || is_local)
    });
    let run_llm = forced.as_ref().map_or(false, |f| {
        f.contains("llm") || f.contains("ai") || f.contains("deepseek") || f.contains("openai") || f.contains("ollama") || f.contains("glm") || f.contains("custom")
    }) || (!is_forced && is_llm_configured);

    if run_llm {
        if let Some(config) = &req.llm_config {
            let c = client.clone();
            let q = trimmed.to_string();
            let tgt = actual_target.to_string();
            let llm_cfg = config.clone();
            let style = req.style.clone();

            tasks.push(tokio::spawn(async move {
                translate_with_llm(&c, &q, &tgt, &llm_cfg, style.as_deref()).await
            }));
        }
    }

    // 等待所有并发网络任务完成（必定收集所有已开启引擎，不丢弃任何卡片）
    for task in tasks {
        if let Ok(item) = task.await {
            engines.push(item);
        }
    }

    // 优先保证有效 AI 大模型翻译 (LLM API) 排在最前，其次词库、其他有效在线翻译，待配置/鉴权错误/重试项排在最后
    engines.sort_by_key(|e| {
        if e.source_tier == "LLM API" && !is_retry_status(e) {
            0
        } else if (e.source_tier == "Preset Dictionary" || e.source_tier == "Offline Dict") && !is_retry_status(e) {
            1
        } else if !is_retry_status(e) {
            2
        } else if e.source_tier == "LLM (Config Required)" || e.source_tier == "LLM (Auth Error)" || e.source_tier == "LLM (Quota Error)" {
            3
        } else {
            4
        }
    });

    let mut main_translation = String::new();

    // 如果传入 forced_engine，精准查找匹配引擎作为 main_translation 产物
    if let Some(target) = forced.as_ref() {
        if !target.is_empty() && target != "auto" {
            let matched_idx = engines.iter().position(|e| {
                let name = e.engine_name.to_lowercase();
                let tier = e.source_tier.to_lowercase();
                name.contains(target)
                    || tier.contains(target)
                    || (target == "dict" && tier.contains("preset"))
                    || (target == "llm" && (tier.contains("llm") || name.contains("ai")))
                    || (target == "openai" && (name.contains("openai") || tier.contains("llm")))
                    || (target == "deepseek" && (name.contains("deepseek") || tier.contains("llm")))
                    || (target == "ollama" && (name.contains("ollama") || tier.contains("llm")))
                    || (target == "glm" && (name.contains("glm") || tier.contains("llm")))
                    || (target == "custom" && (name.contains("custom") || tier.contains("llm")))
            });

            if let Some(idx) = matched_idx {
                main_translation = engines[idx].translated.clone();
                let item = engines.remove(idx);
                engines.insert(0, item);
            }
        }
    }

    // 确定综合优选 main_translation（智能优先挑选首个有效且非重试/非错误态的翻译结果）
    if main_translation.is_empty() || is_retry_translation(&main_translation) {
        let tiers = req.translation_tiers.unwrap_or_else(|| {
            vec![
                "Preset Dictionary".to_string(),
                "LLM API".to_string(),
                "Online Fallback".to_string(),
            ]
        });

        for tier in &tiers {
            if let Some(matched) = engines.iter().find(|e| &e.source_tier == tier && !is_retry_status(e)) {
                main_translation = matched.translated.clone();
                break;
            }
        }
    }

    if main_translation.is_empty() || is_retry_translation(&main_translation) {
        if let Some(valid_engine) = engines.iter().find(|e| !is_retry_status(e)) {
            main_translation = valid_engine.translated.clone();
        }
    }

    if main_translation.is_empty() && !engines.is_empty() {
        main_translation = engines[0].translated.clone();
    }

    if main_translation.is_empty() && engines.is_empty() {
        main_translation =
            "⚠️ 未开启任何翻译源或网络未连接，请在「系统设置」中开启本地词库或在线翻译引擎。"
                .to_string();
    }

    Ok(UniversalTranslationResponse {
        original: trimmed.to_string(),
        detected_lang: actual_source.to_string(),
        main_translation,
        engines,
    })
}

/// Free-function online fallback (Google GTX → Bing Edge → DeepL → Baidu → MyMemory) so it can run inside
/// spawned tasks with a cloned reqwest::Client instead of borrowing the pipeline.
pub async fn translate_online_fallback_with(
    client: &Client,
    phrase: &str,
) -> Result<String, String> {
    let has_chinese = phrase
        .chars()
        .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
    let target_lang = if has_chinese { "en" } else { "zh-CN" };
    let source_lang = if has_chinese { "zh-CN" } else { "auto" };

    // 1. Google GTX
    if let Some(trans) = translate_google(client, phrase, source_lang, target_lang).await {
        return Ok(trans);
    }

    // 2. Bing Edge (微软必应官方通道)
    if let Some(trans) = translate_bing(client, phrase, source_lang, target_lang).await {
        return Ok(trans);
    }

    // 3. DeepL（未配置则跳过，不在 fallback 中强制等待）
    {
        let result = translate_deepl(client, phrase, source_lang, target_lang, None, None).await;
        if result.source_tier == "Online Fallback" {
            return Ok(result.translated);
        }
    }

    // 4. Baidu（未配置则跳过）
    {
        let result = translate_baidu(client, phrase, source_lang, target_lang, None, None).await;
        if result.source_tier == "Online Fallback" {
            return Ok(result.translated);
        }
    }

    // 5. MyMemory Fallback
    if let Some(trans) = translate_mymemory(client, phrase, source_lang, target_lang).await {
        return Ok(trans);
    }

    Err("Online translation fallback failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_translation_normal() {
        assert!(is_valid_translation("Principled BSDF", "原理化 BSDF"));
        assert!(is_valid_translation("Roughness", "粗糙度"));
        assert!(is_valid_translation("Hello World", "你好世界"));
    }

    #[test]
    fn test_is_valid_translation_empty_and_whitespace() {
        assert!(!is_valid_translation("", ""));
        assert!(!is_valid_translation("test", ""));
        assert!(!is_valid_translation("test", "   \t\n  "));
        assert!(!is_valid_translation("   ", "test"));
    }

    #[test]
    fn test_is_valid_translation_deepl_risk_control_poisoning() {
        // DeepL linux.do 限流风控链接拦截
        assert!(!is_valid_translation("Principled BSDF", "https://linux.do/t/topic/111737"));
        assert!(!is_valid_translation("Roughness", "http://linux.do/t/12345"));
        assert!(!is_valid_translation("Normal", "https://t.me/deeplx_channel"));
        assert!(!is_valid_translation("Camera", "https://deeplx.vercel.app/error"));
        assert!(!is_valid_translation("Light", "www.linux.do"));
        // 如果原文本身就是合法 URL，则不拦截
        assert!(is_valid_translation("https://linux.do/t/topic/111737", "https://linux.do/t/topic/111737"));
    }

    #[test]
    fn test_is_valid_translation_html_errors() {
        assert!(!is_valid_translation("Principled BSDF", "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>"));
        assert!(!is_valid_translation("Principled BSDF", "<html><body><script>location.href='...'</script></body></html>"));
        assert!(!is_valid_translation("Roughness", "<div class=\"error\">Error 403 Forbidden</div>"));
    }

    #[test]
    fn test_is_valid_translation_json_errors() {
        assert!(!is_valid_translation("Principled BSDF", "{\"code\": 429, \"message\": \"Too Many Requests\"}"));
        assert!(!is_valid_translation("Roughness", "{\"error\": \"Rate limit exceeded\"}"));
        assert!(!is_valid_translation("Roughness", "{\"msg\": \"IP has been blocked\"}"));
    }

    #[test]
    fn test_is_valid_translation_rate_limit_keywords() {
        assert!(!is_valid_translation("Principled BSDF", "Too Many Requests"));
        assert!(!is_valid_translation("Roughness", "Rate limit exceeded, please try again later"));
        assert!(!is_valid_translation("Metallic", "请求过于频繁，请稍后再试"));
        assert!(!is_valid_translation("Normal", "IP has been blocked"));
        assert!(!is_valid_translation("Specular", "502 Bad Gateway"));
    }

    #[test]
    fn test_parse_proxy_to_url() {
        assert_eq!(parse_proxy_to_url("127.0.0.1:7890"), "http://127.0.0.1:7890");
        assert_eq!(parse_proxy_to_url("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
        assert_eq!(parse_proxy_to_url("socks5://127.0.0.1:1080"), "socks5://127.0.0.1:1080");
        assert_eq!(parse_proxy_to_url("http=127.0.0.1:7890;https=127.0.0.1:7890"), "http://127.0.0.1:7890");
        assert_eq!(parse_proxy_to_url("https=127.0.0.1:7890;http=127.0.0.1:7891"), "http://127.0.0.1:7890");
    }

    #[test]
    fn test_detect_windows_proxy_smoke() {
        // Smoke test ensuring detect_windows_proxy runs without panic
        let _ = detect_windows_proxy();
    }

    #[test]
    fn test_is_retry_status_and_translation_fine_grained() {
        let config_req_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "[未配置 API Key · 点击前往设置]".to_string(),
            source_tier: "LLM (Config Required)".to_string(),
        };
        assert!(is_retry_status(&config_req_engine));
        assert!(is_retry_translation(&config_req_engine.translated));

        let auth_err_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "[API Key 无效或已过期 · 点击检查设置]".to_string(),
            source_tier: "LLM (Auth Error)".to_string(),
        };
        assert!(is_retry_status(&auth_err_engine));
        assert!(is_retry_translation(&auth_err_engine.translated));

        let quota_err_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "[API 额度不足或被限流 · 请检查账户配额]".to_string(),
            source_tier: "LLM (Quota Error)".to_string(),
        };
        assert!(is_retry_status(&quota_err_engine));
        assert!(is_retry_translation(&quota_err_engine.translated));

        let valid_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "粗糙度".to_string(),
            source_tier: "LLM API".to_string(),
        };
        assert!(!is_retry_status(&valid_engine));
        assert!(!is_retry_translation(&valid_engine.translated));
    }

    #[tokio::test]
    async fn test_translate_with_llm_unconfigured_key_distinction() {
        let client = create_http_client(3000);
        let config = LlmConfig {
            id: Some("deepseek".to_string()),
            provider: "DeepSeek".to_string(),
            api_key: "".to_string(),
            model: "deepseek-chat".to_string(),
            endpoint: "https://api.deepseek.com/v1".to_string(),
        };

        let result = translate_with_llm(&client, "Roughness", "zh-CN", &config, None).await;
        assert_eq!(result.source_tier, "LLM (Config Required)");
        assert_eq!(result.translated, "[未配置 API Key · 点击前往设置]");
        assert_eq!(result.engine_name, "🤖 AI 深度翻译 (DeepSeek)");
    }

    #[tokio::test]
    async fn test_unconfigured_engines_omitted_in_universal_translate() {
        let req = crate::models::UniversalTranslationRequest {
            text: "Principled BSDF".to_string(),
            source_lang: "auto".to_string(),
            target_lang: "zh-CN".to_string(),
            preset: Some("blender".to_string()),
            llm_config: Some(LlmConfig {
                id: Some("deepseek".to_string()),
                provider: "DeepSeek".to_string(),
                api_key: "".to_string(),
                model: "deepseek-chat".to_string(),
                endpoint: "https://api.deepseek.com/v1".to_string(),
            }),
            preset_dicts: Some(crate::models::PresetDicts {
                blender: true,
                substance: true,
                unity: true,
                unreal: true,
                maya: true,
                houdini: true,
            }),
            online_engines: Some(crate::models::OnlineEngines {
                google: Some(false),
                bing: Some(false),
                youdao: Some(false),
                deepl: Some(true),
                my_memory: Some(false),
                baidu: Some(true),
                tencent: Some(false),
            }),
            translation_tiers: None,
            style: None,
            forced_engine: None,
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
        };

        let res = execute_universal_translate(req).await;
        assert!(res.is_ok());
        let resp = res.unwrap();
        // Since LLM, DeepL, and Baidu have no keys/credentials and are not forced,
        // none of them should appear in resp.engines!
        for eng in &resp.engines {
            assert!(!eng.engine_name.contains("DeepSeek"));
            assert!(!eng.engine_name.contains("DeepL"));
            assert!(!eng.engine_name.contains("百度"));
            assert!(!eng.translated.contains("未配置"));
        }
    }
}
