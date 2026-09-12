use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;
use tauri::Emitter;

pub const GITHUB_OWNER: &str = "maobukeai";
pub const GITHUB_REPO: &str = "catwalk-translator";

pub const RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/maobukeai/catwalk-translator/releases/latest";
pub const RELEASES_PAGE: &str = "https://github.com/maobukeai/catwalk-translator/releases";

pub const RELEASES_WEB_LATEST_URL: &str =
    "https://github.com/maobukeai/catwalk-translator/releases/latest";

pub const GHFAST_VERSION_URL: &str =
    "https://ghfast.top/https://raw.githubusercontent.com/maobukeai/catwalk-translator/main/version.json";
pub const GHPROXY_VERSION_URL: &str =
    "https://ghproxy.net/https://raw.githubusercontent.com/maobukeai/catwalk-translator/main/version.json";
pub const JSDELIVR_VERSION_URL: &str =
    "https://cdn.jsdelivr.net/gh/maobukeai/catwalk-translator@main/version.json";
pub const FASTLY_VERSION_URL: &str =
    "https://fastly.jsdelivr.net/gh/maobukeai/catwalk-translator@main/version.json";
pub const JSDELIVR_PACKAGE_URL: &str =
    "https://cdn.jsdelivr.net/gh/maobukeai/catwalk-translator@main/app_v2/package.json";
pub const FASTLY_PACKAGE_URL: &str =
    "https://fastly.jsdelivr.net/gh/maobukeai/catwalk-translator@main/app_v2/package.json";

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const APP_NAME: &str = "猫步翻译";

const USER_AGENT: &str = concat!(
    "MaobuTranslator/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/maobukeai/catwalk-translator)"
);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    pub percentage: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAssetInfo {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub release_date: String,
    pub download_url: String,
    pub sha256: Option<String>,
    pub release_notes: String,
    pub assets: Vec<UpdateAssetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub latest: Option<UpdateInfo>,
    pub has_update: bool,
    pub current_version: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub repo_url: String,
}

fn build_update_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(16))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败：{e}"))
}

fn build_download_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("构建下载 HTTP 客户端失败：{e}"))
}

/// 解析 CDN 返回的元数据（支持根目录 version.json 以及 app_v2/package.json）
pub fn parse_cdn_version_info(body: &str, current: &str) -> Option<UpdateCheckResult> {
    let json: serde_json::Value = serde_json::from_str(body).ok()?;
    let v_str = json.get("version").and_then(|v| v.as_str())?;
    let version = strip_leading_v(v_str).to_string();
    if version.is_empty() {
        return None;
    }
    let has_update = version_compare(&version, current) == Ordering::Greater;

    let release_date = json
        .get("release_date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let download_url = json
        .get("download_url")
        .and_then(|v| v.as_str())
        .unwrap_or(RELEASES_PAGE)
        .to_string();
    let release_notes = json
        .get("release_notes")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut assets = parse_assets(json.get("assets"));

    if assets.is_empty() {
        assets.push(UpdateAssetInfo {
            name: format!("MaobuTranslator_{}_x64-setup.exe", version),
            url: format!(
                "https://github.com/{}/{}/releases/download/v{}/MaobuTranslator_{}_x64-setup.exe",
                GITHUB_OWNER, GITHUB_REPO, version, version
            ),
            size: 0,
            sha256: None,
        });
    }

    let notes = if !release_notes.is_empty() {
        release_notes
    } else if has_update {
        format!(
            "发现新版本 v{}（已通过全球高速 CDN 免限流通道探知，点击下方前往下载更新）",
            version
        )
    } else {
        "当前已是最新版本".to_string()
    };

    Some(UpdateCheckResult {
        latest: Some(UpdateInfo {
            version,
            release_date,
            download_url,
            sha256: None,
            release_notes: notes,
            assets,
        }),
        has_update,
        current_version: current.into(),
        error: None,
    })
}

/// 免限流全球 CDN 探针 (jsDelivr / Fastly 全球节点镜像)
/// 完全绕过 GitHub API 匿名 60次/小时 的 IP 限流机制与国内网络阻断，秒级返回最新版本
pub async fn check_update_via_cdn(current: &str) -> Option<UpdateCheckResult> {
    let mut default_headers = reqwest::header::HeaderMap::new();
    default_headers.insert(
        reqwest::header::CACHE_CONTROL,
        reqwest::header::HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
    default_headers.insert(
        reqwest::header::PRAGMA,
        reqwest::header::HeaderValue::from_static("no-cache"),
    );

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .default_headers(default_headers)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    let cdn_urls = [
        GHFAST_VERSION_URL,
        GHPROXY_VERSION_URL,
        JSDELIVR_VERSION_URL,
        FASTLY_VERSION_URL,
        JSDELIVR_PACKAGE_URL,
        FASTLY_PACKAGE_URL,
    ];

    for url in cdn_urls {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    if let Some(res) = parse_cdn_version_info(&text, current) {
                        return Some(res);
                    }
                }
            }
        }
    }
    None
}

