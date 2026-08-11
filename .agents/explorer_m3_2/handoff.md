# Multi-Tier Translation Pipeline Design & Analysis Report (`app_v2/src-tauri/src/translator.rs`)

**Author**: `explorer_m3_2`  
**Date**: 2026-08-09  
**Target File**: `app_v2/src-tauri/src/translator.rs`  
**Milestone**: Milestone 3 — Multi-Tier Translation Pipeline & Dictionaries  

---

## 1. Observation

### 1.1 Source Code and Asset Inventory
Direct code inspection of the existing codebase (`app_v2/src-tauri/`) revealed the following relevant files:

- **`app_v2/src-tauri/src/translator.rs`** (Lines 1–109):
  - Currently contains `CgDictionaryEngine` with embedded JSON dictionaries loaded via `include_str!("../assets/dicts/blender.json")`, `substance.json`, and `unity.json`.
  - Implements lookup priority: Priority 1 checks target `preset`; Priority 2 iterates other dictionaries.
  - Trait `TranslatorEngine` with method `fn translate_batch(&self, phrases: &[String], preset: &str) -> Vec<TranslationResult>`.
  - Contains basic in-memory `TranslationCache` storing `HashMap<String, TranslationResult>`.
- **`app_v2/src-tauri/src/models.rs`** (Lines 37–50, 78–109):
  - Struct `LlmConfig`: `provider: String`, `api_key: String`, `model: String`, `endpoint: String`.
  - Struct `TranslationResult`: `original: String`, `translated: String`, `source_tier: String`.
  - Struct `AppSettings`: Includes `llm_config: Option<LlmConfig>`, `translation_tiers: Vec<String>`, `preset_dicts: PresetDicts`.
- **`app_v2/src-tauri/src/commands.rs`** (Lines 44–52):
  - IPC command `cmd_translate_phrases(phrases: Vec<String>, preset: String, _llm_config: Option<LlmConfig>) -> Result<Vec<TranslationResult>, String>`.
  - Currently instantiates `CgDictionaryEngine::new()` directly and calls `translate_batch`. LLM configuration is currently unused (`_llm_config`).
- **`app_v2/src-tauri/src/lib.rs`** (Lines 68–74):
  - Registers `cmd_translate_phrases` in Tauri's `invoke_handler!`.
- **`app_v2/src-tauri/Cargo.toml`** (Lines 20–26):
  - Dependencies currently installed: `tauri = { version = "2", features = ["tray-icon"] }`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`.
  - Async HTTP client `reqwest`, `tokio` full features, and `async-trait` are **not yet explicitly listed** in `Cargo.toml`.
- **Preset Dictionary Assets (`app_v2/src-tauri/assets/dicts/`)**:
  - `blender.json`: Term pairs such as `"Principled BSDF": "原理化 BSDF"`, `"Subsurface Scattering": "次表面散射"`, `"Roughness": "粗糙度"`, `"Metallic": "金属度"`, `"Normal Map": "法线贴图"`, `"Base Color": "基础色"`.
  - `substance.json`: Term pairs such as `"Height Range": "高度范围"`, `"AO Mixing Mode": "AO混合模式"`, `"Curvature Blur Radius": "曲率模糊半径"`, `"Subsurface": "次表面"`, `"Roughness": "粗糙度"`.
  - `unity.json`: Term pairs such as `"NavMesh Surface": "NavMesh 表面"`, `"RigidBody Interpolate": "刚体插值"`, `"Skinned Mesh Renderer Bounds": "蒙皮网格渲染器包围盒"`, `"Base Color": "基础颜色"`.

### 1.2 Verification Results
- Executed `cargo test --test tier1_feature_coverage` on `app_v2/src-tauri`:
  - **32 tests passed 100%** (`test_f4_01_preset_cg_dictionary_lookup`, `test_f4_02_llm_api_query_formatter`, `test_f4_05_translation_cache_store_retrieve`, `test_f4_06_batch_phrase_processing` all passed).

---

## 2. Logic Chain

### 2.1 4-Tier Pipeline Architecture Strategy
To achieve instantaneous lookup for known CG terms while providing high-quality LLM translation for complex phrases and zero-configuration online fallback, the pipeline is designed into 4 explicit tiers:

```
[ Input Phrases: Vec<String> ]
              │
              ▼
    ┌──────────────────┐
    │ Translation Cache│ ──(Cache Hit: instant return)──> [ Result ]
    └─────────┬────────┘
              │ (Cache Miss)
              ▼
    ┌──────────────────┐
    │ Tier 1: Preset   │ ──(Found in user selected dict, e.g. blender.json)──> [ Result: Tier 1 ]
    │ Dict (blender)   │
    └─────────┬────────┘
              │ (Not Found)
              ▼
    ┌──────────────────┐
    │ Tier 2: CG       │ ──(Found in other CG dicts, e.g. substance/unity)───> [ Result: Tier 2 ]
    │ Fallback Dict    │
    └─────────┬────────┘
              │ (Not Found)
              ▼
    ┌──────────────────┐
    │ Tier 3: LLM API  │ ──(DeepSeek / OpenAI / Ollama batch query OK)──────> [ Result: Tier 3 ]
    │ (Reqwest Async)  │
    └─────────┬────────┘
              │ (Unconfigured / Network Error / Timeout 3-5s / 429 / Parse Fail)
              ▼
    ┌──────────────────┐
    │ Tier 4: Online   │ ──(Google Translate / MyMemory API query OK)───────> [ Result: Tier 4 ]
    │ Fallback API     │
    └─────────┬────────┘
              │ (Network Failure / Timeout 3s)
              ▼
     [ Final Fallback: Original Phrase or Tagged String ]
