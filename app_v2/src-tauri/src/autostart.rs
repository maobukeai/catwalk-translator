//! 猫步翻译 - 原生自启管理模块 (Windows Registry & Silent Background Startup)
//!
//! 核心设计目标：
//! 1. 彻底解决自启失效：在写入 Windows 注册表 Run 键时，对可执行程序路径施加标准双引号包裹转义，
//!    彻底规避路径空格或特殊字符被系统错误截断导致的自启动失败。
//! 2. 彻底支持静默后台自启动：写入标准参数 `"--autostart --minimized"`，软件随开机启动时不弹窗、
//!    不抢占前台焦点，仅在右下角任务栏托盘静默驻留，快捷键即时可用。


pub const APP_RUN_KEY_NAME: &str = "猫步翻译";
pub const LEGACY_RUN_KEY_NAME: &str = "MaobuTranslator";

#[cfg(target_os = "windows")]
const RUN_REG_PATH: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";

#[cfg(target_os = "windows")]
const STARTUP_APPROVED_PATH: &str =
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

#[cfg(target_os = "windows")]
const TASK_MGR_ENABLED_BYTES: [u8; 12] = [
    0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/// 构造标准的开机自启动命令行字符串
/// 格式: `"C:\path\to\MaobuTranslator.exe" --autostart --minimized`
pub fn build_autostart_cmd(exe_path: &str) -> String {
    let clean = exe_path.trim().trim_matches('"');
    format!("\"{}\" --autostart --minimized", clean)
}

/// 判断给定的命令行入参是否属于静默启动标记
pub fn is_silent_launch_arg(arg: &str) -> bool {
    matches!(
        arg,
        "--autostart" | "--silent" | "--minimized" | "-background" | "--from-autostart"
    )
}

/// 解析 Windows 任务管理器 StartupApproved 状态字节
/// 规则：第 1 字节最低位为 1 (如 0x01, 0x03) 表示在任务管理器中被用户手动禁用；为 0 或 0x02 表示允许
pub fn parse_task_manager_approved(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    (bytes[0] & 1) == 0
}

#[cfg(target_os = "windows")]
pub fn enable_autostart() -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::{RegKey, RegValue};

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("获取当前程序可执行文件路径失败: {e}"))?;
    let exe_str = current_exe.to_string_lossy();
    let cmd = build_autostart_cmd(&exe_str);

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(RUN_REG_PATH, KEY_SET_VALUE)
        .map_err(|e| format!("打开 Windows 启动项注册表失败: {e}"))?;

    // 写入标准键名（带双引号与参数）
    run_key
        .set_value::<_, _>(APP_RUN_KEY_NAME, &cmd)
        .map_err(|e| format!("写入自启项 [{}] 失败: {e}", APP_RUN_KEY_NAME))?;

    // 清理旧版可能残留的英文键名，避免重复
    let _ = run_key.delete_value(LEGACY_RUN_KEY_NAME);

    // 同步更新任务管理器启动项批准状态 (StartupApproved\Run) 为已启用
    if let Ok(approved_key) = hkcu.open_subkey_with_flags(STARTUP_APPROVED_PATH, KEY_SET_VALUE) {
        let _ = approved_key.set_raw_value(
            APP_RUN_KEY_NAME,
            &RegValue {
                vtype: winreg::enums::RegType::REG_BINARY,
                bytes: TASK_MGR_ENABLED_BYTES.to_vec(),
            },
        );
        let _ = approved_key.delete_value(LEGACY_RUN_KEY_NAME);
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn enable_autostart() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn disable_autostart() -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(RUN_REG_PATH, KEY_SET_VALUE)
        .map_err(|e| format!("打开 Windows 启动项注册表失败: {e}"))?;

    let res1 = run_key.delete_value(APP_RUN_KEY_NAME);
    let res2 = run_key.delete_value(LEGACY_RUN_KEY_NAME);

    // 清理任务管理器审批项
    if let Ok(approved_key) = hkcu.open_subkey_with_flags(STARTUP_APPROVED_PATH, KEY_SET_VALUE) {
        let _ = approved_key.delete_value(APP_RUN_KEY_NAME);
        let _ = approved_key.delete_value(LEGACY_RUN_KEY_NAME);
    }

    if res1.is_err() && res2.is_err() {
        // 如果都不存在，视为已经是关闭状态，不报错
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn disable_autostart() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn is_autostart_enabled() -> Result<bool, String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = match hkcu.open_subkey_with_flags(RUN_REG_PATH, KEY_READ) {
        Ok(k) => k,
        Err(_) => return Ok(false),
    };

    let val_opt = run_key
        .get_value::<String, _>(APP_RUN_KEY_NAME)
        .ok()
        .or_else(|| run_key.get_value::<String, _>(LEGACY_RUN_KEY_NAME).ok());

    let val = match val_opt {
        Some(v) => v,
        None => return Ok(false),
    };

    if val.trim().is_empty() {
        return Ok(false);
    }

    // 检查任务管理器是否被用户手动禁用
    if let Ok(approved_key) = hkcu.open_subkey_with_flags(STARTUP_APPROVED_PATH, KEY_READ) {
        if let Ok(raw) = approved_key.get_raw_value(APP_RUN_KEY_NAME) {
            if !parse_task_manager_approved(&raw.bytes) {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

#[cfg(not(target_os = "windows"))]
pub fn is_autostart_enabled() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub fn cmd_get_autostart() -> Result<bool, String> {
    is_autostart_enabled()
}

#[tauri::command]
pub fn cmd_set_autostart(enabled: bool) -> Result<(), String> {
    if enabled {
        enable_autostart()
    } else {
        disable_autostart()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_autostart_cmd_normal() {
        let path = r"C:\Program Files\Maobu Translator\MaobuTranslator.exe";
        let cmd = build_autostart_cmd(path);
        assert_eq!(
            cmd,
            r#""C:\Program Files\Maobu Translator\MaobuTranslator.exe" --autostart --minimized"#
        );
    }

    #[test]
    fn test_build_autostart_cmd_already_quoted() {
        let path = r#""C:\Users\20269\Desktop\猫步翻译.exe""#;
        let cmd = build_autostart_cmd(path);
        assert_eq!(cmd, r#""C:\Users\20269\Desktop\猫步翻译.exe" --autostart --minimized"#);
    }

    #[test]
    fn test_is_silent_launch_arg() {
        assert!(is_silent_launch_arg("--autostart"));
        assert!(is_silent_launch_arg("--minimized"));
        assert!(is_silent_launch_arg("--silent"));
        assert!(is_silent_launch_arg("-background"));
        assert!(!is_silent_launch_arg("--normal"));
        assert!(!is_silent_launch_arg(""));
    }

    #[test]
    fn test_parse_task_manager_approved() {
        // 0x02 = 启用
        assert!(parse_task_manager_approved(&[0x02, 0x00, 0x00, 0x00]));
        // 0x00 = 启用
        assert!(parse_task_manager_approved(&[0x00, 0x00]));
        // 0x03 = 任务管理器禁用 (bit 0 = 1)
        assert!(!parse_task_manager_approved(&[0x03, 0x00, 0x00, 0x00]));
        // 0x01 = 禁用
        assert!(!parse_task_manager_approved(&[0x01, 0x00]));
        // 空字节切片默认允许
        assert!(parse_task_manager_approved(&[]));
    }
}
