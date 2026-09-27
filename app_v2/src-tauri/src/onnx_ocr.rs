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
/// det 输入最长边硬上限：全屏/大选区按比例等比缩小到 960 内推理，控制 DBNet 计算量。
/// 960 为 PaddleOCR 官方速度与精度黄金分割点，避免大图面积膨胀。
// 960px is fast, but it destroys small UI glyphs in 2K/4K selections before
// recognition ever sees them.  1600 keeps a 12px 4K glyph at roughly 5px in
// the detector while remaining bounded enough for interactive capture.
pub const DET_MAX_SIDE_LEN: f32 = 1600.0;
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
    unclip_ratio_for_version(&get_active_version())
}

fn unclip_ratio_for_version(version: &str) -> f32 {
    if version.to_ascii_lowercase().starts_with("v6") {
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

fn normalize_version(ver: &str) -> &'static str {
    match ver.to_ascii_lowercase().as_str() {
        "v3" | "ppocrv3" | "pp-ocrv3" => "v3",
        "v4" | "ppocrv4" | "pp-ocrv4" => "v4",
        "v5" | "ppocrv5" | "pp-ocrv5" => "v5",
        "v6t" | "ppocrv6t" | "pp-ocrv6-tiny" => "v6t",
        "v6" | "ppocrv6" | "pp-ocrv6" => "v6",
        _ => "v6t",
    }
}

/// Set the active OCR model version ("v3" | "v4" | "v5" | "v6" | "v6t").
pub fn set_active_version(ver: &str) {
    let clean_ver = normalize_version(ver);
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
    let version = normalize_version(ver);
    let (det_file, rec_file, cls_file) = get_model_filenames_for_version(version);
    let exists = |dir: std::path::PathBuf| -> Option<std::path::PathBuf> {
        if [det_file, rec_file, cls_file]
            .iter()
            .all(|file| model_file_is_usable(&dir, version, file))
        {
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

fn model_file_is_usable(dir: &std::path::Path, version: &str, file: &str) -> bool {
    let Some(spec) = crate::offline_models::MODELS
        .iter()
        .find(|spec| spec.version == version && spec.file == file)
    else {
        return false;
    };
    std::fs::metadata(dir.join(file))
        .map(|meta| {
            meta.is_file()
                && meta.len() >= 64 * 1024
                && !crate::offline_models::is_stale_size(spec, meta.len())
        })
        .unwrap_or(false)
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

/// Resolve the version that can actually be loaded.  Never let UI/settings say
/// one model while inference silently uses another one.
pub fn best_available_version(preferred: &str) -> Option<String> {
    let normalized = match preferred.to_ascii_lowercase().as_str() {
        "v3" | "ppocrv3" | "pp-ocrv3" => "v3",
        "v4" | "ppocrv4" | "pp-ocrv4" => "v4",
        "v5" | "ppocrv5" | "pp-ocrv5" => "v5",
        "v6" | "ppocrv6" | "pp-ocrv6" => "v6",
        "v6t" | "ppocrv6t" | "pp-ocrv6-tiny" => "v6t",
        _ => "v6t",
    };
    if model_files_present_for_version(normalized) {
        return Some(normalized.to_string());
    }
    // When a requested model is unavailable, prefer accuracy-oriented models
    // before Tiny. The real desktop fixtures show Tiny is faster but can split
    // terminal and dialog text more severely than v4.
    ["v6", "v5", "v4", "v3", "v6t"]
        .into_iter()
        .find(|v| model_files_present_for_version(v))
        .map(str::to_string)
}

/// Execution provider actually backing the ONNX session set.
///
/// 注册的 EP 不保证真正执行:DirectML 可能因驱动/虚拟机(WARP)静默退化,
/// 因此在启动时通过基准测试选快的一方,而不是盲信注册顺序。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Accelerator {
    DirectML,
    Cpu,
}

impl Accelerator {
    pub fn label(self) -> &'static str {
        match self {
            Accelerator::DirectML => "DirectML GPU 显卡加速",
            Accelerator::Cpu => "CPU 多线程",
        }
    }
}

/// Engine 当前的加速方式与基准数据(供 UI / 诊断展示)。
#[derive(Clone, Debug)]
pub struct AccelInfo {
    /// 实际用于推理的 EP(会话构建时已决定)。
    pub ep: Accelerator,
    /// true = 用户通过 `CATWALK_OCR_EP` 强制指定(或非 Windows 平台限定),
    /// false = 启动基准自动选择。
    pub forced: bool,
    /// 基准耗时(ms),仅 Windows auto 模式且有两次有效采样时存在。
    pub cpu_ms: Option<f64>,
    pub dml_ms: Option<f64>,
    /// 附加说明(如"DirectML EP 注册失败,回退 CPU 推理")。
    pub note: Option<String>,
}

struct Sessions {
    det: Session,
    rec: Session,
    cls: Session,
    /// Character decode table (index 0 = first real char, last = space).
    chars: Vec<String>,
    /// 实际选用的执行提供器(基准或强制决定)。
    ep: Accelerator,
    /// 输入张量复用缓冲:det/cls/rec 三个阶段在互斥锁内串行执行,
    /// 各自用完即释放,共享一块「下一个阶段取容量优先」的复用区即可。
    scratch: Vec<f32>,
    /// Model generation actually loaded (may differ from an unavailable saved
    /// preference during startup recovery).
    version: String,
}

/// 供 `ocr::runtime_status` 渲染成一句可读文案的加速方式描述。
pub fn accel_status_text() -> String {
    let Some(info) = get_engine().accel_info() else {
        return "加速方式待定".to_string();
    };
    let mut parts = Vec::new();
    if info.forced {
        parts.push(format!("{} (强制)", info.ep.label()));
    } else {
        parts.push(info.ep.label().to_string());
    }
    match (info.cpu_ms, info.dml_ms) {
        (Some(cpu), Some(dml)) if cpu > 0.0 && dml > 0.0 => {
            if info.ep == Accelerator::DirectML {
                parts.push(format!("基准较 CPU 快 {:.1}×", cpu / dml));
            } else {
                parts.push(format!("基准较 DirectML 快 {:.1}×", dml / cpu));
            }
        }
        _ => {}
    }
    if let Some(note) = &info.note {
        parts.push(note.clone());
    }
    parts.join(" · ")
}

static ONNX_ENGINE: OnceLock<Mutex<OnnxOcrEngine>> = OnceLock::new();
static ENSEMBLE_V3_ENGINE: OnceLock<OnnxOcrEngine> = OnceLock::new();
static ENSEMBLE_V6T_ENGINE: OnceLock<OnnxOcrEngine> = OnceLock::new();

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

fn ensemble_engine(version: &str) -> Option<&'static OnnxOcrEngine> {
    match normalize_version(version) {
        "v3" => Some(ENSEMBLE_V3_ENGINE.get_or_init(|| OnnxOcrEngine::new_for_version("v3"))),
        "v6t" => Some(ENSEMBLE_V6T_ENGINE.get_or_init(|| OnnxOcrEngine::new_for_version("v6t"))),
        _ => None,
    }
}

fn secondary_version_for(primary: &str) -> Option<&'static str> {
    let candidate = if normalize_version(primary) == "v6t" {
        "v3"
    } else {
        "v6t"
    };
    model_files_present_for_version(candidate).then_some(candidate)
}

/// Thread-safe ONNX OCR engine (sessions require `&mut` to run, so the engine
/// serializes inference under a mutex - fine for region-crop OCR).
pub struct OnnxOcrEngine {
    inner: Mutex<Option<Sessions>>,
    load_error: Mutex<Option<String>>,
    /// 最近一次成功加载时期的加速方式(会话卸载后清空)。
    accel: Mutex<Option<AccelInfo>>,
    /// Ensemble engines pin their own generation and never mutate the user's
    /// globally selected model. `None` is the normal user-facing engine.
    fixed_version: Option<String>,
    /// Small secondary passes are latency-sensitive; a second DirectML session
    /// adds queue/transfer overhead and benchmarked slower on real UI strips.
    force_cpu: bool,
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
            accel: Mutex::new(None),
            fixed_version: None,
            force_cpu: false,
        }
    }

    fn new_for_version(version: &str) -> Self {
        Self {
            inner: Mutex::new(None),
            load_error: Mutex::new(None),
            accel: Mutex::new(None),
            fixed_version: Some(normalize_version(version).to_string()),
            force_cpu: true,
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
        if let Ok(mut slot) = self.accel.lock() {
            *slot = None;
        }
    }

    /// 当前实际加速方式(仅会话加载成功后有值)。
    pub fn accel_info(&self) -> Option<AccelInfo> {
        self.accel.lock().ok().and_then(|g| g.clone())
    }

    /// Check if sessions are currently loaded in memory.
    pub fn is_loaded(&self) -> bool {
        self.inner.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// Hot-switch to a new model version (e.g. "v3", "v4", "v5").
    pub fn switch_version(&self, ver: &str) -> Result<(), String> {
        if !model_files_present_for_version(ver) {
            return Err(format!(
                "PP-OCR{} model is missing or has an invalid file size",
                normalize_version(ver).to_uppercase()
            ));
        }
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
        match Self::load_sessions(self.fixed_version.as_deref(), self.force_cpu) {
            Ok((sess, accel)) => {
                *guard = Some(sess);
                if let Ok(mut slot) = self.accel.lock() {
                    *slot = Some(accel);
                }
                if let Ok(mut err_slot) = self.load_error.lock() {
                    *err_slot = None;
                }
                Ok(())
            }
            Err(e) => {
                if let Ok(mut slot) = self.accel.lock() {
                    *slot = None;
                }
                if let Ok(mut err_slot) = self.load_error.lock() {
                    *err_slot = Some(e.clone());
                }
                Err(e)
            }
        }
    }

    fn load_sessions(
        requested_version: Option<&str>,
        force_cpu: bool,
    ) -> Result<(Sessions, AccelInfo), String> {
        let active = requested_version
            .map(normalize_version)
            .map(str::to_string)
            .unwrap_or_else(get_active_version);
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

        // CPU 侧推理线程数:每个模型会话各自一份,2..8 内按核数取。
        let cpu_threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(2, 8);
        // DirectML 在显卡上跑,`with_intra_threads` 帮不到 GPU 算子,反而为
        // det/rec/cls 各驻留一份无用线程池,固定为 1。
        const DML_INTRATHREADS: usize = 1;

        // EP 覆盖:CATWALK_OCR_EP=cpu|directml|auto(默认 auto 基准)。
        let ep_override = if force_cpu {
            Some("cpu".to_string())
        } else {
            std::env::var("CATWALK_OCR_EP")
                .ok()
                .map(|v| v.trim().to_ascii_lowercase())
                .filter(|v| !v.is_empty())
        };

        // 返回 (session, 该会话是否成功注册 DirectML)。DirectML 注册失败时
        // 内部退回 CPU builder,由 build 标记整组 ep=Cpu。
        let commit = |name: &str, dml: bool| -> Result<(Session, bool), String> {
            let mut file_path = dir.join(name);
            if !file_path.exists() {
                if let Some(ovr) = models_dir_override() {
                    if ovr.join(name).exists() {
                        file_path = ovr.join(name);
                    }
                }
            }
            let threads = if dml { DML_INTRATHREADS } else { cpu_threads };
            let mut builder = Session::builder()
                .map_err(|e| format!("onnxruntime init failed: {}", e))?
                .with_intra_threads(threads)
                .map_err(|e| format!("failed to configure intra threads: {}", e))?
                .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
                .map_err(|e| format!("failed to configure optimization level: {}", e))?;
            let mut dml_registered = false;
            if dml {
                #[cfg(target_os = "windows")]
                {
                    match builder.clone().with_execution_providers([
                        ort::ep::DirectML::default().build(),
                        ort::ep::CPU::default().build(),
                    ]) {
                        Ok(b) => {
                            builder = b;
                            dml_registered = true;
                        }
                        Err(e) => {
                            eprintln!("[OCR] DirectML EP 注册失败 ({})，回退 CPU 推理", e);
                        }
                    }
                }
            }
            let sess = builder
                .commit_from_file(Path::new(&file_path))
                .map_err(|e| format!("failed to load {}: {}", name, e))?;
            Ok((sess, dml_registered))
        };

        // 按 dml 与否构建整套会话。DirectML 注册失败时每个会话内部静默退回
        // CPU builder,整体 ep 标记为 Cpu —— 调用方据此决定是否还做基准。
        let build = |dml: bool| -> Result<Sessions, String> {
            let mut dml_ok = dml;
            let mut mk = |name: &str| -> Result<Session, String> {
                let (s, reg) = commit(name, dml)?;
                if dml && !reg {
                    dml_ok = false;
                }
                Ok(s)
            };
            let det = mk(det_name)?;
            let rec = mk(rec_name)?;
            let cls = mk(cls_name)?;

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

            Ok(Sessions {
                det,
                rec,
                cls,
                chars,
                ep: if dml && dml_ok {
                    Accelerator::DirectML
                } else {
                    Accelerator::Cpu
                },
                scratch: Vec::new(),
                version: actual_ver.clone(),
            })
        };

        #[cfg(target_os = "windows")]
        {
            match ep_override.as_deref() {
                Some("cpu") => {
                    let s = build(false)?;
                    let info = AccelInfo {
                        ep: Accelerator::Cpu,
                        forced: true,
                        cpu_ms: None,
                        dml_ms: None,
                        note: None,
                    };
                    Ok((s, info))
                }
                Some("directml") | Some("gpu") => {
                    let s = build(true)?;
                    let info = match s.ep {
                        Accelerator::DirectML => AccelInfo {
                            ep: Accelerator::DirectML,
                            forced: true,
                            cpu_ms: None,
                            dml_ms: None,
                            note: None,
                        },
                        Accelerator::Cpu => AccelInfo {
                            ep: Accelerator::Cpu,
                            forced: true,
                            cpu_ms: None,
                            dml_ms: None,
                            note: Some("DirectML EP 注册失败，回退 CPU 推理".to_string()),
                        },
                    };
                    Ok((s, info))
                }
                _ => {
                    // auto:两套都建,用同一合成图基准,选快的一方。
                    // 基准在启动预热线程内跑,不占首次识别的路径。
                    let mut cpu_s = build(false)?;
                    let mut dml_s = build(true)?;
                    if dml_s.ep == Accelerator::Cpu {
                        return Ok((
                            cpu_s,
                            AccelInfo {
                                ep: Accelerator::Cpu,
                                forced: false,
                                cpu_ms: None,
                                dml_ms: None,
                                note: Some("DirectML EP 注册失败，回退 CPU 推理".to_string()),
                            },
                        ));
                    }
                    let cpu_ms = Self::bench_sessions(&mut cpu_s)?;
                    let dml_ms = match Self::bench_sessions(&mut dml_s) {
                        Ok(v) => v,
                        Err(e) => {
                            eprintln!("[OCR] DirectML 基准推理失败 ({})，采用 CPU", e);
                            return Ok((
                                cpu_s,
                                AccelInfo {
                                    ep: Accelerator::Cpu,
                                    forced: false,
                                    cpu_ms: Some(cpu_ms),
                                    dml_ms: None,
                                    note: Some("DirectML 基准推理失败，回退 CPU".to_string()),
                                },
                            ));
                        }
                    };
                    // 真实场景下 DirectML 伴随多文本行切片的 PCIe 显存往返与 D3D12 命令开销。
                    // 仅当 DirectML 基准显著优于 CPU (>1.5×) 时才选用，否则采用无显存拷贝开销的高性能 CPU 多线程。
                    let (sess, ep) = if dml_ms * 1.5 < cpu_ms {
                        (dml_s, Accelerator::DirectML)
                    } else {
                        (cpu_s, Accelerator::Cpu)
                    };
                    eprintln!(
                        "[OCR] EP 基准: DirectML {:.1}ms vs CPU {:.1}ms → 选用 {}",
                        dml_ms,
                        cpu_ms,
                        ep.label()
                    );
                    Ok((
                        sess,
                        AccelInfo {
                            ep,
                            forced: false,
                            cpu_ms: Some(cpu_ms),
                            dml_ms: Some(dml_ms),
                            note: None,
                        },
                    ))
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let s = build(false)?;
            let info = AccelInfo {
                ep: Accelerator::Cpu,
                forced: true,
                cpu_ms: None,
                dml_ms: None,
                note: None,
            };
            Ok((s, info))
        }
    }

    /// 用固定合成图对一套会话做 1 次预热 + 2 次计时，返回 det+rec 最短合计毫秒。
    /// 包含 2 行文本切片批量推理，真实评估 GPU 队列与多核 CPU 的吞吐。
    /// 任一阶段推理失败返回 Err：该 EP 不可用，不应被基准选中。
    fn bench_sessions(sess: &mut Sessions) -> Result<f64, String> {
        let (bw, bh) = (400u32, 200u32);
        let bgr = synthetic_bgr(bw, bh);
        let crop = synthetic_bgr(160, 36);
        let mut best = f64::INFINITY;
        for rep in 0..3 {
            let t0 = std::time::Instant::now();
            run_detection(sess, &bgr, bw, bh).map_err(|e| format!("bench det: {}", e))?;
            let (data, rw) = rec_preprocess(&crop, 160, 36);
            let items = [(data.clone(), rw), (data, rw)];
            recognize_prepared_batch(sess, &items).map_err(|e| format!("bench rec: {}", e))?;
            let dt = t0.elapsed().as_secs_f64() * 1000.0;
            if rep > 0 {
                best = best.min(dt);
            }
        }
        Ok(best)
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
        let timing = std::env::var("CATWALK_OCR_TIMING")
            .map(|v| v != "0")
            .unwrap_or(false);
        let t_det = std::time::Instant::now();
        // Run DBNet text box detection (long menu bars are properly segmented into word boxes).
        // 检测 + DB 后处理都在 run_detection 内完成(score map 视图借用会话,
        // 就地后处理避免整图拷贝)。
        let mut boxes = run_detection(sessions, &bgr, img_w, img_h)?;
        let det_ms = t_det.elapsed().as_secs_f64() * 1000.0;

        // Fallback: if DBNet did not detect boxes on tiny/single-line crop, feed entire image to REC
        if boxes.is_empty() && img_h <= 96 && img_w <= img_h.saturating_mul(40) {
            // Whole-crop REC is only valid for a genuinely tiny/single-line
            // selection. Feeding an empty 4K/paragraph crop to REC compresses
            // the entire scene to 48px high and produces convincing garbage.
            boxes.push((0u32, 0u32, img_w, img_h));
        } else if !boxes.is_empty() {
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
        let mut crops_all: Vec<(Vec<u8>, u32, u32)> = Vec::with_capacity(rec_units);
        for (bx, by, bw, bh) in boxes {
            if bw == 0 || bh == 0 {
                continue;
            }
            kept_boxes.push((bx, by, bw, bh));
            crops_all.push((crop_bgr(&bgr, w, h, bx, by, bw, bh), bw, bh));
        }

        // 竖排框先顺时针旋转 90° 变为水平行，再整批做 180° 角度分类与文本识别：
        // 杜绝竖直文字未旋转直接送入 rec_preprocess 压缩成 4px 细条乱码
        let vertical_rotated: Vec<(Vec<u8>, u32, u32)> = crops_all
            .iter()
            .filter_map(|(crop, cw, ch)| {
                if *cw < *ch && !crop.is_empty() {
                    let rot = rotate90_cw_bgr(crop, *cw, *ch);
                    Some((rot, *ch, *cw))
                } else {
                    None
                }
            })
            .collect();
        let rot_refs: Vec<(&[u8], u32, u32)> = vertical_rotated
            .iter()
            .map(|(c, w, h)| (c.as_slice(), *w, *h))
            .collect();
        let rot_flags = classify_angles_batch(sessions, &rot_refs)?;
        let mut rot_iter = rot_flags.into_iter();
        let mut vert_iter = vertical_rotated.into_iter();

        for (crop, cw, ch) in crops_all {
            let (final_crop, final_w, final_h) = if cw < ch {
                let (rot90, rw, rh) = vert_iter
                    .next()
                    .unwrap_or_else(|| (rotate90_cw_bgr(&crop, cw, ch), ch, cw));
                let needs_180 = rot_iter.next().unwrap_or(false);
                let final_img = if needs_180 {
                    rotate180_bgr(&rot90, rw, rh)
                } else {
                    rot90
                };
                (final_img, rw, rh)
            } else {
                (crop, cw, ch)
            };
            prepared.push(rec_preprocess(&final_crop, final_w, final_h));
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
                c.len() < REC_BATCH && (w_i as f32) <= prepared[c[0]].1 as f32 * 1.6
            });
            if fits {
                chunks.last_mut().unwrap().push(i);
            } else {
                chunks.push(vec![i]);
            }
        }

        let mut recognized: Vec<Option<(String, f32)>> = vec![None; prepared.len()];
        for chunk in &chunks {
            let items: Vec<(Vec<f32>, u32)> = chunk.iter().map(|&i| prepared[i].clone()).collect();
            match recognize_prepared_batch(sessions, &items) {
                Ok(texts) => {
                    for (&i, t) in chunk.iter().zip(texts) {
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
        for ((bx, by, bw, bh), res) in kept_boxes.into_iter().zip(recognized) {
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

        // A dense toolbar is refined only after its first recognition. This is
        // important: a window title such as "Blender 5.2.1 LTS" is also wide
        // and shallow, but must remain intact; a dense CJK menu string such as
        // "文件编辑渲染窗口帮助" should be re-cut at real visual gutters.
        let dense_toolbar = blocks.iter().any(should_refine_dense_toolbar);
        blocks = refine_dense_toolbar_blocks(sessions, &bgr, img_w, img_h, blocks)?;
        if self.fixed_version.is_none() {
            if dense_toolbar {
                blocks = ensemble_dense_ui_blocks(bmp, &sessions.version, blocks);
            } else {
                blocks = review_suspicious_blocks(&bgr, img_w, img_h, &sessions.version, blocks);
            }
        }
        blocks = collapse_overlapping_ocr_blocks(blocks);

        if timing {
            let rec_ms = t_rec.elapsed().as_secs_f64() * 1000.0;
            eprintln!(
                "[OCR-TIMING] EP={} {}x{} det={:.1}ms rec={:.1}ms ({} 行, 均 {:.1}ms/行) 合计 {:.1}ms",
                sessions.ep.label(),
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

/// Encode a cropped BGR image as the 32bpp top-down BMP consumed by the OCR
/// pipeline. Used by targeted secondary-model checks so we do not re-run a
/// detector over the entire screenshot for one questionable label.
fn bgr_to_bmp(bgr: &[u8], w: usize, h: usize) -> Option<Vec<u8>> {
    if w == 0 || h == 0 || bgr.len() < w.checked_mul(h)?.checked_mul(3)? {
        return None;
    }
    let pixel_bytes = w.checked_mul(h)?.checked_mul(4)?;
    let file_bytes = 54usize.checked_add(pixel_bytes)?;
    if file_bytes > u32::MAX as usize || w > i32::MAX as usize || h > i32::MAX as usize {
        return None;
    }
    let mut bmp = vec![0u8; file_bytes];
    bmp[0..2].copy_from_slice(b"BM");
    bmp[2..6].copy_from_slice(&(file_bytes as u32).to_le_bytes());
    bmp[10..14].copy_from_slice(&54u32.to_le_bytes());
    bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
    bmp[18..22].copy_from_slice(&(w as i32).to_le_bytes());
    bmp[22..26].copy_from_slice(&(-(h as i32)).to_le_bytes());
    bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
    bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
    bmp[34..38].copy_from_slice(&(pixel_bytes as u32).to_le_bytes());
    for (src, dst) in bgr
        .chunks_exact(3)
        .take(w * h)
        .zip(bmp[54..].chunks_exact_mut(4))
    {
        dst[..3].copy_from_slice(src);
        dst[3] = 255;
    }
    Some(bmp)
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

/// Split a very wide, single-line detector box at sustained columns that contain
/// no glyph ink. This targets compact desktop toolbars where DBNet connects
/// several adjacent buttons into one polygon. Per-column medians make the test
/// work on light, dark, gradient and individually shaded button backgrounds.
fn split_wide_box_at_ink_valleys(
    bgr: &[u8],
    img_w: u32,
    img_h: u32,
    rect: (u32, u32, u32, u32),
) -> Vec<(u32, u32, u32, u32)> {
    let (bx, by, bw, bh) = rect;
    if bh < 8 || bw < bh.saturating_mul(6) || bx >= img_w || by >= img_h {
        return vec![rect];
    }
    let x1 = (bx + bw).min(img_w);
    let y1 = (by + bh).min(img_h);
    let cw = (x1 - bx) as usize;
    let ch = (y1 - by) as usize;
    if cw == 0 || ch == 0 || bgr.len() < img_w as usize * img_h as usize * 3 {
        return vec![rect];
    }

    let min_ink_pixels = (ch / 5).max(3);
    let mut active = vec![false; cw];
    let mut column = Vec::with_capacity(ch);
    for (local_x, is_active) in active.iter_mut().enumerate() {
        column.clear();
        for y in by as usize..y1 as usize {
            let i = (y * img_w as usize + bx as usize + local_x) * 3;
            let b = bgr[i] as u16;
            let g = bgr[i + 1] as u16;
            let r = bgr[i + 2] as u16;
            column.push(((29 * b + 150 * g + 77 * r) >> 8) as u8);
        }
        column.sort_unstable();
        let median = column[column.len() / 2];
        let contrast_pixels = column.iter().filter(|&&v| v.abs_diff(median) >= 24).count();
        *is_active = contrast_pixels >= min_ink_pixels;
    }

    let Some(content_start) = active.iter().position(|v| *v) else {
        return vec![rect];
    };
    let content_end = active.iter().rposition(|v| *v).unwrap_or(content_start);
    let min_valley = ((bh as f32 * 0.35).ceil() as usize).clamp(6, 12);
    let mut valleys = Vec::new();
    let mut cursor = content_start;
    while cursor <= content_end {
        if active[cursor] {
            cursor += 1;
            continue;
        }
        let start = cursor;
        while cursor <= content_end && !active[cursor] {
            cursor += 1;
        }
        if cursor - start >= min_valley {
            valleys.push((start, cursor)); // end is exclusive
        }
    }
    if valleys.is_empty() {
        return vec![rect];
    }

    let mut segments = Vec::with_capacity(valleys.len() + 1);
    let mut start = content_start;
    for (gap_start, gap_end) in valleys {
        if gap_start > start {
            let width = gap_start - start;
            if width >= 1 {
                segments.push((bx + start as u32, by, width as u32, y1 - by));
            }
        }
        start = gap_end;
    }
    if content_end + 1 > start {
        let width = content_end + 1 - start;
        if width >= 1 {
            segments.push((bx + start as u32, by, width as u32, y1 - by));
        }
    }

    if segments.len() >= 2 {
        segments
    } else {
        vec![rect]
    }
}

fn should_refine_dense_toolbar(block: &TextBlock) -> bool {
    let text = block.text.trim();
    let cjk_count = text
        .chars()
        .filter(|c| matches!(*c as u32, 0x3400..=0x9fff | 0xf900..=0xfaff))
        .count();
    let words: Vec<&str> = text.split_whitespace().collect();
    let short_word_row = words.len() >= 3
        && words.iter().all(|w| w.chars().count() <= 12)
        && !text
            .chars()
            .any(|c| c.is_ascii_digit() || "()（）.-".contains(c));
    block.box_rect.width >= block.box_rect.height.saturating_mul(6)
        && (cjk_count >= 4 || short_word_row)
}

fn refine_dense_toolbar_blocks(
    sessions: &mut Sessions,
    bgr: &[u8],
    img_w: u32,
    img_h: u32,
    blocks: Vec<TextBlock>,
) -> Result<Vec<TextBlock>, String> {
    let mut refined = Vec::with_capacity(blocks.len());
    for block in blocks {
        if !should_refine_dense_toolbar(&block) {
            refined.push(block);
            continue;
        }
        let rect = (
            block.box_rect.x.max(0) as u32,
            block.box_rect.y.max(0) as u32,
            block.box_rect.width,
            block.box_rect.height,
        );
        let pieces = split_wide_box_at_ink_valleys(bgr, img_w, img_h, rect);
        if pieces.len() < 2 {
            refined.push(block);
            continue;
        }

        let mut piece_blocks = Vec::with_capacity(pieces.len());
        for (x, y, w, h) in pieces {
            let crop = crop_bgr(bgr, img_w as usize, img_h as usize, x, y, w, h);
            let prepared = rec_preprocess(&crop, w, h);
            let recognized = recognize_prepared_batch(sessions, std::slice::from_ref(&prepared))?
                .into_iter()
                .next();
            let Some((text, confidence)) = recognized else {
                continue;
            };
            let text = crate::ocr::clean_ocr_text(&text);
            if !text.is_empty() {
                piece_blocks.push(TextBlock {
                    text,
                    confidence,
                    box_rect: BoundingBox {
                        x: x as i32,
                        y: y as i32,
                        width: w,
                        height: h,
                    },
                });
            }
        }
        if piece_blocks.len() >= 2 {
            refined.extend(piece_blocks);
        } else {
            refined.push(block);
        }
    }
    Ok(refined)
}

fn block_visual_units(text: &str) -> f32 {
    text.chars()
        .map(|c| {
            let cp = c as u32;
            if matches!(cp, 0x3400..=0x9fff | 0xf900..=0xfaff) {
                0.65
            } else if c.is_ascii_alphanumeric() {
                0.38
            } else if c.is_whitespace() {
                0.30
            } else {
                0.25
            }
        })
        .sum::<f32>()
        .max(0.5)
}

fn block_quality(block: &TextBlock) -> f32 {
    let expected_w = block_visual_units(block.text.trim()) * block.box_rect.height.max(1) as f32;
    let actual_w = block.box_rect.width.max(1) as f32;
    let geometry = (expected_w.min(actual_w) / expected_w.max(actual_w)).clamp(0.0, 1.0);
    block.confidence.clamp(0.0, 1.0) * 0.70 + geometry * 0.30
}

fn needs_secondary_review(block: &TextBlock) -> bool {
    let text = block.text.trim();
    let len = text.chars().filter(|c| !c.is_whitespace()).count();
    if !(2..=24).contains(&len) || block.box_rect.height < 7 {
        return false;
    }
    let expected_w = block_visual_units(text) * block.box_rect.height.max(1) as f32;
    let actual_w = block.box_rect.width as f32;
    // A detector may crop off the first/last glyph while the recognizer remains
    // overconfident about the fragment it can still see. Review both unusually
    // wide boxes and boxes too narrow to physically contain the recognized text.
    block.confidence < 0.66 || actual_w < expected_w * 0.55 || actual_w > expected_w * 2.1
}

fn overlap_over_smaller(a: &BoundingBox, b: &BoundingBox) -> f32 {
    let ax1 = a.x + a.width as i32;
    let ay1 = a.y + a.height as i32;
    let bx1 = b.x + b.width as i32;
    let by1 = b.y + b.height as i32;
    let iw = (ax1.min(bx1) - a.x.max(b.x)).max(0) as u64;
    let ih = (ay1.min(by1) - a.y.max(b.y)).max(0) as u64;
    let intersection = iw * ih;
    let smaller = ((a.width as u64 * a.height as u64).min(b.width as u64 * b.height as u64)).max(1);
    intersection as f32 / smaller as f32
}

fn compact_block_text(text: &str) -> String {
    text.chars().filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase).collect()
}

fn reconcile_overlapping_text(left: &str, right: &str) -> Option<String> {
    let left_key = compact_block_text(left);
    let right_key = compact_block_text(right);
    if left_key.chars().count() < 4 || right_key.chars().count() < 4 {
        return None;
    }
    if left_key == right_key {
        return Some(if left.chars().count() >= right.chars().count() {
            left.to_owned()
        } else {
            right.to_owned()
        });
    }
    if left_key.contains(right_key.as_str()) {
        return Some(left.to_owned());
    }
    if right_key.contains(left_key.as_str()) {
        return Some(right.to_owned());
    }
    // Prefix/suffix stitching requires literal characters; compacting spaces
    // would make the overlap index unsuitable for slicing the original text.
    if left.chars().any(char::is_whitespace) || right.chars().any(char::is_whitespace) {
        return None;
    }
    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    let max_overlap = left_chars.len().min(right_chars.len());
    for count in (4..=max_overlap).rev() {
        if left_chars[left_chars.len() - count..] == right_chars[..count]
            && count * 3 >= max_overlap
        {
            let mut merged = left.to_owned();
            merged.extend(right_chars[count..].iter().copied());
            return Some(merged);
        }
    }
    None
}

/// A second detector pass may see only the beginning of a long line and
/// attach one garbage glyph to that truncated copy. Suppress it only when
/// the two boxes begin at the same point and virtually all of the shorter
/// transcript agrees with the longer one; ordinary neighbouring controls
/// and genuinely different text must remain separate.
fn reconcile_truncated_duplicate(left: &str, right: &str) -> Option<String> {
    // OCR commonly alternates ASCII and full-width punctuation in otherwise
    // identical terminal paths. Fold only this punctuation for comparison;
    // keep the longer original transcript as the visible result.
    let fold = |text: &str| compact_block_text(text).chars().map(|c| match c {
        '：' => ':', '／' => '/', '＼' => '\\', _ => c,
    }).collect::<String>();
    let left_key = fold(left);
    let right_key = fold(right);
    let (long_text, long_key, short_key) = if left_key.chars().count() >= right_key.chars().count() {
        (left, left_key, right_key)
    } else {
        (right, right_key, left_key)
    };
    let long_chars: Vec<char> = long_key.chars().collect();
    let short_chars: Vec<char> = short_key.chars().collect();
    if short_chars.len() < 16 || long_chars.len() < short_chars.len() + 4 {
        return None;
    }
    let prefix = long_chars.iter().zip(short_chars.iter())
        .take_while(|(a, b)| a == b).count();
    (prefix >= 14 && prefix + 2 >= short_chars.len()).then(|| long_text.to_owned())
}

fn reconcile_embedded_word(left: &TextBlock, right: &TextBlock) -> Option<String> {
    let (long, short) = if left.box_rect.width >= right.box_rect.width {
        (left, right)
    } else {
        (right, left)
    };
    let word = short.text.trim();
    if !(3..=12).contains(&word.chars().count())
        || !word.chars().all(char::is_alphanumeric)
        || short.box_rect.width * 3 > long.box_rect.width
    {
        return None;
    }
    let long_words = long.text.split(|c: char| !c.is_alphanumeric());
    long_words
        .filter(|part| !part.is_empty())
        .any(|part| part.eq_ignore_ascii_case(word))
        .then(|| long.text.clone())
}

/// A close-tab glyph can be recognized both as a tiny "×" box and as an X
/// appended to the neighbouring title. Require both conflicting readings at
/// the same pixels before deleting anything; a real trailing X is preserved.
fn close_icon_suffix_boundary(left: &TextBlock, right: &TextBlock) -> Option<(usize, i32)> {
    let (long, short) = if left.box_rect.width >= right.box_rect.width {
        (left, right)
    } else {
        (right, left)
    };
    let long_text = long.text.trim_end();
    if !matches!(long_text.chars().last(), Some('X' | 'x'))
        || !short.text.chars().any(|c| matches!(c, '×' | '✕' | '✖'))
        || short.text.chars().count() > 3
        || short.box_rect.width > long.box_rect.height.saturating_mul(2)
    {
        return None;
    }
    let long_right = long.box_rect.x + long.box_rect.width as i32;
    let icon_left = short.box_rect.x;
    if icon_left < long_right - long.box_rect.height as i32 * 2
        || icon_left > long_right + long.box_rect.height as i32 / 2
        || icon_left - long.box_rect.x < long.box_rect.width as i32 / 2
    {
        return None;
    }
    Some((long_text.chars().count() - 1, icon_left - 3))
}

fn collapse_overlapping_ocr_blocks(mut blocks: Vec<TextBlock>) -> Vec<TextBlock> {
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    let mut i = 0;
    while i < blocks.len() {
        let mut j = i + 1;
        while j < blocks.len() {
            let a = blocks[i].box_rect;
            let b = blocks[j].box_rect;
            let center_a = a.y as f32 + a.height as f32 * 0.5;
            let center_b = b.y as f32 + b.height as f32 * 0.5;
            if (center_a - center_b).abs() > a.height.min(b.height) as f32 * 0.5
                || overlap_over_smaller(&a, &b) < 0.55
            {
                j += 1;
                continue;
            }
            let (left, right) = if a.x <= b.x { (i, j) } else { (j, i) };
            let same_origin = (a.x - b.x).abs() <= (a.height.min(b.height) as i32 / 3).max(3);
            if let Some((keep_chars, text_right)) =
                close_icon_suffix_boundary(&blocks[i], &blocks[j])
            {
                let mut long = if blocks[i].box_rect.width >= blocks[j].box_rect.width {
                    blocks[i].clone()
                } else {
                    blocks[j].clone()
                };
                let new_text: String = long.text.trim_end().chars().take(keep_chars)
                    .collect::<String>().trim_end().to_owned();
                let new_left = long.box_rect.x;
                if !new_text.is_empty() && text_right > new_left {
                    long.text = new_text;
                    long.box_rect.width = (text_right - new_left) as u32;
                    blocks[i] = long;
                    blocks.remove(j);
                    j = i + 1;
                    continue;
                }
            }
            let text = reconcile_overlapping_text(&blocks[left].text, &blocks[right].text)
                .or_else(|| {
                    (same_origin && overlap_over_smaller(&a, &b) >= 0.85)
                        .then(|| reconcile_truncated_duplicate(&blocks[left].text, &blocks[right].text))
                        .flatten()
                })
                .or_else(|| {
                    (overlap_over_smaller(&a, &b) >= 0.95)
                        .then(|| reconcile_embedded_word(&blocks[left], &blocks[right]))
                        .flatten()
                });
            let Some(text) = text
            else { j += 1; continue };
            let x = a.x.min(b.x);
            let y = a.y.min(b.y);
            let right_edge = (a.x + a.width as i32).max(b.x + b.width as i32);
            let bottom_edge = (a.y + a.height as i32).max(b.y + b.height as i32);
            blocks[i].text = text;
            blocks[i].confidence = blocks[i].confidence.min(blocks[j].confidence);
            blocks[i].box_rect = BoundingBox {
                x, y, width: (right_edge - x).max(1) as u32,
                height: (bottom_edge - y).max(1) as u32,
            };
            blocks.remove(j);
            j = i + 1;
        }
        i += 1;
    }
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    blocks
}

fn plausible_secondary_block(block: &TextBlock) -> bool {
    let len = block.text.chars().filter(|c| !c.is_whitespace()).count();
    len >= 2 && block.confidence >= 0.72 && block.box_rect.height >= 6
}

/// Dense toolbars receive one full-frame pass from a complementary model.
/// This is deliberately scene-gated: v6 Tiny stays the fast path for normal
/// screenshots, while menus with missing controls can recover boxes that the
/// primary detector never produced at all. Results are merged geometrically,
/// not blindly concatenated.
fn ensemble_dense_ui_blocks(
    bmp: &[u8],
    primary_version: &str,
    primary: Vec<TextBlock>,
) -> Vec<TextBlock> {
    let Some(secondary_version) = secondary_version_for(primary_version) else {
        return primary;
    };
    let Some(engine) = ensemble_engine(secondary_version) else {
        return primary;
    };
    let Ok(secondary_result) = engine.recognize_bmp(bmp) else {
        return primary;
    };

    merge_secondary_blocks(primary, secondary_result.blocks)
}

/// Recheck only ambiguous, compact text boxes with the complementary model.
/// The eight-box cap bounds worst-case latency on noisy full-screen captures.
fn review_suspicious_blocks(
    bgr: &[u8],
    img_w: u32,
    img_h: u32,
    primary_version: &str,
    mut primary: Vec<TextBlock>,
) -> Vec<TextBlock> {
    let Some(secondary_version) = secondary_version_for(primary_version) else {
        return primary;
    };
    let Some(engine) = ensemble_engine(secondary_version) else {
        return primary;
    };

    let review_indices: Vec<usize> = primary
        .iter()
        .enumerate()
        .filter(|(_, block)| needs_secondary_review(block))
        .take(8)
        .map(|(i, _)| i)
        .collect();
    for index in review_indices {
        let original = primary[index].clone();
        let bx = original.box_rect.x.max(0) as u32;
        let by = original.box_rect.y.max(0) as u32;
        let pad_x = (original.box_rect.height / 3).max(4);
        let pad_y = (original.box_rect.height / 4).max(3);
        let x0 = bx.saturating_sub(pad_x);
        let y0 = by.saturating_sub(pad_y);
        let x1 = bx
            .saturating_add(original.box_rect.width)
            .saturating_add(pad_x)
            .min(img_w);
        let y1 = by
            .saturating_add(original.box_rect.height)
            .saturating_add(pad_y)
            .min(img_h);
        if x1 <= x0 || y1 <= y0 {
            continue;
        }
        let crop = crop_bgr(
            bgr,
            img_w as usize,
            img_h as usize,
            x0,
            y0,
            x1 - x0,
            y1 - y0,
        );
        let Some(crop_bmp) = bgr_to_bmp(&crop, (x1 - x0) as usize, (y1 - y0) as usize) else {
            continue;
        };
        let Ok(result) = engine.recognize_bmp(&crop_bmp) else {
            continue;
        };
        let candidates: Vec<TextBlock> = result
            .blocks
            .into_iter()
            .filter(plausible_secondary_block)
            .map(|mut block| {
                block.box_rect.x += x0 as i32;
                block.box_rect.y += y0 as i32;
                block
            })
            .filter(|candidate| {
                overlap_over_smaller(&original.box_rect, &candidate.box_rect) >= 0.35
            })
            .collect();
        if candidates.is_empty() {
            continue;
        }
        let merged = merge_secondary_blocks(vec![original], candidates);
        if merged.len() == 1 {
            primary[index] = merged.into_iter().next().unwrap();
        }
    }
    primary.sort_by_key(|b| (b.box_rect.y, b.box_rect.x));
    primary
}

fn merge_secondary_blocks(
    mut primary: Vec<TextBlock>,
    secondary: Vec<TextBlock>,
) -> Vec<TextBlock> {
    for candidate in secondary.into_iter().filter(plausible_secondary_block) {
        let best_overlap = primary
            .iter()
            .enumerate()
            .map(|(i, existing)| {
                let overlap = overlap_over_smaller(&existing.box_rect, &candidate.box_rect);
                let exact_text_bonus = if existing.text == candidate.text {
                    2.0
                } else if existing.text.contains(&candidate.text)
                    || candidate.text.contains(&existing.text)
                {
                    0.5
                } else {
                    0.0
                };
                (i, overlap, overlap + exact_text_bonus)
            })
            .filter(|(_, overlap, _)| *overlap >= 0.45)
            .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));

        match best_overlap {
            Some((index, _, _)) => {
                let existing_quality = block_quality(&primary[index]);
                let candidate_quality = block_quality(&candidate);
                let existing_len = primary[index].text.chars().count();
                let candidate_len = candidate.text.chars().count();
                let recovers_missing_text = candidate_len > existing_len
                    && candidate.confidence >= 0.78
                    && candidate_quality >= existing_quality - 0.01;
                if candidate_quality > existing_quality + 0.035 || recovers_missing_text {
                    primary[index] = candidate;
                }
            }
            _ if candidate.confidence >= 0.86 && block_quality(&candidate) >= 0.68 => {
                primary.push(candidate);
            }
            _ => {}
        }
    }
    primary.sort_by_key(|b| (b.box_rect.y, b.box_rect.x));
    primary
}

// ---- Detection (DET) --------------------------------------------------------

/// 基准用合成图：白底 + 周期黑条纹，让 det 有真实形状可分、rec 有像素内容，
/// 耗时主要反映卷积/图调度开销而非 I/O。
fn synthetic_bgr(w: u32, h: u32) -> Vec<u8> {
    let mut bgr = vec![255u8; (w as usize * h as usize) * 3];
    let mut y = 4u32;
    while y < h {
        let mut x = 4u32;
        while x < w {
            let p = (y * w + x) as usize;
            bgr[p * 3] = 0;
            bgr[p * 3 + 1] = 0;
            bgr[p * 3 + 2] = 0;
            x += 3;
        }
        y += 16;
    }
    bgr
}

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
            for (i, item) in lut.iter_mut().enumerate() {
                *item = i as u8;
            }
        }

        for i in 0..total_pixels {
            out[i * 3 + c] = lut[img[i * 3 + c] as usize];
        }
    }

    out
}

/// det 输入直方图均衡化开关(ONNX_PREPROCESS_HE=1 开启)。
/// 与官方 PaddleOCR det 预处理一致，默认关闭：HE 每帧多两遍全图扫描，
/// 在 GPU 推理只占几毫秒的模型上，host 侧扫描的开销反而更显眼。
fn use_hist_equalize() -> bool {
    static HE: OnceLock<bool> = OnceLock::new();
    *HE.get_or_init(|| {
        std::env::var("ONNX_PREPROCESS_HE")
            .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or(true)
    })
}

/// Resize + normalize + DET inference. Returns the detected boxes (map is
/// post-processed here since the ORT output borrows the session's buffers —
/// keeping the postprocess inside avoids copying the score map out).
fn run_detection(
    sessions: &mut Sessions,
    bgr: &[u8],
    w: u32,
    h: u32,
) -> Result<Vec<(u32, u32, u32, u32)>, String> {
    let min_side = (w.min(h) as f32).max(1.0);
    let max_side = (w.max(h) as f32).max(1.0);
    // PaddleOCR 官方尺度自适应策略：
    // 1. 钳制大图最长边 (≤960)，控制 DBNet 卷积二次方增长的计算量；
    // 2. 仅在极窄极小截区（短边 < 48px）时平滑微调放大（≤2.0x），保证小字召回；
    // 3. 正常尺寸截区（如 640x160 等）保持 1:1 分辨率，绝不无脑按 300% 顶格放大 9 倍面积；
    // 4. rec 识别裁剪始终来自高清原图，因此该策略在获得极致提速的同时完全不伤识别精度。
    let mut ratio = 1.0f32;
    if max_side > DET_MAX_SIDE_LEN {
        ratio = DET_MAX_SIDE_LEN / max_side;
    } else if min_side < 48.0 {
        ratio = (48.0 / min_side).clamp(1.0, 2.0);
    }
    let rw = (((w as f32 * ratio) / 32.0).round() as u32).max(1) * 32;
    let rh = (((h as f32 * ratio) / 32.0).round() as u32).max(1) * 32;
    let resized = resize_bgr_bilinear(bgr, w, h, rw, rh);

    let det_img = if use_hist_equalize() {
        hist_equalize_bgr(&resized, rw as usize, rh as usize)
    } else {
        resized
    };

    // Normalize (hwc): (x/255 - mean) / std, then transpose to CHW。
    // 直接写会话共享的 scratch 缓冲 + 零拷贝视图输入，避免每帧新建张量。
    // 采用 split_at_mut 使三通道指针完全解耦，利于 LLVM 自动向量化。
    let hw = rw as usize * rh as usize;
    let scratch = &mut sessions.scratch;
    scratch.resize(3 * hw, 0.0);
    let (c0, rest) = scratch.split_at_mut(hw);
    let (c1, c2) = rest.split_at_mut(hw);
    let inv_255 = 1.0f32 / 255.0;
    let m0 = DET_MEAN[0];
    let m1 = DET_MEAN[1];
    let m2 = DET_MEAN[2];
    let s0 = DET_STD[0];
    let s1 = DET_STD[1];
    let s2 = DET_STD[2];
    for (px, chunk) in det_img.chunks_exact(3).enumerate().take(hw) {
        c0[px] = (chunk[0] as f32 * inv_255 - m0) / s0;
        c1[px] = (chunk[1] as f32 * inv_255 - m1) / s1;
        c2[px] = (chunk[2] as f32 * inv_255 - m2) / s2;
    }

    let arr = ndarray::ArrayView4::from_shape((1, 3, rh as usize, rw as usize), &scratch[..])
        .map_err(|e| format!("det input shape error: {}", e))?;
    let input_value = ort::value::TensorRef::from_array_view(arr)
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
    // 输出视图是连续行主序,借用切片直接后处理,不复制整张 score map。
    let map: std::borrow::Cow<'_, [f32]> = match view.as_slice() {
        Some(s) => std::borrow::Cow::Borrowed(s),
        None => std::borrow::Cow::Owned(view.iter().copied().collect()),
    };
    Ok(postprocess_db_for_version(
        &map,
        mw,
        mh,
        w,
        h,
        &sessions.version,
    ))
}

/// DB post-processing (axis-aligned bbox variant, faithful to RapidOCR's
/// params): binarize at 0.3 -> dilate -> connected components -> bbox -> score
/// filter at 0.5 -> unclip at 1.6 -> size filters -> map back to source image.
#[cfg(test)]
fn postprocess_db(
    map: &[f32],
    mw: usize,
    mh: usize,
    src_w: u32,
    src_h: u32,
) -> Vec<(u32, u32, u32, u32)> {
    postprocess_db_for_version(map, mw, mh, src_w, src_h, &get_active_version())
}

fn postprocess_db_for_version(
    map: &[f32],
    mw: usize,
    mh: usize,
    src_w: u32,
    src_h: u32,
    version: &str,
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
        let dist = (area * unclip_ratio_for_version(version) / perimeter).ceil() as usize;
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

    // 冗余外壳抑制（Containment & Ghost Row Suppression）：
    // 当存在一个小框 B 被一个大框 A 几乎完全包含（重叠面积占 B 的 80% 以上），
    // 且大框 A 的面积显著大于 B（> 2.0 倍），说明大框 A 是由于表格交替浅灰底纹或分割线
    // 引起的虚假连通外壳，必须剔除大框 A，保留精准贴合文字的单元格独立框。
    let mut suppressed = vec![false; out.len()];
    for i in 0..out.len() {
        if suppressed[i] {
            continue;
        }
        let (ax, ay, aw, ah) = out[i];
        let a_area = (aw as u64) * (ah as u64);

        for j in 0..out.len() {
            if i == j || suppressed[j] {
                continue;
            }
            let (bx, by, bw, bh) = out[j];
            let b_area = (bw as u64) * (bh as u64);
            if a_area <= (b_area * 2) {
                continue;
            }

            let inter_x0 = ax.max(bx);
            let inter_y0 = ay.max(by);
            let inter_x1 = (ax + aw).min(bx + bw);
            let inter_y1 = (ay + ah).min(by + bh);

            if inter_x1 > inter_x0 && inter_y1 > inter_y0 {
                let inter_area = ((inter_x1 - inter_x0) as u64) * ((inter_y1 - inter_y0) as u64);
                if (inter_area as f64) / (b_area as f64) >= 0.80 {
                    suppressed[i] = true;
                    break;
                }
            }
        }
    }

    out.into_iter()
        .enumerate()
        .filter(|(idx, _)| !suppressed[*idx])
        .map(|(_, b)| b)
        .collect()
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

/// 整批角度分类：输入为 (裁剪图, 宽, 高)，全部 pad 到 48×192，一次 `run`
/// 推完所有竖排框。返回与输入等长的旋转标志；batch 维固定为 1 的模型
/// 会失败，此时逐框回退(与旧行为一致)。
fn classify_angles_batch(
    sessions: &mut Sessions,
    crops: &[(&[u8], u32, u32)],
) -> Result<Vec<bool>, String> {
    let n = crops.len();
    if n == 0 {
        return Ok(Vec::new());
    }
    let plane = CLS_IMG_H * CLS_IMG_W;
    let scratch = &mut sessions.scratch;
    scratch.resize(n * 3 * plane, 0.0);
    for (b, (crop, cw, ch)) in crops.iter().enumerate() {
        let ratio = *cw as f32 / *ch as f32;
        let rw = if (CLS_IMG_H as f32 * ratio) > CLS_IMG_W as f32 {
            CLS_IMG_W
        } else {
            ((CLS_IMG_H as f32 * ratio).ceil() as usize).max(1)
        };
        let resized = resize_bgr_bilinear(crop, *cw, *ch, rw as u32, CLS_IMG_H as u32);
        for c in 0..3 {
            for y in 0..CLS_IMG_H {
                for x in 0..CLS_IMG_W {
                    let v = if x < rw {
                        resized[(y * rw + x) * 3 + c] as f32 / 255.0
                    } else {
                        0.0
                    };
                    scratch[b * 3 * plane + c * plane + y * CLS_IMG_W + x] = (v - 0.5) / 0.5;
                }
            }
        }
    }

    let arr = ndarray::ArrayView4::from_shape((n, 3, CLS_IMG_H, CLS_IMG_W), &scratch[..])
        .map_err(|e| format!("cls input shape error: {}", e))?;
    let input_value = ort::value::TensorRef::from_array_view(arr)
        .map_err(|e| format!("cls input build failed: {}", e))?;
    // 批处理推理放进闭包块:run 返回的 SessionOutputs 借用会话,块结束即释放,
    // 这样批处理失败时还能再次借用 sessions 走逐框回退。
    let flags: Result<Vec<bool>, String> = (|| {
        let outputs = sessions
            .cls
            .run(ort::inputs![input_value])
            .map_err(|e| format!("cls inference failed: {}", e))?;
        let view = outputs[0]
            .try_extract_array::<f32>()
            .map_err(|e| format!("cls output extract failed: {}", e))?;
        Ok((0..n)
            .map(|b| {
                let prob0 = view[[b, 0]];
                let prob1 = view[[b, 1]];
                prob1 > prob0 && prob1 > CLS_THRESH
            })
            .collect())
    })();
    match flags {
        Ok(v) => Ok(v),
        Err(_) => {
            // batch 维固定为 1 的旧模型:逐框回退,保证功能与旧速度一致。
            eprintln!("[OCR] cls 批量推理失败，回退逐框推理");
            let mut out = Vec::with_capacity(n);
            for (crop, cw, ch) in crops {
                out.push(classify_angle(sessions, crop, *cw, *ch)?);
            }
            Ok(out)
        }
    }
}

/// 单框角度分类(批量失败时的逐框回退路径)。
fn classify_angle(sessions: &mut Sessions, crop: &[u8], cw: u32, ch: u32) -> Result<bool, String> {
    let ratio = cw as f32 / ch as f32;
    let rw = if (CLS_IMG_H as f32 * ratio) > CLS_IMG_W as f32 {
        CLS_IMG_W
    } else {
        ((CLS_IMG_H as f32 * ratio).ceil() as usize).max(1)
    };
    let resized = resize_bgr_bilinear(crop, cw, ch, rw as u32, CLS_IMG_H as u32);

    let mut input = vec![0f32; 3 * CLS_IMG_H * CLS_IMG_W];
    for c in 0..3 {
        for y in 0..CLS_IMG_H {
            for x in 0..CLS_IMG_W {
                let v = if x < rw {
                    resized[(y * rw + x) * 3 + c] as f32 / 255.0
                } else {
                    0.0
                };
                input[c * CLS_IMG_H * CLS_IMG_W + y * CLS_IMG_W + x] = (v - 0.5) / 0.5;
            }
        }
    }

    let arr = ndarray::Array4::from_shape_vec((1, 3, CLS_IMG_H, CLS_IMG_W), input)
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
pub const REC_BATCH: usize = 16;

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
    let (c0, rest) = input.split_at_mut(plane);
    let (c1, c2) = rest.split_at_mut(plane);
    let inv_255_mul_2 = 2.0f32 / 255.0;
    for (px, chunk) in resized.chunks_exact(3).enumerate().take(plane) {
        c0[px] = chunk[0] as f32 * inv_255_mul_2 - 1.0;
        c1[px] = chunk[1] as f32 * inv_255_mul_2 - 1.0;
        c2[px] = chunk[2] as f32 * inv_255_mul_2 - 1.0;
    }
    (input, rw)
}

/// CTC 贪心解码 rec 输出中的第 `b` 条：blank 索引为 0，类别 i 对应 chars[i-1]
/// (RapidOCR 在字表前置了 blank)。
/// 优先走底层连续切片扫描 (chunks_exact)，消除 ndarray 动态三维多重索引的数百万次边界检查。
fn rec_decode(view: &ndarray::ArrayViewD<f32>, b: usize, chars: &[String]) -> (String, f32) {
    let seq_len = view.shape().get(1).copied().unwrap_or(0);
    let vocab = view.shape().get(2).copied().unwrap_or(0);
    if seq_len == 0 || vocab == 0 {
        return (String::new(), 0.0);
    }
    let mut text = String::new();
    let mut conf_sum = 0f32;
    let mut conf_cnt = 0usize;
    let mut prev = 0usize;

    // 快速路径：连续内存切片扫描
    if let Some(slice) = view.as_slice() {
        let b_stride = seq_len * vocab;
        let b_offset = b * b_stride;
        if b_offset + b_stride <= slice.len() {
            let b_slice = &slice[b_offset..b_offset + b_stride];
            for step_slice in b_slice.chunks_exact(vocab) {
                let mut best = 0usize;
                let mut best_v = f32::MIN;
                for (c, &v) in step_slice.iter().enumerate() {
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
                if let Some(ch) = chars.get(best - 1) {
                    text.push_str(ch);
                    conf_sum += best_v;
                    conf_cnt += 1;
                }
            }
            let conf = if conf_cnt > 0 {
                conf_sum / conf_cnt as f32
            } else {
                0.0
            };
            return (text, conf);
        }
    }

    // 兜底路径：非连续视图逐点索引
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
    let conf = if conf_cnt > 0 {
        conf_sum / conf_cnt as f32
    } else {
        0.0
    };
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
    let scratch = &mut sessions.scratch;
    scratch.resize(batch * 3 * plane, 0.0);
    for (b, (data, w)) in items.iter().enumerate() {
        let w = *w as usize;
        for c in 0..3 {
            for y in 0..h {
                let src = c * (h * w) + y * w;
                let dst = b * (3 * plane) + c * plane + y * max_w;
                scratch[dst..dst + w].copy_from_slice(&data[src..src + w]);
            }
        }
    }

    let arr = ndarray::ArrayView4::from_shape((batch, 3, h, max_w), &scratch[..])
        .map_err(|e| format!("rec batch shape error: {}", e))?;
    let input_value = ort::value::TensorRef::from_array_view(arr)
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

fn rotate90_cw_bgr(img: &[u8], w: u32, h: u32) -> Vec<u8> {
    let mut out = vec![0u8; img.len()];
    let new_w = h;
    for y in 0..h {
        for x in 0..w {
            let src = ((y * w + x) * 3) as usize;
            let dst_x = h - 1 - y;
            let dst_y = x;
            let dst = ((dst_y * new_w + dst_x) * 3) as usize;
            if src + 3 <= img.len() && dst + 3 <= out.len() {
                out[dst..dst + 3].copy_from_slice(&img[src..src + 3]);
            }
        }
    }
    out
}

// ---- Unit tests: pure functions (no model files needed) ---------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct MergeRegressionCase {
        name: String,
        primary: Vec<TextBlock>,
        secondary: Vec<TextBlock>,
        expected: Vec<String>,
    }

    #[test]
    fn v6_family_uses_a_smaller_unclip_than_v3_to_v5() {
        // v6 的 det 连通区域天生更大，沿用 1.6 会把「模型名 + 副标题」并框，
        // 输出 `x1xai/grok46deel` 这类叠字乱码。Small 与 Tiny 共用同一代 det，
        // 两档都必须走 v6 专用系数。
        for ver in ["v6", "v6t", "PP-OCRv6", "pp-ocrv6-tiny"] {
            set_active_version(ver);
            assert_eq!(active_unclip_ratio(), 1.0, "{} 应使用 v6 专用 unclip", ver);
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
    fn test_union_boxes_into_rows_preserves_table_columns() {
        // 表格同一行的 4 个独立单元格（间距 25px~40px，大于 14px 词缝合上限）
        // 必须严格保持为 4 个独立的识别框，绝不跨列合并成一条！
        let table_cells = vec![
            (50, 100, 100, 24), // 列1: x:50..150
            (180, 100, 80, 24), // 列2: x:180..260 (gap=30px)
            (300, 100, 90, 24), // 列3: x:300..390 (gap=40px)
            (425, 100, 70, 24), // 列4: x:425..495 (gap=35px)
        ];
        let rows = union_boxes_into_rows(table_cells, 800);
        assert_eq!(rows.len(), 4, "表格各列必须保持独立");
    }

    #[test]
    fn test_union_boxes_keeps_equal_height_compact_labels_separate() {
        // Same-row UI labels with equal typography are independent even when
        // their designer used only a 10px gutter.
        let rows = union_boxes_into_rows(vec![(10, 20, 36, 20), (56, 20, 36, 20)], 200);
        assert_eq!(rows.len(), 2);
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
    fn test_wide_toolbar_box_splits_at_real_ink_valley() {
        let (w, h) = (120u32, 16u32);
        let mut bgr = vec![20u8; (w * h * 3) as usize];
        // Two bright label-like glyph bands with an 10px empty toolbar gutter.
        for x in (14usize..45).chain(55usize..96) {
            for y in 3usize..13 {
                let i = (y * w as usize + x) * 3;
                bgr[i..i + 3].fill(220);
            }
        }
        let split = split_wide_box_at_ink_valleys(&bgr, w, h, (0, 0, w, h));
        assert_eq!(split.len(), 2);
        assert!(split[0].0 + split[0].2 <= split[1].0);
    }

    #[test]
    fn test_normal_word_box_is_not_projection_split() {
        let (w, h) = (70u32, 16u32);
        let bgr = vec![20u8; (w * h * 3) as usize];
        assert_eq!(
            split_wide_box_at_ink_valleys(&bgr, w, h, (0, 0, w, h)),
            vec![(0, 0, w, h)]
        );
    }

    #[test]
    fn test_toolbar_refinement_is_semantic_not_just_wide() {
        let make = |text: &str| TextBlock {
            text: text.into(),
            confidence: 0.95,
            box_rect: BoundingBox {
                x: 0,
                y: 0,
                width: 220,
                height: 18,
            },
        };
        assert!(should_refine_dense_toolbar(&make("文件编辑渲染窗口帮助")));
        assert!(should_refine_dense_toolbar(&make(
            "File Edit Render Window Help"
        )));
        assert!(!should_refine_dense_toolbar(&make("Blender 5.2.1 LTS")));
    }

    #[test]
    fn test_ensemble_merge_regression_corpus() {
        let cases: Vec<MergeRegressionCase> =
            serde_json::from_str(include_str!("../tests/fixtures/ocr_merge_cases.json"))
                .expect("OCR merge regression corpus must be valid JSON");
        assert!(
            !cases.is_empty(),
            "OCR merge regression corpus cannot be empty"
        );
        for case in cases {
            let merged = merge_secondary_blocks(case.primary, case.secondary);
            let actual: Vec<String> = merged.into_iter().map(|block| block.text).collect();
            assert_eq!(actual, case.expected, "case: {}", case.name);
        }
    }

    #[test]
    fn overlapping_terminal_boxes_are_stitched_without_joining_separate_controls() {
        let block = |text: &str, x: i32, y: i32, width: u32| TextBlock {
            text: text.into(), confidence: 0.95,
            box_rect: BoundingBox { x, y, width, height: 20 },
        };
        let input = vec![
            block("正在启动热重载开", 53, 160, 136),
            block("启动热重载开发调试服务", 88, 160, 193),
            block("VITEv7.3.6readyin239ms", 28, 389, 261),
            block("ready in 239 ms", 142, 389, 149),
            block("布局", 317, 29, 29),
            block("建模", 359, 29, 29),
        ];
        let actual = collapse_overlapping_ocr_blocks(input);
        assert_eq!(actual.len(), 4);
        assert!(actual.iter().any(|block| block.text == "正在启动热重载开发调试服务"));
        assert!(actual.iter().any(|block| block.text == "VITEv7.3.6readyin239ms"));
        assert!(actual.iter().any(|block| block.text == "布局"));
        assert!(actual.iter().any(|block| block.text == "建模"));
    }

    #[test]
    fn clipped_long_line_duplicate_is_removed_only_at_the_same_origin() {
        let block = |text: &str, x: i32, width: u32| TextBlock {
            text: text.into(), confidence: 0.95,
            box_rect: BoundingBox { x, y: 272, width, height: 24 },
        };
        let full = "Running BeforeDevCommand ('npm run dev')";
        let clipped = "RunningBeforeDevCommand餐";
        let merged = collapse_overlapping_ocr_blocks(vec![
            block(full, 53, 373), block(clipped, 54, 227),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, full);

        let distinct = collapse_overlapping_ocr_blocks(vec![
            block(full, 53, 373), block("RunningBeforeDevCommand: cancelled", 54, 227),
        ]);
        assert_eq!(distinct.len(), 2, "a genuinely different status must not be hidden");

        let offset = collapse_overlapping_ocr_blocks(vec![
            block(full, 53, 373), block(clipped, 90, 227),
        ]);
        assert_eq!(offset.len(), 2, "a different text origin is not a duplicate");
    }

    #[test]
    fn fullwidth_colon_in_truncated_path_does_not_duplicate_the_row() {
        let block = |text: &str, width: u32| TextBlock {
            text: text.into(), confidence: 0.95,
            box_rect: BoundingBox { x: 350, y: 481, width, height: 20 },
        };
        let long = "(C：\\Users\\20269\\Desktop\\项目文件夹\\翻译软件\\app";
        let short = "(C:\\Users\\20269\\Desktop\\项目文件";
        let merged = collapse_overlapping_ocr_blocks(vec![
            block(long, 421), block(short, 280),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, long);
    }

    #[test]
    fn close_tab_icon_is_not_appended_as_a_trailing_x() {
        let block = |text: &str, x: i32, y: i32, width: u32, height: u32| TextBlock {
            text: text.into(), confidence: 0.9,
            box_rect: BoundingBox { x, y, width, height },
        };
        let merged = collapse_overlapping_ocr_blocks(vec![
            block("npm list @tauri-apps/api @ta  X", 45, 13, 200, 21),
            block("×一", 224, 14, 17, 14),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, "npm list @tauri-apps/api @ta");
        assert_eq!(merged[0].box_rect.x + merged[0].box_rect.width as i32, 221);

        let real_x = collapse_overlapping_ocr_blocks(vec![
            block("variable X", 45, 13, 200, 21),
            block("help", 224, 14, 17, 14),
        ]);
        assert_eq!(real_x.len(), 2, "without a close glyph, a real X remains text");
    }

    #[test]
    fn exact_embedded_terminal_words_are_deduplicated_without_hiding_labels() {
        let block = |text: &str, x: i32, width: u32| TextBlock {
            text: text.into(), confidence: 0.95,
            box_rect: BoundingBox { x, y: 272, width, height: 24 },
        };
        let full = "Running BeforeDevCommand ('npm run dev')";
        let actual = collapse_overlapping_ocr_blocks(vec![
            block(full, 53, 373), block("npm", 298, 32), block("run", 340, 25),
            block("stop", 380, 36),
        ]);
        assert_eq!(actual.len(), 2);
        assert!(actual.iter().any(|item| item.text == full));
        assert!(actual.iter().any(|item| item.text == "stop"));

        let neighbour = collapse_overlapping_ocr_blocks(vec![
            block("Layout", 53, 70), block("run", 130, 25),
        ]);
        assert_eq!(neighbour.len(), 2);
    }

    #[test]
    fn test_secondary_review_is_gated_to_low_confidence_or_bad_geometry() {
        let make = |text: &str, confidence: f32, width: u32| TextBlock {
            text: text.into(),
            confidence,
            box_rect: BoundingBox {
                x: 0,
                y: 0,
                width,
                height: 18,
            },
        };
        assert!(needs_secondary_review(&make("玉字", 0.55, 42)));
        assert!(needs_secondary_review(&make("识别文字", 0.60, 36)));
        assert!(needs_secondary_review(&make("UV编辑", 1.0, 18)));
        assert!(!needs_secondary_review(&make("文件", 0.98, 20)));
        assert!(!needs_secondary_review(&make("x", 0.30, 30)));
    }

    #[test]
    fn test_bgr_to_bmp_round_trip_preserves_dimensions_and_channels() {
        let bgr = vec![10, 20, 30, 40, 50, 60];
        let bmp = bgr_to_bmp(&bgr, 2, 1).expect("valid BGR crop should encode");
        assert_eq!(decode_bmp_size(&bmp).unwrap(), (2, 1));
        assert_eq!(bmp_to_bgr(&bmp, 2, 1), bgr);
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
    fn test_rotate90_cw() {
        // 1x2 image (W=1, H=2, 3 bytes per pixel)
        let img = vec![10, 20, 30, 40, 50, 60];
        let rot1 = rotate90_cw_bgr(&img, 1, 2);
        // After 90° CW: W=2, H=1. Pixel 1 (40,50,60) at (0,0), Pixel 0 (10,20,30) at (1,0)
        assert_eq!(rot1, vec![40, 50, 60, 10, 20, 30]);

        // 4 rotations return to original
        let rot2 = rotate90_cw_bgr(&rot1, 2, 1);
        let rot3 = rotate90_cw_bgr(&rot2, 1, 2);
        let rot4 = rotate90_cw_bgr(&rot3, 2, 1);
        assert_eq!(rot4, img);
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
    fn stale_v5_files_cannot_masquerade_as_an_installed_model() {
        let dir = std::env::temp_dir().join(format!(
            "catwalk-ocr-model-check-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let stale_det = dir.join("ch_PP-OCRv5_det_infer.onnx");
        let stale_rec = dir.join("ch_PP-OCRv5_rec_infer.onnx");
        std::fs::File::create(&stale_det).unwrap().set_len(4_745_517).unwrap();
        std::fs::File::create(&stale_rec).unwrap().set_len(10_857_958).unwrap();
        assert!(!model_file_is_usable(&dir, "v5", "ch_PP-OCRv5_det_infer.onnx"));
        assert!(!model_file_is_usable(&dir, "v5", "ch_PP-OCRv5_rec_infer.onnx"));

        // Correct model sizes are accepted, but an incomplete three-model set
        // still cannot be selected because the shared orientation model is absent.
        std::fs::File::create(&stale_det).unwrap().set_len(4_819_576).unwrap();
        std::fs::File::create(&stale_rec).unwrap().set_len(16_631_306).unwrap();
        assert!(model_file_is_usable(&dir, "v5", "ch_PP-OCRv5_det_infer.onnx"));
        assert!(model_file_is_usable(&dir, "v5", "ch_PP-OCRv5_rec_infer.onnx"));
        assert!(!model_file_is_usable(&dir, "v5", "ch_ppocr_mobile_v2.0_cls_infer.onnx"));
        std::fs::remove_file(&stale_det).unwrap();
        std::fs::remove_file(&stale_rec).unwrap();
        std::fs::remove_dir(&dir).unwrap();
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
/// 行内细粒度文本切片拼接（微距缝合，坚决阻断跨列合并）：
///
/// DBNet 偶尔在低对比度或浅色文字处把单个词断成 2 个微小碎片（如 "generation model" 断成两截）。
/// 仅当同一行内相邻框水平间隙极小（gap <= 14px 且在字高合理比例内）时，才视为同一个词的切片碎片予以缝合；
/// 表格单元格之间、独立按钮之间、多栏文本之间的列间距（通常 >= 16px 或 > 0.5×字高）必须严格保持为独立识别框，
/// 从而保证每个单元格拥有精准的原位坐标，杜绝将整行所有列粗暴融合成一条巨型长句。
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
    let rows = crate::reconstruction::LineClusterer::cluster_into_lines(blocks, 8.0);
    let mut out = Vec::new();

    for mut row in rows {
        if row.is_empty() {
            continue;
        }
        // 同一行内按 X 升序排序
        row.sort_by_key(|b| b.box_rect.x);

        // 在行内进行细粒度词切片拼接：
        let mut current_group: Vec<&TextBlock> = vec![&row[0]];
        for b in row.iter().skip(1) {
            let last = current_group.last().unwrap();
            let last_right = last.box_rect.x + last.box_rect.width as i32;
            let gap = b.box_rect.x - last_right;
            let min_h = last.box_rect.height.min(b.box_rect.height) as f32;
            // Equal-height labels/buttons must not be fused merely because their
            // gutter is small. A wider recovery gap is allowed only when one box
            // is visibly a clipped fragment (large height mismatch).
            let max_h = last.box_rect.height.max(b.box_rect.height).max(1) as f32;
            let height_ratio = min_h / max_h;
            let normal_gap = (min_h * 0.35).clamp(4.0, 8.0);
            let fragment_gap = (min_h * 0.70).clamp(8.0, 12.0);
            let should_merge =
                (gap as f32) <= normal_gap || (height_ratio < 0.80 && (gap as f32) <= fragment_gap);

            if should_merge {
                current_group.push(b);
            } else {
                if let Some(rect) = merge_group_rect(&current_group, img_w) {
                    out.push(rect);
                }
                current_group = vec![b];
            }
        }
        if let Some(rect) = merge_group_rect(&current_group, img_w) {
            out.push(rect);
        }
    }
    out
}

fn merge_group_rect(group: &[&TextBlock], img_w: u32) -> Option<(u32, u32, u32, u32)> {
    if group.is_empty() {
        return None;
    }
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for b in group {
        x0 = x0.min(b.box_rect.x);
        y0 = y0.min(b.box_rect.y);
        x1 = x1.max(b.box_rect.x + b.box_rect.width as i32);
        y1 = y1.max(b.box_rect.y + b.box_rect.height as i32);
    }
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let pad = (((y1 - y0) as f32 * 0.15).round() as i32).clamp(2, 6);
    x0 = (x0 - pad).max(0);
    x1 = (x1 + pad).min(img_w as i32);
    Some((x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32))
}
