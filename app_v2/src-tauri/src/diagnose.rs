//! 网络诊断：并发探测各翻译引擎 / LLM 端点 / 更新源的可达性与延迟，
//! 帮用户快速区分「网络问题」与「配置问题」。探测走统一的
//! create_http_client（携带手动代理 / 系统代理配置），反映真实网络环境。
use serde::Serialize;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagItem {
    pub name: String,
    /// engine | llm | update | proxy
    pub kind: String,
    pub ok: bool,
    pub skipped: bool,
    pub latency_ms: u64,
    pub detail: String,
}

async fn probe(client: reqwest::Client, name: String, kind: String, url: String) -> DiagItem {
    let start = Instant::now();
    match client.get(&url).send().await {
        Ok(resp) => DiagItem {
            name,
            kind,
            ok: true,
            skipped: false,
            latency_ms: start.elapsed().as_millis() as u64,
            detail: format!("HTTP {}", resp.status().as_u16()),
        },
        Err(e) => DiagItem {
            name,
            kind,
            ok: false,
            skipped: false,
            latency_ms: start.elapsed().as_millis() as u64,
            detail: format!("{}", e).chars().take(90).collect(),
        },
    }
}

#[tauri::command]
pub async fn cmd_network_diagnose(
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<Vec<DiagItem>, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| format!("锁定设置失败: {}", e))?
        .clone();

    crate::translator::set_network_config_from_settings(&settings);
    let net_cfg = crate::translator::get_network_config();
    let client = crate::translator::create_http_client(6000);

    let mut probes: Vec<std::pin::Pin<Box<dyn std::future::Future<Output = DiagItem> + Send>>> =
        Vec::new();

    // 在线引擎
    probes.push(Box::pin(probe(
        client.clone(),
        "Google 翻译".into(),
        "engine".into(),
        "https://translate.googleapis.com/".into(),
    )));
    probes.push(Box::pin(probe(
        client.clone(),
        "Bing 词典".into(),
        "engine".into(),
        "https://cn.bing.com/".into(),
    )));
    probes.push(Box::pin(probe(
        client.clone(),
        "百度翻译".into(),
        "engine".into(),
        "https://fanyi.baidu.com/".into(),
    )));
    if settings.deepl_api_key.as_deref().is_some_and(|k| !k.is_empty()) {
        probes.push(Box::pin(probe(
            client.clone(),
            "DeepL".into(),
            "engine".into(),
            "https://api.deepl.com/".into(),
        )));
    }

    // LLM 端点（取配置的 Base URL；未配置则标记跳过）
    if let Some(llm) = &settings.llm_config {
        if !llm.endpoint.trim().is_empty() {
            probes.push(Box::pin(probe(
                client.clone(),
                format!("LLM 端点 ({})", if llm.provider.is_empty() { "自定义" } else { &llm.provider }),
                "llm".into(),
                llm.endpoint.trim().to_string(),
            )));
        }
    }

    // 更新源
    probes.push(Box::pin(probe(
        client.clone(),
        "GitHub (更新检查)".into(),
        "update".into(),
        "https://api.github.com/".into(),
    )));

    // 离线词典数据源 (jsDelivr 高速镜像)
    probes.push(Box::pin(probe(
        client.clone(),
        "ECDICT 词典源 (jsDelivr)".into(),
        "update".into(),
        "https://fastly.jsdelivr.net/gh/skywind3000/ECDICT@master/README.md".into(),
    )));

    let mut items = futures_util::future::join_all(probes).await;

    // 代理链路信息（支持跟随系统 / 不使用代理 / 手动代理 + 国内服务直连绕过）
    let bypass_label = if net_cfg.proxy_bypass_domestic {
        "国内直连分流: 开启"
    } else {
        "国内直连分流: 关闭"
    };

    let (proxy_ok, proxy_detail) = match net_cfg.proxy_mode.as_str() {
        "direct" => (
            true,
            "不使用代理（已强制全局直连，忽略系统与环境代理）".to_string(),
        ),
        "manual" => {
            if let Some(raw_url) = net_cfg.proxy_url.as_deref() {
                let parsed = crate::translator::parse_proxy_to_url(raw_url);
                let alive = crate::translator::extract_proxy_host_port(raw_url)
                    .and_then(|host_port| {
                        std::net::ToSocketAddrs::to_socket_addrs(&host_port.as_str())
                            .ok()
                            .and_then(|mut addrs| addrs.next())
                    })
                    .map(|addr| {
                        std::net::TcpStream::connect_timeout(
                            &addr,
                            std::time::Duration::from_millis(1000),
                        )
                        .is_ok()
                    })
                    .unwrap_or(false);
                if alive {
                    (
                        true,
                        format!("手动代理: {} ({})", parsed, bypass_label),
                    )
                } else {
                    (
                        false,
                        format!("手动代理端口不可达: {}（请检查代理客户端是否启动）", parsed),
                    )
                }
            } else {
                (
                    false,
                    "手动代理已开启但未填写代理服务器地址".to_string(),
                )
            }
        }
        _ => match crate::translator::effective_proxy() {
            Some(p) => (
                true,
                format!("跟随系统: 经代理 {} ({})", p, bypass_label),
            ),
            None => (
                true,
                "跟随系统: 直连（未检测到活动系统代理）".to_string(),
            ),
        },
    };

    items.push(DiagItem {
        name: "代理链路".into(),
        kind: "proxy".into(),
        ok: proxy_ok,
        skipped: false,
        latency_ms: 0,
        detail: proxy_detail,
    });

    let policy = crate::translator::retry_policy_for_preset(&net_cfg.retry_preset);
    let retry_label = match net_cfg.retry_preset.as_str() {
        "none" => "不重试 (0 次重试 · 极速失败)".to_string(),
        "fast" => format!("快速重试 (最多 {} 次 · {}ms 初始退避)", policy.max_retries, policy.base_delay_ms),
        "resilient" | "aggressive" => format!(
            "强力抗抖动 (最多 {} 次 · {}ms 指数退避 · 超时 {:.1}x)",
            policy.max_retries, policy.base_delay_ms, policy.timeout_multiplier
        ),
        _ => format!("标准均衡 (最多 {} 次 · {}ms 指数退避)", policy.max_retries, policy.base_delay_ms),
    };
    items.push(DiagItem {
        name: "重试策略".into(),
        kind: "proxy".into(),
        ok: true,
        skipped: false,
        latency_ms: 0,
        detail: retry_label,
    });

    Ok(items)
}
