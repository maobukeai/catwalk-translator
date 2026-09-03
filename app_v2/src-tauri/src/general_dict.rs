//! 通用离线英汉词典（ECDICT，MIT License）：
//! 一次性下载完整 ecdict.csv（~63MB）→ 流式解析并筛选高频词条 →
//! 压缩成本地精简缓存（仅 word/phonetic/translation）→ 删除原始文件。
//! 日常查词只加载精简缓存（数 MB、十几万词条），内存与启动零负担。
//!
//! 数据源: https://github.com/skywind3000/ECDICT
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use tauri::ipc::Channel;

const ECDICT_URLS: &[&str] = &[
    "https://fastly.jsdelivr.net/gh/skywind3000/ECDICT@master/ecdict.csv",
    "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
    "https://cdn.jsdelivr.net/gh/skywind3000/ECDICT@master/ecdict.csv",
    "https://ghproxy.net/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
];
const MAX_KEEP_ENTRIES: usize = 200_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GeneralDictStatus {
    pub installed: bool,
    pub entries: usize,
    pub installed_at: String,
}

/// 精简缓存条目（磁盘格式，字段名缩到最短）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CompactEntry {
    w: String,
    p: String,
    /// 多条释义用 '\n' 连接
    t: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DictProgress {
    pub downloaded: u64,
    pub total: u64,
    pub phase: String, // download | parse | done | error
    pub detail: String,
}

/// 词条查询结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralDictHit {
    pub word: String,
    pub phonetic: String,
    pub definitions: Vec<String>,
}

fn cache_path(app: &tauri::AppHandle) -> PathBuf {
    crate::commands::get_app_config_dir(app).join("general_dict_cache.json")
}
fn meta_path(app: &tauri::AppHandle) -> PathBuf {
    crate::commands::get_app_config_dir(app).join("general_dict_meta.json")
}

type DictMap = HashMap<String, (String, Vec<String>)>;

/// 内存词典：None = 未安装或未加载；首次查询时惰性加载
static DICT: OnceLock<RwLock<Option<DictMap>>> = OnceLock::new();

fn dict_cell() -> &'static RwLock<Option<DictMap>> {
    DICT.get_or_init(|| RwLock::new(None))
}

fn ensure_loaded(app: &tauri::AppHandle) {
    // 双检：已加载直接返回
    if dict_cell().read().map(|c| c.is_some()).unwrap_or(false) {
        return;
    }
    let path = cache_path(app);
    if !path.exists() {
        return;
    }
    let Ok(content) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(entries) = serde_json::from_str::<Vec<CompactEntry>>(&content) else {
        return;
    };
    let mut map = HashMap::with_capacity(entries.len());
    for e in entries {
        map.insert(
            e.w,
            (
                e.p,
                e.t.split('\n').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            ),
        );
    }
    if let Ok(mut cell) = dict_cell().write() {
        *cell = Some(map);
    }
}

/// 词典查询（大小写不敏感；未安装/未命中返回 None）
pub fn lookup(app: &tauri::AppHandle, word: &str) -> Option<GeneralDictHit> {
    let w = word.trim();
    if w.is_empty() || w.split_whitespace().count() > 3 {
        return None;
    }
    ensure_loaded(app);
    let cell = dict_cell().read().ok()?;
    let map = cell.as_ref()?;
    let key = w.to_lowercase();
    map.get(&key)
        .or_else(|| map.get(w))
        .map(|(phonetic, defs)| GeneralDictHit {
            word: w.to_string(),
            phonetic: phonetic.clone(),
            definitions: defs.clone(),
        })
}

#[tauri::command]
pub async fn cmd_general_dict_lookup(
    app: tauri::AppHandle,
    word: String,
) -> Result<Option<GeneralDictHit>, String> {
    Ok(lookup(&app, &word))
}

