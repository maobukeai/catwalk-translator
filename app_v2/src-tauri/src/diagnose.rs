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

fn probe(client: reqwest::Client, name: String, kind: String, url: String) -> impl std::future::Future<Output = DiagItem> + Send + 'static {
    // 任意 HTTP 响应（含 4xx/5xx）都证明链路可达；超时/连接错误才算故障
    async move {
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
    if settings.deepl_api_key.as_deref().map_or(false, |k| !k.is_empty()) {
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

    // 离线词典数据源
    probes.push(Box::pin(probe(
        client.clone(),
        "ECDICT 词典源".into(),
        "update".into(),
        "https://raw.githubusercontent.com/skywind3000/ECDICT/master/README.md".into(),
    )));

    let mut items = futures_util::future::join_all(probes).await;

    // 代理链路信息（手动代理优先，其次系统代理）
    let proxy_detail = crate::translator::effective_proxy()
        .map(|p| format!("经代理: {}", p))
        .unwrap_or_else(|| "直连（未检测到系统代理）".to_string());
    items.push(DiagItem {
        name: "代理链路".into(),
        kind: "proxy".into(),
        ok: true,
        skipped: false,
        latency_ms: 0,
        detail: proxy_detail,
    });

    Ok(items)
}
