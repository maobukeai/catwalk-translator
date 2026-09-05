// 本地备份模块：将 settings.json / history.json / capture_sessions.json 打包为
// zip 备份（含 manifest.json 清单），支持手动/自动备份、按份数淘汰、恢复、
// 导出（base64）与导入。恢复统一走 `restore_from_bytes`，复用设置保存的副作用
// （全局快捷键重注册、DWM 模糊、剪贴板监听），并向前端广播刷新事件。
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

use crate::commands::{self, AppState};
use crate::models::{AppSettings, BackupSettings, CaptureSession, HistoryItem, WebdavConfig};

pub const BACKUP_FILE_PREFIX: &str = "maobu_backup_";
const SCHEMA_VERSION: u32 = 1;

pub const ITEM_SETTINGS: &str = "settings";
pub const ITEM_API_KEYS: &str = "api_keys";
pub const ITEM_CUSTOM_DICT: &str = "custom_dict";
pub const ITEM_HISTORY: &str = "history";
pub const ITEM_CAPTURE_SESSIONS: &str = "capture_sessions";

pub fn all_backup_items() -> Vec<String> {
    vec![
        ITEM_SETTINGS.to_string(),
        ITEM_API_KEYS.to_string(),
        ITEM_CUSTOM_DICT.to_string(),
        ITEM_HISTORY.to_string(),
        ITEM_CAPTURE_SESSIONS.to_string(),
    ]
}

