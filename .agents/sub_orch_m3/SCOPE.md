# Scope: Milestone 3 — Multi-Tier Translation Pipeline & Dictionaries

## Architecture & Responsibilities
- **CG Domain Dictionaries** (`app_v2/src-tauri/assets/dicts/`): JSON dictionaries for Blender (`blender.json`), Substance (`substance.json`), Unity (`unity.json`) containing exact terms (e.g. "Principled BSDF" -> "原理化 BSDF", "AO Mixing Mode" -> "AO 混合模式").
- **Multi-Tier Translation Engine** (`app_v2/src-tauri/src/translator.rs`): Direct preset JSON dictionary loader, CG fallback dictionary lookup, LLM API query builder & HTTP client (DeepSeek / OpenAI / Ollama), and free online fallback APIs (Google/MyMemory). Tier priority resolution, caching, and batch phrase processing.
- **Tauri IPC Command** (`app_v2/src-tauri/src/commands.rs`): Connect `cmd_translate_phrases` to execute multi-tier translation.

## Deliverables & Acceptance Criteria
1. CG dictionaries loaded and verified for Blender, Substance, Unity terminology.
2. Direct term matching prioritizing preset JSON dictionary entries with zero latency.
3. LLM API client supporting DeepSeek (`https://api.deepseek.com/v1`), OpenAI, Ollama endpoints with clean error handling and timeout fallbacks.
4. Online API fallbacks for unmatched phrases when LLM is unconfigured/offline.
5. `cargo test` passing 100% across unit and integration test suites.
6. Zero facade/dummy implementations; clean Forensic Audit.
