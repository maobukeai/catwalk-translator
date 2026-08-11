pub use crate::models::{
    LlmConfig, MultiEngineTranslation, TextQueryResponse, TranslationResult, WordDetail,
};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

static CG_DICTS: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();

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
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| Client::new());
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
        let mut results: Vec<Option<TranslationResult>> = vec![None; phrases.len()];
        let mut unmatched_indices: Vec<usize> = Vec::new();

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
                let llm_res = self.translate_via_llm(&unmatched_phrases, config).await;
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

        // Step 4: Tier 4 (Online Fallback API)
        let mut still_unmatched = Vec::new();
        for &idx in &unmatched_indices {
            let p = phrases[idx].trim();
            if let Ok(translated) = self.translate_via_online_fallback(p).await {
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
            "You are an expert translator. Translate the given Chinese text/terms into natural English. Return ONLY a valid JSON object mapping each original Chinese string to its English translation, without markdown formatting or extra text."
        } else {
            "You are an expert translator. Translate the given foreign/English text/terms into simplified Chinese. Return ONLY a valid JSON object mapping each original string to its simplified Chinese translation, without markdown formatting or extra text."
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
        let has_chinese = phrase
            .chars()
            .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
        let target_lang = if has_chinese { "en" } else { "zh-CN" };
        let source_lang = if has_chinese { "zh-CN" } else { "auto" };
        let encoded = urlencoding_encode(phrase);

        // 1. Google GTX
        let google_url = format!(
            "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
            source_lang, target_lang, encoded
        );

        let req = self.client.get(&google_url);
        if let Ok(Ok(response)) = tokio::time::timeout(Duration::from_secs(3), req.send()).await {
            if response.status().is_success() {
                if let Ok(json_res) = response.json::<serde_json::Value>().await {
                    if let Some(outer) = json_res.as_array() {
                        if let Some(first_group) = outer.first().and_then(|v| v.as_array()) {
                            let mut full_trans = String::new();
                            for sentence in first_group {
                                if let Some(trans_str) = sentence.get(0).and_then(|v| v.as_str()) {
                                    full_trans.push_str(trans_str);
                                }
                            }
                            if !full_trans.is_empty() {
                                return Ok(full_trans);
                            }
                        }
                    }
                }
            }
        }

        // 2. MyMemory Fallback (如 Google 超时/被墙)
        let langpair = if has_chinese { "zh-CN|en" } else { "en|zh-CN" };
        let mymemory_url = format!(
            "https://api.mymemory.translated.net/get?q={}&langpair={}",
            encoded, langpair
        );

        let req2 = self.client.get(&mymemory_url);
        if let Ok(Ok(resp2)) = tokio::time::timeout(Duration::from_secs(3), req2.send()).await {
            if resp2.status().is_success() {
                if let Ok(json2) = resp2.json::<serde_json::Value>().await {
                    if let Some(trans) = json2
                        .get("responseData")
                        .and_then(|d| d.get("translatedText"))
                        .and_then(|s| s.as_str())
                    {
                        if !trans.is_empty() && trans != phrase {
                            return Ok(trans.to_string());
                        }
                    }
                }
            }
        }

        Err("Online translation fallback failed".to_string())
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

    let client = Client::builder()
        .timeout(Duration::from_millis(5000))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| Client::new());

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

    let mut engines = Vec::new();

    // 1. 本地离线词典
    if let Some(dicts) = &req.preset_dicts {
        let is_any_dict_enabled = dicts.blender || dicts.substance || dicts.unity;
        if is_any_dict_enabled && trimmed.split_whitespace().count() <= 6 {
            static PIPELINE: OnceLock<MultiTierPipeline> = OnceLock::new();
            let pipeline = PIPELINE.get_or_init(MultiTierPipeline::new);
            let preset = req.preset.as_deref().unwrap_or("blender");
            if let Some((translated, tier)) = pipeline.lookup_dict(trimmed, preset) {
                let is_match_enabled = match tier.as_str() {
                    "blender" => dicts.blender,
                    "substance" => dicts.substance,
                    "unity" => dicts.unity,
                    _ => true,
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
    }

    // 2. 并行请求所有开启的在线引擎 (Google, Bing, Youdao, DeepL, MyMemory, Baidu, Tencent)
    let online = req.online_engines.unwrap_or_default();
    let mut tasks = Vec::new();

    // ── 1. Google 翻译 (官方通道) ─────────────────────────────────────────────
    if online.google.unwrap_or(true) {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            let clean_src = if src == "auto" { "auto" } else { src.split('-').next().unwrap_or("auto") };
            let clean_tgt = if tgt.starts_with("zh") { "zh-CN" } else { "en" };
            let url = format!(
                "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
                clean_src, clean_tgt, urlencoding_encode(&q)
            );
            if let Ok(res) = c.get(&url).send().await {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(arr) = json.as_array().and_then(|a| a.get(0)).and_then(|a| a.as_array()) {
                        let mut text = String::new();
                        for item in arr {
                            if let Some(s) = item.get(0).and_then(|v| v.as_str()) {
                                text.push_str(s);
                            }
                        }
                        if !text.is_empty() {
                            return Some(MultiEngineTranslation {
                                engine_name: "Google 翻译 (官方通道)".to_string(),
                                translated: text,
                                source_tier: "Online Fallback".to_string(),
                            });
                        }
                    }
                }
            }
            None
        }));
    }

    // ── 2. 微软 Bing 必应翻译 ──────────────────────────────────────────────────
    if online.bing.unwrap_or(true) {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            let from_lang = if src.starts_with("zh") { "zh-Hans" } else { "en" };
            let to_lang = if tgt.starts_with("zh") { "zh-Hans" } else { "en" };

            // 第一步：访问 Bing Translator 首页动态抓取 IG, Key, Token 签名
            if let Ok(home_res) = c.get("https://cn.bing.com/translator")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .send()
                .await
            {
                if let Ok(html) = home_res.text().await {
                    let ig = html.find("IG:\"").and_then(|pos| {
                        let part = &html[pos + 4..];
                        part.find('"').map(|end| part[..end].to_string())
                    });
                    let (key, token) = if let Some(pos) = html.find("params_AbusePreventionHelper = [") {
                        let part = &html[pos + 32..];
                        let items: Vec<&str> = part.split(',').collect();
                        if items.len() >= 2 {
                            (items[0].trim().to_string(), items[1].trim().trim_matches('"').to_string())
                        } else {
                            (String::new(), String::new())
                        }
                    } else {
                        (String::new(), String::new())
                    };

                    if let (Some(ig_str), false, false) = (ig, key.is_empty(), token.is_empty()) {
                        let url = format!("https://cn.bing.com/ttranslatev3?isVertical=1&IG={}&IID=translator.5020.1", ig_str);
                        let form_data = [
                            ("text", q.as_str()),
                            ("fromLang", from_lang),
                            ("to", to_lang),
                            ("token", token.as_str()),
                            ("key", key.as_str()),
                        ];
                        if let Ok(trans_res) = c.post(&url)
                            .header("Referer", "https://cn.bing.com/translator")
                            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                            .form(&form_data)
                            .send()
                            .await
                        {
                            if let Ok(json) = trans_res.json::<serde_json::Value>().await {
                                if let Some(text) = json.get(0)
                                    .and_then(|item| item.get("translations"))
                                    .and_then(|t| t.get(0))
                                    .and_then(|t| t.get("text"))
                                    .and_then(|s| s.as_str())
                                {
                                    if !text.is_empty() {
                                        return Some(MultiEngineTranslation {
                                            engine_name: "微软 Bing 翻译".to_string(),
                                            translated: text.to_string(),
                                            source_tier: "Online Fallback".to_string(),
                                        });
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

    // ── 3. 网易有道翻译 ────────────────────────────────────────────────────────
    if online.youdao.unwrap_or(true) {
        let c = client.clone();
        let q = trimmed.to_string();
        tasks.push(tokio::spawn(async move {
            let form_data = [("inputtext", q.as_str()), ("type", "AUTO")];
            if let Ok(res) = c
                .post("https://m.youdao.com/translate")
                .form(&form_data)
                .send()
                .await
            {
                if let Ok(html) = res.text().await {
                    if let Some(pos) = html.find("translateResult") {
                        if let Some(li_start) = html[pos..].find("<li>") {
                            let content_start = pos + li_start + 4;
                            if let Some(li_end) = html[content_start..].find("</li>") {
                                let trans = html[content_start..content_start + li_end].trim();
                                if !trans.is_empty() {
                                    return Some(MultiEngineTranslation {
                                        engine_name: "网易有道翻译".to_string(),
                                        translated: trans.to_string(),
                                        source_tier: "Online Fallback".to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    // ── 4. 百度通用翻译 ────────────────────────────────────────────────────────
    if online.baidu.unwrap_or(false) || online.baidu == Some(true) {
        let c = client.clone();
        let q = trimmed.to_string();
        tasks.push(tokio::spawn(async move {
            let form_data = [("kw", q.as_str())];
            if let Ok(res) = c
                .post("https://fanyi.baidu.com/sug")
                .form(&form_data)
                .send()
                .await
            {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
                        for item in data {
                            if let Some(v) = item.get("v").and_then(|s| s.as_str()) {
                                if !v.is_empty() {
                                    return Some(MultiEngineTranslation {
                                        engine_name: "百度通用翻译".to_string(),
                                        translated: v.to_string(),
                                        source_tier: "Online Fallback".to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    // ── 5. MyMemory 全球翻译记忆库 ────────────────────────────────────────────
    if online.my_memory.unwrap_or(false) || online.my_memory == Some(true) {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            let clean_src = if src.starts_with("zh") { "zh" } else { "en" };
            let clean_tgt = if tgt.starts_with("zh") { "zh" } else { "en" };
            let url = format!(
                "https://api.mymemory.translated.net/get?q={}&langpair={}|{}",
                urlencoding_encode(&q),
                clean_src,
                clean_tgt
            );
            if let Ok(res) = c.get(&url).send().await {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(text) = json
                        .get("responseData")
                        .and_then(|d| d.get("translatedText"))
                        .and_then(|s| s.as_str())
                    {
                        if !text.is_empty() {
                            return Some(MultiEngineTranslation {
                                engine_name: "MyMemory 翻译记忆库".to_string(),
                                translated: text.to_string(),
                                source_tier: "Online Fallback".to_string(),
                            });
                        }
                    }
                }
            }
            None
        }));
    }

    // ── 6. DeepL 极速翻译通道 ──────────────────────────────────────────────────
    if online.deepl.unwrap_or(false) || online.deepl == Some(true) {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            let clean_src = if src.starts_with("zh") { "zh" } else { "en" };
            let clean_tgt = if tgt.starts_with("zh") { "en" } else { "zh" };

            let url = format!(
                "https://translate.plausibility.cloud/translate?sl={}&tl={}&q={}",
                clean_src,
                clean_tgt,
                urlencoding_encode(&q)
            );
            if let Ok(res) = c.get(&url).send().await {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(trans) = json
                        .get("translation")
                        .or_else(|| json.get("translatedText"))
                        .and_then(|s| s.as_str())
                    {
                        if !trans.is_empty() {
                            return Some(MultiEngineTranslation {
                                engine_name: "DeepL 极速通道".to_string(),
                                translated: trans.to_string(),
                                source_tier: "Online Fallback".to_string(),
                            });
                        }
                    }
                }
            }
            None
        }));
    }

    // ── 7. 腾讯交互翻译 ────────────────────────────────────────────────────────
    if online.tencent.unwrap_or(false) || online.tencent == Some(true) {
        let c = client.clone();
        let q = trimmed.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
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
            if let Ok(res) = c
                .post("https://transmart.qq.com/api/imt")
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
            {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(trans) = json
                        .get("auto_translation")
                        .and_then(|a| a.get(0))
                        .and_then(|s| s.as_str())
                    {
                        if !trans.is_empty() {
                            return Some(MultiEngineTranslation {
                                engine_name: "腾讯交互翻译".to_string(),
                                translated: trans.to_string(),
                                source_tier: "Online Fallback".to_string(),
                            });
                        }
                    }
                }
            }
            None
        }));
    }

    pub async fn translate_with_llm(
        client: &Client,
        q: &str,
        target_lang: &str,
        config: &LlmConfig,
    ) -> Option<MultiEngineTranslation> {
        let raw_ep = config.endpoint.trim().to_string();
        if raw_ep.is_empty() {
            return None;
        }
        let api_key = config.api_key.trim().to_string();
        let is_local = raw_ep.contains("localhost") || raw_ep.contains("127.0.0.1");
        if api_key.is_empty() && !is_local {
            return None;
        }

        let model_name = if config.model.trim().is_empty() {
            "deepseek-chat".to_string()
        } else {
            config.model.trim().to_string()
        };
        let provider = if config.provider.trim().is_empty() {
            "LLM".to_string()
        } else {
            config.provider.trim().to_string()
        };

        let is_google_gemini = raw_ep.contains("google")
            || raw_ep.contains("gemini")
            || raw_ep.contains("google-ai-studio")
            || api_key.starts_with("AIza");

        let (base_path, query_str) = match raw_ep.find('?') {
            Some(pos) => (&raw_ep[..pos], Some(&raw_ep[pos + 1..])),
            None => (raw_ep.as_str(), None),
        };

        let mut clean_base = base_path.trim_end_matches('/').to_string();
        if clean_base.ends_with("/chat/completions") {
            clean_base = clean_base.replace("/chat/completions", "");
        }
        if clean_base.ends_with("/completions") {
            clean_base = clean_base.replace("/completions", "");
        }

        let mut candidate_urls = Vec::new();
        if raw_ep.contains("/chat/completions") || raw_ep.contains(":generateContent") {
            candidate_urls.push(raw_ep.clone());
        } else if is_google_gemini {
            candidate_urls.push(format!("{}/v1beta/openai/chat/completions", clean_base));
            candidate_urls.push(format!("{}/openai/chat/completions", clean_base));
            candidate_urls.push(format!(
                "{}/v1beta/models/{}:generateContent",
                clean_base, model_name
            ));
            candidate_urls.push(format!(
                "{}/models/{}:generateContent",
                clean_base, model_name
            ));
            if clean_base.ends_with("/v1") || clean_base.ends_with("/v1beta") {
                candidate_urls.push(format!("{}/chat/completions", clean_base));
            } else {
                candidate_urls.push(format!("{}/v1/chat/completions", clean_base));
                candidate_urls.push(format!("{}/chat/completions", clean_base));
            }
        } else {
            if clean_base.ends_with("/v1") {
                candidate_urls.push(format!("{}/chat/completions", clean_base));
            } else {
                candidate_urls.push(format!("{}/v1/chat/completions", clean_base));
                candidate_urls.push(format!("{}/chat/completions", clean_base));
            }
        }

        let prompt = format!(
        "You are a professional, accurate translator. Translate the following text into {}. Preserve formatting, code, numbers, and technical terms accurately. Return ONLY the translated text without explanations.\n\n{}",
        target_lang, q
    );

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

            if let Ok(res) = req.json(&body).send().await {
                if res.status().is_success() {
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
                                return Some(MultiEngineTranslation {
                                    engine_name: format!("🤖 AI 深度翻译 ({})", provider),
                                    translated: content.trim().to_string(),
                                    source_tier: "LLM API".to_string(),
                                });
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
                                return Some(MultiEngineTranslation {
                                    engine_name: format!("🤖 AI 深度翻译 ({})", provider),
                                    translated: text.trim().to_string(),
                                    source_tier: "LLM API".to_string(),
                                });
                            }
                        }

                        // Extract Ollama response
                        if let Some(res_str) = json.get("response").and_then(|v| v.as_str()) {
                            if !res_str.trim().is_empty() {
                                return Some(MultiEngineTranslation {
                                    engine_name: format!("🤖 AI 深度翻译 ({})", provider),
                                    translated: res_str.trim().to_string(),
                                    source_tier: "LLM API".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
        None
    }

    // LLM API
    if let Some(config) = &req.llm_config {
        let c = client.clone();
        let q = trimmed.to_string();
        let tgt = actual_target.to_string();
        let llm_cfg = config.clone();

        tasks.push(tokio::spawn(async move {
            translate_with_llm(&c, &q, &tgt, &llm_cfg).await
        }));
    }

    // 等待所有并发网络任务完成
    for task in tasks {
        if let Ok(Some(item)) = task.await {
            engines.push(item);
        }
    }

    // 优先保证 AI 大模型翻译 (LLM API) 排在所有引擎的第一位
    engines.sort_by_key(|e| if e.source_tier == "LLM API" { 0 } else { 1 });

    // 确定综合优选 main_translation
    let tiers = req.translation_tiers.unwrap_or_else(|| {
        vec![
            "Preset Dictionary".to_string(),
            "LLM API".to_string(),
            "Online Fallback".to_string(),
        ]
    });

    let mut main_translation = String::new();
    for tier in &tiers {
        if let Some(matched) = engines.iter().find(|e| &e.source_tier == tier) {
            main_translation = matched.translated.clone();
            break;
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
