use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;
use tauri::Emitter;
use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;

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
    crate::translator::apply_proxy_to_builder(
        Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(12))
            .timeout(Duration::from_secs(16)),
    )
    .build()
    .map_err(|e| format!("构建 HTTP 客户端失败：{e}"))
}

fn build_download_client() -> Result<Client, String> {
    crate::translator::apply_proxy_to_builder(
        Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .redirect(reqwest::redirect::Policy::limited(10))
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(300)),
    )
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
            sha256: json.get("sha256").and_then(|value| value.as_str()).and_then(normalize_sha256),
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

    let client = crate::translator::apply_proxy_to_builder(
        Client::builder()
            .user_agent(USER_AGENT)
            .default_headers(default_headers)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(8)),
    )
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
    let client = crate::translator::apply_proxy_to_builder(
        Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(12)),
    )
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
                .or_else(|| entry.get("url"))
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
                .and_then(parse_digest_sha256)
                .or_else(|| entry.get("sha256").and_then(|v| v.as_str()).and_then(normalize_sha256));
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
    normalize_sha256(hex)
}

fn normalize_sha256(hex: &str) -> Option<String> {
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
pub fn cmd_open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "链接地址无效")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("仅允许打开 HTTP/HTTPS 网页链接".to_string());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| format!("打开浏览器失败: {e}"))
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

const MAX_INSTALLER_BYTES: u64 = 256 * 1024 * 1024;

/// Hosts we are willing to download an installer from. Every candidate URL
/// (the direct GitHub link *and* each CDN mirror) must pass through here,
/// otherwise a mirror returning attacker-controlled content could be executed.
const TRUSTED_INSTALLER_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "ghfast.top",
    "ghproxy.net",
    "mirror.ghproxy.com",
    "hub.gitmirror.com",
    "gh-proxy.com",
];

/// GitHub hosts that serve the installer directly (never as an inline HTML page).
const ALLOWED_DIRECT_HOSTS: &[&str] = &["github.com", "objects.githubusercontent.com"];

/// Validate a *direct* GitHub Releases installer URL (no mirror wrapper).
fn validate_direct_installer_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "更新包下载地址无效")?;
    // Accept any host we declared as a direct GitHub content host. Hard-coding
    // "github.com" here previously made the other ALLOWED_DIRECT_HOSTS entries
    // unreachable, so a legitimate GitHub content URL was always rejected.
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if parsed.scheme() != "https"
        || !ALLOWED_DIRECT_HOSTS.contains(&host.as_str())
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !parsed.path().starts_with("/maobukeai/catwalk-translator/releases/download/")
        || !parsed.path().to_ascii_lowercase().ends_with("-setup.exe")
    {
        return Err("仅允许安装本项目 GitHub Releases 的 Windows 安装包".to_string());
    }
    Ok(())
}

