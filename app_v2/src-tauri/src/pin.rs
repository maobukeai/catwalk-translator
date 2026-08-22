// 贴图（Pin）模块：把译文卡片钉在桌面上。每个贴图是一个独立的
// 无边框置顶小窗（WebviewWindow，label = pin_{id}），加载同一前端
// 并通过 URL hash（#pin={id}）路由到 PinWindow 组件；内容由本模块的
// 全局 payload 表提供（图片/长文本不走 URL，避免超长查询串）。
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinBlock {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinPayload {
    pub id: String,
    pub title: String,
    pub blocks: Vec<PinBlock>,
    /// 逻辑像素（CSS px）。Tauri 窗口 position/inner_size 均为逻辑值，
    /// 前端直接传 window.screenX + 选区坐标 即可跨 DPI 对齐。
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn payloads() -> &'static Mutex<HashMap<String, PinPayload>> {
    static CELL: OnceLock<Mutex<HashMap<String, PinPayload>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 创建（或更新并聚焦）一个贴图窗口。
#[tauri::command]
pub async fn cmd_open_pin(app: tauri::AppHandle, payload: PinPayload) -> Result<(), String> {
    let id = payload.id.clone();
    payloads()
        .lock()
        .map_err(|_| "贴图状态锁中毒".to_string())?
        .insert(id.clone(), payload.clone());

    let label = format!("pin_{}", id);

    // 已存在的贴图：只更新内容（前端监听 pin-updated 事件）并聚焦。
    // 不重置位置/尺寸 —— 用户拖动或手动调整过的贴图应留在原地。
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.emit_to(
            label.as_str(),
            "pin-updated",
            serde_json::to_value(&payload).unwrap_or_default(),
        );
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let url = tauri::WebviewUrl::App(format!("index.html#pin={}", id).into());
    let win = tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title("猫步翻译 · 贴图")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(true)
        .inner_size(payload.width, payload.height)
        .position(payload.x, payload.y)
        .build()
        .map_err(|e| format!("创建贴图窗口失败: {}", e))?;

    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(&win, true, true);

    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 贴图窗口挂载时读取自身内容。
#[tauri::command]
pub async fn cmd_get_pin_payload(id: String) -> Result<Option<PinPayload>, String> {
    Ok(payloads()
        .lock()
        .map_err(|_| "贴图状态锁中毒".to_string())?
        .get(&id)
        .cloned())
}

/// 关闭并移除一个贴图（由贴图窗口的关闭按钮调用）。
#[tauri::command]
pub async fn cmd_close_pin(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let label = format!("pin_{}", id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    payloads()
        .lock()
        .map_err(|_| "贴图状态锁中毒".to_string())?
        .remove(&id);
    Ok(())
}