/// 免限流网页 302 重定向探针 (HTML Redirect Probe)
/// GitHub 网页端 `https://github.com/{owner}/{repo}/releases/latest` 会以 HTTP 302 形式重定向到最新的 Tag
/// 此接口为纯 HTML 网页重定向，完全不受 GitHub REST API 匿名 60次/小时 的 IP 限流影响！
pub async fn check_update_via_html_redirect(current: &str) -> Option<UpdateCheckResult> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(12))
        .build()
        .ok()?;

    let response = client.get(RELEASES_WEB_LATEST_URL).send().await.ok()?;
    let status = response.status();

    // 网页端 releases/latest 会返回 301 或 302 重定向到 releases/tag/vX.Y.Z
    if status.is_redirection() || status.as_u16() == 302 || status.as_u16() == 301 {
        if let Some(loc_header) = response.headers().get(reqwest::header::LOCATION) {
            if let Ok(loc_str) = loc_header.to_str() {
                if let Some(tag) = extract_tag_from_location(loc_str) {
                    let version = strip_leading_v(&tag).to_string();
                    let has_update = version_compare(&version, current) == Ordering::Greater;
                    let info = UpdateInfo {
                        version: version.clone(),
                        release_date: "".to_string(),
                        download_url: format!(
                            "https://github.com/{}/{}/releases/tag/{}",
                            GITHUB_OWNER, GITHUB_REPO, tag
                        ),
                        sha256: None,
                        release_notes: if has_update {
                            format!(
                                "发现新版本 v{}（已通过 GitHub Releases 免限流通道探知，点击下方前往下载更新）",
                                version
                            )
                        } else {
                            "当前已是最新版本".to_string()
                        },
                        assets: vec![UpdateAssetInfo {
                            name: format!("MaobuTranslator_{}_x64-setup.exe", version),
                            url: format!(
                                "https://github.com/{}/{}/releases/download/{}/MaobuTranslator_{}_x64-setup.exe",
                                GITHUB_OWNER, GITHUB_REPO, tag, version
                            ),
                            size: 0,
                            sha256: None,
                        }],
                    };
                    return Some(UpdateCheckResult {
                        latest: Some(info),
                        has_update,
                        current_version: current.into(),
                        error: None,
                    });
                }
            }
        }
    }
    None
}

/// 从 GitHub 302 重定向 Location 中提取 Release Tag（如 `v0.2.0`）
pub fn extract_tag_from_location(location: &str) -> Option<String> {
    let clean = location.trim();
    if let Some(pos) = clean.rfind("/tag/") {
        let tag = &clean[pos + 5..];
        let tag_clean = tag.split('?').next()?.split('#').next()?.trim();
        if !tag_clean.is_empty() {
            return Some(tag_clean.to_string());
        }
    } else if let Some(last_seg) = clean.split('?').next()?.split('#').next()?.rsplit('/').next() {
        if !last_seg.is_empty() && last_seg != "latest" {
            return Some(last_seg.to_string());
        }
    }
    None
}

