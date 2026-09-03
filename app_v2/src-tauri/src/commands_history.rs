//! 生词本历史与截图翻译会话命令(含 Anki 导出)。
use crate::commands::{save_capture_sessions_file, save_history_file, AppState};
use crate::models::{CaptureSession, HistoryItem};
use tauri::State;

/// 划词回放会话最大上限（从 50 场扩容至 200 场）
pub const MAX_CAPTURE_SESSIONS: usize = 200;

/// 生词本与查词历史最大上限（从 200 条大幅解封扩容至 2000 条）
pub const MAX_HISTORY_CAPACITY: usize = 2000;

/// Persist a capture-translation session (id-deduped, newest first, capped at 200)
/// so it can be replayed later from the vocabulary/history view.
#[tauri::command]
pub async fn cmd_save_capture_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    session: CaptureSession,
) -> Result<(), String> {
    if session.blocks.is_empty() {
        return Ok(());
    }
    let mut lock = state
        .capture_sessions
        .lock()
        .map_err(|e| format!("Failed to lock capture sessions: {}", e))?;
    lock.retain(|s| s.id != session.id);
    lock.insert(0, session);
    lock.truncate(MAX_CAPTURE_SESSIONS);
    save_capture_sessions_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_capture_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<CaptureSession>, String> {
    let lock = state
        .capture_sessions
        .lock()
        .map_err(|e| format!("Failed to lock capture sessions: {}", e))?;
    Ok(lock.clone())
}

#[tauri::command]
pub async fn cmd_clear_capture_sessions(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut lock = state
        .capture_sessions
        .lock()
        .map_err(|e| format!("Failed to lock capture sessions: {}", e))?;
    lock.clear();
    save_capture_sessions_file(&app_handle, &[]);
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_history(state: State<'_, AppState>) -> Result<Vec<HistoryItem>, String> {
    let lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    Ok(lock.clone())
}

#[tauri::command]
pub async fn cmd_add_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    item: HistoryItem,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.retain(|i| i.id != item.id);
    lock.insert(0, item);

    // 智能淘汰保护算法：当总数超过 2000 条时，优先从后往前剔除「未收藏」的最旧记录
    // 用户收藏过星标 ⭐ 的生词终身保全，绝不误删！
    if lock.len() > MAX_HISTORY_CAPACITY {
        let mut to_remove = lock.len() - MAX_HISTORY_CAPACITY;
        let mut idx = lock.len();
        while idx > 0 && to_remove > 0 {
            idx -= 1;
            if !lock[idx].is_favorite {
                lock.remove(idx);
                to_remove -= 1;
            }
        }
        // 如果未收藏项已全部剔除（全库收藏数仍大于 2000），才做硬截断兜底
        if lock.len() > MAX_HISTORY_CAPACITY {
            lock.truncate(MAX_HISTORY_CAPACITY);
        }
    }
    save_history_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_toggle_favorite(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    for item in lock.iter_mut() {
        if item.id == id {
            item.is_favorite = !item.is_favorite;
            let fav = item.is_favorite;
            save_history_file(&app_handle, &lock);
            return Ok(fav);
        }
    }
    Err("Item not found".to_string())
}

#[tauri::command]
pub async fn cmd_delete_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.retain(|item| item.id != id);
    save_history_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_clear_history(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut lock = state
        .history
        .lock()
        .map_err(|e| format!("Failed to lock history: {}", e))?;
    lock.clear();
    save_history_file(&app_handle, &lock);
    Ok(())
}

#[tauri::command]
pub async fn cmd_export_anki(items: Vec<HistoryItem>) -> Result<String, String> {
    let mut csv_content = String::from("Front,Back,Tag\n");
    for item in items {
        csv_content.push_str(&format!(
            "\"{}\",\"{}\",\"CG-Translator\"\n",
            item.original.replace('"', "\"\""),
            item.translated.replace('"', "\"\"")
        ));
    }
    Ok(csv_content)
}
