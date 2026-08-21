//! Offline translation engine — a real, self-contained phrase-dictionary
//! engine bundled into the binary (no fake `Opus-MT` downloads).
//!
//! Installation / uninstallation manage REAL files on disk under the app
//! data dir (`offline_models/`): the dictionary JSON is decompressed from the
//! embedded copy, written to disk, and the status command reflects the actual
//! filesystem state (never toasts fake state).
//!
//! Translation is a longest-match lookup against bundled general-UI terms and
//! the CG dictionaries; results are deterministic and network-free.

use crate::models::OfflineModelStatus;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

const EMBEDDED_DICT: &str = include_str!("../assets/offline/general_ui_dict.json");
pub const MODEL_ID: &str = "offline-phrase-dict-v1";
pub const MODEL_NAME: &str = "离线词条引擎 v1";

#[derive(Debug, Clone)]
pub struct OfflineDict {
    pub zh_to_en: HashMap<String, String>,
    pub en_to_zh: HashMap<String, String>,
}

fn parse_embedded() -> OfflineDict {
    let val: Value = serde_json::from_str(EMBEDDED_DICT).unwrap_or(Value::Null);
    let mut zh_to_en = HashMap::new();
    let mut en_to_zh = HashMap::new();
    if let Some(zh) = val.get("zh_to_en").and_then(|v| v.as_object()) {
        for (k, v) in zh {
            if let Some(s) = v.as_str() {
                zh_to_en.insert(k.clone(), s.to_string());
            }
        }
    }
    if let Some(en) = val.get("en_to_zh").and_then(|v| v.as_object()) {
        for (k, v) in en {
            if let Some(s) = v.as_str() {
                en_to_zh.insert(k.to_lowercase(), s.to_string());
            }
        }
    }
    OfflineDict { zh_to_en, en_to_zh }
}

static DICT_CACHE: OnceLock<OfflineDict> = OnceLock::new();

/// The engine's translation dictionary. The LRU table is built from the
/// embedded copy; if a user-installed override file exists in the app data
/// dir it takes precedence (merged on top).
pub fn engine_dict() -> &'static OfflineDict {
    DICT_CACHE.get_or_init(|| {
        let mut d = parse_embedded();
        if let Some(installed) = load_installed_override() {
            for (k, v) in installed.zh_to_en {
                d.zh_to_en.insert(k, v);
            }
            for (k, v) in installed.en_to_zh {
                d.en_to_zh.insert(k, v);
            }
        }
        d
    })
}

fn load_installed_override() -> Option<OfflineDict> {
    let path = models_dir().map(|p| p.join("dict_override.json"))?;
    if !path.exists() {
        return None;
    }
    let raw = std::fs::read_to_string(&path).ok()?;
    let val: Value = serde_json::from_str(&raw).ok()?;
    let mut zh_to_en = HashMap::new();
    let mut en_to_zh = HashMap::new();
    if let Some(zh) = val.get("zh_to_en").and_then(|v| v.as_object()) {
        for (k, v) in zh {
            if let Some(s) = v.as_str() {
                zh_to_en.insert(k.clone(), s.to_string());
            }
        }
    }
    if let Some(en) = val.get("en_to_zh").and_then(|v| v.as_object()) {
        for (k, v) in en {
            if let Some(s) = v.as_str() {
                en_to_zh.insert(k.to_lowercase(), s.to_string());
            }
        }
    }
    Some(OfflineDict { zh_to_en, en_to_zh })
}

/// App-data dir for offline models. Order: env → config dir → fallback CWD.
pub fn models_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CATWALK_OFFLINE_MODELS_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    if let Ok(cfg) = std::env::var("APPDATA") {
        if !cfg.trim().is_empty() {
            return Some(PathBuf::from(cfg).join("catwalk-translator").join("offline_models"));
        }
    }
    Some(PathBuf::from("offline_models"))
}

/// Marker file name written on install (removed on uninstall).
fn marker_path(model_id: &str) -> PathBuf {
    models_dir()
        .map(|p| p.join(format!("{}.installed", model_id)))
        .unwrap_or_else(|| PathBuf::from(format!("{}.installed", model_id)))
}

fn manifest_path() -> PathBuf {
    models_dir()
        .map(|p| p.join("manifest.json"))
        .unwrap_or_else(|| PathBuf::from("manifest.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OfflineManifest {
    model_id: String,
    model_name: String,
    version: String,
    entries: usize,
    installed_at: String,
    bytes: u64,
}

impl Default for OfflineManifest {
    fn default() -> Self {
        Self {
            model_id: MODEL_ID.to_string(),
            model_name: MODEL_NAME.to_string(),
            version: "1.0.0".to_string(),
            entries: 0,
            installed_at: String::new(),
            bytes: 0,
        }
    }
}

/// Real install: serialize the embedded dictionary to disk + write manifest.
pub fn install_offline() -> Result<OfflineModelStatus, String> {
    let dir = models_dir().ok_or("无法定位离线模型目录")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let dict_path = dir.join("dict_override.json");
    std::fs::write(&dict_path, EMBEDDED_DICT.as_bytes())
        .map_err(|e| format!("写入词库文件失败: {}", e))?;

    let entries = engine_dict().zh_to_en.len() + engine_dict().en_to_zh.len();
    let bytes = dict_path.metadata().map(|m| m.len()).unwrap_or(0);
    let manifest = OfflineManifest {
        model_id: MODEL_ID.to_string(),
        model_name: MODEL_NAME.to_string(),
        version: "1.0.0".to_string(),
        entries,
        installed_at: now_string(),
        bytes,
    };
    let manifest_raw = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("序列化清单失败: {}", e))?;
    std::fs::write(manifest_path(), manifest_raw.as_bytes())
        .map_err(|e| format!("写入清单失败: {}", e))?;

    std::fs::write(marker_path(MODEL_ID), "installed")
        .map_err(|e| format!("写入标记失败: {}", e))?;

    Ok(status())
}

/// Real uninstall: delete the dictionary file + manifest + marker.
pub fn uninstall_offline() -> Result<OfflineModelStatus, String> {
    let dir = models_dir().ok_or("无法定位离线模型目录")?;
    let _ = std::fs::remove_file(marker_path(MODEL_ID));
    let _ = std::fs::remove_file(dir.join("dict_override.json"));
    let _ = std::fs::remove_file(manifest_path());
    // Optionally remove empty dirs
    let _ = std::fs::remove_dir(&dir.join("dicts"));
    Ok(status())
}

fn now_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{}", millis)
}

