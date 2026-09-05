// 贴图（Pin）模块：把译文卡片钉在桌面上。每个贴图是一个独立的
// 无边框置顶小窗（WebviewWindow，label = pin_{id}），加载同一前端
// 并通过 URL hash（#pin={id}）路由到 PinWindow 组件；内容由本模块的
// 全局 payload 表提供（图片/长文本不走 URL，避免超长查询串）。
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

pub const PIN_QUICK_LABEL: &str = "pin_quick";
pub const QUICK_PIN_ID: &str = "quick";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinBlock {
    pub original: String,
    pub translated: String,
    pub source_tier: String,
    #[serde(default)]
    pub alternatives: Option<Vec<String>>,
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

// ── 鼠标与屏幕工作区测量（安全防溢出居中定位） ────────────────────────────────

#[cfg(target_os = "windows")]
fn cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT::default();
    unsafe { GetCursorPos(&mut pt).ok()? };
    Some((pt.x, pt.y))
}

#[cfg(not(target_os = "windows"))]
fn cursor_pos() -> Option<(i32, i32)> {
    None
}

#[cfg(target_os = "windows")]
fn monitor_work_area(cx: i32, cy: i32) -> (i32, i32, i32, i32) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: cx, y: cy }, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            let r = info.rcWork;
            (r.left, r.top, r.right - r.left, r.bottom - r.top)
        } else {
            (0, 0, 1920, 1080)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn monitor_work_area(_cx: i32, _cy: i32) -> (i32, i32, i32, i32) {
    (0, 0, 1920, 1080)
}

#[cfg(target_os = "windows")]
fn monitor_dpi_scale(cx: i32, cy: i32) -> Option<f64> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: cx, y: cy }, MONITOR_DEFAULTTONEAREST);
        let mut dpi_x: u32 = 96;
        let mut _dpi_y: u32 = 96;
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut _dpi_y).is_err() {
            return None;
        }
        Some(dpi_x as f64 / 96.0)
    }
}

#[cfg(not(target_os = "windows"))]
fn monitor_dpi_scale(_cx: i32, _cy: i32) -> Option<f64> {
    Some(1.0)
}

/// 计算鼠标位置周围的居中弹出物理坐标，并施加屏幕安全边界保护防溢出。
pub fn calculate_popup_position(logical_w: f64, logical_h: f64) -> (i32, i32) {
    let (cx, cy) = cursor_pos().unwrap_or((960, 540));
    let (work_x, work_y, work_w, work_h) = monitor_work_area(cx, cy);
    let scale = monitor_dpi_scale(cx, cy).unwrap_or(1.0);
    let w = (logical_w * scale) as i32;
    let h = (logical_h * scale) as i32;

    let mut px = cx - w / 2;
    let mut py = cy - h / 2;

    // 安全边界约束：严禁超出工作区边缘与任务栏
    if px + w > work_x + work_w {
        px = work_x + work_w - w;
    }
    if px < work_x {
        px = work_x;
    }
    if py + h > work_y + work_h {
        py = work_y + work_h - h;
    }
    if py < work_y {
        py = work_y;
    }

    (px, py)
}

static LAST_QUICK_TOGGLE: Mutex<Option<std::time::Instant>> = Mutex::new(None);

/// 打开或唤醒并聚焦单例快捷查词悬浮小窗 (pin_quick)。
pub fn open_or_show_quick_window(app: &tauri::AppHandle) -> Result<(), String> {
    {
        if let Ok(mut last) = LAST_QUICK_TOGGLE.lock() {
            let now = std::time::Instant::now();
            if let Some(prev) = *last {
                if now.duration_since(prev).as_millis() < 280 {
                    return Ok(());
                }
            }
            *last = Some(now);
        }
    }

    let (logical_w, logical_h) = (460.0, 520.0);
    let (px, py) = calculate_popup_position(logical_w, logical_h);

    // 确保 quick 默认 payload 存在
    {
        let mut map = payloads()
            .lock()
            .map_err(|_| "贴图状态锁中毒".to_string())?;
        if !map.contains_key(QUICK_PIN_ID) {
            map.insert(
                QUICK_PIN_ID.to_string(),
                PinPayload {
                    id: QUICK_PIN_ID.to_string(),
                    title: "贴图".to_string(),
                    blocks: Vec::new(),
                    x: px as f64,
                    y: py as f64,
                    width: logical_w,
                    height: logical_h,
                },
            );
        }
    }

    // 若 pin_quick 窗口已存在：
    if let Some(win) = app.get_webview_window(PIN_QUICK_LABEL) {
        let is_vis = win.is_visible().unwrap_or(false);
        let is_min = win.is_minimized().unwrap_or(false);
        if !is_vis || is_min {
            // 没打开或最小化状态：弹出到鼠标位置
            let (cx, cy) = cursor_pos().unwrap_or((960, 540));
            let scale = monitor_dpi_scale(cx, cy).unwrap_or(1.0);
            let phys_w = (logical_w * scale) as u32;
            let phys_h = (logical_h * scale) as u32;
            let _ = win.set_size(tauri::PhysicalSize::new(phys_w, phys_h));
            let _ = win.set_position(tauri::PhysicalPosition::new(px, py));
            let _ = win.set_always_on_top(true);
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit_to(PIN_QUICK_LABEL, "quick-window-triggered", ());
            let _ = app.emit("trigger-quick-window", ());
            return Ok(());
        }

        // 打开状态：快捷键触发吸附到侧边（若已在侧边收纳态则弹出）
        let _ = win.emit_to(PIN_QUICK_LABEL, "quick-window-hotkey-toggle", ());
        return Ok(());
    }

    // 首次创建 pin_quick 窗口：初始无边框居中弹出，默认置顶常驻
    let (cx, cy) = cursor_pos().unwrap_or((960, 540));
    let scale = monitor_dpi_scale(cx, cy).unwrap_or(1.0);
    let url = tauri::WebviewUrl::App(format!("index.html#pin={}", QUICK_PIN_ID).into());
    let win = tauri::WebviewWindowBuilder::new(app, PIN_QUICK_LABEL, url)
        .title("猫步翻译 · 贴图")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(false)
        .inner_size(logical_w, logical_h)
        .position(px as f64 / scale, py as f64 / scale)
        .build()
        .map_err(|e| format!("创建贴图窗口失败: {}", e))?;

    let _ = win.set_position(tauri::PhysicalPosition::new(px, py));

    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(&win, false, false);

    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit_to(PIN_QUICK_LABEL, "quick-window-triggered", ());
    let _ = app.emit("trigger-quick-window", ());
    Ok(())
}