```

#### Tier Breakdown Details:
1. **Tier 1: Preset Dictionary (User-Selected Dict)**:
   - Target: User's active CG software selection (e.g., `blender`, `substance`, `unity`).
   - Matching: Case-preserving exact key lookup in embedded `HashMap<String, String>`.
   - Latency: 0 ms (in-memory lookup).
   - Source Tier Label: `blender` / `substance` / `unity` (or `Preset Dict (blender)`).
2. **Tier 2: CG Fallback Dict (Merged CG Dictionary)**:
   - Target: All other enabled CG dictionaries in `assets/dicts/`.
   - Matching: Search remaining preset dictionaries if un-matched in Tier 1.
   - Purpose: Terms shared across CG software (e.g., `Roughness`, `Subsurface`, `Base Color`) are matched without hitting external network.
   - Latency: 0 ms.
   - Source Tier Label: `CG Fallback (substance)` / `CG Fallback (unity)`.
3. **Tier 3: LLM API Client**:
   - Supported Providers: DeepSeek (`https://api.deepseek.com/v1`), OpenAI (`https://api.openai.com/v1`), Ollama (`http://localhost:11434`), Custom Endpoints.
   - Mechanism: Async HTTP POST via `reqwest::Client` with a 3–5 second timeout (`tokio::time::timeout`).
   - Prompt Construction: Batches uncached, dictionary-unmatched phrases into a single structured JSON request to reduce roundtrips.
   - System Prompt: Instructs LLM to act as a 3D/CG translation engine and return key-value pairs in JSON format: `{"original_term": "中文翻译"}`.
   - Fallback Trigger: Triggers transition to Tier 4 if `llm_config` is `None`, API key is empty, HTTP status is non-200, response timeout occurs (>4s), or JSON parsing fails.
4. **Tier 4: Online Fallback API**:
   - Target: Free web translation API endpoints (e.g., Google Translate `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=...` or MyMemory `https://api.mymemory.translated.net/get?q=...&langpair=en|zh-CN`).
   - Mechanism: Async HTTP GET requests per remaining phrase with concurrent `tokio::spawn` or `futures::future::join_all`, bounded by a `Semaphore` (rate limiting).
   - Timeout: 3 seconds limit per request.
   - Latency: 200ms–800ms.
   - Source Tier Label: `Online Fallback (Google)` / `Online Fallback (MyMemory)`.

---

### 2.2 Exact Rust Structs & Enums Architecture

#### A. Core Request and Result Models
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tier priority classification enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationTier {
    PresetDict,
    CgFallbackDict,
    LlmApi,
    OnlineFallback,
}

impl TranslationTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PresetDict => "Preset Dictionary",
            Self::CgFallbackDict => "CG Fallback Dict",
            Self::LlmApi => "LLM API",
            Self::OnlineFallback => "Online Fallback",
        }
    }
}

/// LLM Provider classification
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApiProvider {
    DeepSeek,
    OpenAI,
    Ollama,
    Custom(String),
}

