//! Downloads and lifecycle management for PP-OCRv6 Tiny / Small / Medium ONNX models.
//! Supports mainland high-speed mirrors (hf-mirror first, then ModelScope, then HuggingFace),
//! progressive download progress streaming, Windows file-lock safe deletion, and hot reloading.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

pub struct ModelSpec {
    pub id: &'static str,
    pub version: &'static str, // "v6" | "v6t" | "v6m"
    pub name: &'static str,
    pub file: &'static str,
    pub urls: &'static [&'static str],
    pub approx_bytes: u64,
    /// Expected byte count; detects incomplete or mismatched model downloads.
    pub exact_bytes: u64,
}

/// 该模型文件是否为「尺寸不符」的历史遗留/损坏文件（需要重新下载）。
pub fn is_stale_size(spec: &ModelSpec, size: u64) -> bool {
    spec.exact_bytes > 0 && size > 0 && size != spec.exact_bytes
}

pub const MODELS: &[ModelSpec] = &[
    // ── PP-OCRv6 Small（均衡增强：ModelScope RapidAI/RapidOCR onnx/PP-OCRv6）──
    // 实测(同图/同代码/release 取 3 次最优)：~490ms，质量为所有档位最优——唯一
    // 把 "Qwen · reasoning model" 完整读对的一档，模型名、副标题、长句、低对比
    // 度小字全部正确。前提是配合 onnx_ocr::active_unclip_ratio() 的 v6 专用
    // unclip=1.0：沿用 v3~v5 的 1.6 会把「模型名 + 副标题」并成一个 ~55px 高的
    // 框，输出 `x1xai/grok46deel` 这类叠字乱码。
    ModelSpec {
        id: "ppocrv6-det",
        version: "v6",
        name: "PP-OCRv6 文本检测 (Small)",
        file: "ch_PP-OCRv6_det_infer.onnx",
        urls: &[
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
        ],
        exact_bytes: 9_929_594,
        approx_bytes: 9_929_594,
    },
    ModelSpec {
        id: "ppocrv6-rec",
        version: "v6",
        name: "PP-OCRv6 文本识别 (Small)",
        file: "ch_PP-OCRv6_rec_infer.onnx",
        urls: &[
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
        ],
        exact_bytes: 21_234_383,
        approx_bytes: 21_234_383,
    },
    ModelSpec {
        id: "ppocrv6-cls",
        version: "v6",
        name: "PP-OCR 方向分类 (180°)",
        file: "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ],
        exact_bytes: 0,
        approx_bytes: 1_400_000,
    },

    // ── PP-OCRv6 Tiny（极速轻量，共 6.3MB）──
    // Tiny 体积和延迟更低；复杂密排文字可能需要 Small 或系统 OCR 补救。
    // 模型名那几行仍会并框/漏读(`XAlirarod` 之类)，追求速度时才选它。
    ModelSpec {
        id: "ppocrv6t-det",
        version: "v6t",
        name: "PP-OCRv6 文本检测 (Tiny)",
        file: "ch_PP-OCRv6_tiny_det_infer.onnx",
        urls: &[
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx",
        ],
        exact_bytes: 1_829_618,
        approx_bytes: 1_829_618,
    },
    ModelSpec {
        id: "ppocrv6t-rec",
        version: "v6t",
        name: "PP-OCRv6 文本识别 (Tiny)",
        file: "ch_PP-OCRv6_tiny_rec_infer.onnx",
        urls: &[
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx",
        ],
        exact_bytes: 4_489_813,
        approx_bytes: 4_489_813,
    },
    ModelSpec {
        id: "ppocrv6t-cls",
        version: "v6t",
        name: "PP-OCR 方向分类 (180°)",
        file: "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        urls: &[
            "https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
            "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ],
        exact_bytes: 0,
        approx_bytes: 1_400_000,
    },
    // Medium is opt-in: CPU latency on dense screenshots is much higher than
    // Small/Tiny. Pin the verified upstream model revision and file sizes.
    ModelSpec {
        id: "ppocrv6m-det",
        version: "v6m",
        name: "PP-OCRv6 文本检测 (Medium)",
        file: "ch_PP-OCRv6_medium_det_infer.onnx",
        urls: &["https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv6/det/PP-OCRv6_det_medium.onnx"],
        exact_bytes: 62_119_454,
        approx_bytes: 62_119_454,
    },
    ModelSpec {
        id: "ppocrv6m-rec",
        version: "v6m",
        name: "PP-OCRv6 文本识别 (Medium)",
        file: "ch_PP-OCRv6_medium_rec_infer.onnx",
        urls: &["https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx"],
        exact_bytes: 76_629_984,
        approx_bytes: 76_629_984,
    },
    ModelSpec {
        id: "ppocrv6m-cls",
        version: "v6m",
        name: "PP-OCR 方向分类 (180°)",
        file: "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        urls: &["https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx"],
        exact_bytes: 0,
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
        // Size mismatch or truncated download is not an installed model.
        // 报告为未安装，界面才会提示重新下载真实模型。
        installed: size > 0 && !is_stale_size(m, size),
        size_bytes: size,
        approx_bytes: m.approx_bytes,
    }
}

