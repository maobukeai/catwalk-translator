// WebDAV 云同步模块：基于 reqwest 直连标准 WebDAV 服务（坚果云等），
// 支持连接测试（PROPFIND）、生成并上传（MKCOL + PUT）、远端列表
// （PROPFIND Depth:1 + XML 解析）、下载恢复（GET）与按保留天数清理（DELETE）。
// 注意：所有命令在 await 之前就把 MutexGuard 释放为 owned 数据。
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::Manager;

use crate::backup;
use crate::commands::{self, AppState};
use crate::models::WebdavConfig;

const USER_AGENT: &str = "MaobuTranslator/Backup-Sync";
const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupEntry {
    pub name: String,
    pub size_bytes: u64,
    /// 服务器返回的 HTTP 日期串（如 "Sat, 22 Aug 2026 05:12:33 GMT"），
    /// 前端用 new Date() 直接解析展示。
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavUploadResult {
    pub name: String,
    pub size_bytes: u64,
    pub deleted_old: usize,
}

struct WebdavConn {
    client: reqwest::Client,
    base_url: String,
    username: String,
    password: String,
}

/// 百分号编码 URL 路径段（保留 RFC 3986 unreserved 字符）。
fn encode_path_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for b in seg.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'(' | b')' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn join_url(base: &str, segments: &[&str]) -> String {
    let mut url = base.trim_end_matches('/').to_string();
    for seg in segments {
        for part in seg.split('/') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            url.push('/');
            url.push_str(&encode_path_segment(part));
        }
    }
    url
}

impl WebdavConn {
    fn remote_file_url(&self, remote_dir: &str, name: &str) -> String {
        join_url(&self.base_url, &[remote_dir, name])
    }

    async fn ensure_remote_dir(&self, remote_dir: &str) -> Result<(), String> {
        let method = reqwest::Method::from_bytes(b"MKCOL")
            .map_err(|e| format!("构造 MKCOL 请求失败：{e}"))?;
        let mut url = self.base_url.clone();
        for part in remote_dir.split('/') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            url = join_url(&url, &[part]);
            let resp = self
                .client
                .request(method.clone(), &url)
                .basic_auth(&self.username, Some(&self.password))
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .map_err(|e| format!("创建远端目录失败（{}）：{e}", part))?;
            let status = resp.status().as_u16();
            // 201=新建成功；405=已存在；403 在部分服务上表示已存在的集合
            if !(200..300).contains(&status) && status != 405 {
                let body = resp.text().await.unwrap_or_default();
                return Err(format!(
                    "创建远端目录 {} 失败：HTTP {} {}",
                    part,
                    status,
                    truncate(&body, 200)
                ));
            }
        }
        Ok(())
    }

    async fn propfind(&self, url: &str, depth: &str) -> Result<String, String> {
        let method = reqwest::Method::from_bytes(b"PROPFIND")
            .map_err(|e| format!("构造 PROPFIND 请求失败：{e}"))?;
        let resp = self
            .client
            .request(method, url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", depth)
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(PROPFIND_BODY.to_string())
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| webdav_network_error(e))?;
        let status = resp.status().as_u16();
        if status != 207 && !(200..300).contains(&status) {
            let body = resp.text().await.unwrap_or_default();
            return Err(webdav_status_error(status, &body));
        }
        resp.text().await.map_err(|e| format!("读取响应失败：{e}"))
    }

    async fn put(&self, url: &str, bytes: Vec<u8>) -> Result<(), String> {
        let resp = self
            .client
            .put(url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "application/zip")
            .body(bytes)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| webdav_network_error(e))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let body = resp.text().await.unwrap_or_default();
            return Err(webdav_status_error(status, &body));
        }
        Ok(())
    }

    async fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        let resp = self
            .client
            .get(url)
            .basic_auth(&self.username, Some(&self.password))
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| webdav_network_error(e))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let body = resp.text().await.unwrap_or_default();
            return Err(webdav_status_error(status, &body));
        }
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("下载备份数据失败：{e}"))
    }

    async fn delete(&self, url: &str) -> Result<(), String> {
        let resp = self
            .client
            .delete(url)
            .basic_auth(&self.username, Some(&self.password))
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| webdav_network_error(e))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) && status != 404 {
            let body = resp.text().await.unwrap_or_default();
            return Err(webdav_status_error(status, &body));
        }
        Ok(())
    }

    /// PROPFIND Depth:1 列出远端目录内容，过滤出本应用的备份 zip。
    async fn list(&self, remote_dir: &str) -> Result<Vec<RemoteBackupEntry>, String> {
        let url = join_url(&self.base_url, &[remote_dir]);
        let body = self.propfind(&url, "1").await?;
        let mut entries = Vec::new();
        for (href, size, modified) in parse_multistatus(&body) {
            // href 形如 /dav/MaobuTranslator/maobu_backup_....zip，取最后一段并解码
            let Some(raw_name) = href.rsplit('/').next() else {
                continue;
            };
            let name = percent_decode(raw_name);
            if name.starts_with(backup::BACKUP_FILE_PREFIX) && name.ends_with(".zip") {
                entries.push(RemoteBackupEntry {
                    name,
                    size_bytes: size,
                    modified_at: modified,
                });
            }
        }
        entries.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(entries)
    }
}