impl ApiProvider {
    pub fn default_endpoint(&self) -> &'static str {
        match self {
            Self::DeepSeek => "https://api.deepseek.com/v1",
            Self::OpenAI => "https://api.openai.com/v1",
            Self::Ollama => "http://localhost:11434",
            Self::Custom(_) => "",
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            Self::DeepSeek => "deepseek-chat",
            Self::OpenAI => "gpt-4o-mini",
            Self::Ollama => "llama3",
            Self::Custom(_) => "custom-model",
        }
    }
}

/// Incoming translation request payload
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub phrases: Vec<String>,
    pub preset: String,
    pub llm_config: Option<LlmConfig>,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

/// Detailed translation result
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
}
```

#### B. Cache Key/Value & Engine Structs
```rust
use std::sync::RwLock;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub phrase: String,
    pub target_lang: String,
}

#[derive(Debug, Clone)]
pub struct CacheValue {
    pub translated: String,
    pub source_tier: String,
    pub cached_at: Instant,
}

pub struct TranslationCache {
    store: RwLock<HashMap<CacheKey, CacheValue>>,
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

    pub fn get(&self, phrase: &str, target_lang: &str) -> Option<TranslationResult> {
        let key = CacheKey {
            phrase: phrase.to_string(),
            target_lang: target_lang.to_string(),
        };
        let guard = self.store.read().ok()?;
        guard.get(&key).map(|v| TranslationResult {
            original: phrase.to_string(),
            translated: v.translated.clone(),
            source_tier: format!("{} (Cached)", v.source_tier),
        })
    }

