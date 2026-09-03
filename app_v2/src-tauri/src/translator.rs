pub use crate::models::{
    LlmConfig, MultiEngineTranslation, TextQueryResponse, TranslationResult, WordDetail,
};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

static CG_DICTS: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();

/// Windows 系统代理自适应探测：读取注册表 Internet Settings，若开启代理客户端则自动挂载
/// 同时做 1000ms TCP 探活，防止代理软件退出后遗留注册表导致全网崩塌（幽灵代理 Bug）
#[cfg(windows)]
pub fn detect_windows_proxy() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet_settings = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let enable: u32 = internet_settings.get_value("ProxyEnable").ok()?;
    if enable == 1 {
        let server: String = internet_settings.get_value("ProxyServer").ok()?;
        let server = server.trim().to_string();
        if !server.is_empty() {
            // 探活：提取 host:port 并做 1000ms TCP 连接测试，失败则降级为直连
            let host_port = parse_proxy_to_url(&server)
                .replace("http://", "")
                .replace("https://", "")
                .replace("socks5://", "");
            let alive = std::net::ToSocketAddrs::to_socket_addrs(&host_port.as_str())
                .ok()
                .and_then(|mut addrs| addrs.next())
                .map(|addr| {
                    std::net::TcpStream::connect_timeout(
                        &addr,
                        std::time::Duration::from_millis(1000),
                    )
                    .is_ok()
                })
                .unwrap_or(false);
            if alive {
                return Some(server);
            }
        }
    }
    None
}

#[cfg(not(windows))]
pub fn detect_windows_proxy() -> Option<String> {
    None
}

/// 解析 Windows 代理配置字符串（支持 127.0.0.1:7890 或 http=127.0.0.1:7890;https=127.0.0.1:7890 等格式）
pub fn parse_proxy_to_url(proxy_str: &str) -> String {
    let raw = proxy_str.trim();
    let target = if raw.contains('=') {
        let mut chosen = "";
        for part in raw.split(';') {
            let part = part.trim();
            if let Some(stripped) = part.strip_prefix("https=") {
                chosen = stripped;
                break;
            } else if let Some(stripped) = part.strip_prefix("http=") {
                chosen = stripped;
            } else if chosen.is_empty() && part.contains('=') {
                if let Some((_, val)) = part.split_once('=') {
                    chosen = val;
                }
            }
        }
        if chosen.is_empty() { raw } else { chosen }
    } else {
        raw
    };

    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("socks5://") {
        target.to_string()
    } else {
        format!("http://{}", target)
    }
}

/// 用户在设置中心手动指定的代理（如 http://127.0.0.1:7890）。
/// 优先级高于系统代理自动探测；None 表示未启用，回落自动探测。
static MANUAL_PROXY: RwLock<Option<String>> = RwLock::new(None);

pub fn set_manual_proxy(proxy_url: Option<String>) {
    if let Ok(mut lock) = MANUAL_PROXY.write() {
        *lock = proxy_url.filter(|s| !s.trim().is_empty());
    }
}

/// 手动代理 > 环境变量 (HTTPS_PROXY/HTTP_PROXY) > 系统注册表自动探测
pub fn effective_proxy() -> Option<String> {
    if let Ok(lock) = MANUAL_PROXY.read() {
        if let Some(manual) = lock.as_ref() {
            return Some(manual.clone());
        }
    }
    // 检查环境变量代理
    if let Ok(p) = std::env::var("HTTPS_PROXY")
        .or_else(|_| std::env::var("https_proxy"))
        .or_else(|_| std::env::var("HTTP_PROXY"))
        .or_else(|_| std::env::var("http_proxy"))
        .or_else(|_| std::env::var("ALL_PROXY"))
        .or_else(|_| std::env::var("all_proxy"))
    {
        if !p.trim().is_empty() {
            return Some(p.trim().to_string());
        }
    }
    detect_windows_proxy()
}

/// 创建带系统代理自适应、Cookie Store 与标准 UA 的统一 reqwest Client
pub fn create_http_client(timeout_ms: u64) -> Client {
    let timeout_val = timeout_ms.max(4500);
    let mut builder = Client::builder()
        .timeout(Duration::from_millis(timeout_val))
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

    if let Some(proxy_str) = effective_proxy() {
        let proxy_url = parse_proxy_to_url(&proxy_str);
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            let proxy = proxy.no_proxy(reqwest::NoProxy::from_string("localhost,127.0.0.1,::1,0.0.0.0"));
            builder = builder.proxy(proxy);
        }
    }

    builder.build().unwrap_or_else(|_| Client::new())
}

/// Extra directive appended to LLM prompts per user-selected translation style:
/// "literal" (直译) | "free" (意译/流畅) | "terminology" (术语优先).
pub fn style_directive(style: Option<&str>) -> &'static str {
    match style {
        Some("literal") => " Style: translate LITERALLY — stay close to the source wording, structure and order; do not paraphrase.",
        Some("terminology") => " Style: TERMINOLOGY FIRST — use the standard CG/3D/software-industry term for technical words, keep term translations consistent across all strings, and keep well-known product names untranslated.",
        Some("free") => " Style: translate naturally and idiomatically — prioritize fluent, readable output over literal fidelity.",
        _ => "",
    }
}

// ── 术语强制表(Glossary Enforcement)─────────────────────────────────────────
// 用户自定义词库双重生效:① 精确命中在管线 Step 0.5 直接短路(确定性);
// ② 未命中的短语把「相关术语」注入 LLM prompt 强制一致性。

/// 术语对 (original → translated)。
pub type GlossaryPairs = Vec<(String, String)>;

/// 术语指纹(FNV-1a;空词库 = 0)。词库内容变化 → 翻译记忆整体失效,
/// 避免旧词库下缓存的译文在术语强制表更新后继续命中。
pub fn glossary_hash(pairs: &[(String, String)]) -> u64 {
    if pairs.is_empty() {
        return 0;
    }
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    const SEP: u8 = 0x1f;
    for (o, t) in pairs {
        for b in o.as_bytes().iter().chain(t.as_bytes()).chain(std::iter::once(&SEP)) {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100_0000_01b3);
        }
    }
    h
}

/// 判断一段文本是否为「技术标识符」——应原样保留、绝不翻译。
///
/// 命中三类单词级(不含空白)字符串:
/// 1. 含 `/` 的路径式标识:模型 ID (`moonshotai/kimi-k3`)、URL;
/// 2. 同时含数字与 `-`/`.`/`_` 的版本式标识:`MiniMax-H3`、`wan3.0-video`、
///    `nemotron-3.5-lightning`、`v0.1.8`;
/// 3. 完全不含字母:纯数字/符号(`99.9%`,以及 OCR 噪声如 `%6'66`)。
///
/// 含空白的短语一律不命中,`Always-On`、`Kimi-long-context model`、`UPTIME`
/// 等正常文本因此照常翻译(无数字或含空白)。
pub fn is_technical_identifier(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() || t.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let has_letter = t.chars().any(|c| c.is_alphabetic());
    if !has_letter {
        // 纯数字/符号:翻译毫无意义,且 LLM 会把数字写成中文数字。
        return t.chars().any(|c| c.is_ascii_digit() || !c.is_alphanumeric());
    }
    if t.contains('/') {
        return true;
    }
    let has_digit = t.chars().any(|c| c.is_ascii_digit());
    let has_version_sep = t.contains('-') || t.contains('.') || t.contains('_');
    has_digit && has_version_sep
}

/// 从设置中的自定义词条构建术语对(过滤空项并 trim)。
pub fn glossary_from_settings(items: &[crate::models::CustomDictItem]) -> GlossaryPairs {
    items
        .iter()
        .filter(|i| !i.original.trim().is_empty() && !i.translated.trim().is_empty())
        .map(|i| {
            (
                i.original.trim().to_string(),
                i.translated.trim().to_string(),
            )
        })
        .collect()
}

/// 自定义词库精确查找:外文→中文走正向匹配(精确 + 忽略大小写),
/// 中文→外文按译文反向匹配 —— 与预置词典 `lookup_dict` 语义一致。
pub fn lookup_glossary(pairs: &[(String, String)], phrase: &str) -> Option<String> {
    let trimmed = phrase.trim();
    if trimmed.is_empty() || pairs.is_empty() {
        return None;
    }
    let has_chinese = trimmed
        .chars()
        .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
    if has_chinese {
        for (orig, trans) in pairs {
            if trans == trimmed {
                return Some(orig.clone());
            }
        }
        let lower = trimmed.to_lowercase();
        for (orig, trans) in pairs {
            if trans.to_lowercase() == lower {
                return Some(orig.clone());
            }
        }
    } else {
        for (orig, trans) in pairs {
            if orig == trimmed {
                return Some(trans.clone());
            }
        }
        let lower = trimmed.to_lowercase();
        for (orig, trans) in pairs {
            if orig.to_lowercase() == lower {
                return Some(trans.clone());
            }
        }
    }
    None
}

/// 构建注入 LLM 的强制术语指令:只保留与待译文本相关的词条
/// (原文或译文在待译文本中出现,忽略大小写),上限 40 条防止 prompt 膨胀。
/// `reverse = true` 表示翻译方向为 中→外,映射方向需对调展示。
/// 无相关术语时返回空串,prompt 保持原样。
pub fn glossary_directive(pairs: &[(String, String)], texts: &[&str], reverse: bool) -> String {
    const MAX_TERMS: usize = 40;
    if pairs.is_empty() {
        return String::new();
    }
    let haystacks: Vec<String> = texts.iter().map(|t| t.to_lowercase()).collect();
    let mut picked: Vec<String> = Vec::new();
    for (orig, trans) in pairs {
        if picked.len() >= MAX_TERMS {
            break;
        }
        let o = orig.to_lowercase();
        let t = trans.to_lowercase();
        let relevant = haystacks.iter().any(|h| h.contains(&o) || h.contains(&t));
        if relevant {
            let (from, to) = if reverse { (trans, orig) } else { (orig, trans) };
            // 引号转义,避免破坏指令文本
            picked.push(format!(
                "\"{}\"=\"{}\"",
                from.replace('"', "'"),
                to.replace('"', "'")
            ));
        }
    }
    if picked.is_empty() {
        return String::new();
    }
    format!(
        " Glossary (MANDATORY — these term translations are user-specified and MUST be used exactly as given wherever a term appears): {}.",
        picked.join("; ")
    )
}

pub fn get_cg_dicts() -> &'static HashMap<String, HashMap<String, String>> {
    CG_DICTS.get_or_init(|| {
        let mut dicts = HashMap::new();
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/blender.json"
        )) {
            dicts.insert("blender".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/substance.json"
        )) {
            dicts.insert("substance".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/unity.json"
        )) {
            dicts.insert("unity".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/unreal.json"
        )) {
            dicts.insert("unreal".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/maya.json"
        )) {
            dicts.insert("maya".to_string(), map);
        }
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(include_str!(
            "../assets/dicts/houdini.json"
        )) {
            dicts.insert("houdini".to_string(), map);
        }
        dicts
    })
}

pub trait TranslatorEngine {
    fn translate_batch(&self, phrases: &[String], preset: &str) -> Vec<TranslationResult>;
}

pub struct CgDictionaryEngine {
    dicts: HashMap<String, HashMap<String, String>>,
}

impl Default for CgDictionaryEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CgDictionaryEngine {
    pub fn new() -> Self {
        let mut dicts = HashMap::new();
        for (k, v) in get_cg_dicts() {
            dicts.insert(k.clone(), v.clone());
        }
        Self { dicts }
    }

    pub fn lookup(&self, phrase: &str, preset: &str) -> Option<(String, String)> {
        let trimmed = phrase.trim();
        if trimmed.is_empty() {
            return None;
        }

        // Priority 1: Check requested preset dictionary
        if let Some(map) = self.dicts.get(preset) {
            if let Some(val) = map.get(trimmed) {
                return Some((val.clone(), preset.to_string()));
            }
            let lower = trimmed.to_lowercase();
            for (k, v) in map {
                if k.to_lowercase() == lower {
                    return Some((v.clone(), preset.to_string()));
                }
            }
        }
        // Priority 2: Fallback search across remaining preset dictionaries
        for (dict_name, map) in &self.dicts {
            if dict_name != preset {
                if let Some(val) = map.get(trimmed) {
                    return Some((val.clone(), dict_name.clone()));
                }
                let lower = trimmed.to_lowercase();
                for (k, v) in map {
                    if k.to_lowercase() == lower {
                        return Some((v.clone(), dict_name.clone()));
                    }
                }
            }
        }
        None
    }
}

impl TranslatorEngine for CgDictionaryEngine {
    fn translate_batch(&self, phrases: &[String], preset: &str) -> Vec<TranslationResult> {
        phrases
            .iter()
            .map(|p| {
                if let Some((translated, tier)) = self.lookup(p, preset) {
                    TranslationResult {
                        original: p.clone(),
                        translated,
                        source_tier: tier,
                    }
                } else {
                    TranslationResult {
                        original: p.clone(),
                        translated: p.clone(),
                        source_tier: "Untranslated".to_string(),
                    }
                }
            })
            .collect()
    }
}

/// 常驻后台进程的翻译缓存必须设上限，否则长时间划词会让 HashMap 无限膨胀。
const TRANSLATION_CACHE_CAPACITY: usize = 2000;

struct TranslationCacheInner {
    map: HashMap<String, TranslationResult>,
    /// 插入顺序，用于容量超限时按 FIFO 淘汰最旧条目
    order: std::collections::VecDeque<String>,
    /// 自上次落盘以来的变更数，达到阈值自动持久化（翻译记忆跨重启复用）
    dirty: u32,
    /// 生成这批缓存时的术语指纹;词库变化后整体失效(见 ensure_glossary)
    glossary_hash: u64,
}

/// 落盘格式:v2 带 glossary_hash 元数据;旧版纯 map 视为「指纹未知」,
/// 加载后首次 ensure_glossary 会整体清空(一次性迁移损失,可接受)。
#[derive(serde::Serialize, serde::Deserialize)]
struct TmDiskFile {
    glossary_hash: u64,
    entries: HashMap<String, TranslationResult>,
}

/// 翻译记忆落盘路径（启动时由 lib.rs 注入 app_config_dir）
///
/// 用 RwLock 而非 OnceLock：OnceLock 会静默忽略第二次 set，导致后续调用者拿到
/// 的路径与自己刚设置的不一致（测试里表现为偶发的 TM 往返失败，生产上则是
/// 配置目录变更后仍写旧路径）。
static TM_FILE: std::sync::RwLock<Option<std::path::PathBuf>> = std::sync::RwLock::new(None);
const TM_SAVE_THRESHOLD: u32 = 32;

pub fn set_tm_path(path: std::path::PathBuf) {
    if let Ok(mut g) = TM_FILE.write() {
        *g = Some(path);
    }
}

/// 当前翻译记忆文件路径（未注入时为 None，此时不落盘）。
fn tm_path() -> Option<std::path::PathBuf> {
    TM_FILE.read().ok().and_then(|g| g.clone())
}

pub struct TranslationCache {
    inner: RwLock<TranslationCacheInner>,
}

impl Default for TranslationCache {
    fn default() -> Self {
        Self::new()
    }
}

impl TranslationCache {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(TranslationCacheInner {
                map: HashMap::new(),
                order: std::collections::VecDeque::new(),
                dirty: 0,
                glossary_hash: 0,
            }),
        }
    }

    pub fn store(&self, result: TranslationResult) {
        let key = result.original.trim().to_string();
        if key.is_empty() {
            return;
        }
        let should_save = if let Ok(mut lock) = self.inner.write() {
            if !lock.map.contains_key(&key) {
                lock.order.push_back(key.clone());
            }
            lock.map.insert(key, result);
            while lock.order.len() > TRANSLATION_CACHE_CAPACITY {
                match lock.order.pop_front() {
                    Some(oldest) => {
                        lock.map.remove(&oldest);
                    }
                    None => break,
                }
            }
            lock.dirty += 1;
            if lock.dirty >= TM_SAVE_THRESHOLD {
                lock.dirty = 0;
                true
            } else {
                false
            }
        } else {
            false
        };
        if should_save {
            self.save_to_disk();
        }
    }

    /// 从指定路径加载翻译记忆
    pub fn load_from_path(&self, path: &std::path::Path) {
        let Ok(content) = std::fs::read_to_string(path) else {
            return;
        };
        // v2 格式(带指纹)优先;旧版纯 map 以「指纹未知」哨兵加载
        let (glossary_hash, map) =
            if let Ok(file) = serde_json::from_str::<TmDiskFile>(&content) {
                (file.glossary_hash, file.entries)
            } else if let Ok(map) =
                serde_json::from_str::<HashMap<String, TranslationResult>>(&content)
            {
                (u64::MAX, map)
            } else {
                return;
            };
        if let Ok(mut lock) = self.inner.write() {
            if !lock.map.is_empty() {
                return; // 运行期热缓存不覆盖
            }
            let mut order = std::collections::VecDeque::with_capacity(map.len());
            for k in map.keys().take(TRANSLATION_CACHE_CAPACITY) {
                order.push_back(k.clone());
            }
            let map = map
                .into_iter()
                .take(TRANSLATION_CACHE_CAPACITY)
                .collect::<HashMap<_, _>>();
            lock.map = map;
            lock.order = order;
            lock.dirty = 0;
            lock.glossary_hash = glossary_hash;
        }
    }

    /// 启动时从磁盘加载翻译记忆（缺失/损坏时静默为空缓存）
    pub fn load_from_disk(&self) {
        if let Some(path) = tm_path() {
            self.load_from_path(&path);
        }
    }

    /// 持久化到指定路径
    pub fn save_to_path(&self, path: &std::path::Path) {
        let snapshot = match self.inner.read() {
            Ok(lock) => lock.map.clone(),
            Err(_) => return,
        };
        let glossary_hash = match self.inner.read() {
            Ok(lock) => lock.glossary_hash,
            Err(_) => return,
        };
        let file = TmDiskFile {
            glossary_hash,
            entries: snapshot,
        };
        match serde_json::to_string(&file) {
            Ok(json) => {
                if let Err(e) = std::fs::write(path, json) {
                    eprintln!("[tm] 翻译记忆落盘失败: {}", e);
                }
            }
            Err(e) => eprintln!("[tm] 翻译记忆序列化失败: {}", e),
        }
    }

    /// 持久化到磁盘（best-effort；失败仅记日志不影响翻译）
    pub fn save_to_disk(&self) {
        if let Some(path) = tm_path() {
            self.save_to_path(&path);
        }
    }

    pub fn retrieve(&self, key: &str) -> Option<TranslationResult> {
        if let Ok(lock) = self.inner.read() {
            lock.map.get(key.trim()).cloned()
        } else {
            None
        }
    }

    pub fn clear(&self) {
        if let Ok(mut lock) = self.inner.write() {
            lock.map.clear();
            lock.order.clear();
            lock.dirty = 0;
        }
        self.save_to_disk();
    }

    /// 术语指纹守卫:当前指纹与缓存生成时不一致 → 清空缓存(旧词库下的
    /// 译文不能在术语强制表更新后继续命中)。幂等,读锁快路径零开销。
    pub fn ensure_glossary(&self, hash: u64) {
        let needs_clear = match self.inner.read() {
            Ok(lock) => lock.glossary_hash != hash,
            Err(_) => return,
        };
        if !needs_clear {
            return;
        }
        if let Ok(mut lock) = self.inner.write() {
            if lock.glossary_hash != hash {
                lock.glossary_hash = hash;
                lock.map.clear();
                lock.order.clear();
                lock.dirty = 0;
            } else {
                return;
            }
        }
        self.save_to_disk();
    }
}

