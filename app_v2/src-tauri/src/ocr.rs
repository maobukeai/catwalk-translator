pub use crate::models::{BoundingBox, OcrResult, PhysicalRect, TextBlock};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

// ─── Runtime status tracking ──────────────────────────────────────────────────
// 0 = idle, 1 = warming, 2 = ready, 3 = failed
static OCR_RUNTIME_STATE: AtomicU8 = AtomicU8::new(0);
// Rust-native ONNX engine: 0 = not attempted, 1 = warming, 2 = ready, 3 = failed
static ONNX_RUNTIME_STATE: AtomicU8 = AtomicU8::new(0);

pub fn mark_ocr_warming() {
    OCR_RUNTIME_STATE.store(1, Ordering::SeqCst);
}

fn mark_ocr_ready() {
    OCR_RUNTIME_STATE.store(2, Ordering::SeqCst);
}

fn mark_ocr_failed() {
    OCR_RUNTIME_STATE.store(3, Ordering::SeqCst);
}

pub fn mark_onnx_ready() {
    ONNX_RUNTIME_STATE.store(2, Ordering::SeqCst);
}

pub fn mark_onnx_failed() {
    ONNX_RUNTIME_STATE.store(3, Ordering::SeqCst);
}

/// True when the Rust-native ONNX engine is loaded and usable.
pub fn onnx_available() -> bool {
    ONNX_RUNTIME_STATE.load(Ordering::SeqCst) == 2
}

/// Human-readable runtime status of the OCR engines (ONNX / WinRT / RapidOCR).
pub fn runtime_status() -> crate::models::OcrEngineStatus {
    let active_ver = crate::onnx_ocr::get_active_version().to_uppercase();
    #[cfg(target_os = "windows")]
    {
        let rapid_state = OCR_RUNTIME_STATE.load(Ordering::SeqCst);
        let onnx_state = ONNX_RUNTIME_STATE.load(Ordering::SeqCst);
        let onnx_note = match onnx_state {
            // 状态文案与真实执行提供器一致:DirectML 可能注册失败或基准输给 CPU,
            // 由 onnx_ocr 的启动基准给出结论,不再无条件宣称"GPU 加速"。
            2 => format!(
                "· Rust 原生 PP-OCR{} 引擎已就绪 ({})",
                active_ver,
                crate::onnx_ocr::accel_status_text()
            ),
            3 => "· Rust 原生 ONNX 引擎加载失败".to_string(),
            _ => "· Rust 原生 ONNX 引擎待命".to_string(),
        };
        let detail = if rapid_state == 2 {
            format!(
                "Windows 原生 WinRT & RapidOCR 双引擎就绪 (<15ms 超高速识别) {}",
                onnx_note
            )
        } else {
            format!(
                "Windows 10/11 原生 WinRT 超高速 OCR 引擎已就绪 (原生驱动 · <15ms 零延迟识别) {}",
                onnx_note
            )
        };
        crate::models::OcrEngineStatus {
            status: "ready".to_string(),
            detail,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let onnx_state = ONNX_RUNTIME_STATE.load(Ordering::SeqCst);
        let ready_msg = format!("Rust 原生 PP-OCR{} ONNX 引擎已就绪 (纯离线推理)", active_ver);
        let (status, detail) = match (onnx_state, OCR_RUNTIME_STATE.load(Ordering::SeqCst)) {
            (2, _) => ("ready", ready_msg.as_str()),
            (3, _) => ("failed", "Rust ONNX 引擎加载失败，检查 models/ 目录"),
            (_, 2) => ("ready", "RapidOCR ONNX 引擎已就绪"),
            (_, 1) => ("warming", "OCR 引擎正在后台预热..."),
            (_, 0) => ("ready", "OCR 引擎待机，首次识别自动加载"),
            (_, 3) => ("failed", "OCR 引擎启动异常，请检查环境依赖"),
            _ => ("unknown", "未知引擎状态"),
        };
        crate::models::OcrEngineStatus {
            status: status.to_string(),
            detail: detail.to_string(),
        }
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/// Filter OCR results by confidence threshold.
pub fn filter_high_confidence(ocr: &OcrResult, threshold: f32) -> Vec<&TextBlock> {
    ocr.blocks
        .iter()
        .filter(|b| b.confidence >= threshold)
        .collect()
}

/// Build a minimal valid 4×4 pixel 32bpp BMP.
/// Used to pre-warm the RapidOCR daemon on app startup (forces ONNX model load)
/// so subsequent real OCR calls return in <100ms instead of 2-4s.
pub fn make_warmup_bmp() -> Vec<u8> {
    let w: u32 = 4;
    let h: u32 = 4;
    let pixel_bytes = (w * h * 4) as usize;
    let file_size = (54 + pixel_bytes) as u32;
    let mut bmp = vec![0u8; file_size as usize];
    bmp[0] = b'B';
    bmp[1] = b'M';
    bmp[2..6].copy_from_slice(&file_size.to_le_bytes());
    bmp[10..14].copy_from_slice(&54u32.to_le_bytes());
    bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
    bmp[18..22].copy_from_slice(&(w as i32).to_le_bytes());
    bmp[22..26].copy_from_slice(&(-(h as i32)).to_le_bytes());
    bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
    bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
    bmp[34..38].copy_from_slice(&(pixel_bytes as u32).to_le_bytes());
    // Fill with white pixels (0xFF BGRA)
    for chunk in bmp[54..].chunks_mut(4) {
        chunk[0] = 0xFF;
        chunk[1] = 0xFF;
        chunk[2] = 0xFF;
        chunk[3] = 0xFF;
    }
    bmp
}

/// Crop a rectangular region from a top-down 32bpp BMP byte buffer (including BMP header).
pub fn crop_bmp(
    bmp_data: &[u8],
    full_width: u32,
    full_height: u32,
    rect: PhysicalRect,
) -> Option<Vec<u8>> {
    if bmp_data.len() < 54 {
        return None;
    }
    let rx = rect.x.max(0) as u32;
    let ry = rect.y.max(0) as u32;
    let rw = rect.width.min(full_width.saturating_sub(rx));
    let rh = rect.height.min(full_height.saturating_sub(ry));

    if rw == 0 || rh == 0 {
        return None;
    }

    let pixel_len = (rw * rh * 4) as usize;
    let file_size = 54 + pixel_len;
    let mut out = vec![0u8; file_size];

    // BMP File Header (14 bytes)
    out[0] = b'B';
    out[1] = b'M';
    out[2..6].copy_from_slice(&(file_size as u32).to_le_bytes());
    out[10..14].copy_from_slice(&54u32.to_le_bytes());

    // DIB Header (40 bytes) — top-down rows (negative height)
    out[14..18].copy_from_slice(&40u32.to_le_bytes());
    out[18..22].copy_from_slice(&(rw as i32).to_le_bytes());
    out[22..26].copy_from_slice(&(-(rh as i32)).to_le_bytes());
    out[26..28].copy_from_slice(&1u16.to_le_bytes());
    out[28..30].copy_from_slice(&32u16.to_le_bytes());
    out[34..38].copy_from_slice(&(pixel_len as u32).to_le_bytes());

    for y in 0..rh {
        let src_y = ry + y;
        if src_y >= full_height {
            break;
        }
        let src_start = 54 + ((src_y * full_width + rx) * 4) as usize;
        let src_end = src_start + (rw * 4) as usize;
        let dst_start = 54 + (y * rw * 4) as usize;
        let dst_end = dst_start + (rw * 4) as usize;

        if src_end <= bmp_data.len() && dst_end <= out.len() {
            out[dst_start..dst_end].copy_from_slice(&bmp_data[src_start..src_end]);
        }
    }

    Some(out)
}

// ─── Persistent OCR Daemon ──────────────────────────────────────────────────────
//
// The Python process (core/ocr_daemon.py) is launched once and kept alive.
// Every OCR call just writes a JSON request to stdin and reads back the JSON
// response — no cold-start overhead, ~100-300ms per recognition (vs 3-8s).

struct OcrDaemon {
    child: Child,
    stdin: ChildStdin,
    /// 后台读线程持续泵送 daemon 输出，调用方用 recv_timeout 消费：
    /// 子进程卡死时读取端 20s 超时返回错误并重建 daemon，
    /// 而不是在全局锁内永久阻塞 read_line 拖挂全部 OCR 调用。
    rx: std::sync::mpsc::Receiver<String>,
    next_id: u64,
}

impl Drop for OcrDaemon {
    fn drop(&mut self) {
        // 主动终止子进程并回收，避免残留 python 僵尸进程
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Global singleton — None until first call to `execute_native_ocr`.
static OCR_DAEMON: OnceLock<Mutex<Option<OcrDaemon>>> = OnceLock::new();

/// Dynamically resolve project root directory where `core` module is located.
fn resolve_project_root() -> std::path::PathBuf {
    // 0. Explicit override via env var (deployment-friendly)
    if let Ok(env_root) = std::env::var("STARLING_T_APP_ROOT") {
        let p = std::path::PathBuf::from(env_root);
        if p.join("core").exists() {
            return p;
        }
        if p.join("legacy_python").join("core").exists() {
            return p.join("legacy_python");
        }
    }

    // 1. Try current working directory, walking ancestors
    if let Ok(cwd) = std::env::current_dir() {
        for dir in cwd.ancestors() {
            if dir.join("core").exists() {
                return dir.to_path_buf();
            }
            if dir.join("legacy_python").join("core").exists() {
                return dir.join("legacy_python");
            }
        }
    }

    // 2. Try executable directory, walking ancestors
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for dir in exe_dir.ancestors() {
                if dir.join("core").exists() {
                    return dir.to_path_buf();
                }
                if dir.join("legacy_python").join("core").exists() {
                    return dir.join("legacy_python");
                }
            }
        }
    }

    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn launch_daemon() -> Result<OcrDaemon, String> {
    let root = resolve_project_root();
    let mut cmd = Command::new("python");
    cmd.args(["-m", "core.ocr_daemon"])
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: prevent CMD window from flashing
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn OCR daemon: {}", e))?;

    let stdin = child.stdin.take().ok_or("Could not get daemon stdin")?;
    let stdout = child.stdout.take().ok_or("Could not get daemon stdout")?;

    // 后台读线程：把 daemon 输出逐行泵进通道（EOF/管道错误时退出）
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if tx.send(line).is_err() {
                        break; // 接收端已销毁（daemon 被重建），退出泵线程
                    }
                }
            }
        }
    });

    // Wait for the "ready" handshake (model pre-warm), 3.5s fast timeout with auto-kill
    let ready_line = match rx.recv_timeout(std::time::Duration::from_millis(3500)) {
        Ok(line) => line,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            return Err("OCR daemon ready handshake timed out (3.5s)".to_string());
        }
        // Disconnected = 读线程已退出：子进程启动后立刻死亡（如 python 存根/脚本缺失）
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            let _ = child.kill();
            return Err(
                "OCR daemon exited before ready handshake (process died at startup)".to_string(),
            )
        }
    };

    let val: serde_json::Value =
        serde_json::from_str(ready_line.trim()).unwrap_or(serde_json::Value::Null);

    if val.get("status").and_then(|s| s.as_str()) == Some("error") {
        let msg = val
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown")
            .to_string();
        return Err(format!("OCR daemon init error: {}", msg));
    }

    Ok(OcrDaemon {
        child,
        stdin,
        rx,
        next_id: 1,
    })
}

// ─── Windows Native WinRT OCR (Sub-20ms Ultra-Fast Extraction) ─────────────────

#[cfg(target_os = "windows")]
pub fn execute_winrt_ocr(crop_bmp_bytes: &[u8]) -> Result<OcrResult, String> {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    let stream = InMemoryRandomAccessStream::new()
        .map_err(|e| format!("WinRT stream create failed: {}", e))?;

    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|e| format!("WinRT writer create failed: {}", e))?;

    writer
        .WriteBytes(crop_bmp_bytes)
        .map_err(|e| format!("WinRT write bytes failed: {}", e))?;

    writer
        .StoreAsync()
        .map_err(|e| format!("WinRT store failed: {}", e))?
        .get()
        .map_err(|e| format!("WinRT store get failed: {}", e))?;

    writer
        .FlushAsync()
        .map_err(|e| format!("WinRT flush failed: {}", e))?
        .get()
        .map_err(|e| format!("WinRT flush get failed: {}", e))?;

    stream
        .Seek(0)
        .map_err(|e| format!("WinRT seek failed: {}", e))?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|e| format!("WinRT decoder create failed: {}", e))?
        .get()
        .map_err(|e| format!("WinRT decoder get failed: {}", e))?;

    let software_bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("WinRT bitmap get failed: {}", e))?
        .get()
        .map_err(|e| format!("WinRT bitmap async get failed: {}", e))?;

    let engine = Language::CreateLanguage(&HSTRING::from("zh-Hans-CN"))
        .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang))
        .or_else(|_| {
            Language::CreateLanguage(&HSTRING::from("zh-Hans"))
                .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang))
        })
        .or_else(|_| {
            Language::CreateLanguage(&HSTRING::from("zh-CN"))
                .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang))
        })
        .or_else(|_| OcrEngine::TryCreateFromUserProfileLanguages())
        .or_else(|_| {
            Language::CreateLanguage(&HSTRING::from("en-US"))
                .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang))
        })
        .map_err(|e| format!("WinRT OcrEngine init failed: {}", e))?;

    let ocr_result = engine
        .RecognizeAsync(&software_bitmap)
        .map_err(|e| format!("WinRT recognize failed: {}", e))?
        .get()
        .map_err(|e| format!("WinRT recognize get failed: {}", e))?;

    let lines = ocr_result
        .Lines()
        .map_err(|e| format!("WinRT get lines failed: {}", e))?;

    let mut blocks = Vec::new();
    for line in lines {
        let text = line
            .Text()
            .map_err(|e| format!("WinRT get text failed: {}", e))?
            .to_string();

        let cleaned_text = clean_ocr_text(&text);
        if cleaned_text.is_empty() {
            continue;
        }

        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;

        if let Ok(words_vec) = line.Words() {
            for word in words_vec {
                if let Ok(rect) = word.BoundingRect() {
                    min_x = min_x.min(rect.X.round() as i32);
                    min_y = min_y.min(rect.Y.round() as i32);
                    max_x = max_x.max((rect.X + rect.Width).round() as i32);
                    max_y = max_y.max((rect.Y + rect.Height).round() as i32);
                }
            }
        }

        let (x, y, width, height) = if min_x != i32::MAX && max_x != i32::MIN {
            (
                min_x,
                min_y,
                (max_x - min_x).max(1) as u32,
                (max_y - min_y).max(1) as u32,
            )
        } else {
            (0, 0, 100, 20)
        };

        blocks.push(TextBlock {
            text: cleaned_text,
            confidence: 0.99,
            box_rect: BoundingBox {
                x,
                y,
                width,
                height,
            },
        });
    }

    mark_ocr_ready();
    Ok(OcrResult { blocks })
}

pub(crate) fn clean_ocr_text(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    let mut cleaned = String::with_capacity(trimmed.len());
    let is_ideograph = |c: char| matches!(c, '\u{3400}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}');
    let is_cjk_punctuation = |c: char| matches!(c,
        '\u{3001}'..='\u{303F}' | '\u{FF01}'..='\u{FF60}' | '“' | '”' | '‘' | '’'
    );
    for i in 0..chars.len() {
        let current = chars[i];
        if current == ' ' || current == '\u{3000}' || current == '\t' {
            let previous = chars[..i].iter().rev().copied().find(|c| !c.is_whitespace());
            let next = chars[i + 1..].iter().copied().find(|c| !c.is_whitespace());
            if let (Some(left), Some(right)) = (previous, next) {
                // WinRT commonly returns "有 ， 而且". Chinese punctuation
                // and continuous Han text do not need OCR-invented gutters.
                if (is_ideograph(left) && is_ideograph(right))
                    || is_cjk_punctuation(left) || is_cjk_punctuation(right)
                    || (is_ideograph(left) && matches!(right, '"' | '/' | '\''))
                    || (is_ideograph(right) && matches!(left, '"' | '/' | '\''))
                {
                    continue;
                }
            }
            if !cleaned.ends_with(' ') {
                cleaned.push(' ');
            }
        } else {
            cleaned.push(current);
        }
    }
    // Conservative exact-token repairs for recurrent CJK glyph confusions in
    // desktop UI fonts. These source forms are not normal interface words, so
    // correcting them avoids poisoning both translation and cache keys without
    // fuzzy-rewriting arbitrary user text.
    let mut cleaned = cleaned
        .replace("(末保存)", "(未保存)")
        .replace("（末保存）", "（未保存）");
    // WinRT can split the apostrophe in the common account-security phrase
    // "You'll stay signed in" into a comma plus two capital-I glyphs. Repair
    // only this strongly identifying context; never rewrite arbitrary "You, II".
    let lower = cleaned.to_ascii_lowercase();
    if lower.starts_with("you") {
        if let Some(signed_in) = lower.find("stay signed in") {
            if signed_in <= 16 {
                let between = &cleaned[3..signed_in];
                let between_lower = between.to_ascii_lowercase();
                if between_lower.contains("ii")
                    && between.chars().any(|c| matches!(c, ',' | '，'))
                {
                    cleaned.replace_range(..signed_in, "You'll ");
                }
            }
        }
    }
    // Window icons are sometimes decoded as one stray glyph immediately before
    // an "(unsaved) - application" title. Preserve the title, drop only that
    // tiny prefix when the standard title-bar structure is present.
    if cleaned.contains(" - ") {
        if let Some(paren) = cleaned.find(|c| c == '(' || c == '（') {
            if cleaned[..paren].chars().count() <= 2 {
                cleaned = cleaned[paren..].to_string();
            }
        }
    }
    match cleaned.as_str() {
        "若色" => "着色".to_string(),
        "治染" | "沧染" => "渲染".to_string(),
        "末保存" => "未保存".to_string(),
        _ => cleaned,
    }
}

#[cfg(test)]
mod clean_text_tests {
    use super::clean_ocr_text;

    #[test]
    fn repairs_conservative_common_ui_confusions() {
        assert_eq!(clean_ocr_text("若色"), "着色");
        assert_eq!(clean_ocr_text("沧染"), "渲染");
        assert_eq!(
            clean_ocr_text("à(末保存) - Blender 5.2.1 LTS"),
            "(未保存) - Blender 5.2.1 LTS"
        );
        assert_eq!(
            clean_ocr_text("You ， II stay signed in on these devices after"),
            "You'll stay signed in on these devices after"
        );
        assert_eq!(
            clean_ocr_text("You, II stayed logged in"),
            "You, II stayed logged in"
        );
        assert_eq!(clean_ocr_text("普通文本"), "普通文本");
    }

    #[test]
    fn removes_spurious_cjk_gutters_without_damaging_latin_word_spaces() {
        assert_eq!(
            clean_ocr_text("有 ， 而且我认为下一步不该继续只盯着 OCR 模型 。"),
            "有，而且我认为下一步不该继续只盯着 OCR 模型。"
        );
        assert_eq!(clean_ocr_text("设置 ： 重点验收字号 、 换行"), "设置：重点验收字号、换行");
        assert_eq!(clean_ocr_text("影响 \" 看起来能不能用 \""), "影响\"看起来能不能用\"");
        assert_eq!(clean_ocr_text("常用 / 高级"), "常用/高级");
        assert_eq!(clean_ocr_text("OpenAI API key"), "OpenAI API key");
    }
}

/// Run OCR on a cropped BMP byte slice.
/// Engine priority: Rust-native ONNX (PP-OCRv6, offline) → WinRT → RapidOCR daemon.
pub fn execute_native_ocr(crop_bmp_bytes: &[u8]) -> Result<OcrResult, String> {
    execute_native_ocr_with_retry(crop_bmp_bytes, 0)
}