pub fn normalize_included_items(items: Option<&[String]>) -> Vec<String> {
    match items {
        Some(list) if !list.is_empty() => list.to_vec(),
        _ => all_backup_items(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub name: String,
    pub size_bytes: u64,
    pub created_at_ms: u64,
    /// "auto" | "manual"
    pub source: String,
    #[serde(default)]
    pub included_items: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    /// 备份生成时的应用版本
    pub app_version: String,
    /// 备份生成时间（本地时间字符串，用于前端确认弹窗展示）
    pub created_at: String,
    pub history_count: usize,
    pub capture_session_count: usize,
    #[serde(default)]
    pub restored_items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub schema_version: u32,
    pub app_version: String,
    pub created_at: String,
    pub created_at_ms: u64,
    pub source: String,
    #[serde(default)]
    pub included_items: Vec<String>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Howard Hinnant 的 civil 算法：自 1970-01-01 的天数 → (年, 月, 日)。
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// civil_from_days 的逆运算：(年, 月, 日) → 天数。
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// 当前本地时间 (年, 月, 日, 时, 分, 秒)。Windows 走 GetLocalTime，
/// 其余平台退化为 UTC（本项目实际只发 Windows）。
fn local_datetime_now() -> (i64, u32, u32, u32, u32, u32) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        unsafe {
            let st = GetLocalTime();
            (
                st.wYear as i64,
                st.wMonth as u32,
                st.wDay as u32,
                st.wHour as u32,
                st.wMinute as u32,
                st.wSecond as u32,
            )
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let days = secs.div_euclid(86_400);
        let sod = secs.rem_euclid(86_400);
        let (y, m, d) = civil_from_days(days);
        (
            y,
            m,
            d,
            (sod / 3600) as u32,
            ((sod % 3600) / 60) as u32,
            (sod % 60) as u32,
        )
    }
}

/// 备份文件名：maobu_backup_YYYYMMDD_HHMMSS.zip（文件名字典序即时间序）。
pub fn backup_timestamp_string() -> String {
    let (y, mo, d, h, mi, s) = local_datetime_now();
    format!("{y:04}{mo:02}{d:02}_{h:02}{mi:02}{s:02}")
}

pub fn backup_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let dir = commands::get_app_config_dir(app_handle).join("backups");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 校验备份文件名，防止路径穿越（只允许 backups 目录内的直接文件名）。
pub fn sanitize_backup_name(name: &str) -> Result<String, String> {
    if name.contains('\\')
        || name.contains('/')
        || name.contains("..")
        || !name.starts_with(BACKUP_FILE_PREFIX)
        || !name.ends_with(".zip")
    {
        return Err(format!("非法的备份文件名：{name}"));
    }
    Ok(name.to_string())
}

/// 根据勾选项清洗设置（脱敏 API 密钥、过滤词库或基础设置）。
pub fn sanitize_settings_for_backup(
    settings: &AppSettings,
    included_items: &[String],
) -> AppSettings {
    let mut s = settings.clone();
    let has_keys = included_items.iter().any(|i| i == ITEM_API_KEYS);
    let has_dict = included_items.iter().any(|i| i == ITEM_CUSTOM_DICT);
    let has_settings = included_items.iter().any(|i| i == ITEM_SETTINGS);

    if !has_keys {
        s.baidu_app_id = None;
        s.baidu_secret = None;
        s.baidu_llm_api_key = None;
        s.deepl_api_key = None;
        s.deepl_custom_url = None;
        if let Some(ref mut llm) = s.llm_config {
            llm.api_key = String::new();
        }
        for item in s.llm_configs.iter_mut() {
            item.api_key = String::new();
        }
        if let Some(ref mut wd) = s.webdav_config {
            wd.password = None;
        }
    }

    if !has_dict {
        s.custom_dict_items = Vec::new();
        s.ocr_filter_rules = None;
    }

    if !has_settings {
        s.appearance = None;
        s.always_on_top = None;
        s.close_action = None;
        s.mini_window_close_action = None;
        s.proxy_enabled = None;
        s.proxy_url = None;
        s.tts_rate = None;
        s.clipboard_watch_enabled = None;
        s.selection_lookup_enabled = None;
        s.hover_lookup_enabled = None;
        s.hover_lookup_modifier = None;
    }

    s
}

/// 从内存态构建备份 zip 字节（不落盘）。返回 (zip 字节, 清单)。
pub fn build_backup_zip_bytes(
    settings: &AppSettings,
    history: &[HistoryItem],
    sessions: &[CaptureSession],
    source: &str,
    included_items: Option<&[String]>,
) -> Result<(Vec<u8>, BackupManifest), String> {
    let items = normalize_included_items(included_items);
    let (y, mo, d, h, mi, s) = local_datetime_now();
    let manifest = BackupManifest {
        schema_version: SCHEMA_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}"),
        created_at_ms: now_ms(),
        source: source.to_string(),
        included_items: items.clone(),
    };

    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 1. manifest.json 永远写入
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("序列化 manifest 失败：{e}"))?;
    writer
        .start_file("manifest.json", options)
        .map_err(|e| format!("写入 zip 条目 manifest.json 失败：{e}"))?;
    writer
        .write_all(manifest_json.as_bytes())
        .map_err(|e| format!("写入 zip 内容 manifest.json 失败：{e}"))?;

    // 2. settings.json：只要包含 settings / api_keys / custom_dict 任一项就写入
    let need_settings_json = items
        .iter()
        .any(|i| i == ITEM_SETTINGS || i == ITEM_API_KEYS || i == ITEM_CUSTOM_DICT);
    if need_settings_json {
        let clean_settings = sanitize_settings_for_backup(settings, &items);
        let settings_json = serde_json::to_string_pretty(&clean_settings)
            .map_err(|e| format!("序列化 settings 失败：{e}"))?;
        writer
            .start_file("settings.json", options)
            .map_err(|e| format!("写入 zip 条目 settings.json 失败：{e}"))?;
        writer
            .write_all(settings_json.as_bytes())
            .map_err(|e| format!("写入 zip 内容 settings.json 失败：{e}"))?;
    }

    // 3. history.json
    if items.iter().any(|i| i == ITEM_HISTORY) {
        let history_json = serde_json::to_string_pretty(history)
            .map_err(|e| format!("序列化 history 失败：{e}"))?;
        writer
            .start_file("history.json", options)
            .map_err(|e| format!("写入 zip 条目 history.json 失败：{e}"))?;
        writer
            .write_all(history_json.as_bytes())
            .map_err(|e| format!("写入 zip 内容 history.json 失败：{e}"))?;
    }

    // 4. capture_sessions.json
    if items.iter().any(|i| i == ITEM_CAPTURE_SESSIONS) {
        let sessions_json = serde_json::to_string_pretty(sessions)
            .map_err(|e| format!("序列化 capture_sessions 失败：{e}"))?;
        writer
            .start_file("capture_sessions.json", options)
            .map_err(|e| format!("写入 zip 条目 capture_sessions.json 失败：{e}"))?;
        writer
            .write_all(sessions_json.as_bytes())
            .map_err(|e| format!("写入 zip 内容 capture_sessions.json 失败：{e}"))?;
    }

    let cursor = writer
        .finish()
        .map_err(|e| format!("封装 zip 失败：{e}"))?;
    Ok((cursor.into_inner(), manifest))
}

/// 读取当前内存态并构建备份 zip 字节（用于导出与 WebDAV 上传，不写入本地备份列表）。
pub fn build_current_zip_bytes(
    app_handle: &tauri::AppHandle,
    source: &str,
) -> Result<(Vec<u8>, BackupManifest), String> {
    let state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "应用状态不可用".to_string())?;
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁定 settings 失败：{e}"))?
        .clone();
    let history = state
        .history
        .lock()
        .map_err(|e| format!("锁定 history 失败：{e}"))?
        .clone();
    let sessions = state
        .capture_sessions
        .lock()
        .map_err(|e| format!("锁定 capture_sessions 失败：{e}"))?
        .clone();

    let included_items = settings
        .backup_settings
        .as_ref()
        .and_then(|bs| bs.included_items.as_deref());

    build_backup_zip_bytes(&settings, &history, &sessions, source, included_items)
}

