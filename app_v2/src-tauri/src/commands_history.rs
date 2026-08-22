//! 生词本历史与截图翻译会话命令(含 Anki 导出)。
use crate::commands::{save_capture_sessions_file, save_history_file, AppState};
use crate::models::{CaptureSession, HistoryItem};
use tauri::State;

/// Persist a capture-translation session (id-deduped, newest first, capped at 50)
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
    lock.truncate(50);
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
    lock.insert(0, item);
    if lock.len() > 200 {
        lock.truncate(200);
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
