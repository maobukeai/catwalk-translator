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
    /// 期望的精确字节数（0 = 不校验）。用于识别「文件名对但内容不对」的历史
    /// 遗留文件：v5 曾错误地从 PP-OCRv4 的 URL 下载并保存成 v5 文件名，磁盘上
    /// 留下与 v4 字节完全相同的伪 v5 模型。仅凭"文件存在"判定已安装会让这些
    /// 伪文件永远不被替换，因此对已知精确大小的模型做尺寸校验。
    pub exact_bytes: u64,
}

/// 该模型文件是否为「尺寸不符」的历史遗留/损坏文件（需要重新下载）。
pub fn is_stale_size(spec: &ModelSpec, size: u64) -> bool {
    spec.exact_bytes > 0 && size > 0 && size != spec.exact_bytes
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
        exact_bytes: 0,
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
        exact_bytes: 0,
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
        exact_bytes: 0,
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
        exact_bytes: 0,
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
        exact_bytes: 0,
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
        exact_bytes: 0,
        approx_bytes: 1_400_000,
    },

    // ── PP-OCRv5 (真实 v5 模型：ModelScope RapidAI/RapidOCR onnx/PP-OCRv5) ──
    // SWHL/RapidOCR 只发布到 v4。此前这两个条目从 PP-OCRv4 的 URL 下载再存成
    // v5 文件名 —— 磁盘上的"v5"与 v4 字节完全相同（SHA-256 一致），界面标着
    // 「最新增强」实际就是 v4，切过去自然毫无变化。exact_bytes 用于识别并替换
    // 这批历史遗留的伪 v5 文件。
    ModelSpec {
        id: "ppocrv5-det",
        version: "v5",
        name: "PP-OCRv5 文本检测",
        file: "ch_PP-OCRv5_det_infer.onnx",
        urls: &[
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx",
        ],
        exact_bytes: 4_819_576,
        approx_bytes: 4_819_576,
    },
    ModelSpec {
        id: "ppocrv5-rec",
        version: "v5",
        name: "PP-OCRv5 文本识别",
        file: "ch_PP-OCRv5_rec_infer.onnx",
        urls: &[
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx",
        ],
        exact_bytes: 16_631_306,
        approx_bytes: 16_631_306,
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
        exact_bytes: 0,
        approx_bytes: 1_400_000,
    },

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
    // 实测 ~200ms，所有档位里最快(v3 295ms、v4 373ms)，体积也最小。代价是右栏
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
        // 尺寸不符 = 历史遗留的伪文件（如从 v4 URL 下来的"v5"）或下载残缺，
        // 报告为未安装，界面才会提示重新下载真实模型。
        installed: size > 0 && !is_stale_size(m, size),
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
        if meta.len() >= 64 * 1024 && !is_stale_size(spec, meta.len()) {
            return Ok(true);
        } else {
            // 0 字节/残缺下载，或尺寸不符的历史遗留伪文件（v5 曾指向 v4 的
            // URL）—— 释放文件锁后删除，走下面的重新下载。
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
    fn v5_specs_point_at_real_v5_models_not_v4() {
        // 回归：v5 曾从 PP-OCRv4 的 URL 下载再存成 v5 文件名，磁盘上的"v5"
        // 与 v4 字节完全相同，界面上的「最新增强」形同虚设。
        for spec in MODELS.iter().filter(|m| m.version == "v5" && m.id != "ppocrv5-cls") {
            assert!(
                !spec.urls.is_empty(),
                "{} 必须有下载源",
                spec.id
            );
            for u in spec.urls {
                assert!(
                    !u.contains("PP-OCRv4"),
                    "{} 不能从 v4 的 URL 下载: {}",
                    spec.id,
                    u
                );
                assert!(
                    u.contains("PP-OCRv5"),
                    "{} 的下载源必须是真实 v5 模型: {}",
                    spec.id,
                    u
                );
            }
            assert!(
                spec.exact_bytes > 0,
                "{} 需要精确尺寸校验，否则历史遗留的伪 v5 文件永远不会被替换",
                spec.id
            );
        }
    }

    #[test]
    fn stale_size_detection_flags_wrong_content_but_not_unversioned_models() {
        let v5_rec = MODELS
            .iter()
            .find(|m| m.id == "ppocrv5-rec")
            .expect("ppocrv5-rec spec");
        // 伪 v5（= v4 rec 的字节数）必须被判定为需重新下载
        assert!(is_stale_size(v5_rec, 10_857_958));
        // 真实 v5 尺寸通过
        assert!(!is_stale_size(v5_rec, v5_rec.exact_bytes));
        // 未安装（0 字节）不算 stale，由 installed 判定处理
        assert!(!is_stale_size(v5_rec, 0));
        // 未设精确尺寸的模型不做校验
        let v3_rec = MODELS
            .iter()
            .find(|m| m.id == "ppocrv3-rec")
            .expect("ppocrv3-rec spec");
        assert!(!is_stale_size(v3_rec, 12_345));
    }

    #[test]
    fn test_models_specs_contain_all_versions() {
        assert!(MODELS.iter().any(|m| m.version == "v3" && m.id == "ppocrv3-det"));
        assert!(MODELS.iter().any(|m| m.version == "v3" && m.id == "ppocrv3-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v4" && m.id == "ppocrv4-det"));
        assert!(MODELS.iter().any(|m| m.version == "v4" && m.id == "ppocrv4-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v5" && m.id == "ppocrv5-det"));
        assert!(MODELS.iter().any(|m| m.version == "v5" && m.id == "ppocrv5-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v6" && m.id == "ppocrv6-det"));
        assert!(MODELS.iter().any(|m| m.version == "v6" && m.id == "ppocrv6-rec"));
        assert!(MODELS.iter().any(|m| m.version == "v6t" && m.id == "ppocrv6t-det"));
        assert!(MODELS.iter().any(|m| m.version == "v6t" && m.id == "ppocrv6t-rec"));

        for spec in MODELS {
            assert!(!spec.urls.is_empty());
            assert!(spec.approx_bytes > 100_000);
            assert!(spec.file.ends_with(".onnx"));
        }
    }

    #[test]
    fn v6_variants_use_distinct_files_and_real_v6_sources() {
        // Small 与 Tiny 必须落在不同文件名，否则两档会互相覆盖。
        let files: Vec<&str> = MODELS
            .iter()
            .filter(|m| (m.version == "v6" || m.version == "v6t") && !m.id.ends_with("-cls"))
            .map(|m| m.file)
            .collect();
        assert_eq!(files.len(), 4, "v6/v6t 各需 det+rec 两个条目");
        let unique: std::collections::BTreeSet<&&str> = files.iter().collect();
        assert_eq!(unique.len(), 4, "v6 与 v6t 的模型文件名不能重复: {:?}", files);

        for spec in MODELS
            .iter()
            .filter(|m| (m.version == "v6" || m.version == "v6t") && !m.id.ends_with("-cls"))
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