/// Installed state + sizes for the supported OCR variants.
#[tauri::command]
pub async fn cmd_offline_models_status() -> Result<Vec<OfflineModelStatus>, String> {
    Ok(MODELS.iter().map(status_for_spec).collect())
}

/// Get the currently active OCR model version ("v6", "v6t" or "v6m").
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
    if !matches!(version.as_str(), "v6" | "v6t" | "v6m") {
        return Ok(false);
    }
    // Do not persist a selection that cannot be loaded. Previously this made
    // the UI claim "v6" while inference silently ran another model after launch.
    if !crate::onnx_ocr::model_files_present_for_version(&version) {
        return Ok(false);
    }

    let previous_version = crate::onnx_ocr::get_active_version();
    crate::onnx_ocr::set_active_version(&version);
    let engine = crate::onnx_ocr::get_engine();
    engine.unload();
    if let Err(e) = engine.ensure_loaded() {
        // The files may exist but still be corrupt/incompatible. Restore the
        // last working generation so one failed switch does not break all
        // subsequent captures for the rest of the process lifetime.
        crate::onnx_ocr::set_active_version(&previous_version);
        engine.unload();
        if engine.ensure_loaded().is_ok() {
            crate::ocr::mark_onnx_ready();
        } else {
            crate::ocr::mark_onnx_failed();
        }
        return Err(format!("加载 PP-OCR{} 失败: {}", version, e));
    }
    if let Ok(mut lock) = state.settings.lock() {
        lock.ocr_version = Some(version);
        // Selecting a default model must actually route OCR to the ONNX-first
        // path, even if the user previously forced the WinRT engine.
        lock.ocr_engine = Some("auto".to_string());
        crate::commands::save_settings_file(&app_handle, &lock);
    }
    crate::ocr::mark_onnx_ready();
    Ok(true)
}

static ACTIVE_DOWNLOADS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn find_spec_by_id(id: &str) -> Option<&'static ModelSpec> {
    MODELS
        .iter()
        .find(|m| m.id == id || (id == "ppocr-cls" && m.id == "ppocrv6t-cls"))
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
        if meta.len() >= 64 * 1024 && !is_stale_size(spec, meta.len()) {
            return Ok(true);
        } else {
            // Incomplete or mismatched file: release locks, then redownload.
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
    let client = crate::translator::apply_proxy_to_builder(
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .timeout(Duration::from_secs(180)),
    )
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
    fn test_models_specs_contain_only_v6_variants() {
        assert_eq!(MODELS.len(), 9);
        assert!(MODELS.iter().all(|m| matches!(m.version, "v6" | "v6t" | "v6m")));
        assert!(MODELS.iter().any(|m| m.version == "v6" && m.id == "ppocrv6-det"));
        assert!(MODELS.iter().any(|m| m.version == "v6" && m.id == "ppocrv6-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v6t" && m.id == "ppocrv6t-det"));
        assert!(MODELS.iter().any(|m| m.version == "v6t" && m.id == "ppocrv6t-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v6m" && m.id == "ppocrv6m-det"));
        assert!(MODELS.iter().any(|m| m.version == "v6m" && m.id == "ppocrv6m-rec"));

        for spec in MODELS {
            assert!(!spec.urls.is_empty());
            assert!(spec.approx_bytes > 100_000);
            assert!(spec.file.ends_with(".onnx"));
        }
    }

    #[test]
    fn v6_variants_use_distinct_files_and_real_v6_sources() {
        // Three variants must use distinct det/rec files so they can coexist.
        let files: Vec<&str> = MODELS
            .iter()
            .filter(|m| !m.id.ends_with("-cls"))
            .map(|m| m.file)
            .collect();
        assert_eq!(files.len(), 6, "each v6 variant needs det+rec");
        let unique: std::collections::BTreeSet<&&str> = files.iter().collect();
        assert_eq!(unique.len(), 6, "v6 model files must be unique: {:?}", files);

        for spec in MODELS
            .iter()
            .filter(|m| !m.id.ends_with("-cls"))
        {
            for u in spec.urls {
                assert!(
                    u.contains("PP-OCRv6"),
                    "{} 的下载源必须是真实 v6 模型: {}",
                    spec.id,
                    u
                );
            }
            assert!(spec.exact_bytes > 0, "{} 需要精确尺寸校验", spec.id);
        }
    }

    #[test]
    fn test_find_spec_by_id() {
        assert!(find_spec_by_id("ppocrv3-det").is_none());
        assert!(find_spec_by_id("ppocr-cls").is_some());
        assert!(find_spec_by_id("ppocrv4-det").is_none());
        assert!(find_spec_by_id("ppocrv5-rec").is_none());
        assert!(find_spec_by_id("ppocrv6-det").is_some());
        assert!(find_spec_by_id("ppocrv6m-det").is_some());
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
