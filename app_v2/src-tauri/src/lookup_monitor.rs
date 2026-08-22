//! 无感查词:① 划词即弹窗 —— 在任何应用中拖选/双击选中文字后自动弹出翻译
//! 浮窗(CopyTranslator 式,模拟 Ctrl+C 取词后恢复原剪贴板);② 修饰键悬停
//! 取词 —— 按住 Ctrl/Alt/Shift 并把鼠标停在屏幕文字上 ~350ms,对光标邻域
//! 实时截屏 OCR 找到词/短语并弹出词卡(有道式)。
//!
//! 单例轮询线程(20ms)检测鼠标与修饰键状态;结果在常驻浮窗
//! (label = `lookup_popup`,URL hash `#lookup`)中展示 —— 窗口管理仿 pin.rs,
//! 不抢焦点,靠失焦外的自动隐藏策略收起。设置驱动的启停与 clipboard_watch
//! 一致(apply_settings_side_effects)。

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

pub const POPUP_LABEL: &str = "lookup_popup";
const POLL_INTERVAL_MS: u64 = 20;
const POPUP_WIDTH: f64 = 400.0;
const HEIGHT_SELECTION: f64 = 190.0;
const HEIGHT_HOVER: f64 = 270.0;

static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);
static MONITOR_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupPayload {
    /// "selection"(划词句子)| "hover"(悬停词卡)
    pub kind: String,
    pub text: String,
    /// selection:译文与来源层级
    pub translation: Option<String>,
    pub source_tier: Option<String>,
    /// hover:词卡(音标/释义)与多源对照,序列化后的 TextQueryResponse 片段
    pub word_detail: Option<serde_json::Value>,
    pub engines: Option<serde_json::Value>,
    pub ts_ms: u64,
}

fn current_payload() -> &'static Mutex<Option<LookupPayload>> {
    static CELL: OnceLock<Mutex<Option<LookupPayload>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

// ── 纯状态机(单元测试覆盖)────────────────────────────────────────────────

pub struct SelectionTracker {
    pressed: Option<(i32, i32)>,
    last_click: Option<(Instant, i32, i32)>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SelectionEvent {
    None,
    /// 拖选释放(位移超过阈值)
    DragRelease,
    /// 同位快速二次点击(双击选词)
    DoubleClick,
}

impl SelectionTracker {
    pub fn new() -> Self {
        Self {
            pressed: None,
            last_click: None,
        }
    }

    pub fn reset(&mut self) {
        self.pressed = None;
        self.last_click = None;
    }

    /// 喂入一帧轮询状态,判定是否应触发划词取词。
    pub fn feed(&mut self, left_down: bool, x: i32, y: i32) -> SelectionEvent {
        if left_down {
            if self.pressed.is_none() {
                self.pressed = Some((x, y));
            }
            return SelectionEvent::None;
        }
        if let Some((sx, sy)) = self.pressed.take() {
            let dist = distance(x, y, sx, sy);
            if dist > 15.0 {
                // 拖选结束。清理点击记忆,避免拖选后的单击被误判为双击。
                self.last_click = None;
                return SelectionEvent::DragRelease;
            }
            // 一次普通点击:检查是否构成双击(400ms 内、同位)
            if let Some((t, cx, cy)) = self.last_click {
                if t.elapsed() < Duration::from_millis(400) && distance(x, y, cx, cy) < 8.0 {
                    self.last_click = None;
                    return SelectionEvent::DoubleClick;
                }
            }
            self.last_click = Some((Instant::now(), x, y));
        }
        SelectionEvent::None
    }
}

pub struct HoverTracker {
    last_pos: (i32, i32),
    stationary_since: Option<Instant>,
    last_fire_pos: Option<(i32, i32)>,
}

impl HoverTracker {
    pub fn new() -> Self {
        Self {
            last_pos: (0, 0),
            stationary_since: None,
            last_fire_pos: None,
        }
    }

    pub fn reset(&mut self) {
        self.stationary_since = None;
    }