/// Validate a mirror-wrapped URL such as `https://ghfast.top/https://github.com/...`.
/// The mirror may prefix its own host, but the remainder must itself be a direct
/// GitHub Releases URL. This stops a mirror from pointing the download elsewhere.
fn validate_mirror_installer_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| "更新包下载地址无效")?;
    if parsed.scheme() != "https" {
        return Err("更新包下载地址必须使用 HTTPS".to_string());
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if !TRUSTED_INSTALLER_HOSTS.contains(&host.as_str()) {
        return Err(format!("不受信任的更新包下载来源: {host}"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("更新包下载地址不允许携带凭据".to_string());
    }
    if ALLOWED_DIRECT_HOSTS.contains(&host.as_str()) {
        return validate_direct_installer_url(trimmed);
    }
    // Mirror form: strip the leading "https://<host>/" and re-inspect the payload.
    let marker = format!("https://{host}/");
    let inner = trimmed
        .strip_prefix(&marker)
        .ok_or_else(|| "更新包镜像地址格式无效".to_string())?;
    if !inner.starts_with("https://") {
        return Err("更新包镜像必须转发 HTTPS 地址".to_string());
    }
    validate_direct_installer_url(inner)
}

/// Screen a URL coming from the frontend or from our own candidate list.
/// Extract the release tag from an installer download URL, e.g.
/// `.../releases/download/v0.3.38/MaobuTranslator_....exe` -> `v0.3.38`.
/// `extract_tag_from_location` is written for `/releases/tag/<tag>` redirect
/// locations and would otherwise fall back to returning the file name.
fn extract_release_tag_from_download_url(url: &str) -> Option<String> {
    let clean = url.trim();
    let marker = "/releases/download/";
    let pos = clean.find(marker)?;
    let rest = &clean[pos + marker.len()..];
    let tag = rest.split('/').next()?;
    let tag = tag.split('?').next()?.split('#').next()?.trim();
    if tag.is_empty() {
        return None;
    }
    Some(tag.to_string())
}

/// Recover the SHA-256 (and size, when GitHub reports one) for an installer straight
/// from the GitHub release it belongs to. Used only when the CDN manifest has not yet
/// published a digest, which is the normal state between `bump_version.py` running
/// and the release job finishing.
async fn fetch_release_digest(installer_url: &str) -> Option<(String, Option<u64>)> {
    let tag = extract_release_tag_from_download_url(installer_url)?;
    let api = format!(
        "https://api.github.com/repos/{}/{}/releases/tags/{}",
        GITHUB_OWNER, GITHUB_REPO, tag
    );
    let client = build_download_client().ok()?;
    let resp = client
        .get(&api)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        eprintln!("[Updater] GitHub Release 查询失败: HTTP {}", resp.status().as_u16());
        return None;
    }
    let body = resp.text().await.ok()?;
    let json: serde_json::Value = serde_json::from_str(&body).ok()?;
    let assets = json.get("assets")?.as_array()?;
    // Prefer the ASCII-named installer so we do not depend on URL-decoded CJK names.
    let mut chosen: Option<&serde_json::Value> = None;
    for asset in assets {
        let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if name.to_ascii_lowercase().ends_with("-setup.exe") {
            chosen = Some(asset);
            if name.starts_with("MaobuTranslator_") {
                break;
            }
        }
    }
    let asset = chosen?;
    let digest = asset
        .get("digest")
        .and_then(|v| v.as_str())
        .and_then(parse_digest_sha256)?;
    let size = asset.get("size").and_then(|v| v.as_u64());
    Some((digest, size))
}

fn validate_installer_url(url: &str) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("https://github.com/")
        || lower.starts_with("https://objects.githubusercontent.com/")
    {
        validate_direct_installer_url(url)
    } else {
        validate_mirror_installer_url(url)
    }
}

fn verify_installer(downloaded: u64, content_length: u64, expected_size: Option<u64>, actual_hash: &str, expected_hash: &str) -> Result<(), String> {
    if downloaded <= 512 * 1024 || downloaded > MAX_INSTALLER_BYTES {
        return Err("下载的安装包体积无效".to_string());
    }
    if (content_length > 0 && downloaded != content_length)
        || expected_size.filter(|size| *size > 0).is_some_and(|size| downloaded != size) {
        return Err("安装包下载不完整或体积与发布信息不符".to_string());
    }
    if actual_hash != expected_hash {
        return Err("安装包 SHA-256 校验失败，已取消安装".to_string());
    }
    Ok(())
}

