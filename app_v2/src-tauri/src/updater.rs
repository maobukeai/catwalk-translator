use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;

pub const GITHUB_OWNER: &str = "maobukeai";
pub const GITHUB_REPO: &str = "catwalk-translator";

pub const RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/maobukeai/catwalk-translator/releases/latest";
pub const RELEASES_PAGE: &str = "https://github.com/maobukeai/catwalk-translator/releases";

pub const RELEASES_WEB_LATEST_URL: &str =
    "https://github.com/maobukeai/catwalk-translator/releases/latest";

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const APP_NAME: &str = "猫步翻译";

const USER_AGENT: &str = concat!(
    "MaobuTranslator/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/maobukeai/catwalk-translator)"
);

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
            // 客户端构建异常时尝试网页 302 探针
            if let Some(fallback_res) = check_update_via_html_redirect(current).await {
                return fallback_res;
            }
            return error_result(current, &e);
        }
    };

    let response = match client.get(RELEASES_LATEST_URL).send().await {
        Ok(r) => r,
        Err(e) => {
            // 直连 API 超时或网络异常时，立即无缝降级到免限流 302 探针
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
        // 关键点：当遇到 403 限流、429、500 等任何异常时，优先触发免限流 302 探针！
        if let Some(fallback_res) = check_update_via_html_redirect(current).await {
            return fallback_res;
        }

        let err_body = response.text().await.unwrap_or_default();
        let display_err = if status.as_u16() == 403
            && (err_body.contains("rate limit") || err_body.contains("Rate limit"))
        {
            "当前网络 IP 请求 GitHub 接口触发限流 (403)，请稍后重试或开启系统代理".to_string()
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
            if let Some(fallback_res) = check_update_via_html_redirect(current).await {
                return fallback_res;
            }
            return error_result(current, &format!("读取更新响应失败：{e}"));
        }
    };
    let json: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            if let Some(fallback_res) = check_update_via_html_redirect(current).await {
                return fallback_res;
            }
            return error_result(current, &format!("解析更新信息失败：{e}"));
        }
    };

    let Some(info) = parse_release(&json) else {
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

#[tauri::command]
pub async fn cmd_download_and_install_update(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    if url.trim().is_empty() {
        return Err("下载地址为空".to_string());
    }

    let client = build_update_client().map_err(|e| format!("创建下载客户端失败: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求安装包失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "下载服务器返回 HTTP {}",
            response.status().as_u16()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取安装包数据失败: {e}"))?;
    let temp_installer = std::env::temp_dir().join("MaobuTranslator_Setup_Update.exe");
    std::fs::write(&temp_installer, bytes).map_err(|e| format!("保存安装包到临时目录失败: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&temp_installer)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
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
}