/// daemon 死亡后的重启重试有硬上限（1 次）。无上限的"重启即递归"会在
/// daemon 持续秒退的环境（无 python / 脚本缺失）里无限递归直到栈溢出。
fn execute_native_ocr_with_retry(crop_bmp_bytes: &[u8], restart_depth: u32) -> Result<OcrResult, String> {
    // 0: Rust native ONNX first. The settings UI promises this order, and
    // accepting the first non-empty WinRT result used to turn partial OCR into
    // a false "complete" success with no chance for ONNX to recover missed rows.
    if onnx_available() || crate::onnx_ocr::model_files_present() {
        let engine = crate::onnx_ocr::get_engine();
        let onnx_result = engine.recognize_bmp(crop_bmp_bytes);
        // Secondary gap crops may invoke the same engine. Release the outer
        // singleton lock before entering the OCR rescue path.
        drop(engine);
        match onnx_result {
            Ok(res) if !res.blocks.is_empty() => {
                let ver = crate::onnx_ocr::get_active_version().to_uppercase();
                eprintln!("[OCR] Rust 原生 ONNX OCR (PP-OCR{}) 完成 — 纯离线推理", ver);
                return Ok(rescue_fragmented_onnx(crop_bmp_bytes, res));
            }
            Ok(_) => {
                eprintln!("[OCR] ONNX OCR 返回空结果，尝试 RapidOCR daemon...");
            }
            Err(e) => {
                eprintln!("[OCR] ONNX OCR 错误 ({})，降级 RapidOCR daemon...", e);
            }
        }
    }

    // 1: Windows WinRT is the zero-model fallback.
    #[cfg(target_os = "windows")]
    {
        match execute_winrt_ocr(crop_bmp_bytes) {
            Ok(res) if !res.blocks.is_empty() => return Ok(res),
            Ok(_) => eprintln!("[OCR] WinRT OCR 返回空结果，尝试 RapidOCR daemon..."),
            Err(e) => eprintln!("[OCR] WinRT OCR 失败: {}，尝试 RapidOCR daemon...", e),
        }
    }

    let b64 = crate::capture::encode_base64(crop_bmp_bytes);

    let slot = OCR_DAEMON.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().map_err(|_| "OCR daemon lock poisoned")?;

    // Launch daemon if not yet alive
    if guard.is_none() {
        eprintln!("[OCR] Launching RapidOCR daemon (first call — warm-up ~2-4s)…");
        mark_ocr_warming();
        match launch_daemon() {
            Ok(d) => {
                eprintln!("[OCR] Daemon ready. Subsequent calls will be fast.");
                mark_ocr_ready();
                *guard = Some(d);
            }
            Err(e) => {
                eprintln!(
                    "[OCR] Daemon launch failed: {}. Degraded to empty blocks.",
                    e
                );
                mark_ocr_failed();
                return Ok(OcrResult { blocks: vec![] });
            }
        }
    }

    let daemon = guard.as_mut().unwrap();

    // Build and send request (In-memory Base64, ZERO Disk I/O)
    let req_id = daemon.next_id;
    daemon.next_id += 1;

    let req_json = serde_json::json!({ "id": req_id, "b64": b64 });
    let req_line = format!("{}\n", req_json);

    if let Err(e) = daemon.stdin.write_all(req_line.as_bytes()) {
        eprintln!("[OCR] Write to daemon failed ({}). Restarting.", e);
        let _ = daemon.child.kill();
        *guard = None;
        drop(guard);
        if restart_depth >= 1 {
            return Ok(OcrResult { blocks: vec![] });
        }
        return execute_native_ocr_with_retry(crop_bmp_bytes, restart_depth + 1);
    }

    // Read response —— recv_timeout：3.5s 超时熔断并主动 kill 僵尸子进程，杜绝全局锁内永久卡死
    let response_line = match daemon.rx.recv_timeout(std::time::Duration::from_millis(3500)) {
        Ok(line) => line,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            eprintln!("[OCR] Daemon response timed out (3.5s). Restarting.");
            let _ = daemon.child.kill();
            *guard = None;
            drop(guard);
            if restart_depth >= 1 {
                return Ok(OcrResult { blocks: vec![] });
            }
            return execute_native_ocr_with_retry(crop_bmp_bytes, restart_depth + 1);
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            // 读线程退出 = daemon 死亡
            eprintln!("[OCR] Daemon exited unexpectedly. Restarting.");
            let _ = daemon.child.kill();
            *guard = None;
            drop(guard);
            if restart_depth >= 1 {
                return Ok(OcrResult { blocks: vec![] });
            }
            return execute_native_ocr_with_retry(crop_bmp_bytes, restart_depth + 1);
        }
    };

    parse_daemon_response(&response_line)
}

fn ocr_text_shape(result: &OcrResult) -> (usize, usize, usize) {
    let mut text_len = 0usize;
    let mut short_blocks = 0usize;
    let mut singleton_blocks = 0usize;
    for block in &result.blocks {
        let len = block.text.chars().filter(|c| !c.is_whitespace()).count();
        if len == 0 {
            continue;
        }
        text_len += len;
        if len <= 2 {
            short_blocks += 1;
        }
        if len == 1 {
            singleton_blocks += 1;
        }
    }
    (text_len, short_blocks, singleton_blocks)
}

fn should_review_fragmented_result(result: &OcrResult) -> bool {
    let count = result.blocks.iter().filter(|b| !b.text.trim().is_empty()).count();
    let (_, short_blocks, singleton_blocks) = ocr_text_shape(result);
    count >= 8
        && short_blocks >= 4
        && short_blocks * 5 >= count
        && singleton_blocks >= 2
        // Dense toolbars naturally contain many short labels. Only classify
        // them as broken OCR when tiny boxes form a tight glyph run.
        && max_adjacent_short_fragment_edges(result) >= 2
}

fn max_adjacent_short_fragment_edges(result: &OcrResult) -> usize {
    let short_blocks: Vec<_> = result
        .blocks
        .iter()
        .filter(|block| {
            let len = block.text.chars().filter(|c| !c.is_whitespace()).count();
            (1..=2).contains(&len) && block.box_rect.height >= 6
        })
        .collect();
    let mut longest_run = 0usize;
    for anchor in &short_blocks {
        let anchor_center = anchor.box_rect.y as f32 + anchor.box_rect.height as f32 * 0.5;
        let mut row: Vec<_> = short_blocks
            .iter()
            .copied()
            .filter(|block| {
                let rect = block.box_rect;
                let center = rect.y as f32 + rect.height as f32 * 0.5;
                let tolerance = (anchor.box_rect.height.min(rect.height) as f32 * 0.65).max(5.0);
                (center - anchor_center).abs() <= tolerance
            })
            .collect();
        row.sort_by_key(|block| block.box_rect.x);

        let mut run = 0usize;
        for pair in row.windows(2) {
            let left = pair[0];
            let right = pair[1];
            let left_len = left.text.chars().filter(|c| !c.is_whitespace()).count();
            let right_len = right.text.chars().filter(|c| !c.is_whitespace()).count();
            let gap = right.box_rect.x - (left.box_rect.x + left.box_rect.width as i32);
            let max_gap = (left.box_rect.height.min(right.box_rect.height) as f32 * 0.9).max(6.0);
            if (left_len == 1 || right_len == 1) && gap as f32 <= max_gap {
                run += 1;
                longest_run = longest_run.max(run);
            } else {
                run = 0;
            }
        }
    }
    longest_run
}

/// Detect a different failure mode from fragmentation: several recognized
/// pieces on one text row separated by a hole much wider than normal spacing.
/// This is common when a short word/number (for example `1.1`) was missed.
fn should_review_suspicious_row_gaps(result: &OcrResult) -> bool {
    let blocks: Vec<_> = result
        .blocks
        .iter()
        .filter(|block| !block.text.trim().is_empty() && block.box_rect.height >= 6)
        .collect();
    // Large toolbars legitimately contain wide gutters between control groups.
    // The gap signal is intended for compact snippets such as chat bubbles;
    // dense multi-row interfaces use the model's own toolbar ensemble instead.
    if blocks.len() > 10 {
        return false;
    }

    for anchor in &blocks {
        let anchor_center = anchor.box_rect.y as f32 + anchor.box_rect.height as f32 * 0.5;
        let mut row: Vec<_> = blocks
            .iter()
            .copied()
            .filter(|block| {
                let rect = block.box_rect;
                let center = rect.y as f32 + rect.height as f32 * 0.5;
                let tolerance = (anchor.box_rect.height.min(rect.height) as f32 * 0.65).max(5.0);
                (center - anchor_center).abs() <= tolerance
            })
            .collect();
        if row.len() < 3 {
            continue;
        }

        row.sort_by_key(|block| block.box_rect.x);
        let median_height = {
            let mut heights: Vec<_> = row.iter().map(|block| block.box_rect.height).collect();
            heights.sort_unstable();
            heights[heights.len() / 2]
        };
        let widest_gap = row
            .windows(2)
            .map(|pair| {
                pair[1].box_rect.x - (pair[0].box_rect.x + pair[0].box_rect.width as i32)
            })
            .max()
            .unwrap_or(0);
        let row_chars: usize = row
            .iter()
            .map(|block| block.text.chars().filter(|c| !c.is_whitespace()).count())
            .sum();
        // A gap just over one glyph height can hide a short version number or
        // article. Very large gutters are more likely separate UI columns.
        if row_chars >= 12
            && widest_gap as f32 > (median_height as f32 * 1.25).max(10.0)
            && widest_gap as f32 <= median_height as f32 * 5.0
        {
            return true;
        }
    }
    false
}

