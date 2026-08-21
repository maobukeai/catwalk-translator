//! Downloads and lifecycle management for PP-OCRv3 / PP-OCRv4 / PP-OCRv5 ONNX model files.
//! Supports mainland high-speed mirrors (hf-mirror first, then ModelScope, then HuggingFace),
//! progressive download progress streaming, Windows file-lock safe deletion, and hot reloading.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

pub struct ModelSpec {
    pub id: &'static str,
    pub version: &'static str, // "v3" | "v4" | "v5"
    pub name: &'static str,
    pub file: &'static str,
    pub urls: &'static [&'static str],
    pub approx_bytes: u64,
}

pub const MODELS: &[ModelSpec] = &[
    // ── PP-OCRv3 (Classic Lightweight) ──
    ModelSpec {
        id: "ppocrv3-det",
        version: "v3",
        name: "PP-OCRv3 文本检测",
        file: "ch_PP-OCRv3_det_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv3/ch_PP-OCRv3_det_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv3/ch_PP-OCRv3_det_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv3/ch_PP-OCRv3_det_infer.onnx",
        ],
        approx_bytes: 4_700_000,
    },
    ModelSpec {
        id: "ppocrv3-rec",
        version: "v3",
        name: "PP-OCRv3 文本识别",
        file: "ch_PP-OCRv3_rec_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv3/ch_PP-OCRv3_rec_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv3/ch_PP-OCRv3_rec_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv3/ch_PP-OCRv3_rec_infer.onnx",
        ],
        approx_bytes: 10_800_000,
    },
    ModelSpec {
        id: "ppocrv3-cls",
        version: "v3",
        name: "PP-OCR 方向分类 (180°)",
        file: "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ],
        approx_bytes: 1_400_000,
    },

    // ── PP-OCRv4 (High-Accuracy Balanced · Recommended) ──
    ModelSpec {
        id: "ppocrv4-det",
        version: "v4",
        name: "PP-OCRv4 文本检测",
        file: "ch_PP-OCRv4_det_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
        ],
        approx_bytes: 4_700_000,
    },
    ModelSpec {
        id: "ppocrv4-rec",
        version: "v4",
        name: "PP-OCRv4 文本识别",
        file: "ch_PP-OCRv4_rec_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
        ],
        approx_bytes: 10_800_000,
    },
    ModelSpec {
        id: "ppocrv4-cls",
        version: "v4",
        name: "PP-OCR 方向分类 (180°)",
        file: "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ],
        approx_bytes: 1_400_000,
    },

    // ── PP-OCRv5 (2026 Latest Enhanced) ──
    ModelSpec {
        id: "ppocrv5-det",
        version: "v5",
        name: "PP-OCRv5 文本检测",
        file: "ch_PP-OCRv5_det_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
        ],
        approx_bytes: 4_900_000,
    },
    ModelSpec {
        id: "ppocrv5-rec",
        version: "v5",
        name: "PP-OCRv5 文本识别",
        file: "ch_PP-OCRv5_rec_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
        ],
        approx_bytes: 11_200_000,
    },
    ModelSpec {
        id: "ppocrv5-cls",
        version: "v5",
        name: "PP-OCR 方向分类 (180°)",
        file: "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ],
        approx_bytes: 1_400_000,
    },
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineModelStatus {
    pub id: String,
    pub version: String,
    pub name: String,
    pub file_name: String,
    pub installed: bool,
    /// On-disk size when installed, else the approximate download size.
    pub size_bytes: u64,
    pub approx_bytes: u64,
}

fn status_for_spec(m: &ModelSpec) -> OfflineModelStatus {
    // Check candidate directories: app-data override, resolved models dir
    let installed_path = crate::onnx_ocr::models_dir_override()
        .map(|d| d.join(m.file))
        .filter(|p| p.exists())
        .or_else(|| {
            crate::onnx_ocr::resolved_models_dir()
                .map(|d| d.join(m.file))
                .filter(|p| p.exists())
        });

    let size = installed_path
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|md| md.len())
        .unwrap_or(0);

    OfflineModelStatus {
        id: m.id.to_string(),
        version: m.version.to_string(),
        name: m.name.to_string(),
        file_name: m.file.to_string(),
        installed: size > 0,
        size_bytes: size,
        approx_bytes: m.approx_bytes,
    }
}