/// 解析 WebDAV multistatus XML（忽略命名空间前缀，按本地标签名匹配）。
fn parse_multistatus(body: &str) -> Vec<(String, u64, Option<String>)> {
    let mut out = Vec::new();
    let Ok(doc) = roxmltree::Document::parse(body) else {
        return out;
    };
    for response in doc.descendants().filter(|n| n.tag_name().name() == "response") {
        let mut href: Option<String> = None;
        let mut size: u64 = 0;
        let mut modified: Option<String> = None;
        for node in response.descendants() {
            match node.tag_name().name() {
                "href" if href.is_none() => {
                    href = Some(node.text().unwrap_or_default().trim().to_string())
                }
                "getcontentlength" if size == 0 => {
                    size = node.text().unwrap_or_default().trim().parse().unwrap_or(0);
                }
                "getlastmodified" if modified.is_none() => {
                    modified = Some(node.text().unwrap_or_default().trim().to_string());
                }
                _ => {}
            }
        }
        if let Some(href) = href {
            out.push((href, size, modified));
        }
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

fn webdav_network_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "连接 WebDAV 服务器超时，请检查网络或代理设置".to_string()
    } else if e.is_connect() {
        "无法连接 WebDAV 服务器，请检查服务地址与网络".to_string()
    } else {
        format!("WebDAV 请求失败：{e}")
    }
}

fn webdav_status_error(status: u16, body: &str) -> String {
    match status {
        401 => "认证失败（HTTP 401）：请核对 WebDAV 账号与应用密码（坚果云需使用「应用密码」而非登录密码）".to_string(),
        403 => format!("无权限访问（HTTP 403）：请确认账号对该目录有读写权限 {body}"),
        404 => "远端路径不存在（HTTP 404）：请检查服务地址与远端目录".to_string(),
        _ => format!("WebDAV 服务器返回 HTTP {status}：{}", truncate(body, 300)),
    }
}

