use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// 用户自定义专业术语词条
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserGlossaryEntry {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default = "default_timestamp")]
    pub created_at: u64,
}

fn default_category() -> String {
    "通用".to_string()
}

fn default_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 术语导入统计摘要
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryImportSummary {
    pub total_parsed: usize,
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub total_after: usize,
}

/// 全局常驻自定义术语库缓存
pub struct GlossaryStore {
    file_path: PathBuf,
    entries: RwLock<Vec<UserGlossaryEntry>>,
}

impl GlossaryStore {
    pub fn new(config_dir: &Path) -> Self {
        let file_path = config_dir.join("custom_glossary.json");
        let initial_entries = if file_path.exists() {
            fs::read_to_string(&file_path)
                .ok()
                .and_then(|json| serde_json::from_str::<Vec<UserGlossaryEntry>>(&json).ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        Self {
            file_path,
            entries: RwLock::new(initial_entries),
        }
    }

    /// 获取所有自定义术语列表
    pub fn get_all(&self) -> Vec<UserGlossaryEntry> {
        self.entries.read().unwrap().clone()
    }

    /// 转换为翻译管线使用的 (source, target) 对
    pub fn get_pairs(&self) -> Vec<(String, String)> {
        self.entries
            .read()
            .unwrap()
            .iter()
            .filter(|e| !e.source.trim().is_empty() && !e.target.trim().is_empty())
            .map(|e| (e.source.trim().to_string(), e.target.trim().to_string()))
            .collect()
    }

    /// 持久化写盘
    fn save_to_disk(&self, list: &[UserGlossaryEntry]) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(list)
            .map_err(|e| format!("序列化术语库 JSON 失败: {e}"))?;
        fs::write(&self.file_path, json)
            .map_err(|e| format!("写入术语库文件失败 ({:?}): {e}", self.file_path))?;
        Ok(())
    }

    /// 导入术语（支持 merge 合并增量 或 replace 全量覆盖）
    pub fn import_entries(&self, new_entries: Vec<UserGlossaryEntry>, mode: &str) -> Result<GlossaryImportSummary, String> {
        let mut guard = self.entries.write().unwrap();
        let total_parsed = new_entries.len();
        let mut added = 0;
        let mut updated = 0;
        let mut skipped = 0;

        if mode == "replace" {
            let mut deduplicated: Vec<UserGlossaryEntry> = Vec::new();
            let mut seen = HashMap::new();
            for item in new_entries {
                let s_clean = item.source.trim().to_lowercase();
                if s_clean.is_empty() || item.target.trim().is_empty() {
                    skipped += 1;
                    continue;
                }
                if seen.contains_key(&s_clean) {
                    skipped += 1;
                    continue;
                }
                seen.insert(s_clean, true);
                deduplicated.push(item);
                added += 1;
            }
            *guard = deduplicated;
        } else {
            // merge 模式
            for item in new_entries {
                let s_clean = item.source.trim().to_lowercase();
                if s_clean.is_empty() || item.target.trim().is_empty() {
                    skipped += 1;
                    continue;
                }

                if let Some(existing) = guard.iter_mut().find(|e| e.source.trim().to_lowercase() == s_clean) {
                    if existing.target != item.target || existing.category != item.category || existing.note != item.note {
                        existing.target = item.target;
                        if !item.category.trim().is_empty() {
                            existing.category = item.category;
                        }
                        if item.note.is_some() {
                            existing.note = item.note;
                        }
                        updated += 1;
                    } else {
                        skipped += 1;
                    }
                } else {
                    guard.push(item);
                    added += 1;
                }
            }
        }

        self.save_to_disk(&guard)?;

        Ok(GlossaryImportSummary {
            total_parsed,
            added,
            updated,
            skipped,
            total_after: guard.len(),
        })
    }

    /// 单条添加或更新
    pub fn upsert_entry(&self, entry: UserGlossaryEntry) -> Result<(), String> {
        let mut guard = self.entries.write().unwrap();
        let s_lower = entry.source.trim().to_lowercase();
        if let Some(existing) = guard.iter_mut().find(|e| e.source.trim().to_lowercase() == s_lower) {
            *existing = entry;
        } else {
            guard.push(entry);
        }
        self.save_to_disk(&guard)
    }

    /// 删除单条
    pub fn delete_entry(&self, id: &str) -> Result<bool, String> {
        let mut guard = self.entries.write().unwrap();
        let init_len = guard.len();
        guard.retain(|e| e.id != id);
        let removed = guard.len() < init_len;
        if removed {
            self.save_to_disk(&guard)?;
        }
        Ok(removed)
    }

    /// 清空全部
    pub fn clear_all(&self) -> Result<(), String> {
        let mut guard = self.entries.write().unwrap();
        guard.clear();
        self.save_to_disk(&guard)
    }
}

/// 解析 CSV 或 TSV 文本为术语词条列表
pub fn parse_csv_or_tsv(content: &str) -> Vec<UserGlossaryEntry> {
    let mut entries = Vec::new();
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return entries;
    }