/// 创建一份本地备份：写 zip 到 backups 目录 + 更新 lastBackupAtMs + 按份数淘汰。
pub fn create_backup(app_handle: &tauri::AppHandle, source: &str) -> Result<BackupEntry, String> {
    let (bytes, manifest) = build_current_zip_bytes(app_handle, source)?;
    let dir = backup_dir(app_handle);

    // 同秒内多次备份时追加序号，避免覆盖
    let ts = backup_timestamp_string();
    let mut name = format!("{}{}.zip", BACKUP_FILE_PREFIX, ts);
    let mut path = dir.join(&name);
    let mut counter = 1u32;
    while path.exists() {
        name = format!("{}{}_{}.zip", BACKUP_FILE_PREFIX, ts, counter);
        path = dir.join(&name);
        counter += 1;
    }

    fs::write(&path, &bytes).map_err(|e| format!("写入备份文件失败：{e}"))?;
    let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(bytes.len() as u64);
    let entry = BackupEntry {
        name,
        size_bytes,
        created_at_ms: manifest.created_at_ms,
        source: manifest.source,
        included_items: manifest.included_items,
    };

    // 更新 lastBackupAtMs（clone 出来的 settings 只用于读取保留策略）
    let max_local = {
        let state = app_handle
            .try_state::<AppState>()
            .ok_or_else(|| "应用状态不可用".to_string())?;
        let mut settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁定 settings 失败：{e}"))?;
        let bs = settings
            .backup_settings
            .get_or_insert_with(BackupSettings::default);
        bs.last_backup_at_ms = Some(entry.created_at_ms);
        let max = bs.max_local_backups.unwrap_or(10);
        commands::save_settings_file(app_handle, &settings);
        max
    };
    enforce_local_retention(app_handle, max_local);

    Ok(entry)
}

/// 按文件名排序淘汰最旧的本地备份（max = 0 表示不限制）。
fn enforce_local_retention(app_handle: &tauri::AppHandle, max: u32) {
    if max == 0 {
        return;
    }
    let mut entries = list_backups_internal(app_handle);
    // list 已按名字倒序（新→旧），保留前 max 份
    if entries.len() > max as usize {
        entries.drain(..max as usize);
        for entry in entries {
            let path = backup_dir(app_handle).join(&entry.name);
            let _ = fs::remove_file(path);
        }
    }
}

fn read_zip_file(bytes: &[u8], name: &str) -> Option<Vec<u8>> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).ok()?;
    let mut file = archive.by_name(name).ok()?;
    let mut out = Vec::new();
    file.read_to_end(&mut out).ok()?;
    Some(out)
}

/// 列出本地备份（按时间新→旧排序）。读取每个 zip 的 manifest 获取来源标签，
/// 解析失败时回退到文件系统元数据。
pub fn list_backups_internal(app_handle: &tauri::AppHandle) -> Vec<BackupEntry> {
    let dir = backup_dir(app_handle);
    let mut entries: Vec<BackupEntry> = Vec::new();
    let Ok(read_dir) = fs::read_dir(&dir) else {
        return entries;
    };
    for item in read_dir.flatten() {
        let file_name = item.file_name().to_string_lossy().to_string();
        if !file_name.starts_with(BACKUP_FILE_PREFIX) || !file_name.ends_with(".zip") {
            continue;
        }
        let Ok(meta) = item.metadata() else { continue };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let (source, created_ms, included_items) = fs::read(item.path())
            .ok()
            .and_then(|bytes| read_zip_file(&bytes, "manifest.json"))
            .and_then(|m| serde_json::from_slice::<BackupManifest>(&m).ok())
            .map(|m| (m.source, m.created_at_ms, m.included_items))
            .unwrap_or_else(|| ("manual".to_string(), modified_ms, all_backup_items()));

        let included = if included_items.is_empty() {
            all_backup_items()
        } else {
            included_items
        };

        entries.push(BackupEntry {
            name: file_name,
            size_bytes: meta.len(),
            created_at_ms: created_ms.max(modified_ms),
            source,
            included_items: included,
        });
    }
    entries.sort_by(|a, b| b.name.cmp(&a.name));
    entries
}

