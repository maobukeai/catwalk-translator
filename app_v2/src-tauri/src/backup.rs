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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub name: String,
    pub size_bytes: u64,
    pub created_at_ms: u64,
    /// "auto" | "manual"
    pub source: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub schema_version: u32,
    pub app_version: String,
    pub created_at: String,
    pub created_at_ms: u64,
    pub source: String,
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

/// 从内存态构建备份 zip 字节（不落盘）。返回 (zip 字节, 清单)。
pub fn build_backup_zip_bytes(
    settings: &AppSettings,
    history: &[HistoryItem],
    sessions: &[CaptureSession],
    source: &str,
) -> Result<(Vec<u8>, BackupManifest), String> {
    let (y, mo, d, h, mi, s) = local_datetime_now();
    let manifest = BackupManifest {
        schema_version: SCHEMA_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}"),
        created_at_ms: now_ms(),
        source: source.to_string(),
    };

    let settings_json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化 settings 失败：{e}"))?;
    let history_json = serde_json::to_string_pretty(history)
        .map_err(|e| format!("序列化 history 失败：{e}"))?;
    let sessions_json = serde_json::to_string_pretty(sessions)
        .map_err(|e| format!("序列化 capture_sessions 失败：{e}"))?;
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("序列化 manifest 失败：{e}"))?;

    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for (name, content) in [
        ("manifest.json", manifest_json),
        ("settings.json", settings_json),
        ("history.json", history_json),
        ("capture_sessions.json", sessions_json),
    ] {
        writer
            .start_file(name, options)
            .map_err(|e| format!("写入 zip 条目 {name} 失败：{e}"))?;
        writer
            .write_all(content.as_bytes())
            .map_err(|e| format!("写入 zip 内容 {name} 失败：{e}"))?;
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
    build_backup_zip_bytes(&settings, &history, &sessions, source)
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
        let (source, created_ms) = fs::read(item.path())
            .ok()
            .and_then(|bytes| read_zip_file(&bytes, "manifest.json"))
            .and_then(|m| serde_json::from_slice::<BackupManifest>(&m).ok())
            .map(|m| (m.source, m.created_at_ms))
            .unwrap_or_else(|| ("manual".to_string(), modified_ms));
        entries.push(BackupEntry {
            name: file_name,
            size_bytes: meta.len(),
            created_at_ms: created_ms.max(modified_ms),
            source,
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

    let settings: AppSettings = read_zip_file(&bytes, "settings.json")
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| "备份包中的 settings.json 缺失或损坏".to_string())?;
    let history: Vec<HistoryItem> = read_zip_file(&bytes, "history.json")
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let sessions: Vec<CaptureSession> = read_zip_file(&bytes, "capture_sessions.json")
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();

    let state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "应用状态不可用".to_string())?;

    // 恢复前对当前数据做安全备份（失败不阻断恢复）
    let safety_backup_name = create_backup(app_handle, "manual")
        .map(|e| e.name)
        .unwrap_or_default();

    // WebDAV 应用密码「留空保持不变」语义：备份里为空则沿用当前密码
    let mut settings = settings;
    {
        let current = state
            .settings
            .lock()
            .map_err(|e| format!("锁定 settings 失败：{e}"))?;
        let restored_empty = settings
            .webdav_config
            .as_ref()
            .and_then(|c| c.password.as_deref())
            .map(str::is_empty)
            .unwrap_or(true);
        if restored_empty {
            if let (Some(cur_cfg), Some(new_cfg)) =
                (current.webdav_config.as_ref(), settings.webdav_config.as_mut())
            {
                new_cfg.password = cur_cfg.password.clone();
            }
        }
        // 安全备份就是最新一次备份，恢复后保持该时间戳
        if !safety_backup_name.is_empty() {
            let bs = settings
                .backup_settings
                .get_or_insert_with(BackupSettings::default);
            bs.last_backup_at_ms = Some(now_ms());
        }
    }

    // 覆盖内存态并立即落盘
    *state
        .settings
        .lock()
        .map_err(|e| format!("锁定 settings 失败：{e}"))? = settings.clone();
    *state
        .history
        .lock()
        .map_err(|e| format!("锁定 history 失败：{e}"))? = history.clone();
    *state
        .capture_sessions
        .lock()
        .map_err(|e| format!("锁定 capture_sessions 失败：{e}"))? = sessions.clone();
    commands::save_settings_file(app_handle, &settings);
    commands::save_history_file(app_handle, &history);
    commands::save_capture_sessions_file(app_handle, &sessions);

    // 复用设置保存副作用：重注册全局快捷键 / DWM 模糊 / 剪贴板监听
    commands::apply_settings_side_effects(app_handle, window, &settings);

    let summary = RestoreSummary {
        app_version: manifest.app_version,
        created_at: manifest.created_at,
        history_count: history.len(),
        capture_session_count: sessions.len(),
    };
    let _ = app_handle.emit(
        "app:settings-restored",
        serde_json::json!({
            "appVersion": summary.app_version,
            "createdAt": summary.created_at,
            "historyCount": summary.history_count,
            "captureSessionCount": summary.capture_session_count,
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
