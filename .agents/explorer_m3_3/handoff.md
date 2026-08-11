# Handoff Report: Milestone 3 IPC Integration & Testing Strategy

**Author**: `explorer_m3_3`  
**Date**: 2026-08-09  
**Working Directory**: `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_m3_3`  
**Milestone**: Milestone 3 — Multi-Tier Translation Pipeline & Dictionaries  

---

## 1. Observation

### 1.1 Command Handler & State Management Codebase Audit
Direct examination of `app_v2/src-tauri/src/` revealed the following exact implementation details:

- **`app_v2/src-tauri/src/commands.rs`** (Lines 9-19, 44-52):
  ```rust
  pub struct AppState {
      pub settings: Mutex<AppSettings>,
  }

  impl Default for AppState {
      fn default() -> Self {
          Self {
              settings: Mutex::new(AppSettings::default()),
          }
      }
  }

  #[tauri::command]
  pub async fn cmd_translate_phrases(
      phrases: Vec<String>,
      preset: String,
      _llm_config: Option<LlmConfig>,
  ) -> Result<Vec<TranslationResult>, String> {
      let engine = CgDictionaryEngine::new();
      let results = engine.translate_batch(&phrases, &preset);
      Ok(results)
  }
  ```
  - **State Injection Status**: `cmd_translate_phrases` does not currently accept `State<'_, AppState>`. `_llm_config` is prefixed with an underscore, indicating it is currently unused in the handler stub.
  - **Instantiation Strategy**: `CgDictionaryEngine::new()` is instantiated inside `cmd_translate_phrases` on every IPC invocation, reloading embedded JSON string assets and re-parsing them via `serde_json::from_str`.

- **`app_v2/src-tauri/src/lib.rs`** (Lines 21, 68-74):
  ```rust
  .manage(AppState::default())
  ...
  .invoke_handler(tauri::generate_handler![
      commands::cmd_capture_and_ocr,
      commands::cmd_translate_phrases,
      commands::cmd_sample_colors,
      commands::cmd_save_settings,
      commands::cmd_get_settings
  ])
  ```
  - `AppState` is properly managed by Tauri's builder, and `cmd_translate_phrases` is registered in `invoke_handler!`.

### 1.2 IPC Payload Structure Mapping

- **Rust Backend Types** (`app_v2/src-tauri/src/models.rs` Lines 37-50):
  ```rust
  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct LlmConfig {
      pub provider: String,
      pub api_key: String,
      pub model: String,
      pub endpoint: String,
  }

  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct TranslationResult {
      pub original: String,
      pub translated: String,
      pub source_tier: String,
  }
  ```

- **React Frontend Types** (`app_v2/src/services/types.ts` Lines 25-36):
  ```typescript
  export interface LlmConfig {
    provider: string;
    apiKey: string;
    model: string;
    endpoint: string;
  }

  export interface TranslationResult {
    original: string;
    translated: string;
    sourceTier: string;
  }
  ```

- **Frontend Tauri IPC Service** (`app_v2/src/services/tauri.ts` Lines 56-67):
  ```typescript
  export async function cmdTranslatePhrases(
    phrases: string[],
    preset: string,
    llmConfig?: LlmConfig | null
  ): Promise<TranslationResult[]> {
    if (isTauri()) {
      return await invoke<TranslationResult[]>('cmd_translate_phrases', {
        phrases,
        preset,
        llmConfig: llmConfig || null,
      });
    }
    ...
  }
  ```
  - Contract validation: Serde's `#[serde(rename_all = "camelCase")]` guarantees `api_key` <-> `apiKey`, `source_tier` <-> `sourceTier`, and `_llm_config` parameter mapping match 100%.

### 1.3 Baseline Test Suite Execution Results

1. **Rust Test Suite** (`cargo test --manifest-path app_v2/src-tauri/Cargo.toml`):
   - **45 passed, 0 failed** (13 in `tests/challenger_models_ipc_test.rs` + 32 in `tests/tier1_feature_coverage.rs`).
   - Verifies camelCase Serde serialization, Mutex thread safety under 20 concurrent threads, 50-task Tokio async concurrency stress testing, and basic dictionary lookup.

2. **React Test Suite** (`npm --prefix app_v2 test -- --run`):
   - **52 passed, 0 failed** (20 in `src/tests/empirical_validation.test.tsx` + 32 in `src/tests/tier1_features.test.tsx`).
   - Verifies Zustand store state management, dirty tracking, browser mock fallbacks, and UI settings dashboard interactions.

---

## 2. Logic Chain

1. **IPC & State Architecture Evaluation**:
   - `cmd_translate_phrases` requires access to both user dictionary preferences (from `AppSettings` or `cmd_translate_phrases` args) and active LLM configuration.
   - Instantiating `CgDictionaryEngine::new()` on every IPC call creates unnecessary CPU/memory allocation. Passing a thread-safe `MultiTierPipeline` or static `OnceLock` cached dictionary store inside `AppState` or via static reference will optimize performance.

