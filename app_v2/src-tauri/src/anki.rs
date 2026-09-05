use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnkiCheckResult {
    pub connected: bool,
    pub version: u32,
    pub decks: Vec<String>,
    pub models: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnkiNotePayload {
    pub original: String,
    pub translated: String,
    #[serde(default)]
    pub phonetic: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnkiSyncResult {
    pub total: usize,
    pub added: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
struct AnkiConnectRequest<T> {
    action: String,
    version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<T>,
}

#[derive(Debug, Deserialize)]
struct AnkiConnectResponse<T> {
    result: Option<T>,
    error: Option<String>,
}

pub fn default_anki_endpoint() -> String {
    "http://127.0.0.1:8765".to_string()
}

/// 发送请求到本地 AnkiConnect
async fn invoke_anki<P: Serialize, R: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    endpoint: &str,
    action: &str,
    params: Option<P>,
) -> Result<R, String> {
    let req = AnkiConnectRequest {
        action: action.to_string(),
        version: 6,
        params,
    };

    let res = client
        .post(endpoint)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("无法连接到本地 AnkiConnect ({endpoint}): {e}。请确保 Anki 正在运行且已安装 AnkiConnect 插件 (代码: 2055492159)"))?;

    let resp_text = res
        .text()
        .await
        .map_err(|e| format!("读取 AnkiConnect 响应失败: {e}"))?;

    let parsed: AnkiConnectResponse<R> = serde_json::from_str(&resp_text)
        .map_err(|e| format!("解析 AnkiConnect 响应 JSON 失败: {e}, 响应文本: {resp_text}"))?;

    if let Some(err) = parsed.error {
        return Err(format!("AnkiConnect 错误: {err}"));
    }

    parsed
        .result
        .ok_or_else(|| "AnkiConnect 未返回有效数据".to_string())
}

/// 检查本地 AnkiConnect 连接状态并获取现有牌组与模板列表
pub async fn check_anki_status(endpoint: &str) -> AnkiCheckResult {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()
        .unwrap_or_default();

    // 1. 获取版本
    let ver_res: Result<u32, _> = invoke_anki::<(), u32>(&client, endpoint, "version", None).await;
    let version = match ver_res {
        Ok(v) => v,
        Err(err) => {
            return AnkiCheckResult {
                connected: false,
                version: 0,
                decks: vec![],
                models: vec![],
                message: err,
            };
        }
    };

    // 2. 获取牌组列表
    let decks = invoke_anki::<(), Vec<String>>(&client, endpoint, "deckNames", None)
        .await
        .unwrap_or_default();

    // 3. 获取模板列表
    let models = invoke_anki::<(), Vec<String>>(&client, endpoint, "modelNames", None)
        .await
        .unwrap_or_default();

    let deck_count = decks.len();
    AnkiCheckResult {
        connected: true,
        version,
        decks,
        models,
        message: format!("已成功连接到 AnkiConnect v{version}，检测到 {deck_count} 个牌组"),
    }
}

/// 确保指定的牌组存在，如果不存在则自动创建
pub async fn ensure_deck_exists(client: &reqwest::Client, endpoint: &str, deck_name: &str) -> Result<(), String> {
    #[derive(Serialize)]
    struct CreateDeckParams<'a> {
        deck: &'a str,
    }

    let _: serde_json::Value = invoke_anki(
        client,
        endpoint,
        "createDeck",
        Some(CreateDeckParams { deck: deck_name }),
    )
    .await?;

    Ok(())
}