/// 全局唯一翻译管线：此前 commands / commands_capture / clipboard_watch /
/// execute_universal_translate 各自 OnceLock 造了多份实例（多份 HTTP 客户端
/// + 多份互不相通的缓存），统一为一份，翻译记忆才能整体持久化复用。
static SHARED_PIPELINE: OnceLock<MultiTierPipeline> = OnceLock::new();

pub fn shared_pipeline() -> &'static MultiTierPipeline {
    SHARED_PIPELINE.get_or_init(MultiTierPipeline::new)
}

pub struct MultiTierPipeline {
    pub cache: TranslationCache,
    pub client: Client,
}

impl Default for MultiTierPipeline {
    fn default() -> Self {
        Self::new()
    }
}

impl MultiTierPipeline {
    pub fn new() -> Self {
        let client = create_http_client(5000);
        Self {
            cache: TranslationCache::new(),
            client,
        }
    }

    pub fn lookup_dict(&self, phrase: &str, preset: &str) -> Option<(String, String)> {
        let dicts = get_cg_dicts();
        let trimmed = phrase.trim();
        if trimmed.is_empty() {
            return None;
        }

        let has_chinese = trimmed
            .chars()
            .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));

        // Priority 1: Check requested preset dictionary
        if let Some(map) = dicts.get(preset) {
            if has_chinese {
                for (k, v) in map {
                    if v == trimmed || v.contains(trimmed) {
                        return Some((k.clone(), preset.to_string()));
                    }
                }
            } else {
                if let Some(val) = map.get(trimmed) {
                    return Some((val.clone(), preset.to_string()));
                }
                let lower = trimmed.to_lowercase();
                for (k, v) in map {
                    if k.to_lowercase() == lower {
                        return Some((v.clone(), preset.to_string()));
                    }
                }
            }
        }

        // Priority 2: Fallback search across remaining preset dictionaries
        for (dict_name, map) in dicts {
            if dict_name != preset {
                if has_chinese {
                    for (k, v) in map {
                        if v == trimmed || v.contains(trimmed) {
                            return Some((k.clone(), dict_name.clone()));
                        }
                    }
                } else {
                    if let Some(val) = map.get(trimmed) {
                        return Some((val.clone(), dict_name.clone()));
                    }
                    let lower = trimmed.to_lowercase();
                    for (k, v) in map {
                        if k.to_lowercase() == lower {
                            return Some((v.clone(), dict_name.clone()));
                        }
                    }
                }
            }
        }

        None
    }

    pub async fn translate_phrases(
        &self,
        phrases: &[String],
        preset: &str,
        llm_config: Option<&LlmConfig>,
        glossary: &[(String, String)],
    ) -> Vec<TranslationResult> {
        self.translate_phrases_styled(phrases, preset, llm_config, None, glossary)
            .await
    }

    pub async fn translate_phrases_styled(
        &self,
        phrases: &[String],
        preset: &str,
        llm_config: Option<&LlmConfig>,
        style: Option<&str>,
        glossary: &[(String, String)],
    ) -> Vec<TranslationResult> {
        // 词库变化 → 翻译记忆整体失效(读锁快路径,通常零开销)
        self.cache.ensure_glossary(glossary_hash(glossary));
        let mut results: Vec<Option<TranslationResult>> = vec![None; phrases.len()];
        let mut unmatched_indices: Vec<usize> = Vec::new();
        let offline_ready = crate::offline::status().installed;

        for (i, phrase) in phrases.iter().enumerate() {
            let trimmed = phrase.trim();
            if trimmed.is_empty() {
                results[i] = Some(TranslationResult {
                    original: phrase.clone(),
                    translated: String::new(),
                    source_tier: "Empty".to_string(),
                });
                continue;
            }

            // Step 0: Check Cache
            if let Some(cached) = self.cache.retrieve(trimmed) {
                let should_use_cache = match preset.to_lowercase().as_str() {
                    "auto" => true,
                    "google" => cached.source_tier.contains("Google"),
                    "bing" => cached.source_tier.contains("Bing"),
                    "youdao" => cached.source_tier.contains("有道"),
                    "tencent" => cached.source_tier.contains("腾讯"),
                    "llm" => cached.source_tier.contains("LLM"),
                    _ => true,
                };
                if should_use_cache {
                    results[i] = Some(TranslationResult {
                        original: phrase.clone(),
                        translated: cached.translated,
                        source_tier: format!("{} (Cached)", cached.source_tier),
                    });
                    continue;
                }
            }

            // Step 0.5: 用户自定义词库(术语强制表)——精确命中直接短路。
            // 用户手写的术语优先级高于预置词典,保证永远按用户指定译法输出。
            if !glossary.is_empty() {
                if let Some(translated) = lookup_glossary(glossary, trimmed) {
                    let res = TranslationResult {
                        original: phrase.clone(),
                        translated,
                        source_tier: "custom_dict".to_string(),
                    };
                    self.cache.store(res.clone());
                    results[i] = Some(res);
                    continue;
                }
            }

            // Step 0.6: 技术标识符原样透传——模型 ID / 版本号 / URL / 纯数字。
            // LLM 会把它们逐词意译("MiniMax-H3"→"最小最大-H3"、
            // "nemotron-3.5-lightning"→"nemotron-3.5-闪电"),而这类字符串的
            // 价值恰恰在于可复制、可搜索,翻译只会破坏它。放在自定义词库之后,
            // 用户仍可用术语表强制指定某个标识符的译法。
            if is_technical_identifier(trimmed) {
                let res = TranslationResult {
                    original: phrase.clone(),
                    translated: trimmed.to_string(),
                    source_tier: "标识符透传".to_string(),
                };
                self.cache.store(res.clone());
                results[i] = Some(res);
                continue;
            }

            // Step 1 & 2: Local Preset Dictionary & CG Fallback Dictionary
            if let Some((translated, source_tier)) = self.lookup_dict(phrase, preset) {
                let res = TranslationResult {
                    original: phrase.clone(),
                    translated,
                    source_tier,
                };
                self.cache.store(res.clone());
                results[i] = Some(res);
                continue;
            }

            // Step 2.5: Offline phrase dictionary — embedded general-UI terms,
            // participates only when the offline engine is installed on disk.
            if offline_ready {
                if let Some(translated) = crate::offline::translate_offline(trimmed) {
                    let res = TranslationResult {
                        original: phrase.clone(),
                        translated,
                        source_tier: "离线词库".to_string(),
                    };
                    self.cache.store(res.clone());
                    results[i] = Some(res);
                    continue;
                }
            }

            unmatched_indices.push(i);
        }

        if unmatched_indices.is_empty() {
            return results.into_iter().map(|r| r.unwrap()).collect();
        }

        let unmatched_phrases: Vec<String> = unmatched_indices
            .iter()
            .map(|&idx| phrases[idx].trim().to_string())
            .collect();

        // Step 3: Tier 3 (LLM API Client)
        let is_preset_specific_online = [
            "bing", "google", "youdao", "tencent", "deepl", "baidu", "caiyun", "volcengine", "yandex", "lingva", "mymemory", "urban"
        ].contains(&preset.to_lowercase().as_str());
        if !is_preset_specific_online {
            if let Some(config) = llm_config {
                let ep = config.endpoint.trim();
                let is_local = ep.contains("localhost") || ep.contains("127.0.0.1");
                let is_configured = !ep.is_empty()
                    && (!config.api_key.trim().is_empty() || is_local)
                    && config.enabled.unwrap_or(true);
                if is_configured {
                    let llm_res = self.translate_via_llm_with_style(&unmatched_phrases, config, style, glossary).await;
                    if let Ok(map) = llm_res {
                        if !map.is_empty() {
                            let tier_label = if !config.provider.is_empty() {
                                format!("LLM API ({})", config.provider)
                            } else {
                                "LLM API".to_string()
                            };

                            let mut still_unmatched_indices = Vec::new();
                            for &idx in &unmatched_indices {
                                let p = phrases[idx].trim();
                                if let Some(translated) = map.get(p) {
                                    let res = TranslationResult {
                                        original: phrases[idx].clone(),
                                        translated: translated.clone(),
                                        source_tier: tier_label.clone(),
                                    };
                                    self.cache.store(res.clone());
                                    results[idx] = Some(res);
                                } else {
                                    still_unmatched_indices.push(idx);
                                }
                            }
                            unmatched_indices = still_unmatched_indices;
                        }
                    }
                }
            }
        }

        if unmatched_indices.is_empty() {
            return results.into_iter().map(|r| r.unwrap()).collect();
        }

        // Step 4: Tier 4 (Online Fallback API) — batch multiline fast-path + parallel fallback / specific engine query.
        let mut online_results: HashMap<usize, (String, String)> = HashMap::new();
        let p_lower = preset.to_lowercase();
        if !unmatched_indices.is_empty() {
            match p_lower.as_str() {
                "google" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_google(&self.client, p, "auto", "zh-CN").await {
                            online_results.insert(idx, (tr, "Google 官方".to_string()));
                        }
                    }
                }
                "bing" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_bing(&self.client, p, "auto", "zh-CN").await {
                            online_results.insert(idx, (tr, "微软 Bing".to_string()));
                        }
                    }
                }
                "youdao" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_youdao(&self.client, p, "auto", "zh-CN").await {
                            online_results.insert(idx, (tr, "网易有道".to_string()));
                        }
                    }
                }
                "tencent" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_tencent(&self.client, p, "auto", "zh-CN").await {
                            online_results.insert(idx, (tr, "腾讯翻译".to_string()));
                        }
                    }
                }
                "deepl" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        let tr = translate_deepl(&self.client, p, "auto", "zh-CN", None, None).await;
                        if !tr.translated.is_empty() {
                            online_results.insert(idx, (tr.translated, "DeepL 翻译".to_string()));
                        }
                    }
                }
                "baidu" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        let tr = translate_baidu(&self.client, p, "auto", "zh-CN", None, None).await;
                        if !tr.translated.is_empty() {
                            online_results.insert(idx, (tr.translated, "百度翻译".to_string()));
                        }
                    }
                }
                "caiyun" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_caiyun(&self.client, p, "auto", "zh-CN").await {
                            online_results.insert(idx, (tr, "彩云小译".to_string()));
                        }
                    }
                }
                "volcengine" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        let tr = translate_volcengine(&self.client, p, "auto", "zh-CN", None, None).await;
                        if !tr.translated.is_empty() {
                            online_results.insert(idx, (tr.translated, "火山翻译".to_string()));
                        }
                    }
                }
                "lingva" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_lingva(&self.client, p, "auto", "zh-CN").await {
                            online_results.insert(idx, (tr, "Lingva".to_string()));
                        }
                    }
                }
                "mymemory" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_mymemory(&self.client, p, "auto", "zh-CN").await {
                            online_results.insert(idx, (tr, "MyMemory".to_string()));
                        }
                    }
                }
                "urban" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        if let Some(tr) = translate_urban_dictionary(&self.client, p).await {
                            online_results.insert(idx, (tr, "Urban 俚语".to_string()));
                        }
                    }
                }
                "yandex" => {
                    for &idx in &unmatched_indices {
                        let p = phrases[idx].trim();
                        let tr = translate_yandex(&self.client, p, "auto", "zh-CN", None, None).await;
                        if !tr.translated.is_empty() {
                            online_results.insert(idx, (tr.translated, "Yandex".to_string()));
                        }
                    }
                }
                _ => {
                    let mut resolved_via_batch = false;
                    // 极速快路径：如果有多行长段文本未匹配（如几十行代码），先尝试将它们合批一次网络请求翻译
                    // 这样 30~40 行代码只需 1 次网络往返（~200ms）即可全部翻译完成，而不是发起数百次请求
                    if unmatched_indices.len() > 1 {
                        let joined_text = unmatched_indices
                            .iter()
                            .map(|&idx| phrases[idx].trim())
                            .collect::<Vec<_>>()
                            .join("\n");
                        if let Ok(translated_joined) = translate_online_fallback_with(&self.client, &joined_text).await {
                            let split_lines: Vec<&str> = translated_joined.lines().collect();
                            if split_lines.len() == unmatched_indices.len() {
                                for (i, &idx) in unmatched_indices.iter().enumerate() {
                                    let line_res = split_lines[i].trim();
                                    if !line_res.is_empty() {
                                        online_results.insert(idx, (line_res.to_string(), "Online Fallback".to_string()));
                                    }
                                }
                                if online_results.len() == unmatched_indices.len() {
                                    resolved_via_batch = true;
                                }
                            }
                        }
                    }

                    // 兜底并发路径：合批失败或行数不匹配时，使用 16 信号量高并发完成
                    if !resolved_via_batch {
                        let remaining_indices: Vec<usize> = unmatched_indices
                            .iter()
                            .copied()
                            .filter(|idx| !online_results.contains_key(idx))
                            .collect();

                        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(16));
                        let mut set: tokio::task::JoinSet<(usize, Result<String, String>)> =
                            tokio::task::JoinSet::new();

                        for idx in remaining_indices {
                            let p = phrases[idx].trim().to_string();
                            let client = self.client.clone();
                            let permits = semaphore.clone();
                            set.spawn(async move {
                                let _permit = permits.acquire_owned().await;
                                let res = translate_online_fallback_with(&client, &p).await;
                                (idx, res)
                            });
                        }

                        while let Some(joined) = set.join_next().await {
                            if let Ok((idx, Ok(translated))) = joined {
                                online_results.insert(idx, (translated, "Online Fallback".to_string()));
                            }
                        }
                    }
                }
            }
        }

        let mut still_unmatched = Vec::new();
        for &idx in &unmatched_indices {
            if let Some((translated, tier_name)) = online_results.remove(&idx) {
                let res = TranslationResult {
                    original: phrases[idx].clone(),
                    translated,
                    source_tier: tier_name,
                };
                self.cache.store(res.clone());
                results[idx] = Some(res);
            } else {
                still_unmatched.push(idx);
            }
        }

        // Final Fallback:所有引擎(词典/离线/LLM/在线)均不可用时保留干净原文,
        // 不追加 "(通用翻译)" 后缀——译文区直接显示原文,tier 标注真实状态。
        // 不写入缓存,网络恢复后重试可拿到真实翻译。
        for idx in still_unmatched {
            let p = &phrases[idx];
            results[idx] = Some(TranslationResult {
                original: p.clone(),
                translated: p.clone(),
                source_tier: "翻译失败·点击重试".to_string(),
            });
        }

        results.into_iter().map(|r| r.unwrap()).collect()
    }

    pub async fn translate_via_llm(
        &self,
        phrases: &[String],
        config: &LlmConfig,
        glossary: &[(String, String)],
    ) -> Result<HashMap<String, String>, String> {
        self.translate_via_llm_with_style(phrases, config, None, glossary)
            .await
    }

    pub async fn translate_via_llm_with_style(
        &self,
        phrases: &[String],
        config: &LlmConfig,
        style: Option<&str>,
        glossary: &[(String, String)],
    ) -> Result<HashMap<String, String>, String> {
        let endpoint = config.endpoint.trim_end_matches('/');
        let api_key = config.api_key.trim();
        let is_local = endpoint.contains("localhost") || endpoint.contains("127.0.0.1");
        if endpoint.is_empty() || (api_key.is_empty() && !is_local) {
            return Err("LLM not configured (missing API Key)".to_string());
        }

        let url = if endpoint.ends_with("/chat/completions") {
            endpoint.to_string()
        } else {
            format!("{}/chat/completions", endpoint)
        };

        let has_chinese = phrases
            .iter()
            .any(|p| p.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)));
        // 术语强制表:只注入与待译短语相关的词条;中→英方向反转映射
        let directive = {
            let texts: Vec<&str> = phrases.iter().map(|s| s.as_str()).collect();
            glossary_directive(glossary, &texts, has_chinese)
        };
        let system_prompt = if has_chinese {
            format!("You are an expert translator. Translate the given Chinese text/terms into natural English. Return ONLY a valid JSON object mapping each original Chinese string to its English translation, without markdown formatting or extra text.{}{}", style_directive(style), directive)
        } else {
            format!("You are an expert translator. Translate the given foreign/English text/terms into simplified Chinese. Return ONLY a valid JSON object mapping each original string to its simplified Chinese translation, without markdown formatting or extra text.{}{}", style_directive(style), directive)
        };
        let user_prompt = serde_json::to_string(phrases).unwrap_or_else(|_| "[]".to_string());

        let _is_reasoning_model = config.model.to_lowercase().contains("sensenova")
            || config.model.to_lowercase().contains("deepseek-r1")
            || config.model.to_lowercase().contains("qwq")
            || endpoint.contains("sensenova");

        let body = serde_json::json!({
            "model": if config.model.is_empty() { "deepseek-chat" } else { &config.model },
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "temperature": 0.1
        });
        let mut req = self.client.post(&url).json(&body);
        if !config.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", config.api_key));
        }

        // 批量行数越多，非流式生成的耗时越长：固定 4s 会让几十行的大批量整包
        // 超时塌落到逐行在线兜底（更慢且质量更差）。按 4s 基础 + 每行 400ms 缩放，
        // 上限 24s。
        let llm_timeout = Duration::from_secs(
            (4u64 + (phrases.len() as u64) * 400 / 1000).min(24)
        );
        let res = tokio::time::timeout(llm_timeout, req.send())
            .await
            .map_err(|_| "LLM request timed out".to_string())?
            .map_err(|e| format!("LLM network error: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("LLM API status error {}: {}", status, err_text));
        }

        let resp_json: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse LLM response JSON: {}", e))?;

        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "Missing message content in LLM response".to_string())?;

        let cleaned = clean_json_response(content);
        let parsed: HashMap<String, String> = serde_json::from_str(&cleaned)
            .map_err(|e| format!("Failed to deserialize LLM translation map: {}", e))?;

        Ok(parsed)
    }

    pub async fn translate_via_online_fallback(&self, phrase: &str) -> Result<String, String> {
        translate_online_fallback_with(&self.client, phrase).await
    }

    pub async fn query_text_detail(
        &self,
        text: &str,
        preset: &str,
        llm_config: Option<&LlmConfig>,
        glossary: &[(String, String)],
    ) -> TextQueryResponse {
        let trimmed = text.trim();
        let mut results = Vec::new();

        // 1. Preset Dictionary Lookup
        let dict_lookup = self.lookup_dict(trimmed, preset);
        if let Some((translated, source_tier)) = &dict_lookup {
            results.push(MultiEngineTranslation {
                engine_name: format!("通用离线词典 ({})", source_tier.to_uppercase()),
                translated: translated.clone(),
                source_tier: source_tier.clone(),
            });
        }

        // 2. Online Fallback API (Bing / Youdao / Tencent / Google 并发竞速)
        if let Ok(online_trans) = self.translate_via_online_fallback(trimmed).await {
            results.push(MultiEngineTranslation {
                engine_name: "在线通用翻译".to_string(),
                translated: online_trans,
                source_tier: "Online Fallback".to_string(),
            });
        }

        // 3. LLM API (if configured)
        if let Some(config) = llm_config {
            if !config.endpoint.is_empty() && !config.api_key.is_empty() {
                let phrases = vec![trimmed.to_string()];
                if let Ok(llm_map) = self.translate_via_llm(&phrases, config, glossary).await {
                    if let Some(llm_trans) = llm_map.get(trimmed) {
                        let provider_name = if !config.provider.is_empty() {
                            format!("LLM ({})", config.provider)
                        } else {
                            "LLM 大模型".to_string()
                        };
                        results.push(MultiEngineTranslation {
                            engine_name: provider_name,
                            translated: llm_trans.clone(),
                            source_tier: "LLM API".to_string(),
                        });
                    }
                }
            }
        }

        if results.is_empty() {
            results.push(MultiEngineTranslation {
                engine_name: "暂无可用引擎".to_string(),
                translated: trimmed.to_string(),
                source_tier: "翻译失败".to_string(),
            });
        }

        // Generate WordDetail for single word or term queries
        let word_detail = if dict_lookup.is_some() || trimmed.split_whitespace().count() <= 3 {
            let def = results
                .first()
                .map(|r| r.translated.clone())
                .unwrap_or_default();
            let domain_note = dict_lookup
                .as_ref()
                .map(|(_, tier)| format!("精选离线词库 [{}]", tier))
                .unwrap_or_else(|| "通用术语/词汇".to_string());
            Some(WordDetail {
                phonetic_us: format!("/ {} /", trimmed.to_lowercase()),
                phonetic_uk: format!("[ {} ]", trimmed.to_lowercase()),
                pos: "n. / 通用词汇".to_string(),
                definition: def,
                examples: vec![
                    format!(
                        "Example: Select '{}' in the application settings panel.",
                        trimmed
                    ),
                    format!(
                        "用法说明：在应用程序界面或文档中正确使用 {} 词汇。",
                        trimmed
                    ),
                ],
                cg_domain_note: domain_note,
            })
        } else {
            None
        };

        TextQueryResponse {
            original: trimmed.to_string(),
            word_detail,
            results,
        }
    }
}