/// Installed state + sizes for every local OCR model across v3, v4, v5.
#[tauri::command]
pub async fn cmd_offline_models_status() -> Result<Vec<OfflineModelStatus>, String> {
    Ok(MODELS.iter().map(status_for_spec).collect())
}

/// Get the currently active OCR model version ("v3", "v4", or "v5").
#[tauri::command]
pub fn cmd_get_active_ocr_version() -> Result<String, String> {
    Ok(crate::onnx_ocr::get_active_version())
}

/// Hot-switch active OCR model version.
#[tauri::command]
pub fn cmd_switch_ocr_version(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::commands::AppState>,
    version: String,
) -> Result<bool, String> {
    crate::onnx_ocr::set_active_version(&version);

    if let Ok(mut lock) = state.settings.lock() {
        lock.ocr_version = Some(version.clone());
        crate::commands::save_settings_file(&app_handle, &lock);
    }

    let engine = crate::onnx_ocr::get_engine();
    engine.unload();
    if crate::onnx_ocr::model_files_present_for_version(&version) {
        if let Err(e) = engine.ensure_loaded() {
            crate::ocr::mark_onnx_failed();
            return Err(format!("加载 PP-OCR{} 失败: {}", version, e));
        }
        crate::ocr::mark_onnx_ready();
        Ok(true)
    } else {
        Ok(false)
    }
}

static ACTIVE_DOWNLOADS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn find_spec_by_id(id: &str) -> Option<&'static ModelSpec> {
    MODELS
        .iter()
        .find(|m| m.id == id || (id == "ppocr-cls" && m.id == "ppocrv3-cls"))
}

/// Stream-download one model with `model-download-progress` events.
/// Returns Ok(true) when the file landed, Ok(false) when a download for this
/// id is already in flight.
#[tauri::command]
pub async fn cmd_download_offline_model(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<bool, String> {
    let spec = find_spec_by_id(&id).ok_or_else(|| format!("Unknown model id: {}", id))?;

    let dir = crate::onnx_ocr::models_dir_override()
        .unwrap_or_else(|| std::env::temp_dir().join("catwalk_models"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir failed: {}", e))?;
    let final_path = dir.join(spec.file);

    // If file exists and size is valid (> 64KB), consider installed
    if let Ok(meta) = std::fs::metadata(&final_path) {
        if meta.len() >= 64 * 1024 {
            return Ok(true);
        } else {
            // Corrupted 0-byte or incomplete file -> release file locks and clean up
            crate::onnx_ocr::unload_engine();
            let _ = std::fs::remove_file(&final_path);
        }
    }

    // Clean up any stale .part file
    let part_path = final_path.with_extension("part");
    if part_path.exists() {
        let _ = std::fs::remove_file(&part_path);
    }

    {
        let mut active = ACTIVE_DOWNLOADS
            .lock()
            .map_err(|e| format!("lock: {}", e))?;
        if active.iter().any(|a| a == &id) {
            return Ok(false);
        }
        active.push(id.clone());
    }

    // Release engine handles before writing
    crate::onnx_ocr::unload_engine();

    let result = download_model(&app_handle, spec, &final_path).await;

    if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
        active.retain(|a| a != &id);
    }

    if result.is_ok() {
        // If models for current version are ready, hot-reload ONNX engine immediately!
        let active_ver = crate::onnx_ocr::get_active_version();
        if crate::onnx_ocr::model_files_present_for_version(&active_ver)
            || crate::onnx_ocr::model_files_present_for_version(spec.version)
        {
            if !crate::onnx_ocr::model_files_present_for_version(&active_ver) {
                crate::onnx_ocr::set_active_version(spec.version);
            }
            let engine = crate::onnx_ocr::get_engine();
            if engine.ensure_loaded().is_ok() {
                crate::ocr::mark_onnx_ready();
            }
        }
    }

    result
}

async fn download_model(
    app_handle: &tauri::AppHandle,
    spec: &ModelSpec,
    final_path: &std::path::Path,
) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("http client: {}", e))?;

    let mut last_err = String::new();
    for url in spec.urls {
        match download_stream(app_handle, &client, url, final_path, spec).await {
            Ok(n) => {
                let _ = app_handle.emit(
                    "model-download-progress",
                    serde_json::json!({ "modelId": spec.id, "received": n, "total": n, "done": true }),
                );
                return Ok(true);
            }
            Err(e) => {
                let _ = std::fs::remove_file(final_path.with_extension("part"));
                last_err = format!("{} → {}", url, e);
            }
        }
    }
    Err(format!("所有镜像均下载失败：{}", last_err))
}