    /// 修饰键按住 + 左键未按 + 光标静止 350ms,且距上次触发点足够远 → 触发。
    pub fn feed(&mut self, modifier_down: bool, left_down: bool, x: i32, y: i32) -> bool {
        if !modifier_down || left_down {
            self.stationary_since = None;
            self.last_pos = (x, y);
            return false;
        }
        let moved = distance(x, y, self.last_pos.0, self.last_pos.1) > 4.0;
        self.last_pos = (x, y);
        if moved {
            self.stationary_since = Some(Instant::now());
            return false;
        }
        let since = match self.stationary_since {
            Some(t) => t,
            None => {
                self.stationary_since = Some(Instant::now());
                return false;
            }
        };
        if since.elapsed() < Duration::from_millis(350) {
            return false;
        }
        // 与上次触发位置太近 → 不重复弹(移动 >15px 后才会再次触发)
        if let Some((fx, fy)) = self.last_fire_pos {
            if distance(x, y, fx, fy) <= 15.0 {
                return false;
            }
        }
        self.last_fire_pos = Some((x, y));
        true
    }
}

fn distance(x1: i32, y1: i32, x2: i32, y2: i32) -> f64 {
    let dx = (x1 - x2) as f64;
    let dy = (y1 - y2) as f64;
    (dx * dx + dy * dy).sqrt()
}

// ── 监控线程 ───────────────────────────────────────────────────────────────

struct MonitorSettings {
    selection_on: bool,
    hover_on: bool,
    /// 修饰键虚拟键码:Ctrl=0x11 / Alt=0x12 / Shift=0x10
    modifier_vk: i32,
}

fn read_monitor_settings(app: &tauri::AppHandle) -> MonitorSettings {
    let mut s = MonitorSettings {
        selection_on: false,
        hover_on: false,
        modifier_vk: 0x11,
    };
    if let Some(state) = app.try_state::<crate::commands::AppState>() {
        if let Ok(cfg) = state.settings.lock() {
            s.selection_on = cfg.selection_lookup_enabled.unwrap_or(false);
            s.hover_on = cfg.hover_lookup_enabled.unwrap_or(false);
            s.modifier_vk = match cfg.hover_lookup_modifier.as_deref() {
                Some("alt") => 0x12,
                Some("shift") => 0x10,
                _ => 0x11,
            };
        }
    }
    s
}

/// 启动监控线程(已在运行则 no-op)。两个功能都关闭时线程空转,不退出
/// —— 设置变更后 2 秒内自动生效,无需重启线程。
pub fn start_lookup_monitor(app_handle: tauri::AppHandle) {
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let generation = MONITOR_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let mut sel = SelectionTracker::new();
        let mut hov = HoverTracker::new();
        let mut settings = read_monitor_settings(&app_handle);
        let mut last_settings_read = Instant::now();

        loop {
            if !MONITOR_RUNNING.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

            if last_settings_read.elapsed() > Duration::from_secs(2) {
                settings = read_monitor_settings(&app_handle);
                last_settings_read = Instant::now();
            }
            if !settings.selection_on && !settings.hover_on {
                continue;
            }

            let (x, y) = match cursor_pos() {
                Some(p) => p,
                None => continue,
            };
            let left_down = key_down(0x01); // VK_LBUTTON

            // ① 划词即弹窗:自身应用的窗口不处理(有自己的翻译 UI)
            if settings.selection_on {
                let event = sel.feed(left_down, x, y);
                if event != SelectionEvent::None && !own_foreground_window() {
                    if let Some(text) = capture_selection_text() {
                        let trimmed = text.trim().to_string();
                        if crate::clipboard_watch::clipboard_text_worth_translating(&trimmed, "") {
                            handle_selection_lookup(&app_handle, &trimmed);
                            hov.reset();
                        }
                    }
                }
            }

            // ② 修饰键悬停取词
            if settings.hover_on {
                let modifier_down = key_down(settings.modifier_vk);
                if hov.feed(modifier_down, left_down, x, y) && !own_foreground_window() {
                    handle_hover_lookup(&app_handle, x, y);
                }
            }
        }
        if MONITOR_GENERATION.load(Ordering::SeqCst) == generation {
            MONITOR_RUNNING.store(false, Ordering::SeqCst);
        }
    });
}

pub fn stop_lookup_monitor() {
    MONITOR_RUNNING.store(false, Ordering::SeqCst);
}

#[allow(dead_code)]
pub fn lookup_monitor_running() -> bool {
    MONITOR_RUNNING.load(Ordering::SeqCst)
}