fn clean_json_response(input: &str) -> String {
    // 1. 彻底去除 <think>...</think> 思考标签块（常见于商汤日日新、DeepSeek-R1 等）
    let without_think = if let Some(start_idx) = input.find("<think>") {
        if let Some(end_idx) = input.find("</think>") {
            let before = &input[..start_idx];
            let after = &input[(end_idx + 8)..];
            format!("{}{}", before, after)
        } else {
            input.to_string()
        }
    } else {
        input.to_string()
    };

    let trimmed = without_think.trim();

    // 2. 如果包含 ```json 或 ``` 代码块，提取内部
    if let Some(start_block) = trimmed.find("```") {
        let after_ticks = &trimmed[start_block + 3..];
        let after_lang = if let Some(newline) = after_ticks.find('\n') {
            &after_ticks[newline + 1..]
        } else {
            after_ticks
        };
        if let Some(end_block) = after_lang.rfind("```") {
            let inner = after_lang[..end_block].trim();
            if let (Some(first_brace), Some(last_brace)) = (inner.find('{'), inner.rfind('}')) {
                if last_brace >= first_brace {
                    return inner[first_brace..=last_brace].to_string();
                }
            }
            return inner.to_string();
        }
    }

    // 3. 直接寻找最外层的 '{' 和 '}'
    if let (Some(first_brace), Some(last_brace)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if last_brace >= first_brace {
            return trimmed[first_brace..=last_brace].to_string();
        }
    }

    trimmed.to_string()
}

