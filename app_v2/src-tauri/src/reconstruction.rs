use crate::ocr::{BoundingBox, TextBlock};

fn is_cjk_or_fullwidth(c: char) -> bool {
    matches!(c,
        // CJK Unified Ideographs & Extensions
        '\u{4E00}'..='\u{9FFF}'
        | '\u{3400}'..='\u{4DBF}'
        | '\u{20000}'..='\u{2CEAF}'
        | '\u{F900}'..='\u{FAFF}'
        // CJK Symbols and Punctuation (e.g. 、。 《》【】〔〕〖〗)
        | '\u{3000}'..='\u{303F}'
        // Fullwidth Forms & Halfwidth CJK punctuation (e.g. ，！：；？（）)
        | '\u{FF01}'..='\u{FF60}'
        | '\u{FFE0}'..='\u{FFEE}'
        // Common CJK Quotes and dashes
        | '\u{2018}'..='\u{201F}'
        | '\u{2014}' | '\u{2026}'
        // Japanese Hiragana, Katakana & Kana extensions
        | '\u{3040}'..='\u{309F}'
        | '\u{30A0}'..='\u{30FF}'
        | '\u{31F0}'..='\u{31FF}'
        // Korean Hangul
        | '\u{AC00}'..='\u{D7AF}'
        | '\u{1100}'..='\u{11FF}'
        | '\u{3130}'..='\u{318F}'
        // Bopomofo
        | '\u{3100}'..='\u{312F}'
    )
}

pub struct LineClusterer;

impl LineClusterer {
    /// Maximum horizontal gap for two blocks to sit on the same visual line,
    /// derived from the shorter block's height and clamped to sane absolutes:
    /// - floor 24px keeps split fragments of small UI text together;
    /// - cap 200px is what separates layout COLUMNS — a two-column page has a
    ///   ≥250px gutter, and without a cap a tall heading vertically spanning a
    ///   right-column row chained the whole foreign column into one line.
    ///
    /// 2.0× tolerates the wider breaks DBNet leaves in faint low-contrast text
    /// (a whole word can vanish between two fragment boxes) while buttons and
    /// stat labels (gaps ≥3× line height) still stay independent.
    fn max_line_gap(h_ref: f32) -> f32 {
        (h_ref * 2.0).clamp(24.0, 200.0)
    }

    /// Pixel gap between two boxes (0 when they already overlap horizontally).
    fn horizontal_gap(a: &BoundingBox, b: &BoundingBox) -> f32 {
        let a_right = a.x + a.width as i32;
        let b_right = b.x + b.width as i32;
        let gap = if a_right <= b.x {
            b.x - a_right
        } else if b_right <= a.x {
            a.x - b_right
        } else {
            0
        };
        gap as f32
    }

    /// Vertical alignment test for a candidate PAIR (not a union bbox): real
    /// overlap ≥40% of the shorter box, or centers within 0.6× of it. Using
    /// min_h keeps tall blocks from absorbing the neighbouring line.
    fn pair_same_row(a: &BoundingBox, b: &BoundingBox) -> bool {
        let h1 = (a.height as f32).max(1.0);
        let h2 = (b.height as f32).max(1.0);
        let overlap = (a.y + a.height as i32).min(b.y + b.height as i32) - a.y.max(b.y);
        let min_h = h1.min(h2).max(1.0);
        let center_diff = (a.y as f32 + h1 * 0.5 - (b.y as f32 + h2 * 0.5)).abs();
        (overlap > 0 && (overlap as f32 / min_h) >= 0.40) || center_diff <= min_h * 0.6
    }

    pub fn cluster_into_lines(mut blocks: Vec<TextBlock>, _threshold: f32) -> Vec<Vec<TextBlock>> {
        if blocks.is_empty() {
            return Vec::new();
        }

        // Sort blocks primarily by y coordinate, secondarily by x
        blocks.sort_by(|a, b| {
            a.box_rect
                .y
                .cmp(&b.box_rect.y)
                .then_with(|| a.box_rect.x.cmp(&b.box_rect.x))
        });

        let mut lines: Vec<Vec<TextBlock>> = Vec::new();

        for block in blocks {
            let mut added = false;
            for line in lines.iter_mut() {
                // Same line requires BOTH vertical alignment AND horizontal
                // proximity to some member. Pairwise member checks (instead of
                // the old line-union bbox) stop chain absorption: a union bbox
                // grows as blocks merge, letting each next right-column row
                // overlap its bottom edge and join — mixing two columns into
                // one "line". With pairwise + gap cap, every cross-column pair
                // fails the gap test, so the chain can never start.
                let matched = line.iter().any(|m| {
                    Self::pair_same_row(&m.box_rect, &block.box_rect)
                        && Self::horizontal_gap(&m.box_rect, &block.box_rect)
                            <= Self::max_line_gap(
                                m.box_rect.height.min(block.box_rect.height) as f32,
                            )
                });
                if matched {
                    line.push(block.clone());
                    added = true;
                    break;
                }
            }

            if !added {
                lines.push(vec![block]);
            }
        }

        // Sort each line horizontally by x
        for line in lines.iter_mut() {
            line.sort_by_key(|b| b.box_rect.x);
        }

        lines
    }
}