/// 划词:模拟复制取到选中文本 → 多级管线翻译(含术语强制表)→ 弹窗。
fn handle_selection_lookup(app: &tauri::AppHandle, text: &str) {
    let (preset, llm, glossary) = translation_env(app);
    let phrase = text.to_string();
    let result = tauri::async_runtime::block_on(async {
        let pipeline = crate::translator::shared_pipeline();
        let phrases = vec![phrase];
        pipeline
            .translate_phrases(&phrases, &preset, llm.as_ref(), &glossary)
            .await
    });
    let Some(tr) = result.first() else { return };
    if tr.translated.trim().is_empty() {
        return;
    }
    // 同步进剪贴板翻译历史,与剪贴板监听行为一致
    crate::clipboard_history::push(app, text, &tr.translated, &tr.source_tier);
    show_popup(
        app,
        LookupPayload {
            kind: "selection".to_string(),
            text: text.to_string(),
            translation: Some(tr.translated.clone()),
            source_tier: Some(tr.source_tier.clone()),
            word_detail: None,
            engines: None,
            ts_ms: crate::backup::now_ms(),
        },
        HEIGHT_SELECTION,
    );
}

/// 悬停:隐藏旧浮窗 → 实时截取光标邻域 → OCR 找光标下的词 → 词卡查询 → 弹窗。
fn handle_hover_lookup(app: &tauri::AppHandle, x: i32, y: i32) {
    // 先隐藏已可见的浮窗,避免把自己拍进截图
    if let Some(win) = app.get_webview_window(POPUP_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            std::thread::sleep(Duration::from_millis(60));
        }
    }

    let (vx, vy, vw, vh) = virtual_screen_metrics();
    let x0 = (x - 300).max(vx);
    let y0 = (y - 150).max(vy);
    let x1 = (x + 300).min(vx + vw);
    let y1 = (y + 150).min(vy + vh);
    if x1 - x0 < 8 || y1 - y0 < 8 {
        return;
    }
    let rect = crate::models::PhysicalRect {
        x: x0,
        y: y0,
        width: (x1 - x0) as u32,
        height: (y1 - y0) as u32,
    };
    let Ok((bmp, w, h, _sf)) = crate::capture::capture_region_bmp(rect) else {
        return;
    };
    let Some((text, _rx, _ry, _rw, _rh)) =
        crate::commands_capture::ocr_line_at(&bmp, w, h, x - x0, y - y0)
    else {
        return;
    };
    let trimmed = text.trim();
    // 单字符多为噪声(图标/边框误识别)
    if trimmed.chars().count() < 2 {
        return;
    }

    let (preset, llm, glossary) = translation_env(app);
    let word = trimmed.to_string();
    let detail = tauri::async_runtime::block_on(async {
        crate::translator::shared_pipeline()
            .query_text_detail(&word, &preset, llm.as_ref(), &glossary)
            .await
    });

    show_popup(
        app,
        LookupPayload {
            kind: "hover".to_string(),
            text: word,
            translation: None,
            source_tier: None,
            word_detail: detail
                .word_detail
                .as_ref()
                .and_then(|d| serde_json::to_value(d).ok()),
            engines: serde_json::to_value(&detail.results).ok(),
            ts_ms: crate::backup::now_ms(),
        },
        HEIGHT_HOVER,
    );
}

fn translation_env(app: &tauri::AppHandle) -> (String, Option<crate::models::LlmConfig>, Vec<(String, String)>) {
    let mut out = ("blender".to_string(), None, Vec::new());
    if let Some(state) = app.try_state::<crate::commands::AppState>() {
        if let Ok(cfg) = state.settings.lock() {
            out.0 = cfg.default_preset.clone();
            out.1 = cfg.llm_config.clone();
            out.2 = crate::translator::glossary_from_settings(&cfg.custom_dict_items);
        }
    }
    out
}

// ── 取词:模拟 Ctrl+C + 剪贴板恢复 ────────────────────────────────────────

