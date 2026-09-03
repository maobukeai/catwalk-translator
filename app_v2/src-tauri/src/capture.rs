pub use crate::models::PhysicalRect;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCapturePayload {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    /// 截图瞬间检测到的前台 3D/CG 软件（用于自动切换专业词库）
    #[serde(default)]
    pub detected_app: Option<crate::app_detect::DetectedApp>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub trait ScreenCapturer {
    fn capture_rect(&self, rect: PhysicalRect) -> Result<Vec<u8>, String>;
}

pub struct CoordinateMapper;

impl CoordinateMapper {
    pub fn logical_to_physical(logical: LogicalRect, scale_factor: f64) -> PhysicalRect {
        PhysicalRect {
            x: (logical.x * scale_factor).round() as i32,
            y: (logical.y * scale_factor).round() as i32,
            width: (logical.width * scale_factor).round() as u32,
            height: (logical.height * scale_factor).round() as u32,
        }
    }

    pub fn physical_to_logical(physical: PhysicalRect, scale_factor: f64) -> LogicalRect {
        LogicalRect {
            x: (physical.x as f64) / scale_factor,
            y: (physical.y as f64) / scale_factor,
            width: (physical.width as f64) / scale_factor,
            height: (physical.height as f64) / scale_factor,
        }
    }

    pub fn normalize_drag_points(p1: (f64, f64), p2: (f64, f64)) -> LogicalRect {
        let x = p1.0.min(p2.0);
        let y = p1.1.min(p2.1);
        let width = (p1.0 - p2.0).abs();
        let height = (p1.1 - p2.1).abs();
        LogicalRect {
            x,
            y,
            width,
            height,
        }
    }

    pub fn contains_point(bounds: PhysicalRect, point: (i32, i32)) -> bool {
        let (px, py) = point;
        px >= bounds.x
            && px < bounds.x + (bounds.width as i32)
            && py >= bounds.y
            && py < bounds.y + (bounds.height as i32)
    }

    pub fn clamp_rect(req: PhysicalRect, max_bounds: PhysicalRect) -> PhysicalRect {
        let min_x = req.x.max(max_bounds.x);
        let min_y = req.y.max(max_bounds.y);
        let max_x = (req.x + req.width as i32).min(max_bounds.x + max_bounds.width as i32);
        let max_y = (req.y + req.height as i32).min(max_bounds.y + max_bounds.height as i32);

        let width = (max_x - min_x).max(0) as u32;
        let height = (max_y - min_y).max(0) as u32;

        PhysicalRect {
            x: min_x,
            y: min_y,
            width,
            height,
        }
    }
}

pub fn encode_base64(bytes: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(CHARSET[((n >> 18) & 63) as usize] as char);
        out.push(CHARSET[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARSET[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

// ─── Global in-memory storage for latest desktop screenshot ───────────────────

pub type CaptureData = (Vec<u8>, u32, u32, f64);

static LATEST_CAPTURE: std::sync::Mutex<Option<CaptureData>> =
    std::sync::Mutex::new(None);

pub fn set_latest_capture(data: Vec<u8>, width: u32, height: u32, scale_factor: f64) {
    if let Ok(mut lock) = LATEST_CAPTURE.lock() {
        *lock = Some((data, width, height, scale_factor));
    }
}

pub fn get_latest_capture() -> Option<CaptureData> {
    LATEST_CAPTURE.lock().ok()?.clone()
}

// ─── Windows Native Implementation ────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[allow(non_camel_case_types, clippy::upper_case_acronyms)]
pub fn capture_desktop_payload() -> Result<ScreenCapturePayload, String> {
    type HDC = *mut std::ffi::c_void;
    type HBITMAP = *mut std::ffi::c_void;
    type HGDIOBJ = *mut std::ffi::c_void;
    type HWND = *mut std::ffi::c_void;
    type BOOL = i32;

    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[repr(C)]
    struct BITMAPINFO {
        bmi_header: BITMAPINFOHEADER,
        bmi_colors: [u32; 1],
    }

    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;
    const SM_XVIRTUALSCREEN: i32 = 76;
    const SM_YVIRTUALSCREEN: i32 = 77;
    const SM_CXVIRTUALSCREEN: i32 = 78;
    const SM_CYVIRTUALSCREEN: i32 = 79;

    const SRCCOPY: u32 = 0x00CC0020;
    const DIB_RGB_COLORS: u32 = 0;
    // GetDeviceCaps constants for DPI
    const LOGPIXELSX: i32 = 88;

    #[link(name = "user32")]
    extern "system" {
        fn GetSystemMetrics(n_index: i32) -> i32;
        fn GetDC(h_wnd: HWND) -> HDC;
        fn ReleaseDC(h_wnd: HWND, h_dc: HDC) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn GetDeviceCaps(hdc: HDC, index: i32) -> i32;
        fn CreateCompatibleDC(h_dc: HDC) -> HDC;
        fn CreateCompatibleBitmap(h_dc: HDC, cx: i32, cy: i32) -> HBITMAP;
        fn SelectObject(h_dc: HDC, h: HGDIOBJ) -> HGDIOBJ;
        fn BitBlt(
            hdc: HDC,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            hdc_src: HDC,
            x1: i32,
            y1: i32,
            rop: u32,
        ) -> BOOL;
        fn GetDIBits(
            hdc: HDC,
            hbm: HBITMAP,
            start: u32,
            c_lines: u32,
            lpv_bits: *mut u8,
            lpbmi: *mut BITMAPINFO,
            usage: u32,
        ) -> i32;
        fn DeleteDC(hdc: HDC) -> BOOL;
        fn DeleteObject(ho: HGDIOBJ) -> BOOL;
    }

    unsafe {
        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return Err("GetDC failed".to_string());
        }

        // Query virtual screen metrics to cover multi-monitor setups
        let mut vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let mut vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let mut width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let mut height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        // Fallback to primary screen metrics if virtual screen is unavailable
        if width <= 0 || height <= 0 {
            vx = 0;
            vy = 0;
            width = GetSystemMetrics(SM_CXSCREEN);
            height = GetSystemMetrics(SM_CYSCREEN);
        }

        // Detect DPI scale factor from screen DC
        let dpi = GetDeviceCaps(screen_dc, LOGPIXELSX);
        let scale_factor = (dpi as f64) / 96.0;

        if width <= 0 || height <= 0 {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("Failed to query screen metrics".to_string());
        }

        let w = width as u32;
        let h = height as u32;

        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleDC failed".to_string());
        }

        let h_bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if h_bitmap.is_null() {
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleBitmap failed".to_string());
        }

        let old_obj = SelectObject(mem_dc, h_bitmap);
        BitBlt(mem_dc, 0, 0, width, height, screen_dc, vx, vy, SRCCOPY);

        let mut bmi = BITMAPINFO {
            bmi_header: BITMAPINFOHEADER {
                bi_size: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                bi_width: width,
                bi_height: -height, // top-down
                bi_planes: 1,
                bi_bit_count: 32,
                bi_compression: 0,
                bi_size_image: w * h * 4,
                bi_x_pels_per_meter: 0,
                bi_y_pels_per_meter: 0,
                bi_clr_used: 0,
                bi_clr_important: 0,
            },
            bmi_colors: [0],
        };

        let pixel_bytes_len = (w * h * 4) as usize;
        let file_size = 54 + pixel_bytes_len;
        let mut bmp_data = vec![0u8; file_size];

        // BMP File Header (14 bytes)
        bmp_data[0] = b'B';
        bmp_data[1] = b'M';
        bmp_data[2..6].copy_from_slice(&(file_size as u32).to_le_bytes());
        bmp_data[10..14].copy_from_slice(&54u32.to_le_bytes());

        // DIB Header (40 bytes)
        bmp_data[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp_data[18..22].copy_from_slice(&width.to_le_bytes());
        bmp_data[22..26].copy_from_slice(&(-height).to_le_bytes());
        bmp_data[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp_data[28..30].copy_from_slice(&32u16.to_le_bytes());
        bmp_data[34..38].copy_from_slice(&(pixel_bytes_len as u32).to_le_bytes());

        GetDIBits(
            mem_dc,
            h_bitmap,
            0,
            h,
            bmp_data[54..].as_mut_ptr(),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(mem_dc, old_obj);
        DeleteObject(h_bitmap);
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);

        // Store raw BMP data (including header) globally with scale factor.
        // 不再编码 base64 data URL：唯一 IPC 消费方 cmd_begin_capture 会把它置空，
        // 而整屏 BMP 的 base64 编码每次热键要多花几十 ms 与 ~11MB 临时字符串。
        set_latest_capture(bmp_data, w, h, scale_factor);

        Ok(ScreenCapturePayload {
            data_url: String::new(),
            width: w,
            height: h,
            scale_factor,
            detected_app: None,
        })
    }
}

#[cfg(target_os = "windows")]
#[allow(non_camel_case_types, clippy::upper_case_acronyms)]
pub fn capture_region_bmp(rect: PhysicalRect) -> Result<(Vec<u8>, u32, u32, f64), String> {
    type HDC = *mut std::ffi::c_void;
    type HBITMAP = *mut std::ffi::c_void;
    type HGDIOBJ = *mut std::ffi::c_void;
    type HWND = *mut std::ffi::c_void;
    type BOOL = i32;

    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[repr(C)]
    struct BITMAPINFO {
        bmi_header: BITMAPINFOHEADER,
        bmi_colors: [u32; 1],
    }

    const SRCCOPY: u32 = 0x00CC0020;
    const DIB_RGB_COLORS: u32 = 0;
    const LOGPIXELSX: i32 = 88;

    #[link(name = "user32")]
    extern "system" {
        fn GetDC(h_wnd: HWND) -> HDC;
        fn ReleaseDC(h_wnd: HWND, h_dc: HDC) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn GetDeviceCaps(hdc: HDC, index: i32) -> i32;
        fn CreateCompatibleDC(h_dc: HDC) -> HDC;
        fn CreateCompatibleBitmap(h_dc: HDC, cx: i32, cy: i32) -> HBITMAP;
        fn SelectObject(h_dc: HDC, h: HGDIOBJ) -> HGDIOBJ;
        fn BitBlt(
            hdc: HDC,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            hdc_src: HDC,
            x1: i32,
            y1: i32,
            rop: u32,
        ) -> BOOL;
        fn GetDIBits(
            hdc: HDC,
            hbm: HBITMAP,
            start: u32,
            c_lines: u32,
            lpv_bits: *mut u8,
            lpbmi: *mut BITMAPINFO,
            usage: u32,
        ) -> i32;
        fn DeleteDC(hdc: HDC) -> BOOL;
        fn DeleteObject(ho: HGDIOBJ) -> BOOL;
    }

    unsafe {
        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return Err("GetDC failed".to_string());
        }

        let dpi = GetDeviceCaps(screen_dc, LOGPIXELSX);
        let scale_factor = (dpi as f64) / 96.0;

        let rx = rect.x.max(0);
        let ry = rect.y.max(0);
        let rw = rect.width.max(1) as i32;
        let rh = rect.height.max(1) as i32;

        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleDC failed".to_string());
        }

        let h_bitmap = CreateCompatibleBitmap(screen_dc, rw, rh);
        if h_bitmap.is_null() {
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleBitmap failed".to_string());
        }

        let old_obj = SelectObject(mem_dc, h_bitmap);
        BitBlt(mem_dc, 0, 0, rw, rh, screen_dc, rx, ry, SRCCOPY);

        let w = rw as u32;
        let h = rh as u32;

        let mut bmi = BITMAPINFO {
            bmi_header: BITMAPINFOHEADER {
                bi_size: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                bi_width: rw,
                bi_height: -rh, // top-down
                bi_planes: 1,
                bi_bit_count: 32,
                bi_compression: 0,
                bi_size_image: w * h * 4,
                bi_x_pels_per_meter: 0,
                bi_y_pels_per_meter: 0,
                bi_clr_used: 0,
                bi_clr_important: 0,
            },
            bmi_colors: [0],
        };

        let pixel_bytes_len = (w * h * 4) as usize;
        let file_size = 54 + pixel_bytes_len;
        let mut bmp_data = vec![0u8; file_size];

        bmp_data[0] = b'B';
        bmp_data[1] = b'M';
        bmp_data[2..6].copy_from_slice(&(file_size as u32).to_le_bytes());
        bmp_data[10..14].copy_from_slice(&54u32.to_le_bytes());

        bmp_data[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp_data[18..22].copy_from_slice(&rw.to_le_bytes());
        bmp_data[22..26].copy_from_slice(&(-rh).to_le_bytes());
        bmp_data[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp_data[28..30].copy_from_slice(&32u16.to_le_bytes());
        bmp_data[34..38].copy_from_slice(&(pixel_bytes_len as u32).to_le_bytes());

        GetDIBits(
            mem_dc,
            h_bitmap,
            0,
            h,
            bmp_data[54..].as_mut_ptr(),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(mem_dc, old_obj);
        DeleteObject(h_bitmap);
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);

        Ok((bmp_data, w, h, scale_factor))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_desktop_payload() -> Result<ScreenCapturePayload, String> {
    Err("Screen capture only supported on Windows".to_string())
}

/// Dimensions + scale of the stored full-desktop BMP (without cloning pixels).
pub fn latest_capture_dims() -> Option<(u32, u32, f64)> {
    LATEST_CAPTURE
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|c| (c.1, c.2, c.3)))
}

/// Region-watch support: re-read a physical rect of the LIVE screen into the
/// stored full-desktop BMP without hiding/showing the overlay window (the old
/// hide → capture → show dance caused a visible flash every tick).
///
/// The overlay window is made fully transparent (WS_EX_LAYERED + alpha 0) for
/// the duration of one BitBlt so we never capture our own translated cards.
/// If anything fails the caller can fall back to the legacy refresh path.
#[cfg(target_os = "windows")]
pub fn refresh_capture_region_quietly(hwnd_raw: isize, rect: PhysicalRect) -> Result<(), String> {
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA,
        WS_EX_LAYERED,
    };

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmFlush() -> i32;
    }

    let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let had_layered = (ex_style & WS_EX_LAYERED.0 as isize) != 0;
        if !had_layered {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED.0 as isize);
        }
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 0, LWA_ALPHA);
        // Give the compositor a frame or two to apply the alpha before BitBlt
        let _ = DwmFlush();
        let _ = DwmFlush();

        let result = (|| -> Result<(), String> {
            let (region_bmp, rw, rh, _sf) = capture_region_bmp(rect)?;
            let (mut full_bmp, bmp_w, bmp_h, stored_scale) = get_latest_capture()
                .ok_or_else(|| "No desktop capture available in memory".to_string())?;

            let rx = (rect.x.max(0) as u32).min(bmp_w);
            let ry = (rect.y.max(0) as u32).min(bmp_h);
            let copy_w = rw.min(bmp_w.saturating_sub(rx));

            // Patch rows in place — both BMPs are top-down 32bpp with a 54-byte header
            for row in 0..rh {
                if ry + row >= bmp_h {
                    break;
                }
                let src_start = 54usize + ((row * rw) as usize) * 4;
                let src_end = src_start + (copy_w as usize) * 4;
                let dst_start =
                    54usize + ((((ry + row) * bmp_w) + rx) as usize) * 4;
                let dst_end = dst_start + (copy_w as usize) * 4;
                if src_end <= region_bmp.len() && dst_end <= full_bmp.len() {
                    full_bmp[dst_start..dst_end].copy_from_slice(&region_bmp[src_start..src_end]);
                }
            }

            set_latest_capture(full_bmp, bmp_w, bmp_h, stored_scale);
            Ok(())
        })();

        // Restore visibility no matter what happened above
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        if !had_layered {
            let s2 = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, s2 & !(WS_EX_LAYERED.0 as isize));
        }
        let _ = DwmFlush();
        result
    }
}

#[cfg(not(target_os = "windows"))]
pub fn refresh_capture_region_quietly(_hwnd_raw: isize, _rect: PhysicalRect) -> Result<(), String> {
    Err("Quiet region refresh only supported on Windows".to_string())
}
