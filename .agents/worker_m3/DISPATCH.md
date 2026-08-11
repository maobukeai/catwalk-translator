## 2026-08-08T17:10:21Z
You are worker_m3, the implementation Worker for Milestone 3 (M3: Multi-Tier Translation Pipeline & Dictionaries).

Working Directory: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\worker_m3
Original Request Path: c:\Users\20269\Desktop\项目文件夹\翻译软件\ORIGINAL_REQUEST.md
Scope Document: c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\sub_orch_m3\SCOPE.md
Project Document: c:\Users\20269\Desktop\项目文件夹\翻译软件\PROJECT.md

Read the 3 Explorer handoff reports before implementing:
- Explorer 1 Report (CG Dicts): c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_m3_1\handoff.md
- Explorer 2 Report (Multi-Tier Pipeline): c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_m3_2\handoff.md
- Explorer 3 Report (IPC & Testing): c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\explorer_m3_3\handoff.md

Your tasks:
1. **CG JSON Dictionaries** (`app_v2/src-tauri/assets/dicts/`):
   - Update/create `blender.json`, `substance.json`, `unity.json` containing exact CG domain terminology (e.g. "Principled BSDF", "AO Mixing Mode", "NavMesh Surface", "Subsurface Scattering", "Subdivision Surface", "Normal Map", etc.) mapped to accurate Chinese terms.
2. **Multi-Tier Translation Pipeline** (`app_v2/src-tauri/src/translator.rs`):
   - Implement full functional code for the 4-tier pipeline:
     - Tier 1: Preset JSON Dictionary (`blender.json`, `substance.json`, `unity.json`)
     - Tier 2: CG Fallback Dictionary (searches remaining loaded CG dictionaries for shared terms)
     - Tier 3: LLM API Client (DeepSeek `https://api.deepseek.com/v1`, OpenAI, Ollama endpoints via async HTTP using `reqwest` with 4s `tokio::time::timeout` and batch phrase JSON payload)
     - Tier 4: Online Fallback API (free web translation endpoints like Google/MyMemory)
   - Implement thread-safe `TranslationCache` (`RwLock<HashMap<...>>`) and `OnceLock` static dictionary caching.
3. **IPC Connection** (`app_v2/src-tauri/src/commands.rs` & `lib.rs`):
   - Connect `cmd_translate_phrases` to use the multi-tier pipeline engine cleanly.
4. **Testing & Verification**:
   - Write comprehensive unit and integration tests covering:
     - Dictionary lookup accuracy (exact match, case insensitivity, trim whitespace)
     - 4-tier fallback chain transitions
     - IPC command parameter validation, error handling, and Mutex resilience under async concurrency
   - MUST run the following build and test verification commands:
     - `cargo test --manifest-path app_v2/src-tauri/Cargo.toml`
     - `npm --prefix app_v2 test -- --run`
   - Document all command outputs in your handoff report.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

5. Write your complete handoff report to `c:\Users\20269\Desktop\项目文件夹\翻译软件\.agents\worker_m3\handoff.md` and notify parent via `send_message`.