fn escape_powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[tauri::command]
pub async fn cmd_download_and_install_update(
    app: tauri::AppHandle,
    url: String,
    silent: Option<bool>,
    sha256: Option<String>,
    expected_size: Option<u64>,
) -> Result<String, String> {
    validate_installer_url(&url)?;
    let mut expected_hash = sha256.as_deref().and_then(normalize_sha256);
    let mut expected_size = expected_size;
    if expected_size.unwrap_or(0) > MAX_INSTALLER_BYTES {
        return Err("更新包体积超过允许的上限".to_string());
    }

    // A manifest freshly produced by `bump_version.py` intentionally carries no digest
    // (the binary does not exist yet), and the CDN may briefly serve that placeholder
    // state after a release. Recover the real digest from the GitHub release itself so
    // the user is not dead-ended by a transient publishing window.
    if expected_hash.is_none() || expected_size.is_none() {
        if let Some((recovered_hash, recovered_size)) = fetch_release_digest(&url).await {
            if expected_hash.is_none() {
                eprintln!("[Updater] 清单缺少校验值，已从 GitHub Release 恢复");
                expected_hash = Some(recovered_hash);
            }
            if expected_size.is_none() {
                expected_size = recovered_size;
            }
        }
    }

    let expected_hash = expected_hash
        .ok_or("更新包缺少有效的 SHA-256 校验值，请前往发布页面手动下载")?;

    let client = build_download_client()?;
    let candidate_urls = build_candidate_download_urls(&url);
    let mut last_error = String::new();

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let (reserved, temp_installer) = tempfile::Builder::new()
        .prefix("MaobuTranslator_Update_").suffix(".exe").tempfile()
        .map_err(|e| format!("创建临时安装包失败: {e}"))?
        .keep().map_err(|e| format!("保留临时安装包失败: {e}"))?;
    drop(reserved);

    let mut download_succeeded = false;

    for target_url in candidate_urls {
        // Candidates may be synthesised locally (mirror/variant), so each one is
        // re-screened here rather than trusted because it came from our own list.
        if let Err(reason) = validate_installer_url(&target_url) {
            eprintln!("[Updater] 跳过不受信任的更新源 {}: {}", target_url, reason);
            last_error = reason;
            continue;
        }
        eprintln!("[Updater] 尝试下载更新包: {}", target_url);
        match client.get(&target_url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_error = format!("HTTP {}", resp.status().as_u16());
                    continue;
                }

                let total_bytes = resp.content_length().unwrap_or(0);
                if total_bytes > MAX_INSTALLER_BYTES {
                    last_error = "更新包体积超过允许的上限".to_string();
                    continue;
                }
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
                let mut hasher = Sha256::new();

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
                            if downloaded_bytes.saturating_add(chunk.len() as u64) > MAX_INSTALLER_BYTES {
                                last_error = "更新包体积超过允许的上限".to_string();
                                chunk_error = true;
                                break;
                            }
                            if let Err(e) = file.write_all(&chunk) {
                                last_error = format!("写入安装包数据失败: {e}");
                                chunk_error = true;
                                break;
                            }
                            downloaded_bytes += chunk.len() as u64;
                            hasher.update(&chunk);

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

                if let Err(e) = file.flush().and_then(|_| file.sync_all()) {
                    last_error = format!("保存安装包失败: {e}");
                    chunk_error = true;
                }
                drop(file);

                if chunk_error {
                    let _ = std::fs::remove_file(&temp_installer);
                    continue;
                }

                let actual_hash = format!("{:x}", hasher.finalize());
                if let Err(error) = verify_installer(downloaded_bytes, total_bytes, expected_size, &actual_hash, &expected_hash) {
                    last_error = error;
                    let _ = std::fs::remove_file(&temp_installer);
                } else {
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
                }
            }
            Err(e) => {
                last_error = e.to_string();
            }
        }
    }

    if !download_succeeded {
        let _ = std::fs::remove_file(&temp_installer);
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

        let target_exe = if !current_exe_path.is_empty() && !current_exe_path.to_lowercase().contains("temp") {
            current_exe_path
        } else {
            std::env::var("LOCALAPPDATA")
                .map(|p| std::path::Path::new(&p).join("猫步翻译").join("MaobuTranslator.exe").to_string_lossy().to_string())
                .unwrap_or_else(|_| r"C:\Program Files\猫步翻译\MaobuTranslator.exe".to_string())
        };

        // 统一生成原生支持 Unicode 中文字符的 PowerShell 升级执行脚本，彻底根治 Windows 默认代码页 (GBK 936) 导致的「鐚缈昏瘧」乱码找不到文件问题
        let ps_script_path = std::env::temp_dir().join(format!("maobu_update_{timestamp}.ps1"));
        let ps_content = if is_silent {
            format!(
                "Start-Sleep -Seconds 2;\r\n\
                 Start-Process -FilePath '{}' -ArgumentList '/S' -Wait;\r\n\
                 Start-Sleep -Seconds 1;\r\n\
                 Start-Process -FilePath '{}';\r\n\
                 Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue;\r\n",
                escape_powershell_literal(&temp_installer.to_string_lossy()),
                escape_powershell_literal(&target_exe)
            )
        } else {
            format!(
                "Start-Sleep -Seconds 2;\r\n\
                 Start-Process -FilePath '{}';\r\n\
                 Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue;\r\n",
                escape_powershell_literal(&temp_installer.to_string_lossy())
            )
        };

        // 写入带 UTF-8 BOM 的脚本（PowerShell 5.1/7+ 均原生识别 UTF-8）
        let mut ps_bytes = vec![0xEF, 0xBB, 0xBF];
        ps_bytes.extend_from_slice(ps_content.as_bytes());

        if let Err(e) = std::fs::write(&ps_script_path, ps_bytes) {
            eprintln!("[Updater] 写入 PowerShell 升级脚本失败: {e}，回退直接启动安装包");
            let mut command = std::process::Command::new(&temp_installer);
            if is_silent { command.arg("/S"); }
            command.spawn().map_err(|e| format!("启动安装包失败: {e}"))?;
        } else {
            std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    ps_script_path.to_string_lossy().as_ref(),
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("启动升级脚本失败: {e}"))?;
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
    fn cdn_assets_preserve_download_urls_and_checksums() {
        let hash = "a".repeat(64);
        let url = "https://github.com/maobukeai/catwalk-translator/releases/download/v0.4.0/MaobuTranslator_0.4.0_x64-setup.exe";
        let body = serde_json::json!({"version": "0.4.0", "assets": [{"name": "setup.exe", "url": url, "size": 1000000, "sha256": hash}]}).to_string();
        let info = parse_cdn_version_info(&body, "0.3.38").unwrap().latest.unwrap();
        assert_eq!(info.assets[0].url, url);
        assert_eq!(info.assets[0].sha256.as_deref(), Some(hash.as_str()));
        assert_eq!(info.assets[0].size, 1000000);
    }

    #[test]
    fn rejects_untrusted_installers_and_incomplete_or_corrupt_downloads() {
        let valid = "https://github.com/maobukeai/catwalk-translator/releases/download/v0.4.0/MaobuTranslator_0.4.0_x64-setup.exe";
        assert!(validate_installer_url(valid).is_ok());
        for url in [valid.replace("github.com", "github.com.attacker.test"), valid.replace("https:", "http:"), valid.replace("maobukeai", "other"), valid.replace("-setup.exe", "_portable.exe"), format!("{valid}?unexpected=1")] {
            assert!(validate_installer_url(&url).is_err());
        }
        let hash = "b".repeat(64);
        assert!(verify_installer(1000000, 1000000, Some(1000000), &hash, &hash).is_ok());
        assert!(verify_installer(1000000, 2000000, None, &hash, &hash).is_err());
        assert!(verify_installer(1000000, 0, Some(2000000), &hash, &hash).is_err());
        assert!(verify_installer(1000000, 0, None, &"c".repeat(64), &hash).is_err());
        assert!(verify_installer(12, 12, None, &hash, &hash).is_err());
        assert_eq!(escape_powershell_literal("C:\\O'Brien\\猫步.exe"), "C:\\O''Brien\\猫步.exe");
    }

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

    /// 回归：`build_candidate_download_urls` 生成的镜像候选必须同样能通过校验，
    /// 否则受信任的加速镜像会被误杀，导致所有加速下载静默失败。
    #[test]
    fn every_generated_candidate_passes_url_screening() {
        let url = "https://github.com/maobukeai/catwalk-translator/releases/download/v0.3.38/MaobuTranslator_0.3.38_x64-setup.exe";
        for candidate in build_candidate_download_urls(url) {
            assert!(
                validate_installer_url(&candidate).is_ok(),
                "合法候选地址被误判为不可信: {candidate}"
            );
        }
    }

    /// 回归：镜像不得把安装包重定向到本项目 GitHub Releases 之外的地址。
    #[test]
    fn mirror_pointing_elsewhere_is_rejected() {
        let evil = [
            "https://ghfast.top/https://evil.example.com/MaobuTranslator_1.0.0_x64-setup.exe",
            "https://ghfast.top/https://github.com/attacker/repo/releases/download/v1.0.0/MaobuTranslator_1.0.0_x64-setup.exe",
            "https://ghfast.top/http://github.com/maobukeai/catwalk-translator/releases/download/v1.0.0/MaobuTranslator_1.0.0_x64-setup.exe",
            "https://evil-mirror.example.com/https://github.com/maobukeai/catwalk-translator/releases/download/v1.0.0/MaobuTranslator_1.0.0_x64-setup.exe",
            "https://ghfast.top/https://github.com/maobukeai/catwalk-translator/releases/download/v1.0.0/payload.zip",
        ];
        for url in evil {
            assert!(validate_installer_url(url).is_err(), "恶意镜像未被拦截: {url}");
        }
    }

    /// 回归：安装包绝不能来自非 HTTPS 或携带凭据的来源。
    #[test]
    fn insecure_installer_urls_are_rejected() {
        for url in [
            "http://github.com/maobukeai/catwalk-translator/releases/download/v1.0.0/MaobuTranslator_1.0.0_x64-setup.exe",
            "https://user:pass@github.com/maobukeai/catwalk-translator/releases/download/v1.0.0/MaobuTranslator_1.0.0_x64-setup.exe",
            "https://github.com:8443/maobukeai/catwalk-translator/releases/download/v1.0.0/MaobuTranslator_1.0.0_x64-setup.exe?x=1",
        ] {
            assert!(validate_installer_url(url).is_err(), "不安全地址未被拦截: {url}");
        }
    }

    /// 回归：直连主机白名单必须是受信任白名单的子集，且每个受信任直连主机都真的
    /// 能通过校验。两份清单若各自漂移，就会出现"声明受信任却永远被拒"的死分支。
    #[test]
    fn allow_lists_stay_consistent() {
        for host in ALLOWED_DIRECT_HOSTS {
            assert!(
                TRUSTED_INSTALLER_HOSTS.contains(host),
                "直连主机 {host} 未出现在受信任清单中"
            );
        }
        for host in ALLOWED_DIRECT_HOSTS {
            let url = format!(
                "https://{host}/maobukeai/catwalk-translator/releases/download/v0.3.38/MaobuTranslator_0.3.38_x64-setup.exe"
            );
            assert!(
                validate_installer_url(&url).is_ok(),
                "受信任直连主机 {host} 实际被拒绝"
            );
        }
    }

    /// 回归：objects.githubusercontent.com 是 GitHub 的直链/重定向主机，声明为受信任
    /// 直连主机后就必须真的能通过校验；否则该分支形同虚设（永远返回错误）。
    #[test]
    fn trusted_github_content_host_is_actually_usable() {
        assert!(
            ALLOWED_DIRECT_HOSTS.contains(&"objects.githubusercontent.com"),
            "该主机若不受信任，就不应出现在白名单里"
        );
        let url = "https://objects.githubusercontent.com/maobukeai/catwalk-translator/releases/download/v0.3.38/MaobuTranslator_0.3.38_x64-setup.exe";
        assert!(
            validate_installer_url(url).is_ok(),
            "受信任直连主机被错误拒绝: {url}"
        );
        // A non-project path on that host must still be rejected.
        let evil = "https://objects.githubusercontent.com/attacker/repo/releases/download/v1/MaobuTranslator_1.0.0_x64-setup.exe";
        assert!(validate_installer_url(evil).is_err(), "非本项目路径未被拦截");
    }

    /// 真正的 GitHub 直连地址必须继续被接受。
    #[test]
    fn legitimate_direct_installer_url_is_accepted() {
        let url = "https://github.com/maobukeai/catwalk-translator/releases/download/v0.3.38/MaobuTranslator_0.3.38_x64-setup.exe";
        assert!(validate_installer_url(url).is_ok());
    }

    /// 回归：当 CDN 清单尚未写入校验值（bump 之后、发布完成之前）时，
    /// 回退逻辑依赖从安装包 URL 反推出 GitHub Release tag。
    #[test]
    fn installer_url_yields_release_tag_for_digest_recovery() {
        let url = "https://github.com/maobukeai/catwalk-translator/releases/download/v0.3.38/MaobuTranslator_0.3.38_x64-setup.exe";
        let tag = extract_release_tag_from_download_url(url).expect("tag");
        assert_eq!(tag, "v0.3.38");
        // A mirror-wrapped URL must resolve to the same tag.
        let mirrored = format!("https://ghfast.top/{url}");
        assert_eq!(extract_release_tag_from_download_url(&mirrored).as_deref(), Some("v0.3.38"));
        // The redirect-oriented helper must NOT be used for download URLs: it would
        // silently return the file name and query the wrong release.
        assert_eq!(
            extract_tag_from_location(url).as_deref(),
            Some("MaobuTranslator_0.3.38_x64-setup.exe")
        );
    }

    /// 回归：占位清单（sha256=null, size=0）必须能被解析出来，而不是被当成损坏数据丢弃，
    /// 否则更新器无法察觉"需要回退取摘要"这一状态。
    #[test]
    fn placeholder_manifest_is_parsed_and_flagged_as_missing_digest() {
        let body = r#"{"version":"0.3.39","assets":[{"name":"MaobuTranslator_0.3.39_x64-setup.exe","url":"https://github.com/maobukeai/catwalk-translator/releases/download/v0.3.39/MaobuTranslator_0.3.39_x64-setup.exe","size":0,"sha256":null}]}"#;
        let res = parse_cdn_version_info(body, "0.3.38").expect("parses");
        assert!(res.has_update);
        let asset = &res.latest.unwrap().assets[0];
        assert!(asset.sha256.is_none(), "占位清单不应携带摘要");
        assert_eq!(asset.size, 0);
    }
}