2. **IPC Data Flow Contract Verification**:
   - Serde annotations on Rust models (`models.rs`) match TypeScript interfaces (`types.ts`) exactly.
   - Front-end IPC invoker (`tauri.ts`) passes `{ phrases, preset, llmConfig }`. Rust deserializes camelCase `llmConfig` into `_llm_config: Option<LlmConfig>`.

3. **Required M3 Test Coverage Design**:
   - **Dictionary Lookup Accuracy**: Must test exact match, case insensitivity (`PRINCIPLED BSDF` -> `原理化 BSDF`), and automatic whitespace trimming (`"  Roughness \n"` -> `"Roughness"`).
   - **Fallback Chain Behavior (4-Tier Pipeline)**:
     - Tier 1: User requested preset dict (e.g. `blender`).
     - Tier 2: Remaining CG preset dicts (`substance`, `unity`).
     - Tier 3: LLM API Client (DeepSeek/OpenAI/Ollama) with mock HTTP handler simulating network success, timeout (>4s), 401/429 errors, and invalid JSON responses.
     - Tier 4: Online Fallback API (Google/MyMemory) for zero-config fallback.
     - Final Fallback: Untranslated string tag when offline.
   - **IPC Handler Parameter & Error Validation**:
     - Empty phrase vector `[]`.
     - Whitespace-only phrase vector `["   "]`.
     - Invalid preset names `preset: "unknown_engine"`.
     - Invalid/empty LLM config (null API key or malformed endpoint URL).
     - Mutex poison resilience & 50+ task concurrent execution.

---

## 3. Caveats

- **External Network Dependency in Tests**: Unit and integration tests for Tier 3 (LLM) and Tier 4 (Online API) must use mocked HTTP clients or local test servers (e.g., `wiremock` or mock traits) to prevent test failures when running in offline or CI environments.
- **Tauri Mock Harness Synchronization**: React tests use `src/tests/harness/tauriIpcMock.ts` when `window.__TAURI_INTERNALS__` is set. Any change to Rust IPC command return types must be mirrored in `tauriIpcMock.ts`.

---

## 4. Conclusion

### Summary of IPC Mapping Contract
- **Request**: `{ phrases: Vec<String>, preset: String, llmConfig: Option<LlmConfig> }`
- **Response**: `Result<Vec<TranslationResult>, String>` where `TranslationResult` contains `{ original: String, translated: String, sourceTier: String }`.

### Recommended Rust State Optimization for `commands.rs`
```rust
#[tauri::command]
pub async fn cmd_translate_phrases(
    state: State<'_, AppState>,
    phrases: Vec<String>,
    preset: String,
    llm_config: Option<LlmConfig>,
) -> Result<Vec<TranslationResult>, String> {
    // 1. Parameter validation
    if phrases.is_empty() {
        return Ok(vec![]);
    }
    
    // 2. Resolve active LLM config (fallback to AppState if None)
    let effective_llm = llm_config.or_else(|| {
        state.settings.lock().ok().and_then(|s| s.llm_config.clone())
    });

    // 3. Execute multi-tier translation pipeline
    let pipeline = MultiTierPipeline::new();
    let results = pipeline.translate_batch(&phrases, &preset, effective_llm.as_ref()).await;
    Ok(results)
}
```

### Detailed M3 Test Matrix Recommendation
Create a dedicated test file `app_v2/src-tauri/tests/m3_translation_pipeline_test.rs` covering:
1. `test_dict_exact_match_all_presets()` (Blender, Substance, Unity term validation)
2. `test_dict_case_insensitive_lookup()` (`PRINCIPLED BSDF`, `roughness`, `AO MIXING MODE`)
3. `test_dict_trim_whitespace_sanitization()` (`"  Subsurface  "`, `"Normal Map\n"`)
4. `test_fallback_chain_tier1_to_tier4()` (Preset -> CG Fallback -> Mock LLM -> Mock Online API)
5. `test_llm_timeout_fallback_trigger()` (Simulated 5s delay triggering Tier 4)
6. `test_ipc_empty_and_whitespace_phrases_handling()` (`[]`, `["  "]`)
7. `test_ipc_invalid_preset_graceful_fallback()` (`preset: "nonexistent"`)

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Rust Test Suite**:
   ```powershell
   cargo test --manifest-path app_v2/src-tauri/Cargo.toml
   ```
2. **React Test Suite**:
   ```powershell
   npm --prefix app_v2 test -- --run
   ```

### 5.2 Key Files to Inspect
- `app_v2/src-tauri/src/commands.rs`: `cmd_translate_phrases` handler implementation.
- `app_v2/src-tauri/src/translator.rs`: Multi-tier pipeline & dictionary loader.
- `app_v2/src-tauri/src/models.rs`: `LlmConfig`, `TranslationResult` models.
- `app_v2/src/services/tauri.ts` & `app_v2/src/services/types.ts`: Frontend IPC bindings.

### 5.3 Invalidation Conditions
- Any failure or warning during `cargo test` or `npm test`.
- Deserialization mismatch for `llmConfig` or `sourceTier` in Serde camelCase mapping.
- Unhandled panic when `phrases` is empty or `llm_config` contains invalid endpoint URLs.