    // 自动判断分隔符是逗号还是制表符
    let first_line = trimmed.lines().next().unwrap_or("");
    let delimiter = if first_line.contains('\t') { b'\t' } else { b',' };

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(delimiter)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(content.as_bytes());

    let mut records = rdr.records();
    let first_record = match records.next() {
        Some(Ok(r)) => r,
        _ => return entries,
    };

    // 智能检测表头
    let mut col_source = 0;
    let mut col_target = 1;
    let mut col_category = 2;
    let mut col_note = 3;
    let col0 = first_record.get(0).unwrap_or("").to_lowercase();
    let col1 = first_record.get(1).unwrap_or("").to_lowercase();

    if col0.contains("原词") || col0.contains("原文") || col0.contains("source") || col0.contains("english") || col0.contains("en") || col0.contains("term")
        || col1.contains("译文") || col1.contains("翻译") || col1.contains("target") || col1.contains("chinese") || col1.contains("zh")
    {
        for (i, field) in first_record.iter().enumerate() {
            let f = field.to_lowercase();
            if f.contains("原词") || f.contains("原文") || f.contains("source") || f.contains("english") || f.contains("term") {
                col_source = i;
            } else if f.contains("译文") || f.contains("翻译") || f.contains("target") || f.contains("chinese") || f.contains("trans") {
                col_target = i;
            } else if f.contains("分类") || f.contains("类别") || f.contains("category") || f.contains("tag") {
                col_category = i;
            } else if f.contains("备注") || f.contains("说明") || f.contains("note") || f.contains("comment") {
                col_note = i;
            }
        }
    } else {
        // 第一行不是表头，直接作为普通数据行
        let src = first_record.get(col_source).unwrap_or("").trim();
        let tgt = first_record.get(col_target).unwrap_or("").trim();
        if !src.is_empty() && !tgt.is_empty() {
            entries.push(UserGlossaryEntry {
                id: format!("term-{}", entries.len() + 1),
                source: src.to_string(),
                target: tgt.to_string(),
                category: first_record.get(col_category).unwrap_or("通用").trim().to_string(),
                note: first_record.get(col_note).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                created_at: default_timestamp(),
            });
        }
    }

    // 解析后续数据行
    for record in records.flatten() {
        let src = record.get(col_source).unwrap_or("").trim();
        let tgt = record.get(col_target).unwrap_or("").trim();
        if src.is_empty() || tgt.is_empty() {
            continue;
        }

        let cat = record.get(col_category).map(|s| s.trim()).unwrap_or("");
        let final_cat = if cat.is_empty() { "通用" } else { cat };

        let note = record.get(col_note).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        entries.push(UserGlossaryEntry {
            id: format!("term-{}", entries.len() + 1),
            source: src.to_string(),
            target: tgt.to_string(),
            category: final_cat.to_string(),
            note,
            created_at: default_timestamp(),
        });
    }

    entries
}

/// 解析 TXT 自由文本格式（每行: 原词 = 译文, 原词 -> 译文, 或 制表符分割）
pub fn parse_txt_glossary(content: &str) -> Vec<UserGlossaryEntry> {
    let mut entries = Vec::new();
    let separators = ["==", "=", "➔", "->", "=>", ":", "：", "\t"];

    for (idx, line) in content.lines().enumerate() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') || l.starts_with("//") {
            continue;
        }

        let mut matched_sep = None;
        for &sep in &separators {
            if l.contains(sep) {
                matched_sep = Some(sep);
                break;
            }
        }

        if let Some(sep) = matched_sep {
            let parts: Vec<&str> = l.splitn(2, sep).collect();
            if parts.len() == 2 {
                let src = parts[0].trim();
                let tgt = parts[1].trim();
                if !src.is_empty() && !tgt.is_empty() {
                    entries.push(UserGlossaryEntry {
                        id: format!("term-{}", idx + 1),
                        source: src.to_string(),
                        target: tgt.to_string(),
                        category: "通用".to_string(),
                        note: None,
                        created_at: default_timestamp(),
                    });
                }
            }
        }
    }

    entries
}

