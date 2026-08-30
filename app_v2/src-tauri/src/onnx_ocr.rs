// Pure-Rust ONNX Runtime OCR engine (PP-OCRv3: det -> cls -> rec + CTC).
//
// Implements the PaddleOCR v3 pipeline natively in Rust via `ort` - no
// Python daemon needed. Pre/post-processing parameters mirror the reference
// `rapidocr_onnxruntime` implementation (which the legacy Python daemon
// uses), so outputs are comparable:
//
// - det: ch_PP-OCRv3_det_infer.onnx - DB [thresh 0.3 / box_thresh 0.5 / unclip 1.6]
// - cls: ch_ppocr_mobile_v2.0_cls_infer.onnx - 180-degree angle, thresh 0.9
// - rec: ch_PP-OCRv3_rec_infer.onnx - CRNN + CTC, chars from model metadata

use crate::models::{BoundingBox, OcrResult, TextBlock};
use ort::session::Session;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};

pub const DET_LIMIT_SIDE_LEN: f32 = 736.0;
/// det 输入最长边硬上限：全屏/大选区按比例缩到该边长内推理，控制 DBNet 耗时。
/// 保持 1280：det 耗时随面积增长，抬到 1600 会让检测慢 ~1.56×，而识别质量的
/// 提升由行并集与水平内边距承担，不需要靠放大 det 输入换取。
pub const DET_MAX_SIDE_LEN: f32 = 1280.0;
pub const DET_THRESH: f32 = 0.25;
pub const DET_BOX_THRESH: f32 = 0.5;
/// unclip 1.6（PP-OCR 参考值）。不要再往上调：2.0 会把 26px 文本框纵向膨胀到
/// ~33px，超过卡片内 ~30px 的行距，于是相邻行的框在 x 和 y 上同时相交——
/// 抹除补丁的邻居钳制随之失效，补丁把下一行文字整条盖住（用户可见的「文字被
/// 遮挡」）。行首/行尾被裁掉的笔画改由 union_boxes_into_rows 的**水平**内边距
/// 补齐，横向外扩不会造成跨行遮挡。
pub const DET_UNCLIP_RATIO: f32 = 1.6;

/// 当前激活模型版本对应的 unclip 外扩系数。
///
/// PP-OCRv6 的 det 连通区域本身就比 v3~v5 大：同一张图上，卡片的标题行与副
/// 标题行会被扩成一个 ~55px 高的框，沿用 1.6 会把两行并成一行，识别出
/// `x1xai/grok46deel`、`wan vdvieratomdel` 这类叠字乱码。v6 系列（Small 与
/// Tiny 共用同一代 det）需要更小的外扩才能把相邻行分开。
pub fn active_unclip_ratio() -> f32 {
    if get_active_version().to_ascii_lowercase().starts_with("v6") {
        1.0
    } else {
        DET_UNCLIP_RATIO
    }
}
pub const DET_MIN_SIZE: u32 = 3;
pub const CLS_IMG_H: usize = 48;
pub const CLS_IMG_W: usize = 192;
pub const CLS_THRESH: f32 = 0.9;
pub const REC_IMG_H: u32 = 48;
pub const REC_MAX_W: u32 = 3072;
pub const GLOBAL_MIN_HEIGHT: u32 = 30;
pub const GLOBAL_WIDTH_HEIGHT_RATIO: f32 = 20.0;

const DET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const DET_STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Resolve the directory holding the PP-OCR ONNX models.
/// Lookup order: env `CATWALK_OCR_MODELS_DIR`, then the app-data override
/// (set at startup — this is where user downloads land), then ./models
/// walking up ancestors, then the executable's parent dir.
static MODELS_DIR_OVERRIDE: OnceLock<std::path::PathBuf> = OnceLock::new();
static ACTIVE_VERSION: OnceLock<Mutex<String>> = OnceLock::new();

fn active_version_lock() -> &'static Mutex<String> {
    ACTIVE_VERSION.get_or_init(|| Mutex::new("v4".to_string()))
}

/// Get the currently active OCR model version ("v3" | "v4" | "v5" | "v6" | "v6t").
pub fn get_active_version() -> String {
    active_version_lock()
        .lock()
        .map(|g| {
            if g.is_empty() {
                "v6t".to_string()
            } else {
                g.clone()
            }
        })
        .unwrap_or_else(|_| "v6t".to_string())
}

/// Set the active OCR model version ("v3" | "v4" | "v5" | "v6" | "v6t").
pub fn set_active_version(ver: &str) {
    let clean_ver = match ver.to_ascii_lowercase().as_str() {
        "v3" | "ppocrv3" | "pp-ocrv3" => "v3",
        // v4 必须显式列出：旧版用 `_ => "v4"` 兜底，改成 v6t 兜底后如果不写
        // 这个分支，set_active_version("v4") 会被静默归到 v6t——表现为
        // 「选了 v4 却加载 v6Tiny」。
        "v4" | "ppocrv4" | "pp-ocrv4" => "v4",
        "v5" | "ppocrv5" | "pp-ocrv5" => "v5",
        // v6t 必须排在 v6 之前判定：两者前缀相同，顺序反了会把 Tiny 归到 Small。
        "v6t" | "ppocrv6t" | "pp-ocrv6-tiny" => "v6t",
        "v6" | "ppocrv6" | "pp-ocrv6" => "v6",
        // 未知值回退到默认档 v6Tiny（与 AppSettings 默认一致）
        _ => "v6t",
    };
    if let Ok(mut g) = active_version_lock().lock() {
        *g = clean_ver.to_string();
    }
}