pub async fn check_app_update() -> UpdateCheckResult {
    let current = APP_VERSION;

    let client = match build_update_client() {
        Ok(c) => c,
        Err(e) => {
            // 客户端构建异常时尝试 CDN 探针与网页 302 探针
            if let Some(cdn_res) = check_update_via_cdn(current).await {
                return cdn_res;
            }
            if let Some(fallback_res) = check_update_via_html_redirect(current).await {
                return fallback_res;
            }
            return error_result(current, &e);
        }
    };

    let response = match client.get(RELEASES_LATEST_URL).send().await {
        Ok(r) => r,
        Err(e) => {
            // 直连 API 超时或网络异常时，立即无缝降级到免限流 CDN 探针
            if let Some(cdn_res) = check_update_via_cdn(current).await {
                return cdn_res;
            }
            if let Some(fallback_res) = check_update_via_html_redirect(current).await {
                return fallback_res;
            }
            let err_str = e.to_string();
            let msg = if e.is_timeout() {
                "连接 GitHub 升级服务器超时，请检查网络或开启系统代理".to_string()
            } else if e.is_connect()
                || err_str.contains("dns")
                || err_str.contains("os error")
                || err_str.contains("error sending request")
            {
                "无法直连 GitHub API（国内网络受限/DNS未通），建议开启网络代理或手动访问 Release 页面".to_string()
            } else {
                format!("无法连接 GitHub 升级服务器：{e}")
            };
            return error_result(current, &msg);
        }
    };

    let status = response.status();
    if !status.is_success() {
        // 关键点：当遇到 403 限流、429、500 等任何异常时，优先触发免限流 CDN 探针！
        if let Some(cdn_res) = check_update_via_cdn(current).await {
            return cdn_res;
        }
        if let Some(fallback_res) = check_update_via_html_redirect(current).await {
            return fallback_res;
        }

        let err_body = response.text().await.unwrap_or_default();
        let display_err = if status.as_u16() == 403
            && (err_body.contains("rate limit") || err_body.contains("Rate limit"))
        {
            "当前网络 IP 请求 GitHub 接口触发限流 (403)，已自动尝试 CDN 镜像。请稍后重试或开启系统代理".to_string()
        } else if status.as_u16() == 404 {
            "未找到已发布的 Release 版本 (404)。请确认 GitHub 仓库已发布 Release 包".to_string()
        } else {
            format!("GitHub 更新服务器返回 HTTP {}：{}", status.as_u16(), err_body)
        };
        return error_result(current, &display_err);
    }

    let body = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            if let Some(cdn_res) = check_update_via_cdn(current).await {
                return cdn_res;
            }
            if let Some(fallback_res) = check_update_via_html_redirect(current).await {
                return fallback_res;
            }
            return error_result(current, &format!("读取更新响应失败：{e}"));
        }
    };
    let json: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            if let Some(cdn_res) = check_update_via_cdn(current).await {
                return cdn_res;
            }
            if let Some(fallback_res) = check_update_via_html_redirect(current).await {
                return fallback_res;
            }
            return error_result(current, &format!("解析更新信息失败：{e}"));
        }
    };

    let Some(info) = parse_release(&json) else {
        if let Some(cdn_res) = check_update_via_cdn(current).await {
            return cdn_res;
        }
        if let Some(fallback_res) = check_update_via_html_redirect(current).await {
            return fallback_res;
        }
        return error_result(current, "更新服务器响应缺少必要版本字段");
    };

    let has_update = version_compare(&info.version, current) == Ordering::Greater;
    UpdateCheckResult {
        latest: Some(info),
        has_update,
        current_version: current.into(),
        error: None,
    }
}

fn error_result(current: &str, message: &str) -> UpdateCheckResult {
    UpdateCheckResult {
        latest: None,
        has_update: false,
        current_version: current.into(),
        error: Some(message.to_string()),
    }
}

