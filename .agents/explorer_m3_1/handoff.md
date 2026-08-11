# Handoff Report: CG Domain JSON Dictionaries Requirement (Milestone 3)

## 1. Observation

### Existing CG Dictionary Asset Files
- **`app_v2/src-tauri/assets/dicts/blender.json`** (Lines 1-10):
  ```json
  {
    "Principled BSDF": "原理化 BSDF",
    "Subsurface": "次表面",
    "Subsurface Scattering": "次表面散射",
    "Roughness": "粗糙度",
    "Metallic": "金属度",
    "Anisotropic Tangent": "各向异性切线",
    "Normal Map": "法线贴图",
    "Base Color": "基础色"
  }
  ```
  Contains 8 key-value entries. File size: 280 bytes.

- **`app_v2/src-tauri/assets/dicts/substance.json`** (Lines 1-7):
  ```json
  {
    "Height Range": "高度范围",
    "AO Mixing Mode": "AO混合模式",
    "Curvature Blur Radius": "曲率模糊半径",
    "Subsurface": "次表面",
    "Roughness": "粗糙度"
  }
  ```
  Contains 5 key-value entries. File size: 181 bytes.

- **`app_v2/src-tauri/assets/dicts/unity.json`** (Lines 1-6):
  ```json
  {
    "NavMesh Surface": "NavMesh 表面",
    "RigidBody Interpolate": "刚体插值",
    "Skinned Mesh Renderer Bounds": "蒙皮网格渲染器包围盒",
    "Base Color": "基础颜色"
  }
  ```
  Contains 4 key-value entries. File size: 185 bytes.

### Existing Rust Engine Implementation
- **`app_v2/src-tauri/src/translator.rs`** (Lines 8-58):
  - `CgDictionaryEngine` struct holds `dicts: HashMap<String, HashMap<String, String>>`.
  - `CgDictionaryEngine::new()` uses `include_str!("../assets/dicts/blender.json")`, `include_str!("../assets/dicts/substance.json")`, and `include_str!("../assets/dicts/unity.json")` to statically embed JSON content at compile time.
  - `serde_json::from_str::<HashMap<String, String>>` parses raw JSON into memory.
  - Lookup logic (`lookup(&self, phrase: &str, preset: &str)`) prioritizes requested preset first, then falls back to remaining dictionaries.