/// Returns the model file triple `(det, rec, cls)` for the requested OCR version.
pub fn get_model_filenames_for_version(ver: &str) -> (&'static str, &'static str, &'static str) {
    match ver.to_ascii_lowercase().as_str() {
        "v3" | "ppocrv3" | "pp-ocrv3" => (
            "ch_PP-OCRv3_det_infer.onnx",
            "ch_PP-OCRv3_rec_infer.onnx",
            "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ),
        "v5" | "ppocrv5" | "pp-ocrv5" => (
            "ch_PP-OCRv5_det_infer.onnx",
            "ch_PP-OCRv5_rec_infer.onnx",
            "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ),
        "v6" | "ppocrv6" | "pp-ocrv6" => (
            "ch_PP-OCRv6_det_infer.onnx",
            "ch_PP-OCRv6_rec_infer.onnx",
            "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ),
        // v6t = PP-OCRv6 Tiny：det 1.8MB + rec 4.5MB，实测最快的一档
        //（同图 165ms，v4 为 373ms）。文件名与 v6 Small 区分，两档可共存。
        "v6t" | "ppocrv6t" | "pp-ocrv6-tiny" => (
            "ch_PP-OCRv6_tiny_det_infer.onnx",
            "ch_PP-OCRv6_tiny_rec_infer.onnx",
            "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ),
        _ => (
            "ch_PP-OCRv4_det_infer.onnx",
            "ch_PP-OCRv4_rec_infer.onnx",
            "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        ),
    }
}

/// Point the resolver at the app-data models directory (setup-time call).
pub fn set_models_dir_override(dir: std::path::PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let _ = MODELS_DIR_OVERRIDE.set(dir);
}

/// The app-data models directory, when set (used for status/download commands).
pub fn models_dir_override() -> Option<std::path::PathBuf> {
    MODELS_DIR_OVERRIDE.get().cloned()
}

/// Public view of resolve_models_dir for the download/status commands.
pub fn resolved_models_dir() -> Option<std::path::PathBuf> {
    resolve_models_dir()
}

/// Resolve the directory holding models for a specific version.
pub fn resolve_models_dir_for_version(ver: &str) -> Option<std::path::PathBuf> {
    let (det_file, rec_file, _) = get_model_filenames_for_version(ver);
    let exists = |dir: std::path::PathBuf| -> Option<std::path::PathBuf> {
        if dir.join(det_file).exists() && dir.join(rec_file).exists() {
            Some(dir)
        } else {
            None
        }
    };

    if let Ok(dir) = std::env::var("CATWALK_OCR_MODELS_DIR") {
        if let Some(p) = exists(std::path::PathBuf::from(dir)) {
            return Some(p);
        }
    }
    if let Some(dir) = MODELS_DIR_OVERRIDE.get() {
        if let Some(p) = exists(dir.clone()) {
            return Some(p);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors() {
            if let Some(p) = exists(ancestor.join("models")) {
                return Some(p);
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            if let Some(p) = exists(exe_dir.join("models")) {
                return Some(p);
            }
        }
    }
    None
}

fn resolve_models_dir() -> Option<std::path::PathBuf> {
    let active = get_active_version();
    if let Some(p) = resolve_models_dir_for_version(&active) {
        return Some(p);
    }
    // Fallback: check if other versions are installed
    for fallback_ver in ["v4", "v3", "v5", "v6", "v6t"] {
        if fallback_ver != active {
            if let Some(p) = resolve_models_dir_for_version(fallback_ver) {
                return Some(p);
            }
        }
    }
    None
}

/// True when the ONNX model files for the active (or any fallback) version exist.
pub fn model_files_present() -> bool {
    resolve_models_dir().is_some()
}

/// True when model files for a specific version exist.
pub fn model_files_present_for_version(ver: &str) -> bool {
    resolve_models_dir_for_version(ver).is_some()
}

struct Sessions {
    det: Session,
    rec: Session,
    cls: Session,
    /// Character decode table (index 0 = first real char, last = space).
    chars: Vec<String>,
}

static ONNX_ENGINE: OnceLock<Mutex<OnnxOcrEngine>> = OnceLock::new();

/// Global singleton accessor for the ONNX OCR engine.
pub fn get_engine() -> MutexGuard<'static, OnnxOcrEngine> {
    ONNX_ENGINE
        .get_or_init(|| Mutex::new(OnnxOcrEngine::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Module-level helper to unload engine sessions (releases Windows file locks).
pub fn unload_engine() {
    get_engine().unload();
}

/// Module-level helper to switch active version and reload sessions.
pub fn switch_active_version(ver: &str) -> Result<(), String> {
    let engine = get_engine();
    engine.switch_version(ver)?;
    crate::ocr::mark_onnx_ready();
    Ok(())
}

/// Module-level helper to recognize BMP bytes using the global singleton engine.
pub fn recognize_bmp(bmp: &[u8]) -> Result<OcrResult, String> {
    let engine = get_engine();
    engine.recognize_bmp(bmp)
}

/// Thread-safe ONNX OCR engine (sessions require `&mut` to run, so the engine
/// serializes inference under a mutex - fine for region-crop OCR).
pub struct OnnxOcrEngine {
    inner: Mutex<Option<Sessions>>,
    load_error: Mutex<Option<String>>,
}

impl Default for OnnxOcrEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl OnnxOcrEngine {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            load_error: Mutex::new(None),
        }
    }

    /// Unload the currently running ONNX runtime session instances.
    /// This immediately drops the session handles and releases Windows file locks on the .onnx files!
    pub fn unload(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = None;
        }
        if let Ok(mut err_slot) = self.load_error.lock() {
            *err_slot = None;
        }
    }

    /// Check if sessions are currently loaded in memory.
    pub fn is_loaded(&self) -> bool {
        self.inner.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// Hot-switch to a new model version (e.g. "v3", "v4", "v5").
    pub fn switch_version(&self, ver: &str) -> Result<(), String> {
        self.unload();
        set_active_version(ver);
        self.ensure_loaded()
    }

    pub fn ensure_loaded(&self) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "ONNX OCR lock poisoned".to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        match Self::load_sessions() {
            Ok(sess) => {
                *guard = Some(sess);
                if let Ok(mut err_slot) = self.load_error.lock() {
                    *err_slot = None;
                }
                Ok(())
            }
            Err(e) => {
                if let Ok(mut err_slot) = self.load_error.lock() {
                    *err_slot = Some(e.clone());
                }
                Err(e)
            }
        }
    }

    fn load_sessions() -> Result<Sessions, String> {
        let active = get_active_version();
        let (actual_ver, dir) = if let Some(d) = resolve_models_dir_for_version(&active) {
            (active, d)
        } else {
            // Check fallbacks if active version is not present
            let mut found = None;
            for fallback_ver in ["v4", "v3", "v5", "v6", "v6t"] {
                if let Some(d) = resolve_models_dir_for_version(fallback_ver) {
                    found = Some((fallback_ver.to_string(), d));
                    break;
                }
            }
            found.ok_or_else(|| {
                "ONNX OCR models not found (need det + rec + cls .onnx)".to_string()
            })?
        };

        let (det_name, rec_name, cls_name) = get_model_filenames_for_version(&actual_ver);

        let commit = |name: &str| -> Result<Session, String> {
            let mut file_path = dir.join(name);
            if !file_path.exists() {
                if let Some(ovr) = models_dir_override() {
                    if ovr.join(name).exists() {
                        file_path = ovr.join(name);
                    }
                }
            }
            Session::builder()
                .map_err(|e| format!("onnxruntime init failed: {}", e))?
                .commit_from_file(Path::new(&file_path))
                .map_err(|e| format!("failed to load {}: {}", name, e))
        };

        let det = commit(det_name)?;
        let rec = commit(rec_name)?;
        let cls = commit(cls_name)?;

        // Character table embedded in rec model metadata (one char per line).
        let raw = rec
            .metadata()
            .map_err(|e| format!("rec model metadata read failed: {}", e))?
            .custom("character")
            .or_else(|| rec.metadata().ok()?.custom("dict"))
            .ok_or_else(|| "rec model is missing 'character' metadata".to_string())?;

        let mut chars: Vec<String> = raw.lines().map(|l| l.to_string()).collect();
        if chars.len() < 100 {
            return Err("rec model character table looks truncated".to_string());
        }
        chars.push(" ".to_string()); // last index -> space

        Ok(Sessions { det, rec, cls, chars })
    }

    pub fn last_error(&self) -> Option<String> {
        self.load_error.lock().ok().and_then(|g| g.clone())
    }

    /// Run the full pipeline over a crop passed as 32bpp (BGRA) BMP bytes.
    pub fn recognize_bmp(&self, bmp: &[u8]) -> Result<OcrResult, String> {
        self.ensure_loaded()?;
        let (w, h) = decode_bmp_size(bmp)?;
        if w == 0 || h == 0 {
            return Ok(OcrResult { blocks: vec![] });
        }
        let bgr = bmp_to_bgr(bmp, w, h);

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "ONNX OCR lock poisoned".to_string())?;
        let sessions = guard.as_mut().ok_or("sessions not loaded")?;

        let (img_w, img_h) = (w as u32, h as u32);
        // 阶段耗时诊断：设 CATWALK_OCR_TIMING=1 时打印 det / rec 分解，
        // 用于定位「文字多时变慢」这类现场报告落在哪个阶段。
        let timing = std::env::var("CATWALK_OCR_TIMING").map(|v| v != "0").unwrap_or(false);
        let t_det = std::time::Instant::now();
        // Run DBNet text box detection (long menu bars are properly segmented into word boxes).
        let (map, mw, mh) = run_detection(sessions, &bgr, img_w, img_h)?;
        let mut boxes = postprocess_db(&map, mw, mh, img_w, img_h);
        let det_ms = t_det.elapsed().as_secs_f64() * 1000.0;

        // Fallback: if DBNet did not detect boxes on tiny/single-line crop, feed entire image to REC
        if boxes.is_empty() {
            boxes.push((0u32, 0u32, img_w, img_h));
        } else {
            boxes = sort_boxes_reading_order(boxes);
            // 丢弃映射回源图后高度不足的噪声条框：det 在纹理/渐变上的误检进入
            // rec 只会产出乱码并白白消耗一次推理。正常文本物理高度不会 <6px。
            boxes.retain(|(_, _, _, bh)| *bh >= 6);
        }

        // DBNet 在低对比度小字（灰色副标题等）上常把一行横向切成多个框，
        // 且切口往往落在词中间——两个框各自都不覆盖完整字形，逐框识别必然
        // 在切口处截断（"generation model" → "gene" + "tionmodel"）。
        // 按行聚类后取并集裁剪，对整行只做一次识别：rec 的裁剪来自原图，
        // 整行像素完整，切口区域自然被读出。行聚类用几何规则（垂直对齐 +
        // 水平间距上限），两栏排版不会并成一行。
        let boxes = union_boxes_into_rows(boxes, img_w);

        let t_rec = std::time::Instant::now();
        let rec_units = boxes.len();

        // 预处理全部行(必要时先做 180° 角度校正)，再按 rec 宽度排序分批推理。
        // 按宽度排序让同批的 padding 浪费最小；每批一次 `run` 取代逐行 `run`，
        // 省掉 N-1 次固定推理开销——行数越多收益越大(用户反馈的「文字多时明显
        // 变慢」正是每行一次推理的线性开销)。
        let mut prepared: Vec<(Vec<f32>, u32)> = Vec::with_capacity(rec_units);
        let mut kept_boxes: Vec<(u32, u32, u32, u32)> = Vec::with_capacity(rec_units);
        for (bx, by, bw, bh) in boxes {
            if bw == 0 || bh == 0 {
                continue;
            }
            let crop = crop_bgr(&bgr, w, h, bx, by, bw, bh);
            let needs_rot = if bw >= bh {
                false
            } else {
                classify_angle(sessions, &crop, bw, bh)?
            };
            let final_crop = if needs_rot {
                rotate180_bgr(&crop, bw, bh)
            } else {
                crop
            };
            prepared.push(rec_preprocess(&final_crop, bw, bh));
            kept_boxes.push((bx, by, bw, bh));
        }

        let mut order: Vec<usize> = (0..prepared.len()).collect();
        order.sort_by_key(|&i| prepared[i].1);
        // 同批宽度差不超过 1.6×：批内所有行都要 padding 到该批最大宽，宽度跨度
        // 过大时 padding 浪费的算力会吃掉合批省下的固定开销(实测：不限跨度时
        // 长短行混批几乎没有净收益)。
        let mut chunks: Vec<Vec<usize>> = Vec::new();
        for &i in &order {
            let w_i = prepared[i].1;
            let fits = chunks.last().is_some_and(|c: &Vec<usize>| {
                c.len() < REC_BATCH
                    && (w_i as f32) <= prepared[c[0]].1 as f32 * 1.6
            });
            if fits {
                chunks.last_mut().unwrap().push(i);
            } else {
                chunks.push(vec![i]);
            }
        }

        let mut recognized: Vec<Option<(String, f32)>> = vec![None; prepared.len()];
        for chunk in &chunks {
            let items: Vec<(Vec<f32>, u32)> =
                chunk.iter().map(|&i| prepared[i].clone()).collect();
            match recognize_prepared_batch(sessions, &items) {
                Ok(texts) => {
                    for (&i, t) in chunk.iter().zip(texts.into_iter()) {
                        recognized[i] = Some(t);
                    }
                }
                Err(e) => {
                    // 模型 batch 维固定为 1 时批量推理会失败 —— 逐条回退，
                    // 保证功能正确，只是回到原来的速度。
                    eprintln!("[OCR] rec 批量推理失败({})，回退逐行推理", e);
                    for &i in chunk {
                        let single = std::slice::from_ref(&prepared[i]);
                        recognized[i] = recognize_prepared_batch(sessions, single)?
                            .into_iter()
                            .next();
                    }
                }
            }
        }

        let mut blocks = Vec::new();
        for ((bx, by, bw, bh), res) in kept_boxes.into_iter().zip(recognized.into_iter()) {
            let Some((text, conf)) = res else { continue };
            // 统一 CJK 空格清理：PP-OCR rec 会在中日韩字符间偶发插入空格
            //（此前只有 WinRT 路径做了该清理），英文文本不受影响。
            let text = crate::ocr::clean_ocr_text(&text);
            if text.is_empty() {
                continue;
            }
            blocks.push(TextBlock {
                text,
                confidence: conf,
                box_rect: BoundingBox {
                    x: bx as i32,
                    y: by as i32,
                    width: bw,
                    height: bh,
                },
            });
        }

        if timing {
            let rec_ms = t_rec.elapsed().as_secs_f64() * 1000.0;
            eprintln!(
                "[OCR-TIMING] {}x{} det={:.1}ms rec={:.1}ms ({} 行, 均 {:.1}ms/行) 合计 {:.1}ms",
                img_w,
                img_h,
                det_ms,
                rec_ms,
                rec_units,
                rec_ms / (rec_units.max(1) as f64),
                det_ms + rec_ms
            );
        }

        Ok(OcrResult { blocks })
    }
}

// ---- BMP helpers ------------------------------------------------------------

fn decode_bmp_size(bmp: &[u8]) -> Result<(usize, usize), String> {
    if bmp.len() < 54 || &bmp[0..2] != b"BM" {
        return Err("invalid BMP header".to_string());
    }
    let w = u32::from_le_bytes([bmp[18], bmp[19], bmp[20], bmp[21]]) as usize;
    let h_raw = i32::from_le_bytes([bmp[22], bmp[23], bmp[24], bmp[25]]);
    let h = h_raw.unsigned_abs() as usize;
    if w == 0 || h == 0 || w > 20000 || h > 20000 {
        return Err(format!("BMP size abnormal {}x{}", w, h));
    }
    Ok((w, h))
}

/// 32bpp BGRA (top-down, negative-height rows) -> contiguous BGR.
fn bmp_to_bgr(bmp: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(w * h * 3);
    let stride = w * 4;
    for y in 0..h {
        let row = 54 + y * stride;
        let avail = bmp.len().saturating_sub(row);
        if avail < stride {
            break;
        }
        for x in 0..w {
            let i = row + x * 4;
            out.push(bmp[i]); // B
            out.push(bmp[i + 1]); // G
            out.push(bmp[i + 2]); // R
        }
    }
    out
}

fn crop_bgr(bgr: &[u8], w: usize, h: usize, x: u32, y: u32, bw: u32, bh: u32) -> Vec<u8> {
    let x0 = (x as usize).min(w);
    let y0 = (y as usize).min(h);
    let x1 = (x as usize + bw as usize).min(w);
    let y1 = (y as usize + bh as usize).min(h);
    let mut out = Vec::with_capacity((x1 - x0) * (y1 - y0) * 3);
    for row in y0..y1 {
        let start = row * w * 3 + x0 * 3;
        out.extend_from_slice(&bgr[start..start + (x1 - x0) * 3]);
    }
    out
}

// ---- Detection (DET) --------------------------------------------------------

/// Global histogram equalization independently on BGR 3 channels.
/// Builds a 256-bin cumulative distribution function (CDF) per channel
/// and maps intensities via lookup table to stretch contrast.
fn hist_equalize_bgr(img: &[u8], w: usize, h: usize) -> Vec<u8> {
    let total_pixels = match w.checked_mul(h) {
        Some(p) if p > 0 => p,
        _ => return img.to_vec(),
    };
    if img.len() < total_pixels.saturating_mul(3) {
        return img.to_vec();
    }

    let mut out = vec![0u8; total_pixels * 3];

    for c in 0..3 {
        let mut hist = [0u32; 256];
        for i in 0..total_pixels {
            hist[img[i * 3 + c] as usize] += 1;
        }

        let mut cdf = [0u32; 256];
        let mut acc = 0u32;
        for i in 0..256 {
            acc += hist[i];
            cdf[i] = acc;
        }

        let cdf_min = cdf.iter().copied().find(|&v| v > 0).unwrap_or(0);
        let mut lut = [0u8; 256];
        if (total_pixels as u32) > cdf_min {
            let denom = (total_pixels as u32 - cdf_min) as f32;
            for i in 0..256 {
                if cdf[i] >= cdf_min {
                    let v = ((cdf[i] - cdf_min) as f32 / denom) * 255.0;
                    lut[i] = v.round().clamp(0.0, 255.0) as u8;
                } else {
                    lut[i] = 0;
                }
            }
        } else {
            // All pixels have the same value; preserve original intensities.
            for i in 0..256 {
                lut[i] = i as u8;
            }
        }

        for i in 0..total_pixels {
            out[i * 3 + c] = lut[img[i * 3 + c] as usize];
        }
    }

    out
}

/// Resize + normalize + DET inference. Returns the (post-sigmoid) probability
/// map and its dims (mw, mh).
fn run_detection(
    sessions: &mut Sessions,
    bgr: &[u8],
    w: u32,
    h: u32,
) -> Result<(Vec<f32>, usize, usize), String> {
    let min_side = (w.min(h) as f32).max(1.0);
    let max_side = (w.max(h) as f32).max(1.0);
    // 小图放大提升小字召回（≤3x）；大图等比缩小钳制最长边控制 DBNet 耗时。
    // rec 的裁剪始终取自原图，因此缩小 det 输入只影响定位速度、不伤识别精度。
    let mut ratio = (DET_LIMIT_SIDE_LEN / min_side).clamp(1.0, 3.0);
    if max_side * ratio > DET_MAX_SIDE_LEN {
        ratio = DET_MAX_SIDE_LEN / max_side;
    }
    let rw = (((w as f32 * ratio).round() as u32 / 32).max(1)) * 32;
    let rh = (((h as f32 * ratio).round() as u32 / 32).max(1)) * 32;
    let resized = resize_bgr_bilinear(bgr, w, h, rw, rh);

    let use_he = std::env::var("ONNX_PREPROCESS_HE")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true);
    let det_img = if use_he {
        hist_equalize_bgr(&resized, rw as usize, rh as usize)
    } else {
        resized
    };

    // Normalize (hwc): (x/255 - mean) / std, then transpose to CHW.
    let mut input = vec![0f32; 3 * rw as usize * rh as usize];
    for y in 0..rh {
        for x in 0..rw {
            let px = (y * rw + x) as usize;
            for c in 0..3 {
                let val = det_img[px * 3 + c] as f32 / 255.0;
                input[c * (rh as usize * rw as usize) + px] = (val - DET_MEAN[c]) / DET_STD[c];
            }
        }
    }

    let arr = ndarray::Array4::from_shape_vec((1, 3, rh as usize, rw as usize), input)
        .map_err(|e| format!("det input shape error: {}", e))?;
    let input_value = ort::value::TensorRef::from_array_view(&arr)
        .map_err(|e| format!("det input build failed: {}", e))?;
    let outputs = sessions
        .det
        .run(ort::inputs![input_value])
        .map_err(|e| format!("det inference failed: {}", e))?;

    let view = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("det output extract failed: {}", e))?;
    let mh = view.shape().get(2).copied().unwrap_or(rh as usize);
    let mw = view.shape().get(3).copied().unwrap_or(rw as usize);
    // The det model already applies sigmoid internally, output is 0..1 prob.
    let map: Vec<f32> = view.iter().copied().collect();
    Ok((map, mw, mh))
}

/// DB post-processing (axis-aligned bbox variant, faithful to RapidOCR's
/// params): binarize at 0.3 -> dilate -> connected components -> bbox -> score
/// filter at 0.5 -> unclip at 1.6 -> size filters -> map back to source image.
fn postprocess_db(
    map: &[f32],
    mw: usize,
    mh: usize,
    src_w: u32,
    src_h: u32,
) -> Vec<(u32, u32, u32, u32)> {
    if mw == 0 || mh == 0 || map.len() < mw * mh {
        return Vec::new();
    }
    let mut seg = vec![false; mw * mh];
    for (i, v) in map.iter().take(mw * mh).enumerate() {
        seg[i] = *v > DET_THRESH;
    }

    // Dilation with 2x2 kernel (use_dilation=true in reference config).
    let mut dilated = seg.clone();
    for y in 0..mh {
        for x in 0..mw {
            let i = y * mw + x;
            if seg[i] {
                continue;
            }
            let mut hit = false;
            if x > 0 && seg[i - 1] {
                hit = true;
            }
            if y > 0 && seg[i - mw] {
                hit = true;
            }
            if !hit && x > 0 && y > 0 && seg[i - mw - 1] {
                hit = true;
            }
            if !hit && x + 1 < mw && y > 0 && seg[i - mw + 1] {
                hit = true;
            }
            if hit {
                dilated[i] = true;
            }
        }
    }
    drop(seg);

    // BFS connected components (4-neighbour).
    let mut visited = vec![false; mw * mh];
    let mut out: Vec<(u32, u32, u32, u32)> = Vec::new();
    let mut stack: Vec<usize> = Vec::with_capacity(1024);

    for start in 0..mw * mh {
        if !dilated[start] || visited[start] {
            continue;
        }
        stack.clear();
        stack.push(start);
        visited[start] = true;
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (usize::MAX, usize::MAX, 0usize, 0usize);
        let (mut count, mut score_sum) = (0u32, 0f32);

        while let Some(i) = stack.pop() {
            let (x, y) = (i % mw, i / mw);
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
            count += 1;
            score_sum += map[i];

            if x > 0 && !visited[i - 1] && dilated[i - 1] {
                visited[i - 1] = true;
                stack.push(i - 1);
            }
            if x + 1 < mw && !visited[i + 1] && dilated[i + 1] {
                visited[i + 1] = true;
                stack.push(i + 1);
            }
            if y > 0 && !visited[i - mw] && dilated[i - mw] {
                visited[i - mw] = true;
                stack.push(i - mw);
            }
            if y + 1 < mh && !visited[i + mw] && dilated[i + mw] {
                visited[i + mw] = true;
                stack.push(i + mw);
            }
        }

        let bw = (max_x - min_x + 1) as u32;
        let bh = (max_y - min_y + 1) as u32;
        if count < 1 || bw == 0 || bh == 0 {
            continue;
        }
        let score = score_sum / count as f32;
        if score < DET_BOX_THRESH {
            continue;
        }
        if bw < DET_MIN_SIZE || bh < DET_MIN_SIZE {
            continue;
        }

        // Unclip: expand bbox by distance = area*ratio/perimeter (both sides).
        let area = (bw as f32) * (bh as f32);
        let perimeter = 2.0 * (bw as f32 + bh as f32);
        let dist = (area * active_unclip_ratio() / perimeter).ceil() as usize;
        let ex0 = min_x.saturating_sub(dist);
        let ey0 = min_y.saturating_sub(dist);
        let ex1 = (max_x + dist).min(mw - 1);
        let ey1 = (max_y + dist).min(mh - 1);
        let (ew, eh) = ((ex1 - ex0 + 1) as u32, (ey1 - ey0 + 1) as u32);
        if ew < DET_MIN_SIZE + 2 || eh < DET_MIN_SIZE + 2 {
            continue;
        }

        // Map back into source image coordinates, clipped.
        let sx = ((ex0 as f32 / mw as f32) * src_w as f32).round() as i64;
        let sy = ((ey0 as f32 / mh as f32) * src_h as f32).round() as i64;
        let sw = ((ex1 as f32 / mw as f32) * src_w as f32).round() as i64 - sx;
        let sh = ((ey1 as f32 / mh as f32) * src_h as f32).round() as i64 - sy;
        let cx = sx.clamp(0, src_w as i64) as u32;
        let cy = sy.clamp(0, src_h as i64) as u32;
        let cw = sw.clamp(1, src_w as i64 - cx as i64) as u32;
        let ch = sh.clamp(1, src_h as i64 - cy as i64) as u32;
        out.push((cx, cy, cw, ch));
    }
    out
}

fn resize_bgr_bilinear(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    if sw == dw && sh == dh {
        return src.to_vec();
    }
    let mut out = vec![0u8; (dw * dh * 3) as usize];
    let (sw_f, sh_f, dw_f, dh_f) = (sw as f32, sh as f32, dw as f32, dh as f32);
    for dy in 0..dh {
        let sy = ((dy as f32 + 0.5) * sh_f / dh_f - 0.5).max(0.0);
        let sy0 = sy.floor() as u32;
        let sy1 = (sy0 + 1).min(sh - 1);
        let fy = sy - sy0 as f32;
        for dx in 0..dw {
            let sx = ((dx as f32 + 0.5) * sw_f / dw_f - 0.5).max(0.0);
            let sx0 = sx.floor() as u32;
            let sx1 = (sx0 + 1).min(sw - 1);
            let fx = sx - sx0 as f32;
            let (a, b, c, d) = (
                &src[(sy0 * sw + sx0) as usize * 3..],
                &src[(sy0 * sw + sx1) as usize * 3..],
                &src[(sy1 * sw + sx0) as usize * 3..],
                &src[(sy1 * sw + sx1) as usize * 3..],
            );
            for ch in 0..3 {
                let v = a[ch] as f32 * (1.0 - fx) * (1.0 - fy)
                    + b[ch] as f32 * fx * (1.0 - fy)
                    + c[ch] as f32 * (1.0 - fx) * fy
                    + d[ch] as f32 * fx * fy;
                out[(dy * dw + dx) as usize * 3 + ch] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

// ---- Angle classifier (CLS) ---------------------------------------------------

fn classify_angle(sessions: &mut Sessions, crop: &[u8], cw: u32, ch: u32) -> Result<bool, String> {
    let ratio = cw as f32 / ch as f32;
    let rw = if (CLS_IMG_H as f32 * ratio) > CLS_IMG_W as f32 {
        CLS_IMG_W
    } else {
        ((CLS_IMG_H as f32 * ratio).ceil() as usize).max(1)
    };
    let resized = resize_bgr_bilinear(crop, cw, ch, rw as u32, CLS_IMG_H as u32);

    let mut input = vec![0f32; 3 * CLS_IMG_H as usize * CLS_IMG_W as usize];
    for c in 0..3 {
        for y in 0..CLS_IMG_H {
            for x in 0..CLS_IMG_W {
                let v = if x < rw {
                    resized[(y * rw + x) * 3 + c] as f32 / 255.0
                } else {
                    0.0
                };
                input[c * CLS_IMG_H as usize * CLS_IMG_W as usize + y * CLS_IMG_W as usize + x] =
                    (v - 0.5) / 0.5;
            }
        }
    }

    let arr = ndarray::Array4::from_shape_vec(
        (1, 3, CLS_IMG_H as usize, CLS_IMG_W as usize),
        input,
    )
    .map_err(|e| format!("cls input shape error: {}", e))?;
    let input_value = ort::value::TensorRef::from_array_view(&arr)
        .map_err(|e| format!("cls input build failed: {}", e))?;
    let outputs = sessions
        .cls
        .run(ort::inputs![input_value])
        .map_err(|e| format!("cls inference failed: {}", e))?;
    let view = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("cls output extract failed: {}", e))?;
    let prob0 = view[[0, 0]];
    let prob1 = view[[0, 1]];
    Ok(prob1 > prob0 && prob1 > CLS_THRESH)
}

// ---- Recognition (REC + CTC) --------------------------------------------------

/// 同批推理的最大条数。rec 的单次输入很小(48×W)，ONNX Runtime 的每次
/// `run` 固定开销(线程唤醒/内存分配/图调度)与实际算力消耗同量级，因此把
/// 若干行拼成一个 batch 一次推完，比逐行推理明显快。
pub const REC_BATCH: usize = 8;

/// 把 BGR 裁剪预处理成 rec 输入：等比缩放到 H=48，归一化到 [-1,1] 的 CHW。
/// 返回 (归一化数据, 缩放后宽度)。
fn rec_preprocess(crop: &[u8], cw: u32, ch: u32) -> (Vec<f32>, u32) {
    let ratio = cw as f32 / ch.max(1) as f32;
    let rw = if (REC_IMG_H as f32 * ratio) > REC_MAX_W as f32 {
        REC_MAX_W
    } else {
        ((REC_IMG_H as f32 * ratio).ceil() as u32).max(1)
    };
    let resized = resize_bgr_bilinear(crop, cw, ch, rw, REC_IMG_H);
    let plane = rw as usize * REC_IMG_H as usize;
    let mut input = vec![0f32; 3 * plane];
    for y in 0..REC_IMG_H {
        for x in 0..rw {
            let px = (y * rw + x) as usize;
            for c in 0..3 {
                let v = resized[px * 3 + c] as f32 / 255.0;
                input[c * plane + px] = (v - 0.5) / 0.5;
            }
        }
    }
    (input, rw)
}

/// CTC 贪心解码 rec 输出中的第 `b` 条：blank 索引为 0，类别 i 对应 chars[i-1]
/// (RapidOCR 在字表前置了 blank)。
fn rec_decode(view: &ndarray::ArrayViewD<f32>, b: usize, chars: &[String]) -> (String, f32) {
    let seq_len = view.shape().get(1).copied().unwrap_or(0);
    let vocab = view.shape().get(2).copied().unwrap_or(0);
    let mut text = String::new();
    let mut conf_sum = 0f32;
    let mut conf_cnt = 0usize;
    let mut prev = 0usize;

    for t in 0..seq_len {
        let mut best = 0usize;
        let mut best_v = f32::MIN;
        for c in 0..vocab {
            let v = view[[b, t, c]];
            if v > best_v {
                best_v = v;
                best = c;
            }
        }
        if best == 0 || best == prev {
            prev = best;
            continue;
        }
        prev = best;
        let Some(ch) = chars.get(best - 1) else {
            continue;
        };
        text.push_str(ch);
        conf_sum += best_v;
        conf_cnt += 1;
    }
    let conf = if conf_cnt > 0 { conf_sum / conf_cnt as f32 } else { 0.0 };
    (text, conf)
}

/// 批量识别已预处理好的行(每项为 (归一化数据, 宽))。同批 padding 到该批最大
/// 宽度，一次推理解码整批。结果按输入顺序返回。
///
/// padding 值取 **0.0**(归一化空间)，与 PaddleOCR 的 `resize_norm_img` 一致
/// (它在零初始化的画布上拷贝归一化图像)。用 -1.0(纯黑)会让 rec 把补白读成
/// 内容,实测把最长的一行从 "Route once. Scale across models with better
/// pricing, better" 劣化成 "Route oncecale across modes with bette pricing.be"。
fn recognize_prepared_batch(
    sessions: &mut Sessions,
    items: &[(Vec<f32>, u32)],
) -> Result<Vec<(String, f32)>, String> {
    let batch = items.len();
    if batch == 0 {
        return Ok(Vec::new());
    }
    let max_w = items.iter().map(|(_, w)| *w).max().unwrap_or(1).max(1) as usize;
    let h = REC_IMG_H as usize;
    let plane = h * max_w;
    let mut input = vec![0.0f32; batch * 3 * plane];
    for (b, (data, w)) in items.iter().enumerate() {
        let w = *w as usize;
        for c in 0..3 {
            for y in 0..h {
                let src = c * (h * w) + y * w;
                let dst = b * (3 * plane) + c * plane + y * max_w;
                input[dst..dst + w].copy_from_slice(&data[src..src + w]);
            }
        }
    }

    let arr = ndarray::Array4::from_shape_vec((batch, 3, h, max_w), input)
        .map_err(|e| format!("rec batch shape error: {}", e))?;
    let input_value = ort::value::TensorRef::from_array_view(&arr)
        .map_err(|e| format!("rec batch input build failed: {}", e))?;
    let outputs = sessions
        .rec
        .run(ort::inputs![input_value])
        .map_err(|e| format!("rec batch inference failed: {}", e))?;
    let view = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("rec batch output extract failed: {}", e))?;
    if view.shape().first().copied().unwrap_or(0) < batch {
        return Err("rec batch output rows fewer than inputs".to_string());
    }
    Ok((0..batch)
        .map(|b| rec_decode(&view, b, &sessions.chars))
        .collect())
}

fn rotate180_bgr(img: &[u8], w: u32, h: u32) -> Vec<u8> {
    let mut out = vec![0u8; img.len()];
    for y in 0..h {
        for x in 0..w {
            let src = ((y * w + x) * 3) as usize;
            let dst = (((h - 1 - y) * w + (w - 1 - x)) * 3) as usize;
            out[dst..dst + 3].copy_from_slice(&img[src..src + 3]);
        }
    }
    out
}

// ---- Unit tests: pure functions (no model files needed) ---------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v6_family_uses_a_smaller_unclip_than_v3_to_v5() {
        // v6 的 det 连通区域天生更大，沿用 1.6 会把「模型名 + 副标题」并框，
        // 输出 `x1xai/grok46deel` 这类叠字乱码。Small 与 Tiny 共用同一代 det，
        // 两档都必须走 v6 专用系数。
        for ver in ["v6", "v6t", "PP-OCRv6", "pp-ocrv6-tiny"] {
            set_active_version(ver);
            assert_eq!(
                active_unclip_ratio(),
                1.0,
                "{} 应使用 v6 专用 unclip",
                ver
            );
        }
        for ver in ["v3", "v4", "v5"] {
            set_active_version(ver);
            assert_eq!(
                active_unclip_ratio(),
                DET_UNCLIP_RATIO,
                "{} 应使用 PP-OCR 参考值 1.6",
                ver
            );
        }
        set_active_version("v4");
    }

    #[test]
    fn v6_small_and_tiny_map_to_distinct_model_files() {
        // 两档必须能共存于同一目录：文件名相同会让切换档位读到上一档的权重。
        let (small_det, small_rec, _) = get_model_filenames_for_version("v6");
        let (tiny_det, tiny_rec, _) = get_model_filenames_for_version("v6t");
        assert_ne!(small_det, tiny_det);
        assert_ne!(small_rec, tiny_rec);
        // 版本归一化：Tiny 的别名不得落回 Small
        set_active_version("v6t");
        assert_eq!(get_active_version(), "v6t");
        set_active_version("v6");
        assert_eq!(get_active_version(), "v6");
        set_active_version("v4");
    }

    #[test]
    fn test_union_boxes_into_rows_merges_mid_word_fragments() {
        // Real-world case (gray subtitle "… video generation model"): DBNet
        // split the line at x≈1083/1095 with a 12px gap. The fragments must
        // become ONE rec unit whose union covers the full line, plus the
        // horizontal glyph-recovery pad (0.15×30 ≈ 5px each side).
        let rows = union_boxes_into_rows(vec![(951, 300, 132, 30), (1095, 307, 60, 18)], 1512);
        assert_eq!(rows, vec![(946, 300, 214, 30)]);
    }

    #[test]
    fn test_union_boxes_into_rows_keeps_separate_buttons() {
        // "Get API Key" / "Read Docs": 72px gap exceeds the gap cap — the
        // buttons stay independent recognition units.
        let rows = union_boxes_into_rows(vec![(151, 538, 116, 17), (339, 538, 98, 31)], 1512);
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn test_union_boxes_into_rows_separates_rows_and_columns() {
        // Same-row tail (4px gap) merges; a right-column box 246px away and a
        // line below stay separate — columns and rows never fuse.
        let rows = union_boxes_into_rows(
            vec![
                (148, 469, 385, 25),
                (537, 468, 168, 26),
                (951, 476, 185, 30),
                (916, 585, 357, 25),
            ],
            1512,
        );
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], (144, 468, 565, 26));
        assert_eq!(rows[1], (946, 476, 195, 30));
        assert_eq!(rows[2], (912, 585, 365, 25));
    }

    #[test]
    fn test_union_boxes_into_rows_pad_clamps_to_image_bounds() {
        // A row hugging both edges must not produce an out-of-image crop rect.
        let rows = union_boxes_into_rows(vec![(0, 10, 200, 40)], 200);
        assert_eq!(rows, vec![(0, 10, 200, 40)]);
    }

    #[test]
    fn test_resize_bilinear_identity() {
        let src = vec![1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        let out = resize_bgr_bilinear(&src, 2, 2, 2, 2);
        assert_eq!(out, src);
    }

    #[test]
    fn test_resize_bilinear_dims() {
        let src = vec![0u8; 2 * 3 * 3];
        let out = resize_bgr_bilinear(&src, 2, 3, 4, 6);
        assert_eq!(out.len(), 4 * 6 * 3);
    }

    #[test]
    fn test_crop_bgr_bounds() {
        let bgr = vec![0u8; 10 * 10 * 3];
        let crop = crop_bgr(&bgr, 10, 10, 2, 3, 5, 4);
        assert_eq!(crop.len(), 5 * 4 * 3);
        let crop2 = crop_bgr(&bgr, 10, 10, 8, 8, 10, 10);
        assert_eq!(crop2.len(), 2 * 2 * 3);
    }

    #[test]
    fn test_rotate180() {
        let img = vec![1, 2, 3, 4, 5, 6, 7, 8, 9];
        let rotated = rotate180_bgr(&img, 1, 3);
        let back = rotate180_bgr(&rotated, 1, 3);
        assert_eq!(back, img);
        assert_eq!(rotated.len(), 9);
    }

    #[test]
    fn test_postprocess_db_empty_map() {
        let map = vec![0.1f32; 64 * 64];
        let boxes = postprocess_db(&map, 64, 64, 640, 640);
        assert!(boxes.is_empty());
    }

    #[test]
    fn test_postprocess_db_single_box() {
        let mut map = vec![0.05f32; 64 * 64];
        for y in 20..44 {
            for x in 20..44 {
                map[y * 64 + x] = 1.0;
            }
        }
        let boxes = postprocess_db(&map, 64, 64, 640, 640);
        assert_eq!(boxes.len(), 1);
        let (bx, by, bw, bh) = boxes[0];
        // After dilation + 1.6x unclip the bbox expands beyond the 20..44 square.
        assert!(bx >= 60 && bx <= 120, "bx={}", bx);
        assert!(by >= 60 && by <= 120, "by={}", by);
        assert!(bw > 300 && bw < 560, "bw={}", bw);
        assert!(bh > 300 && bh < 560, "bh={}", bh);
    }

    #[test]
    fn test_postprocess_db_two_boxes() {
        let mut map = vec![0.05f32; 128 * 64];
        for y in 10..20 {
            for x in 10..30 {
                map[y * 128 + x] = 0.9;
            }
        }
        for y in 40..50 {
            for x in 90..110 {
                map[y * 128 + x] = 0.9;
            }
        }
        let boxes = postprocess_db(&map, 128, 64, 128, 64);
        assert_eq!(boxes.len(), 2);
    }

    #[test]
    fn test_char_layout_mapping() {
        // chars[i-1] mapping: class 2 -> chars[1]
        let chars = vec!["a".to_string(), "b".to_string(), " ".to_string()];
        assert_eq!(chars.get(1usize).unwrap(), "b");
        assert_eq!(chars.get(2usize).unwrap(), " ");
    }

    #[test]
    fn test_singleton_get_engine() {
        let engine = get_engine();
        assert!(engine.inner.lock().is_ok());
    }

    #[test]
    fn test_det_ratio_clamping() {
        // Small crop min_side 20 -> ratio clamped to 3.0
        let min_side_small = 20.0f32;
        let ratio_small = (DET_LIMIT_SIDE_LEN / min_side_small).clamp(1.0, 3.0);
        assert_eq!(ratio_small, 3.0);

        // Medium crop min_side 368 -> ratio 2.0
        let min_side_med = 368.0f32;
        let ratio_med = (DET_LIMIT_SIDE_LEN / min_side_med).clamp(1.0, 3.0);
        assert!((ratio_med - 2.0).abs() < 1e-4);

        // Large image min_side 1080 -> ratio clamped to 1.0
        let min_side_large = 1080.0f32;
        let ratio_large = (DET_LIMIT_SIDE_LEN / min_side_large).clamp(1.0, 3.0);
        assert_eq!(ratio_large, 1.0);
    }

    #[test]
    fn test_db_det_threshold_recall() {
        // DET_THRESH is 0.25, ensuring high recall for UI menus
        assert_eq!(DET_THRESH, 0.25);
        let mut map = vec![0.0f32; 64 * 64];
        // Score 0.28 (> 0.25 DET_THRESH)
        for y in 20..44 {
            for x in 20..44 {
                map[y * 64 + x] = 0.8;
            }
        }
        let boxes = postprocess_db(&map, 64, 64, 640, 640);
        assert_eq!(boxes.len(), 1);
    }

    #[test]
    fn test_hist_equalize_bgr_contrast_expansion() {
        let w = 10;
        let h = 10;
        // Degraded contrast: values clustered in a narrow range (30 vs 45)
        let mut low_contrast_img = Vec::with_capacity(w * h * 3);
        for y in 0..h {
            for x in 0..w {
                let val = if (x + y) % 2 == 0 { 30u8 } else { 45u8 };
                low_contrast_img.push(val); // B
                low_contrast_img.push(val); // G
                low_contrast_img.push(val); // R
            }
        }

        let equalized = hist_equalize_bgr(&low_contrast_img, w, h);
        assert_eq!(equalized.len(), w * h * 3);

        // Verify contrast expansion for each channel (max - min > 100)
        for c in 0..3 {
            let mut min_val = 255u8;
            let mut max_val = 0u8;
            for i in 0..(w * h) {
                let v = equalized[i * 3 + c];
                min_val = min_val.min(v);
                max_val = max_val.max(v);
            }
            let diff = max_val - min_val;
            assert!(
                diff > 100,
                "Equalized grayscale spread max - min should be > 100, got diff={}, min={}, max={}",
                diff,
                min_val,
                max_val
            );
        }
    }

    #[test]
    fn test_hist_equalize_bgr_edge_cases() {
        // Uniform color image: should safely preserve values without panic
        let uniform = vec![100u8; 10 * 10 * 3];
        let eq_uniform = hist_equalize_bgr(&uniform, 10, 10);
        assert_eq!(eq_uniform, uniform);

        // Empty / zero size
        let empty = hist_equalize_bgr(&[], 0, 0);
        assert!(empty.is_empty());
    }

    #[test]
    fn test_sort_boxes_reading_order() {
        let raw_boxes = vec![
            (100u32, 50u32, 50u32, 20u32), // line 2, word 2
            (10u32, 10u32, 40u32, 20u32),  // line 1, word 1
            (60u32, 12u32, 50u32, 20u32),  // line 1, word 2
            (10u32, 48u32, 40u32, 20u32),  // line 2, word 1
        ];
        let sorted = sort_boxes_reading_order(raw_boxes);
        assert_eq!(sorted.len(), 4);
        assert_eq!(sorted[0], (10, 10, 40, 20));
        assert_eq!(sorted[1], (60, 12, 50, 20));
        assert_eq!(sorted[2], (10, 48, 40, 20));
        assert_eq!(sorted[3], (100, 50, 50, 20));
    }

    #[test]
    fn test_model_filenames_for_versions() {
        let (v3_det, v3_rec, v3_cls) = get_model_filenames_for_version("v3");
        assert_eq!(v3_det, "ch_PP-OCRv3_det_infer.onnx");
        assert_eq!(v3_rec, "ch_PP-OCRv3_rec_infer.onnx");
        assert_eq!(v3_cls, "ch_ppocr_mobile_v2.0_cls_infer.onnx");

        let (v4_det, v4_rec, v4_cls) = get_model_filenames_for_version("v4");
        assert_eq!(v4_det, "ch_PP-OCRv4_det_infer.onnx");
        assert_eq!(v4_rec, "ch_PP-OCRv4_rec_infer.onnx");
        assert_eq!(v4_cls, "ch_ppocr_mobile_v2.0_cls_infer.onnx");

        let (v5_det, v5_rec, v5_cls) = get_model_filenames_for_version("v5");
        assert_eq!(v5_det, "ch_PP-OCRv5_det_infer.onnx");
        assert_eq!(v5_rec, "ch_PP-OCRv5_rec_infer.onnx");
        assert_eq!(v5_cls, "ch_ppocr_mobile_v2.0_cls_infer.onnx");

        let (v6_det, v6_rec, _) = get_model_filenames_for_version("v6");
        assert_eq!(v6_det, "ch_PP-OCRv6_det_infer.onnx");
        assert_eq!(v6_rec, "ch_PP-OCRv6_rec_infer.onnx");

        // v6t 与 v6 前缀相同：匹配顺序错了会把 Tiny 静默当成 Small 加载，
        // 表现为「选了极速档但速度没变」，因此把两档文件名分别锁死。
        let (v6t_det, v6t_rec, _) = get_model_filenames_for_version("v6t");
        assert_eq!(v6t_det, "ch_PP-OCRv6_tiny_det_infer.onnx");
        assert_eq!(v6t_rec, "ch_PP-OCRv6_tiny_rec_infer.onnx");
        assert_ne!(v6_det, v6t_det);
        assert_ne!(v6_rec, v6t_rec);
    }

    #[test]
    fn test_active_version_normalizes_v6_variants() {
        set_active_version("v6");
        assert_eq!(get_active_version(), "v6");
        set_active_version("pp-ocrv6-tiny");
        assert_eq!(get_active_version(), "v6t");
        set_active_version("v6t");
        assert_eq!(get_active_version(), "v6t");
        // 未知值回落到默认档 v6Tiny（与 AppSettings 默认一致）
        set_active_version("nonsense");
        assert_eq!(get_active_version(), "v6t");
        set_active_version("v4");
    }

    #[test]
    fn test_engine_unload_and_version_switching() {
        let engine = OnnxOcrEngine::new();
        assert!(!engine.is_loaded());
        engine.unload();
        assert!(!engine.is_loaded());
        assert!(engine.last_error().is_none());

        set_active_version("v3");
        assert_eq!(get_active_version(), "v3");
        set_active_version("v5");
        assert_eq!(get_active_version(), "v5");
        set_active_version("v4");
        assert_eq!(get_active_version(), "v4");

        unload_engine();
    }
}

/// Sort detected bounding boxes into natural top-to-bottom, left-to-right reading order
/// using line clustering (Y clustering with vertical overlap tolerance, X left-to-right sorting).
pub fn sort_boxes_reading_order(mut boxes: Vec<(u32, u32, u32, u32)>) -> Vec<(u32, u32, u32, u32)> {
    if boxes.len() <= 1 {
        return boxes;
    }

    // Sort boxes primarily by y coordinate, secondarily by x
    boxes.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));

    let mut lines: Vec<Vec<(u32, u32, u32, u32)>> = Vec::new();

    for b in boxes {
        let mut added = false;
        let y2 = b.1 as i32;
        let h2 = (b.3 as i32).max(1);

        for line in lines.iter_mut() {
            if let Some(first) = line.first() {
                let y1 = first.1 as i32;
                let h1 = (first.3 as i32).max(1);

                let overlap = (y1 + h1).min(y2 + h2) - y1.max(y2);
                let min_h = (h1.min(h2) as f32).max(1.0);
                let max_h = (h1.max(h2) as f32).max(1.0);

                let c1 = y1 as f32 + h1 as f32 * 0.5;
                let c2 = y2 as f32 + h2 as f32 * 0.5;
                let center_diff = (c1 - c2).abs();

                let is_same_line = (overlap > 0 && (overlap as f32 / min_h) >= 0.40)
                    || (center_diff <= max_h * 0.5);

                if is_same_line {
                    line.push(b);
                    added = true;
                    break;
                }
            }
        }

        if !added {
            lines.push(vec![b]);
        }
    }

    // Sort each line horizontally by x
    for line in lines.iter_mut() {
        line.sort_by_key(|b| b.0);
    }

    lines.into_iter().flatten().collect()
}

/// Merge same-row detection boxes into one AABB per visual line (rec unit).
///
/// DBNet splits low-contrast small text mid-line — each fragment recognized
/// alone truncates at the cut. Grouping boxes into rows via the geometric
/// line clusterer (vertical alignment + horizontal-gap cap, column-safe) and
/// recognizing the union crop instead reads the full line pixels from the
/// original image, so split regions come out complete.
///
/// Each row is then padded horizontally by ~0.25× its height (2..10px). DBNet
/// regularly clips the faint leading/trailing glyph of small gray UI text: the
/// clipped stem is missing from the rec crop (the word comes back truncated,
/// e.g. "MiniMax·video" → "Max-video") AND sits outside the reported box, so
/// the erase patch leaves it on screen as a ghost stroke beside the card. The
/// pad is deliberately small — under a typical icon/text gap, so it recovers
/// glyph stems without pulling a neighbouring logo into the crop. Vertical
/// padding stays 0: adjacent lines are far closer than adjacent glyphs.
pub fn union_boxes_into_rows(
    boxes: Vec<(u32, u32, u32, u32)>,
    img_w: u32,
) -> Vec<(u32, u32, u32, u32)> {
    if boxes.is_empty() {
        return boxes;
    }
    let blocks: Vec<TextBlock> = boxes
        .into_iter()
        .map(|(x, y, w, h)| TextBlock {
            text: String::new(),
            confidence: 1.0,
            box_rect: BoundingBox {
                x: x as i32,
                y: y as i32,
                width: w,
                height: h,
            },
        })
        .collect();
    crate::reconstruction::LineClusterer::cluster_into_lines(blocks, 8.0)
        .into_iter()
        .filter_map(|row| {
            let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
            for b in &row {
                x0 = x0.min(b.box_rect.x);
                y0 = y0.min(b.box_rect.y);
                x1 = x1.max(b.box_rect.x + b.box_rect.width as i32);
                y1 = y1.max(b.box_rect.y + b.box_rect.height as i32);
            }
            if row.is_empty() || x1 <= x0 || y1 <= y0 {
                return None;
            }
            let pad = (((y1 - y0) as f32 * 0.15).round() as i32).clamp(2, 6);
            x0 = (x0 - pad).max(0);
            x1 = (x1 + pad).min(img_w as i32);
            Some((x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32))
        })
        .collect()
}