/// 生成标准导出 CSV 文本
pub fn export_to_csv(entries: &[UserGlossaryEntry]) -> String {
    let mut wtr = csv::WriterBuilder::new().from_writer(vec![]);
    let _ = wtr.write_record(["原词", "译文", "分类", "备注"]);
    for e in entries {
        let _ = wtr.write_record([
            &e.source,
            &e.target,
            &e.category,
            e.note.as_deref().unwrap_or(""),
        ]);
    }
    String::from_utf8(wtr.into_inner().unwrap_or_default()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_csv_with_headers() {
        let csv_data = "原词,译文,分类,备注\nSubsurface Scattering,次表面散射,3D/CG,材质参数\nRoughness,粗糙度,PBR,\n";
        let items = parse_csv_or_tsv(csv_data);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].source, "Subsurface Scattering");
        assert_eq!(items[0].target, "次表面散射");
        assert_eq!(items[0].category, "3D/CG");
        assert_eq!(items[0].note.as_deref(), Some("材质参数"));
        assert_eq!(items[1].source, "Roughness");
        assert_eq!(items[1].target, "粗糙度");
        assert_eq!(items[1].note, None);
    }

    #[test]
    fn test_parse_tsv_without_headers() {
        let tsv_data = "Normal Map\t法线贴图\t贴图\nAmbient Occlusion\t环境光遮蔽\n";
        let items = parse_csv_or_tsv(tsv_data);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].source, "Normal Map");
        assert_eq!(items[0].target, "法线贴图");
        assert_eq!(items[0].category, "贴图");
        assert_eq!(items[1].source, "Ambient Occlusion");
        assert_eq!(items[1].target, "环境光遮蔽");
        assert_eq!(items[1].category, "通用");
    }

    #[test]
    fn test_parse_txt_glossary() {
        let txt_data = "# 游戏术语表\nHP = 生命值\nMP = 魔法值\nCritical Strike -> 暴击\n// 忽略注释\nCooldown : 冷却时间\n";
        let items = parse_txt_glossary(txt_data);
        assert_eq!(items.len(), 4);
        assert_eq!(items[0].source, "HP");
        assert_eq!(items[0].target, "生命值");
        assert_eq!(items[2].source, "Critical Strike");
        assert_eq!(items[2].target, "暴击");
        assert_eq!(items[3].source, "Cooldown");
        assert_eq!(items[3].target, "冷却时间");
    }

    #[test]
    fn test_store_merge_and_replace() {
        let tmp_dir = std::env::temp_dir().join("catwalk_glossary_test");
        let store = GlossaryStore::new(&tmp_dir);
        let _ = store.clear_all();

        let entries = vec![
            UserGlossaryEntry {
                id: "1".into(),
                source: "Albedo".into(),
                target: "反照率".into(),
                category: "CG".into(),
                note: None,
                created_at: 0,
            },
            UserGlossaryEntry {
                id: "2".into(),
                source: "Metallic".into(),
                target: "金属度".into(),
                category: "CG".into(),
                note: None,
                created_at: 0,
            },
        ];

        let res = store.import_entries(entries, "merge").unwrap();
        assert_eq!(res.added, 2);
        assert_eq!(store.get_all().len(), 2);

        // 重复导入
        let duplicate = vec![UserGlossaryEntry {
            id: "3".into(),
            source: "Albedo".into(),
            target: "反照率 (基础色)".into(),
            category: "CG".into(),
            note: None,
            created_at: 0,
        }];
        let res2 = store.import_entries(duplicate, "merge").unwrap();
        assert_eq!(res2.updated, 1);
        assert_eq!(store.get_all().len(), 2);
        assert_eq!(store.get_all()[0].target, "反照率 (基础色)");

        let _ = store.clear_all();
    }
}