/// 打开快捷查词悬浮小窗命令。
#[tauri::command]
pub async fn cmd_open_quick_window(app: tauri::AppHandle) -> Result<(), String> {
    open_or_show_quick_window(&app)
}

/// 将贴图/查词窗口重置为标准尺寸并移动至当前鼠标光标位置（用于从侧边胶囊一键弹出）
#[tauri::command]
pub async fn cmd_reposition_pin_to_cursor(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let actual_label = if label.starts_with("pin_") {
        label.clone()
    } else {
        format!("pin_{}", label)
    };
    if let Some(win) = app.get_webview_window(&actual_label) {
        let (logical_w, logical_h) = (460.0, 520.0);
        let (px, py) = calculate_popup_position(logical_w, logical_h);
        let (cx, cy) = cursor_pos().unwrap_or((960, 540));
        let scale = monitor_dpi_scale(cx, cy).unwrap_or(1.0);
        let phys_w = (logical_w * scale) as u32;
        let phys_h = (logical_h * scale) as u32;
        let _ = win.set_size(tauri::PhysicalSize::new(phys_w, phys_h));
        let _ = win.set_position(tauri::PhysicalPosition::new(px, py));
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}

/// 动态设置贴图窗口置顶状态。
#[tauri::command]
pub async fn cmd_set_pin_always_on_top(
    app: tauri::AppHandle,
    label: String,
    always_on_top: bool,
) -> Result<(), String> {
    let actual_label = if label.starts_with("pin_") {
        label.clone()
    } else {
        format!("pin_{}", label)
    };
    if let Some(win) = app.get_webview_window(&actual_label) {
        let _ = win.set_always_on_top(always_on_top);
    }
    Ok(())
}

/// 创建（或更新并聚焦）一个普通贴图窗口。
#[tauri::command]
pub async fn cmd_open_pin(app: tauri::AppHandle, payload: PinPayload) -> Result<(), String> {
    let id = payload.id.clone();
    payloads()
        .lock()
        .map_err(|_| "贴图状态锁中毒".to_string())?
        .insert(id.clone(), payload.clone());

    let label = if id.starts_with("pin_") {
        id.clone()
    } else {
        format!("pin_{}", id)
    };

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
        .shadow(false)
        .inner_size(payload.width, payload.height)
        .position(payload.x, payload.y)
        .build()
        .map_err(|e| format!("创建贴图窗口失败: {}", e))?;

    #[cfg(target_os = "windows")]
    crate::set_windows_dwm_blur(&win, false, false);

    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 贴图窗口挂载时读取自身内容。
#[tauri::command]
pub async fn cmd_get_pin_payload(id: String) -> Result<Option<PinPayload>, String> {
    let map = payloads()
        .lock()
        .map_err(|_| "贴图状态锁中毒".to_string())?;
    if let Some(p) = map.get(&id) {
        return Ok(Some(p.clone()));
    }
    let alt_id = if id.starts_with("pin_") {
        id.trim_start_matches("pin_").to_string()
    } else {
        format!("pin_{}", id)
    };
    Ok(map.get(&alt_id).cloned())
}

/// 关闭并移除一个贴图（由贴图窗口的关闭按钮调用）。
#[tauri::command]
pub async fn cmd_close_pin(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let label = if id.starts_with("pin_") {
        id.clone()
    } else {
        format!("pin_{}", id)
    };
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    let alt_id = if id.starts_with("pin_") {
        id.trim_start_matches("pin_").to_string()
    } else {
        format!("pin_{}", id)
    };
    let mut map = payloads()
        .lock()
        .map_err(|_| "贴图状态锁中毒".to_string())?;
    map.remove(&id);
    map.remove(&alt_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_popup_position_clamping() {
        let (px, py) = calculate_popup_position(440.0, 260.0);
        // Position coordinates should not be completely invalid
        assert!(px >= -10000 && px <= 10000);
        assert!(py >= -10000 && py <= 10000);
    }

    #[test]
    fn test_payload_store() {
        let test_payload = PinPayload {
            id: "unit_test_id".to_string(),
            title: "Test".to_string(),
            blocks: vec![PinBlock {
                original: "Hello".to_string(),
                translated: "你好".to_string(),
                source_tier: "Test".to_string(),
                alternatives: None,
            }],
            x: 100.0,
            y: 100.0,
            width: 300.0,
            height: 200.0,
        };

        payloads()
            .lock()
            .unwrap()
            .insert("unit_test_id".to_string(), test_payload.clone());

        let retrieved = payloads()
            .lock()
            .unwrap()
            .get("unit_test_id")
            .cloned();

        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().blocks[0].translated, "你好");

        payloads().lock().unwrap().remove("unit_test_id");
    }
}