/// 模拟 Ctrl+C 复制当前选区,读取文本后尽力恢复原剪贴板。
/// 返回 None 表示复制未发生(选区不可复制/目标应用权限更高)。
fn capture_selection_text() -> Option<String> {
    let seq_before = crate::clipboard_watch::clipboard_sequence_number_pub();
    let old_text = crate::clipboard_watch::read_clipboard_text();

    simulate_copy();

    // 等待剪贴板序号变化(目标应用处理复制需要一点时间)
    let deadline = Instant::now() + Duration::from_millis(150);
    let mut seq_now = seq_before;
    while Instant::now() < deadline {
        seq_now = crate::clipboard_watch::clipboard_sequence_number_pub();
        if seq_now != 0 && seq_now != seq_before {
            break;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    if seq_now == 0 || seq_now == seq_before {
        return None;
    }
    let text = crate::clipboard_watch::read_clipboard_text();

    // 恢复原文本剪贴板(原内容是图片等非文本时保留新复制的内容)
    if let Some(old) = old_text.as_deref() {
        write_clipboard_text(old);
    }

    // 标记我们造成的全部序号(复制+恢复),剪贴板监听据此跳过,避免双弹
    let final_seq = crate::clipboard_watch::clipboard_sequence_number_pub();
    let caused = final_seq.max(seq_now);
    crate::clipboard_watch::SELF_CAUSED_SEQ.fetch_max(caused, Ordering::SeqCst);

    text
}

#[cfg(target_os = "windows")]
fn simulate_copy() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };
    const VK_CTRL: u16 = 0x11;
    const VK_C: u16 = 0x43;

    unsafe {
        let make = |vk: u16, up: bool| INPUT {
            r#type: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [
            make(VK_CTRL, false),
            make(VK_C, false),
            make(VK_C, true),
            make(VK_CTRL, true),
        ];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn simulate_copy() {}

/// 镜像 read_clipboard_text 的写实现:CF_UNICODETEXT 写回。
#[cfg(target_os = "windows")]
fn write_clipboard_text(text: &str) {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    const CF_UNICODETEXT: u32 = 13;

    // 空文本没有恢复意义
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let bytes = wide.len() * 2;

    unsafe {
        if OpenClipboard(HWND(std::ptr::null_mut())).is_err() {
            return;
        }
        let Ok(handle) = GlobalAlloc(GMEM_MOVEABLE, bytes) else {
            let _ = CloseClipboard();
            return;
        };
        let dst = GlobalLock(handle);
        if dst.is_null() {
            let _ = CloseClipboard();
            return;
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), dst as *mut u16, wide.len());
        let _ = GlobalUnlock(handle);
        if EmptyClipboard().is_err() {
            let _ = CloseClipboard();
            return;
        }
        // 所有权转移给剪贴板;失败时忽略(内容保持新复制文本,尽力而为)
        let _ = SetClipboardData(CF_UNICODETEXT, HANDLE_FROM(handle));
        let _ = CloseClipboard();
    }

    #[allow(non_snake_case)]
    fn HANDLE_FROM(h: HGLOBAL) -> windows::Win32::Foundation::HANDLE {
        windows::Win32::Foundation::HANDLE(h.0)
    }
}

#[cfg(not(target_os = "windows"))]
fn write_clipboard_text(_text: &str) {}

// ── 浮窗管理(仿 pin.rs)──────────────────────────────────────────────────

fn show_popup(app: &tauri::AppHandle, payload: LookupPayload, height: f64) {
    if let Ok(mut slot) = current_payload().lock() {
        *slot = Some(payload.clone());
    }

    let win = match app.get_webview_window(POPUP_LABEL) {
        Some(w) => w,
        None => {
            let url = tauri::WebviewUrl::App("index.html#lookup".into());
            match tauri::WebviewWindowBuilder::new(app, POPUP_LABEL, url)
                .title("猫步翻译 · 查词")
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(true)
                .inner_size(POPUP_WIDTH, height)
                .visible(false)
                .build()
            {
                Ok(w) => {
                    #[cfg(target_os = "windows")]
                    crate::set_windows_dwm_blur(&w, false, true);
                    w
                }
                Err(e) => {
                    eprintln!("[lookup] 创建浮窗失败: {e}");
                    return;
                }
            }
        }
    };

    let _ = win.set_size(tauri::LogicalSize::new(POPUP_WIDTH, height));
    if let Some((x, y)) = cursor_pos() {
        position_popup(&win, x, y, POPUP_WIDTH, height);
    }
    let _ = tauri::Emitter::emit_to(
        &win,
        POPUP_LABEL,
        "lookup-updated",
        serde_json::to_value(&payload).unwrap_or_default(),
    );
    // 不抢焦点:用户继续在原应用操作,浮窗靠失焦外的策略收起
    let _ = win.show();
}

/// 光标右下偏移 12px 放置,超出显示器工作区则翻转到左/上。
fn position_popup(win: &tauri::WebviewWindow, cx: i32, cy: i32, logical_w: f64, logical_h: f64) {
    let (work_x, work_y, work_w, work_h) = monitor_work_area(cx, cy);
    let scale = monitor_dpi_scale(cx, cy).unwrap_or(1.0);
    let w = (logical_w * scale) as i32;
    let h = (logical_h * scale) as i32;
    let offset = 12;

    let mut px = cx + offset;
    let mut py = cy + offset;
    if px + w > work_x + work_w {
        px = cx - w - offset;
    }
    if py + h > work_y + work_h {
        py = cy - h - offset;
    }
    px = px.max(work_x);
    py = py.max(work_y);
    let _ = win.set_position(tauri::PhysicalPosition::new(px, py));
}

#[tauri::command]
pub async fn cmd_get_lookup_payload() -> Result<Option<LookupPayload>, String> {
    Ok(current_payload().lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub async fn cmd_hide_lookup_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(POPUP_LABEL) {
        let _ = win.hide();
    }
    Ok(())
}

// ── Windows plumbing ────────────────────────────────────────────────────────

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
fn key_down(vk: i32) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 }
}