/// Dense desktop toolbars are a separate case from a compact sentence with a
/// missing word. Review them only when many short labels occupy one wide row;
/// this avoids adding a second OCR pass to paragraphs and terminal output.
fn should_review_dense_toolbar(result: &OcrResult) -> bool {
    if result.blocks.len() < 12 {
        return false;
    }
    for anchor in &result.blocks {
        let anchor_center = anchor.box_rect.y as f32 + anchor.box_rect.height as f32 * 0.5;
        let row: Vec<_> = result.blocks.iter().filter(|block| {
            let center = block.box_rect.y as f32 + block.box_rect.height as f32 * 0.5;
            (center - anchor_center).abs() <= 5.0
                && (6..=26).contains(&block.box_rect.height)
        }).collect();
        if row.len() < 8 {
            continue;
        }
        let short = row.iter().filter(|block| {
            (1..=6).contains(&block.text.chars().filter(|c| !c.is_whitespace()).count())
        }).count();
        let cjk_labels = row.iter().filter(|block| {
            let text = block.text.trim();
            (2..=6).contains(&text.chars().count())
                && text.chars().all(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
        }).count();
        let left = row.iter().map(|block| block.box_rect.x).min().unwrap_or(0);
        let right = row.iter().map(|block| block.box_rect.x + block.box_rect.width as i32)
            .max().unwrap_or(0);
        if short * 4 >= row.len() * 3 && cjk_labels >= 6 && right - left >= 400 {
            return true;
        }
    }
    false
}

/// Add a second-engine label only if it sits in a real, otherwise empty gap
/// between two primary labels on the *same* dense row. Never replace or join
/// existing primary labels (WinRT merges adjacent Blender menus incorrectly).
fn rescue_missing_toolbar_labels(primary: &OcrResult, alternate: &OcrResult) -> Option<OcrResult> {
    let mut additions = Vec::new();
    for alt in &alternate.blocks {
        let label = alt.text.trim();
        if !(2..=6).contains(&label.chars().count())
            || !label.chars().all(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
            || !(6..=26).contains(&alt.box_rect.height)
        {
            continue;
        }
        let alt_left = alt.box_rect.x;
        let alt_right = alt_left + alt.box_rect.width as i32;
        let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
        if primary.blocks.iter().any(|block| {
            let rect = block.box_rect;
            let center = rect.y as f32 + rect.height as f32 * 0.5;
            let overlap = (alt_right.min(rect.x + rect.width as i32) - alt_left.max(rect.x)).max(0);
            (center - alt_center).abs() <= 7.0
                && (overlap * 5 >= alt.box_rect.width as i32
                    || overlap * 2 >= rect.width as i32)
        }) {
            continue;
        }
        let mut row: Vec<_> = primary.blocks.iter().filter(|block| {
            let center = block.box_rect.y as f32 + block.box_rect.height as f32 * 0.5;
            (center - alt_center).abs() <= 7.0 && (6..=26).contains(&block.box_rect.height)
        }).collect();
        if row.len() < 8 {
            continue;
        }
        row.sort_by_key(|block| block.box_rect.x);
        let left = row.iter().rev().find(|block| {
            block.box_rect.x + block.box_rect.width as i32 <= alt_left
        });
        let right = row.iter().find(|block| block.box_rect.x >= alt_right);
        let (Some(left), Some(right)) = (left, right) else { continue };
        let row_height = left.box_rect.height.max(right.box_rect.height) as i32;
        let left_gap = alt_left - (left.box_rect.x + left.box_rect.width as i32);
        let right_gap = right.box_rect.x - alt_right;
        if left_gap > row_height * 5 || right_gap > row_height * 5 {
            continue;
        }
        let mut recovered = alt.clone();
        recovered.box_rect.y = left.box_rect.y.min(right.box_rect.y);
        recovered.box_rect.height = left.box_rect.height.max(right.box_rect.height);
        additions.push(recovered);
    }
    if additions.is_empty() {
        return None;
    }
    let mut blocks = primary.blocks.clone();
    blocks.extend(additions);
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    Some(OcrResult { blocks })
}

fn toolbar_gap_rects(result: &OcrResult, image_width: u32, image_height: u32) -> Vec<PhysicalRect> {
    if !should_review_dense_toolbar(result) {
        return Vec::new();
    }
    let mut best_row = Vec::new();
    for anchor in &result.blocks {
        let center = anchor.box_rect.y as f32 + anchor.box_rect.height as f32 * 0.5;
        let row: Vec<&TextBlock> = result.blocks.iter().filter(|block| {
            let other = block.box_rect.y as f32 + block.box_rect.height as f32 * 0.5;
            (other - center).abs() <= 5.0 && (6..=26).contains(&block.box_rect.height)
        }).collect();
        if row.len() > best_row.len() {
            best_row = row;
        }
    }
    best_row.sort_by_key(|block| block.box_rect.x);
    let mut heights: Vec<u32> = best_row.iter().map(|block| block.box_rect.height).collect();
    heights.sort_unstable();
    let Some(&median_height) = heights.get(heights.len() / 2) else { return Vec::new() };
    let mut gaps = Vec::new();
    for pair in best_row.windows(2) {
        let left = pair[0].box_rect;
        let right = pair[1].box_rect;
        let start = left.x + left.width as i32;
        let end = right.x;
        let gap = end - start;
        if gap < (median_height * 2) as i32 || gap > (median_height * 8) as i32
            || gap > 240 || start < 0 || end > image_width as i32
        {
            continue;
        }
        let top = (left.y.min(right.y) - 5).max(0);
        let bottom = (left.y + left.height as i32)
            .max(right.y + right.height as i32)
            .saturating_add(5)
            .min(image_height as i32);
        if bottom > top && bottom - top <= 64 {
            gaps.push(PhysicalRect {
                x: start, y: top, width: gap as u32, height: (bottom - top) as u32,
            });
        }
    }
    // Keep the second pass bounded on full-screen captures with several
    // toolbar groups. The widest holes are most likely to contain missed text.
    gaps.sort_by_key(|rect| std::cmp::Reverse(rect.width));
    gaps.truncate(4);
    gaps
}

/// Re-run the same detector on small *original-resolution* empty toolbar
/// gaps. The whole Blender image misses low-contrast `UV编辑`, while the
/// 71x27-pixel gap crop recognizes it without resizing or a new model.
fn rescue_toolbar_gap_crops(image: &[u8], primary: &OcrResult) -> Option<OcrResult> {
    if image.len() < 54 || &image[..2] != b"BM" {
        return None;
    }
    let width = u32::from_le_bytes(image[18..22].try_into().ok()?);
    let signed_height = i32::from_le_bytes(image[22..26].try_into().ok()?);
    if signed_height >= 0 || width == 0 || width > 10000 {
        return None;
    }
    let height = signed_height.unsigned_abs();
    let pixel_bytes = width.checked_mul(height)?.checked_mul(4)? as usize;
    if height == 0 || height > 10000 || image.len() < 54usize.checked_add(pixel_bytes)? {
        return None;
    }
    let mut additions: Vec<TextBlock> = Vec::new();
    for gap in toolbar_gap_rects(primary, width, height) {
        let Some(crop) = crop_bmp(image, width, height, gap) else { continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        for mut block in found.blocks {
            let label = block.text.trim();
            let chars = label.chars().filter(|c| !c.is_whitespace()).count();
            if !(2..=12).contains(&chars) || block.confidence < 0.85
                || !label.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
            {
                continue;
            }
            block.box_rect.x += gap.x;
            block.box_rect.y += gap.y;
            let rect = block.box_rect;
            if rect.x < gap.x + 2
                || rect.x + rect.width as i32 > gap.x + gap.width as i32 - 2
                || rect.y < gap.y || rect.y + rect.height as i32 > gap.y + gap.height as i32
            {
                continue;
            }
            let overlaps_existing = primary.blocks.iter().chain(additions.iter()).any(|other| {
                let existing = other.box_rect;
                let center = rect.y as f32 + rect.height as f32 * 0.5;
                let other_center = existing.y as f32 + existing.height as f32 * 0.5;
                let overlap = (rect.x + rect.width as i32)
                    .min(existing.x + existing.width as i32) - rect.x.max(existing.x);
                (center - other_center).abs() <= 7.0 && overlap > 0
            });
            if !overlaps_existing {
                additions.push(block);
            }
        }
    }
    if additions.is_empty() {
        return None;
    }
    let mut blocks = primary.blocks.clone();
    blocks.extend(additions);
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    Some(OcrResult { blocks })
}

fn alternate_covers_more_text(primary: &OcrResult, alternate: &OcrResult) -> bool {
    if alternate.blocks.is_empty() || alternate.blocks.len() > primary.blocks.len() + 1 {
        return false;
    }
    let (primary_chars, _, _) = ocr_text_shape(primary);
    let (alternate_chars, _, _) = ocr_text_shape(alternate);
    if alternate_chars < primary_chars + 2 || alternate_chars * 100 < primary_chars * 103 {
        return false;
    }

    // A larger text count only counts as a recovery when the alternate boxes
    // land on rows that the primary engine also detected. This prevents an
    // unrelated icon/decoration detection elsewhere in the crop from winning.
    let aligned_blocks = alternate
        .blocks
        .iter()
        .filter(|alt| {
            let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
            primary.blocks.iter().any(|main| {
                let main_center = main.box_rect.y as f32 + main.box_rect.height as f32 * 0.5;
                let tolerance = (alt.box_rect.height.min(main.box_rect.height) as f32 * 0.9)
                    .max(7.0);
                (alt_center - main_center).abs() <= tolerance
            })
        })
        .count();
    aligned_blocks * 4 >= alternate.blocks.len() * 3
}

fn prefer_alternate_result(primary: &OcrResult, alternate: &OcrResult) -> bool {
    if alternate.blocks.is_empty() {
        return false;
    }
    let (primary_chars, primary_short, _) = ocr_text_shape(primary);
    let (alternate_chars, alternate_short, _) = ocr_text_shape(alternate);
    let primary_count = primary.blocks.len().max(1);
    let alternate_count = alternate.blocks.len();
    let keeps_text = alternate_chars * 100 >= primary_chars * 75;
    let reduces_fragments = alternate_count * 5 <= primary_count * 4
        && alternate_short * 5 <= alternate_count.max(1) * 2
        && alternate_short < primary_short;
    (keeps_text && reduces_fragments) || alternate_covers_more_text(primary, alternate)
}

/// A compact paragraph can be badly recognized without any one-character
/// fragments: the detector returns plausible-looking pieces while dropping
/// whole words. In that case gap insertion cannot repair substitutions or
/// missing text at the start/end of a line. Only replace the entire result
/// when the second engine has substantially more text in the same rows.
fn should_replace_compact_broken_lines(primary: &OcrResult, alternate: &OcrResult) -> bool {
    if primary.blocks.len() < 8 || alternate.blocks.is_empty()
        || alternate.blocks.len() > 3
        || alternate.blocks.len() * 3 > primary.blocks.len()
    {
        return false;
    }
    let (primary_chars, _, _) = ocr_text_shape(primary);
    let (alternate_chars, _, _) = ocr_text_shape(alternate);
    if alternate_chars < primary_chars + 6 || alternate_chars * 100 < primary_chars * 115 {
        return false;
    }
    alternate.blocks.iter().all(|alt| {
        let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
        primary.blocks.iter().any(|main| {
            let main_center = main.box_rect.y as f32 + main.box_rect.height as f32 * 0.5;
            (alt_center - main_center).abs()
                <= (alt.box_rect.height.min(main.box_rect.height) as f32 * 0.65).max(5.0)
        })
    })
}

/// Large UI copy may contain one broken heading alongside many correctly
/// recognized controls. The full-image fragment score misses that pattern;
/// review only a row with several short fragments at heading-sized glyphs.
fn large_fragmented_row_indices(primary: &OcrResult, alt: &TextBlock) -> Vec<usize> {
    let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
    let matching: Vec<usize> = primary.blocks.iter().enumerate().filter_map(|(index, main)| {
        let main_center = main.box_rect.y as f32 + main.box_rect.height as f32 * 0.5;
        let overlap_x = (main.box_rect.x + main.box_rect.width as i32)
            .min(alt.box_rect.x + alt.box_rect.width as i32)
            - main.box_rect.x.max(alt.box_rect.x);
        ((main_center - alt_center).abs()
            <= (main.box_rect.height.min(alt.box_rect.height) as f32 * 0.65).max(5.0)
            && overlap_x > 0).then_some(index)
    }).collect();
    if matching.len() < 5 {
        return Vec::new();
    }
    let mut heights: Vec<u32> = matching.iter()
        .map(|&i| primary.blocks[i].box_rect.height).collect();
    heights.sort_unstable();
    let short = matching.iter().filter(|&&i| {
        let len = primary.blocks[i].text.chars().filter(|c| !c.is_whitespace()).count();
        (1..=4).contains(&len)
    }).count();
    let primary_chars: usize = matching.iter().map(|&i| {
        primary.blocks[i].text.chars().filter(|c| !c.is_whitespace()).count()
    }).sum();
    let alternate_chars = alt.text.chars().filter(|c| !c.is_whitespace()).count();
    if heights[heights.len() / 2] < 32 || short < 3
        || short * 2 < matching.len()
        || alt.text.split_whitespace().count() < 3
        || alternate_chars < primary_chars
    {
        return Vec::new();
    }
    matching
}

fn rescue_large_fragmented_rows(primary: &OcrResult, alternate: &OcrResult) -> Option<OcrResult> {
    let mut replaced = vec![false; primary.blocks.len()];
    let mut additions = Vec::new();
    for alt in &alternate.blocks {
        let matching = large_fragmented_row_indices(primary, alt);
        if matching.is_empty() || matching.iter().any(|&i| replaced[i]) {
            continue;
        }
        let mut recovered = alt.clone();
        let top = matching.iter().map(|&i| primary.blocks[i].box_rect.y).min().unwrap();
        let bottom = matching.iter().map(|&i| {
            let rect = primary.blocks[i].box_rect;
            rect.y + rect.height as i32
        }).max().unwrap();
        recovered.box_rect.y = top;
        recovered.box_rect.height = (bottom - top).max(1) as u32;
        for index in matching {
            replaced[index] = true;
        }
        additions.push(recovered);
    }
    if additions.is_empty() {
        return None;
    }
    let mut blocks: Vec<TextBlock> = primary.blocks.iter().enumerate()
        .filter_map(|(i, block)| (!replaced[i]).then_some(block.clone()))
        .collect();
    blocks.extend(additions);
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    Some(OcrResult { blocks })
}

/// A recognizer can append a few letters from a nearby icon to an otherwise
/// correct prose row. Only drop that tail when a second engine sees the same
/// physical row, ends before the suspect pixels, and agrees on the preceding
/// words. This is deliberately stricter than choosing the shorter OCR result.
fn rescue_unconfirmed_short_tails(primary: &OcrResult, alternate: &OcrResult) -> Option<OcrResult> {
    let mut replaced = vec![false; primary.blocks.len()];
    let mut additions = Vec::new();
    for alt in &alternate.blocks {
        if alt.text.split_whitespace().count() < 3 || alt.box_rect.height < 12 {
            continue;
        }
        let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
        let mut matching: Vec<usize> = primary.blocks.iter().enumerate().filter_map(|(i, main)| {
            let center = main.box_rect.y as f32 + main.box_rect.height as f32 * 0.5;
            let tolerance = (main.box_rect.height.min(alt.box_rect.height) as f32 * 0.55).max(5.0);
            let overlap = (main.box_rect.x + main.box_rect.width as i32)
                .min(alt.box_rect.x + alt.box_rect.width as i32)
                - main.box_rect.x.max(alt.box_rect.x);
            (!replaced[i] && (center - alt_center).abs() <= tolerance && overlap > 0).then_some(i)
        }).collect();
        if matching.len() < 2 {
            continue;
        }
        matching.sort_by_key(|&i| primary.blocks[i].box_rect.x);
        let first = &primary.blocks[matching[0]];
        let last = &primary.blocks[*matching.last().unwrap()];
        let main_right = last.box_rect.x + last.box_rect.width as i32;
        let alt_right = alt.box_rect.x + alt.box_rect.width as i32;
        let tail_pixels = main_right - alt_right;
        let row_height = matching.iter().map(|&i| primary.blocks[i].box_rect.height).max().unwrap();
        if (first.box_rect.x - alt.box_rect.x).abs() > row_height as i32 / 2
            || tail_pixels < 8 || tail_pixels > (row_height as i32 * 5 / 4).max(12)
        {
            continue;
        }
        let primary_text = matching.iter().map(|&i| primary.blocks[i].text.as_str())
            .collect::<Vec<_>>().join(" ");
        let Some((before_tail, tail)) = primary_text.trim().rsplit_once(' ') else { continue };
        if !(1..=3).contains(&tail.len()) || !tail.chars().all(|c| c.is_ascii_alphabetic()) {
            continue;
        }
        let preceding_word = before_tail.split_whitespace().last().unwrap_or_default();
        if preceding_word.chars().count() < 4
            || !alt.text.trim_end().to_ascii_lowercase().ends_with(&preceding_word.to_ascii_lowercase())
            || !ocr_texts_nearly_equal(before_tail, &alt.text, 2)
        {
            continue;
        }
        let top = matching.iter().map(|&i| primary.blocks[i].box_rect.y).min().unwrap();
        let bottom = matching.iter().map(|&i| {
            let rect = primary.blocks[i].box_rect;
            rect.y + rect.height as i32
        }).max().unwrap();
        let mut recovered = alt.clone();
        recovered.box_rect.y = top;
        recovered.box_rect.height = (bottom - top).max(1) as u32;
        for i in matching {
            replaced[i] = true;
        }
        additions.push(recovered);
    }
    if additions.is_empty() {
        return None;
    }
    let mut blocks: Vec<TextBlock> = primary.blocks.iter().enumerate()
        .filter_map(|(i, block)| (!replaced[i]).then_some(block.clone()))
        .collect();
    blocks.extend(additions);
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    Some(OcrResult { blocks })
}

#[cfg(target_os = "windows")]
fn suspected_icon_tail(text: &str) -> Option<&str> {
    let (prefix, tail) = text.trim().rsplit_once(' ')?;
    if prefix.split_whitespace().count() < 3 || !(1..=2).contains(&tail.len())
        || !tail.bytes().all(|c| c.is_ascii_lowercase())
        || matches!(tail, "a" | "an" | "as" | "at" | "be" | "by" | "do" | "go"
            | "he" | "if" | "in" | "is" | "it" | "me" | "my" | "no"
            | "of" | "on" | "or" | "so" | "to" | "up" | "us" | "we")
        || prefix.split_whitespace().last()?.len() < 4
    {
        return None;
    }
    Some(prefix)
}

/// A link icon may be read as a short word attached to the end of a correct
/// line. Require WinRT and a fresh ONNX crop of the original pixels to agree
/// before removing it; a short English word by itself is never enough.
#[cfg(target_os = "windows")]
fn rescue_attached_icon_tails(image: &[u8], primary: &OcrResult, alternate: &OcrResult) -> Option<OcrResult> {
    if image.len() < 54 || &image[..2] != b"BM" { return None; }
    let width = u32::from_le_bytes(image[18..22].try_into().ok()?);
    let signed_height = i32::from_le_bytes(image[22..26].try_into().ok()?);
    if signed_height >= 0 || width == 0 || width > 10000 { return None; }
    let height = signed_height.unsigned_abs();
    let mut result = primary.clone();
    let mut changed = false;
    for block in &mut result.blocks {
        let Some(prefix) = suspected_icon_tail(&block.text) else { continue };
        let rect = block.box_rect;
        if rect.height < 24 || rect.width < 180 || block.confidence >= 0.98 { continue; }
        let main_right = rect.x + rect.width as i32;
        let Some(alt) = alternate.blocks.iter().find(|alt| {
            let other = alt.box_rect;
            let other_right = other.x + other.width as i32;
            let gap = main_right - other_right;
            let center_delta = ((rect.y + rect.height as i32 / 2)
                - (other.y + other.height as i32 / 2)).abs();
            alt.text.trim().eq_ignore_ascii_case(prefix)
                && (other.x - rect.x).abs() <= (rect.height as i32 / 2).max(8)
                && center_delta <= (rect.height as i32 / 3).max(8)
                && (8..=(rect.height as i32 * 5 / 4)).contains(&gap)
        }) else { continue };
        let other = alt.box_rect;
        let x = (other.x - 4).max(0);
        let y = (rect.y - 4).max(0);
        let right = (other.x + other.width as i32 + 4).min(width as i32);
        let bottom = (rect.y + rect.height as i32 + 4).min(height as i32);
        if right <= x || bottom <= y { continue; }
        let Some(crop) = crop_bmp(image, width, height, PhysicalRect {
            x, y, width: (right - x) as u32, height: (bottom - y) as u32,
        }) else { continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        if found.blocks.len() != 1 || found.blocks[0].confidence < 0.95
            || !found.blocks[0].text.trim().eq_ignore_ascii_case(prefix)
        { continue; }
        block.text = alt.text.clone();
        block.box_rect.x = other.x;
        block.box_rect.width = other.width;
        changed = true;
    }
    changed.then_some(result)
}

/// Large Latin headings occasionally acquire a tiny CJK-looking suffix from
/// background pixels. Only consult WinRT when that suffix could not possibly
/// fit in the few pixels beyond WinRT's otherwise agreeing text rectangle.
#[cfg(target_os = "windows")]
fn impossible_mixed_suffix_prefix(block: &TextBlock) -> Option<&str> {
    if block.confidence >= 0.90 || block.box_rect.height < 32 {
        return None;
    }
    let text = block.text.trim();
    let cut = text.find(is_cjk_char)?;
    let prefix = &text[..cut];
    let suffix = &text[cut..];
    let suffix_chars = suffix.chars().count();
    if !(2..=6).contains(&suffix_chars)
        || suffix.chars().filter(|&c| is_cjk_char(c)).count() < 2
        || !suffix.chars().all(|c| is_cjk_char(c) || c.is_ascii_digit())
        || prefix.chars().filter(|c| c.is_ascii_alphabetic()).count() < 12
        || !prefix.trim_start().chars().next().is_some_and(|c| c.is_ascii_alphabetic())
    {
        return None;
    }
    Some(prefix)
}

#[cfg(target_os = "windows")]
fn rescue_impossible_mixed_suffix(mut primary: OcrResult, alternate: &OcrResult) -> OcrResult {
    for block in &mut primary.blocks {
        let Some(prefix) = impossible_mixed_suffix_prefix(block) else { continue };
        let rect = block.box_rect;
        let main_center = rect.y as f32 + rect.height as f32 * 0.5;
        let candidate = alternate.blocks.iter().find(|alt| {
            let other = alt.box_rect;
            let other_center = other.y as f32 + other.height as f32 * 0.5;
            let excess_width = rect.x + rect.width as i32 - other.x - other.width as i32;
            alt.confidence >= 0.95
                && !alt.text.chars().any(is_cjk_char)
                && compact_ocr_alnum(prefix) == compact_ocr_alnum(&alt.text)
                && (main_center - other_center).abs()
                    <= (rect.height.min(other.height) as f32 * 0.25).max(5.0)
                && (rect.x - other.x).abs() <= rect.height as i32 / 3
                && (0..=rect.height as i32 / 2).contains(&excess_width)
        });
        if let Some(alt) = candidate {
            block.text = alt.text.clone();
            block.confidence = alt.confidence;
            block.box_rect.x = alt.box_rect.x;
            block.box_rect.width = alt.box_rect.width;
        }
    }
    primary
}

fn ocr_texts_nearly_equal(left: &str, right: &str, max_edits: usize) -> bool {
    let normalize = |text: &str| text.split_whitespace().collect::<Vec<_>>()
        .join(" ").to_ascii_lowercase();
    let left: Vec<char> = normalize(left).chars().collect();
    let right: Vec<char> = normalize(right).chars().collect();
    if left.len().abs_diff(right.len()) > max_edits {
        return false;
    }
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for (row, character) in left.iter().enumerate() {
        let mut current = vec![row + 1; right.len() + 1];
        for (column, other) in right.iter().enumerate() {
            current[column + 1] = (previous[column + 1] + 1)
                .min(current[column] + 1)
                .min(previous[column] + usize::from(character != other));
        }
        if *current.iter().min().unwrap_or(&usize::MAX) > max_edits {
            return false;
        }
        previous = current;
    }
    previous[right.len()] <= max_edits
}

fn should_review_large_fragmented_rows(result: &OcrResult) -> bool {
    result.blocks.iter().any(|anchor| {
        let row = OcrResult { blocks: result.blocks.iter().filter(|block| {
            let center = block.box_rect.y as f32 + block.box_rect.height as f32 * 0.5;
            let anchor_center = anchor.box_rect.y as f32 + anchor.box_rect.height as f32 * 0.5;
            (center - anchor_center).abs() <= 12.0
        }).cloned().collect() };
        row.blocks.len() >= 5
            && row.blocks.iter().filter(|block| {
                (1..=4).contains(&block.text.chars().filter(|c| !c.is_whitespace()).count())
                    && block.box_rect.height >= 32
            }).count() >= 3
    })
}

/// Large headings can fragment at word boundaries, not only into one-letter
/// boxes. Detect that shape separately from small-font toolbars and terminals.
fn should_review_large_word_rows(result: &OcrResult) -> bool {
    result.blocks.iter().any(|anchor| {
        let center = anchor.box_rect.y as f32 + anchor.box_rect.height as f32 * 0.5;
        let row: Vec<&TextBlock> = result.blocks.iter().filter(|block| {
            let other = block.box_rect.y as f32 + block.box_rect.height as f32 * 0.5;
            (other - center).abs() <= 10.0 && block.box_rect.height >= 28
        }).collect();
        if row.len() < 5 {
            return false;
        }
        let left = row.iter().map(|block| block.box_rect.x).min().unwrap_or(0);
        let right = row.iter().map(|block| {
            block.box_rect.x + block.box_rect.width as i32
        }).max().unwrap_or(0);
        right - left >= 250 && row.iter().filter(|block| {
            block.text.chars().filter(char::is_ascii_alphabetic).count() >= 3
        }).count() >= 4
    })
}

/// Confirm a disputed word against a fresh crop of the *original* pixels.
/// A second OCR engine's high confidence alone cannot authorize changing a
/// correct word elsewhere in a mixed-layout screenshot.
fn confirm_alternate_word_in_pixels(
    image: &[u8], row: &[&TextBlock], primary_word: &str, alternate_word: &str,
) -> bool {
    if image.len() < 54 || &image[..2] != b"BM" {
        return false;
    }
    let width = u32::from_le_bytes(match image[18..22].try_into() {
        Ok(bytes) => bytes, Err(_) => return false,
    });
    let signed_height = i32::from_le_bytes(match image[22..26].try_into() {
        Ok(bytes) => bytes, Err(_) => return false,
    });
    if signed_height >= 0 || width == 0 {
        return false;
    }
    let matching: Vec<&TextBlock> = row.iter().copied().filter(|block| {
        block.text.split_whitespace().any(|word| word == primary_word)
    }).collect();
    let [block] = matching.as_slice() else { return false };
    let rect = block.box_rect;
    let x = (rect.x - (rect.height as i32 / 4).max(6)).max(0);
    let y = (rect.y - (rect.height as i32 / 6).max(4)).max(0);
    let right = (rect.x + rect.width as i32 + (rect.height as i32 / 3).max(8))
        .min(width as i32);
    let bottom = (rect.y + rect.height as i32 + (rect.height as i32 / 6).max(4))
        .min(signed_height.unsigned_abs() as i32);
    if right <= x || bottom <= y || right - x > 300 || bottom - y > 100 {
        return false;
    }
    let Some(crop) = crop_bmp(image, width, signed_height.unsigned_abs(), PhysicalRect {
        x, y, width: (right - x) as u32, height: (bottom - y) as u32,
    }) else { return false };
    let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { return false };
    found.blocks.len() == 1 && found.blocks[0].confidence >= 0.85
        && found.blocks[0].text.trim().eq_ignore_ascii_case(alternate_word)
}

fn rescue_large_word_rows(
    image: &[u8], primary: &OcrResult, alternate: &OcrResult,
) -> Option<OcrResult> {
    let mut replaced = vec![false; primary.blocks.len()];
    let mut additions = Vec::new();
    for alt in &alternate.blocks {
        let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
        let mut matching: Vec<usize> = primary.blocks.iter().enumerate().filter_map(|(i, block)| {
            let rect = block.box_rect;
            let center = rect.y as f32 + rect.height as f32 * 0.5;
            let overlap_x = (rect.x + rect.width as i32)
                .min(alt.box_rect.x + alt.box_rect.width as i32)
                - rect.x.max(alt.box_rect.x);
            ((center - alt_center).abs() <= 12.0 && overlap_x > 0
                && rect.height >= 28 && !replaced[i]).then_some(i)
        }).collect();
        if matching.len() < 3 {
            continue;
        }
        matching.sort_by_key(|&i| primary.blocks[i].box_rect.x);
        let row: Vec<&TextBlock> = matching.iter().map(|&i| &primary.blocks[i]).collect();
        let left = row.iter().map(|block| block.box_rect.x).min().unwrap();
        let right = row.iter().map(|block| {
            block.box_rect.x + block.box_rect.width as i32
        }).max().unwrap();
        if (alt.box_rect.x - left).abs() > 20
            || (alt.box_rect.x + alt.box_rect.width as i32 - right).abs() > 24
        {
            continue;
        }
        let joined = row.iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join(" ");
        if !ocr_texts_nearly_equal(&joined, &alt.text, 2) {
            continue;
        }
        if !ocr_texts_nearly_equal(&joined, &alt.text, 0) {
            let original_words: Vec<&str> = joined.split_whitespace().collect();
            let alternate_words: Vec<&str> = alt.text.split_whitespace().collect();
            if original_words.len() != alternate_words.len() {
                continue;
            }
            let differences: Vec<(&str, &str)> = original_words.iter()
                .zip(alternate_words.iter())
                .filter(|(a, b)| !a.eq_ignore_ascii_case(b))
                .map(|(&a, &b)| (a, b))
                .collect();
            let [(original_word, alternate_word)] = differences.as_slice() else { continue };
            if !confirm_alternate_word_in_pixels(image, &row, original_word, alternate_word) {
                continue;
            }
        }
        let top = row.iter().map(|block| block.box_rect.y).min().unwrap();
        let bottom = row.iter().map(|block| {
            block.box_rect.y + block.box_rect.height as i32
        }).max().unwrap();
        let mut recovered = alt.clone();
        recovered.box_rect.y = top;
        recovered.box_rect.height = (bottom - top) as u32;
        for i in matching { replaced[i] = true; }
        additions.push(recovered);
    }
    if additions.is_empty() {
        return None;
    }
    let mut blocks: Vec<TextBlock> = primary.blocks.iter().enumerate()
        .filter_map(|(i, block)| (!replaced[i]).then_some(block.clone()))
        .collect();
    blocks.extend(additions);
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    Some(OcrResult { blocks })
}

fn url_host(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("http://")
        .or_else(|| text.strip_prefix("https://"))?;
    let host = rest.split(['/', ':', '?', '#']).next()?;
    (!host.is_empty()).then_some(host)
}

fn is_mixed_script_url_host(text: &str) -> bool {
    let Some(host) = url_host(text) else { return false };
    host.chars().any(|character| character.is_ascii_alphabetic())
        && host.chars().any(|character| !character.is_ascii())
}

fn is_plausible_url_repair(original: &str, candidate: &str) -> bool {
    if !is_mixed_script_url_host(original)
        || !url_host(candidate).is_some_and(str::is_ascii)
        || !candidate.starts_with(if original.starts_with("https://") { "https://" } else { "http://" })
    {
        return false;
    }
    let original_chars: Vec<char> = original.chars().collect();
    let candidate_chars: Vec<char> = candidate.chars().collect();
    original_chars.len() == candidate_chars.len()
        && (1..=2).contains(&original_chars.iter().zip(candidate_chars.iter())
            .filter(|(left, right)| left != right).count())
}

fn rescue_mixed_script_urls(image: &[u8], mut primary: OcrResult) -> OcrResult {
    if image.len() < 54 || &image[..2] != b"BM" {
        return primary;
    }
    let width = u32::from_le_bytes(match image[18..22].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    let signed_height = i32::from_le_bytes(match image[22..26].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    if signed_height >= 0 || width == 0 {
        return primary;
    }
    let height = signed_height.unsigned_abs();
    let mut reviewed = 0;
    for block in &mut primary.blocks {
        if !is_mixed_script_url_host(&block.text) || reviewed >= 3 {
            continue;
        }
        reviewed += 1;
        let rect = block.box_rect;
        let pad_x = (rect.height / 3).max(4) as i32;
        let pad_y = (rect.height / 2).max(5) as i32;
        let x = (rect.x - pad_x).max(0);
        let y = (rect.y - pad_y).max(0);
        let right = (rect.x + rect.width as i32 + pad_x).min(width as i32);
        let bottom = (rect.y + rect.height as i32 + pad_y).min(height as i32);
        if right <= x || bottom <= y || right - x > 600 || bottom - y > 80 {
            continue;
        }
        let Some(crop) = crop_bmp(image, width, height, PhysicalRect {
            x, y, width: (right - x) as u32, height: (bottom - y) as u32,
        }) else { continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        if found.blocks.len() != 1 || found.blocks[0].confidence < 0.90 {
            continue;
        }
        let candidate = found.blocks[0].text.trim();
        if is_plausible_url_repair(&block.text, candidate) {
            block.text = candidate.to_owned();
            block.confidence = found.blocks[0].confidence;
        }
    }
    primary
}

fn append_ocr_piece(target: &mut String, piece: &str) {
    let piece = piece.trim();
    if piece.is_empty() {
        return;
    }
    if target.chars().last().is_some_and(|c| c.is_ascii_alphanumeric())
        && piece.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
    {
        target.push(' ');
    }
    target.push_str(piece);
}

fn compact_ocr_alnum(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase).collect()
}

/// A low-confidence detector fragment can append one invented CJK glyph
/// immediately after ASCII punctuation. Only remove it when a fresh crop of
/// the *whole physical row* reads every other alphanumeric character the
/// same way. This is intentionally narrower than replacing the full row:
/// the crop may normalize spaces and punctuation that the first pass kept.
fn confirmed_punctuation_tail_artifact(
    row: &[&TextBlock], suspect: usize, candidate: &TextBlock,
) -> bool {
    let Some(block) = row.get(suspect) else { return false };
    let text = block.text.trim_end();
    let mut tail = text.chars().rev();
    let Some(last) = tail.next() else { return false };
    let Some(before) = tail.next() else { return false };
    if !is_cjk_char(last) || !before.is_ascii_punctuation()
        || block.confidence >= 0.92 || candidate.confidence < 0.95
        || row.len() < 3
    {
        return false;
    }
    let original = row.iter().map(|part| part.text.as_str()).collect::<String>();
    let expected = compact_ocr_alnum(&original);
    let actual = compact_ocr_alnum(&candidate.text);
    let mut without_tail = String::new();
    for (index, part) in row.iter().enumerate() {
        if index == suspect {
            without_tail.extend(text.chars().take(text.chars().count() - 1));
        } else {
            without_tail.push_str(&part.text);
        }
    }
    let cleaned = compact_ocr_alnum(&without_tail);
    expected.chars().count() >= 24 && cleaned == actual
        && expected.chars().count() == actual.chars().count() + 1
}

fn rescue_punctuation_tail_artifacts(image: &[u8], mut primary: OcrResult) -> OcrResult {
    if image.len() < 54 || &image[..2] != b"BM" { return primary; }
    let width = u32::from_le_bytes(match image[18..22].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    let signed_height = i32::from_le_bytes(match image[22..26].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    if signed_height >= 0 || width == 0 { return primary; }
    let height = signed_height.unsigned_abs();
    let mut reviewed = 0;
    for index in 0..primary.blocks.len() {
        let block = &primary.blocks[index];
        let mut chars = block.text.trim_end().chars().rev();
        if reviewed >= 2 || block.confidence >= 0.92
            || !chars.next().is_some_and(is_cjk_char)
            || !chars.next().is_some_and(|ch| ch.is_ascii_punctuation())
        { continue; }
        let center = block.box_rect.y + block.box_rect.height as i32 / 2;
        let mut row_indices: Vec<usize> = primary.blocks.iter().enumerate()
            .filter_map(|(i, other)| {
                let r = other.box_rect;
                let other_center = r.y + r.height as i32 / 2;
                ((other_center - center).abs()
                    <= block.box_rect.height.min(r.height) as i32 / 3)
                    .then_some(i)
            }).collect();
        row_indices.sort_by_key(|&i| primary.blocks[i].box_rect.x);
        let Some(suspect) = row_indices.iter().position(|&i| i == index) else { continue };
        if row_indices.len() < 3 { continue; }
        let left = row_indices.iter().map(|&i| primary.blocks[i].box_rect.x).min().unwrap();
        let top = row_indices.iter().map(|&i| primary.blocks[i].box_rect.y).min().unwrap();
        let right = row_indices.iter().map(|&i| {
            let r = primary.blocks[i].box_rect; r.x + r.width as i32
        }).max().unwrap();
        let bottom = row_indices.iter().map(|&i| {
            let r = primary.blocks[i].box_rect; r.y + r.height as i32
        }).max().unwrap();
        let pad_x = (block.box_rect.height as i32 / 3).max(5);
        let pad_y = (block.box_rect.height as i32 / 2).max(5);
        let x = (left - pad_x).max(0);
        let y = (top - pad_y).max(0);
        let end_x = (right + pad_x).min(width as i32);
        let end_y = (bottom + pad_y).min(height as i32);
        if end_x <= x || end_y <= y || end_x - x > 900 || end_y - y > 80 {
            continue;
        }
        reviewed += 1;
        let Some(crop) = crop_bmp(image, width, height, PhysicalRect {
            x, y, width: (end_x - x) as u32, height: (end_y - y) as u32,
        }) else { continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        if found.blocks.len() != 1 { continue; }
        let row: Vec<&TextBlock> = row_indices.iter().map(|&i| &primary.blocks[i]).collect();
        if confirmed_punctuation_tail_artifact(&row, suspect, &found.blocks[0]) {
            primary.blocks[index].text.pop();
        }
    }
    primary
}

/// OCR sometimes includes an icon at the left of a line's rectangle while
/// recognizing only the text after it. Cropping away that prefix must leave
/// the *entire* alphanumeric transcript intact before the rectangle shrinks.
fn tighten_unseen_leading_pixels(image: &[u8], mut primary: OcrResult) -> OcrResult {
    if image.len() < 54 || &image[..2] != b"BM" {
        return primary;
    }
    let width = u32::from_le_bytes(match image[18..22].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    let signed_height = i32::from_le_bytes(match image[22..26].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    if signed_height >= 0 || width == 0 {
        return primary;
    }
    let height = signed_height.unsigned_abs();
    let mut reviewed = 0;
    for block in &mut primary.blocks {
        let rect = block.box_rect;
        let transcript = compact_ocr_alnum(&block.text);
        if reviewed >= 8 || rect.x < 0 || rect.x > rect.height as i32 + 4
            || rect.width < rect.height.saturating_mul(3)
            || transcript.chars().count() < 5
        {
            continue;
        }
        reviewed += 1;
        let top = (rect.y - 4).max(0);
        let bottom = (rect.y + rect.height as i32 + 4).min(height as i32);
        let old_right = rect.x + rect.width as i32;
        for offset in [rect.height as i32 * 4 / 5, rect.height as i32 + 2] {
            let x = rect.x + offset;
            let right = (old_right + 8).min(width as i32);
            if x <= rect.x || right <= x || bottom <= top || right - x > 1100
                || bottom - top > 80
            {
                continue;
            }
            let Some(crop) = crop_bmp(image, width, height, PhysicalRect {
                x, y: top, width: (right - x) as u32, height: (bottom - top) as u32,
            }) else { continue };
            let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
            if found.blocks.len() != 1 {
                continue;
            }
            let candidate = &found.blocks[0];
            let new_left = x + candidate.box_rect.x;
            let new_right = new_left + candidate.box_rect.width as i32;
            if candidate.confidence < 0.85
                || compact_ocr_alnum(&candidate.text) != transcript
                || new_left - rect.x < (rect.height as i32 * 2 / 5).max(8)
                || (new_right - old_right).abs() > (rect.height as i32 / 3).max(8)
                || new_right <= new_left
            {
                continue;
            }
            block.box_rect.x = new_left;
            block.box_rect.width = (new_right - new_left) as u32;
            break;
        }
    }
    primary
}

/// A detector can return the same long terminal row twice with slightly
/// different bounds. Re-read only that physical row; never concatenate the
/// overlapping strings or replace neighbouring rows.
fn rescue_overlapping_rows(image: &[u8], mut primary: OcrResult) -> OcrResult {
    if image.len() < 54 || &image[..2] != b"BM" {
        return primary;
    }
    let width = u32::from_le_bytes(match image[18..22].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    let signed_height = i32::from_le_bytes(match image[22..26].try_into() {
        Ok(bytes) => bytes, Err(_) => return primary,
    });
    if signed_height >= 0 || width == 0 {
        return primary;
    }
    let height = signed_height.unsigned_abs();
    let mut reviewed = 0;
    let mut index = 0;
    while index < primary.blocks.len() && reviewed < 8 {
        let anchor = primary.blocks[index].box_rect;
        let center = anchor.y + anchor.height as i32 / 2;
        let row: Vec<usize> = primary.blocks.iter().enumerate().filter_map(|(i, block)| {
            let rect = block.box_rect;
            let other_center = rect.y + rect.height as i32 / 2;
            ((other_center - center).abs() <= (anchor.height.min(rect.height) as i32 / 2).max(5))
                .then_some(i)
        }).collect();
        if row.len() < 2 {
            index += 1;
            continue;
        }
        // Short adjacent UI labels are often represented by generous boxes;
        // their overlap is not evidence that the labels are duplicates.
        if !row.iter().any(|&i| {
            let text = &primary.blocks[i].text;
            text.chars().count() >= 40
                && text.chars().filter(char::is_ascii_alphanumeric).count() >= 24
        }) {
            index += 1;
            continue;
        }
        let overlapping = row.iter().enumerate().any(|(offset, &left_index)| {
            row.iter().skip(offset + 1).any(|&right_index| {
                let left = primary.blocks[left_index].box_rect;
                let right = primary.blocks[right_index].box_rect;
                let shared = (left.x + left.width as i32).min(right.x + right.width as i32)
                    - left.x.max(right.x);
                shared > 0 && shared * 2 >= left.width.min(right.width) as i32
            })
        });
        if !overlapping {
            index += 1;
            continue;
        }
        reviewed += 1;
        let left = row.iter().map(|&i| primary.blocks[i].box_rect.x).min().unwrap();
        let top = row.iter().map(|&i| primary.blocks[i].box_rect.y).min().unwrap();
        let right = row.iter().map(|&i| {
            let rect = primary.blocks[i].box_rect;
            rect.x + rect.width as i32
        }).max().unwrap();
        let bottom = row.iter().map(|&i| {
            let rect = primary.blocks[i].box_rect;
            rect.y + rect.height as i32
        }).max().unwrap();
        let x = (left - 5).max(0);
        let y = (top - 4).max(0);
        let end_x = (right + 15).min(width as i32);
        let end_y = (bottom + 4).min(height as i32);
        if end_x <= x || end_y <= y || end_x - x > 1200 || end_y - y > 80 {
            index += 1;
            continue;
        }
        let Some(crop) = crop_bmp(image, width, height, PhysicalRect {
            x, y, width: (end_x - x) as u32, height: (end_y - y) as u32,
        }) else { index += 1; continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else {
            index += 1;
            continue;
        };
        if found.blocks.len() != 1 {
            index += 1;
            continue;
        }
        let mut candidate = found.blocks.into_iter().next().unwrap();
        let first = row.iter().min_by_key(|&&i| primary.blocks[i].box_rect.x).unwrap();
        let original_prefix = compact_ocr_alnum(&primary.blocks[*first].text);
        let candidate_prefix = compact_ocr_alnum(&candidate.text);
        let prefix_len = original_prefix.chars().count().min(8);
        let prefix: String = original_prefix.chars().take(prefix_len).collect();
        if candidate.confidence < 0.85 || prefix_len < 4
            || !candidate_prefix.starts_with(&prefix)
            || candidate.box_rect.width as i32 * 4 < (right - left) * 3
        {
            index += 1;
            continue;
        }
        candidate.box_rect.x += x;
        candidate.box_rect.y += y;
        for &remove in row.iter().rev() {
            primary.blocks.remove(remove);
        }
        primary.blocks.push(candidate);
        primary.blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
        index = 0;
    }
    primary
}

fn refine_gap_insert_from_pixels(
    image: &[u8], left: BoundingBox, right: BoundingBox, alternate_extra: &str,
) -> Option<String> {
    if image.len() < 54 || &image[..2] != b"BM" {
        return None;
    }
    let width = u32::from_le_bytes(image[18..22].try_into().ok()?);
    let signed_height = i32::from_le_bytes(image[22..26].try_into().ok()?);
    if signed_height >= 0 || width == 0 {
        return None;
    }
    let height = signed_height.unsigned_abs();
    let pixel_bytes = width.checked_mul(height)?.checked_mul(4)? as usize;
    if image.len() < 54usize.checked_add(pixel_bytes)? {
        return None;
    }
    let x = left.x + left.width as i32;
    let end = right.x;
    let top = (left.y.min(right.y) - 2).max(0);
    let bottom = (left.y + left.height as i32)
        .max(right.y + right.height as i32).saturating_add(2).min(height as i32);
    if x < 0 || end > width as i32 || end <= x || bottom <= top
        || end - x > 120 || bottom - top > 64
    {
        return None;
    }
    let gap = PhysicalRect { x, y: top, width: (end - x) as u32,
        height: (bottom - top) as u32 };
    let crop = crop_bmp(image, width, height, gap)?;
    let found = crate::onnx_ocr::recognize_bmp(&crop).ok()?;
    if found.blocks.len() != 1 {
        return None;
    }
    let block = &found.blocks[0];
    let local = block.text.trim();
    if block.confidence < 0.90 || local.is_empty()
        || block.box_rect.x < 0
        || block.box_rect.x + block.box_rect.width as i32 > gap.width as i32
    {
        return None;
    }
    let local_alnum = compact_ocr_alnum(local);
    if local_alnum.is_empty() || local_alnum != compact_ocr_alnum(alternate_extra) {
        return None;
    }
    Some(local.to_owned())
}

fn is_cjk_char(character: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&character)
}

fn cjk_line_tail_extra(primary_last: &str, alternate: &str) -> Option<String> {
    let mut chars = primary_last.trim().chars().rev();
    let end = chars.next()?;
    let before = chars.next()?;
    if !is_cjk_char(end) || !is_cjk_char(before) {
        return None;
    }
    let anchor = format!("{before}{end}");
    let (_, suffix) = alternate.rsplit_once(&anchor)?;
    let suffix = suffix.trim();
    if (1..=2).contains(&suffix.chars().count()) && suffix.chars().all(is_cjk_char) {
        Some(suffix.to_owned())
    } else {
        None
    }
}

fn restore_agreed_mixed_script_spaces(primary: &str, alternate: &str) -> String {
    let mut result = primary.to_owned();
    let words: Vec<&str> = alternate.split_whitespace().collect();
    for pair in words.windows(2) {
        let Some(left) = pair[0].chars().last() else { continue };
        let Some(right) = pair[1].chars().next() else { continue };
        if !((is_cjk_char(left) && right.is_ascii_alphanumeric())
            || (left.is_ascii_alphanumeric() && is_cjk_char(right)))
        {
            continue;
        }
        let latin_word = if is_cjk_char(left) { pair[1] } else { pair[0] };
        if latin_word.chars().filter(|character| character.is_ascii_alphanumeric()).count() < 4 {
            continue;
        }
        let adjacent = format!("{left}{right}");
        if result.matches(adjacent.as_str()).count() == 1 {
            result = result.replacen(adjacent.as_str(), &format!("{left} {right}"), 1);
        }
    }
    result
}

fn restore_row_spacing_from_alternate(mut primary: OcrResult, alternate: &OcrResult) -> OcrResult {
    for block in &mut primary.blocks {
        let center = block.box_rect.y as f32 + block.box_rect.height as f32 * 0.5;
        let best = alternate.blocks.iter().filter(|alt| {
            let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
            (center - alt_center).abs()
                <= (block.box_rect.height.min(alt.box_rect.height) as f32 * 0.65).max(5.0)
                && (block.box_rect.x + block.box_rect.width as i32)
                    .min(alt.box_rect.x + alt.box_rect.width as i32)
                    > block.box_rect.x.max(alt.box_rect.x)
        }).max_by_key(|alt| {
            let left = block.box_rect.x.max(alt.box_rect.x);
            let right = (block.box_rect.x + block.box_rect.width as i32)
                .min(alt.box_rect.x + alt.box_rect.width as i32);
            right - left
        });
        if let Some(alt) = best {
            block.text = restore_agreed_mixed_script_spaces(&block.text, &alt.text);
        }
    }
    primary
}

fn refine_line_tail_from_pixels(
    image: &[u8], last: BoundingBox, alternate: BoundingBox, extra: &str,
    anchor_last: char,
) -> Option<String> {
    if image.len() < 54 || &image[..2] != b"BM" {
        return None;
    }
    let width = u32::from_le_bytes(image[18..22].try_into().ok()?);
    let signed_height = i32::from_le_bytes(image[22..26].try_into().ok()?);
    if signed_height >= 0 || width == 0 {
        return None;
    }
    let height = signed_height.unsigned_abs();
    let last_right = last.x + last.width as i32;
    let alternate_right = alternate.x + alternate.width as i32;
    let tail_width = alternate_right - last_right;
    if tail_width <= 0 || tail_width > (last.height as i32 * 3 / 2).max(12) {
        return None;
    }
    let x = (last_right - 6).max(0);
    let right = (alternate_right + 5).min(width as i32);
    let top = (last.y - 3).max(0);
    let bottom = (last.y + last.height as i32 + 5).min(height as i32);
    if right <= x || bottom <= top || right - x > 72 || bottom - top > 48 {
        return None;
    }
    let crop = crop_bmp(image, width, height, PhysicalRect {
        x, y: top, width: (right - x) as u32, height: (bottom - top) as u32,
    })?;
    let found = crate::onnx_ocr::recognize_bmp(&crop).ok()?;
    if found.blocks.len() != 1 || found.blocks[0].confidence < 0.78 {
        return None;
    }
    let local = found.blocks[0].text.trim();
    let confirmation = format!("{anchor_last}{extra}");
    local.ends_with(&confirmation).then_some(extra.to_owned())
}

/// Recover *insertions* inside physical gaps between primary OCR boxes, using
/// exact text on both sides as anchors in the second engine. Substitutions are
/// deliberately left to the primary engine: the chat fixture's WinRT result
/// finds `1.1` but misreads several Chinese characters ONNX got right.
#[cfg(test)]
fn fill_primary_row_gaps(row: &OcrResult, alternate_text: &str) -> Option<String> {
    fill_primary_row_gaps_with_image(row, alternate_text, None, None)
}

fn fill_primary_row_gaps_with_image(
    row: &OcrResult, alternate_text: &str, image: Option<&[u8]>,
    alternate_box: Option<BoundingBox>,
) -> Option<String> {
    let mut boxes: Vec<&TextBlock> = row.blocks.iter().collect();
    boxes.sort_by_key(|block| block.box_rect.x);
    if boxes.len() < 2 {
        return None;
    }
    let mut reconstructed = String::new();
    let mut inserted_any = false;
    let mut pixel_reviews = 0usize;
    for (index, block) in boxes.iter().enumerate() {
        append_ocr_piece(&mut reconstructed, &block.text);
        let Some(next) = boxes.get(index + 1) else { continue };
        let gap = next.box_rect.x - (block.box_rect.x + block.box_rect.width as i32);
        let height = block.box_rect.height.max(next.box_rect.height).max(1) as f32;
        if (gap as f32) < height * 0.55 || (gap as f32) > height * 5.0 {
            continue;
        }
        let left: Vec<char> = block.text.trim().chars().collect();
        let right: Vec<char> = next.text.trim().chars().collect();
        let max_extra = ((gap as f32 / height) * 2.5).ceil() as usize + 2;
        let mut best: Option<(usize, usize, String)> = None;
        for left_len in (1..=left.len().min(6)).rev() {
            let left_anchor: String = left[left.len() - left_len..].iter().collect();
            for (left_at, _) in alternate_text.match_indices(&left_anchor) {
                let after_left = left_at + left_anchor.len();
                for right_len in (1..=right.len().min(6)).rev() {
                    let right_anchor: String = right[..right_len].iter().collect();
                    for (relative_right_at, _) in alternate_text[after_left..].match_indices(&right_anchor) {
                        let right_at = after_left + relative_right_at;
                        let extra = alternate_text[after_left..right_at].trim();
                        let extra_len = extra.chars().filter(|c| !c.is_whitespace()).count();
                        if extra_len == 0 || extra_len > max_extra.min(16)
                            || !extra.chars().any(char::is_alphanumeric)
                        {
                            continue;
                        }
                        let score = left_len + right_len;
                        if best.as_ref().is_none_or(|(old_score, old_len, _)| {
                            score > *old_score || (score == *old_score && extra_len < *old_len)
                        }) {
                            best = Some((score, extra_len, extra.to_owned()));
                        }
                    }
                }
            }
        }
        if let Some((_, _, mut extra)) = best {
            if pixel_reviews < 3 {
                if let Some(image) = image {
                    pixel_reviews += 1;
                    if let Some(local) = refine_gap_insert_from_pixels(
                        image, block.box_rect, next.box_rect, &extra,
                    ) {
                        extra = local;
                    }
                }
            }
            append_ocr_piece(&mut reconstructed, &extra);
            inserted_any = true;
        }
    }
    if let (Some(image), Some(alternate_box), Some(last)) = (image, alternate_box, boxes.last()) {
        if let Some(extra) = cjk_line_tail_extra(&last.text, alternate_text) {
            if let Some(anchor_last) = last.text.trim().chars().last() {
                if let Some(local) = refine_line_tail_from_pixels(
                    image, last.box_rect, alternate_box, &extra, anchor_last,
                ) {
                    append_ocr_piece(&mut reconstructed, &local);
                    inserted_any = true;
                }
            }
        }
    }
    inserted_any.then_some(reconstructed)
}

/// A lone closing bracket at the end of an OCR line is often a glyph error.
/// Correct it only when the other engine reads a letter/ideograph and the two
/// preceding characters agree exactly; leave balanced quotations untouched.
fn repair_dangling_closer(primary: &str, alternate: &str) -> Option<String> {
    let primary = primary.trim_end();
    let alternate = alternate.trim_end();
    let close = primary.chars().last()?;
    let open = match close {
        '』' => '『', '」' => '「', '》' => '《', '】' => '【', '）' => '（',
        _ => return None,
    };
    if primary.contains(open) {
        return None;
    }
    let replacement = alternate.chars().last()?;
    if !replacement.is_alphanumeric() {
        return None;
    }
    let primary_before: String = primary.chars().rev().skip(1).take(2).collect();
    let alternate_before: String = alternate.chars().rev().skip(1).take(2).collect();
    if primary_before.chars().count() != 2 || primary_before != alternate_before {
        return None;
    }
    let mut corrected: String = primary.chars().take(primary.chars().count() - 1).collect();
    corrected.push(replacement);
    Some(corrected)
}

/// On a compact crop, replace only the broken row that the second engine
/// actually recovered. Whole-result replacement can discard a correct nearby
/// row: the chat-bubble fixture has a missing `1.1` in row one but ONNX reads
/// row two more accurately than WinRT.
#[cfg(test)]
fn rescue_suspicious_rows(primary: &OcrResult, alternate: &OcrResult) -> Option<OcrResult> {
    rescue_suspicious_rows_with_image(primary, alternate, None)
}

fn rescue_suspicious_rows_with_image(
    primary: &OcrResult, alternate: &OcrResult, image: Option<&[u8]>,
) -> Option<OcrResult> {
    let mut replaced = vec![false; primary.blocks.len()];
    let mut additions = Vec::new();

    for alt in &alternate.blocks {
        if alt.text.trim().is_empty() || alt.box_rect.height < 6 {
            continue;
        }
        let alt_center = alt.box_rect.y as f32 + alt.box_rect.height as f32 * 0.5;
        let matching: Vec<usize> = primary.blocks.iter().enumerate().filter_map(|(index, main)| {
            if replaced[index] || main.text.trim().is_empty() {
                return None;
            }
            let main_center = main.box_rect.y as f32 + main.box_rect.height as f32 * 0.5;
            let tolerance = (main.box_rect.height.min(alt.box_rect.height) as f32 * 0.65).max(5.0);
            let overlap_x = (main.box_rect.x + main.box_rect.width as i32)
                .min(alt.box_rect.x + alt.box_rect.width as i32)
                - main.box_rect.x.max(alt.box_rect.x);
            ((main_center - alt_center).abs() <= tolerance && overlap_x > 0).then_some(index)
        }).collect();
        if matching.len() < 3 {
            continue;
        }
        let row = OcrResult {
            blocks: matching.iter().map(|&index| primary.blocks[index].clone()).collect(),
        };
        if !should_review_suspicious_row_gaps(&row) {
            continue;
        }
        let gap_filled = fill_primary_row_gaps_with_image(&row, &alt.text, image, Some(alt.box_rect));
        let (primary_chars, _, _) = ocr_text_shape(&row);
        let alt_chars = alt.text.chars().filter(|c| !c.is_whitespace()).count();
        if gap_filled.is_none()
            && (alt_chars < primary_chars + 2 || alt_chars * 100 < primary_chars * 105)
        {
            continue;
        }
        // Keep the primary engine's physical text height. WinRT often returns
        // a much tighter glyph rectangle than ONNX; using it verbatim makes
        // the translated overlay noticeably smaller than the source text.
        let left = matching.iter().map(|&index| primary.blocks[index].box_rect.x)
            .min().unwrap().min(alt.box_rect.x);
        let top = matching.iter().map(|&index| primary.blocks[index].box_rect.y)
            .min().unwrap();
        let right = matching.iter().map(|&index| {
            let rect = primary.blocks[index].box_rect;
            rect.x + rect.width as i32
        }).max().unwrap().max(alt.box_rect.x + alt.box_rect.width as i32);
        let bottom = matching.iter().map(|&index| {
            let rect = primary.blocks[index].box_rect;
            rect.y + rect.height as i32
        }).max().unwrap();
        let mut recovered = alt.clone();
        if let Some(text) = gap_filled {
            recovered.text = repair_dangling_closer(&text, &alt.text).unwrap_or(text);
            recovered.confidence = row.blocks.iter()
                .map(|block| block.confidence)
                .fold(recovered.confidence, f32::min);
        }
        recovered.box_rect = BoundingBox {
            x: left,
            y: top,
            width: (right - left).max(1) as u32,
            height: (bottom - top).max(1) as u32,
        };
        for index in matching {
            replaced[index] = true;
        }
        additions.push(recovered);
    }

    if additions.is_empty() {
        return None;
    }
    let mut blocks: Vec<TextBlock> = primary.blocks.iter().enumerate()
        .filter_map(|(index, block)| (!replaced[index]).then_some(block.clone()))
        .collect();
    blocks.extend(additions);
    blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    Some(OcrResult { blocks })
}

/// A coloured toolbar icon can be joined to the preceding label by DBNet.
/// Only split at a visible dark gutter between a neutral label chip and a
/// saturated icon chip; a mere one-letter OCR suffix is not enough evidence.
fn colored_toolbar_icon_split(image: &[u8], bbox: BoundingBox) -> Option<i32> {
    if image.len() < 54 || &image[..2] != b"BM" || !(40..=200).contains(&bbox.width)
        || !(12..=35).contains(&bbox.height)
    {
        return None;
    }
    let width = u32::from_le_bytes(image[18..22].try_into().ok()?);
    let signed_height = i32::from_le_bytes(image[22..26].try_into().ok()?);
    if signed_height >= 0 || width == 0 {
        return None;
    }
    let height = signed_height.unsigned_abs();
    if bbox.x < 8 || bbox.y < 0 || bbox.x + bbox.width as i32 + 8 >= width as i32
        || bbox.y + bbox.height as i32 > height as i32
        || image.len() < 54usize.checked_add(width.checked_mul(height)?.checked_mul(4)? as usize)?
    {
        return None;
    }
    let pixel = |x: i32, y: i32| -> [u8; 3] {
        let offset = 54 + ((y as u32 * width + x as u32) * 4) as usize;
        [image[offset + 2], image[offset + 1], image[offset]]
    };
    let top = bbox.y + bbox.height as i32 / 4;
    let bottom = bbox.y + bbox.height as i32 * 3 / 4;
    let rows = (bottom - top).max(1);
    let start = bbox.x + (bbox.width as i32 * 55 / 100);
    let end = bbox.x + (bbox.width as i32 * 85 / 100);
    for x in start..end {
        let mut gutter = 0;
        let mut neutral_left = 0;
        let mut saturated_right = 0;
        for y in top..bottom {
            let center = pixel(x, y);
            let next = pixel(x + 1, y);
            if center.iter().copied().max().unwrap_or(255) < 50
                && next.iter().copied().max().unwrap_or(255) < 22
            {
                gutter += 1;
            }
            let left = pixel(x - 5, y);
            // Sample the icon's solid interior, not its pale glyph stroke.
            let right = pixel(x + 4, y);
            let left_chroma = left.iter().max().unwrap() - left.iter().min().unwrap();
            let right_chroma = right.iter().max().unwrap() - right.iter().min().unwrap();
            if left_chroma < 22 && left.iter().copied().max().unwrap_or(0) >= 30 {
                neutral_left += 1;
            }
            if right_chroma >= 55 && right.iter().copied().max().unwrap_or(0) >= 65 {
                saturated_right += 1;
            }
        }
        if gutter * 100 >= rows * 65 && neutral_left * 100 >= rows * 65
            && saturated_right * 100 >= rows * 50
        {
            return Some(x);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn rescue_colored_icon_suffix(image: &[u8], mut primary: OcrResult) -> OcrResult {
    let mut reviewed = 0;
    for block in &mut primary.blocks {
        if reviewed >= 2 || block.confidence < 0.75 {
            continue;
        }
        let source = block.text.trim();
        let Some(last) = source.chars().last() else { continue };
        if source.chars().count() < 5 || !source.chars().any(is_cjk_char) {
            continue;
        }
        // A mixed-script label can already read correctly while its detector
        // box also covers the next coloured icon. Recheck the crop before the
        // icon and shrink only the geometry in that case. The older branch
        // additionally removes a hallucinated non-CJK trailing character.
        let geometry_only = is_cjk_char(last) && source.chars().any(|c| c.is_ascii_alphanumeric());
        let expected = if geometry_only {
            source
        } else {
            &source[..source.len() - last.len_utf8()]
        };
        if !geometry_only && (is_cjk_char(last) || expected.chars().count() < 4) {
            continue;
        }
        let Some(split) = colored_toolbar_icon_split(image, block.box_rect) else { continue };
        reviewed += 1;
        let x = (block.box_rect.x - 2).max(0);
        let y = (block.box_rect.y - 2).max(0);
        let crop_rect = PhysicalRect {
            x,
            y,
            width: (split - x + 1) as u32,
            height: block.box_rect.height + (block.box_rect.y - y) as u32 + 2,
        };
        let width = u32::from_le_bytes(image[18..22].try_into().unwrap());
        let height = i32::from_le_bytes(image[22..26].try_into().unwrap()).unsigned_abs();
        let Some(crop) = crop_bmp(image, width, height, crop_rect) else { continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        if found.blocks.len() != 1 || found.blocks[0].confidence < 0.90
            || (!geometry_only && found.blocks[0].confidence <= block.confidence + 0.04)
            || found.blocks[0].text.trim() != expected
        {
            continue;
        }
        block.text = expected.to_owned();
        block.confidence = found.blocks[0].confidence;
        block.box_rect.width = (split - block.box_rect.x).max(1) as u32;
    }
    primary
}

/// WinRT often preserves word gaps in compact terminal rows while replacing
/// dots in version numbers with spaces. Borrow only gap positions where both
/// engines agree on every ASCII letter/digit, and never insert beside source
/// punctuation (so `v7.3.6` stays intact).
fn agreed_ascii_word_spaces(primary: &str, alternate: &str) -> Option<String> {
    if (!primary.chars().any(|c| c.is_ascii_digit())
        && primary.split_whitespace().count() < 3)
        || !primary.chars().any(|c| c.is_ascii_alphabetic())
    {
        return None;
    }
    let source: Vec<(usize, char)> = primary.char_indices()
        .filter(|(_, c)| c.is_ascii_alphanumeric())
        .collect();
    let other: Vec<char> = alternate.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if source.len() < 10 || source.len() != other.len()
        || !source.iter().zip(&other).all(|((_, a), b)| a.eq_ignore_ascii_case(b))
    {
        return None;
    }
    let mut count = 0usize;
    let mut boundaries = Vec::new();
    let mut in_gap = false;
    for c in alternate.chars() {
        if c.is_ascii_alphanumeric() {
            if in_gap && count > 0 && count < source.len() {
                boundaries.push(count);
            }
            count += 1;
            in_gap = false;
        } else if c.is_whitespace() {
            in_gap = true;
        } else {
            // Punctuation in the alternate cannot by itself authorize a gap.
            in_gap = false;
        }
    }
    let mut insert_at = Vec::new();
    let mut agreed_existing = 0usize;
    for boundary in boundaries {
        let previous_end = source[boundary - 1].0 + source[boundary - 1].1.len_utf8();
        let next_start = source[boundary].0;
        if previous_end == next_start {
            insert_at.push(next_start);
        } else if primary[previous_end..next_start].chars().any(char::is_whitespace) {
            agreed_existing += 1;
        }
    }
    insert_at.sort_unstable();
    insert_at.dedup();
    // Two new gaps were the original conservative threshold. A partially
    // spaced line can also provide independent alignment evidence: two word
    // boundaries already agree, so one missing boundary is safe to transfer.
    if insert_at.len() < 2 && !(insert_at.len() == 1 && agreed_existing >= 2) {
        return None;
    }
    let mut recovered = primary.to_owned();
    for index in insert_at.into_iter().rev() {
        recovered.insert(index, ' ');
    }
    Some(recovered)
}

fn should_review_compact_ascii_spacing(result: &OcrResult) -> bool {
    result.blocks.iter().any(|block| {
        let text = block.text.as_str();
        if text.len() < 16 || !text.is_ascii() || !text.contains('.')
            || text.chars().any(char::is_whitespace)
        {
            return false;
        }
        text.as_bytes().windows(2).filter(|pair| {
            (pair[0].is_ascii_digit() && pair[1].is_ascii_alphabetic())
                || (pair[0].is_ascii_alphabetic() && pair[1].is_ascii_digit())
        }).count() >= 3
    })
}

#[cfg(target_os = "windows")]
fn should_review_missing_terminal_prompt(result: &OcrResult) -> bool {
    result.blocks.len() >= 10 && result.blocks.iter().any(|block| {
        let text = block.text.trim();
        block.box_rect.x <= 40 && block.box_rect.height <= 24
            && text.is_ascii() && text.contains('@') && text.contains('.')
            && text.split_whitespace().count() >= 2 && !text.starts_with('>')
    })
}

#[cfg(target_os = "windows")]
fn restore_agreed_terminal_row_spacing(mut primary: OcrResult, alternate: &OcrResult) -> OcrResult {
    for block in &mut primary.blocks {
        if block.confidence < 0.80 {
            continue;
        }
        let bbox = block.box_rect;
        let center = bbox.y as f32 + bbox.height as f32 * 0.5;
        let left = bbox.x - 6;
        // WinRT may include a closing punctuation mark just beyond the ONNX
        // box; exact alphanumeric agreement below still guards the transfer.
        let right = bbox.x + bbox.width as i32 + bbox.height.max(6) as i32;
        let mut row: Vec<&TextBlock> = alternate.blocks.iter().filter(|candidate| {
            let rect = candidate.box_rect;
            let other_center = rect.y as f32 + rect.height as f32 * 0.5;
            (other_center - center).abs() <= bbox.height.min(rect.height) as f32 * 0.65
                && rect.x >= left && rect.x + rect.width as i32 <= right
        }).collect();
        if row.is_empty() {
            continue;
        }
        row.sort_by_key(|candidate| candidate.box_rect.x);
        let alternate_text = row.iter().map(|candidate| candidate.text.as_str())
            .collect::<Vec<_>>().join(" ");
        if let Some(recovered) = agreed_ascii_word_spaces(&block.text, &alternate_text) {
            block.text = recovered;
        }
    }
    // ONNX often detects a compact first token and the remainder as separate
    // boxes ("VITEV7.3.6" + "ready in 239 ms"). The per-box check cannot
    // compare either fragment with WinRT's full physical line. Align the
    // entire row, then transfer only spaces that fall inside its first box;
    // keep every original box and its geometry intact for in-situ rendering.
    let lines = crate::reconstruction::LineClusterer::cluster_into_lines(primary.blocks.clone(), 18.0);
    for line in lines {
        if line.len() < 2 || line.iter().any(|block| !block.text.is_ascii()) { continue; }
        let joined = line.iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join(" ");
        if joined.len() < 20 { continue; }
        let first = &line[0];
        if first.text.chars().any(char::is_whitespace) { continue; }
        let left = first.box_rect.x;
        let right = line.iter().map(|block| block.box_rect.x + block.box_rect.width as i32)
            .max().unwrap_or(left);
        let center = first.box_rect.y + first.box_rect.height as i32 / 2;
        // WinRT can split the same sentence into boxes with a >8px gap, so
        // gather the matching physical row by y and bounded x instead of
        // asking the stricter layout clusterer to join those boxes.
        let mut other: Vec<&TextBlock> = alternate.blocks.iter().filter(|block| {
            let rect = block.box_rect;
            let other_center = rect.y + rect.height as i32 / 2;
            (other_center - center).abs() <= 6
                && rect.x >= left - 12
                && rect.x + rect.width as i32 <= right + first.box_rect.height as i32
        }).collect();
        if other.is_empty() { continue; }
        other.sort_by_key(|block| block.box_rect.x);
        if (other[0].box_rect.x - left).abs() > 12 { continue; }
        let other_right = other.iter().map(|block| block.box_rect.x + block.box_rect.width as i32)
            .max().unwrap_or(left);
        if (other_right - right).abs() > first.box_rect.height as i32 { continue; }
        let other_text = other.iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join(" ");
        let Some(recovered) = agreed_ascii_word_spaces(&joined, &other_text) else { continue; };
        let target_nonspace = first.text.bytes().filter(|byte| !byte.is_ascii_whitespace()).count();
        let mut seen = 0usize;
        let end = recovered.char_indices().find_map(|(index, ch)| {
            if !ch.is_whitespace() { seen += 1; }
            (seen == target_nonspace).then_some(index + ch.len_utf8())
        });
        let Some(end) = end else { continue; };
        let new_first = &recovered[..end];
        if new_first == first.text { continue; }
        if let Some(block) = primary.blocks.iter_mut().find(|block|
            block.box_rect == first.box_rect && block.text == first.text)
        {
            block.text = new_first.to_owned();
        }
    }
    primary
}

#[cfg(target_os = "windows")]
fn restore_agreed_prompt_prefix(mut primary: OcrResult, alternate: &OcrResult) -> OcrResult {
    for block in &mut primary.blocks {
        let text = block.text.trim();
        if text.len() < 8 || text.starts_with('>') || block.confidence < 0.9 {
            continue;
        }
        let rect = block.box_rect;
        let main_center = rect.y + rect.height as i32 / 2;
        let main_right = rect.x + rect.width as i32;
        let Some(alt) = alternate.blocks.iter().find(|candidate| {
            let Some(rest) = candidate.text.trim().strip_prefix('>') else { return false };
            let other = candidate.box_rect;
            let other_center = other.y + other.height as i32 / 2;
            let other_right = other.x + other.width as i32;
            let prefix_pixels = rect.x - other.x;
            (6..=(rect.height as i32 * 3 / 2).max(10)).contains(&prefix_pixels)
                && (main_center - other_center).abs()
                    <= (rect.height.min(other.height) as i32 / 2).max(5)
                && (main_right - other_right).abs() <= rect.height as i32
                && ocr_texts_nearly_equal(text, rest.trim(), 5)
        }) else { continue };
        block.text = format!("> {}", text);
        block.box_rect.width = (main_right - alt.box_rect.x).max(1) as u32;
        block.box_rect.x = alt.box_rect.x;
    }
    primary
}

/// A nearly uniform dark capture (terminal / log pane) has strong horizontal
/// text strokes even when DBNet misses an entire row. This finds *uncovered*
/// physical rows from pixels only; it never turns pixels into text directly.
/// Each row still needs a high-confidence ONNX crop before entering the OCR
/// result. Thin separators, window chrome and ordinary light pages are gated
/// out so a drawing is not silently promoted to a translatable label.
fn dark_pixel_text_rows(image: &[u8]) -> Vec<PhysicalRect> {
    if image.len() < 54 || &image[..2] != b"BM" { return Vec::new(); }
    let offset = u32::from_le_bytes(match image[10..14].try_into() {
        Ok(bytes) => bytes, Err(_) => return Vec::new(),
    }) as usize;
    let width = u32::from_le_bytes(match image[18..22].try_into() {
        Ok(bytes) => bytes, Err(_) => return Vec::new(),
    }) as usize;
    let signed_height = i32::from_le_bytes(match image[22..26].try_into() {
        Ok(bytes) => bytes, Err(_) => return Vec::new(),
    });
    let bpp = u16::from_le_bytes(match image[28..30].try_into() {
        Ok(bytes) => bytes, Err(_) => return Vec::new(),
    });
    if signed_height >= 0 || bpp != 32 || width < 500 || !(250..=2500).contains(&signed_height.unsigned_abs()) {
        return Vec::new();
    }
    let height = signed_height.unsigned_abs() as usize;
    let Some(stride) = width.checked_mul(4) else { return Vec::new() };
    let Some(end) = stride.checked_mul(height).and_then(|bytes| offset.checked_add(bytes)) else {
        return Vec::new();
    };
    if end > image.len() { return Vec::new(); }
    let pixels = &image[offset..end];
    let mut dark = 0usize;
    let mut sampled = 0usize;
    for y in (36..height).step_by(16) {
        for x in (0..width).step_by(16) {
            let p = y * stride + x * 4;
            if pixels[p].max(pixels[p + 1]).max(pixels[p + 2]) <= 45 { dark += 1; }
            sampled += 1;
        }
    }
    if sampled == 0 || dark * 100 < sampled * 78 { return Vec::new(); }

    let threshold = (width / 140).max(8);
    let mut counts = vec![0usize; height];
    let mut lefts = vec![width; height];
    let mut rights = vec![0usize; height];
    for y in 36..height {
        for x in 0..width {
            let p = y * stride + x * 4;
            if pixels[p].max(pixels[p + 1]).max(pixels[p + 2]) >= 95 {
                counts[y] += 1;
                lefts[y] = lefts[y].min(x);
                rights[y] = rights[y].max(x);
            }
        }
    }
    let mut rows = Vec::new();
    let mut y = 36usize;
    while y < height {
        if counts[y] < threshold { y += 1; continue; }
        let start = y;
        let mut left = width;
        let mut right = 0usize;
        let mut ink = 0usize;
        while y < height && counts[y] >= threshold {
            left = left.min(lefts[y]);
            right = right.max(rights[y]);
            ink += counts[y];
            y += 1;
        }
        let row_height = y - start;
        if !(8..=26).contains(&row_height) || right.saturating_sub(left) < 50 || ink < 60 {
            continue;
        }
        let x0 = left.saturating_sub(7);
        let y0 = start.saturating_sub(5);
        let x1 = (right + 8).min(width);
        let y1 = (y + 5).min(height);
        rows.push(PhysicalRect {
            x: x0 as i32, y: y0 as i32,
            width: (x1 - x0) as u32, height: (y1 - y0) as u32,
        });
    }
    rows
}

fn dark_uncovered_text_rows(image: &[u8], primary: &OcrResult) -> Vec<PhysicalRect> {
    // Without several trusted neighboring rows there is no evidence that the
    // bright strokes belong to a text-dense terminal rather than artwork.
    if primary.blocks.len() < 3 { return Vec::new(); }
    dark_pixel_text_rows(image).into_iter().filter(|row| {
        let ink_top = row.y + 5;
        let ink_bottom = row.y + row.height as i32 - 5;
        !primary.blocks.iter().any(|block| {
            let rect = block.box_rect;
            let center = rect.y + rect.height as i32 / 2;
            center >= ink_top - 3 && center <= ink_bottom + 3
        })
    }).collect()
}

fn rescue_dark_uncovered_text_rows(image: &[u8], mut primary: OcrResult) -> OcrResult {
    let image_width = if image.len() >= 22 {
        u32::from_le_bytes(image[18..22].try_into().unwrap_or([0; 4]))
    } else { 0 };
    let image_height = if image.len() >= 26 {
        i32::from_le_bytes(image[22..26].try_into().unwrap_or([0; 4])).unsigned_abs()
    } else { 0 };
    for row in dark_uncovered_text_rows(image, &primary).into_iter().take(3) {
        let Some(crop) = crop_bmp(image, image_width, image_height, row) else { continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        for mut block in found.blocks {
            let center = row.y + block.box_rect.y + block.box_rect.height as i32 / 2;
            if block.confidence < 0.85 || block.box_rect.height < 6
                || block.text.chars().filter(|ch| ch.is_alphanumeric()).count() < 4
                || center < row.y + 2 || center > row.y + row.height as i32 - 2
            { continue; }
            block.box_rect.x += row.x;
            block.box_rect.y += row.y;
            if primary.blocks.iter().any(|existing| {
                let a = existing.box_rect;
                let b = block.box_rect;
                let overlap_x = (a.x + a.width as i32).min(b.x + b.width as i32) - a.x.max(b.x);
                let overlap_y = (a.y + a.height as i32).min(b.y + b.height as i32) - a.y.max(b.y);
                overlap_x.max(0) as u32 * overlap_y.max(0) as u32
                    > b.width.saturating_mul(b.height) / 3
            }) { continue; }
            primary.blocks.push(block);
        }
    }
    primary.blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    primary
}

/// A detector can read the start of a terminal command but miss its trailing
/// switches. Only a whole-row crop that preserves all previously recognized
/// alphanumeric content and extends to the visible ink may replace that row.
fn rescue_dark_command_tails(image: &[u8], mut primary: OcrResult) -> OcrResult {
    if primary.blocks.len() < 6 || image.len() < 26 { return primary; }
    let width = u32::from_le_bytes(image[18..22].try_into().unwrap_or([0; 4]));
    let height = i32::from_le_bytes(image[22..26].try_into().unwrap_or([0; 4])).unsigned_abs();
    let compact = |text: &str| -> String {
        text.chars().filter(|ch| ch.is_alphanumeric())
            .flat_map(char::to_lowercase).collect()
    };
    let mut recovered = 0;
    for row in dark_pixel_text_rows(image) {
        if recovered >= 2 { break; }
        let ink_top = row.y + 5;
        let ink_bottom = row.y + row.height as i32 - 5;
        let mut row_blocks: Vec<_> = primary.blocks.iter().filter(|block| {
            let rect = block.box_rect;
            let center = rect.y + rect.height as i32 / 2;
            center >= ink_top - 3 && center <= ink_bottom + 3
                && rect.x >= row.x - 8
                && rect.x < row.x + row.width as i32
        }).cloned().collect();
        if row_blocks.len() < 2 { continue; }
        row_blocks.sort_by_key(|block| block.box_rect.x);
        let original = row_blocks.iter().map(|block| block.text.as_str())
            .collect::<Vec<_>>().join(" ");
        if !original.contains("Running") && !original.contains("cargo")
            && !original.contains("VITE") && !original.contains("DevCommand")
        { continue; }
        let old_left = row_blocks.iter().map(|block| block.box_rect.x).min().unwrap_or(0);
        let old_right = row_blocks.iter().map(|block| block.box_rect.x + block.box_rect.width as i32)
            .max().unwrap_or(0);
        let ink_right = row.x + row.width as i32 - 8;
        if ink_right - old_right < 20 { continue; }
        let Some(crop) = crop_bmp(image, width, height, row) else { continue };
        let Ok(result) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        if result.blocks.len() != 1 { continue; }
        let mut candidate = result.blocks.into_iter().next().unwrap();
        // Paddle's CTC decoder can use a mathematical minus for a shell dash;
        // a command crop gives enough context to normalize that glyph safely.
        candidate.text = candidate.text.replace('−', "-").replace('–', "-");
        candidate.box_rect.x += row.x;
        candidate.box_rect.y += row.y;
        let new_right = candidate.box_rect.x + candidate.box_rect.width as i32;
        let old_compact = compact(&original);
        let new_compact = compact(&candidate.text);
        if candidate.confidence < 0.90 || candidate.text.contains('\n')
            || candidate.box_rect.height > row.height
            || (candidate.box_rect.x - old_left).abs() > 12
            || new_right < old_right + 16 || new_right > ink_right + 12
            || old_compact.len() < 24 || !new_compact.contains(&old_compact)
        { continue; }
        primary.blocks.retain(|block| !row_blocks.iter().any(|old| {
            old.box_rect == block.box_rect && old.text == block.text
        }));
        primary.blocks.push(candidate);
        recovered += 1;
    }
    primary.blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
    primary
}

/// Return the one CJK glyph that a full physical-row crop can prove was
/// omitted exactly between two neighboring detector fragments. Ignore spaces
/// and punctuation because crop OCR is less reliable for terminal ellipses.
fn one_missing_cjk_at_fragment_gap(row: &[TextBlock], candidate: &str) -> Option<(usize, char)> {
    let compact = |text: &str| -> Vec<char> {
        text.chars().filter(|ch| ch.is_alphanumeric())
            .flat_map(char::to_lowercase).collect()
    };
    let old: Vec<char> = row.iter().flat_map(|block| compact(&block.text)).collect();
    let new = compact(candidate);
    if old.len() < 12 || new.len() != old.len() + 1 { return None; }
    let mut offset = 0usize;
    let mut found = None;
    for index in 1..row.len() {
        offset += compact(&row[index - 1].text).len();
        let left = &row[index - 1];
        let right = &row[index];
        let gap = right.box_rect.x - left.box_rect.x - left.box_rect.width as i32;
        if !(4..=22).contains(&gap)
            || !left.text.chars().last().is_some_and(is_cjk_char)
            || !right.text.chars().next().is_some_and(is_cjk_char)
            || !new.get(offset).is_some_and(|ch| is_cjk_char(*ch))
            || new[..offset] != old[..offset]
            || new[offset + 1..] != old[offset..]
        { continue; }
        if found.is_some() { return None; }
        found = Some((index - 1, new[offset]));
    }
    found
}

/// A whole-row crop can recover a single glyph lost in a narrow CJK fragment
/// gap. Keep the original boxes and every other recognized character: the
/// crop often misreads final punctuation even when its missing glyph is clear.
fn rescue_dark_cjk_fragment_gaps(image: &[u8], mut primary: OcrResult) -> OcrResult {
    if primary.blocks.len() < 12 || image.len() < 26 { return primary; }
    let width = u32::from_le_bytes(image[18..22].try_into().unwrap_or([0; 4]));
    let height = i32::from_le_bytes(image[22..26].try_into().unwrap_or([0; 4])).unsigned_abs();
    let mut attempts = 0usize;
    let mut recovered = 0usize;
    for row in dark_pixel_text_rows(image) {
        if attempts >= 4 || recovered >= 2 { break; }
        let ink_top = row.y + 5;
        let ink_bottom = row.y + row.height as i32 - 5;
        let mut row_blocks: Vec<_> = primary.blocks.iter().filter(|block| {
            let rect = block.box_rect;
            let center = rect.y + rect.height as i32 / 2;
            center >= ink_top - 3 && center <= ink_bottom + 3
                && rect.x >= row.x - 8 && rect.x < row.x + row.width as i32
        }).cloned().collect();
        if row_blocks.len() < 3 { continue; }
        row_blocks.sort_by_key(|block| block.box_rect.x);
        let plausible_gap = row_blocks.windows(2).any(|pair| {
            let gap = pair[1].box_rect.x - pair[0].box_rect.x - pair[0].box_rect.width as i32;
            (4..=22).contains(&gap)
                && pair[0].text.chars().last().is_some_and(is_cjk_char)
                && pair[1].text.chars().next().is_some_and(is_cjk_char)
        });
        if !plausible_gap { continue; }
        attempts += 1;
        // Pixel projection can include scrollbar specks and trim the top of
        // glyphs. Crop from trusted boxes with modest context instead: the
        // real terminal row recovers 口 at (8,95) 370x32, whereas the broad
        // projection crop (0,99) 388x25 repeats the omission.
        let old_left = row_blocks[0].box_rect.x;
        let old_right = row_blocks.iter().map(|block| block.box_rect.x + block.box_rect.width as i32)
            .max().unwrap_or(old_left);
        let old_top = row_blocks.iter().map(|block| block.box_rect.y).min().unwrap_or(row.y);
        let old_bottom = row_blocks.iter().map(|block| block.box_rect.y + block.box_rect.height as i32)
            .max().unwrap_or(old_top);
        let crop_x = (old_left - 10).max(0);
        let crop_y = (old_top - 7).max(0);
        let crop_right = (old_right + 24).min(width as i32);
        let crop_bottom = (old_bottom + 7).min(height as i32);
        let crop_rect = PhysicalRect { x: crop_x, y: crop_y,
            width: (crop_right - crop_x).max(1) as u32,
            height: (crop_bottom - crop_y).max(1) as u32 };
        let Some(crop) = crop_bmp(image, width, height, crop_rect) else { continue };
        let Ok(found) = crate::onnx_ocr::recognize_bmp(&crop) else { continue };
        if found.blocks.len() != 1 { continue; }
        let candidate = &found.blocks[0];
        let new_left = crop_x + candidate.box_rect.x;
        let new_right = new_left + candidate.box_rect.width as i32;
        if candidate.confidence < 0.90 || (new_left - old_left).abs() > 12
            || new_right < old_right - 6 || new_right > old_right + 40
            || candidate.box_rect.height > row.height
        { continue; }
        let Some((left_index, glyph)) = one_missing_cjk_at_fragment_gap(&row_blocks, &candidate.text)
        else { continue; };
        let left = &row_blocks[left_index];
        let next = &row_blocks[left_index + 1];
        if let Some(block) = primary.blocks.iter_mut().find(|block|
            block.box_rect == left.box_rect && block.text == left.text)
        {
            block.text.push(glyph);
            block.box_rect.width = (next.box_rect.x - block.box_rect.x).max(1) as u32;
            recovered += 1;
        }
    }
    primary
}

#[cfg(target_os = "windows")]
fn rescue_fragmented_onnx(image: &[u8], primary: OcrResult) -> OcrResult {
    let primary = rescue_dark_cjk_fragment_gaps(image, primary);
    let primary = tighten_unseen_leading_pixels(image, primary);
    let primary = rescue_overlapping_rows(image, primary);
    let primary = rescue_punctuation_tail_artifacts(image, primary);
    let primary = rescue_dark_uncovered_text_rows(image, primary);
    let primary = rescue_dark_command_tails(image, primary);
    let primary = rescue_mixed_script_urls(image, primary);
    // A small user-selected crop may contain only one toolbar label and one
    // icon, so it must not depend on the full-screen dense-toolbar heuristic.
    let primary = rescue_colored_icon_suffix(image, primary);
    let fragmented = should_review_fragmented_result(&primary);
    let suspicious_gaps = should_review_suspicious_row_gaps(&primary);
    let dense_toolbar = should_review_dense_toolbar(&primary);
    let large_fragmented_rows = should_review_large_fragmented_rows(&primary);
    let large_word_rows = should_review_large_word_rows(&primary);
    let compact_spacing = should_review_compact_ascii_spacing(&primary);
    let missing_prompt = should_review_missing_terminal_prompt(&primary);
    let impossible_suffix = primary.blocks.iter().any(|block|
        impossible_mixed_suffix_prefix(block).is_some());
    let attached_icon_tail = primary.blocks.iter().any(|block| {
        suspected_icon_tail(&block.text).is_some() && block.box_rect.height >= 24
            && block.box_rect.width >= 180 && block.confidence < 0.98
    });
    if !fragmented && !suspicious_gaps && !dense_toolbar && !large_fragmented_rows
        && !compact_spacing && !missing_prompt && !large_word_rows && !impossible_suffix
        && !attached_icon_tail
    {
        return primary;
    }
    let alternate = match execute_winrt_ocr(image) {
        Ok(result) => result,
        Err(_) if dense_toolbar => OcrResult { blocks: Vec::new() },
        Err(_) => return primary,
    };
    let primary = restore_agreed_prompt_prefix(
        restore_agreed_terminal_row_spacing(primary, &alternate), &alternate);
    let primary = if impossible_suffix {
        rescue_impossible_mixed_suffix(primary, &alternate)
    } else {
        primary
    };
    let primary = if attached_icon_tail {
        rescue_attached_icon_tails(image, &primary, &alternate).unwrap_or(primary)
    } else {
        primary
    };
    // A spacing-only review grants the second engine authority over *gaps in
    // agreeing rows*, never the entire image. WinRT reads the VITE spaces but
    // corrupts the terminal's URL, numbers and paths; generic whole-result
    // selection would turn a local improvement into a major regression.
    if (compact_spacing || missing_prompt) && !fragmented && !suspicious_gaps && !dense_toolbar
        && !large_fragmented_rows
    {
        return primary;
    }
    if suspicious_gaps && should_replace_compact_broken_lines(&primary, &alternate) {
        eprintln!("[OCR] 紧凑段落明显漏字：采用备用引擎的完整行结果");
        return alternate;
    }
    if large_fragmented_rows && !dense_toolbar {
        if let Some(fused) = rescue_large_fragmented_rows(&primary, &alternate) {
            eprintln!("[OCR] 大字标题局部碎裂：仅采用备用引擎修复对应文字行");
            return rescue_unconfirmed_short_tails(&fused, &alternate).unwrap_or(fused);
        }
    }
    if large_word_rows && !dense_toolbar {
        if let Some(fused) = rescue_large_word_rows(image, &primary, &alternate) {
            eprintln!("[OCR] 大字行按词碎裂：备用整行与原图局部复查一致，按行合并");
            return fused;
        }
    }
    if suspicious_gaps && !fragmented {
        if let Some(fused) = rescue_suspicious_rows_with_image(&primary, &alternate, Some(image)) {
            eprintln!("[OCR] ONNX 单行漏字：采用 WinRT 修复该行，保留其它原始行");
            return restore_row_spacing_from_alternate(fused, &alternate);
        }
    }
    let mut primary = primary;
    let mut toolbar_augmented = false;
    // Toolbar labels can be correct while neighbouring icons become tiny OCR
    // fragments. Never replace the entire toolbar with WinRT merely because
    // those icon boxes make the full-image fragmentation score look bad.
    if dense_toolbar {
        if let Some(recovered) = rescue_missing_toolbar_labels(&primary, &alternate) {
            eprintln!("[OCR] 密集工具栏漏字：补入备用引擎在空白位置识别的独立标签");
            primary = recovered;
            toolbar_augmented = true;
        }
        if let Some(recovered) = rescue_toolbar_gap_crops(image, &primary) {
            eprintln!("[OCR] 密集工具栏漏字：原图空白间隙二次裁剪识别补框");
            primary = recovered;
            toolbar_augmented = true;
        }
    }
    if toolbar_augmented || dense_toolbar {
        return primary;
    }
    if let Some(recovered) = rescue_unconfirmed_short_tails(&primary, &alternate) {
        primary = recovered;
    }
    if prefer_alternate_result(&primary, &alternate) {
        if fragmented {
            eprintln!("[OCR] ONNX 输出被切成过多短碎片，改用 WinRT 的完整行结果");
        } else {
            eprintln!("[OCR] ONNX 文本行存在异常间隙且 WinRT 覆盖更多文字，采用 WinRT 结果");
        }
        alternate
    } else {
        primary
    }
}

#[cfg(not(target_os = "windows"))]
fn rescue_fragmented_onnx(_image: &[u8], primary: OcrResult) -> OcrResult {
    primary
}

#[cfg(test)]
mod fragmentation_review_tests {
    #[cfg(target_os = "windows")]
    use super::{restore_agreed_terminal_row_spacing, rescue_impossible_mixed_suffix,
        impossible_mixed_suffix_prefix, suspected_icon_tail,
        restore_agreed_prompt_prefix, should_review_missing_terminal_prompt};
    use super::{
        alternate_covers_more_text, prefer_alternate_result, should_review_fragmented_result,
        should_review_suspicious_row_gaps, rescue_suspicious_rows, fill_primary_row_gaps,
        repair_dangling_closer, should_review_dense_toolbar, rescue_missing_toolbar_labels,
        toolbar_gap_rects, should_replace_compact_broken_lines,
        should_review_large_fragmented_rows, rescue_large_fragmented_rows,
        rescue_unconfirmed_short_tails,
        cjk_line_tail_extra, is_plausible_url_repair,
        restore_agreed_mixed_script_spaces,
        colored_toolbar_icon_split,
        confirmed_punctuation_tail_artifact,
        dark_uncovered_text_rows, rescue_dark_uncovered_text_rows,
        rescue_dark_command_tails, one_missing_cjk_at_fragment_gap,
        rescue_dark_cjk_fragment_gaps, rescue_fragmented_onnx,
        agreed_ascii_word_spaces,
        should_review_compact_ascii_spacing,
        BoundingBox, OcrResult, TextBlock,
    };

    fn result(texts: &[&str]) -> OcrResult {
        OcrResult {
            blocks: texts
                .iter()
                .enumerate()
                .map(|(i, text)| TextBlock {
                    text: (*text).to_string(),
                    confidence: 0.95,
                    box_rect: BoundingBox {
                        x: (i * 20) as i32,
                        y: 10,
                        width: 18,
                        height: 14,
                    },
                })
                .collect(),
        }
    }

    #[test]
    fn row_crop_may_supply_only_one_missing_chinese_glyph_at_a_real_gap() {
        let row = vec![
            TextBlock { text: "[*]".into(), confidence: 0.97,
                box_rect: BoundingBox { x: 18, y: 102, width: 22, height: 18 } },
            TextBlock { text: "正在检测并释放".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 53, y: 102, width: 121, height: 18 } },
            TextBlock { text: "1420".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 187, y: 102, width: 35, height: 18 } },
            TextBlock { text: "端".into(), confidence: 0.97,
                box_rect: BoundingBox { x: 231, y: 102, width: 22, height: 18 } },
            TextBlock { text: "与历史进程".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 261, y: 102, width: 93, height: 18 } },
        ];
        assert_eq!(one_missing_cjk_at_fragment_gap(&row,
            "[*]正在检测并释放1420 端口与历史进程。."), Some((3, '口')));
        assert_eq!(one_missing_cjk_at_fragment_gap(&row,
            "[*]正在检测并释放1421 端口与历史进程。."), None,
            "a disagreeing digit must veto the crop even if it reads the missing glyph");
        assert_eq!(one_missing_cjk_at_fragment_gap(&row,
            "[*]正在检测并释放1420 端口与历史进程新。."), None,
            "two extra glyphs must not be silently accepted");
    }

    #[test]
    #[ignore = "needs installed v6 Tiny ONNX model; run with CATWALK_OCR_MODELS_DIR"]
    fn recovers_a_wholly_missed_dark_terminal_row_without_reading_separator_lines() {
        let png = std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/windows_terminal_dense.png")).unwrap();
        let rgba = image::load_from_memory(&png).unwrap().to_rgba8();
        let (width, height) = rgba.dimensions();
        let mut bmp = vec![0u8; 54 + (width * height * 4) as usize];
        bmp[0..2].copy_from_slice(b"BM");
        let file_len = bmp.len() as u32;
        bmp[2..6].copy_from_slice(&file_len.to_le_bytes());
        bmp[10..14].copy_from_slice(&54u32.to_le_bytes());
        bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp[18..22].copy_from_slice(&(width as i32).to_le_bytes());
        bmp[22..26].copy_from_slice(&(-(height as i32)).to_le_bytes());
        bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
        for (dst, pixel) in bmp[54..].chunks_exact_mut(4).zip(rgba.pixels()) {
            dst.copy_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
        }
        crate::onnx_ocr::switch_active_version("v6t").unwrap();
        let mut detected = crate::onnx_ocr::recognize_bmp(&bmp).unwrap();
        let cjk_repaired = rescue_dark_cjk_fragment_gaps(&bmp, detected.clone());
        assert!(cjk_repaired.blocks.iter().any(|block|
            (95..115).contains(&block.box_rect.y) && block.text.contains("端口")),
            "full-row reread should recover the missing CJK glyph");
        let whole_pipeline = rescue_fragmented_onnx(&bmp, detected.clone());
        assert!(whole_pipeline.blocks.iter().any(|block|
            (95..115).contains(&block.box_rect.y) && block.text.contains("端口")),
            "later OCR review stages must preserve the verified glyph: {:?}",
            whole_pipeline.blocks.iter().filter(|block| block.box_rect.y < 130)
                .map(|block| block.text.as_str()).collect::<Vec<_>>());
        let repaired_tails = rescue_dark_command_tails(&bmp, detected.clone());
        assert!(repaired_tails.blocks.iter().any(|block| {
            block.text.contains("Running DevCommand")
                && block.text.contains("--no-default-features --color always --")
        }), "a tight physical row crop should recover the omitted command tail");
        detected.blocks.retain(|block| {
            let center = block.box_rect.y + block.box_rect.height as i32 / 2;
            !(120..142).contains(&center)
        });
        let gaps = dark_uncovered_text_rows(&bmp, &detected);
        assert!(gaps.iter().any(|row| row.y <= 123 && row.y + row.height as i32 >= 137),
            "green status row should be an uncovered pixel row: {gaps:?}");
        assert!(!gaps.iter().any(|row| row.y <= 72 && row.y + row.height as i32 >= 75),
            "two-pixel rule characters are not a text row: {gaps:?}");
        let restored = rescue_dark_uncovered_text_rows(&bmp, detected);
        assert!(restored.blocks.iter().any(|block| block.text.contains("端口1420/1421")),
            "a cropped, high-confidence OCR result should restore the status row");
    }

    #[test]
    fn punctuation_tail_requires_full_row_agreement_before_deletion() {
        let row = vec![
            TextBlock { text: "*后端热重载".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 30, y: 45, width: 113, height: 19 } },
            TextBlock { text: "[Cargo Watch]:鑫".into(), confidence: 0.88,
                box_rect: BoundingBox { x: 146, y: 45, width: 133, height: 19 } },
            TextBlock { text: "修改 Rust 代码自动重新编译并重载".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 280, y: 45, width: 294, height: 19 } },
        ];
        let references: Vec<_> = row.iter().collect();
        let candidate = TextBlock { text: "*后端热重载[CargoWatch]：修改Rust代码自动重新编译并重载".into(),
            confidence: 0.99,
            box_rect: BoundingBox { x: 30, y: 45, width: 544, height: 19 } };
        assert!(confirmed_punctuation_tail_artifact(&references, 1, &candidate));
        let incomplete = TextBlock { text: "*后端热重载[CargoWatch]：修改Rust代码自动重新编译".into(),
            ..candidate.clone() };
        assert!(!confirmed_punctuation_tail_artifact(&references, 1, &incomplete));
        let mut real_character = row.clone();
        real_character[1].confidence = 0.98;
        let real_refs: Vec<_> = real_character.iter().collect();
        assert!(!confirmed_punctuation_tail_artifact(&real_refs, 1, &candidate));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn short_icon_tail_review_does_not_flag_common_english_endings() {
        assert_eq!(suspected_icon_tail("devices in your settings ca"),
            Some("devices in your settings"));
        assert_eq!(suspected_icon_tail("you can sign in"), None);
        assert_eq!(suspected_icon_tail("you can sign up"), None);
        assert_eq!(suspected_icon_tail("three words are fine"), None);
        assert_eq!(suspected_icon_tail("settings ca"), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn trims_only_geometrically_impossible_mixed_script_heading_tail() {
        let primary = OcrResult { blocks: vec![TextBlock {
            text: "changing your password美藝5堂".into(), confidence: 0.82,
            box_rect: BoundingBox { x: 33, y: 130, width: 576, height: 51 },
        }] };
        let alternate = OcrResult { blocks: vec![TextBlock {
            text: "changing your password:".into(), confidence: 0.99,
            box_rect: BoundingBox { x: 41, y: 133, width: 558, height: 50 },
        }] };
        assert!(impossible_mixed_suffix_prefix(&primary.blocks[0]).is_some());
        let fixed = rescue_impossible_mixed_suffix(primary.clone(), &alternate);
        assert_eq!(fixed.blocks[0].text, "changing your password:");
        assert_eq!(fixed.blocks[0].box_rect.width, 558);

        let mut legitimate = primary;
        legitimate.blocks[0].text = "changing your password欢迎".into();
        legitimate.blocks[0].box_rect.width = 680;
        assert_eq!(rescue_impossible_mixed_suffix(legitimate.clone(), &alternate)
            .blocks[0].text, legitimate.blocks[0].text,
            "a suffix occupying real glyph width must not be deleted");
    }

    #[test]
    fn second_engine_can_remove_short_icon_tail_without_rewriting_other_rows() {
        let primary = OcrResult { blocks: vec![
            TextBlock { text: "devices in you".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 36, y: 391, width: 189, height: 34 } },
            TextBlock { text: "settings ca".into(), confidence: 0.92,
                box_rect: BoundingBox { x: 238, y: 391, width: 133, height: 34 } },
            TextBlock { text: "Change password".into(), confidence: 0.98,
                box_rect: BoundingBox { x: 825, y: 503, width: 254, height: 31 } },
        ] };
        let alternate = OcrResult { blocks: vec![TextBlock {
            text: "devices in your settings".into(), confidence: 0.99,
            box_rect: BoundingBox { x: 36, y: 395, width: 305, height: 28 },
        }] };
        let recovered = rescue_unconfirmed_short_tails(&primary, &alternate).unwrap();
        assert_eq!(recovered.blocks.len(), 2);
        assert_eq!(recovered.blocks[0].text, "devices in your settings");
        assert_eq!(recovered.blocks[0].box_rect,
            BoundingBox { x: 36, y: 391, width: 305, height: 34 });
        assert_eq!(recovered.blocks[1].text, "Change password");
    }

    #[test]
    fn short_tail_review_never_drops_unmatched_commands_or_distant_candidates() {
        let primary = OcrResult { blocks: vec![
            TextBlock { text: "VITE v7.3.6".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 25, y: 382, width: 150, height: 30 } },
            TextBlock { text: "ready in 239 ms".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 180, y: 382, width: 120, height: 30 } },
        ] };
        let alternate = OcrResult { blocks: vec![TextBlock {
            text: "VITE v7.3.6 ready in 239".into(), confidence: 0.99,
            box_rect: BoundingBox { x: 25, y: 384, width: 250, height: 27 },
        }] };
        assert!(rescue_unconfirmed_short_tails(&primary, &alternate).is_none());
        let far = OcrResult { blocks: vec![TextBlock {
            box_rect: BoundingBox { x: 25, y: 500, width: 250, height: 27 },
            ..alternate.blocks[0].clone()
        }] };
        assert!(rescue_unconfirmed_short_tails(&primary, &far).is_none());
    }

    #[test]
    fn colored_toolbar_icon_split_requires_a_distinct_icon_chip() {
        let (width, height) = (120u32, 50u32);
        let mut bmp = vec![0u8; 54 + (width * height * 4) as usize];
        bmp[0..2].copy_from_slice(b"BM");
        bmp[18..22].copy_from_slice(&(width as i32).to_le_bytes());
        bmp[22..26].copy_from_slice(&(-(height as i32)).to_le_bytes());
        bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
        let paint = |bmp: &mut [u8], x: u32, y: u32, color: [u8; 3]| {
            let offset = 54 + ((y * width + x) * 4) as usize;
            bmp[offset..offset + 3].copy_from_slice(&[color[2], color[1], color[0]]);
        };
        for y in 8..25 {
            for x in 15..74 { paint(&mut bmp, x, y, [58, 58, 58]); }
            paint(&mut bmp, 74, y, [43, 43, 43]);
            for x in 76..98 { paint(&mut bmp, x, y, [101, 14, 14]); }
        }
        let bbox = BoundingBox { x: 15, y: 8, width: 83, height: 17 };
        assert_eq!(colored_toolbar_icon_split(&bmp, bbox), Some(74));
        for y in 8..25 {
            for x in 76..98 { paint(&mut bmp, x, y, [58, 58, 58]); }
        }
        assert_eq!(colored_toolbar_icon_split(&bmp, bbox), None);
    }

    #[test]
    fn terminal_spacing_uses_agreed_characters_without_damaging_versions() {
        assert!(should_review_compact_ascii_spacing(&result(&[
            "VITEv7.3.6readyin239ms",
        ])));
        assert!(!should_review_compact_ascii_spacing(&result(&[
            "http://localhost:1420/", "CPU8.0ms",
        ])));
        assert_eq!(
            agreed_ascii_word_spaces(
                "VITEv7.3.6readyin239ms",
                "VITE v7 3 6 ready in 239 ms",
            ),
            Some("VITE v7.3.6 ready in 239 ms".into()),
        );
        assert_eq!(
            agreed_ascii_word_spaces(
                "VITEv7.3.6 ready in 239 ms",
                "VITE v7 3 6 ready in 239 ms",
            ),
            Some("VITE v7.3.6 ready in 239 ms".into()),
        );
        assert_eq!(
            agreed_ascii_word_spaces(
                "RunningBeforeDevCommand npm run dev",
                "Running BeforeDevCommand npm run dev')",
            ),
            Some("Running BeforeDevCommand npm run dev".into()),
        );
        assert_eq!(
            agreed_ascii_word_spaces(
                "MaobuTranslator v0.3.14",
                "Maobu Translator v0 3 14",
            ),
            None,
            "a model's arbitrary identifier split must not change an unrelated proper name",
        );
        assert_eq!(
            agreed_ascii_word_spaces(
                "VITEv7.3.6readyin239ms",
                "VITE v7 3 6 ready in 238 ms",
            ),
            None,
            "a differing digit must not authorize any transferred spacing",
        );
        assert_eq!(
            agreed_ascii_word_spaces(
                "CPU8.0ms",
                "CPU 8 0 ms",
            ),
            None,
            "one transferable gap is too little evidence to change a compact value",
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn terminal_spacing_aligns_two_winrt_boxes_to_one_onnx_line() {
        let primary = OcrResult { blocks: vec![TextBlock {
            text: "VITEv7.3.6readyin239ms".into(), confidence: 0.95,
            box_rect: BoundingBox { x: 28, y: 388, width: 263, height: 19 },
        }] };
        let alternate = OcrResult { blocks: vec![
            TextBlock { text: "VITE v7 3 6 ready in".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 33, y: 390, width: 188, height: 16 } },
            TextBlock { text: "239 ms".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 232, y: 391, width: 53, height: 11 } },
        ] };
        let result = restore_agreed_terminal_row_spacing(primary, &alternate);
        assert_eq!(result.blocks[0].text, "VITE v7.3.6 ready in 239 ms");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn terminal_spacing_uses_full_row_to_repair_only_a_fused_first_box() {
        let primary = OcrResult { blocks: vec![
            TextBlock { text: "VITEV7.3.6".into(), confidence: 0.93,
                box_rect: BoundingBox { x: 31, y: 389, width: 105, height: 15 } },
            TextBlock { text: "ready in 239 ms".into(), confidence: 0.97,
                box_rect: BoundingBox { x: 142, y: 388, width: 149, height: 18 } },
        ] };
        let alternate = OcrResult { blocks: vec![
            TextBlock { text: "VITE v7 3 6 ready in".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 33, y: 390, width: 188, height: 16 } },
            TextBlock { text: "239 ms".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 232, y: 391, width: 53, height: 11 } },
        ] };
        let repaired = restore_agreed_terminal_row_spacing(primary.clone(), &alternate);
        assert_eq!(repaired.blocks[0].text, "VITE V7.3.6");
        assert_eq!(repaired.blocks[0].box_rect, primary.blocks[0].box_rect);
        assert_eq!(repaired.blocks[1].text, primary.blocks[1].text);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn terminal_prompt_prefix_uses_second_engine_only_for_the_missing_symbol() {
        let primary = OcrResult { blocks: vec![TextBlock {
            text: "app_v2@0.3.14 tauri".into(), confidence: 0.99,
            box_rect: BoundingBox { x: 27, y: 217, width: 180, height: 19 },
        }] };
        let alternate = OcrResult { blocks: vec![TextBlock {
            text: "> app_v2@O.3.IU tauri".into(), confidence: 0.99,
            box_rect: BoundingBox { x: 16, y: 219, width: 188, height: 16 },
        }] };
        let recovered = restore_agreed_prompt_prefix(primary.clone(), &alternate);
        assert_eq!(recovered.blocks[0].text, "> app_v2@0.3.14 tauri");
        assert_eq!(recovered.blocks[0].box_rect.x, 16);

        let mut remote = alternate;
        remote.blocks[0].box_rect.y = 269;
        assert_eq!(restore_agreed_prompt_prefix(primary, &remote).blocks[0].text,
            "app_v2@0.3.14 tauri");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn prompt_review_requires_a_left_aligned_versioned_command_in_a_dense_scene() {
        let mut blocks = result(&["row"; 10]);
        blocks.blocks[0].text = "app_v2@0.3.14 tauri".into();
        blocks.blocks[0].box_rect.x = 27;
        assert!(should_review_missing_terminal_prompt(&blocks));
        blocks.blocks[0].box_rect.x = 100;
        assert!(!should_review_missing_terminal_prompt(&blocks));
        blocks.blocks[0].box_rect.x = 27;
        blocks.blocks[0].text = "contact@example.com".into();
        assert!(!should_review_missing_terminal_prompt(&blocks));
    }

    #[test]
    fn only_pathologically_fragmented_results_request_a_second_engine() {
        assert!(should_review_fragmented_result(&result(&[
            "You'll", "stay", "s", "i", "g", "n", "ed", "devices",
        ])));
        assert!(!should_review_fragmented_result(&result(&[
            "You'll stay signed in", "on these devices", "after changing", "your password",
            "The device you are on now", "Android", "Cancel", "Change password",
        ])));

        let mut toolbar = result(&[
            "布局", "建模", "雕刻", "UV编辑", "纹理绘制", "着色", "动画", "渲染", "合成",
            "几何节点", "脚本",
        ]);
        for (block, (x, width)) in toolbar.blocks.iter_mut().zip([
            (314, 35), (355, 38), (397, 36), (468, 55), (527, 60), (591, 37),
            (632, 38), (675, 38), (717, 38), (760, 59), (824, 60),
        ]) {
            block.box_rect = BoundingBox { x, y: 26, width, height: 19 };
        }
        assert!(!should_review_fragmented_result(&toolbar));
        assert!(!should_review_suspicious_row_gaps(&toolbar));
        // A nearby icon strip can add enough one-character boxes to make the
        // whole crop look fragmented even though the menu row is intact.
        for i in 0..6 {
            toolbar.blocks.push(TextBlock {
                text: "o".into(), confidence: 0.35,
                box_rect: BoundingBox { x: 480 + i * 18, y: 52, width: 14, height: 19 },
            });
        }
        assert!(should_review_fragmented_result(&toolbar));
        assert!(should_review_dense_toolbar(&toolbar));
    }

    #[test]
    fn password_heading_real_fragment_shape_prefers_complete_fallback_lines() {
        // Reproduced from the user's screenshot: ONNX sees 15 fragments across
        // two rows, including isolated glyphs and a large missing-text gap.
        let texts = [
            "You'll", "stay", "sigr", "ed", "0", "t", "lese", "devices", "aftel",
            "c", "a", "gi", "g", "yol", "password:",
        ];
        let boxes = [
            (45, 62, 108, 54), (168, 62, 87, 54), (272, 62, 71, 54),
            (355, 62, 63, 54), (484, 62, 36, 54), (557, 62, 20, 54),
            (589, 62, 85, 54), (690, 62, 169, 54), (874, 62, 94, 54),
            (42, 129, 33, 57), (87, 129, 42, 57), (141, 129, 57, 57),
            (210, 129, 35, 57), (263, 129, 58, 57), (373, 129, 225, 57),
        ];
        let raw = OcrResult {
            blocks: texts
                .iter()
                .zip(boxes)
                .map(|(text, (x, y, width, height))| TextBlock {
                    text: (*text).to_string(),
                    confidence: 0.9,
                    box_rect: BoundingBox { x, y, width, height },
                })
                .collect(),
        };
        assert!(should_review_fragmented_result(&raw));

        let recovered = OcrResult {
            blocks: vec![
                TextBlock {
                    text: "You ， II stay signed in on these devices after".into(),
                    confidence: 0.99,
                    box_rect: BoundingBox { x: 40, y: 67, width: 938, height: 50 },
                },
                TextBlock {
                    text: "changing your password:".into(),
                    confidence: 0.99,
                    box_rect: BoundingBox { x: 41, y: 133, width: 558, height: 50 },
                },
            ],
        };
        assert!(prefer_alternate_result(&raw, &recovered));
    }

    #[test]
    fn v6t_password_heading_prefers_complete_rows_over_partial_gap_fill() {
        let pieces = [
            ("You'l", 45, 58, 108, 54), ("stay", 168, 58, 87, 54),
            ("sigi", 272, 58, 71, 54), ("led", 355, 58, 63, 54),
            ("o", 484, 58, 36, 54), ("lese", 589, 58, 85, 54),
            ("devices", 690, 58, 169, 54), ("afte", 874, 58, 94, 54),
            ("yo", 263, 129, 58, 57), ("password:", 373, 129, 225, 57),
        ];
        let primary = OcrResult { blocks: pieces.into_iter().map(|(text, x, y, width, height)| {
            TextBlock { text: text.into(), confidence: 0.9,
                box_rect: BoundingBox { x, y, width, height } }
        }).collect() };
        let alternate = OcrResult { blocks: vec![
            TextBlock { text: "You'll stay signed in on these devices after".into(),
                confidence: 0.99, box_rect: BoundingBox { x: 40, y: 67, width: 938, height: 50 } },
            TextBlock { text: "changing your password:".into(),
                confidence: 0.99, box_rect: BoundingBox { x: 41, y: 133, width: 558, height: 50 } },
        ] };
        assert!(should_replace_compact_broken_lines(&primary, &alternate));
        assert!(!should_replace_compact_broken_lines(&result(&[
            "我们将", "Gemini Omni", "Flash 和", "套全新的创意控制", "具集成到 vids.new中",
        ]), &alternate));
    }

    #[test]
    fn large_dialog_repairs_only_broken_heading_rows() {
        let pieces = [
            ("Yoi", 41, 52, 57, 51), ("stay", 164, 52, 87, 51),
            ("sig", 268, 52, 71, 51), ("led", 351, 52, 63, 51),
            ("ol", 480, 52, 36, 51), ("t", 552, 52, 21, 51),
            ("lese", 585, 52, 85, 51), ("devices", 686, 52, 169, 51),
            ("aftel", 870, 52, 94, 51), ("cl", 37, 122, 34, 51),
            ("ai", 83, 122, 42, 51), ("ngi", 137, 120, 57, 57),
            ("19", 206, 122, 35, 51), ("yo", 259, 120, 58, 57),
            ("password:", 369, 120, 225, 57),
            ("Android", 43, 279, 129, 21),
        ];
        let primary = OcrResult { blocks: pieces.into_iter().map(|(text, x, y, width, height)| {
            TextBlock { text: text.into(), confidence: 0.9,
                box_rect: BoundingBox { x, y, width, height } }
        }).collect() };
        let alternate = OcrResult { blocks: vec![
            TextBlock { text: "You'll stay signed in on these devices after".into(),
                confidence: 0.99, box_rect: BoundingBox { x: 36, y: 58, width: 938, height: 49 } },
            TextBlock { text: "changing your password:".into(),
                confidence: 0.99, box_rect: BoundingBox { x: 37, y: 124, width: 557, height: 50 } },
            TextBlock { text: "· Android".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 43, y: 279, width: 129, height: 21 } },
        ] };
        assert!(should_review_large_fragmented_rows(&primary));
        let fused = rescue_large_fragmented_rows(&primary, &alternate).unwrap();
        assert_eq!(fused.blocks.len(), 3);
        assert!(fused.blocks.iter().any(|block| block.text == "Android"));
        assert!(fused.blocks.iter().any(|block| block.text == "changing your password:"));
        assert!(fused.blocks.iter().any(|block| block.text == "You'll stay signed in on these devices after"));
    }

    #[test]
    fn alternate_is_used_only_when_it_reduces_fragments_without_losing_much_text() {
        let fragmented = result(&["Y", "o", "u", "'ll", "s", "t", "a", "y"]);
        let coherent = result(&["You'll stay", "signed in on this device"]);
        assert!(prefer_alternate_result(&fragmented, &coherent));

        let incomplete = result(&["You'll"]);
        assert!(!prefer_alternate_result(&fragmented, &incomplete));
    }

    #[test]
    fn suspicious_row_gap_triggers_review_and_aligned_longer_result_can_win() {
        let mut sparse = result(&[
            "我们将",
            "Gemini Omni",
            "Flash和",
            "套全新的创意控制",
            "具集成到 vids.new 中",
        ]);
        for (block, (x, width)) in sparse
            .blocks
            .iter_mut()
            .zip([(41, 41), (88, 87), (205, 51), (270, 111), (35, 148)])
        {
            block.box_rect.x = x;
            block.box_rect.width = width;
            if block.box_rect.x == 35 {
                block.box_rect.y = 42;
                block.box_rect.height = 18;
            } else {
                block.box_rect.y = 24;
                block.box_rect.height = 16;
            }
        }
        assert!(should_review_suspicious_row_gaps(&sparse));

        let mut fuller = result(&["我们将 Gemini Omni 1.1 Flash 和一套全新的创意控制工具", "集成到 vids.new 中"]);
        fuller.blocks[0].box_rect = BoundingBox { x: 41, y: 25, width: 355, height: 12 };
        fuller.blocks[1].box_rect = BoundingBox { x: 55, y: 44, width: 121, height: 12 };
        assert!(alternate_covers_more_text(&sparse, &fuller));

        let unrelated = result(&["An unrelated notification with much more text"]);
        assert!(!alternate_covers_more_text(&sparse, &unrelated));
    }

    #[test]
    fn sparse_chat_row_is_recovered_without_replacing_the_correct_second_row() {
        let primary = OcrResult { blocks: vec![
            TextBlock { text: "我们将 Gemini Omni".into(), confidence: 0.97,
                box_rect: BoundingBox { x: 41, y: 21, width: 134, height: 22 } },
            TextBlock { text: "Flash 和".into(), confidence: 0.98,
                box_rect: BoundingBox { x: 205, y: 21, width: 51, height: 22 } },
            TextBlock { text: "套全新的创意控制』".into(), confidence: 0.95,
                box_rect: BoundingBox { x: 272, y: 21, width: 118, height: 22 } },
            TextBlock { text: "具集成到 vids.new 中".into(), confidence: 0.96,
                box_rect: BoundingBox { x: 34, y: 42, width: 149, height: 18 } },
        ] };
        let alternate = OcrResult { blocks: vec![
            TextBlock { text: "我们将 Gemini Omni 1 · 1 Flash 和一套金新的创葸控制工".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 41, y: 25, width: 355, height: 12 } },
            TextBlock { text: "里成 vids.new 中".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 55, y: 44, width: 121, height: 12 } },
        ] };
        assert!(should_review_suspicious_row_gaps(&primary));
        let fused = rescue_suspicious_rows(&primary, &alternate).expect("first row should recover");
        assert_eq!(fused.blocks.len(), 2);
        assert_eq!(fused.blocks[0].text, "我们将 Gemini Omni 1 · 1 Flash 和一套全新的创意控制工");
        assert_eq!(fused.blocks[0].box_rect, BoundingBox { x: 41, y: 21, width: 355, height: 22 });
        assert_eq!(fused.blocks[1].text, "具集成到 vids.new 中");
    }

    #[test]
    fn line_tail_candidate_needs_exact_cjk_anchor_and_short_suffix() {
        assert_eq!(cjk_line_tail_extra("一套全新的创意控制", "我们将 Gemini Omni 1 · 1 Flash 和一套金新的创葸控制工"), Some("工".into()));
        assert_eq!(cjk_line_tail_extra("一套全新的创意控制", "一套全新的创意控制"), None);
        assert_eq!(cjk_line_tail_extra("password", "password reset"), None);
        assert_eq!(cjk_line_tail_extra("创意控制", "控制这不是一个短尾字"), None);
    }

    #[test]
    fn url_local_review_requires_a_small_mixed_script_host_correction() {
        assert!(is_plausible_url_repair(
            "http://儿ocalhost:1420/", "http://localhost:1420/",
        ));
        assert!(!is_plausible_url_repair(
            "http://example.com/path", "http://example.com/patk",
        ));
        assert!(!is_plausible_url_repair(
            "http://儿ocalhost:1420/", "http://different:1420/",
        ));
        assert!(!is_plausible_url_repair(
            "http://儿ocalhost:1420/", "https://localhost:1420/",
        ));
    }

    #[test]
    fn alternate_can_restore_only_agreed_cjk_latin_spaces() {
        assert_eq!(restore_agreed_mixed_script_spaces(
            "我们将Gemini Omni 1.1 Flash 和一套全新的创意控制工",
            "我们将 Gemini Omni 1 · 1 Flash 和一套金新的创葸控制工",
        ), "我们将 Gemini Omni 1.1 Flash 和一套全新的创意控制工");
        assert_eq!(restore_agreed_mixed_script_spaces(
            "具集成到 vids.new中", "里成 vids.new 中",
        ), "具集成到 vids.new 中");
        assert_eq!(restore_agreed_mixed_script_spaces(
            "F5切英文", "F5 切英文",
        ), "F5切英文");
    }

    #[test]
    fn gap_fusion_requires_text_anchors_on_both_sides() {
        let row = OcrResult { blocks: vec![
            TextBlock { text: "Hello".into(), confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 20, width: 45, height: 20 } },
            TextBlock { text: "world".into(), confidence: 0.95,
                box_rect: BoundingBox { x: 75, y: 20, width: 50, height: 20 } },
        ] };
        assert_eq!(fill_primary_row_gaps(&row, "Hello big world"), Some("Hello big world".into()));
        assert_eq!(fill_primary_row_gaps(&row, "Hello unrelated text"), None);
        assert_eq!(fill_primary_row_gaps(&row, "different big world"), None);
    }

    #[test]
    fn dangling_closer_needs_matching_context_and_never_changes_balanced_quotes() {
        assert_eq!(repair_dangling_closer("创意控制』", "创葸控制工"), Some("创意控制工".into()));
        assert_eq!(repair_dangling_closer("『控制』", "创意控制工"), None);
        assert_eq!(repair_dangling_closer("创意控制』", "任意标签工"), None);
    }

    #[test]
    fn toolbar_island_adds_only_missing_label_without_joining_neighbours() {
        let mut primary = result(&[
            "文件", "编辑", "窗口", "帮助", "视图", "选择", "布局", "建模",
            "纹理绘制", "着色", "动画", "渲染",
        ]);
        for (block, x) in primary.blocks.iter_mut().zip([30, 70, 110, 150, 200, 250, 310, 360, 500, 560, 610, 660]) {
            block.box_rect = BoundingBox { x, y: 28, width: 30, height: 17 };
        }
        assert!(should_review_dense_toolbar(&primary));
        let alternate = OcrResult { blocks: vec![
            TextBlock { text: "雕刻".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 405, y: 30, width: 22, height: 11 } },
            TextBlock { text: "建模纹理".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 365, y: 30, width: 160, height: 11 } },
        ] };
        let recovered = rescue_missing_toolbar_labels(&primary, &alternate).expect("missing label");
        assert_eq!(recovered.blocks.len(), primary.blocks.len() + 1);
        assert!(recovered.blocks.iter().any(|block| block.text == "雕刻" && block.box_rect.height == 17));
        assert!(!recovered.blocks.iter().any(|block| block.text == "建模纹理"));
        let gaps = toolbar_gap_rects(&recovered, 900, 90);
        assert!(gaps.iter().any(|gap| gap.x == 427 && gap.width == 73));
    }

    #[test]
    fn a_column_gutter_is_not_mistaken_for_missing_word() {
        let mut columns = result(&["left label", "middle text", "right label"]);
        columns.blocks[0].box_rect = BoundingBox { x: 10, y: 20, width: 60, height: 20 };
        columns.blocks[1].box_rect = BoundingBox { x: 85, y: 20, width: 70, height: 20 };
        columns.blocks[2].box_rect = BoundingBox { x: 400, y: 20, width: 70, height: 20 };
        assert!(!should_review_suspicious_row_gaps(&columns));
    }
}

fn parse_daemon_response(line: &str) -> Result<OcrResult, String> {
    let val: serde_json::Value =
        serde_json::from_str(line.trim()).map_err(|e| format!("JSON parse error: {}", e))?;

    let blocks_arr = val
        .get("blocks")
        .and_then(|b| b.as_array())
        .ok_or("Missing 'blocks' in response")?;

    let mut blocks = Vec::new();
    for b in blocks_arr {
        let text = b
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        if text.is_empty() {
            continue;
        }
        let confidence = b.get("confidence").and_then(|c| c.as_f64()).unwrap_or(0.9) as f32;
        let br = b.get("boxRect").cloned().unwrap_or(serde_json::Value::Null);
        let bx = br.get("x").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let by = br.get("y").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        let bw = br.get("width").and_then(|v| v.as_i64()).unwrap_or(0) as u32;
        let bh = br.get("height").and_then(|v| v.as_i64()).unwrap_or(0) as u32;

        blocks.push(TextBlock {
            text,
            confidence,
            box_rect: BoundingBox {
                x: bx,
                y: by,
                width: bw,
                height: bh,
            },
        });
    }

    Ok(OcrResult { blocks })
}

/// Fallback: run python as one-shot process (slow, only used when daemon fails to start).
/// Writes bytes to a unique temp file (no shared-name races) and removes it afterwards.
#[allow(dead_code)]
fn execute_native_ocr_oneshot_bytes(image_bytes: &[u8]) -> Result<OcrResult, String> {
    let unique_name = format!(
        "catwalk_crop_{}_{}.bmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let temp_path = std::env::temp_dir().join(unique_name);

    let result = (|| -> Result<OcrResult, String> {
        std::fs::write(&temp_path, image_bytes)
            .map_err(|e| format!("Failed to write OCR temp file: {}", e))?;
        execute_native_ocr_oneshot(temp_path.to_str().unwrap_or(""))
    })();

    let _ = std::fs::remove_file(&temp_path);
    result
}

/// Fallback: run python as one-shot process (slow, only used when daemon fails to start).
#[allow(dead_code)]
fn execute_native_ocr_oneshot(path: &str) -> Result<OcrResult, String> {
    let root = resolve_project_root();
    let mut cmd = Command::new("python");
    cmd.args(["-m", "core.ocr_cli", path]).current_dir(&root);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output();

    if let Ok(out) = output {
        if out.status.success() {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(res) = serde_json::from_str::<OcrResult>(&json_str) {
                return Ok(res);
            }
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        eprintln!("[OCR oneshot] stderr: {}", stderr);
    }

    Ok(OcrResult { blocks: vec![] })
}

/// 按用户设置路由到指定 OCR 引擎。
/// engine: "auto" | "onnx" | "winrt"，None 等同 "auto"
pub fn execute_native_ocr_with_engine(
    crop_bmp_bytes: &[u8],
    engine: Option<&str>,
) -> Result<OcrResult, String> {
    match engine.unwrap_or("auto") {
        "winrt" => {
            #[cfg(target_os = "windows")]
            {
                match execute_winrt_ocr(crop_bmp_bytes) {
                    Ok(res) if !res.blocks.is_empty() => return Ok(res),
                    Ok(_) => eprintln!("[OCR] WinRT 返回空结果，降级到 auto"),
                    Err(e) => eprintln!("[OCR] WinRT 错误: {}，降级到 auto", e),
                }
            }
            execute_native_ocr(crop_bmp_bytes)
        }
        "onnx" => {
            if onnx_available() {
                let eng = crate::onnx_ocr::get_engine();
                let onnx_result = eng.recognize_bmp(crop_bmp_bytes);
                drop(eng);
                match onnx_result {
                    Ok(res) if !res.blocks.is_empty() => {
                        return Ok(rescue_fragmented_onnx(crop_bmp_bytes, res));
                    }
                    Ok(_) => eprintln!("[OCR] ONNX 返回空结果，降级"),
                    Err(e) => eprintln!("[OCR] ONNX 错误: {}，降级", e),
                }
            }
            execute_native_ocr(crop_bmp_bytes)
        }
        // "auto" 及其他未知值 → 现有多层降级链
        _ => execute_native_ocr(crop_bmp_bytes),
    }
}

// ─── Test stubs ─────────────────────────────────────────────────────────────────

pub trait OcrEngine {
    fn recognize(&self, image_bytes: &[u8]) -> Result<OcrResult, String>;
}

pub fn prepare_tensor(image_bytes: &[u8], width: u32, height: u32) -> (usize, Vec<usize>) {
    let byte_count = image_bytes.len().min((width * height * 4) as usize);
    let shape = vec![1, 3, height as usize, width as usize];
    (byte_count, shape)
}

pub struct MockOcrEngine {
    pub initialized: bool,
}

impl Default for MockOcrEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl MockOcrEngine {
    pub fn new() -> Self {
        Self { initialized: true }
    }

    pub fn init() -> Self {
        Self::new()
    }
}

impl OcrEngine for MockOcrEngine {
    fn recognize(&self, _image_bytes: &[u8]) -> Result<OcrResult, String> {
        Ok(OcrResult {
            blocks: vec![crate::models::TextBlock {
                text: "Principled BSDF".to_string(),
                confidence: 0.98,
                box_rect: crate::models::BoundingBox {
                    x: 0,
                    y: 0,
                    width: 120,
                    height: 24,
                },
            }],
        })
    }
}