async fn download_stream(
    app_handle: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
    final_path: &std::path::Path,
    spec: &ModelSpec,
) -> Result<u64, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(spec.approx_bytes);

    let tmp = final_path.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("create tmp: {}", e))?;

    let mut received: u64 = 0;
    let mut last_emit = Instant::now()
        .checked_sub(Duration::from_secs(1))
        .unwrap_or_else(Instant::now);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write: {}", e))?;
        received += chunk.len() as u64;
        if last_emit.elapsed() > Duration::from_millis(150) {
            let _ = app_handle.emit(
                "model-download-progress",
                serde_json::json!({ "modelId": spec.id, "received": received, "total": total }),
            );
            last_emit = Instant::now();
        }
    }
    file.flush().await.map_err(|e| format!("flush: {}", e))?;
    drop(file);

    // A tiny payload is almost certainly an HTML error page, not an ONNX model
    if received < 64 * 1024 {
        return Err(format!("suspiciously small file ({} bytes)", received));
    }
    std::fs::rename(&tmp, final_path).map_err(|e| format!("rename: {}", e))?;
    Ok(received)
}

/// Delete one downloaded model file (frees disk space; releases Windows file locks first).
#[tauri::command]
pub async fn cmd_delete_offline_model(id: String) -> Result<bool, String> {
    let spec = find_spec_by_id(&id).ok_or_else(|| format!("Unknown model id: {}", id))?;

    // 1. Unload engine session handles first to release Windows file locks!
    crate::onnx_ocr::unload_engine();

    // 2. Remove the model file and any .part files in models_dir_override
    if let Some(dir) = crate::onnx_ocr::models_dir_override() {
        let path = dir.join(spec.file);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        let part_path = path.with_extension("part");
        if part_path.exists() {
            let _ = std::fs::remove_file(&part_path);
        }
    }

    // 3. Clean up other candidate locations if applicable
    if let Some(dir) = crate::onnx_ocr::resolved_models_dir() {
        let path = dir.join(spec.file);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        let part_path = path.with_extension("part");
        if part_path.exists() {
            let _ = std::fs::remove_file(&part_path);
        }
    }

    // Re-check remaining models to see if another version is available
    if crate::onnx_ocr::model_files_present() {
        let _ = crate::onnx_ocr::get_engine().ensure_loaded();
        crate::ocr::mark_onnx_ready();
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_models_specs_contain_all_versions() {
        assert!(MODELS.iter().any(|m| m.version == "v3" && m.id == "ppocrv3-det"));
        assert!(MODELS.iter().any(|m| m.version == "v3" && m.id == "ppocrv3-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v4" && m.id == "ppocrv4-det"));
        assert!(MODELS.iter().any(|m| m.version == "v4" && m.id == "ppocrv4-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v5" && m.id == "ppocrv5-det"));
        assert!(MODELS.iter().any(|m| m.version == "v5" && m.id == "ppocrv5-rec"));

        for spec in MODELS {
            assert!(!spec.urls.is_empty());
            assert!(spec.approx_bytes > 100_000);
            assert!(spec.file.ends_with(".onnx"));
        }
    }

    #[test]
    fn test_find_spec_by_id() {
        assert!(find_spec_by_id("ppocrv3-det").is_some());
        assert!(find_spec_by_id("ppocr-cls").is_some());
        assert!(find_spec_by_id("ppocrv4-det").is_some());
        assert!(find_spec_by_id("ppocrv5-rec").is_some());
        assert!(find_spec_by_id("unknown-id").is_none());
    }

    #[test]
    fn test_status_for_spec_structure() {
        let spec = &MODELS[0];
        let status = status_for_spec(spec);
        assert_eq!(status.id, spec.id);
        assert_eq!(status.version, spec.version);
        assert_eq!(status.file_name, spec.file);
        assert_eq!(status.approx_bytes, spec.approx_bytes);
    }
}