#[tauri::command]
pub async fn cmd_general_dict_status(app: tauri::AppHandle) -> Result<GeneralDictStatus, String> {
    let meta = std::fs::read_to_string(meta_path(&app))
        .ok()
        .and_then(|s| serde_json::from_str::<GeneralDictStatus>(&s).ok());
    Ok(meta.filter(|_| cache_path(&app).exists()).unwrap_or_default())
}

#[tauri::command]
pub async fn cmd_general_dict_uninstall(app: tauri::AppHandle) -> Result<(), String> {
    let _ = std::fs::remove_file(cache_path(&app));
    let _ = std::fs::remove_file(meta_path(&app));
    if let Ok(mut cell) = dict_cell().write() {
        *cell = None;
    }
    Ok(())
}

/// 是否保留该词条：有中文释义 + 有词频/词典星级 + ASCII 英文 + 长度合理
fn should_keep(rec: &csv::StringRecord) -> bool {
    let word = rec.get(0).unwrap_or_default();
    let translation = rec.get(3).unwrap_or_default();
    if word.is_empty() || translation.is_empty() {
        return false;
    }
    if word.len() > 32 || !word.is_ascii() || word.starts_with('-') || word.starts_with('\'') {
        return false;
    }
    let frq: u64 = rec.get(9).unwrap_or_default().parse().unwrap_or(0);
    let bnc: u64 = rec.get(8).unwrap_or_default().parse().unwrap_or(0);
    let collins: u32 = rec.get(5).unwrap_or_default().parse().unwrap_or(0);
    let oxford: u32 = rec.get(6).unwrap_or_default().parse().unwrap_or(0);
    frq > 0 || bnc > 0 || collins > 0 || oxford > 0
}

#[tauri::command]
pub async fn cmd_general_dict_install(
    app: tauri::AppHandle,
    on_progress: Channel<DictProgress>,
) -> Result<GeneralDictStatus, String> {
    use futures_util::StreamExt;

    let temp_csv = std::env::temp_dir().join(format!("ecdict_{}.csv", std::process::id()));

    // ── 阶段 1：流式下载完整 CSV（63MB，进度实时上报，支持国内镜像故障转移） ──
    let client = crate::translator::create_http_client(600_000);
    let mut last_err = String::new();
    let mut downloaded_ok = false;
    let mut final_total = 65_933_428u64;

    for &url in ECDICT_URLS {
        let resp = match client
            .get(url)
            .timeout(std::time::Duration::from_secs(600))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                last_err = format!("{} 返回 HTTP {}", url, r.status().as_u16());
                continue;
            }
            Err(e) => {
                last_err = format!("{} 请求失败: {}", url, e);
                continue;
            }
        };

        let total = resp.content_length().unwrap_or(65_933_428);
        final_total = total;
        let mut file = match std::fs::File::create(&temp_csv) {
            Ok(f) => f,
            Err(e) => return Err(format!("创建临时文件失败: {}", e)),
        };

        let mut stream = resp.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_report = 0u64;
        let mut stream_failed = false;

        while let Some(chunk_res) = stream.next().await {
            match chunk_res {
                Ok(chunk) => {
                    if let Err(e) = file.write_all(&chunk) {
                        last_err = format!("写入临时文件失败: {}", e);
                        stream_failed = true;
                        break;
                    }
                    downloaded += chunk.len() as u64;
                    if downloaded - last_report >= 2 * 1024 * 1024 || downloaded >= total {
                        last_report = downloaded;
                        let _ = on_progress.send(DictProgress {
                            downloaded,
                            total,
                            phase: "download".into(),
                            detail: format!(
                                "{:.1} / {:.1} MB",
                                downloaded as f64 / 1048576.0,
                                total as f64 / 1048576.0
                            ),
                        });
                    }
                }
                Err(e) => {
                    last_err = format!("{} 流中断: {}", url, e);
                    stream_failed = true;
                    break;
                }
            }
        }
        drop(file);

        if !stream_failed && downloaded > 1024 * 1024 {
            downloaded_ok = true;
            break;
        } else {
            let _ = std::fs::remove_file(&temp_csv);
        }
    }

    if !downloaded_ok {
        return Err(format!("所有词典镜像源下载均失败，最后错误: {}", last_err));
    }

    let _ = on_progress.send(DictProgress {
        downloaded: final_total,
        total: final_total,
        phase: "parse".into(),
        detail: "解析并筛选高频词条…".into(),
    });

    // ── 阶段 2：流式解析（阻塞任务中执行）→ 精简缓存 ───────────────────────
    let temp_path = temp_csv.clone();
    let cache_file = cache_path(&app);
    let result: Result<usize, String> =
        tauri::async_runtime::spawn_blocking(move || {
            let mut reader = csv::ReaderBuilder::new()
                .flexible(true)
                .from_path(&temp_path)
                .map_err(|e| format!("打开 CSV 失败: {}", e))?;
            let mut entries: Vec<CompactEntry> = Vec::with_capacity(160_000);
            for rec in reader.records() {
                let rec = match rec {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                if !should_keep(&rec) {
                    continue;
                }
                let word = rec.get(0).unwrap_or_default().to_string();
                let phonetic = rec.get(1).unwrap_or_default().to_string();
                let translation = rec.get(3).unwrap_or_default().replace("\\n", "\n");
                entries.push(CompactEntry {
                    w: word.to_lowercase(),
                    p: phonetic,
                    t: translation,
                });
                if entries.len() >= MAX_KEEP_ENTRIES {
                    break;
                }
            }
            let json = serde_json::to_string(&entries).map_err(|e| format!("序列化缓存失败: {}", e))?;
            std::fs::write(&cache_file, json).map_err(|e| format!("写入缓存失败: {}", e))?;
            Ok(entries.len())
        })
        .await
        .map_err(|e| format!("解析任务失败: {}", e))?
        ;

    let _ = std::fs::remove_file(&temp_csv);
    let count = result?;

    // 丢弃内存中可能存在的旧词典，下次查询重新加载新缓存
    if let Ok(mut cell) = dict_cell().write() {
        *cell = None;
    }

    let status = GeneralDictStatus {
        installed: true,
        entries: count,
        installed_at: chrono_like_now(),
    };
    let _ = std::fs::write(
        meta_path(&app),
        serde_json::to_string_pretty(&status).unwrap_or_default(),
    );

    let _ = on_progress.send(DictProgress {
        downloaded: final_total,
        total: final_total,
        phase: "done".into(),
        detail: format!("已收录 {} 条高频词条", count),
    });
    Ok(status)
}