fn parse_release(json: &serde_json::Value) -> Option<UpdateInfo> {
    let tag = json.get("tag_name")?.as_str()?;
    let version = strip_leading_v(tag).to_owned();
    let release_date = json
        .get("published_at")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    let download_url = json
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or(RELEASES_PAGE)
        .to_owned();
    let release_notes = json
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    let sha256 = parse_sha256_from_body(&release_notes);
    let assets = parse_assets(json.get("assets"));
    Some(UpdateInfo {
        version,
        release_date,
        download_url,
        sha256,
        release_notes,
        assets,
    })
}

fn parse_assets(value: Option<&serde_json::Value>) -> Vec<UpdateAssetInfo> {
    let Some(entries) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.to_owned();
            let url = entry
                .get("browser_download_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            if url.is_empty() {
                return None;
            }
            let size = entry.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
            let sha256 = entry
                .get("digest")
                .and_then(|v| v.as_str())
                .and_then(parse_digest_sha256);
            Some(UpdateAssetInfo {
                name,
                url,
                size,
                sha256,
            })
        })
        .collect()
}

fn parse_digest_sha256(digest: &str) -> Option<String> {
    let hex = digest.strip_prefix("sha256:")?;
    if hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(hex.to_ascii_lowercase())
    } else {
        None
    }
}

fn parse_sha256_from_body(body: &str) -> Option<String> {
    for line in body.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        let Some(rest) = lower
            .strip_prefix("sha-256:")
            .or_else(|| lower.strip_prefix("sha256:"))
            .or_else(|| lower.strip_prefix("sha-256："))
            .or_else(|| lower.strip_prefix("sha256："))
        else {
            continue;
        };
        let hex = rest.trim();
        if hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hex.to_ascii_lowercase());
        }
    }
    None
}

fn strip_leading_v(tag: &str) -> &str {
    let trimmed = tag.trim();
    if let Some(rest) = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
    {
        rest
    } else {
        trimmed
    }
}