/// 统一恢复管线：校验 zip → 覆盖内存态与磁盘 → 应用设置副作用 → 广播刷新事件。
/// 恢复前会先对当前数据做一次安全备份（best effort）。
pub fn restore_from_bytes(
    app_handle: &tauri::AppHandle,
    window: Option<&tauri::WebviewWindow>,
    bytes: Vec<u8>,
) -> Result<RestoreSummary, String> {
    let manifest_bytes = read_zip_file(&bytes, "manifest.json")
        .ok_or_else(|| "备份包缺少 manifest.json，不是有效的猫步翻译备份".to_string())?;
    let manifest: BackupManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("解析备份清单失败：{e}"))?;
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "备份版本（v{}）与当前应用不兼容",
            manifest.schema_version
        ));
    }

    let state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "应用状态不可用".to_string())?;

    // 恢复前对当前数据做全量安全备份（包含当前全部数据）
    let safety_backup_name = create_backup(app_handle, "manual")
        .map(|e| e.name)
        .unwrap_or_default();

    // 读取 zip 内部各文件
    let zip_settings_opt: Option<AppSettings> = read_zip_file(&bytes, "settings.json")
        .and_then(|b| serde_json::from_slice(&b).ok());
    let zip_history_opt: Option<Vec<HistoryItem>> = read_zip_file(&bytes, "history.json")
        .and_then(|b| serde_json::from_slice(&b).ok());
    let zip_sessions_opt: Option<Vec<CaptureSession>> =
        read_zip_file(&bytes, "capture_sessions.json")
            .and_then(|b| serde_json::from_slice(&b).ok());

    let included_items = if !manifest.included_items.is_empty() {
        manifest.included_items.clone()
    } else {
        // 旧版本兼容推断
        let mut inferred = Vec::new();
        if zip_settings_opt.is_some() {
            inferred.push(ITEM_SETTINGS.to_string());
            inferred.push(ITEM_API_KEYS.to_string());
            inferred.push(ITEM_CUSTOM_DICT.to_string());
        }
        if zip_history_opt.is_some() {
            inferred.push(ITEM_HISTORY.to_string());
        }
        if zip_sessions_opt.is_some() {
            inferred.push(ITEM_CAPTURE_SESSIONS.to_string());
        }
        inferred
    };

    let mut restored_items = Vec::new();
    let mut final_history_count = 0usize;
    let mut final_session_count = 0usize;

    // 1. 合并 history
    if included_items.iter().any(|i| i == ITEM_HISTORY) {
        if let Some(hist) = zip_history_opt {
            final_history_count = hist.len();
            *state
                .history
                .lock()
                .map_err(|e| format!("锁定 history 失败：{e}"))? = hist.clone();
            commands::save_history_file(app_handle, &hist);
            restored_items.push(ITEM_HISTORY.to_string());
        }
    } else {
        final_history_count = state.history.lock().map(|h| h.len()).unwrap_or(0);
    }

    // 2. 合并 capture_sessions
    if included_items.iter().any(|i| i == ITEM_CAPTURE_SESSIONS) {
        if let Some(sess) = zip_sessions_opt {
            final_session_count = sess.len();
            *state
                .capture_sessions
                .lock()
                .map_err(|e| format!("锁定 capture_sessions 失败：{e}"))? = sess.clone();
            commands::save_capture_sessions_file(app_handle, &sess);
            restored_items.push(ITEM_CAPTURE_SESSIONS.to_string());
        }
    } else {
        final_session_count = state.capture_sessions.lock().map(|s| s.len()).unwrap_or(0);
    }

    // 3. 合并 settings
    if let Some(zip_settings) = zip_settings_opt {
        let mut current_settings = state
            .settings
            .lock()
            .map_err(|e| format!("锁定 settings 失败：{e}"))?
            .clone();

        // (a) 基础通用设置
        if included_items.iter().any(|i| i == ITEM_SETTINGS) {
            current_settings.theme = zip_settings.theme;
            current_settings.hotkey = zip_settings.hotkey;
            current_settings.spotlight_hotkey = zip_settings.spotlight_hotkey;
            current_settings.clipboard_hotkey = zip_settings.clipboard_hotkey;
            current_settings.toggle_window_hotkey = zip_settings.toggle_window_hotkey;
            current_settings.quick_window_hotkey = zip_settings.quick_window_hotkey;
            current_settings.capture_hotkey_enabled = zip_settings.capture_hotkey_enabled;
            current_settings.spotlight_hotkey_enabled = zip_settings.spotlight_hotkey_enabled;
            current_settings.clipboard_hotkey_enabled = zip_settings.clipboard_hotkey_enabled;
            current_settings.toggle_window_hotkey_enabled = zip_settings.toggle_window_hotkey_enabled;
            current_settings.quick_window_hotkey_enabled = zip_settings.quick_window_hotkey_enabled;
            current_settings.default_preset = zip_settings.default_preset;
            current_settings.translation_tiers = zip_settings.translation_tiers;
            current_settings.preset_dicts = zip_settings.preset_dicts;
            current_settings.online_engines = zip_settings.online_engines;
            if zip_settings.appearance.is_some() {
                current_settings.appearance = zip_settings.appearance;
            }
            if zip_settings.capture_engine.is_some() {
                current_settings.capture_engine = zip_settings.capture_engine;
            }
            if zip_settings.overlay_view_mode.is_some() {
                current_settings.overlay_view_mode = zip_settings.overlay_view_mode;
            }
            if zip_settings.enable_aabb_avoidance.is_some() {
                current_settings.enable_aabb_avoidance = zip_settings.enable_aabb_avoidance;
            }
            if zip_settings.translation_style.is_some() {
                current_settings.translation_style = zip_settings.translation_style;
            }
            if zip_settings.sidebar_collapsed.is_some() {
                current_settings.sidebar_collapsed = zip_settings.sidebar_collapsed;
            }
            if zip_settings.capture_release_action.is_some() {
                current_settings.capture_release_action = zip_settings.capture_release_action;
            }
            if zip_settings.watch_interval_ms.is_some() {
                current_settings.watch_interval_ms = zip_settings.watch_interval_ms;
            }
            if zip_settings.clipboard_watch_enabled.is_some() {
                current_settings.clipboard_watch_enabled = zip_settings.clipboard_watch_enabled;
            }
            if zip_settings.ocr_engine.is_some() {
                current_settings.ocr_engine = zip_settings.ocr_engine;
            }
            if zip_settings.ocr_version.is_some() {
                current_settings.ocr_version = zip_settings.ocr_version;
            }
            if zip_settings.primary_translation_engine.is_some() {
                current_settings.primary_translation_engine =
                    zip_settings.primary_translation_engine;
            }
            if zip_settings.close_action.is_some() {
                current_settings.close_action = zip_settings.close_action;
            }
            if zip_settings.mini_window_close_action.is_some() {
                current_settings.mini_window_close_action = zip_settings.mini_window_close_action;
            }
            if zip_settings.always_on_top.is_some() {
                current_settings.always_on_top = zip_settings.always_on_top;
            }
            if zip_settings.proxy_enabled.is_some() {
                current_settings.proxy_enabled = zip_settings.proxy_enabled;
            }
            if zip_settings.proxy_url.is_some() {
                current_settings.proxy_url = zip_settings.proxy_url;
            }
            if zip_settings.tts_rate.is_some() {
                current_settings.tts_rate = zip_settings.tts_rate;
            }
            if zip_settings.auto_detect_preset.is_some() {
                current_settings.auto_detect_preset = zip_settings.auto_detect_preset;
            }
            if zip_settings.ocr_filter_enabled.is_some() {
                current_settings.ocr_filter_enabled = zip_settings.ocr_filter_enabled;
            }
            if zip_settings.selection_lookup_enabled.is_some() {
                current_settings.selection_lookup_enabled =
                    zip_settings.selection_lookup_enabled;
            }
            if zip_settings.hover_lookup_enabled.is_some() {
                current_settings.hover_lookup_enabled = zip_settings.hover_lookup_enabled;
            }
            if zip_settings.hover_lookup_modifier.is_some() {
                current_settings.hover_lookup_modifier = zip_settings.hover_lookup_modifier;
            }
            restored_items.push(ITEM_SETTINGS.to_string());
        }

        // (b) 密钥与 AI 配置
        if included_items.iter().any(|i| i == ITEM_API_KEYS) {
            current_settings.baidu_app_id = zip_settings.baidu_app_id;
            current_settings.baidu_secret = zip_settings.baidu_secret;
            current_settings.baidu_llm_api_key = zip_settings.baidu_llm_api_key;
            current_settings.deepl_api_key = zip_settings.deepl_api_key;
            current_settings.deepl_custom_url = zip_settings.deepl_custom_url;
            current_settings.llm_config = zip_settings.llm_config;
            current_settings.llm_configs = zip_settings.llm_configs;

            // WebDAV 密码处理：若 zip 带有密码则覆盖，否则保留本地原密码
            if let Some(mut new_wd) = zip_settings.webdav_config {
                let has_new_pwd = new_wd
                    .password
                    .as_deref()
                    .map(|p| !p.trim().is_empty())
                    .unwrap_or(false);
                if !has_new_pwd {
                    if let Some(cur_wd) = &current_settings.webdav_config {
                        new_wd.password = cur_wd.password.clone();
                    }
                }
                current_settings.webdav_config = Some(new_wd);
            }
            restored_items.push(ITEM_API_KEYS.to_string());
        }

        // (c) 自定义词库与过滤规则
        if included_items.iter().any(|i| i == ITEM_CUSTOM_DICT) {
            current_settings.custom_dict_items = zip_settings.custom_dict_items;
            if zip_settings.ocr_filter_rules.is_some() {
                current_settings.ocr_filter_rules = zip_settings.ocr_filter_rules;
            }
            restored_items.push(ITEM_CUSTOM_DICT.to_string());
        }

        // 保持安全备份最新时间戳
        if !safety_backup_name.is_empty() {
            let bs = current_settings
                .backup_settings
                .get_or_insert_with(BackupSettings::default);
            bs.last_backup_at_ms = Some(now_ms());
        }

        *state
            .settings
            .lock()
            .map_err(|e| format!("锁定 settings 失败：{e}"))? = current_settings.clone();
        commands::save_settings_file(app_handle, &current_settings);
        commands::apply_settings_side_effects(app_handle, window, &current_settings);
    }

    let summary = RestoreSummary {
        app_version: manifest.app_version,
        created_at: manifest.created_at,
        history_count: final_history_count,
        capture_session_count: final_session_count,
        restored_items: restored_items.clone(),
    };
    let _ = app_handle.emit(
        "app:settings-restored",
        serde_json::json!({
            "appVersion": summary.app_version,
            "createdAt": summary.created_at,
            "historyCount": summary.history_count,
            "captureSessionCount": summary.capture_session_count,
            "restoredItems": summary.restored_items,
        }),
    );
    Ok(summary)
}

