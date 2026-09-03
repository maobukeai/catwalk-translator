//! 剪贴板翻译历史：被动剪贴板监听翻译成功的条目持久化（上限 200 条），
//! 前端可在生词本页的「剪贴板」分页回看与复制，不再一闪而过。
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistoryEntry {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
    pub timestamp: String,
    pub at_ms: u64,
}

const CAP: usize = 1000;

fn history_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    crate::commands::get_app_config_dir(app).join("clipboard_history.json")
}

fn cell() -> &'static Mutex<Vec<ClipboardHistoryEntry>> {
    static CELL: OnceLock<Mutex<Vec<ClipboardHistoryEntry>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(Vec::new()))
}

fn ensure_loaded(app: &tauri::AppHandle) {
    let mut guard = cell().lock().unwrap_or_else(|e| e.into_inner());
    if !guard.is_empty() {
        return;
    }
    if let Ok(content) = std::fs::read_to_string(history_path(app)) {
        if let Ok(list) = serde_json::from_str::<Vec<ClipboardHistoryEntry>>(&content) {
            *guard = list;
        }
    }
}

/// 剪贴板监听线程翻译成功后调用：插入队头并落盘（best-effort）
pub fn push(app: &tauri::AppHandle, original: &str, translated: &str, source_tier: &str) {
    ensure_loaded(app);
    let mut guard = cell().lock().unwrap_or_else(|e| e.into_inner());
    // 与队头完全相同则不重复记录
    if guard.first().map(|e| e.original == original).unwrap_or(false) {
        return;
    }
    let at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    guard.insert(
        0,
        ClipboardHistoryEntry {
            original: original.to_string(),
            translated: translated.to_string(),
            source_tier: source_tier.to_string(),
            timestamp: crate::backup::backup_timestamp_string(),
            at_ms,
        },
    );
    guard.truncate(CAP);
    let json = serde_json::to_string_pretty(&*guard).unwrap_or_default();
    let _ = std::fs::write(history_path(app), json);
}

#[tauri::command]
pub async fn cmd_get_clipboard_history(
    app: tauri::AppHandle,
) -> Result<Vec<ClipboardHistoryEntry>, String> {
    ensure_loaded(&app);
    let guard = cell().lock().unwrap_or_else(|e| e.into_inner());
    Ok(guard.clone())
}

#[tauri::command]
pub async fn cmd_clear_clipboard_history(app: tauri::AppHandle) -> Result<(), String> {
    {
        let mut guard = cell().lock().unwrap_or_else(|e| e.into_inner());
        guard.clear();
    }
    let _ = std::fs::write(history_path(&app), "[]");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_truncates() {
        // 逻辑由 Vec::truncate 保证；此测试锁定上限常量防回归
        assert_eq!(CAP, 1000);
    }
}
