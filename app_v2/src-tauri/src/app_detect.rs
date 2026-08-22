//! 自动识别前台 3D/CG 软件并切换对应专业词库：
//! `cmd_begin_capture` 在隐藏主窗口**之前**采样前台窗口（进程名 + 窗口标题），
//! 匹配到 Blender/Maya/Houdini/Substance/Unity/Unreal 时随捕获载荷下发给前端，
//! 前端据此把本次划词的词库切换为对应软件的专业词库（可在设置中关闭）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    /// 词库 preset key（blender/maya/houdini/substance/unity/unreal）
    pub preset: String,
    /// 展示名（用于反馈 toast）
    pub app_name: String,
}

/// 匹配表：(关键字, preset, 显示名)。进程名优先精确命中，标题兜底。
const TABLE: &[(&str, &str, &str)] = &[
    ("substance", "substance", "Substance 3D"),
    ("houdini", "houdini", "Houdini"),
    ("blender", "blender", "Blender"),
    ("maya", "maya", "Maya"),
    ("unrealeditor", "unreal", "Unreal Engine"),
    ("unreal", "unreal", "Unreal Engine"),
    ("unity", "unity", "Unity"),
];

/// 纯匹配函数（可单测）：可执行文件名 + 窗口标题 → 词库 preset。
/// 输入在内部统一小写；两者任一命中即返回。
pub fn match_preset(exe: &str, title: &str) -> Option<DetectedApp> {
    let exe = exe.to_lowercase();
    let title = title.to_lowercase();

    // 进程名优先（最强信号）
    for (key, preset, name) in TABLE {
        if exe.contains(key) {
            return Some(DetectedApp {
                preset: (*preset).into(),
                app_name: (*name).into(),
            });
        }
    }
    // 标题兜底；跳过我们自己的窗口（标题含产品名而非软件关键字，天然不会命中）
    for (key, preset, name) in TABLE {
        if title.contains(key) {
            return Some(DetectedApp {
                preset: (*preset).into(),
                app_name: (*name).into(),
            });
        }
    }
    None
}

/// 采样当前前台窗口并匹配（仅 Windows；其他平台返回 None）。
#[cfg(target_os = "windows")]
pub fn detect_foreground_app() -> Option<DetectedApp> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        // 窗口标题
        let mut title_buf = [0u16; 256];
        let title_len = GetWindowTextW(hwnd, &mut title_buf).max(0) as usize;
        let title = String::from_utf16_lossy(&title_buf[..title_len.min(title_buf.len())]);

        // 进程可执行文件名
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut exe = String::new();
        if pid != 0 {
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buf = [0u16; 512];
                let mut len: u32 = buf.len() as u32;
                if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
                    .is_ok()
                {
                    let full = String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]);
                    exe = full.rsplit('\\').next().unwrap_or("").to_string();
                }
                let _ = CloseHandle(handle);
            }
        }

        match_preset(&exe, &title)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn detect_foreground_app() -> Option<DetectedApp> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_by_process_name() {
        assert_eq!(
            match_preset("blender.exe", "任意标题"),
            Some(DetectedApp { preset: "blender".into(), app_name: "Blender".into() })
        );
        assert_eq!(
            match_preset("HoudiniFX.exe", ""),
            Some(DetectedApp { preset: "houdini".into(), app_name: "Houdini".into() })
        );
        assert_eq!(
            match_preset("UnrealEditor.exe", "虚幻编辑器"),
            Some(DetectedApp { preset: "unreal".into(), app_name: "Unreal Engine".into() })
        );
        assert_eq!(
            match_preset("Adobe Substance 3D Painter.exe", ""),
            Some(DetectedApp { preset: "substance".into(), app_name: "Substance 3D".into() })
        );
    }

    #[test]
    fn matches_by_title_fallback() {
        assert_eq!(
            match_preset("explorer.exe", "Maya - untitled scene"),
            Some(DetectedApp { preset: "maya".into(), app_name: "Maya".into() })
        );
        assert_eq!(
            match_preset("chrome.exe", "Unity Hub"),
            Some(DetectedApp { preset: "unity".into(), app_name: "Unity".into() })
        );
    }

    #[test]
    fn no_match_for_unrelated_apps() {
        assert_eq!(match_preset("chrome.exe", "Google 翻译 - Chrome"), None);
        assert_eq!(match_preset("MaobuTranslator.exe", "猫步翻译"), None);
        assert_eq!(match_preset("code.exe", "main.rs - VSCode"), None);
        assert_eq!(match_preset("", ""), None);
    }
}