// ── 定期自动备份线程（参考 clipboard_watch 的 AtomicBool 单例模式） ──

static AUTO_BACKUP_THREAD_SPAWNED: AtomicBool = AtomicBool::new(false);

pub fn ensure_auto_backup_thread(app_handle: tauri::AppHandle) {
    if AUTO_BACKUP_THREAD_SPAWNED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        // 启动 60 秒后先检查一次（补上关机期间错过的备份），此后每 10 分钟复查
        std::thread::sleep(Duration::from_secs(60));
        loop {
            check_and_auto_backup(&app_handle);
            std::thread::sleep(Duration::from_secs(600));
        }
    });
}

fn check_and_auto_backup(app_handle: &tauri::AppHandle) {
    let state = match app_handle.try_state::<AppState>() {
        Some(s) => s,
        None => return,
    };
    let backup_cfg = state
        .settings
        .lock()
        .ok()
        .and_then(|s| s.backup_settings.clone());
    let Some(cfg) = backup_cfg else {
        return;
    };
    if !cfg.auto_backup_enabled.unwrap_or(false) {
        return;
    }
    let interval_hours = cfg.interval_hours.unwrap_or(24).max(1) as u64;
    let last = cfg.last_backup_at_ms.unwrap_or(0);
    let now = now_ms();
    if now.saturating_sub(last) >= interval_hours * 3_600_000 {
        match create_backup(app_handle, "auto") {
            Ok(entry) => eprintln!("[backup] 自动备份完成：{}", entry.name),
            Err(e) => eprintln!("[backup] 自动备份失败：{e}"),
        }
    }
}

