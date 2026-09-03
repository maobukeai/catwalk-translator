//! Clipboard passive watch: a background thread polls the Windows clipboard
//! sequence number (cheap — no clipboard open needed) and, when new TEXT lands,
//! translates it through the standard multi-tier pipeline and emits
//! `clipboard-watched` to the frontend. Copy foreign text anywhere → a toast
//! with the translation appears, without pressing anything.
//!
//! Deliberately simple & conservative:
//!  - 400ms polling of GetClipboardSequenceNumber (zero-cost when unchanged)
//!  - filters: trimmed length 2–500 chars, deduped against the last accepted
//!    text, 1.5s cooldown so multi-step copy flows don't spam
//!  - enabled/disabled purely by settings (default OFF); the thread exits on
//!    stop and is restarted on the next enable.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardWatchPayload {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
}

static WATCH_RUNNING: AtomicBool = AtomicBool::new(false);
/// Generation counter: fixes the stop→start race where the OLD thread's exit
/// path would clear the running flag and silently kill a NEWLY started thread.
static WATCH_GENERATION: AtomicU64 = AtomicU64::new(0);

/// 无感查词模块模拟复制/恢复剪贴板造成的序号上限:这些「自发变更」不是
/// 用户复制,监听跳过(取词结果由 lookup_monitor 自己的浮窗展示)。
pub static SELF_CAUSED_SEQ: AtomicU32 = AtomicU32::new(0);

/// Pure filter (unit-tested): is this clipboard text worth translating?
pub fn clipboard_text_worth_translating(text: &str, last_accepted: &str) -> bool {
    let trimmed = text.trim();
    let char_count = trimmed.chars().count();
    if !(2..=500).contains(&char_count) {
        return false;
    }
    // Skip pure numbers / single symbols the OCR-style flows love to copy
    if trimmed.chars().all(|c| c.is_ascii_digit() || "+-*/.,:%$€£¥ ()".contains(c)) {
        return false;
    }
    if trimmed == last_accepted {
        return false;
    }
    true
}

/// Start the watcher thread (no-op when already running).
pub fn start_clipboard_watch(app_handle: tauri::AppHandle) {
    if WATCH_RUNNING.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    let generation = WATCH_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let mut last_seq = clipboard_sequence_number();
        let mut last_accepted = String::new();
        // allow the first event immediately
        let mut last_fire = Instant::now()
            .checked_sub(Duration::from_secs(10))
            .unwrap_or_else(Instant::now);

        loop {
            if !WATCH_RUNNING.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(400));

            let seq = clipboard_sequence_number();
            if seq == 0 || seq == last_seq {
                continue;
            }
            last_seq = seq;
            // 无感查词的自发复制/恢复不当作用户复制
            if seq <= SELF_CAUSED_SEQ.load(Ordering::SeqCst) {
                continue;
            }

            let text = match read_clipboard_text() {
                Some(t) => t,
                None => continue,
            };
            if !clipboard_text_worth_translating(&text, &last_accepted) {
                continue;
            }
            if last_fire.elapsed() < Duration::from_millis(1500) {
                continue;
            }
            last_accepted = text.trim().to_string();
            last_fire = Instant::now();

            // Translate through the shared pipeline with the user's preset/LLM
            let (preset, llm, glossary) = {
                use tauri::Manager;
                let state = app_handle.try_state::<crate::commands::AppState>();
                match state {
                    Some(s) => {
                        let lock = s.settings.lock();
                        match lock {
                            Ok(cfg) => (
                                cfg.default_preset.clone(),
                                cfg.llm_config.clone(),
                                crate::translator::glossary_from_settings(&cfg.custom_dict_items),
                            ),
                            Err(_) => ("blender".to_string(), None, Vec::new()),
                        }
                    }
                    None => ("blender".to_string(), None, Vec::new()),
                }
            };

            let phrase = last_accepted.clone();
            let result = tauri::async_runtime::block_on(async {
                let pipeline = crate::translator::shared_pipeline();
                let phrases = vec![phrase];
                pipeline.translate_phrases(&phrases, &preset, llm.as_ref(), &glossary).await
            });

            if let Some(tr) = result.first() {
                if !tr.translated.trim().is_empty() {
                    use tauri::Emitter;
                    let payload = ClipboardWatchPayload {
                        original: last_accepted.clone(),
                        translated: tr.translated.clone(),
                        source_tier: tr.source_tier.clone(),
                    };
                    let _ = app_handle.emit("clipboard-watched", payload.clone());
                    // 持久化到剪贴板翻译历史（生词本页可回看，上限 200 条）
                    crate::clipboard_history::push(
                        &app_handle,
                        &payload.original,
                        &payload.translated,
                        &payload.source_tier,
                    );
                }
            }
        }
        // Only clear the running flag when no newer start superseded this
        // thread (stop→start within one poll interval).
        if WATCH_GENERATION.load(Ordering::SeqCst) == generation {
            WATCH_RUNNING.store(false, Ordering::SeqCst);
        }
    });
}

/// Stop the watcher; the thread exits within one poll interval.
pub fn stop_clipboard_watch() {
    WATCH_RUNNING.store(false, Ordering::SeqCst);
}

pub fn clipboard_watch_running() -> bool {
    WATCH_RUNNING.load(Ordering::SeqCst)
}

// ── Windows plumbing ──────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn clipboard_sequence_number() -> u32 {
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
    unsafe { GetClipboardSequenceNumber() }
}

/// 供 lookup_monitor 读取剪贴板序号(模拟复制后等待变化)。
pub fn clipboard_sequence_number_pub() -> u32 {
    clipboard_sequence_number()
}

#[cfg(not(target_os = "windows"))]
fn clipboard_sequence_number() -> u32 {
    0
}

#[cfg(target_os = "windows")]
pub fn read_clipboard_text() -> Option<String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::Foundation::HGLOBAL;

    // Standard clipboard format constant (avoid feature-gated imports)
    const CF_UNICODETEXT: u32 = 13;

    unsafe {
        if OpenClipboard(HWND(std::ptr::null_mut())).is_err() {
            return None;
        }
        let handle = match GetClipboardData(CF_UNICODETEXT) {
            Ok(h) => h,
            Err(_) => {
                let _ = CloseClipboard();
                return None;
            }
        };
        if handle.0.is_null() {
            let _ = CloseClipboard();
            return None;
        }
        let h = HGLOBAL(handle.0);
        let ptr = GlobalLock(h) as *const u16;
        if ptr.is_null() {
            let _ = CloseClipboard();
            return None;
        }
        // Walk to the NUL terminator (clipboard text is guaranteed NUL-terminated)
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
            if len > 100_000 {
                break;
            }
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        let text = String::from_utf16_lossy(slice);
        let _ = GlobalUnlock(h);
        let _ = CloseClipboard();
        Some(text)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn read_clipboard_text() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::clipboard_text_worth_translating as worth;

    #[test]
    fn filters_by_length_and_whitespace() {
        assert!(!worth("", "x"));
        assert!(!worth("  a  ", "")); // 1 char after trim
        assert!(worth("hello world", ""));
        let long = "x".repeat(501);
        assert!(!worth(&long, ""));
    }

    #[test]
    fn filters_pure_numbers_and_symbols() {
        assert!(!worth("12345", ""));
        assert!(!worth("3.14159", ""));
        assert!(!worth("+86 138 0000 0000", ""));
        assert!(worth("Principled BSDF", ""));
    }

    #[test]
    fn dedupes_against_last_accepted() {
        assert!(worth("Principled BSDF", "Roughness"));
        assert!(!worth("Principled BSDF", "Principled BSDF"));
    }
}