/// 轻量时间戳（避免为格式化时间引入 chrono）
fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 简单 epoch → YYYY-MM-DD（本地时区偏移由前端展示时处理；此处仅记录近似日期）
    let days = secs / 86_400;
    let (y, m, d) = crate::backup::civil_from_days(days as i64);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(word: &str, phonetic: &str, translation: &str, frq: &str, oxford: &str) -> csv::StringRecord {
        let mut r = csv::StringRecord::new();
        r.push_field(word);
        r.push_field(phonetic);
        r.push_field(""); // definition
        r.push_field(translation);
        r.push_field(""); // pos
        r.push_field("0"); // collins
        r.push_field(oxford);
        r.push_field(""); // tag
        r.push_field("0"); // bnc
        r.push_field(frq);
        r
    }

    #[test]
    fn keeps_frequent_words_with_translation() {
        assert!(should_keep(&rec("hello", "həˈləʊ", "n. 你好", "3000", "0")));
        assert!(should_keep(&rec("world", "", "n. 世界", "0", "1")));
    }

    #[test]
    fn drops_rare_or_non_english_entries() {
        // 无词频且无星级
        assert!(!should_keep(&rec("zzzxxx", "", "n. 无", "0", "0")));
        // 无释义
        assert!(!should_keep(&rec("hello", "həˈləʊ", "", "3000", "0")));
        // 超长词条
        assert!(!should_keep(&rec(&"a".repeat(40), "", "n. 长", "3000", "0")));
        // 非ASCII
        assert!(!should_keep(&rec(" café", "", "n. 咖啡", "3000", "0")));
    }
}