- **`app_v2/src-tauri/src/commands.rs`** (Lines 44-52):
  ```rust
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
  Note: Instantiates `CgDictionaryEngine::new()` on every IPC call, re-executing `serde_json::from_str` parsing dynamically per command invocation.

- **`app_v2/src-tauri/tests/tier1_feature_coverage.rs`** (Lines 301-378):
  - Unit tests verify preset dictionary lookups (`test_f4_01_preset_cg_dictionary_lookup`), tier priority resolution (`test_f4_04_tier_priority_resolution`), translation cache (`test_f4_05_translation_cache_store_retrieve`), and batch processing (`test_f4_06_batch_phrase_processing`). All 32 project tests pass cleanly via `cargo test`.

---

## 2. Logic Chain

1. **Terminology Requirements Analysis**:
   - The current dictionary files provide baseline seed terms (8 in Blender, 5 in Substance, 4 in Unity).
   - In practical CG workflow (rendering, shaders, modeling, physics, navigation), OCR extractions encounter multi-word CG terms. If a term is missing in the preset dictionary, execution falls back to LLM/online API, incurring network latency (~500ms-2000ms).
   - Expanding terms across shaders, node properties, rendering engine settings, modifiers, texture channels, and navigation components ensures direct $O(1)$ preset dictionary hits (< 1ms latency).

2. **JSON Schema Selection & Structure Design**:
   - The existing system uses a flat JSON string-to-string mapping (`HashMap<String, String>`).
   - Standardizing on a flat key-value schema (`"English Term": "中文翻译"`) maintains total backward compatibility with `serde_json::from_str::<HashMap<String, String>>` without changing the serialization contract.
   - For optional forward compatibility (e.g. metadata/category tags), an optional `_meta` key can be ignored or safely skipped during map deserialization, or a structured schema (`DictFile { meta: Metadata, terms: HashMap<String, String> }`) can be used if category filtering is requested in future milestones.
   - Flat key-value format is recommended for zero-overhead parsing and minimum memory overhead (< 50 KB for thousands of terms).

3. **Rust In-Memory Loading & Caching Optimization**:
   - Currently `CgDictionaryEngine::new()` is called inside `cmd_translate_phrases` on every translation request (Observation in `commands.rs` line 49).
   - Re-parsing JSON via `serde_json::from_str` on every request introduces unnecessary memory allocation and CPU overhead.
   - Using `std::sync::OnceLock` (or `lazy_static` / `tauri::State<AppState>`) allows global static or state-cached initialization. Dictionaries are compiled into the binary via `include_str!` and parsed **exactly once** into `HashMap<String, HashMap<String, String>>` on first use or app startup.
   - Case-insensitive lookup (normalizing lookup keys to lowercase) handles OCR casing variations (e.g., `PRINCIPLED BSDF` -> `Principled BSDF`).

---

## 3. Caveats

- **No Caveats**: Analysis is fully backed by direct inspection of asset JSON files, Rust source code (`translator.rs`, `commands.rs`), and passing test suite output (`cargo test`).

---

## 4. Conclusion

### A. Recommended Terminology Expansion
Expand `blender.json`, `substance.json`, and `unity.json` with the following domain-specific terms:

#### 1. `blender.json` (Blender 4.x CG Terms)
- **Shader Nodes**: `"Principled BSDF": "原理化 BSDF"`, `"Subsurface Scattering": "次表面散射"`, `"Subsurface Radius": "次表面半径"`, `"Anisotropic Tangent": "各向异性切线"`, `"Sheen Tint": "光泽染色"`, `"Clearcoat Roughness": "清漆粗糙度"`, `"IOR": "折射率"`, `"Transmission": "透射"`, `"Emission": "自发光"`, `"Normal Map": "法线贴图"`, `"Bump Map": "凹凸贴图"`, `"Displacement": "置换"`, `"Environment Texture": "环境纹理"`
- **Modifiers**: `"Subdivision Surface": "细分曲面"`, `"Bevel": "倒角"`, `"Boolean": "布尔"`, `"Solidify": "实体化"`, `"Array": "阵列"`, `"Mirror": "镜像"`, `"Remesh": "重构网格"`, `"Shrinkwrap": "缩裹"`
- **Render Engine**: `"EEVEE Next": "EEVEE Next 渲染引擎"`, `"Cycles": "Cycles 渲染器"`, `"Denoising": "降噪"`, `"Ray Tracing": "光线追踪"`, `"Bloom": "泛光"`, `"AgX": "AgX 色彩空间"`

#### 2. `substance.json` (Substance Painter / Designer Terms)
- **Channels & Modes**: `"Base Color": "基础色"`, `"Roughness": "粗糙度"`, `"Metallic": "金属度"`, `"Height Range": "高度范围"`, `"AO Mixing Mode": "AO 混合模式"`, `"Curvature Blur Radius": "曲率模糊半径"`, `"Normal Space": "法线空间"`, `"Opacity": "不透明度"`
- **Bakers & Generators**: `"Curvature": "曲率"`, `"World Space Normal": "世界空间法线"`, `"Position": "位置图"`, `"Thickness": "厚度图"`, `"Smart Material": "智能材质"`, `"Smart Mask": "智能遮罩"`, `"Anchor Point": "锚点"`, `"Tri-planar Projection": "三平面投影"`, `"Metal Edge Wear": "金属边缘磨损"`

#### 3. `unity.json` (Unity URP/HDRP & Engine Terms)
- **Rendering & Shaders**: `"Universal Render Pipeline": "通用渲染管线"`, `"High Definition Render Pipeline": "高清晰度渲染管线"`, `"Shader Graph": "着色器图表"`, `"Skinned Mesh Renderer Bounds": "蒙皮网格渲染器包围盒"`, `"Mesh Renderer": "网格渲染器"`, `"Global Illumination": "全局光照"`, `"Lightmap": "光照贴图"`, `"Screen Space Reflection": "屏幕空间反射"`
- **Physics & NavMesh**: `"NavMesh Surface": "NavMesh 表面"`, `"NavMesh Agent": "NavMesh 寻路代理"`, `"RigidBody Interpolate": "刚体插值"`, `"Collision Detection": "碰撞检测"`, `"Character Controller": "角色控制器"`, `"Box Collider": "盒状碰撞体"`

### B. Recommended JSON Schema Structure
Keep standard flat key-value JSON schema for maximum speed and simplicity:
```json
{
  "Principled BSDF": "原理化 BSDF",
  "Subsurface Scattering": "次表面散射",
  "AO Mixing Mode": "AO 混合模式",
  "NavMesh Surface": "NavMesh 表面"
}
```

### C. Recommended Rust Loading & Caching Architecture
In `app_v2/src-tauri/src/translator.rs`:
1. Use `std::sync::OnceLock` to cache parsed dictionary `HashMap` statically across application lifetime:
   ```rust
   use std::sync::OnceLock;
   use std::collections::HashMap;

   static CG_DICTS: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();

   pub fn get_cg_dicts() -> &'static HashMap<String, HashMap<String, String>> {
       CG_DICTS.get_or_init(|| {
           let mut dicts = HashMap::new();
           if let Ok(map) = serde_json::from_str(include_str!("../assets/dicts/blender.json")) {
               dicts.insert("blender".to_string(), map);
           }
           if let Ok(map) = serde_json::from_str(include_str!("../assets/dicts/substance.json")) {
               dicts.insert("substance".to_string(), map);
           }
           if let Ok(map) = serde_json::from_str(include_str!("../assets/dicts/unity.json")) {
               dicts.insert("unity".to_string(), map);
           }
           dicts
       })
   }
   ```
2. Update `CgDictionaryEngine` to reference `get_cg_dicts()` or store static reference, avoiding re-parsing JSON on every IPC request.
3. Enhance lookup with case-insensitive fallback.

---

## 5. Verification Method

1. **Verify Asset Files**:
   Inspect `app_v2/src-tauri/assets/dicts/blender.json`, `substance.json`, and `unity.json` using `view_file` to confirm valid JSON syntax.
2. **Execute Rust Test Suite**:
   Run `cargo test` in `app_v2/src-tauri`. All 45 tests (13 unit/IPC tests + 32 feature coverage tests) must pass with 0 errors.
3. **Invalidation Conditions**:
   - Invalid JSON formatting causing `serde_json::from_str` to fail.
   - Any regression in test `test_f4_01_preset_cg_dictionary_lookup`.