#[cfg(not(target_os = "windows"))]
fn key_down(_vk: i32) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn own_foreground_window() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return false;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        pid == std::process::id()
    }
}

#[cfg(not(target_os = "windows"))]
fn own_foreground_window() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn virtual_screen_metrics() -> (i32, i32, i32, i32) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

#[cfg(not(target_os = "windows"))]
fn virtual_screen_metrics() -> (i32, i32, i32, i32) {
    (0, 0, 0, 0)
}

/// 光标所在显示器的工作区(物理像素,排除任务栏)。
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
            virtual_screen_metrics()
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn monitor_work_area(_cx: i32, _cy: i32) -> (i32, i32, i32, i32) {
    (0, 0, 1920, 1080)
}

/// 光标所在显示器的有效 DPI 缩放(用于逻辑尺寸换算)。
#[cfg(target_os = "windows")]
fn monitor_dpi_scale(cx: i32, cy: i32) -> Option<f64> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::MonitorFromPoint;
    use windows::Win32::Graphics::Gdi::MONITOR_DEFAULTTONEAREST;
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

// ── 单元测试 ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drag_release_triggers_after_threshold() {
        let mut t = SelectionTracker::new();
        assert_eq!(t.feed(true, 100, 100), SelectionEvent::None);
        assert_eq!(t.feed(false, 180, 110), SelectionEvent::DragRelease); // 位移 80
    }

    #[test]
    fn tiny_drag_does_not_trigger() {
        let mut t = SelectionTracker::new();
        assert_eq!(t.feed(true, 100, 100), SelectionEvent::None);
        assert_eq!(t.feed(false, 105, 103), SelectionEvent::None); // 位移 < 15
    }

    #[test]
    fn double_click_triggers() {
        let mut t = SelectionTracker::new();
        // 第一次点击(按下+抬起)
        assert_eq!(t.feed(true, 100, 100), SelectionEvent::None);
        assert_eq!(t.feed(false, 100, 101), SelectionEvent::None);
        // 第二次点击:同位 → 双击
        assert_eq!(t.feed(true, 100, 101), SelectionEvent::None);
        assert_eq!(t.feed(false, 101, 100), SelectionEvent::DoubleClick);
    }

    #[test]
    fn drag_then_single_click_is_not_double_click() {
        let mut t = SelectionTracker::new();
        // 拖选
        assert_eq!(t.feed(true, 100, 100), SelectionEvent::None);
        assert_eq!(t.feed(false, 200, 100), SelectionEvent::DragRelease);
        // 之后的单击不应被误判为双击
        assert_eq!(t.feed(true, 201, 100), SelectionEvent::None);
        assert_eq!(t.feed(false, 201, 100), SelectionEvent::None);
    }

    #[test]
    fn hover_requires_modifier_and_stationarity() {
        let mut h = HoverTracker::new();
        // 无修饰键:永不触发
        assert!(!h.feed(false, false, 100, 100));
        // 修饰键按下但光标持续移动:不触发
        assert!(!h.feed(true, false, 100, 100));
        assert!(!h.feed(true, false, 130, 100));
        // 左键按下重置
        assert!(!h.feed(true, true, 130, 100));
        assert!(!h.feed(true, false, 130, 100));
    }

    #[test]
    fn hover_retrigger_needs_movement() {
        let mut h = HoverTracker::new();
        // 静止判定用时间,这里只验证位置逻辑:同位连续喂入最终触发一次
        // (触发后 last_fire_pos 记录该点)
        assert!(!h.feed(true, false, 500, 500));
        h.stationary_since = Some(Instant::now() - Duration::from_millis(400));
        assert!(h.feed(true, false, 500, 500));
        // 再喂同位:不再触发
        h.stationary_since = Some(Instant::now() - Duration::from_millis(400));
        assert!(!h.feed(true, false, 501, 500));
        // 移远后可再次触发
        assert!(!h.feed(true, false, 600, 500));
        h.stationary_since = Some(Instant::now() - Duration::from_millis(400));
        assert!(h.feed(true, false, 600, 500));
    }
}
