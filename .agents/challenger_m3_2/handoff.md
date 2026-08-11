# Handoff Report: Milestone 3 Dictionary Edge & Fallback Empirical Challenge

**Author**: `challenger_m3_2`  
**Date**: 2026-08-09  
**Working Directory**: `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\challenger_m3_2`  
**Milestone**: Milestone 3 — Dictionary Edge & Fallback  
**Verdict**: **`REJECT`**  

---

## 1. Observation

### 1.1 Automated Verification Commands Executed
1. **Rust Full Test Suite**:
   Command: `cargo test --manifest-path app_v2/src-tauri/Cargo.toml`
   - Existing tests: **78 passed, 0 failed**.
   - Output included `challenger_m3_stress_test`, `challenger_models_ipc_test`, `m3_translation_pipeline_test`, `tier1_feature_coverage`, `tier2_boundary_corner`.

2. **React Full Test Suite**:
   Command: `npm --prefix app_v2 test -- --run`
   - Result: **66 passed (3 test files), 0 failed**.

3. **Challenger Empirical Edge & Fallback Test Suite**:
   File created: `app_v2/src-tauri/tests/challenger_m3_edge_fallback_test.rs`
   Command: `cargo test --test challenger_m3_edge_fallback_test --manifest-path app_v2/src-tauri/Cargo.toml`

   **Results**:
   - `test_challenger_case_insensitivity_and_mixed_case`: **PASSED** (Verified `"PRINCIPLED BSDF"`, `"subsurface scattering"`, `"Ao MiXiNg MoDe"`, `"nAvMeSh sUrFaCe"`).
   - `test_challenger_whitespace_normalization`: **PASSED** (Verified `"   Roughness \n"`, `"\t  Clearcoat Roughness  \t"`).
   - `test_challenger_4tier_fallback_transitions`: **PASSED** (Verified 4-tier chain: Tier 1 Preset Dict -> Tier 2 CG Fallback Dict -> Tier 3 Async Mock LLM API -> Tier 4 Online Fallback / Fallback Tag).
   - `test_challenger_cache_key_mismatch_bug_demonstration`: **FAILED** (Empirical Proof of Cache Invalidation Bug).

   **Verbatim Failure Log**:
   ```
   ---- test_challenger_cache_key_mismatch_bug_demonstration stdout ----
   [Empirical Test] Whitespace phrase cache hit on 2nd call: false
   [Empirical Test] Actual source_tier returned: 'blender'
   [Empirical Test] Trimmed phrase variant cache hit: false

   thread 'test_challenger_cache_key_mismatch_bug_demonstration' (29160) panicked at tests\challenger_m3_edge_fallback_test.rs:72:9:
   CACHE BUG DETECTED: Cache store uses untrimmed original phrase as key while retrieve queries trimmed key!
   ```

---

## 2. Logic Chain

### 2.1 Root Cause Analysis of Cache Key Mismatch Bug

1. **Source Code Inspection (`app_v2/src-tauri/src/translator.rs`)**:
   - Lines 124–136:
     ```rust
     impl TranslationCache {
         pub fn store(&self, result: TranslationResult) {
             if let Ok(mut lock) = self.store.write() {
                 lock.insert(result.original.clone(), result);
             }
         }

         pub fn retrieve(&self, key: &str) -> Option<TranslationResult> {
             if let Ok(lock) = self.store.read() {
                 lock.get(key).cloned()
             } else {
                 None
             }
         }
     }
     ```
   - Lines 215–244 (`translate_phrases`):
     ```rust
     for (i, phrase) in phrases.iter().enumerate() {
         let trimmed = phrase.trim();
         ...
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
     ```

2. **Flaw Inconsistency**:
   - `retrieve` queries the cache using `trimmed` (`phrase.trim()`, e.g., `"Roughness"`).
   - `store` inserts into the cache using `result.original.clone()` (`phrase`, e.g., `"   Roughness \n"`).
   - When a phrase contains leading or trailing whitespace:
     1. On 1st lookup, `retrieve("Roughness")` misses.
     2. `lookup_dict` succeeds and calls `store(res)`. `store` inserts key `"   Roughness \n"`.
     3. On 2nd lookup with the exact same input `"   Roughness \n"`, `retrieve("Roughness")` looks up `"Roughness"` in `store`.
     4. The `HashMap` key is `"   Roughness \n"`, which does NOT match `"Roughness"`. `retrieve` returns `None` (CACHE MISS).

3. **System Blast Radius**:
   - **Performance Degraded / High Network Overhead**: Any text extracted from OCR bounding boxes with leading/trailing whitespace will **NEVER** hit the translation cache.
   - **Cache Bloat**: Every OCR frame re-inserts a new key-value pair under the untrimmed string into `RwLock<HashMap>`, leaking memory over prolonged usage.
   - **Remote API Quota Drain**: For phrases falling back to Tier 3 (LLM) or Tier 4 (Online API), repetitive OCR bounding box queries bypass the cache and repeatedly hit external network endpoints.

---

## 3. Caveats

- Case insensitivity matching (`lookup_dict`) works correctly for dictionary lookups when cache is not hit.
- 4-tier transition ordering (Preset -> CG Fallback -> LLM -> Online Fallback) works correctly when configured with mock or real endpoints.
- The rejection is solely based on empirical failure of translation caching when handling whitespace-padded phrases.

---

## 4. Conclusion & Explicit Verdict

**Verdict**: **`REJECT`**

### Summary of Findings:
1. **Case Insensitivity**: Verified working as expected for dictionary lookups (`"PRINCIPLED BSDF"` -> `"原理化 BSDF"`, `"Ao MiXiNg MoDe"` -> `"AO混合模式"`).
2. **Whitespace Normalization in Lookup**: `lookup_dict` correctly trims whitespace before looking up terms in preset dictionaries.
3. **4-Tier Fallback Cascade**: Confirmed seamless transition from Preset -> CG Fallback -> LLM API -> Online Fallback -> Untranslated Fallback Tag (`[translated] <phrase>`).
4. **Cache Key Mismatch Bug**: **FAILED**. `TranslationCache::store` uses untrimmed `result.original.clone()` as the HashMap key, while `translate_phrases` queries `self.cache.retrieve(trimmed)`. This breaks caching for any phrase containing leading or trailing whitespace.

### Recommended Fix for Worker:
In `app_v2/src-tauri/src/translator.rs`:
Update `TranslationCache::store` to store entries using `result.original.trim().to_string()` (or normalize keys to lowercase trimmed strings in both `store` and `retrieve`):
```rust
pub fn store(&self, result: TranslationResult) {
    if let Ok(mut lock) = self.store.write() {
        let key = result.original.trim().to_string();
        lock.insert(key, result);
    }
}
```

---

## 5. Verification Method

To reproduce the bug and verify the fix:

1. Run the empirical challenger test file:
   ```powershell
   cargo test --test challenger_m3_edge_fallback_test --manifest-path app_v2/src-tauri/Cargo.toml
   ```
2. Observe `test_challenger_cache_key_mismatch_bug_demonstration`:
   - **Current Behavior (Bug)**: Test panics with `CACHE BUG DETECTED: Cache store uses untrimmed original phrase as key while retrieve queries trimmed key!`.
   - **Expected Behavior (Post-Fix)**: All 4 tests in `challenger_m3_edge_fallback_test.rs` pass (4 passed, 0 failed).