    pub fn insert(&self, phrase: &str, target_lang: &str, translated: &str, source_tier: &str) {
        let key = CacheKey {
            phrase: phrase.to_string(),
            target_lang: target_lang.to_string(),
        };
        let val = CacheValue {
            translated: translated.to_string(),
            source_tier: source_tier.to_string(),
            cached_at: Instant::now(),
        };
        if let Ok(mut guard) = self.store.write() {
            guard.insert(key, val);
        }
    }
}
```

#### C. Multi-Tier Pipeline Engine Struct
```rust
pub struct MultiTierPipeline {
    dict_engine: CgDictionaryEngine,
    cache: TranslationCache,
    http_client: reqwest::Client,
}
```

---

### 2.3 Async Execution, Batch Processing, Timeout Handling & Rate Limiting

#### A. Batch Processing Strategy for LLM (Tier 3)
Sending 10 individual HTTP requests to an LLM provider introduces heavy overhead (10 * network latency). Instead, `MultiTierPipeline` groups all uncached, dictionary-unmatched phrases into **one batch prompt**:

- **System Prompt**:
  `"You are an expert CG/3D software terminology translator (Blender, Substance, Unity, Unreal). Translate the following English terms to simplified Chinese. Return ONLY a valid JSON object mapping original terms to translations. Do not include markdown formatting or extra text."`
- **User Prompt Payload**:
  `{"terms": ["Unmatched Term 1", "Unmatched Term 2"]}`
- **Response Parsing**:
  Parse the returned JSON object `{"Unmatched Term 1": "翻译1", "Unmatched Term 2": "翻译2"}`. If markdown code blocks (` ```json ... ``` `) are present, strip fences before calling `serde_json::from_str`.

#### B. Timeout Handling
- **LLM API Timeout**: Enforced using `tokio::time::timeout(Duration::from_secs(4), reqwest_call)`. If the request takes longer than 4 seconds, `tokio::time::error::Elapsed` is returned, logging a warning and transitioning remaining phrases immediately to Tier 4.
- **Online Fallback Timeout**: Enforced using `tokio::time::timeout(Duration::from_secs(3), online_call)`.

#### C. Rate Limiting and Concurrency Control
- Use `tokio::sync::Semaphore` with `Arc<Semaphore>` set to 5 concurrent connections to prevent hitting 429 Rate Limit thresholds on free online translation endpoints (e.g. Google Translate / MyMemory).

#### D. Fallback Transition Control Flow Matrix
| Scenario | Tier 1 (Preset) | Tier 2 (CG Fallback) | Tier 3 (LLM) | Tier 4 (Online) | Output Source Tier |
|---|---|---|---|---|---|
| Term in Preset Dict | Hit | - | - | - | `blender` |
| Term in another CG Dict | Miss | Hit | - | - | `substance` |
| Term not in Dicts, LLM Configured & Success | Miss | Miss | Hit | - | `LLM (DeepSeek)` |
| Term not in Dicts, LLM Config Missing/Failed/Timeout | Miss | Miss | Fail/Skip | Hit | `Online Fallback (Google)` |
| All Tiers Fail | Miss | Miss | Fail | Fail | `Fallback Tag ([Untranslated])` |

---

### 2.4 Cargo Dependencies & Tauri Integration Review

#### A. Cargo.toml Dependency Upgrades
To support async HTTP request execution and async trait handling in `app_v2/src-tauri/Cargo.toml`, add:
```toml
[dependencies]
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
async-trait = "0.1"
```

#### B. `app_v2/src-tauri/src/commands.rs` Integration
Update `cmd_translate_phrases` to call `MultiTierPipeline`:
```rust
#[tauri::command]
pub async fn cmd_translate_phrases(
    state: tauri::State<'_, AppState>,
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<Vec<TranslationResult>, String> {
    let pipeline = MultiTierPipeline::new();
    let request = TranslationRequest {
        phrases,
        preset,
        llm_config,
        source_lang: Some("en".to_string()),
        target_lang: Some("zh-CN".to_string()),
    };
    Ok(pipeline.translate(request).await)
}
```

---

## 3. Caveats

1. **External Network Availability**:
   - Tier 3 (LLM API) and Tier 4 (Online Fallback) depend on external network connectivity. In offline environments, the pipeline seamlessly degrades to Tier 1 and Tier 2 (0 ms latency local dictionaries).
2. **LLM Response Formatting Variability**:
   - Large Language Models sometimes enclose JSON in markdown wrappers (e.g., ` ```json ... ``` `) or append extra explanatory text. Robust JSON stripping/parsing logic must be implemented in `translator.rs` to handle these variations cleanly.
3. **Existing Challenger IPC Tests**:
   - In `tests/challenger_models_ipc_test.rs`, `test_ipc_cmd_translate_phrases_stub` expects the stub response `"[translated] Subsurface Scattering"`. Once `MultiTierPipeline` is active, "Subsurface Scattering" will be matched by Tier 1 (`blender.json`) returning `"次表面散射"`. Tests expecting stub formatting will need alignment during implementation.

---

## 4. Conclusion

The design for `app_v2/src-tauri/src/translator.rs` provides a high-performance, resilient, 4-tier translation architecture tailored for CG/3D desktop translation:

1. **Preset & Fallback Dictionaries (Tiers 1 & 2)** handle standard CG terms instantly (0 ms).
2. **Async LLM API Client (Tier 3)** processes complex/unseen terms in single-prompt batches via DeepSeek, OpenAI, or Ollama within a strict 4-second timeout.
3. **Online Fallback API (Tier 4)** ensures zero-config fallback via Google/MyMemory APIs when LLM is unavailable or offline.
4. **Thread-Safe In-Memory Caching (`TranslationCache`)** eliminates redundant HTTP/dict operations across repeated user selections.

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Compilation Check**:
   ```powershell
   cargo check --manifest-path app_v2/src-tauri/Cargo.toml
   ```
2. **Feature Coverage Tests**:
   ```powershell
   cargo test --manifest-path app_v2/src-tauri/Cargo.toml --test tier1_feature_coverage
   ```
3. **Full Integration Test**:
   ```powershell
   cargo test --manifest-path app_v2/src-tauri/Cargo.toml
   ```

### 5.2 Key Inspection Files
- `app_v2/src-tauri/src/translator.rs`: Core multi-tier pipeline, batching logic, HTTP client, and dictionary loader.
- `app_v2/src-tauri/src/models.rs`: `TranslationRequest`, `TranslationResult`, `LlmConfig`, `ApiProvider`, `TranslationTier`.
- `app_v2/src-tauri/src/commands.rs`: `cmd_translate_phrases` Tauri IPC integration.
- `app_v2/src-tauri/Cargo.toml`: Verification of `reqwest`, `tokio`, `serde` dependencies.

### 5.3 Invalidation Conditions
- Any failure in `cargo check` or `cargo test --test tier1_feature_coverage`.
- Failure of Tier 1 or Tier 2 dictionary lookups to return exact translations for `Principled BSDF` or `Subsurface Scattering`.
- Unhandled panics when LLM endpoint times out or returns malformed response text.