pub struct WordMerger;

impl WordMerger {
    pub fn merge_line(line_blocks: Vec<TextBlock>, gap_threshold: f32) -> TextBlock {
        let segments = Self::merge_line_segments(line_blocks, gap_threshold);
        if segments.is_empty() {
            return TextBlock {
                text: String::new(),
                confidence: 1.0,
                box_rect: BoundingBox {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                },
            };
        }
        if segments.len() == 1 {
            return segments.into_iter().next().unwrap();
        }
        // 多段时以换行拼接，保留向后兼容
        let mut text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut total_conf = 0.0f32;
        for s in &segments {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&s.text);
            total_conf += s.confidence;
            min_x = min_x.min(s.box_rect.x);
            min_y = min_y.min(s.box_rect.y);
            max_x = max_x.max(s.box_rect.x + s.box_rect.width as i32);
            max_y = max_y.max(s.box_rect.y + s.box_rect.height as i32);
        }
        TextBlock {
            text,
            confidence: total_conf / segments.len() as f32,
            box_rect: BoundingBox {
                x: min_x,
                y: min_y,
                width: (max_x - min_x) as u32,
                height: (max_y - min_y) as u32,
            },
        }
    }

    /// 将同一视觉行按水平间距 threshold 切分为若干个独立的语义段（例如表格不同列、独立按钮）：
    /// 间距 <= gap_threshold 的相邻词合并为一个 TextBlock（如 "Principled" + "BSDF"）；
    /// 间距 > gap_threshold 的相邻块则作为独立的 TextBlock 返回，绝不跨列串联！
    pub fn merge_line_segments(line_blocks: Vec<TextBlock>, gap_threshold: f32) -> Vec<TextBlock> {
        if line_blocks.is_empty() {
            return Vec::new();
        }

        let mut valid: Vec<TextBlock> = line_blocks
            .into_iter()
            .filter(|b| !b.text.trim().is_empty())
            .collect();
        if valid.is_empty() {
            return Vec::new();
        }

        let mut heights: Vec<f32> = valid.iter().map(|b| b.box_rect.height as f32).collect();
        heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median_h = heights[heights.len() / 2].max(1.0);

        valid.sort_by_key(|b| b.box_rect.y + (b.box_rect.height as i32) / 2);
        let mut sub_lines: Vec<Vec<TextBlock>> = Vec::new();
        let mut last_center = f32::MIN;
        for b in valid {
            let center = b.box_rect.y as f32 + b.box_rect.height as f32 * 0.5;
            if sub_lines.is_empty() || (center - last_center).abs() > median_h * 0.6 {
                sub_lines.push(vec![b]);
            } else {
                sub_lines.last_mut().unwrap().push(b);
            }
            last_center = center;
        }

        let mut result_blocks = Vec::new();

        for mut sub in sub_lines {
            if sub.is_empty() {
                continue;
            }
            sub.sort_by_key(|b| b.box_rect.x);

            // 在水平方向上按 gap_threshold 分割为独立的词簇 (clusters)
            let mut clusters: Vec<Vec<TextBlock>> = Vec::new();
            for b in sub {
                let belongs_to_last = if let Some(last_cluster) = clusters.last() {
                    let last = last_cluster.last().unwrap();
                    let last_right = last.box_rect.x + last.box_rect.width as i32;
                    let gap = b.box_rect.x - last_right;
                    let max_gap = gap_threshold.min(median_h * 1.5).max(12.0);
                    (gap as f32) <= max_gap
                } else {
                    false
                };

                if belongs_to_last {
                    clusters.last_mut().unwrap().push(b);
                } else {
                    clusters.push(vec![b]);
                }
            }

            for cluster in clusters {
                if let Some(merged) = Self::merge_single_cluster(&cluster) {
                    result_blocks.push(merged);
                }
            }
        }

        result_blocks
    }

    fn merge_single_cluster(cluster: &[TextBlock]) -> Option<TextBlock> {
        if cluster.is_empty() {
            return None;
        }
        let mut text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut total_confidence = 0.0f32;

        for b in cluster {
            if !text.is_empty() {
                let prev_char = text.chars().last();
                let next_char = b.text.chars().next();
                let needs_space = match (prev_char, next_char) {
                    (Some(p), Some(n)) => {
                        !p.is_whitespace()
                            && !n.is_whitespace()
                            && !is_cjk_or_fullwidth(p)
                            && !is_cjk_or_fullwidth(n)
                    }
                    _ => false,
                };
                if needs_space {
                    text.push(' ');
                }
            }
            text.push_str(&b.text);
            total_confidence += b.confidence;
            min_x = min_x.min(b.box_rect.x);
            min_y = min_y.min(b.box_rect.y);
            max_x = max_x.max(b.box_rect.x + b.box_rect.width as i32);
            max_y = max_y.max(b.box_rect.y + b.box_rect.height as i32);
        }

        let final_x = min_x.max(0);
        let final_y = min_y.max(0);
        let final_w = (max_x - final_x).max(0) as u32;
        let final_h = (max_y - final_y).max(0) as u32;

        Some(TextBlock {
            text,
            confidence: total_confidence / cluster.len() as f32,
            box_rect: BoundingBox {
                x: final_x,
                y: final_y,
                width: final_w,
                height: final_h,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_line_clusterer_vertical_overlap() {
        let blocks = vec![
            TextBlock {
                text: "Hello".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 10,
                    y: 100,
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "World".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 70,
                    y: 106, // 6px jitter, height 20 -> overlap = 14 / 20 = 70% >= 40%
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "NextLine".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 10,
                    y: 140, // Different line
                    width: 60,
                    height: 20,
                },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len(), 2);
        assert_eq!(lines[1].len(), 1);
    }

    #[test]
    fn test_line_clusterer_rejects_cross_column_merge() {
        // Two-column page: the tall left heading vertically spans the right
        // column's first row — the old union-bbox check chained them into one
        // line. The ≥200px column gutter must veto the merge via the gap cap.
        let blocks = vec![
            TextBlock {
                text: "One TokenRouter".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 100, width: 600, height: 60 },
            },
            TextBlock {
                text: "Unified Model Access".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 950, y: 105, width: 200, height: 14 },
            },
            TextBlock {
                text: "All Models".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 170, width: 200, height: 60 },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0][0].text, "One TokenRouter");
        assert_eq!(lines[1][0].text, "Unified Model Access");
        assert_eq!(lines[2][0].text, "All Models");
    }

    #[test]
    fn test_line_clusterer_splits_wide_same_row_gaps() {
        // Same visual row, but the ~90px gaps between separate UI labels
        // exceed the gap cap — they stay independent blocks instead of one
        // mashed "99.9% Smart Always-On" line.
        let blocks = vec![
            TextBlock {
                text: "99.9%".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 100, width: 60, height: 24 },
            },
            TextBlock {
                text: "Smart".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 160, y: 100, width: 70, height: 24 },
            },
            TextBlock {
                text: "Always-On".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 310, y: 100, width: 90, height: 24 },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn test_line_clusterer_merges_nearby_fragments() {
        // Two fragments of one label on the same row, 15px apart → same line.
        let blocks = vec![
            TextBlock {
                text: "Principled".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 100, width: 80, height: 20 },
            },
            TextBlock {
                text: "BSDF".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 105, y: 104, width: 40, height: 20 },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].len(), 2);
    }

    #[test]
    fn test_word_merger_cjk_and_english() {
        // CJK characters should not have spaces inserted
        let cjk_blocks = vec![
            TextBlock {
                text: "这是".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 30,
                    height: 20,
                },
            },
            TextBlock {
                text: "测试".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 40,
                    y: 10,
                    width: 30,
                    height: 20,
                },
            },
        ];
        let merged_cjk = WordMerger::merge_line(cjk_blocks, 20.0);
        assert_eq!(merged_cjk.text, "这是测试");
        assert_eq!(merged_cjk.box_rect.x, 10);
        assert_eq!(merged_cjk.box_rect.width, 60);

        // English words should have spaces inserted
        let eng_blocks = vec![
            TextBlock {
                text: "Principled".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "BSDF".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 65,
                    y: 10,
                    width: 40,
                    height: 20,
                },
            },
        ];
        let merged_eng = WordMerger::merge_line(eng_blocks, 20.0);
        assert_eq!(merged_eng.text, "Principled BSDF");
        assert_eq!(merged_eng.box_rect.x, 10);
        assert_eq!(merged_eng.box_rect.width, 95);
    }

    #[test]
    fn test_word_merger_segments_preserves_columns() {
        // 同一行的两个表格单元格，间距 40px > gap_threshold(20.0)
        // 必须返回 2 个独立的 TextBlock，绝不合并！
        let table_row = vec![
            TextBlock {
                text: "问题表现".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 50, y: 20, width: 80, height: 20 },
            },
            TextBlock {
                text: "修复前".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 170, y: 20, width: 60, height: 20 },
            },
        ];
        let segments = WordMerger::merge_line_segments(table_row, 20.0);
        assert_eq!(segments.len(), 2, "两列间距 40px > 20px 必须保持独立");
        assert_eq!(segments[0].text, "问题表现");
        assert_eq!(segments[1].text, "修复前");
    }
}