/// 读取当前设置中的 WebDAV 连接信息（await 之前完成，避免跨 await 持锁）。
/// override 参数用于「测试连接」直传表单值：非空则优先生效；
/// 密码 override 为空表示「留空保持不变」，回落到已保存密码。
fn load_conn_with(
    app_handle: &tauri::AppHandle,
    url_override: Option<&str>,
    user_override: Option<&str>,
    pass_override: Option<&str>,
) -> Result<(WebdavConn, WebdavConfig), String> {
    let trim_opt = |s: Option<&str>| -> Option<String> {
        s.map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "应用状态不可用".to_string())?;
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁定 settings 失败：{e}"))?
        .clone();
    let cfg = backup::effective_webdav_config(&settings);
    let url = trim_opt(url_override)
        .or_else(|| trim_opt(cfg.url.as_deref()))
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string();
    let username = trim_opt(user_override)
        .or_else(|| trim_opt(cfg.username.as_deref()))
        .unwrap_or_default();
    let password = trim_opt(pass_override)
        .or_else(|| trim_opt(cfg.password.as_deref()))
        .unwrap_or_default();
    if url.is_empty() || !url.starts_with("http") {
        return Err("请先填写 WebDAV 服务地址（如 https://dav.jiangguoyun.com/dav/）".to_string());
    }
    if username.is_empty() || password.is_empty() {
        return Err("请先填写 WebDAV 账号与应用密码".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败：{e}"))?;
    Ok((
        WebdavConn {
            client,
            base_url: url,
            username,
            password,
        },
        cfg,
    ))
}

fn load_conn(app_handle: &tauri::AppHandle) -> Result<(WebdavConn, WebdavConfig), String> {
    load_conn_with(app_handle, None, None, None)
}

fn update_webdav_state(
    app_handle: &tauri::AppHandle,
    mutate: impl FnOnce(&mut WebdavConfig),
) -> Result<(), String> {
    let state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "应用状态不可用".to_string())?;
    let mut settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁定 settings 失败：{e}"))?;
    let cfg = settings.webdav_config.get_or_insert_with(Default::default);
    mutate(cfg);
    commands::save_settings_file(app_handle, &settings);
    Ok(())
}

/// 以文件名中的 YYYYMMDD 计算备份距今的天数。
fn filename_age_days(name: &str, today_days: i64) -> Option<i64> {
    let digits = name.trim_start_matches(backup::BACKUP_FILE_PREFIX);
    if digits.len() < 8 {
        return None;
    }
    let y: i64 = digits[0..4].parse().ok()?;
    let m: u32 = digits[4..6].parse().ok()?;
    let d: u32 = digits[6..8].parse().ok()?;
    Some(today_days - backup::days_from_civil(y, m, d))
}

fn today_days() -> i64 {
    let ts = backup::backup_timestamp_string(); // YYYYMMDD_HHMMSS
    filename_to_days(&ts)
}

fn filename_to_days(ts: &str) -> i64 {
    let y: i64 = ts.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(1970);
    let m: u32 = ts.get(4..6).and_then(|s| s.parse().ok()).unwrap_or(1);
    let d: u32 = ts.get(6..8).and_then(|s| s.parse().ok()).unwrap_or(1);
    backup::days_from_civil(y, m, d)
}

// ── Tauri 命令 ──

/// 测试 WebDAV 连接（PROPFIND Depth:0 根路径）。可直接传表单值测试未保存的配置。
#[tauri::command]
pub async fn cmd_webdav_test(
    app_handle: tauri::AppHandle,
    url: Option<String>,
    username: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    let started = Instant::now();
    let (conn, _cfg) = load_conn_with(
        &app_handle,
        url.as_deref(),
        username.as_deref(),
        password.as_deref(),
    )?;
    conn.propfind(&conn.base_url, "0").await?;
    Ok(format!("连接成功（{} ms）", started.elapsed().as_millis()))
}

/// 生成当前数据备份并上传到 WebDAV，随后按保留天数清理云端旧备份。
#[tauri::command]
pub async fn cmd_webdav_upload(
    app_handle: tauri::AppHandle,
) -> Result<WebdavUploadResult, String> {
    let (conn, cfg) = load_conn(&app_handle)?;
    let remote_dir = cfg.remote_dir.clone().unwrap_or_default();
    let retention_days = cfg.retention_days.unwrap_or(15);

    let (bytes, _manifest) = backup::build_current_zip_bytes(&app_handle, "manual")?;
    let name = format!(
        "{}{}.zip",
        backup::BACKUP_FILE_PREFIX,
        backup::backup_timestamp_string()
    );
    let size_bytes = bytes.len() as u64;

    conn.ensure_remote_dir(&remote_dir).await?;
    conn.put(&conn.remote_file_url(&remote_dir, &name), bytes)
        .await?;

    // 云端保留天数清理（best effort，失败不影响上传结果）
    let mut deleted_old = 0usize;
    if retention_days > 0 {
        if let Ok(entries) = conn.list(&remote_dir).await {
            let today = today_days();
            for entry in entries {
                if entry.name == name {
                    continue;
                }
                if let Some(age) = filename_age_days(&entry.name, today) {
                    if age > retention_days as i64 {
                        if conn
                            .delete(&conn.remote_file_url(&remote_dir, &entry.name))
                            .await
                            .is_ok()
                        {
                            deleted_old += 1;
                        }
                    }
                }
            }
        }
    }

    update_webdav_state(&app_handle, |c| {
        c.last_upload_at_ms = Some(backup::now_ms());
        c.last_upload_name = Some(name.clone());
    })?;

    Ok(WebdavUploadResult {
        name,
        size_bytes,
        deleted_old,
    })
}

/// 列出远端目录中的备份。
#[tauri::command]
pub async fn cmd_webdav_list(app_handle: tauri::AppHandle) -> Result<Vec<RemoteBackupEntry>, String> {
    let (conn, cfg) = load_conn(&app_handle)?;
    let remote_dir = cfg.remote_dir.clone().unwrap_or_default();
    conn.list(&remote_dir).await
}

/// 从云端下载指定备份并恢复。
#[tauri::command]
pub async fn cmd_webdav_restore(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
) -> Result<backup::RestoreSummary, String> {
    let name = backup::sanitize_backup_name(&name)?;
    let (conn, cfg) = load_conn(&app_handle)?;
    let remote_dir = cfg.remote_dir.clone().unwrap_or_default();
    let bytes = conn
        .get(&conn.remote_file_url(&remote_dir, &name))
        .await?;
    let summary = backup::restore_from_bytes(&app_handle, Some(&window), bytes)?;
    update_webdav_state(&app_handle, |c| {
        c.last_restore_at_ms = Some(backup::now_ms());
    })?;
    Ok(summary)
}

/// 删除云端指定备份。
#[tauri::command]
pub async fn cmd_webdav_delete(
    app_handle: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    let name = backup::sanitize_backup_name(&name)?;
    let (conn, cfg) = load_conn(&app_handle)?;
    let remote_dir = cfg.remote_dir.clone().unwrap_or_default();
    conn.delete(&conn.remote_file_url(&remote_dir, &name))
        .await
}
