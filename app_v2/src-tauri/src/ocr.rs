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
    for i in 0..chars.len() {
        if chars[i] == ' '
            && i > 0 && i + 1 < chars.len() {
                let prev_cjk = ('\u{4E00}'..='\u{9FFF}').contains(&chars[i - 1]);
                let next_cjk = ('\u{4E00}'..='\u{9FFF}').contains(&chars[i + 1]);
                if prev_cjk && next_cjk {
                    continue;
                }
            }
        cleaned.push(chars[i]);
    }
    cleaned
}

/// Run OCR on a cropped BMP byte slice.
/// Engine priority: Rust-native ONNX (PP-OCRv3, offline) → WinRT → RapidOCR daemon.
pub fn execute_native_ocr(crop_bmp_bytes: &[u8]) -> Result<OcrResult, String> {
    execute_native_ocr_with_retry(crop_bmp_bytes, 0)
}

/// daemon 死亡后的重启重试有硬上限（1 次）。无上限的"重启即递归"会在
/// daemon 持续秒退的环境（无 python / 脚本缺失）里无限递归直到栈溢出。
fn execute_native_ocr_with_retry(crop_bmp_bytes: &[u8], restart_depth: u32) -> Result<OcrResult, String> {
    // 0: Windows 平台首选 WinRT 原生超高速硬件引擎 (<20ms 毫秒级秒出)
    #[cfg(target_os = "windows")]
    {
        match execute_winrt_ocr(crop_bmp_bytes) {
            Ok(res) if !res.blocks.is_empty() => {
                return Ok(res);
            }
            Ok(_) => {
                eprintln!("[OCR] WinRT OCR 返回空结果，尝试 ONNX PP-OCR...");
            }
            Err(e) => {
                eprintln!("[OCR] WinRT OCR 失败: {}，尝试 ONNX PP-OCR...", e);
            }
        }
    }

    // 1: Rust 原生 ONNX 引擎 (PP-OCR, 支持 DirectML GPU 显卡加速)
    if onnx_available() {
        let engine = crate::onnx_ocr::get_engine();
        match engine.recognize_bmp(crop_bmp_bytes) {
            Ok(res) if !res.blocks.is_empty() => {
                let ver = crate::onnx_ocr::get_active_version().to_uppercase();
                eprintln!("[OCR] Rust 原生 ONNX OCR (PP-OCR{}) 完成 — 纯离线推理", ver);
                return Ok(res);
            }
            Ok(_) => {
                eprintln!("[OCR] ONNX OCR 返回空结果，尝试 RapidOCR daemon...");
            }
            Err(e) => {
                eprintln!("[OCR] ONNX OCR 错误 ({})，降级 RapidOCR daemon...", e);
            }
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
                match eng.recognize_bmp(crop_bmp_bytes) {
                    Ok(res) if !res.blocks.is_empty() => return Ok(res),
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