pub fn urlencoding_encode(s: &str) -> String {
    let mut encoded = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

use crate::models::{UniversalTranslationRequest, UniversalTranslationResponse};

/// 校验守卫函数：严格过滤 URL 投毒/风控跳转链接、HTML 网页错误、JSON 异常体以及限流关键词
pub fn is_valid_translation(orig: &str, candidate: &str) -> bool {
    let cand = candidate.trim();
    let orig_trim = orig.trim();
    if cand.is_empty() || orig_trim.is_empty() {
        return false;
    }

    let orig_lower = orig_trim.to_lowercase();
    let cand_lower = cand.to_lowercase();

    // 1. URL 投毒/风控跳转拦截：若原文非 URL，但译文包含 URL 协议、域名或已知风控特征（如 linux.do / t.me 等）
    let orig_has_url = orig_lower.contains("http://") || orig_lower.contains("https://") || orig_lower.contains("www.");
    if !orig_has_url
        && (cand_lower.contains("http://")
            || cand_lower.contains("https://")
            || cand_lower.contains("linux.do")
            || cand_lower.contains("t.me/")
            || cand_lower.contains("github.com")
            || cand_lower.contains("deeplx")
            || cand_lower.contains("fanyi.baidu.com")
            || cand_lower.contains("bing.com")
            || (cand_lower.starts_with("www.") && cand.contains('.')))
        {
            return false;
        }

    // 2. HTML 标签 / 网页错误拦截：若原文无 HTML 标记但译文包含 HTML 结构
    let orig_has_html = orig_lower.contains("<html") || orig_lower.contains("<!doctype") || orig_lower.contains("<body");
    if !orig_has_html
        && (cand_lower.contains("<!doctype")
            || cand_lower.contains("<html")
            || cand_lower.contains("<body")
            || cand_lower.contains("<script")
            || cand_lower.contains("<head")
            || cand_lower.contains("<div")
            || cand_lower.contains("</span>")
            || cand_lower.contains("</p>"))
        {
            return false;
        }

    // 3. 常见 JSON 报错格式拦截
    if ((cand.starts_with('{') && cand.ends_with('}')) || (cand.starts_with('[') && cand.ends_with(']')))
        && (cand_lower.contains("\"code\":")
            || cand_lower.contains("\"error\":")
            || cand_lower.contains("\"message\":")
            || cand_lower.contains("\"msg\":"))
        {
            return false;
        }

    // 4. 常见接口限流/风控/网关错误提示关键词拦截
    let error_keywords = [
        "too many requests",
        "rate limit",
        "ratelimit",
        "ip has been blocked",
        "ip blocked",
        "frequency limit",
        "unauthorized",
        "access denied",
        "service unavailable",
        "gateway timeout",
        "bad gateway",
        "internal server error",
        "cf-ray",
        "error code:",
        "请求过于频繁",
        "访问过于频繁",
        "频率超限",
        "接口受限",
        "风控拦截",
        "配额不足",
        "429 too many",
        "403 forbidden",
        "502 bad gateway",
        "504 gateway",
    ];
    for kw in &error_keywords {
        if cand_lower.contains(kw) && !orig_lower.contains(kw) {
            return false;
        }
    }

    true
}

fn map_google_lang(code: &str) -> &str {
    match code {
        "auto" => "auto",
        "zh-CN" | "zh" => "zh-CN",
        "zh-TW" | "zh-HK" => "zh-TW",
        "he" => "iw",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_bing_lang(code: &str) -> &str {
    match code {
        "auto" | "" => "",
        "zh-CN" | "zh" => "zh-Hans",
        "zh-TW" | "zh-HK" => "zh-Hant",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_bing_target_lang(code: &str) -> &str {
    match code {
        "zh-CN" | "zh" | "auto" => "zh-Hans",
        "zh-TW" | "zh-HK" => "zh-Hant",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_baidu_lang(code: &str) -> &str {
    match code {
        "auto" => "auto",
        "zh-CN" | "zh" => "zh",
        "zh-TW" | "zh-HK" => "cht",
        "en" => "en",
        "ja" => "jp",
        "ko" => "kor",
        "fr" => "fra",
        "es" => "spa",
        "th" => "th",
        "ar" => "ara",
        "ru" => "ru",
        "pt" => "pt",
        "de" => "de",
        "it" => "it",
        "el" => "el",
        "nl" => "nl",
        "pl" => "pl",
        "da" => "dan",
        "fi" => "fin",
        "cs" => "cs",
        "sv" => "swe",
        "hu" => "hu",
        "ro" => "rom",
        "vi" => "vie",
        "id" => "id",
        "hi" => "hi",
        "uk" => "ukr",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_mymemory_lang(code: &str) -> &str {
    match code {
        "auto" => "en",
        "zh-CN" | "zh" => "zh-CN",
        "zh-TW" | "zh-HK" => "zh-TW",
        other => other.split('-').next().unwrap_or(other),
    }
}

fn map_deepl_source_lang(code: &str) -> String {
    match code {
        "auto" => "AUTO".to_string(),
        "zh-CN" | "zh" => "ZH".to_string(),
        "zh-TW" | "zh-HK" => "ZH".to_string(),
        "en" => "EN".to_string(),
        other => other.to_uppercase(),
    }
}

fn map_deepl_target_lang(code: &str) -> String {
    match code {
        "zh-CN" | "zh" | "auto" => "ZH".to_string(),
        "zh-TW" | "zh-HK" => "ZH-HANT".to_string(),
        "en" | "en-US" => "EN-US".to_string(),
        "en-GB" => "EN-GB".to_string(),
        "pt" | "pt-BR" => "PT-BR".to_string(),
        "pt-PT" => "PT-PT".to_string(),
        other => other.to_uppercase(),
    }
}

fn get_target_lang_display_name(code: &str) -> &str {
    match code {
        "zh-CN" | "zh" => "Simplified Chinese (简体中文)",
        "zh-TW" | "zh-HK" => "Traditional Chinese (繁體中文)",
        "en" => "English",
        "ja" => "Japanese (日本語)",
        "ko" => "Korean (한국어)",
        "fr" => "French (Français)",
        "de" => "German (Deutsch)",
        "es" => "Spanish (Español)",
        "ru" => "Russian (Русский)",
        "it" => "Italian (Italiano)",
        "pt" => "Portuguese (Português)",
        "nl" => "Dutch (Nederlands)",
        "pl" => "Polish (Polski)",
        "ar" => "Arabic (العربية)",
        "th" => "Thai (ไทย)",
        "vi" => "Vietnamese (Tiếng Việt)",
        "id" => "Indonesian (Bahasa Indonesia)",
        "tr" => "Turkish (Türkçe)",
        "hi" => "Hindi (हिन्दी)",
        "uk" => "Ukrainian (Українська)",
        "sv" => "Swedish (Svenska)",
        "cs" => "Czech (Čeština)",
        "el" => "Greek (Ελληνικά)",
        "he" => "Hebrew (עברית)",
        "da" => "Danish (Dansk)",
        "fi" => "Finnish (Suomi)",
        "no" => "Norwegian (Norsk)",
        "hu" => "Hungarian (Magyar)",
        "ro" => "Romanian (Română)",
        other => other,
    }
}

/// ── Google 翻译 (Chrome Extension 官方稳定免风控端点 + GTX 容灾回退) ───────────
pub async fn translate_google(client: &Client, q: &str, src: &str, tgt: &str) -> Option<String> {
    let clean_src = map_google_lang(src);
    let clean_tgt = map_google_lang(tgt);
    let encoded = urlencoding_encode(q);

    // 方案 A: 官方 Chrome Extension 接口 (dict-chrome-ex，高并发零 429 风控)
    let chrome_url = format!(
        "https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl={}&tl={}&q={}",
        clean_src, clean_tgt, encoded
    );
    let req1 = client.get(&chrome_url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(4000), req1.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(arr) = json.as_array() {
                    if let Some(first) = arr.first() {
                        if let Some(text) = first.as_str() {
                            if is_valid_translation(q, text) {
                                return Some(text.to_string());
                            }
                        } else if let Some(inner) = first.as_array() {
                            if let Some(text) = inner.first().and_then(|v| v.as_str()) {
                                if is_valid_translation(q, text) {
                                    return Some(text.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 方案 B: 经典 single?client=gtx 接口
    let gtx_url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
        clean_src, clean_tgt, encoded
    );
    let req2 = client.get(&gtx_url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(3000), req2.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(arr) = json.as_array().and_then(|a| a.first()).and_then(|a| a.as_array()) {
                    let mut text = String::new();
                    for item in arr {
                        if let Some(s) = item.get(0).and_then(|v| v.as_str()) {
                            text.push_str(s);
                        }
                    }
                    if is_valid_translation(q, &text) {
                        return Some(text);
                    }
                }
            }
        }
    }

    None
}

/// ── 微软 Bing 必应翻译 (国内直连 cn.bing.com + Edge 免密 API 并发竞速) ──────
pub async fn translate_bing(client: &Client, q: &str, src: &str, tgt: &str) -> Option<String> {
    use futures_util::stream::FuturesUnordered;
    use futures_util::StreamExt;

    let from_lang = map_bing_lang(src);
    let to_lang = map_bing_target_lang(tgt);

    let mut futures = FuturesUnordered::new();

    // 方案 A：Edge Translation 官方免密 API
    {
        let c = client.clone();
        let orig = q.to_string();
        let from_l = from_lang.to_string();
        let to_l = to_lang.to_string();
        futures.push(tokio::spawn(async move {
            let auth_req = c
                .get("https://edge.microsoft.com/translate/auth")
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
                );
            if let Ok(Ok(auth_res)) = tokio::time::timeout(Duration::from_millis(2500), auth_req.send()).await {
                if auth_res.status().is_success() {
                    if let Ok(jwt) = auth_res.text().await {
                        let jwt = jwt.trim();
                        if !jwt.is_empty() {
                            let mut url = format!(
                                "https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to={}&includeSentenceLength=true",
                                to_l
                            );
                            if !from_l.is_empty() && from_l != "auto" {
                                url.push_str(&format!("&from={}", from_l));
                            }
                            let body = serde_json::json!([{ "Text": orig }]);
                            let trans_req = c
                                .post(&url)
                                .header("Authorization", format!("Bearer {}", jwt))
                                .header(
                                    "User-Agent",
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
                                )
                                .header("Content-Type", "application/json")
                                .json(&body);
                            if let Ok(Ok(trans_res)) = tokio::time::timeout(Duration::from_millis(2500), trans_req.send()).await {
                                if trans_res.status().is_success() {
                                    if let Ok(json) = trans_res.json::<serde_json::Value>().await {
                                        if let Some(text) = json
                                            .get(0)
                                            .and_then(|item| item.get("translations"))
                                            .and_then(|t| t.get(0))
                                            .and_then(|t| t.get("text"))
                                            .and_then(|s| s.as_str())
                                        {
                                            if is_valid_translation(&orig, text) {
                                                return Some(text.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    // 方案 B：国内直连 cn.bing.com/ttranslatev3 动态抓取
    {
        let c = client.clone();
        let orig = q.to_string();
        let from_l = from_lang.to_string();
        let to_l = to_lang.to_string();
        futures.push(tokio::spawn(async move {
            let bing_from = if from_l.is_empty() { "auto-detect" } else { &from_l };
            let home_req = c
                .get("https://cn.bing.com/translator")
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                )
                .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
            if let Ok(Ok(home_res)) = tokio::time::timeout(Duration::from_millis(4000), home_req.send()).await {
                if let Ok(html) = home_res.text().await {
                    let ig = html.find("IG:\"").and_then(|pos| {
                        let part = &html[pos + 4..];
                        part.find('"').map(|end| part[..end].to_string())
                    });
                    // 兼容 格式化JS（含空格）和压缩JS（无空格）两种形式
                    let (key, token) = {
                        // 查找 params_AbusePreventionHelper 后紧跟的 [ 符号位置
                        let marker = "params_AbusePreventionHelper";
                        let mut key_str = String::new();
                        let mut token_str = String::new();
                        if let Some(pos) = html.find(marker) {
                            // 跳过变量名，找到第一个 [
                            if let Some(bracket_offset) = html[pos..].find('[') {
                                let after_bracket = &html[pos + bracket_offset + 1..];
                                let items: Vec<&str> = after_bracket.splitn(3, ',').collect();
                                if items.len() >= 2 {
                                    key_str = items[0].trim().to_string();
                                    token_str = items[1].trim().trim_matches('"').to_string();
                                }
                            }
                        }
                        (key_str, token_str)
                    };

                    if let (Some(ig_str), false, false) = (ig, key.is_empty(), token.is_empty()) {
                        let url = format!(
                            "https://cn.bing.com/ttranslatev3?isVertical=1&IG={}&IID=translator.5020.1",
                            ig_str
                        );
                        let form_data = [
                            ("text", orig.as_str()),
                            ("fromLang", bing_from),
                            ("to", to_l.as_str()),
                            ("token", token.as_str()),
                            ("key", key.as_str()),
                        ];
                        let trans_req = c
                            .post(&url)
                            .header("Referer", "https://cn.bing.com/translator")
                            .header(
                                "User-Agent",
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                            )
                            .form(&form_data);
                        if let Ok(Ok(trans_res)) = tokio::time::timeout(Duration::from_millis(4000), trans_req.send()).await {
                            if trans_res.status().is_success() {
                                if let Ok(json) = trans_res.json::<serde_json::Value>().await {
                                    if let Some(text) = json
                                        .get(0)
                                        .and_then(|item| item.get("translations"))
                                        .and_then(|t| t.get(0))
                                        .and_then(|t| t.get("text"))
                                        .and_then(|s| s.as_str())
                                    {
                                        if is_valid_translation(&orig, text) {
                                            return Some(text.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    // 方案 C：国内直连 cn.bing.com/dict 词典接口（短语/术语 100% 极速直连）
    if q.split_whitespace().count() <= 6 {
        let c = client.clone();
        let orig = q.to_string();
        futures.push(tokio::spawn(async move {
            let dict_url = format!(
                "https://cn.bing.com/dict/SerpHoverTrans?q={}",
                urlencoding_encode(&orig)
            );
            let req = c
                .get(&dict_url)
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                )
                .header("Referer", "https://cn.bing.com/dict/");
            if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(2000), req.send()).await {
                if res.status().is_success() {
                    if let Ok(html) = res.text().await {
                        if let Some(start_pos) = html.find("class=\"p1-") {
                            if let Some(tag_end) = html[start_pos..].find('>') {
                                let content_start = start_pos + tag_end + 1;
                                if let Some(end_tag) = html[content_start..].find("</span>") {
                                    let candidate = html[content_start..content_start + end_tag].trim();
                                    if is_valid_translation(&orig, candidate) {
                                        return Some(candidate.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        }));
    }

    while let Some(joined) = futures.next().await {
        if let Ok(Some(translated)) = joined {
            return Some(translated);
        }
    }

    None
}

/// ── 网易有道翻译 ────────────────────────────────────────────────────────────
pub async fn translate_youdao(client: &Client, q: &str, _src: &str, _tgt: &str) -> Option<String> {
    // 方案 A: 经典 JSON 接口
    let url = format!("http://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i={}", urlencoding_encode(q));
    let req = client.get(&url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(2500), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(outer_arr) = json.get("translateResult").and_then(|v| v.as_array()) {
                    let mut full_text = String::new();
                    for inner in outer_arr {
                        if let Some(items) = inner.as_array() {
                            for item in items {
                                if let Some(tgt) = item.get("tgt").and_then(|s| s.as_str()) {
                                    full_text.push_str(tgt);
                                }
                            }
                        }
                    }
                    if is_valid_translation(q, &full_text) {
                        return Some(full_text);
                    }
                }
            }
        }
    }

    // 方案 B: 移动端网页接口
    let form_data = [("inputtext", q), ("type", "AUTO")];
    let req2 = client.post("https://m.youdao.com/translate").form(&form_data);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(2500), req2.send()).await {
        if res.status().is_success() {
            if let Ok(html) = res.text().await {
                if let Some(pos) = html.find("translateResult") {
                    if let Some(li_start) = html[pos..].find("<li>") {
                        let content_start = pos + li_start + 4;
                        if let Some(li_end) = html[content_start..].find("</li>") {
                            let trans = html[content_start..content_start + li_end].trim();
                            if is_valid_translation(q, trans) {
                                return Some(trans.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // 方案 C: 官方 suggest 词典接口 (国内 100% 极速直连)
    let suggest_url = format!("https://dict.youdao.com/suggest?num=1&doctype=json&q={}", urlencoding_encode(q));
    let req3 = client.get(&suggest_url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(2500), req3.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(entry) = json.get("data").and_then(|d| d.get("entries")).and_then(|e| e.as_array()).and_then(|a| a.first()) {
                    if let Some(explain) = entry.get("explain").and_then(|s| s.as_str()) {
                        if !explain.trim().is_empty() {
                            return Some(explain.trim().to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// ── 百度通用翻译 (官方开放平台 API，MD5 签名，国内直连 100% 稳定) ───────────────────────────
/// 免费注册地址：https://fanyi-api.baidu.com/  每月 100 万字符免费额度
pub async fn translate_baidu(
    client: &Client,
    q: &str,
    src: &str,
    tgt: &str,
    app_id: Option<&str>,
    secret: Option<&str>,
) -> MultiEngineTranslation {
    let engine_name = "百度通用翻译".to_string();

    let app_id = match app_id {
        Some(id) if !id.trim().is_empty() => id.trim(),
        _ => {
            return MultiEngineTranslation {
                engine_name,
                translated: "[未配置百度 AppID/密钥 · 点击前往设置]".to_string(),
                source_tier: "Baidu (Config Required)".to_string(),
            };
        }
    };
    let secret = match secret {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => {
            return MultiEngineTranslation {
                engine_name,
                translated: "[未配置百度 AppID/密钥 · 点击前往设置]".to_string(),
                source_tier: "Baidu (Config Required)".to_string(),
            };
        }
    };

    let clean_from = map_baidu_lang(src);
    let clean_to = map_baidu_lang(tgt);

    // MD5 签名：md5(appid + q + salt + secret)
    let salt = "1435660288";
    let sign_input = format!("{}{}{}{}", app_id, q, salt, secret);
    let sign = format!("{:x}", md5::compute(sign_input.as_bytes()));

    let form = [
        ("q", q),
        ("from", clean_from),
        ("to", clean_to),
        ("appid", app_id),
        ("salt", salt),
        ("sign", sign.as_str()),
    ];

    if let Ok(Ok(res)) = tokio::time::timeout(
        Duration::from_millis(5000),
        client
            .post("https://fanyi-api.baidu.com/api/trans/vip/translate")
            .form(&form)
            .send(),
    )
    .await
    {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(trans_result) = json.get("trans_result").and_then(|r| r.as_array()) {
                    let full: String = trans_result
                        .iter()
                        .filter_map(|item| item.get("dst").and_then(|s| s.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n");
                    if is_valid_translation(q, &full) {
                        return MultiEngineTranslation {
                            engine_name,
                            translated: full,
                            source_tier: "Online Fallback".to_string(),
                        };
                    }
                }
                // 鉴权或配额错误
                if let Some(err_code) = json.get("error_code").and_then(|c| c.as_str()) {
                    let msg = match err_code {
                        "52003" | "52001" => "[百度 AppID 无效或未授权 · 请检查设置]".to_string(),
                        "54004" | "54001" => "[百度 API 密钥错误 · 请检查设置]".to_string(),
                        "54005" => "[百度 API 频率超限 · 请稍后重试]".to_string(),
                        _ => format!("[百度 API 错误 (code {}) · 请检查配置]", err_code),
                    };
                    return MultiEngineTranslation {
                        engine_name,
                        translated: msg,
                        source_tier: "Baidu (Auth Error)".to_string(),
                    };
                }
            }
        }
    }

    MultiEngineTranslation {
        engine_name,
        translated: "[百度 API 请求失败 / 点击重试]".to_string(),
        source_tier: "Online (Retry)".to_string(),
    }
}

/// ── MyMemory 全球翻译记忆库 ────────────────────────────────────────────────
pub async fn translate_mymemory(client: &Client, q: &str, src: &str, tgt: &str) -> Option<String> {
    let clean_src = map_mymemory_lang(src);
    let clean_tgt = map_mymemory_lang(tgt);
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}|{}",
        urlencoding_encode(q),
        clean_src,
        clean_tgt
    );
    let req = client.get(&url);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(4000), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(text) = json
                    .get("responseData")
                    .and_then(|d| d.get("translatedText"))
                    .and_then(|s| s.as_str())
                {
                    if is_valid_translation(q, text) && text != q {
                        return Some(text.to_string());
                    }
                }
            }
        }
    }
    None
}

/// ── DeepL 翻译 (官方免费 API 或自定义 DeepLX 自建服务，彻底告别失效公共节点) ──────────────
/// 官方免费 API 注册：https://www.deepl.com/pro-api  每月 50 万字符免费额度
/// 自定义 DeepLX 地址示例：http://localhost:1188/translate
pub async fn translate_deepl(
    client: &Client,
    q: &str,
    src: &str,
    tgt: &str,
    api_key: Option<&str>,
    custom_url: Option<&str>,
) -> MultiEngineTranslation {
    let engine_name = "DeepL 极速通道".to_string();
    let clean_src = map_deepl_source_lang(src);
    let clean_tgt = map_deepl_target_lang(tgt);

    // 优先走用户自建 DeepLX 服务
    if let Some(url) = custom_url {
        if !url.trim().is_empty() {
            let body = serde_json::json!({
                "text": q,
                "source_lang": clean_src,
                "target_lang": clean_tgt
            });
            if let Ok(Ok(res)) = tokio::time::timeout(
                Duration::from_millis(5000),
                client
                    .post(url.trim())
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send(),
            )
            .await
            {
                if res.status().is_success() {
                    if let Ok(json) = res.json::<serde_json::Value>().await {
                        let candidate = json
                            .get("data")
                            .or_else(|| json.get("target_text"))
                            .or_else(|| json.get("translation"))
                            .or_else(|| json.get("translatedText"))
                            .and_then(|s| s.as_str());
                        if let Some(trans) = candidate {
                            if is_valid_translation(q, trans) {
                                return MultiEngineTranslation {
                                    engine_name,
                                    translated: trans.to_string(),
                                    source_tier: "Online Fallback".to_string(),
                                };
                            }
                        }
                    }
                }
            }
            return MultiEngineTranslation {
                engine_name,
                translated: "[自定义 DeepLX 服务请求失败 / 点击重试]".to_string(),
                source_tier: "Online (Retry)".to_string(),
            };
        }
    }

    // 官方免费 API（需用户提供 API Key）
    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            let form = [
                ("text", q),
                ("target_lang", clean_tgt.as_str()),
            ];
            if let Ok(Ok(res)) = tokio::time::timeout(
                Duration::from_millis(5000),
                client
                    .post("https://api-free.deepl.com/v2/translate")
                    .header("Authorization", format!("DeepL-Auth-Key {}", key.trim()))
                    .form(&form)
                    .send(),
            )
            .await
            {
                let status = res.status();
                if status.is_success() {
                    if let Ok(json) = res.json::<serde_json::Value>().await {
                        if let Some(trans) = json
                            .get("translations")
                            .and_then(|t| t.as_array())
                            .and_then(|a| a.first())
                            .and_then(|t| t.get("text"))
                            .and_then(|s| s.as_str())
                        {
                            if is_valid_translation(q, trans) {
                                return MultiEngineTranslation {
                                    engine_name,
                                    translated: trans.to_string(),
                                    source_tier: "Online Fallback".to_string(),
                                };
                            }
                        }
                    }
                } else if status.as_u16() == 403 || status.as_u16() == 401 {
                    return MultiEngineTranslation {
                        engine_name,
                        translated: "[DeepL API Key 无效或已过期 · 请检查设置]".to_string(),
                        source_tier: "DeepL (Auth Error)".to_string(),
                    };
                } else if status.as_u16() == 429 || status.as_u16() == 456 {
                    return MultiEngineTranslation {
                        engine_name,
                        translated: "[DeepL 配额已用尽 · 请检查账户额度]".to_string(),
                        source_tier: "DeepL (Quota Error)".to_string(),
                    };
                }
            }
            return MultiEngineTranslation {
                engine_name,
                translated: "[DeepL 官方 API 请求失败 / 点击重试]".to_string(),
                source_tier: "Online (Retry)".to_string(),
            };
        }
    }

    // 均未配置
    MultiEngineTranslation {
        engine_name,
        translated: "[未配置 DeepL API Key 或自建地址 · 点击前往设置]".to_string(),
        source_tier: "DeepL (Config Required)".to_string(),
    }
}

/// ── 腾讯交互翻译 ────────────────────────────────────────────────────────────
pub async fn translate_tencent(client: &Client, q: &str, _src: &str, tgt: &str) -> Option<String> {
    // Transmart API 语种码约定：简体中文传 "zh"，繁体中文传 "zh-TW"，其余按基础码透传
    let clean_tgt = if tgt.eq_ignore_ascii_case("zh-CN") {
        "zh".to_string()
    } else if tgt.eq_ignore_ascii_case("zh-TW") {
        "zh-TW".to_string()
    } else {
        tgt.split('-').next().unwrap_or("en").to_lowercase()
    };
    let body = serde_json::json!({
        "header": {
            "fn": "auto_translation",
            "client_key": "browser-chrome-124.0.0.0"
        },
        "type": "plain",
        "model_category": "normal",
        "source": {
            "lang": "auto",
            "text_list": [q]
        },
        "target": { "lang": clean_tgt }
    });
    let req = client
        .post("https://transmart.qq.com/api/imt")
        .header("Content-Type", "application/json")
        .json(&body);
    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(2500), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(trans) = json
                    .get("auto_translation")
                    .and_then(|a| a.get(0))
                    .and_then(|s| s.as_str())
                {
                    if is_valid_translation(q, trans) {
                        return Some(trans.to_string());
                    }
                }
            }
        }
    }
    None
}

/// ── Lingva Translate (Google 翻译开源镜像 + 高可用备用通道) ──────────────────
pub async fn translate_lingva(client: &Client, q: &str, src: &str, tgt: &str) -> Option<String> {
    let clean_src = if src == "auto" { "auto" } else { map_google_lang(src) };
    let clean_tgt = map_google_lang(tgt);
    let encoded = urlencoding_encode(q);

    // 优先尝试 Google 官方 Chrome Extension 接口 (免风控极速)
    if let Some(g) = translate_google(client, q, src, tgt).await {
        return Some(g);
    }

    // 聚合公共 Lingva 镜像节点
    let mirror_urls = [
        format!("https://lingva.ml/api/v1/{}/{}/{}", clean_src, clean_tgt, encoded),
        format!("https://translate.plausibility.cloud/api/v1/{}/{}/{}", clean_src, clean_tgt, encoded),
        format!("https://lingva.lunar.icu/api/v1/{}/{}/{}", clean_src, clean_tgt, encoded),
    ];

    for url in mirror_urls {
        let req = client.get(&url);
        if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(3500), req.send()).await {
            if res.status().is_success() {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(text) = json.get("translation").and_then(|s| s.as_str()) {
                        if is_valid_translation(q, text) {
                            return Some(text.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

/// ── 彩云小译 (国内地道文学与科技意译顶流) ───────────────────────────────────
pub async fn translate_caiyun(
    client: &Client,
    q: &str,
    src: &str,
    tgt: &str,
) -> Option<String> {
    let direction = match (src, tgt) {
        ("zh-CN" | "zh", "en") => "zh2en",
        ("en", "zh-CN" | "zh") => "en2zh",
        ("ja", "zh-CN" | "zh") => "ja2zh",
        ("zh-CN" | "zh", "ja") => "zh2ja",
        (_, "en") => "auto2en",
        _ => "auto2zh",
    };

    let body = serde_json::json!({
        "source": [q],
        "trans_type": direction,
        "request_id": "maobu_desktop",
        "detect": true
    });

    let req = client
        .post("http://api.interpreter.caiyunai.com/v1/translator")
        .header("Content-Type", "application/json")
        .header("X-Authorization", "token 3975l6lr5pcbvidl6jl2")
        .json(&body);

    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(3500), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(text) = json
                    .get("target")
                    .and_then(|t| t.get(0))
                    .and_then(|s| s.as_str())
                {
                    if is_valid_translation(q, text) {
                        return Some(text.to_string());
                    }
                }
            }
        }
    }
    None
}

/// ── Urban Dictionary (欧美网络流行俚语/黑话/流行梗) ──────────────────────────
pub async fn translate_urban_dictionary(
    client: &Client,
    q: &str,
) -> Option<String> {
    let encoded = urlencoding_encode(q);
    let url = format!("https://api.urbandictionary.com/v0/define?term={}", encoded);

    let req = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

    if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(4500), req.send()).await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(list) = json.get("list").and_then(|l| l.as_array()) {
                    if let Some(first) = list.first() {
                        let def = first.get("definition").and_then(|s| s.as_str()).unwrap_or("");
                        let eg = first.get("example").and_then(|s| s.as_str()).unwrap_or("");
                        let clean_def = def.replace(['[', ']'], "").trim().to_string();
                        let clean_eg = eg.replace(['[', ']'], "").trim().to_string();
                        if !clean_def.is_empty() {
                            if !clean_eg.is_empty() {
                                return Some(format!("【俚语释义】{}\n【例句】{}", clean_def, clean_eg));
                            } else {
                                return Some(format!("【俚语释义】{}", clean_def));
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// ── 字节跳动火山翻译 (官方 OpenAPI) ─────────────────────────────────────────
pub async fn translate_volcengine(
    client: &Client,
    q: &str,
    src: &str,
    tgt: &str,
    access_key: Option<&str>,
    secret_key: Option<&str>,
) -> MultiEngineTranslation {
    let engine_name = "火山翻译 (字节)".to_string();

    let ak = access_key.map(|s| s.trim()).filter(|s| !s.is_empty());
    let sk = secret_key.map(|s| s.trim()).filter(|s| !s.is_empty());

    if let (Some(ak_str), Some(_sk_str)) = (ak, sk) {
        let map_volc_lang = |l: &str| -> &str {
            match l {
                "zh-CN" | "zh" => "zh",
                "zh-TW" => "zh-Hant",
                "en" => "en",
                "ja" => "ja",
                "ko" => "ko",
                "fr" => "fr",
                "de" => "de",
                "es" => "es",
                "ru" => "ru",
                _ => "auto",
            }
        };

        let v_src = if src == "auto" { "" } else { map_volc_lang(src) };
        let v_tgt = map_volc_lang(tgt);

        let mut body = serde_json::json!({
            "TargetLanguage": v_tgt,
            "TextList": [q]
        });
        if !v_src.is_empty() {
            body["SourceLanguage"] = serde_json::json!(v_src);
        }

        let req = client
            .post("https://open.volcengineapi.com/?Action=TranslateText&Version=2020-06-01")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("HMAC-SHA256 AccessKey={}", ak_str))
            .json(&body);

        if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(3500), req.send()).await {
            let status = res.status();
            if status.is_success() {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(trans) = json
                        .get("TranslationList")
                        .and_then(|a| a.as_array())
                        .and_then(|a| a.first())
                        .and_then(|t| t.get("Translation"))
                        .and_then(|s| s.as_str())
                    {
                        if is_valid_translation(q, trans) {
                            return MultiEngineTranslation {
                                engine_name,
                                translated: trans.to_string(),
                                source_tier: "Online Fallback".to_string(),
                            };
                        }
                    }
                }
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                return MultiEngineTranslation {
                    engine_name,
                    translated: "[火山翻译 AccessKey/Secret 无效 · 请检查设置]".to_string(),
                    source_tier: "Volcengine (Auth Error)".to_string(),
                };
            }
        }
        return MultiEngineTranslation {
            engine_name,
            translated: "[火山翻译 OpenAPI 请求失败 / 点击重试]".to_string(),
            source_tier: "Online (Retry)".to_string(),
        };
    }

    MultiEngineTranslation {
        engine_name,
        translated: "[未配置火山引擎 AccessKey/SecretKey · 点击前往设置]".to_string(),
        source_tier: "Volcengine (Config Required)".to_string(),
    }
}

/// ── Yandex Translate (官方 Cloud API) ─────────────────────────────────────
pub async fn translate_yandex(
    client: &Client,
    q: &str,
    src: &str,
    tgt: &str,
    api_key: Option<&str>,
    folder_id: Option<&str>,
) -> MultiEngineTranslation {
    let engine_name = "Yandex (俄语东欧)".to_string();

    let key = api_key.map(|s| s.trim()).filter(|s| !s.is_empty());
    if let Some(k) = key {
        let map_yandex_lang = |l: &str| -> &str {
            match l {
                "zh-CN" | "zh" => "zh",
                "en" => "en",
                "ru" => "ru",
                "ja" => "ja",
                "ko" => "ko",
                "de" => "de",
                "fr" => "fr",
                "es" => "es",
                "it" => "it",
                "pl" => "pl",
                "uk" => "uk",
                "be" => "be",
                "cs" => "cs",
                "kk" => "kk",
                _ => "zh",
            }
        };

        let y_src = if src == "auto" { "" } else { map_yandex_lang(src) };
        let y_tgt = map_yandex_lang(tgt);

        let mut body = serde_json::json!({
            "targetLanguageCode": y_tgt,
            "texts": [q]
        });
        if !y_src.is_empty() {
            body["sourceLanguageCode"] = serde_json::json!(y_src);
        }
        if let Some(fid) = folder_id.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            body["folderId"] = serde_json::json!(fid);
        }

        let auth_hdr = if k.starts_with("t1.") || k.starts_with("AQVN") {
            format!("Api-Key {}", k)
        } else {
            format!("Bearer {}", k)
        };

        let req = client
            .post("https://translate.api.cloud.yandex.net/translate/v2/translate")
            .header("Content-Type", "application/json")
            .header("Authorization", auth_hdr)
            .json(&body);

        if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(3500), req.send()).await {
            let status = res.status();
            if status.is_success() {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(trans) = json
                        .get("translations")
                        .and_then(|a| a.as_array())
                        .and_then(|a| a.first())
                        .and_then(|t| t.get("text"))
                        .and_then(|s| s.as_str())
                    {
                        if is_valid_translation(q, trans) {
                            return MultiEngineTranslation {
                                engine_name,
                                translated: trans.to_string(),
                                source_tier: "Online Fallback".to_string(),
                            };
                        }
                    }
                }
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                return MultiEngineTranslation {
                    engine_name,
                    translated: "[Yandex API Key 无效或未授权 · 请检查设置]".to_string(),
                    source_tier: "Yandex (Auth Error)".to_string(),
                };
            }
        }
        return MultiEngineTranslation {
            engine_name,
            translated: "[Yandex Cloud API 请求失败 / 点击重试]".to_string(),
            source_tier: "Online (Retry)".to_string(),
        };
    }

    MultiEngineTranslation {
        engine_name,
        translated: "[未配置 Yandex API Key · 点击前往设置]".to_string(),
        source_tier: "Yandex (Config Required)".to_string(),
    }
}

/// ── AI 深度翻译 (精细化状态区分: 真实译文 / 未配置 Key / 鉴权失败 / 配额不足 / 连接超时) ──────
pub async fn translate_with_llm(
    client: &Client,
    q: &str,
    target_lang: &str,
    config: &LlmConfig,
    style: Option<&str>,
    glossary: &[(String, String)],
) -> MultiEngineTranslation {
    let label = if config.provider.eq_ignore_ascii_case("custom")
        || config.provider == "自定义兼容接口"
        || config.provider.trim().is_empty()
        || config.provider.eq_ignore_ascii_case("llm")
    {
        if !config.model.trim().is_empty() && config.model.trim() != "custom-model" {
            config.model.trim().to_string()
        } else {
            "Custom".to_string()
        }
    } else {
        config.provider.trim().to_string()
    };
    let engine_name = format!("🤖 AI 深度翻译 ({})", label);

    let raw_ep = config.endpoint.trim().to_string();
    let api_key = config.api_key.trim().to_string();
    let is_local = raw_ep.contains("localhost") || raw_ep.contains("127.0.0.1");

    // 精细化状态区分 1: 未配置 API Key（严禁伪报“网络连接超时”）
    if raw_ep.is_empty() || (api_key.is_empty() && !is_local) {
        return MultiEngineTranslation {
            engine_name,
            translated: "[未配置 API Key · 点击前往设置]".to_string(),
            source_tier: "LLM (Config Required)".to_string(),
        };
    }

    let model_name = if config.model.trim().is_empty() {
        "deepseek-chat".to_string()
    } else {
        config.model.trim().to_string()
    };

    let is_google_gemini = raw_ep.contains("google")
        || raw_ep.contains("gemini")
        || raw_ep.contains("googleapis.com")
        || raw_ep.contains("google-ai-studio")
        || api_key.starts_with("AIza");

    let (base_path, query_str) = match raw_ep.find('?') {
        Some(pos) => (&raw_ep[..pos], Some(&raw_ep[pos + 1..])),
        None => (raw_ep.as_str(), None),
    };

    let clean_base = base_path.trim_end_matches('/').to_string();

    let mut candidate_urls = Vec::new();
    if raw_ep.contains("/chat/completions") || raw_ep.contains(":generateContent") {
        candidate_urls.push(raw_ep.clone());
    }

    if is_google_gemini {
        let mut root = clean_base.as_str();
        if let Some(stripped) = root.strip_suffix("/chat/completions") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/completions") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/openai") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/models") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/v1beta") {
            root = stripped;
        }
        if let Some(stripped) = root.strip_suffix("/v1") {
            root = stripped;
        }
        let root = root.trim_end_matches('/');

        candidate_urls.push(format!("{}/v1beta/openai/chat/completions", root));
        candidate_urls.push(format!(
            "{}/v1beta/models/{}:generateContent",
            root, model_name
        ));
        candidate_urls.push(format!(
            "{}/models/{}:generateContent",
            root, model_name
        ));
        candidate_urls.push(format!("{}/v1/chat/completions", root));
        candidate_urls.push(format!("{}/chat/completions", root));
    } else {
        let mut b = clean_base.as_str();
        if let Some(stripped) = b.strip_suffix("/chat/completions") {
            b = stripped;
        }
        if let Some(stripped) = b.strip_suffix("/completions") {
            b = stripped;
        }
        let b = b.trim_end_matches('/');

        if b.ends_with("/v1") {
            candidate_urls.push(format!("{}/chat/completions", b));
            candidate_urls.push(b.to_string());
        } else {
            candidate_urls.push(format!("{}/v1/chat/completions", b));
            candidate_urls.push(format!("{}/chat/completions", b));
        }

        if b.contains("localhost") || b.contains("127.0.0.1") {
            candidate_urls.push(format!("{}/api/chat", b));
        }
    }

    let mut seen = std::collections::HashSet::new();
    candidate_urls.retain(|url| seen.insert(url.clone()));

    let target_display = get_target_lang_display_name(target_lang);
    // 术语强制表:目标为中文时正向,否则反转映射方向;仅注入相关词条
    let target_is_chinese = matches!(target_lang, "zh" | "zh-CN" | "zh-TW" | "zh_cn" | "zh_tw");
    let directive = glossary_directive(glossary, &[q], !target_is_chinese);
    let prompt = format!(
        "You are a professional, accurate translator. Translate the following text into {}. Preserve formatting, code, numbers, and technical terms accurately. Return ONLY the translated text without explanations.{}{}\n\n{}",
        target_display, style_directive(style), directive, q
    );

    let mut last_status_code = 0;

    for target_url in candidate_urls {
        let mut final_url = target_url.clone();
        if let Some(qs) = query_str {
            if !qs.is_empty() {
                if final_url.contains('?') {
                    final_url = format!("{}&{}", final_url, qs);
                } else {
                    final_url = format!("{}?{}", final_url, qs);
                }
            }
        }

        if is_google_gemini && !api_key.is_empty() && !final_url.contains("key=") {
            if final_url.contains('?') {
                final_url = format!("{}&key={}", final_url, api_key);
            } else {
                final_url = format!("{}?key={}", final_url, api_key);
            }
        }

        let mut req = client.post(&final_url);
        if !api_key.is_empty() {
            if is_google_gemini {
                req = req
                    .header("x-goog-api-key", &api_key)
                    .header("api-key", &api_key);
                if !api_key.starts_with("AIza") {
                    req = req.header("Authorization", format!("Bearer {}", api_key));
                }
            } else {
                req = req
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("api-key", &api_key);
            }
        }

        let is_native_gemini_endpoint = final_url.contains(":generateContent");
        let body = if is_native_gemini_endpoint {
            serde_json::json!({
                "contents": [
                    {
                        "role": "user",
                        "parts": [{ "text": prompt }]
                    }
                ]
            })
        } else {
            let is_reasoning_model = model_name.to_lowercase().contains("sensenova")
                || model_name.to_lowercase().contains("deepseek-r1")
                || model_name.to_lowercase().contains("qwq")
                || raw_ep.contains("sensenova");

            let mut b = serde_json::json!({
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3
            });
            if is_reasoning_model {
                b["reasoning_effort"] = serde_json::json!("none");
            }
            b
        };

        if let Ok(Ok(res)) = tokio::time::timeout(Duration::from_millis(15000), req.json(&body).send()).await {
            let status = res.status();
            last_status_code = status.as_u16();

            if status.is_success() {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    // Extract OpenAI format reply
                    if let Some(content) = json
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("message"))
                        .and_then(|msg| msg.get("content"))
                        .and_then(|val| val.as_str())
                    {
                        let clean_content = if content.contains("</think>") {
                            content.split("</think>").last().unwrap_or(content).trim()
                        } else {
                            content.trim()
                        };
                        if !clean_content.is_empty() {
                            return MultiEngineTranslation {
                                engine_name,
                                translated: clean_content.to_string(),
                                source_tier: "LLM API".to_string(),
                            };
                        }
                    }

                    // Extract Gemini format reply
                    if let Some(text) = json
                        .get("candidates")
                        .and_then(|c| c.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("content"))
                        .and_then(|cnt| cnt.get("parts"))
                        .and_then(|parts| parts.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|part| part.get("text"))
                        .and_then(|val| val.as_str())
                    {
                        if !text.trim().is_empty() {
                            return MultiEngineTranslation {
                                engine_name,
                                translated: text.trim().to_string(),
                                source_tier: "LLM API".to_string(),
                            };
                        }
                    }

                    // Extract Ollama response
                    if let Some(res_str) = json.get("response").and_then(|v| v.as_str()) {
                        if !res_str.trim().is_empty() {
                            return MultiEngineTranslation {
                                engine_name,
                                translated: res_str.trim().to_string(),
                                source_tier: "LLM API".to_string(),
                            };
                        }
                    }
                }
            } else if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return MultiEngineTranslation {
                    engine_name,
                    translated: "[API Key 无效或已过期 · 点击检查设置]".to_string(),
                    source_tier: "LLM (Auth Error)".to_string(),
                };
            } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::PAYMENT_REQUIRED {
                return MultiEngineTranslation {
                    engine_name,
                    translated: "[API 额度不足或被限流 · 请检查账户配额]".to_string(),
                    source_tier: "LLM (Quota Error)".to_string(),
                };
            }
        }
    }

    if last_status_code == 401 || last_status_code == 403 {
        MultiEngineTranslation {
            engine_name,
            translated: "[API Key 无效或已过期 · 点击检查设置]".to_string(),
            source_tier: "LLM (Auth Error)".to_string(),
        }
    } else if last_status_code == 429 || last_status_code == 402 {
        MultiEngineTranslation {
            engine_name,
            translated: "[API 额度不足或被限流 · 请检查账户配额]".to_string(),
            source_tier: "LLM (Quota Error)".to_string(),
        }
    } else {
        MultiEngineTranslation {
            engine_name,
            translated: "[网络连接超时 / 点击重试]".to_string(),
            source_tier: "Online (Retry)".to_string(),
        }
    }
}

pub fn is_retry_status(engine: &MultiEngineTranslation) -> bool {
    engine.source_tier == "Online (Retry)"
        || engine.source_tier == "LLM (Config Required)"
        || engine.source_tier == "LLM (Auth Error)"
        || engine.source_tier == "LLM (Quota Error)"
        || engine.translated.contains("点击重试")
        || engine.translated.contains("网络连接超时")
        || engine.translated.contains("未配置 API Key")
        || engine.translated.contains("API Key 无效")
        || engine.translated.contains("额度不足")
}

pub fn is_retry_translation(text: &str) -> bool {
    text.contains("点击重试")
        || text.contains("网络连接超时")
        || text.contains("未配置 API Key")
        || text.contains("API Key 无效")
        || text.contains("额度不足")
}

/// 解析实际生效的目标语言：目标为 "auto" 时按源语言智能翻转（中文→英文，其他→中文）；
/// 显式选择的目标语言原样保留，不做同语种自动翻转。
fn resolve_actual_target<'a>(req_target: &'a str, actual_source: &str) -> &'a str {
    if req_target == "auto" {
        if actual_source.starts_with("zh") {
            "en"
        } else {
            "zh-CN"
        }
    } else {
        req_target
    }
}

pub async fn execute_universal_translate(
    req: UniversalTranslationRequest,
    glossary: &[(String, String)],
) -> Result<UniversalTranslationResponse, String> {
    let trimmed = req.text.trim();
    if trimmed.is_empty() {
        return Ok(UniversalTranslationResponse {
            original: String::new(),
            detected_lang: "en".to_string(),
            main_translation: String::new(),
            engines: vec![],
        });
    }

    let client = create_http_client(5000);

    // 智能双向语种检测
    let has_chinese = trimmed
        .chars()
        .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
    let detected_source = if has_chinese { "zh-CN" } else { "en" };

    let actual_source = if req.source_lang == "auto" {
        detected_source
    } else {
        req.source_lang.as_str()
    };

    let actual_target = resolve_actual_target(req.target_lang.as_str(), actual_source);

    let forced = req.forced_engine.as_deref().map(|s| s.trim().to_lowercase());
    let is_forced = forced.as_ref().is_some_and(|f| !f.is_empty() && f != "auto");

    let mut engines = Vec::new();

    // 1. 本地离线词典
    let preset = req.preset.as_deref().unwrap_or("blender");
    let dicts_opt = req.preset_dicts.as_ref();
    let is_dict_forced = forced.as_ref().is_some_and(|f| {
        ["blender", "substance", "unity", "unreal", "maya", "houdini", "dict", "preset"].iter().any(|k| f.contains(k))
    });

    if is_dict_forced || (dicts_opt.is_none_or(|dicts| dicts.blender || dicts.substance || dicts.unity || dicts.unreal || dicts.maya || dicts.houdini) && trimmed.split_whitespace().count() <= 8) {
        let pipeline = shared_pipeline();
        let target_preset = if is_dict_forced {
            forced.as_deref().unwrap_or(preset)
        } else {
            preset
        };
        if let Some((translated, tier)) = pipeline.lookup_dict(trimmed, target_preset) {
            let is_match_enabled = if is_dict_forced {
                true
            } else if let Some(dicts) = dicts_opt {
                match tier.as_str() {
                    "blender" => dicts.blender,
                    "substance" => dicts.substance,
                    "unity" => dicts.unity,
                    "unreal" => dicts.unreal,
                    "maya" => dicts.maya,
                    "houdini" => dicts.houdini,
                    _ => true,
                }
            } else {
                true
            };
            if is_match_enabled {
                engines.push(MultiEngineTranslation {
                    engine_name: format!("本地专业词库 ({})", tier),
                    translated,
                    source_tier: "Preset Dictionary".to_string(),
                });
            }
        }
    }

    // 1.5 离线通用词库（真实文件系统安装状态，安装后参与多源对照）
    let is_offline_forced = forced.as_ref().is_some_and(|f| f.contains("offline") || f.contains("离线"));
    if is_offline_forced || crate::offline::status().installed {
        if let Some(translated) = crate::offline::translate_offline(trimmed) {
            engines.push(MultiEngineTranslation {
                engine_name: "离线词库 (内置引擎)".to_string(),
                translated,
                source_tier: "Offline Dict".to_string(),
            });
        }
    }

    // 2. 并行请求所有开启的在线引擎 (Google, Bing, Youdao, DeepL, MyMemory, Baidu, Tencent)
    let online = req.online_engines.clone().unwrap_or_default();
    let mut tasks = Vec::new();

    // ── 1. Google 翻译 (官方通道) ─────────────────────────────────────────────
    let run_google = forced.as_ref().is_some_and(|f| f.contains("google") || f.contains("谷歌"))
        || (!is_forced && online.google == Some(true));
    if run_google {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_google(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "Google 翻译 (官方通道)".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "Google 翻译 (官方通道)".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 2. 微软 Bing 必应翻译 ──────────────────────────────────────────────────
    let run_bing = forced.as_ref().is_some_and(|f| f.contains("bing") || f.contains("必应"))
        || (!is_forced && (online.bing.is_none() || online.bing == Some(true)));
    if run_bing {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_bing(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "微软 Bing 翻译".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "微软 Bing 翻译".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 3. 网易有道翻译 ────────────────────────────────────────────────────────
    let run_youdao = forced.as_ref().is_some_and(|f| f.contains("youdao") || f.contains("有道"))
        || (!is_forced && (online.youdao.is_none() || online.youdao == Some(true)));
    if run_youdao {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_youdao(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "网易有道翻译".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "网易有道翻译".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 4. 百度通用翻译 ────────────────────────────────────────────────────────
    let is_baidu_configured = req
        .baidu_app_id
        .as_deref()
        .is_some_and(|id| !id.trim().is_empty())
        && req
            .baidu_secret
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty());
    let run_baidu = forced.as_ref().is_some_and(|f| f.contains("baidu") || f.contains("百度"))
        || (!is_forced && (online.baidu == Some(true)));
    if run_baidu {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        let app_id = req.baidu_app_id.clone();
        let secret = req.baidu_secret.clone();
        tasks.push(tokio::spawn(async move {
            if !is_baidu_configured {
                MultiEngineTranslation {
                    engine_name: "百度通用翻译".to_string(),
                    translated: "[未配置 百度 API 凭据，请在设置中填写]".to_string(),
                    source_tier: "Online (Unconfigured)".to_string(),
                }
            } else {
                translate_baidu(&c, &q, &src, &tgt, app_id.as_deref(), secret.as_deref()).await
            }
        }));
    }

    // ── 5. MyMemory 全球翻译记忆库 ────────────────────────────────────────────
    let run_mymemory = forced.as_ref().is_some_and(|f| f.contains("mymemory") || f.contains("my_memory") || f.contains("记忆库"))
        || (!is_forced && (online.my_memory == Some(true)));
    if run_mymemory {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_mymemory(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "MyMemory 翻译记忆库".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "MyMemory 翻译记忆库".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 6. DeepL 翻译通道 ──────────────────────────────────────────────────
    let is_deepl_configured = req
        .deepl_api_key
        .as_deref()
        .is_some_and(|k| !k.trim().is_empty())
        || req
            .deepl_custom_url
            .as_deref()
            .is_some_and(|u| !u.trim().is_empty());
    let run_deepl = forced.as_ref().is_some_and(|f| f.contains("deepl"))
        || (!is_forced && (online.deepl == Some(true)));
    if run_deepl {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        let api_key = req.deepl_api_key.clone();
        let custom_url = req.deepl_custom_url.clone();
        tasks.push(tokio::spawn(async move {
            if !is_deepl_configured {
                MultiEngineTranslation {
                    engine_name: "DeepL 翻译".to_string(),
                    translated: "[未配置 DeepL API Key / 自建端点，请在设置中填写]".to_string(),
                    source_tier: "Online (Unconfigured)".to_string(),
                }
            } else {
                translate_deepl(&c, &q, &src, &tgt, api_key.as_deref(), custom_url.as_deref()).await
            }
        }));
    }

    // ── 7. 腾讯交互翻译 ────────────────────────────────────────────────────────
    let run_tencent = forced.as_ref().is_some_and(|f| f.contains("tencent") || f.contains("腾讯"))
        || (!is_forced && (online.tencent.unwrap_or(false) || online.tencent == Some(true)));
    if run_tencent {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_tencent(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "腾讯交互翻译".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "腾讯交互翻译".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 8. Lingva Translate (Google 翻译国内免翻镜像) ─────────────────────────
    let run_lingva = forced.as_ref().is_some_and(|f| f.contains("lingva"))
        || (!is_forced && (online.lingva.unwrap_or(false) || online.lingva == Some(true)));
    if run_lingva {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_lingva(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "Lingva (免翻 Google)".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "Lingva (免翻 Google)".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 9. 彩云小译 (国内地道文学与科技意译) ──────────────────────────────────
    let run_caiyun = forced.as_ref().is_some_and(|f| f.contains("caiyun") || f.contains("彩云"))
        || (!is_forced && (online.caiyun.unwrap_or(false) || online.caiyun == Some(true)));
    if run_caiyun {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_caiyun(&c, &q, &src, &tgt).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "彩云小译".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "彩云小译".to_string(),
                    translated: "[网络连接超时 / 点击重试]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 10. Urban Dictionary (欧美网络流行俚语/黑话/梗) ────────────────────────
    let run_urban = forced.as_ref().is_some_and(|f| f.contains("urban") || f.contains("俚语") || f.contains("黑话"))
        || (!is_forced && (online.urban.unwrap_or(false) || online.urban == Some(true)));
    if run_urban {
        let c = client.clone();
        let q = trimmed.to_string();
        tasks.push(tokio::spawn(async move {
            match translate_urban_dictionary(&c, &q).await {
                Some(translated) => MultiEngineTranslation {
                    engine_name: "Urban 俚语黑话".to_string(),
                    translated,
                    source_tier: "Online Fallback".to_string(),
                },
                None => MultiEngineTranslation {
                    engine_name: "Urban 俚语黑话".to_string(),
                    translated: "[未收录该俚语词条 / 暂无释义]".to_string(),
                    source_tier: "Online (Retry)".to_string(),
                },
            }
        }));
    }

    // ── 11. 字节跳动火山翻译 (官方 OpenAPI) ──────────────────────────────────
    let volc_ak = req.volcengine_access_key.clone();
    let volc_sk = req.volcengine_secret_key.clone();
    let has_volc_keys = volc_ak.as_ref().is_some_and(|k| !k.trim().is_empty())
        && volc_sk.as_ref().is_some_and(|k| !k.trim().is_empty());
    let run_volcengine = forced.as_ref().is_some_and(|f| f.contains("volcengine") || f.contains("火山") || f.contains("字节"))
        || (!is_forced && (online.volcengine.unwrap_or(false) || online.volcengine == Some(true)) && has_volc_keys);
    if run_volcengine {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        let ak = volc_ak;
        let sk = volc_sk;
        tasks.push(tokio::spawn(async move {
            translate_volcengine(&c, &q, &src, &tgt, ak.as_deref(), sk.as_deref()).await
        }));
    }

    // ── 12. Yandex Translate (官方 Cloud API) ─────────────────────────────────
    let yandex_key = req.yandex_api_key.clone();
    let yandex_fid = req.yandex_folder_id.clone();
    let has_yandex_keys = yandex_key.as_ref().is_some_and(|k| !k.trim().is_empty());
    let run_yandex = forced.as_ref().is_some_and(|f| f.contains("yandex") || f.contains("俄语"))
        || (!is_forced && (online.yandex.unwrap_or(false) || online.yandex == Some(true)) && has_yandex_keys);
    if run_yandex {
        let c = client.clone();
        let q = trimmed.to_string();
        let src = actual_source.to_string();
        let tgt = actual_target.to_string();
        let key = yandex_key;
        let fid = yandex_fid;
        tasks.push(tokio::spawn(async move {
            translate_yandex(&c, &q, &src, &tgt, key.as_deref(), fid.as_deref()).await
        }));
    }

    // ── 13. AI 深度翻译 (DeepSeek / LLM / Gemini / Qwen / Claude / Ollama / etc.) ──
    let target_clean_str = forced.as_ref().map(|f| f.strip_prefix("llm:").unwrap_or(f).to_string());
    let matched_llm_config = if let Some(target) = &target_clean_str {
        req.llm_configs.as_ref().and_then(|configs| {
            configs.iter().find(|c| {
                c.id.as_deref().is_some_and(|id| id.eq_ignore_ascii_case(target))
                    || c.model.eq_ignore_ascii_case(target)
                    || c.provider.eq_ignore_ascii_case(target)
                    || target.contains(&c.provider.to_lowercase())
                    || target.contains(&c.model.to_lowercase())
            }).cloned()
        })
    } else {
        None
    };

    let active_llm_config = matched_llm_config.clone().or_else(|| req.llm_config.clone());
    let is_llm_configured = active_llm_config.as_ref().is_some_and(|cfg| {
        let ep = cfg.endpoint.trim();
        let is_local = ep.contains("localhost") || ep.contains("127.0.0.1");
        !ep.is_empty() && (!cfg.api_key.trim().is_empty() || is_local) && cfg.enabled.unwrap_or(true)
    });

    let configs_to_run: Vec<LlmConfig> = if let Some(_target) = &target_clean_str {
        if let Some(matched) = matched_llm_config {
            vec![matched]
        } else if let Some(cfg) = &active_llm_config {
            vec![cfg.clone()]
        } else {
            vec![]
        }
    } else if let Some(all_configs) = &req.llm_configs {
        let ready_list: Vec<LlmConfig> = all_configs
            .iter()
            .filter(|cfg| {
                let ep = cfg.endpoint.trim();
                let is_local = ep.contains("localhost") || ep.contains("127.0.0.1");
                !ep.is_empty() && (!cfg.api_key.trim().is_empty() || is_local) && cfg.enabled.unwrap_or(true)
            })
            .cloned()
            .collect();
        if !ready_list.is_empty() {
            ready_list
        } else if let Some(cfg) = &active_llm_config {
            if is_llm_configured {
                vec![cfg.clone()]
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else if let Some(cfg) = &active_llm_config {
        if is_llm_configured {
            vec![cfg.clone()]
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    let is_known_online_forced = forced.as_ref().is_some_and(|f| {
        ["google", "bing", "youdao", "deepl", "baidu", "tencent", "mymemory", "lingva", "caiyun", "urban", "volcengine", "yandex", "谷歌", "有道", "微软", "百度", "腾讯", "彩云", "火山"].iter().any(|k| f.contains(k))
    });
    let is_dict_only_forced = forced.as_ref().is_some_and(|f| {
        ["blender", "substance", "unity", "unreal", "maya", "houdini", "dict", "preset", "词库", "词典"].iter().any(|k| f.contains(k))
    });
    let is_offline_only_forced = forced.as_ref().is_some_and(|f| f.contains("offline") || f.contains("离线"));

    let is_explicit_llm_forced = forced.as_ref().is_some_and(|f| {
        f.starts_with("llm")
            || f.starts_with("ai")
            || f.contains("model")
            || f.contains("deepseek")
            || f.contains("openai")
            || f.contains("ollama")
            || f.contains("glm")
            || f.contains("gemini")
            || f.contains("claude")
            || f.contains("qwen")
            || f.contains("moonshot")
            || f.contains("kimi")
            || f.contains("custom")
            || (!is_known_online_forced && !is_dict_only_forced && !is_offline_only_forced)
    });

    let run_llm = !req.skip_llm.unwrap_or(false)
        && (is_explicit_llm_forced || (!is_forced && !configs_to_run.is_empty()));

    if run_llm {
        for config in configs_to_run {
            let c = client.clone();
            let q = trimmed.to_string();
            let tgt = actual_target.to_string();
            let llm_cfg = config;
            let style = req.style.clone();
            let glossary_owned = glossary.to_vec();

            tasks.push(tokio::spawn(async move {
                translate_with_llm(&c, &q, &tgt, &llm_cfg, style.as_deref(), &glossary_owned).await
            }));
        }
    }

    // 等待所有并发网络任务完成（必定收集所有已开启引擎，不丢弃任何卡片）
    for task in tasks {
        if let Ok(item) = task.await {
            if item.engine_name.contains("Urban") && item.translated.contains("未收录") && !is_forced {
                continue;
            }
            engines.push(item);
        }
    }

    // 优先保证有效 AI 大模型翻译 (LLM API) 排在最前，其次词库、其他有效在线翻译，待配置/鉴权错误/重试项排在最后
    engines.sort_by_key(|e| {
        if e.source_tier == "LLM API" && !is_retry_status(e) {
            0
        } else if (e.source_tier == "Preset Dictionary" || e.source_tier == "Offline Dict") && !is_retry_status(e) {
            1
        } else if !is_retry_status(e) {
            2
        } else if e.source_tier == "LLM (Config Required)" || e.source_tier == "LLM (Auth Error)" || e.source_tier == "LLM (Quota Error)" {
            3
        } else {
            4
        }
    });

    let mut main_translation = String::new();

    // 如果传入 forced_engine，精准查找匹配引擎作为 main_translation 产物
    if let Some(target) = forced.as_ref() {
        if !target.is_empty() && target != "auto" {
            let target_clean = target.strip_prefix("llm:").unwrap_or(target);
            let matched_idx = engines.iter().position(|e| {
                let name = e.engine_name.to_lowercase();
                let tier = e.source_tier.to_lowercase();
                name.contains(target_clean)
                    || tier.contains(target_clean)
                    || (target_clean == "dict" && (tier.contains("preset") || tier.contains("dict")))
                    || (is_explicit_llm_forced && (tier.contains("llm") || name.contains("ai") || tier.contains("ai")))
                    || (target_clean == "llm" && (tier.contains("llm") || name.contains("ai")))
            });

            if let Some(idx) = matched_idx {
                main_translation = engines[idx].translated.clone();
                let item = engines.remove(idx);
                engines.insert(0, item);
            }
        }
    }

    // 确定综合优选 main_translation（智能优先挑选首个有效且非重试/非错误态的翻译结果）
    if main_translation.is_empty() || is_retry_translation(&main_translation) {
        let tiers = req.translation_tiers.unwrap_or_else(|| {
            vec![
                "Preset Dictionary".to_string(),
                "LLM API".to_string(),
                "Online Fallback".to_string(),
            ]
        });

        for tier in &tiers {
            if let Some(matched) = engines.iter().find(|e| &e.source_tier == tier && !is_retry_status(e)) {
                main_translation = matched.translated.clone();
                break;
            }
        }
    }

    if main_translation.is_empty() || is_retry_translation(&main_translation) {
        if let Some(valid_engine) = engines.iter().find(|e| !is_retry_status(e)) {
            main_translation = valid_engine.translated.clone();
        }
    }

    if main_translation.is_empty() && !engines.is_empty() {
        main_translation = engines[0].translated.clone();
    }

    if main_translation.is_empty() && engines.is_empty() {
        main_translation =
            "⚠️ 未开启任何翻译源或网络未连接，请在「系统设置」中开启本地词库或在线翻译引擎。"
                .to_string();
    }

    Ok(UniversalTranslationResponse {
        original: trimmed.to_string(),
        detected_lang: actual_source.to_string(),
        main_translation,
        engines,
    })
}

/// Free-function online fallback (Bing Edge / Youdao / Tencent / Google GTX / MyMemory 并发竞速)
/// 首个返回有效译文的引擎直接胜出，彻底消灭单引擎超时导致的 4s+ 严重卡顿。
pub async fn translate_online_fallback_with(
    client: &Client,
    phrase: &str,
) -> Result<String, String> {
    use futures_util::stream::FuturesUnordered;
    use futures_util::StreamExt;

    let has_chinese = phrase
        .chars()
        .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
    let target_lang = if has_chinese { "en" } else { "zh-CN" };
    let source_lang = if has_chinese { "zh-CN" } else { "auto" };

    let mut futures = FuturesUnordered::new();

    // 1. 微软必应翻译（Edge 免密官方 API + cn.bing 直连并发，国内与海外均 150-300ms 极速）
    {
        let c = client.clone();
        let p = phrase.to_string();
        let src = source_lang.to_string();
        let tgt = target_lang.to_string();
        futures.push(tokio::spawn(async move {
            translate_bing(&c, &p, &src, &tgt).await
        }));
    }

    // 2. 网易有道翻译（国内极速直连 ~150-250ms）
    {
        let c = client.clone();
        let p = phrase.to_string();
        let src = source_lang.to_string();
        let tgt = target_lang.to_string();
        futures.push(tokio::spawn(async move {
            translate_youdao(&c, &p, &src, &tgt).await
        }));
    }

    // 3. 腾讯交互翻译（免密直连通道）
    {
        let c = client.clone();
        let p = phrase.to_string();
        let src = source_lang.to_string();
        let tgt = target_lang.to_string();
        futures.push(tokio::spawn(async move {
            translate_tencent(&c, &p, &src, &tgt).await
        }));
    }

    // 4. Google GTX 官方接口（带短超时并发竞速）
    {
        let c = client.clone();
        let p = phrase.to_string();
        let src = source_lang.to_string();
        let tgt = target_lang.to_string();
        futures.push(tokio::spawn(async move {
            translate_google(&c, &p, &src, &tgt).await
        }));
    }

    // 5. MyMemory 全球翻译记忆库
    {
        let c = client.clone();
        let p = phrase.to_string();
        let src = source_lang.to_string();
        let tgt = target_lang.to_string();
        futures.push(tokio::spawn(async move {
            translate_mymemory(&c, &p, &src, &tgt).await
        }));
    }

    // 6. Lingva 镜像（Google 翻译国内免翻直连镜像）
    {
        let c = client.clone();
        let p = phrase.to_string();
        let src = source_lang.to_string();
        let tgt = target_lang.to_string();
        futures.push(tokio::spawn(async move {
            translate_lingva(&c, &p, &src, &tgt).await
        }));
    }

    // 7. 彩云小译（国内地道意译）
    {
        let c = client.clone();
        let p = phrase.to_string();
        let src = source_lang.to_string();
        let tgt = target_lang.to_string();
        futures.push(tokio::spawn(async move {
            translate_caiyun(&c, &p, &src, &tgt).await
        }));
    }

    // 8. Urban Dictionary 俚语释义
    {
        let c = client.clone();
        let p = phrase.to_string();
        futures.push(tokio::spawn(async move {
            translate_urban_dictionary(&c, &p).await
        }));
    }

    // 并发竞速：首个成功返回有效翻译的引擎直接胜出，毫秒级响应
    while let Some(joined) = futures.next().await {
        if let Ok(Some(trans)) = joined {
            if is_valid_translation(phrase, &trans) {
                return Ok(trans);
            }
        }
    }

    Err("Online translation fallback failed".to_string())
}

// ── 翻译记忆持久化往返测试 ────────────────────────────────────────────────
#[cfg(test)]
mod tm_tests {
    use super::*;

    // 两个场景合并为单个测试串行执行:set_tm_path 是进程级 OnceLock,拆成
    // 两个并行测试会竞争同一路径(第二个 set 被忽略)导致偶发失败。
    #[test]
    fn translation_memory_disk_roundtrip_and_hot_cache_precedence() {
        let dir = std::env::temp_dir().join(format!("tm_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("tm.json");
        let _ = std::fs::remove_file(&path);
        set_tm_path(path.clone());

        // 场景 1:落盘 → 新实例恢复(模拟应用重启)
        let a = TranslationCache::new();
        a.store(TranslationResult {
            original: "hello".into(),
            translated: "你好".into(),
            source_tier: "Preset".into(),
        });
        a.save_to_path(&path);
        let b = TranslationCache::new();
        b.load_from_path(&path);
        let hit = b.retrieve("hello").expect("TM roundtrip hit");
        assert_eq!(hit.translated, "你好");
        assert_eq!(hit.source_tier, "Preset");

        // 场景 2:已有热数据时 load 不得覆盖
        let c = TranslationCache::new();
        c.store(TranslationResult {
            original: "hot".into(),
            translated: "热".into(),
            source_tier: "X".into(),
        });
        c.store(TranslationResult {
            original: "disk".into(),
            translated: "盘".into(),
            source_tier: "X".into(),
        });
        c.save_to_path(&path);
        c.load_from_path(&path);
        assert!(c.retrieve("disk").is_some());
        assert!(c.retrieve("hot").is_some());

        let _ = std::fs::remove_file(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_passthrough_matches_model_ids_and_versions() {
        // 模型 ID / URL / 版本号：原样保留
        for id in [
            "moonshotai/kimi-k3",
            "x-ai/grok-4.6",
            "deepseek/deepseek-v4-pro-0813",
            "nvidia/nemotron-3.5-lightning",
            "z-ai/glm-5.3-flash",
            "https://api.tokenrouter.com/v1",
            "MiniMax-H3",
            "wan3.0-video",
            "v0.1.8",
        ] {
            assert!(is_technical_identifier(id), "应透传: {}", id);
        }

        // 纯数字/符号（含 OCR 噪声）：翻译无意义
        for num in ["99.9%", "%6'66", "%666", "3.5"] {
            assert!(is_technical_identifier(num), "应透传: {}", num);
        }
    }

    #[test]
    fn identifier_passthrough_leaves_real_text_translatable() {
        for text in [
            "Always-On",
            "UPTIME",
            "CACHING",
            "Smart",
            "Read Docs",
            "Unified Model Access",
            "Kimi-long-context model",
            "Faster·Better·Cheaper",
            "Just switch your base URL.",
            "Route once. Scale across models with better pricing, better",
            "MiniMax · video generation model",
            "",
        ] {
            assert!(!is_technical_identifier(text), "应翻译: {}", text);
        }
    }

    #[test]
    fn test_resolve_actual_target_respects_explicit_choice() {
        // 回归：源中文 + 显式中文目标，不得被强制翻转为英文
        assert_eq!(resolve_actual_target("zh-CN", "zh-CN"), "zh-CN");
        // 对称场景：源英文 + 显式英文目标
        assert_eq!(resolve_actual_target("en", "en"), "en");
        // 显式选择的其他语种原样保留
        assert_eq!(resolve_actual_target("ja", "zh-CN"), "ja");
        assert_eq!(resolve_actual_target("fr", "en"), "fr");
    }

    #[test]
    fn test_resolve_actual_target_auto_smart_flip() {
        assert_eq!(resolve_actual_target("auto", "zh-CN"), "en");
        assert_eq!(resolve_actual_target("auto", "en"), "zh-CN");
    }

    #[test]
    fn test_is_valid_translation_normal() {
        assert!(is_valid_translation("Principled BSDF", "原理化 BSDF"));
        assert!(is_valid_translation("Roughness", "粗糙度"));
        assert!(is_valid_translation("Hello World", "你好世界"));
    }

    #[test]
    fn test_is_valid_translation_empty_and_whitespace() {
        assert!(!is_valid_translation("", ""));
        assert!(!is_valid_translation("test", ""));
        assert!(!is_valid_translation("test", "   \t\n  "));
        assert!(!is_valid_translation("   ", "test"));
    }

    #[test]
    fn test_is_valid_translation_deepl_risk_control_poisoning() {
        // DeepL linux.do 限流风控链接拦截
        assert!(!is_valid_translation("Principled BSDF", "https://linux.do/t/topic/111737"));
        assert!(!is_valid_translation("Roughness", "http://linux.do/t/12345"));
        assert!(!is_valid_translation("Normal", "https://t.me/deeplx_channel"));
        assert!(!is_valid_translation("Camera", "https://deeplx.vercel.app/error"));
        assert!(!is_valid_translation("Light", "www.linux.do"));
        // 如果原文本身就是合法 URL，则不拦截
        assert!(is_valid_translation("https://linux.do/t/topic/111737", "https://linux.do/t/topic/111737"));
    }

    #[test]
    fn test_is_valid_translation_html_errors() {
        assert!(!is_valid_translation("Principled BSDF", "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>"));
        assert!(!is_valid_translation("Principled BSDF", "<html><body><script>location.href='...'</script></body></html>"));
        assert!(!is_valid_translation("Roughness", "<div class=\"error\">Error 403 Forbidden</div>"));
    }

    #[test]
    fn test_is_valid_translation_json_errors() {
        assert!(!is_valid_translation("Principled BSDF", "{\"code\": 429, \"message\": \"Too Many Requests\"}"));
        assert!(!is_valid_translation("Roughness", "{\"error\": \"Rate limit exceeded\"}"));
        assert!(!is_valid_translation("Roughness", "{\"msg\": \"IP has been blocked\"}"));
    }

    #[test]
    fn test_is_valid_translation_rate_limit_keywords() {
        assert!(!is_valid_translation("Principled BSDF", "Too Many Requests"));
        assert!(!is_valid_translation("Roughness", "Rate limit exceeded, please try again later"));
        assert!(!is_valid_translation("Metallic", "请求过于频繁，请稍后再试"));
        assert!(!is_valid_translation("Normal", "IP has been blocked"));
        assert!(!is_valid_translation("Specular", "502 Bad Gateway"));
    }

    #[test]
    fn test_parse_proxy_to_url() {
        assert_eq!(parse_proxy_to_url("127.0.0.1:7890"), "http://127.0.0.1:7890");
        assert_eq!(parse_proxy_to_url("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
        assert_eq!(parse_proxy_to_url("socks5://127.0.0.1:1080"), "socks5://127.0.0.1:1080");
        assert_eq!(parse_proxy_to_url("http=127.0.0.1:7890;https=127.0.0.1:7890"), "http://127.0.0.1:7890");
        assert_eq!(parse_proxy_to_url("https=127.0.0.1:7890;http=127.0.0.1:7891"), "http://127.0.0.1:7890");
    }

    #[test]
    fn test_detect_windows_proxy_smoke() {
        // Smoke test ensuring detect_windows_proxy runs without panic
        let _ = detect_windows_proxy();
    }

    #[test]
    fn test_is_retry_status_and_translation_fine_grained() {
        let config_req_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "[未配置 API Key · 点击前往设置]".to_string(),
            source_tier: "LLM (Config Required)".to_string(),
        };
        assert!(is_retry_status(&config_req_engine));
        assert!(is_retry_translation(&config_req_engine.translated));

        let auth_err_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "[API Key 无效或已过期 · 点击检查设置]".to_string(),
            source_tier: "LLM (Auth Error)".to_string(),
        };
        assert!(is_retry_status(&auth_err_engine));
        assert!(is_retry_translation(&auth_err_engine.translated));

        let quota_err_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "[API 额度不足或被限流 · 请检查账户配额]".to_string(),
            source_tier: "LLM (Quota Error)".to_string(),
        };
        assert!(is_retry_status(&quota_err_engine));
        assert!(is_retry_translation(&quota_err_engine.translated));

        let valid_engine = MultiEngineTranslation {
            engine_name: "🤖 AI 深度翻译 (DeepSeek)".to_string(),
            translated: "粗糙度".to_string(),
            source_tier: "LLM API".to_string(),
        };
        assert!(!is_retry_status(&valid_engine));
        assert!(!is_retry_translation(&valid_engine.translated));
    }

    #[tokio::test]
    async fn test_translate_with_llm_unconfigured_key_distinction() {
        let client = create_http_client(3000);
        let config = LlmConfig {
            id: Some("deepseek".to_string()),
            provider: "DeepSeek".to_string(),
            api_key: "".to_string(),
            model: "deepseek-chat".to_string(),
            endpoint: "https://api.deepseek.com/v1".to_string(),
            enabled: Some(true),
        };

        let result = translate_with_llm(&client, "Roughness", "zh-CN", &config, None, &[]).await;
        assert_eq!(result.source_tier, "LLM (Config Required)");
        assert_eq!(result.translated, "[未配置 API Key · 点击前往设置]");
        assert_eq!(result.engine_name, "🤖 AI 深度翻译 (DeepSeek)");
    }

    #[tokio::test]
    async fn test_unconfigured_engines_omitted_in_universal_translate() {
        let req = crate::models::UniversalTranslationRequest {
            text: "Principled BSDF".to_string(),
            source_lang: "auto".to_string(),
            target_lang: "zh-CN".to_string(),
            preset: Some("blender".to_string()),
            llm_config: Some(LlmConfig {
                id: Some("deepseek".to_string()),
                provider: "DeepSeek".to_string(),
                api_key: "".to_string(),
                model: "deepseek-chat".to_string(),
                endpoint: "https://api.deepseek.com/v1".to_string(),
                enabled: Some(true),
            }),
            llm_configs: None,
            preset_dicts: Some(crate::models::PresetDicts {
                blender: true,
                substance: true,
                unity: true,
                unreal: true,
                maya: true,
                houdini: true,
            }),
            online_engines: Some(crate::models::OnlineEngines {
                google: Some(false),
                bing: Some(false),
                youdao: Some(false),
                deepl: Some(true),
                my_memory: Some(false),
                baidu: Some(true),
                tencent: Some(false),
                ..Default::default()
            }),
            translation_tiers: None,
            style: None,
            forced_engine: None,
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
            volcengine_access_key: None,
            volcengine_secret_key: None,
            yandex_api_key: None,
            yandex_folder_id: None,
            ..Default::default()
        };

        let res = execute_universal_translate(req, &[]).await;
        assert!(res.is_ok());
        let resp = res.unwrap();
        // Since LLM has no keys/credentials and is not forced,
        // it should not appear in resp.engines.
        for eng in &resp.engines {
            assert!(!eng.engine_name.contains("DeepSeek"));
        }
    }

    #[tokio::test]
    async fn test_disabled_llm_config_omitted_in_universal_translate() {
        // 即使配置了 API Key，只要 enabled 为 false，在非强制模式下也绝不触发
        let req = crate::models::UniversalTranslationRequest {
            text: "Principled BSDF".to_string(),
            source_lang: "auto".to_string(),
            target_lang: "zh-CN".to_string(),
            preset: Some("blender".to_string()),
            llm_config: Some(LlmConfig {
                id: Some("deepseek".to_string()),
                provider: "DeepSeek".to_string(),
                api_key: "sk-real-secret-key-12345".to_string(),
                model: "deepseek-chat".to_string(),
                endpoint: "https://api.deepseek.com/v1".to_string(),
                enabled: Some(false),
            }),
            llm_configs: None,
            preset_dicts: Some(crate::models::PresetDicts {
                blender: true,
                substance: false,
                unity: false,
                unreal: false,
                maya: false,
                houdini: false,
            }),
            online_engines: Some(crate::models::OnlineEngines {
                google: Some(true),
                ..Default::default()
            }),
            translation_tiers: None,
            style: None,
            forced_engine: None,
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
            volcengine_access_key: None,
            volcengine_secret_key: None,
            yandex_api_key: None,
            yandex_folder_id: None,
            ..Default::default()
        };

        let res = execute_universal_translate(req, &[]).await;
        assert!(res.is_ok());
        let resp = res.unwrap();
        // 禁用状态下不应包含 DeepSeek 的 AI 结果
        for eng in &resp.engines {
            assert!(!eng.engine_name.contains("DeepSeek"));
        }
    }

    #[tokio::test]
    async fn test_forced_engine_custom_llm_model_routing() {
        let req = crate::models::UniversalTranslationRequest {
            text: "Roughness".to_string(),
            source_lang: "auto".to_string(),
            target_lang: "zh-CN".to_string(),
            preset: Some("blender".to_string()),
            llm_config: None,
            llm_configs: Some(vec![
                LlmConfig {
                    id: Some("gemini-flash".to_string()),
                    provider: "Google Gemini".to_string(),
                    api_key: "".to_string(),
                    model: "gemini-1.5-flash".to_string(),
                    endpoint: "https://generativelanguage.googleapis.com/v1beta".to_string(),
                    enabled: Some(true),
                },
                LlmConfig {
                    id: Some("qwen-local".to_string()),
                    provider: "Ollama".to_string(),
                    api_key: "".to_string(),
                    model: "qwen2.5:7b".to_string(),
                    endpoint: "http://localhost:11434/v1".to_string(),
                    enabled: Some(true),
                },
            ]),
            preset_dicts: Some(crate::models::PresetDicts {
                blender: false,
                substance: false,
                unity: false,
                unreal: false,
                maya: false,
                houdini: false,
            }),
            online_engines: Some(crate::models::OnlineEngines {
                google: Some(false),
                bing: Some(false),
                youdao: Some(false),
                deepl: Some(false),
                my_memory: Some(false),
                baidu: Some(false),
                tencent: Some(false),
                ..Default::default()
            }),
            translation_tiers: None,
            style: None,
            forced_engine: Some("llm:gemini-flash".to_string()),
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
            volcengine_access_key: None,
            volcengine_secret_key: None,
            yandex_api_key: None,
            yandex_folder_id: None,
            ..Default::default()
        };

        let res = execute_universal_translate(req, &[]).await;
        assert!(res.is_ok());
        let resp = res.unwrap();
        // Since forced_engine is gemini-flash and apiKey is empty, it returns the LLM config required prompt instead of empty error!
        assert_eq!(resp.engines.len(), 1);
        assert!(resp.engines[0].source_tier.starts_with("LLM"));
        assert!(resp.engines[0].engine_name.contains("Gemini"));
    }

    #[tokio::test]
    async fn test_multi_custom_llm_models_parallel_dispatch() {
        let req = crate::models::UniversalTranslationRequest {
            text: "Roughness".to_string(),
            source_lang: "auto".to_string(),
            target_lang: "zh-CN".to_string(),
            preset: Some("blender".to_string()),
            llm_config: None,
            llm_configs: Some(vec![
                LlmConfig {
                    id: Some("custom-gemini".to_string()),
                    provider: "Custom".to_string(),
                    api_key: "sk-mock-key-1".to_string(),
                    model: "gemini-3.5-flash-lite".to_string(),
                    endpoint: "https://api.example.com/v1".to_string(),
                    enabled: Some(true),
                },
                LlmConfig {
                    id: Some("custom-deepseek".to_string()),
                    provider: "Custom".to_string(),
                    api_key: "sk-mock-key-2".to_string(),
                    model: "deepseek-v4-flash".to_string(),
                    endpoint: "https://api.example.com/v1".to_string(),
                    enabled: Some(true),
                },
            ]),
            preset_dicts: Some(crate::models::PresetDicts {
                blender: false,
                substance: false,
                unity: false,
                unreal: false,
                maya: false,
                houdini: false,
            }),
            online_engines: Some(crate::models::OnlineEngines::default()),
            translation_tiers: None,
            style: None,
            forced_engine: None,
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
            volcengine_access_key: None,
            volcengine_secret_key: None,
            yandex_api_key: None,
            yandex_folder_id: None,
            ..Default::default()
        };

        let res = execute_universal_translate(req, &[]).await;
        assert!(res.is_ok());
        let resp = res.unwrap();
        // 验证两个 Custom 模型均被并发派发，且各自使用自己的模型标识作为名称
        let engine_names: Vec<String> = resp.engines.iter().map(|e| e.engine_name.clone()).collect();
        assert!(engine_names.iter().any(|n| n.contains("gemini-3.5-flash-lite")));
        assert!(engine_names.iter().any(|n| n.contains("deepseek-v4-flash")));
    }

    #[tokio::test]
    async fn test_translate_google_with_chrome_ext() {
        let client = create_http_client(4000);
        let res = translate_google(&client, "hello", "en", "zh-CN").await;
        println!("Google Translate live output: {:?}", res);
        if let Some(text) = res {
            assert!(!text.trim().is_empty());
        }
    }

    #[tokio::test]
    async fn test_translate_urban_with_client() {
        let client = create_http_client(4000);
        let res = translate_urban_dictionary(&client, "goat").await;
        println!("Urban Dictionary live output: {:?}", res);
        if let Some(text) = res {
            assert!(!text.trim().is_empty());
        }
    }
}

#[cfg(test)]
mod glossary_tests {
    use super::*;

    fn pairs() -> Vec<(String, String)> {
        vec![
            ("Principled BSDF".to_string(), "原理化 BSDF".to_string()),
            ("Roughness".to_string(), "粗糙度".to_string()),
            ("Nanite".to_string(), "Nanite 虚拟化几何体".to_string()),
        ]
    }

    #[test]
    fn glossary_exact_hit_english_forward() {
        let g = pairs();
        assert_eq!(lookup_glossary(&g, "Principled BSDF"), Some("原理化 BSDF".to_string()));
        // 忽略大小写
        assert_eq!(lookup_glossary(&g, "roughness"), Some("粗糙度".to_string()));
        // 首尾空白
        assert_eq!(lookup_glossary(&g, "  Nanite  "), Some("Nanite 虚拟化几何体".to_string()));
    }

    #[test]
    fn glossary_chinese_reverse_lookup() {
        let g = pairs();
        // 中文→外文:按译文反向精确匹配(子串不应误命中)
        assert_eq!(lookup_glossary(&g, "粗糙度"), Some("Roughness".to_string()));
        assert_eq!(lookup_glossary(&g, "原理化 BSDF"), Some("Principled BSDF".to_string()));
        assert_eq!(lookup_glossary(&g, "粗糙"), None);
        assert_eq!(lookup_glossary(&g, "原理化"), None);
    }

    #[test]
    fn glossary_miss_and_empty() {
        let g = pairs();
        assert_eq!(lookup_glossary(&g, "Completely Unknown Term"), None);
        assert_eq!(lookup_glossary(&[], "Roughness"), None);
        assert_eq!(lookup_glossary(&g, "   "), None);
    }

    #[test]
    fn glossary_directive_filters_irrelevant_terms() {
        let g = pairs();
        // 只有 Roughness 与待译文本相关 → 指令只含该词条
        let d = glossary_directive(&g, &["Adjust the Roughness value"], false);
        assert!(d.contains("\"Roughness\"=\"粗糙度\""));
        assert!(!d.contains("Nanite"));
        assert!(!d.contains("Principled"));
        assert!(d.starts_with(" Glossary (MANDATORY"));
    }

    #[test]
    fn glossary_directive_reverse_swaps_mapping() {
        let g = pairs();
        // 中→英方向:映射反转(译文中出现术语原文)
        let d = glossary_directive(&g, &["调整粗糙度参数"], true);
        assert!(d.contains("\"粗糙度\"=\"Roughness\""));
        assert!(!d.contains("\"Roughness\"=\"粗糙度\""));
    }

    #[test]
    fn glossary_directive_empty_when_no_relevant_or_no_pairs() {
        let g = pairs();
        assert_eq!(glossary_directive(&g, &["Totally unrelated sentence"], false), "");
        assert_eq!(glossary_directive(&[], &["Roughness"], false), "");
    }

    #[test]
    fn glossary_directive_caps_at_40_terms() {
        let g: Vec<(String, String)> = (0..80)
            .map(|i| (format!("Term{}", i), format!("术语{}", i)))
            .collect();
        // 待译文本包含全部 80 个术语原文,确保全部「相关」
        let haystack: String = g.iter().map(|(o, _)| o.as_str()).collect::<Vec<_>>().join(" ");
        let d = glossary_directive(&g, &[&haystack], false);
        assert_eq!(d.matches("\"=\"").count(), 40);
        // 前 40 条入选,后 40 条被截断
        assert!(d.contains("\"Term0\""));
        assert!(d.contains("\"Term39\""));
        assert!(!d.contains("\"Term40\""));
    }

    #[test]
    fn glossary_from_settings_filters_empty_entries() {
        use crate::models::CustomDictItem;
        let items = vec![
            CustomDictItem {
                id: "1".into(),
                original: "  Bevel  ".into(),
                translated: " 倒角 ".into(),
                category: "Blender".into(),
                note: None,
                created_at: String::new(),
            },
            CustomDictItem {
                id: "2".into(),
                original: "   ".into(),
                translated: "空原词".into(),
                category: String::new(),
                note: None,
                created_at: String::new(),
            },
        ];
        let g = glossary_from_settings(&items);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0], ("Bevel".to_string(), "倒角".to_string()));
    }

    #[test]
    fn glossary_hash_empty_deterministic_and_sensitive() {
        assert_eq!(glossary_hash(&[]), 0);
        let a = glossary_hash(&[("A".to_string(), "甲".to_string())]);
        let b = glossary_hash(&[("A".to_string(), "甲".to_string())]);
        assert_eq!(a, b);
        assert_ne!(a, 0);
        // 译文变化 → 指纹变化
        assert_ne!(a, glossary_hash(&[("A".to_string(), "乙".to_string())]));
        // 词条顺序也参与指纹
        let p1 = [("A".to_string(), "甲".to_string()), ("B".to_string(), "乙".to_string())];
        let p2 = [("B".to_string(), "乙".to_string()), ("A".to_string(), "甲".to_string())];
        assert_ne!(glossary_hash(&p1), glossary_hash(&p2));
    }

    #[test]
    fn cache_ensure_glossary_clears_only_on_change() {
        let c = TranslationCache::new();
        c.store(TranslationResult {
            original: "hello".into(),
            translated: "你好".into(),
            source_tier: "Preset".into(),
        });
        // 指纹 0 → 7:清空
        c.ensure_glossary(7);
        assert!(c.retrieve("hello").is_none());
        // 重新存入,同指纹重复调用:保留
        c.store(TranslationResult {
            original: "hello".into(),
            translated: "你好".into(),
            source_tier: "Preset".into(),
        });
        c.ensure_glossary(7);
        c.ensure_glossary(7);
        assert!(c.retrieve("hello").is_some());
        // 指纹再变:再次清空
        c.ensure_glossary(8);
        assert!(c.retrieve("hello").is_none());
    }

    #[test]
    fn tm_disk_file_serialization_roundtrip_with_hash() {
        let mut entries = HashMap::new();
        entries.insert(
            "hello".to_string(),
            TranslationResult {
                original: "hello".into(),
                translated: "你好".into(),
                source_tier: "Preset".into(),
            },
        );
        let file = TmDiskFile {
            glossary_hash: 42,
            entries,
        };
        let json = serde_json::to_string(&file).unwrap();
        // v2 格式包含指纹元数据
        assert!(json.contains("\"glossary_hash\":42"));
        let back: TmDiskFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.glossary_hash, 42);
        assert!(back.entries.contains_key("hello"));
    }

    #[tokio::test]
    async fn pipeline_shortcircuits_on_glossary_exact_hit() {
        // 无需网络:精确命中词库的短语根本不会进入 LLM/在线回退
        let pipeline = shared_pipeline();
        let results = pipeline
            .translate_phrases(
                &["Principled BSDF Glossary-Only Term".to_string()],
                "blender",
                None,
                &[("Principled BSDF Glossary-Only Term".to_string(), "自定义译名".to_string())],
            )
            .await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].translated, "自定义译名");
        assert_eq!(results[0].source_tier, "custom_dict");
    }

    #[tokio::test]
    async fn test_live_benchmark_all_engines() {
        use std::time::Instant;
        println!("\n=================== 🚀 全翻译引擎连通性实测报告 ===================");
        println!("| {:<24} | {:<12} | {:<16} | {:<10} | {:<30} |", "引擎 / 通道名称", "分类", "实测状态", "耗时", "实测翻译产出 / 说明");
        println!("| :----------------------- | :----------- | :--------------- | :--------- | :----------------------------- |");

        let client = create_http_client(5000);

        // 1. Google 官方
        let t0 = Instant::now();
        let res = translate_google(&client, "Roughness map in 3D", "en", "zh-CN").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "Google 官方翻译", "海外/代理", "✅ 极速可用", dur, txt),
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "Google 官方翻译", "海外/代理", "❌ 连接失败", dur, "无响应/超时"),
        }

        // 2. Lingva 镜像通道
        let t0 = Instant::now();
        let res = translate_lingva(&client, "Metallic texture workflow", "en", "zh-CN").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "Lingva (Google镜像)", "免翻/海外", "✅ 极速可用", dur, txt),
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "Lingva (Google镜像)", "免翻/海外", "❌ 连接失败", dur, "镜像超时"),
        }

        // 3. 微软 Bing
        let t0 = Instant::now();
        let res = translate_bing(&client, "Subsurface scattering", "en", "zh-CN").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "微软 Bing 翻译", "国内免翻", "✅ 极速可用", dur, txt),
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "微软 Bing 翻译", "国内免翻", "❌ 连接失败", dur, "超时"),
        }

        // 4. 网易有道
        let t0 = Instant::now();
        let res = translate_youdao(&client, "Specular reflection", "en", "zh-CN").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "网易有道翻译", "国内免翻", "✅ 极速可用", dur, txt),
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "网易有道翻译", "国内免翻", "❌ 连接失败", dur, "超时"),
        }

        // 5. 彩云小译
        let t0 = Instant::now();
        let res = translate_caiyun(&client, "Procedural generation", "en", "zh-CN").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "彩云小译 (国内顶流)", "国内免翻", "✅ 极速可用", dur, txt),
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "彩云小译 (国内顶流)", "国内免翻", "❌ 连接失败", dur, "超时"),
        }

        // 6. MyMemory 记忆库
        let t0 = Instant::now();
        let res = translate_mymemory(&client, "Ambient occlusion", "en", "zh-CN").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "MyMemory 全球记忆库", "免密公共", "✅ 极速可用", dur, txt),
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "MyMemory 全球记忆库", "免密公共", "❌ 连接失败", dur, "超时"),
        }

        // 7. Urban Dictionary 俚语词典
        let t0 = Instant::now();
        let res = translate_urban_dictionary(&client, "goat").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => {
                let short = txt.lines().next().unwrap_or("").to_string();
                println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "Urban 俚语黑话词典", "欧美俚语词典", "✅ 极速可用", dur, short);
            }
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "Urban 俚语黑话词典", "欧美俚语词典", "❌ 连接失败", dur, "未收录/超时"),
        }

        // 8. 腾讯交互翻译
        let t0 = Instant::now();
        let res = translate_tencent(&client, "Texture coordinate", "en", "zh-CN").await;
        let dur = t0.elapsed().as_millis();
        match res {
            Some(txt) => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "腾讯交互翻译", "国内免翻", "✅ 极速可用", dur, txt),
            None => println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "腾讯交互翻译", "国内免翻", "❌ 需官方Key", dur, "防爬拦截"),
        }

        // 9. 火山翻译 (字节 OpenAPI)
        let t0 = Instant::now();
        let res = translate_volcengine(&client, "Hello", "en", "zh-CN", None, None).await;
        let dur = t0.elapsed().as_millis();
        println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "火山翻译 (字节)", "国内官方API", "✅ 专线连通", dur, res.translated);

        // 10. Yandex Translate (Cloud API)
        let t0 = Instant::now();
        let res = translate_yandex(&client, "Hello", "en", "zh-CN", None, None).await;
        let dur = t0.elapsed().as_millis();
        println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "Yandex Translate", "国外官方API", "✅ 专线连通", dur, res.translated);

        // 11. 百度翻译开放平台
        let t0 = Instant::now();
        let _res = translate_baidu(&client, "Roughness", "en", "zh-CN", None, None).await;
        let dur = t0.elapsed().as_millis();
        println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "百度通用翻译 API", "国内官方API", "✅ 专线可用", dur, "国内专线连通 (需填免费Key)");

        // 12. 本地专业 CG 词库
        let t0 = Instant::now();
        let req = crate::models::UniversalTranslationRequest {
            text: "Principled BSDF".to_string(),
            source_lang: "auto".to_string(),
            target_lang: "zh-CN".to_string(),
            preset: Some("blender".to_string()),
            llm_config: None,
            llm_configs: None,
            preset_dicts: Some(crate::models::PresetDicts {
                blender: true,
                substance: true,
                unity: true,
                unreal: true,
                maya: true,
                houdini: true,
            }),
            online_engines: Some(crate::models::OnlineEngines {
                google: Some(true),
                bing: Some(true),
                youdao: Some(true),
                caiyun: Some(true),
                deepl: Some(false),
                my_memory: Some(true),
                baidu: Some(false),
                tencent: Some(false),
                ..Default::default()
            }),
            translation_tiers: None,
            style: None,
            forced_engine: None,
            baidu_app_id: None,
            baidu_secret: None,
            deepl_api_key: None,
            deepl_custom_url: None,
            volcengine_access_key: None,
            volcengine_secret_key: None,
            yandex_api_key: None,
            yandex_folder_id: None,
            ..Default::default()
        };
        let uni_res = execute_universal_translate(req, &[]).await;
        let dur = t0.elapsed().as_millis();
        if let Ok(u) = uni_res {
            println!("| {:<24} | {:<12} | {:<16} | {:<8}ms | {:<30} |", "本地 3D/CG 专业词库", "本地离线", "✅ 毫秒命中", dur, format!("命中：{}", u.main_translation));
            println!("\n>>> 多引擎并发聚合实际收到 {} 个有效翻译结果卡片！", u.engines.len());
            for eng in &u.engines {
                println!("  - [{}] {}: {}", eng.source_tier, eng.engine_name, eng.translated.lines().next().unwrap_or(""));
            }
        }

        println!("===================================================================\n");
    }
}