/// 批量同步生词到 Anki 牌组
pub async fn sync_notes_to_anki(
    endpoint: &str,
    deck_name: &str,
    notes: &[AnkiNotePayload],
) -> Result<AnkiSyncResult, String> {
    if notes.is_empty() {
        return Ok(AnkiSyncResult {
            total: 0,
            added: 0,
            skipped: 0,
            errors: vec![],
        });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    // 确保牌组存在
    let target_deck = if deck_name.trim().is_empty() { "Catwalk" } else { deck_name.trim() };
    ensure_deck_exists(&client, endpoint, target_deck).await?;

    // 获取当前牌组已有卡片，避免重复添加相同的单词
    #[derive(Serialize)]
    struct FindNotesParams {
        query: String,
    }

    let existing_notes: Vec<u64> = invoke_anki(
        &client,
        endpoint,
        "findNotes",
        Some(FindNotesParams {
            query: format!("\"deck:{target_deck}\""),
        }),
    )
    .await
    .unwrap_or_default();

    // 获取已有笔记的详细信息，提取已经存在的正面词汇
    let mut existing_front_set = std::collections::HashSet::new();
    if !existing_notes.is_empty() {
        #[derive(Serialize)]
        struct NotesInfoParams {
            notes: Vec<u64>,
        }

        #[derive(Deserialize)]
        struct NoteFieldContent {
            value: String,
        }

        #[derive(Deserialize)]
        struct NoteInfoItem {
            fields: std::collections::HashMap<String, NoteFieldContent>,
        }

        if let Ok(info_list) = invoke_anki::<NotesInfoParams, Vec<NoteInfoItem>>(
            &client,
            endpoint,
            "notesInfo",
            Some(NotesInfoParams {
                notes: existing_notes.iter().take(2000).copied().collect(),
            }),
        )
        .await
        {
            for item in info_list {
                for (k, v) in item.fields {
                    let k_lower = k.to_lowercase();
                    if k_lower == "front" || k_lower == "正面" || k_lower == "word" || k_lower == "单词" {
                        let clean = v.value.replace("<br>", "").replace("<br/>", "").trim().to_lowercase();
                        existing_front_set.insert(clean);
                    }
                }
            }
        }
    }

    #[derive(Serialize)]
    struct NoteFields {
        #[serde(rename = "Front")]
        front: String,
        #[serde(rename = "Back")]
        back: String,
    }

    #[derive(Serialize)]
    struct SingleNoteParam<'a> {
        #[serde(rename = "deckName")]
        deck_name: &'a str,
        #[serde(rename = "modelName")]
        model_name: &'a str,
        fields: NoteFields,
        options: SingleNoteOptions,
        tags: Vec<String>,
    }

    #[derive(Serialize)]
    struct SingleNoteOptions {
        #[serde(rename = "allowDuplicate")]
        allow_duplicate: bool,
    }

    #[derive(Serialize)]
    struct AddNotesParams<'a> {
        notes: Vec<SingleNoteParam<'a>>,
    }

    let mut notes_to_add = Vec::new();
    let mut skipped = 0;

    for item in notes {
        let orig_clean = item.original.trim();
        if orig_clean.is_empty() {
            skipped += 1;
            continue;
        }

        if existing_front_set.contains(&orig_clean.to_lowercase()) {
            skipped += 1;
            continue;
        }

        // 构建正面：英文、音标、分类角标
        let mut front_html = format!(
            "<div style='font-size: 24px; font-weight: bold; color: #3b82f6;'>{}</div>",
            html_escape(orig_clean)
        );
        if let Some(ph) = &item.phonetic {
            if !ph.trim().is_empty() {
                front_html.push_str(&format!(
                    "<div style='font-size: 14px; color: #8b5cf6; margin-top: 4px;'>{}</div>",
                    html_escape(ph.trim())
                ));
            }
        }
        if let Some(cat) = &item.category {
            if !cat.trim().is_empty() {
                front_html.push_str(&format!(
                    "<span style='display: inline-block; font-size: 11px; padding: 2px 6px; background: #e0e7ff; color: #4338ca; border-radius: 4px; margin-top: 6px;'>{}</span>",
                    html_escape(cat.trim())
                ));
            }
        }

        // 构建反面：中文释义、上下文例句
        let mut back_html = format!(
            "<div style='font-size: 20px; font-weight: 600; color: #10b981; margin-bottom: 8px;'>{}</div>",
            html_escape(item.translated.trim())
        );
        if let Some(ctx) = &item.context {
            if !ctx.trim().is_empty() {
                back_html.push_str(&format!(
                    "<div style='font-size: 13px; color: #64748b; background: #f8fafc; border-left: 3px solid #3b82f6; padding: 6px 10px; margin-top: 8px; border-radius: 0 4px 4px 0;'>{}</div>",
                    html_escape(ctx.trim())
                ));
            }
        }

        let mut tags = item.tags.clone().unwrap_or_default();
        if !tags.contains(&"Catwalk".to_string()) {
            tags.push("Catwalk".to_string());
        }
        if let Some(cat) = &item.category {
            let cat_tag = format!("Catwalk::{}", cat.trim().replace(' ', "_"));
            if !tags.contains(&cat_tag) {
                tags.push(cat_tag);
            }
        }

        notes_to_add.push(SingleNoteParam {
            deck_name: target_deck,
            model_name: "Basic",
            fields: NoteFields {
                front: front_html,
                back: back_html,
            },
            options: SingleNoteOptions {
                allow_duplicate: false,
            },
            tags,
        });
    }

    if notes_to_add.is_empty() {
        return Ok(AnkiSyncResult {
            total: notes.len(),
            added: 0,
            skipped,
            errors: vec![],
        });
    }

    // 批量执行 addNotes
    let results: Vec<Option<u64>> = invoke_anki(
        &client,
        endpoint,
        "addNotes",
        Some(AddNotesParams { notes: notes_to_add }),
    )
    .await?;

    let added_count = results.iter().filter(|r| r.is_some()).count();
    let failed_count = results.len() - added_count;

    Ok(AnkiSyncResult {
        total: notes.len(),
        added: added_count,
        skipped: skipped + failed_count,
        errors: vec![],
    })
}