pub fn version_compare(a: &str, b: &str) -> Ordering {
    let a_parts = parse_version_parts(a);
    let b_parts = parse_version_parts(b);
    for i in 0..3 {
        let av = a_parts.get(i).copied().unwrap_or(0);
        let bv = b_parts.get(i).copied().unwrap_or(0);
        match av.cmp(&bv) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

fn parse_version_parts(v: &str) -> Vec<u64> {
    let clean = strip_leading_v(v);
    let main_part = clean.split('-').next().unwrap_or(clean);
    main_part
        .split('.')
        .map(|seg| seg.parse::<u64>().unwrap_or(0))
        .collect()
}

#[tauri::command]
pub async fn cmd_check_app_update() -> Result<UpdateCheckResult, String> {
    Ok(check_app_update().await)
}

#[tauri::command]
pub async fn cmd_get_app_info() -> Result<AppInfo, String> {
    Ok(AppInfo {
        name: APP_NAME.to_string(),
        version: APP_VERSION.to_string(),
        repo_url: format!("https://github.com/{}/{}", GITHUB_OWNER, GITHUB_REPO),
    })
}

#[tauri::command]
pub fn cmd_open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    Ok(())
}

pub fn build_candidate_download_urls(raw_url: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let clean = raw_url.trim();
    if clean.is_empty() {
        return urls;
    }

    // 基础直连
    urls.push(clean.to_string());

    // 若给定的只是 release tag 页面链接（如 .../releases/tag/v0.3.2），自动推断安装包直链
    let mut direct_download_urls = Vec::new();
    if clean.contains("github.com") && clean.contains("/releases/tag/") {
        if let Some(tag) = extract_tag_from_location(clean) {
            let ver = strip_leading_v(&tag);
            direct_download_urls.push(format!(
                "https://github.com/{}/{}/releases/download/{}/MaobuTranslator_{}_x64-setup.exe",
                GITHUB_OWNER, GITHUB_REPO, tag, ver
            ));
            direct_download_urls.push(format!(
                "https://github.com/{}/{}/releases/download/{}/%E7%8C%AB%E6%AD%A5%E7%BF%BB%E8%AF%91_{}_x64-setup.exe",
                GITHUB_OWNER, GITHUB_REPO, tag, ver
            ));
        }
    }

    for d_url in &direct_download_urls {
        if !urls.contains(d_url) {
            urls.push(d_url.clone());
        }
    }

    // 收集需要为其附加镜像加速的所有直连基准链接
    let base_urls = urls.clone();

    // 生成文件名变体（支持 MaobuTranslator_、猫步翻译_ 以及下划线前缀变体）
    for u in &base_urls {
        if u.contains("github.com") && u.contains("/releases/download/") {
            if let Some((base, filename)) = u.rsplit_once('/') {
                let variants = [
                    filename.replace("%E7%8C%AB%E6%AD%A5%E7%BF%BB%E8%AF%91_", "MaobuTranslator_"),
                    filename.replace("猫步翻译_", "MaobuTranslator_"),
                    filename.replace("MaobuTranslator_", "%E7%8C%AB%E6%AD%A5%E7%BF%BB%E8%AF%91_"),
                    filename.replace("MaobuTranslator_", "猫步翻译_"),
                    if filename.starts_with('_') {
                        format!("MaobuTranslator{}", filename)
                    } else {
                        format!("_{}", filename)
                    },
                ];
                for v in variants {
                    if v != filename {
                        let alt = format!("{}/{}", base, v);
                        if !urls.contains(&alt) {
                            urls.push(alt);
                        }
                    }
                }
            }
        }
    }

    // 为所有 GitHub 直连链接增加多组国内高速 CDN 镜像加速通道
    let github_urls: Vec<String> = urls
        .iter()
        .filter(|u| u.contains("github.com/"))
        .cloned()
        .collect();

    for g_url in github_urls {
        let mirrors = [
            format!("https://ghfast.top/{}", g_url),
            format!("https://ghproxy.net/{}", g_url),
            format!("https://mirror.ghproxy.com/{}", g_url),
            format!("https://hub.gitmirror.com/{}", g_url),
            format!("https://gh-proxy.com/{}", g_url),
        ];
        for m in mirrors {
            if !urls.contains(&m) {
                urls.push(m);
            }
        }
    }

    urls
}

#[tauri::command]
pub async fn cmd_download_and_install_update(
    app: tauri::AppHandle,
    url: String,
    silent: Option<bool>,
) -> Result<String, String> {
    if url.trim().is_empty() {
        return Err("下载地址为空".to_string());
    }

    let client = build_download_client()?;
    let candidate_urls = build_candidate_download_urls(&url);
    let mut last_error = String::new();

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_installer = std::env::temp_dir().join(format!("MaobuTranslator_Setup_Update_{timestamp}.exe"));

    let mut download_succeeded = false;

    for target_url in candidate_urls {
        eprintln!("[Updater] 尝试下载更新包: {}", target_url);
        match client.get(&target_url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_error = format!("HTTP {}", resp.status().as_u16());
                    continue;
                }

                let total_bytes = resp.content_length().unwrap_or(0);
                let mut stream = resp.bytes_stream();

                let mut file = match std::fs::File::create(&temp_installer) {
                    Ok(f) => f,
                    Err(e) => {
                        last_error = format!("创建本地临时安装包失败: {e}");
                        continue;
                    }
                };

                use std::io::Write;
                let mut downloaded_bytes: u64 = 0;
                let mut last_emit_time = std::time::Instant::now();
                let mut last_emit_bytes: u64 = 0;
                let mut chunk_error = false;

                // 首次广播：开始连接/下载
                let _ = app.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        percentage: 0.0,
                        downloaded_bytes: 0,
                        total_bytes,
                        speed_bytes_per_sec: 0,
                        stage: "downloading".to_string(),
                    },
                );

                while let Some(chunk_res) = stream.next().await {
                    match chunk_res {
                        Ok(chunk) => {
                            if let Err(e) = file.write_all(&chunk) {
                                last_error = format!("写入安装包数据失败: {e}");
                                chunk_error = true;
                                break;
                            }
                            downloaded_bytes += chunk.len() as u64;

                            let now = std::time::Instant::now();
                            let elapsed = now.duration_since(last_emit_time).as_secs_f64();
                            if elapsed >= 0.08 || (total_bytes > 0 && downloaded_bytes >= total_bytes) {
                                let speed = if elapsed > 0.0 {
                                    (downloaded_bytes.saturating_sub(last_emit_bytes) as f64 / elapsed) as u64
                                } else {
                                    0
                                };
                                let percentage = if total_bytes > 0 {
                                    ((downloaded_bytes as f64 / total_bytes as f64) * 100.0) as f32
                                } else {
                                    0.0
                                };
                                let _ = app.emit(
                                    "update-download-progress",
                                    UpdateDownloadProgress {
                                        percentage: percentage.min(99.9),
                                        downloaded_bytes,
                                        total_bytes,
                                        speed_bytes_per_sec: speed,
                                        stage: "downloading".to_string(),
                                    },
                                );
                                last_emit_time = now;
                                last_emit_bytes = downloaded_bytes;
                            }
                        }
                        Err(e) => {
                            last_error = format!("下载数据流中断: {e}");
                            chunk_error = true;
                            break;
                        }
                    }
                }

                let _ = file.flush();
                drop(file);

                if chunk_error {
                    let _ = std::fs::remove_file(&temp_installer);
                    continue;
                }

                // 确保安装包体积正常（> 512KB），不是 404 HTML
                if downloaded_bytes > 1024 * 512 {
                    download_succeeded = true;
                    // 发送 100% 下载完成通知
                    let _ = app.emit(
                        "update-download-progress",
                        UpdateDownloadProgress {
                            percentage: 100.0,
                            downloaded_bytes,
                            total_bytes: downloaded_bytes,
                            speed_bytes_per_sec: 0,
                            stage: "installing".to_string(),
                        },
                    );
                    break;
                } else {
                    last_error = format!("下载的文件过小 ({} 字节)，可能非有效安装包", downloaded_bytes);
                    let _ = std::fs::remove_file(&temp_installer);
                }
            }
            Err(e) => {
                last_error = e.to_string();
            }
        }
    }

    if !download_succeeded {
        let err_msg = format!(
            "自动下载失败（已尝试直连及多条国内 CDN 加速源）：{}",
            if last_error.is_empty() { "未获取到有效安装包数据" } else { &last_error }
        );
        let _ = app.emit(
            "update-download-progress",
            UpdateDownloadProgress {
                percentage: 0.0,
                downloaded_bytes: 0,
                total_bytes: 0,
                speed_bytes_per_sec: 0,
                stage: format!("error: {}", err_msg),
            },
        );
        return Err(err_msg);
    }

    let is_silent = silent.unwrap_or(false);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let current_exe_path = std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        if is_silent {
            // 静默更新：使用 cmd 执行 NSIS /S 安装，等待完成后自动重新拉起当前新版本 exe
            // ping 127.0.0.1 -n 2 提供 1 秒延时，确保旧进程彻底退出且文件锁完全释放
            let cmd_script = if !current_exe_path.is_empty() {
                format!(
                    "ping 127.0.0.1 -n 2 >nul & \"{}\" /S & ping 127.0.0.1 -n 2 >nul & start \"\" \"{}\"",
                    temp_installer.to_string_lossy(),
                    current_exe_path
                )
            } else {
                format!("ping 127.0.0.1 -n 2 >nul & \"{}\" /S", temp_installer.to_string_lossy())
            };

            std::process::Command::new("cmd")
                .args(["/c", &cmd_script])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("启动静默升级脚本失败: {e}"))?;
        } else {
            // 常规向导升级：直接启动安装程序向导
            std::process::Command::new(&temp_installer)
                .spawn()
                .map_err(|e| format!("启动安装程序失败: {e}"))?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("open").arg(&temp_installer).spawn();
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        crate::translator::shared_pipeline().cache.save_to_disk();
        app_clone.exit(0);
    });

    Ok(temp_installer.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_tag_from_location() {
        assert_eq!(
            extract_tag_from_location("https://github.com/maobukeai/catwalk-translator/releases/tag/v0.2.0"),
            Some("v0.2.0".to_string())
        );
        assert_eq!(
            extract_tag_from_location("/maobukeai/catwalk-translator/releases/tag/v1.5.2?utm=test#fragment"),
            Some("v1.5.2".to_string())
        );
        assert_eq!(
            extract_tag_from_location("https://github.com/maobukeai/catwalk-translator/releases/tag/0.9.1"),
            Some("0.9.1".to_string())
        );
        assert_eq!(
            extract_tag_from_location("https://github.com/maobukeai/catwalk-translator/releases/latest"),
            None
        );
    }

    #[test]
    fn test_strip_leading_v() {
        assert_eq!(strip_leading_v("v0.2.0"), "0.2.0");
        assert_eq!(strip_leading_v("V1.0.0"), "1.0.0");
        assert_eq!(strip_leading_v("2.3.4"), "2.3.4");
    }

    #[test]
    fn test_version_compare() {
        assert_eq!(version_compare("0.2.1", "0.2.0"), Ordering::Greater);
        assert_eq!(version_compare("0.2.0", "0.2.0"), Ordering::Equal);
        assert_eq!(version_compare("0.1.9", "0.2.0"), Ordering::Less);
        assert_eq!(version_compare("1.0.0", "0.9.9"), Ordering::Greater);
    }

    #[test]
    fn test_parse_cdn_version_info_full_json() {
        let json_str = r#"{
            "version": "0.3.3",
            "name": "猫步翻译",
            "release_date": "2026-09-05",
            "download_url": "https://github.com/maobukeai/catwalk-translator/releases",
            "release_notes": "1. 升级大图覆写\n2. 纯文通读",
            "assets": [
                {
                    "name": "猫步翻译_0.3.3_x64-setup.exe",
                    "url": "https://example.com/setup.exe",
                    "size": 12345,
                    "sha256": null
                }
            ]
        }"#;

        let res1 = parse_cdn_version_info(json_str, "0.1.8").expect("should parse");
        assert!(res1.has_update);
        assert_eq!(res1.current_version, "0.1.8");
        let latest1 = res1.latest.unwrap();
        assert_eq!(latest1.version, "0.3.3");
        assert_eq!(latest1.release_notes, "1. 升级大图覆写\n2. 纯文通读");
        assert_eq!(latest1.assets.len(), 1);

        let res2 = parse_cdn_version_info(json_str, "0.3.3").expect("should parse");
        assert!(!res2.has_update);
    }

    #[test]
    fn test_parse_cdn_version_info_package_json() {
        let pkg_str = r#"{
            "name": "app_v2",
            "private": true,
            "version": "0.3.3"
        }"#;

        let res = parse_cdn_version_info(pkg_str, "0.1.8").expect("should parse package.json");
        assert!(res.has_update);
        let latest = res.latest.unwrap();
        assert_eq!(latest.version, "0.3.3");
        assert!(latest.release_notes.contains("发现新版本 v0.3.3"));
        assert_eq!(latest.assets.len(), 1);
        assert!(latest.assets[0].name.contains("0.3.3"));
    }

    #[test]
    fn test_build_candidate_download_urls() {
        let url = "https://github.com/maobukeai/catwalk-translator/releases/download/v0.3.1/MaobuTranslator_0.3.1_x64-setup.exe";
        let candidates = build_candidate_download_urls(url);
        assert!(candidates.contains(&url.to_string()));
        assert!(candidates.iter().any(|c| c.contains("ghfast.top")));
        assert!(candidates.iter().any(|c| c.contains("ghproxy.net")));
        assert!(candidates.iter().any(|c| c.contains("_0.3.1_x64-setup.exe")));
    }
}