// ── Tauri 命令 ──

#[tauri::command]
pub async fn cmd_create_backup(app_handle: tauri::AppHandle) -> Result<BackupEntry, String> {
    create_backup(&app_handle, "manual")
}

#[tauri::command]
pub async fn cmd_list_backups(app_handle: tauri::AppHandle) -> Result<Vec<BackupEntry>, String> {
    Ok(list_backups_internal(&app_handle))
}

#[tauri::command]
pub async fn cmd_delete_backup(
    app_handle: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    let name = sanitize_backup_name(&name)?;
    let path = backup_dir(&app_handle).join(&name);
    if !path.exists() {
        return Err(format!("备份不存在：{name}"));
    }
    fs::remove_file(&path).map_err(|e| format!("删除备份失败：{e}"))
}

#[tauri::command]
pub async fn cmd_restore_backup(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
) -> Result<RestoreSummary, String> {
    let name = sanitize_backup_name(&name)?;
    let path = backup_dir(&app_handle).join(&name);
    if !path.exists() {
        return Err(format!("备份不存在：{name}"));
    }
    let bytes = fs::read(&path).map_err(|e| format!("读取备份失败：{e}"))?;
    restore_from_bytes(&app_handle, Some(&window), bytes)
}

#[tauri::command]
pub async fn cmd_open_backup_dir(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = backup_dir(&app_handle);
    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开备份目录失败：{e}"))
}