/// 将生词列表格式化为通用 Anki 标准导入文本（TSV 格式，含 HTML 样式）
pub fn format_anki_tsv_export(notes: &[AnkiNotePayload]) -> String {
    let mut out = String::new();
    out.push_str("#separator:tab\n");
    out.push_str("#html:true\n");
    out.push_str("#tags column:3\n");

    for note in notes {
        let orig = note.original.trim();
        let trans = note.translated.trim();
        if orig.is_empty() || trans.is_empty() {
            continue;
        }

        // 1. 正面
        let mut front = format!(
            "<b><span style=\"font-size:22px;color:#2563eb;\">{}</span></b>",
            html_escape(orig)
        );
        if let Some(ph) = &note.phonetic {
            if !ph.trim().is_empty() {
                front.push_str(&format!(
                    "<br><span style=\"font-size:13px;color:#7c3aed;\">{}</span>",
                    html_escape(ph.trim())
                ));
            }
        }
        if let Some(cat) = &note.category {
            if !cat.trim().is_empty() {
                front.push_str(&format!(
                    "<br><span style=\"font-size:11px;background:#e0e7ff;color:#3730a3;padding:1px 4px;border-radius:3px;\">{}</span>",
                    html_escape(cat.trim())
                ));
            }
        }

        // 2. 反面
        let mut back = format!(
            "<b><span style=\"font-size:18px;color:#059669;\">{}</span></b>",
            html_escape(trans)
        );
        if let Some(ctx) = &note.context {
            if !ctx.trim().is_empty() {
                back.push_str(&format!(
                    "<div style=\"font-size:12px;color:#475569;background:#f1f5f9;border-left:2px solid #3b82f6;padding:4px 8px;margin-top:6px;\">{}</div>",
                    html_escape(ctx.trim())
                ));
            }
        }

        // 3. 标签
        let mut tags = note.tags.clone().unwrap_or_default();
        if !tags.contains(&"Catwalk".to_string()) {
            tags.push("Catwalk".to_string());
        }
        if let Some(cat) = &note.category {
            tags.push(format!("Catwalk::{}", cat.trim().replace(' ', "_")));
        }
        let tag_str = tags.join(" ");

        // 单行 TSV：Front \t Back \t Tags
        let front_flat = front.replace('\t', " ").replace('\n', "");
        let back_flat = back.replace('\t', " ").replace('\n', "");
        out.push_str(&format!("{front_flat}\t{back_flat}\t{tag_str}\n"));
    }

    out
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_anki_tsv_export() {
        let notes = vec![
            AnkiNotePayload {
                original: "Subsurface Scattering".to_string(),
                translated: "次表面散射".to_string(),
                phonetic: Some("/sʌbˈsɜːfɪs/".to_string()),
                context: Some("Used in Blender skin shading".to_string()),
                category: Some("Blender".to_string()),
                tags: Some(vec!["3D".to_string()]),
            },
            AnkiNotePayload {
                original: "Normal Map".to_string(),
                translated: "法线贴图".to_string(),
                phonetic: None,
                context: None,
                category: Some("CG".to_string()),
                tags: None,
            },
        ];

        let tsv = format_anki_tsv_export(&notes);
        assert!(tsv.contains("#separator:tab"));
        assert!(tsv.contains("Subsurface Scattering"));
        assert!(tsv.contains("次表面散射"));
        assert!(tsv.contains("Catwalk"));
        assert!(tsv.contains("Catwalk::Blender"));
        assert_eq!(tsv.lines().count(), 5); // 3 header lines + 2 note lines
    }

    #[test]
    fn test_empty_notes_tsv_export() {
        let tsv = format_anki_tsv_export(&[]);
        assert_eq!(tsv.lines().count(), 3);
    }
}