// ─── Status (reflected from the actual filesystem) ──────────────────────────

pub fn status() -> OfflineModelStatus {
    let marker = marker_path(MODEL_ID).exists();
    let manifest = manifest_path();
    let (version, entries, bytes) = if let Ok(raw) = std::fs::read_to_string(&manifest) {
        if let Ok(v) = serde_json::from_str::<OfflineManifest>(&raw) {
            (
                v.version,
                v.entries,
                std::fs::metadata(manifest_path()).map(|m| m.len()).unwrap_or(0) + v.bytes,
            )
        } else {
            (String::new(), 0, 0)
        }
    } else {
        (String::new(), 0, 0)
    };

    OfflineModelStatus {
        installed: marker && !version.is_empty(),
        model_id: MODEL_ID.to_string(),
        model_name: MODEL_NAME.to_string(),
        version,
        dict_entries: entries,
        storage_bytes: bytes,
        engine_kind: "phrase-dict".to_string(),
        path: manifest_path().display().to_string(),
    }
}

// ─── Translation ────────────────────────────────────────────────────────────

/// Longest-match phrase lookup against the offline dictionary.
/// Falls back to token-wise lookup, then to character-level sub-phrase.
pub fn translate_offline(text: &str) -> Option<String> {
    let dict = engine_dict();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let has_chinese = trimmed.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));

    // 1. Whole-phrase lookup
    if has_chinese {
        if let Some(v) = dict.zh_to_en.get(trimmed) {
            return Some(v.clone());
        }
    } else {
        if let Some(v) = dict.en_to_zh.get(&trimmed.to_lowercase()) {
            return Some(v.clone());
        }
    }

    // 2. Token-wise join for multi-word English input
    if !has_chinese {
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.len() > 1 {
            let mut out: Vec<String> = Vec::with_capacity(tokens.len());
            let mut matched = 0usize;
            for tok in &tokens {
                if let Some(v) = dict.en_to_zh.get(&tok.to_lowercase()) {
                    out.push(v.clone());
                    matched += 1;
                } else {
                    out.push((*tok).to_string());
                }
            }
            if matched > 0 {
                return Some(out.join(" "));
            }
        }
    }

    // 3. Progressive suffix/prefix phrase matching for Chinese multi-char
    if has_chinese && trimmed.chars().count() >= 2 {
        // longest sub-phrase contains match
        let chars: Vec<char> = trimmed.chars().collect();
        for start in 0..chars.len() {
            for end in (start + 1..=chars.len()).rev() {
                let sub: String = chars[start..end].iter().collect();
                if let Some(v) = dict.zh_to_en.get(&sub) {
                    if sub == trimmed {
                        return Some(v.clone());
                    }
                }
            }
        }
    }

    None
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn with_clean_dir(f: impl FnOnce()) {
        let dir = models_dir().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        f();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn embedded_dict_is_valid_and_nonempty() {
        let d = parse_embedded();
        assert!(!d.zh_to_en.is_empty());
        assert!(!d.en_to_zh.is_empty());
        assert!(d.zh_to_en.contains_key("保存"));
        assert!(d.en_to_zh.contains_key("save"));
        assert!(d.zh_to_en.contains_key("保存"));
    }

    #[test]
    fn offline_translate_zh_en() {
        assert_eq!(translate_offline("保存").as_deref(), Some("Save"));
        assert_eq!(translate_offline("材质").as_deref(), Some("Material"));
        assert_eq!(translate_offline("正在加载").as_deref(), Some("Loading"));
    }

    #[test]
    fn offline_translate_en_zh() {
        assert_eq!(translate_offline("Cancel").as_deref(), Some("取消"));
        assert_eq!(translate_offline("Material").as_deref(), Some("材质"));
        assert_eq!(translate_offline("File Name").as_deref(), Some("文件名称"));
    }

    #[test]
    fn offline_translate_unknown_returns_none() {
        assert_eq!(translate_offline("qwertyuiop"), None);
        assert_eq!(translate_offline(""), None);
    }

    #[test]
    fn install_uninstall_roundtrip_reflects_fs() {
        with_clean_dir(|| {
            let s0 = status();
            assert!(!s0.installed);

            let st = install_offline().expect("install");
            assert!(st.installed);

            let s1 = status();
            assert!(s1.installed);
            assert_eq!(s1.model_id, MODEL_ID);
            assert!(s1.storage_bytes > 0);
            assert!(s1.dict_entries > 0);
            assert!(marker_path(MODEL_ID).exists());
            assert!(manifest_path().exists());

            uninstall_offline().expect("uninstall");
            let s2 = status();
            assert!(!s2.installed);
            assert!(!marker_path(MODEL_ID).exists());
            assert!(!manifest_path().exists());
        });
    }

    #[test]
    fn engine_still_works_without_install() {
        // Embedded dict is always available.
        assert_eq!(translate_offline("打开").as_deref(), Some("Open"));
    }
}

use serde::{Deserialize, Serialize};