/// 导出当前数据为备份 zip（base64），不写入本地备份列表。
#[tauri::command]
pub async fn cmd_export_backup_base64(app_handle: tauri::AppHandle) -> Result<String, String> {
    let (bytes, _manifest) = build_current_zip_bytes(&app_handle, "export")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// 从 base64 备份包导入并覆盖当前数据。
#[tauri::command]
pub async fn cmd_import_backup_base64(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    data: String,
) -> Result<RestoreSummary, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| format!("备份包解码失败：{e}"))?;
    if bytes.len() < 22 {
        return Err("文件内容过小，不是有效的备份包".to_string());
    }
    restore_from_bytes(&app_handle, Some(&window), bytes)
}

/// 供 webdav 模块读取当前有效 WebDAV 配置（含默认值兜底）。
pub fn effective_webdav_config(settings: &AppSettings) -> WebdavConfig {
    let mut cfg = settings.webdav_config.clone().unwrap_or_default();
    if cfg
        .remote_dir
        .as_deref()
        .map(str::trim)
        .map(str::is_empty)
        .unwrap_or(true)
    {
        cfg.remote_dir = Some("MaobuTranslator".to_string());
    }
    if cfg.retention_days.unwrap_or(0) == 0 {
        cfg.retention_days = Some(15);
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppearanceSettings, CustomDictItem, LlmConfig};

    fn sample_settings() -> AppSettings {
        AppSettings {
            theme: "dark".to_string(),
            hotkey: "Ctrl+F".to_string(),
            spotlight_hotkey: Some("Alt+Space".to_string()),
            clipboard_hotkey: None,
            toggle_window_hotkey: None,
            quick_window_hotkey: Some("Alt+W".to_string()),
            capture_hotkey_enabled: Some(true),
            spotlight_hotkey_enabled: Some(true),
            clipboard_hotkey_enabled: Some(false),
            toggle_window_hotkey_enabled: Some(false),
            quick_window_hotkey_enabled: Some(false),
            default_preset: "blender".to_string(),
            llm_config: Some(LlmConfig::new("OpenAI", "sk-secret-key-12345", "gpt-4o", "https://api.openai.com/v1")),
            llm_configs: vec![LlmConfig::new("Claude", "sk-ant-secret-67890", "claude-3-5-sonnet", "https://api.anthropic.com/v1")],
            translation_tiers: vec!["llm".to_string(), "online".to_string()],
            preset_dicts: Default::default(),
            online_engines: Default::default(),
            appearance: Some(AppearanceSettings::default()),
            capture_engine: Some("onnx".to_string()),
            overlay_view_mode: Some("panel".to_string()),
            enable_aabb_avoidance: Some(true),
            translation_style: Some("terminology".to_string()),
            sidebar_collapsed: Some(false),
            capture_release_action: Some("auto".to_string()),
            watch_interval_ms: Some(3000),
            clipboard_watch_enabled: Some(false),
            ocr_engine: Some("auto".to_string()),
            ocr_version: Some("v6".to_string()),
            primary_translation_engine: Some("llm".to_string()),
            baidu_app_id: Some("baidu_app_123".to_string()),
            baidu_secret: Some("baidu_sec_456".to_string()),
            baidu_llm_api_key: None,
            use_baidu_same_secret: Some(true),
            deepl_api_key: Some("deepl_key_789".to_string()),
            deepl_custom_url: Some("http://localhost:1188/translate".to_string()),
            volcengine_access_key: Some("volc_ak_123".to_string()),
            volcengine_secret_key: Some("volc_sk_456".to_string()),
            yandex_api_key: Some("yandex_key_789".to_string()),
            yandex_folder_id: Some("yandex_folder_000".to_string()),
            close_action: Some("ask".to_string()),
            mini_window_close_action: Some("hide".to_string()),
            always_on_top: Some(true),
            proxy_enabled: Some(false),
            proxy_url: None,
            tts_rate: Some(1.0),
            auto_detect_preset: Some(true),
            ocr_filter_enabled: Some(true),
            ocr_filter_rules: Some(vec!["^\\d+$".to_string()]),
            selection_lookup_enabled: Some(false),
            hover_lookup_enabled: Some(false),
            hover_lookup_modifier: Some("ctrl".to_string()),
            backup_settings: Some(BackupSettings::default()),
            webdav_config: Some(WebdavConfig {
                url: Some("https://dav.jianguoyun.com/dav/".to_string()),
                username: Some("user@example.com".to_string()),
                password: Some("my_secret_password".to_string()),
                remote_dir: Some("MaobuTranslator".to_string()),
                retention_days: Some(15),
                ..Default::default()
            }),
            enable_llm_progressive_refine: Some(false),
            auto_favorite_quality_terms: Some(false),
            custom_dict_items: vec![CustomDictItem {
                id: "dict-1".to_string(),
                original: "Bevel".to_string(),
                translated: "倒角".to_string(),
                category: "3D".to_string(),
                note: None,
                created_at: "2026-09-02".to_string(),
            }],
            anki_settings: Some(crate::models::AnkiSettings::default()),
        }
    }

    #[test]
    fn test_all_and_normalize_items() {
        let all = all_backup_items();
        assert_eq!(all.len(), 5);
        assert!(all.contains(&ITEM_SETTINGS.to_string()));
        assert!(all.contains(&ITEM_API_KEYS.to_string()));
        assert!(all.contains(&ITEM_CUSTOM_DICT.to_string()));
        assert!(all.contains(&ITEM_HISTORY.to_string()));
        assert!(all.contains(&ITEM_CAPTURE_SESSIONS.to_string()));

        let normalized_none = normalize_included_items(None);
        assert_eq!(normalized_none, all);

        let custom = vec![ITEM_SETTINGS.to_string(), ITEM_CUSTOM_DICT.to_string()];
        let normalized_custom = normalize_included_items(Some(&custom));
        assert_eq!(normalized_custom, custom);
    }

    #[test]
    fn test_sanitize_settings_without_api_keys() {
        let s = sample_settings();
        let items = vec![ITEM_SETTINGS.to_string(), ITEM_CUSTOM_DICT.to_string()];
        let sanitized = sanitize_settings_for_backup(&s, &items);

        // 密钥字段应当全部被清空脱敏
        assert!(sanitized.baidu_app_id.is_none());
        assert!(sanitized.baidu_secret.is_none());
        assert!(sanitized.deepl_api_key.is_none());
        assert_eq!(sanitized.llm_config.as_ref().unwrap().api_key, "");
        assert_eq!(sanitized.llm_configs[0].api_key, "");
        assert!(sanitized.webdav_config.as_ref().unwrap().password.is_none());

        // 基础设置与词库保留
        assert_eq!(sanitized.theme, "dark");
        assert_eq!(sanitized.custom_dict_items.len(), 1);
    }

    #[test]
    fn test_sanitize_settings_without_custom_dict() {
        let s = sample_settings();
        let items = vec![ITEM_SETTINGS.to_string(), ITEM_API_KEYS.to_string()];
        let sanitized = sanitize_settings_for_backup(&s, &items);

        // 词库应被清空
        assert!(sanitized.custom_dict_items.is_empty());
        assert!(sanitized.ocr_filter_rules.is_none());

        // 密钥与设置保留
        assert_eq!(sanitized.baidu_app_id.as_deref(), Some("baidu_app_123"));
        assert_eq!(sanitized.theme, "dark");
    }

    #[test]
    fn test_build_backup_zip_with_selective_items() {
        let s = sample_settings();
        let history = vec![HistoryItem {
            id: "h-1".to_string(),
            original: "hello".to_string(),
            translated: "你好".to_string(),
            source_tier: "dict".to_string(),
            timestamp: "2026-09-02".to_string(),
            is_favorite: true,
        }];
        let sessions = vec![];

        // 场景 A：仅备份设置与词库（脱敏分享）
        let items_a = vec![ITEM_SETTINGS.to_string(), ITEM_CUSTOM_DICT.to_string()];
        let (zip_bytes, manifest) = build_backup_zip_bytes(&s, &history, &sessions, "manual", Some(&items_a)).unwrap();

        assert_eq!(manifest.included_items, items_a);

        // 验证 zip 内容条目
        let cursor = std::io::Cursor::new(zip_bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        assert!(archive.by_name("manifest.json").is_ok());
        assert!(archive.by_name("settings.json").is_ok());
        // 未勾选 history，所以 zip 中不应有 history.json
        assert!(archive.by_name("history.json").is_err());
        assert!(archive.by_name("capture_sessions.json").is_err());

        // 场景 B：全量备份
        let (all_bytes, manifest_all) = build_backup_zip_bytes(&s, &history, &sessions, "manual", None).unwrap();
        assert_eq!(manifest_all.included_items.len(), 5);
        let cursor_all = std::io::Cursor::new(all_bytes);
        let mut archive_all = zip::ZipArchive::new(cursor_all).unwrap();
        assert!(archive_all.by_name("manifest.json").is_ok());
        assert!(archive_all.by_name("settings.json").is_ok());
        assert!(archive_all.by_name("history.json").is_ok());
        assert!(archive_all.by_name("capture_sessions.json").is_ok());
    }
}

